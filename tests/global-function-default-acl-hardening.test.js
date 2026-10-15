import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261015150000_harden_global_function_default_execute.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');

test('global default EXECUTE is revoked from PUBLIC for future postgres-owned functions', () => {
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/i,
  );
});

test('public-schema future function defaults exclude anon and authenticated', () => {
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;/i,
  );
});

test('migration documents scope and does not mutate existing functions or supabase_admin defaults', () => {
  assert.match(migration, /Existing functions are unchanged/i);
  assert.match(migration, /supabase_admin-owned defaults/i);
  assert.doesNotMatch(migration, /\b(REVOKE|GRANT) EXECUTE ON FUNCTION public\./i);
});
