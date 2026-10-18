import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261019010000_preserve_last_active_super_admin.sql', import.meta.url),
  'utf8',
);

test('account lifecycle RPCs serialize changes to preserve admin authority', () => {
  const functions = [
    'ylp_admin_account_create_profile_v1',
    'ylp_admin_account_update_v1',
    'ylp_admin_account_remove_profile_v1',
  ];

  for (const name of functions) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    assert.notEqual(start, -1, `missing replacement for ${name}`);
    const next = migration.indexOf('create or replace function public.', start + 1);
    const end = next === -1 ? migration.indexOf('revoke all on function', start) : next;
    const block = migration.slice(start, end === -1 ? migration.length : end);
    assert.match(block, /pg_advisory_xact_lock\(71420, 1\)/, `${name} must share the lifecycle lock`);
  }
});

test('account update refuses to demote or deactivate the last active super_admin', () => {
  assert.match(migration, /target_role = 'super_admin'[\s\S]*?target_active = true[\s\S]*?p_role <> 'super_admin' or p_active = false/);
  assert.match(migration, /where ap\.role = 'super_admin'[\s\S]*?and ap\.active = true[\s\S]*?and ap\.admin_id <> p_admin_id/);
  assert.match(migration, /Cannot demote or deactivate the last active super_admin/);
});

test('account removal refuses to remove the last active super_admin', () => {
  assert.match(migration, /if target_role = 'super_admin' and target_active = true then[\s\S]*?Cannot remove the last active super_admin/);
  assert.match(migration, /where ap\.role = 'super_admin'[\s\S]*?and ap\.active = true[\s\S]*?and ap\.admin_id <> p_admin_id/);
});

test('account profile RPCs preserve service_role-only execute privileges', () => {
  for (const signature of [
    'ylp_admin_account_create_profile_v1(uuid, text, text)',
    'ylp_admin_account_update_v1(uuid, text, text, boolean)',
    'ylp_admin_account_remove_profile_v1(uuid)',
  ]) {
    assert.ok(migration.includes(`revoke all on function public.${signature} from public, anon, authenticated`));
    assert.ok(migration.includes(`grant execute on function public.${signature} to service_role`));
  }
});

test('account profile create/update role allowlists match all supported RBAC roles', () => {
  assert.equal((migration.match(/'super_admin', 'admin', 'operator'/g) ?? []).length, 2);
});
