import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261015160000_preserve_extensions_function_default_execute.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');

test('future postgres-owned extension functions retain PUBLIC EXECUTE compatibility', () => {
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions\s+GRANT EXECUTE ON FUNCTIONS TO PUBLIC;/i,
  );
});

test('extension compatibility carve-out affects defaults only', () => {
  assert.ok(migration.includes('does not grant permissions on'));
  assert.ok(migration.includes('existing functions'));
  assert.ok(migration.includes('does not alter defaults for public, storage, or'));
  assert.ok(migration.includes('Supabase-managed schemas'));
  assert.doesNotMatch(migration, /\b(REVOKE|GRANT) EXECUTE ON FUNCTION extensions\./i);
});
