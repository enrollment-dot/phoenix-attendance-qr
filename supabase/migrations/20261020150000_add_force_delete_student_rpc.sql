-- Restore the service-role-only Student Delete RPC required by ylp-api.
-- The Edge Function is responsible for super_admin authorization, fresh same-account
-- re-authentication, and login-global rate limiting before invoking this function.
-- This function intentionally contains no browser-facing authorization bypass.

create or replace function public.ylp_force_delete_student_v1(p_student_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id text := pg_catalog.btrim(coalesce(p_student_id, ''));
begin
  if v_id = '' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'Student not found.'
    );
  end if;

  if not exists (
    select 1
    from public.students
    where student_id = v_id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'student_not_found',
      'error', 'Student not found.'
    );
  end if;

  delete from public.scan_receipts where student_id = v_id;
  delete from public.attendance where student_id = v_id;
  delete from public.students where student_id = v_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'student_id', v_id,
      'deleted', true
    )
  );
end;
$function$;

revoke all on function public.ylp_force_delete_student_v1(text) from public;
revoke all on function public.ylp_force_delete_student_v1(text) from anon;
revoke all on function public.ylp_force_delete_student_v1(text) from authenticated;
grant execute on function public.ylp_force_delete_student_v1(text) to service_role;
