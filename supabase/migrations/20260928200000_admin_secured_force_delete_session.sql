create or replace function public.ylp_force_delete_session_v1(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.sessions%rowtype;
  v_attendance_count integer;
  v_scan_receipt_count integer;
begin
  if p_session_id is null or pg_catalog.btrim(p_session_id) = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Session not found.', 'code', 'session_not_found');
  end if;

  select * into v_session
  from public.sessions
  where session_id = p_session_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'The session was not found.', 'code', 'session_not_found');
  end if;

  select count(*) into v_attendance_count
  from public.attendance
  where session_id = p_session_id;

  select count(*) into v_scan_receipt_count
  from public.scan_receipts
  where session_id = p_session_id;

  delete from public.scan_receipts where session_id = p_session_id;
  delete from public.attendance where session_id = p_session_id;
  delete from public.session_creation_receipts where session_id = p_session_id;
  delete from public.sessions where session_id = p_session_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'session_id', p_session_id,
      'deleted', true,
      'attendance_deleted', v_attendance_count,
      'scan_receipts_deleted', v_scan_receipt_count
    )
  );
end;
$function$;

revoke all on function public.ylp_force_delete_session_v1(text) from public;
revoke all on function public.ylp_force_delete_session_v1(text) from anon;
revoke all on function public.ylp_force_delete_session_v1(text) from authenticated;
grant execute on function public.ylp_force_delete_session_v1(text) to service_role;
