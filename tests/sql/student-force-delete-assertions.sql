-- Runtime and ACL assertions for ylp_force_delete_student_v1.
do $$
declare
  result jsonb;
begin
  if has_function_privilege('anon', 'public.ylp_force_delete_student_v1(text)', 'EXECUTE') then
    raise exception 'anon must not execute Student Delete RPC';
  end if;
  if has_function_privilege('authenticated', 'public.ylp_force_delete_student_v1(text)', 'EXECUTE') then
    raise exception 'authenticated must not execute Student Delete RPC';
  end if;
  if not has_function_privilege('service_role', 'public.ylp_force_delete_student_v1(text)', 'EXECUTE') then
    raise exception 'service_role must execute Student Delete RPC';
  end if;

  result := public.ylp_force_delete_student_v1('STU-DELETE-TEST');
  if coalesce((result ->> 'ok')::boolean, false) is not true then
    raise exception 'expected successful deletion, got %', result;
  end if;
  if exists (select 1 from public.students where student_id = 'STU-DELETE-TEST') then
    raise exception 'student row was not deleted';
  end if;
  if exists (select 1 from public.attendance where student_id = 'STU-DELETE-TEST') then
    raise exception 'attendance rows were not deleted';
  end if;
  if exists (select 1 from public.scan_receipts where student_id = 'STU-DELETE-TEST') then
    raise exception 'scan receipt rows were not deleted';
  end if;

  result := public.ylp_force_delete_student_v1('MISSING-TEST-STUDENT');
  if result ->> 'code' <> 'student_not_found' then
    raise exception 'expected student_not_found response, got %', result;
  end if;

  result := public.ylp_force_delete_student_v1('   ');
  if coalesce((result ->> 'ok')::boolean, true) is not false then
    raise exception 'blank student id must not succeed, got %', result;
  end if;
end
$$;
