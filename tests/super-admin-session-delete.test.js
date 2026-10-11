import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261011174119_super_admin_closed_session_delete.sql', import.meta.url),
  'utf8',
);

test('closed sessions render a super-admin-only delete action and confirmation dialog', () => {
  assert.match(source, /s\.status === 'closed' && role === 'super_admin'/);
  assert.match(source, /<dialog id="delete-dialog" class="confirm-dialog">/);
  assert.match(source, /<form id="delete-form">/);
  assert.match(source, /document\\.createElement\\('dialog'\\)/);
  assert.match(source, /document\\.querySelector\\('\\.qr-card'\\)\\?\\.append\\(dialog\\)/);
  assert.match(source, /same super admin username and password/);
  assert.match(source, /await api\('deleteSession', \{ session_id: s\.session_id, username, password \}, token\)/);
});

test('force-delete RPC is restricted to server roles and refuses active sessions', () => {
  assert.match(migration, /if v_session\.status <> 'closed' then/);
  assert.match(migration, /revoke all on function public\.ylp_force_delete_session_v1\(text\) from anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ylp_force_delete_session_v1\(text\) to service_role, postgres/i);
  assert.match(migration, /delete from public\.attendance where session_id = p_session_id/i);
});
