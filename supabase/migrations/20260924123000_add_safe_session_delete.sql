create or replace function public.ylp_delete_session_v1(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.sessions%rowtype;
  v_attendance_count integer;
  v_scan_receipt_count integer;
begin
  if p_session_id is null or pg_catalog.btrim(p_session_id) = '' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'Session not found.',
      'code', 'session_not_found'
    );
  end if;

  select *
    into v_session
    from public.sessions
   where session_id = p_session_id
   for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The session was not found.',
      'code', 'session_not_found'
    );
  end if;

  if v_session.status <> 'closed' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'Close the session before deleting it.',
      'code', 'session_must_be_closed'
    );
  end if;

  select count(*) into v_attendance_count
    from public.attendance
   where session_id = p_session_id;

  select count(*) into v_scan_receipt_count
    from public.scan_receipts
   where session_id = p_session_id;

  if v_attendance_count > 0 or v_scan_receipt_count > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'This session has attendance history and cannot be deleted.',
      'code', 'session_has_attendance'
    );
  end if;

  delete from public.session_creation_receipts
   where session_id = p_session_id;

  delete from public.sessions
   where session_id = p_session_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'session_id', p_session_id,
      'deleted', true
    )
  );
end;
$function$;

revoke all on function public.ylp_delete_session_v1(text) from public;
grant execute on function public.ylp_delete_session_v1(text) to service_role;
