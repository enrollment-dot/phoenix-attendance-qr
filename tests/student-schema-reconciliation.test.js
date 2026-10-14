import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261015120000_reconcile_student_schema_and_rpcs.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');

test('student reconciliation migration adds optional email and required enrollment date safely', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS enrolled_from date/i);
  assert.match(migration, /created_at AT TIME ZONE 'Asia\\/Bangkok'/i);
  assert.match(migration, /ALTER COLUMN enrolled_from SET NOT NULL/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS email text/i);
  assert.match(migration, /email IS NULL/i);
});

test('student RPCs match the current API contract and include returned fields', () => {
  assert.match(migration, /ylp_student_create_v1\\([\\s\\S]*p_enrolled_from date DEFAULT current_date,[\\s\\S]*p_email text DEFAULT NULL/i);
  assert.match(migration, /ylp_student_update_v1\\([\\s\\S]*p_enrolled_from date DEFAULT NULL,[\\s\\S]*p_email text DEFAULT NULL/i);
  assert.match(migration, /'email', v_row\\.email/i);
  assert.match(migration, /'enrolled_from', v_row\\.enrolled_from/i);
  assert.match(migration, /'email', s\\.email/i);
  assert.match(migration, /'enrolled_from', s\\.enrolled_from/i);
});

test('email and control-character regexes use the intended escapes', () => {
  assert.ok(migration.includes(String.raw`email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`));
  assert.ok(migration.includes(String.raw`v_name ~ '[[:cntrl:]\\x7f]'`));
  assert.ok(!migration.includes(String.raw`email ~* '^[^[:space:]@]+@[^[:space:]@]+\\\\.[^[:space:]@]+$'`));
});

test('legacy overloads are removed and client RPC execution is revoked', () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\\.ylp_student_create_v1\\(text, text\\);/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\\.ylp_student_create_v1\\(text, text, date\\);/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\\.ylp_student_update_v1\\(text, text\\);/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\\.ylp_student_update_v1\\(text, text, date\\);/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\\.ylp_students_v1\\(\\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\\.ylp_student_create_v1\\(text, text, date, text\\) TO service_role, postgres/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\\.ylp_student_update_v1\\(text, text, date, text\\) TO service_role, postgres/i);
});
