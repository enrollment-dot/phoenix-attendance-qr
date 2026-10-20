import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261020150000_add_force_delete_student_rpc.sql', import.meta.url),
  'utf8',
);

test('Student Delete RPC uses a hardened SECURITY DEFINER function', () => {
  assert.match(migration, /create or replace function public\.ylp_force_delete_student_v1\(p_student_id text\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
});

test('Student Delete RPC removes related records before deleting the student', () => {
  const receipts = migration.indexOf('delete from public.scan_receipts');
  const attendance = migration.indexOf('delete from public.attendance');
  const student = migration.indexOf('delete from public.students');
  assert.ok(receipts >= 0, 'scan receipts deletion must exist');
  assert.ok(attendance > receipts, 'attendance must be deleted after scan receipts');
  assert.ok(student > attendance, 'student must be deleted after related records');
  assert.match(migration, /student_not_found/);
});

test('Student Delete RPC is executable only by service_role among application roles', () => {
  assert.match(migration, /revoke all on function public\.ylp_force_delete_student_v1\(text\) from public/i);
  assert.match(migration, /revoke all on function public\.ylp_force_delete_student_v1\(text\) from anon/i);
  assert.match(migration, /revoke all on function public\.ylp_force_delete_student_v1\(text\) from authenticated/i);
  assert.match(migration, /grant execute on function public\.ylp_force_delete_student_v1\(text\) to service_role/i);
});
