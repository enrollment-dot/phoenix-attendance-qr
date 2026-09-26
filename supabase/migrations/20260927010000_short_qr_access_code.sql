-- Short QR access codes for Android-friendly scanning.
-- The code is a 128-bit random credential encoded as 22 URL-safe characters.
-- Only its SHA-256 hash is stored in the database.

alter table public.sessions
  add column if not exists qr_access_code_hash text;
  
-- Encrypted copy lets authorized admin dashboard reads recover the code for QR display.
alter table public.sessions
  add column if not exists qr_access_code_ciphertext text;

create unique index if not exists sessions_qr_access_code_hash_uidx
  on public.sessions (qr_access_code_hash)
  where qr_access_code_hash is not null;

create or replace function public.ylp_set_session_access_code_v1(
  p_session_id text,
  p_qr_access_code_hash text,
  p_qr_access_code_ciphertext text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.sessions%rowtype;
begin
  if p_session_id is null or btrim(p_session_id) = ''
     or p_qr_access_code_hash is null or p_qr_access_code_hash = ''
     or p_qr_access_code_ciphertext is null or p_qr_access_code_ciphertext = '' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The QR access code is invalid.',
      'code', 'qr_access_code_invalid'
    );
  end if;

  select * into v_session
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

  if v_session.qr_access_code_hash is not null
     and v_session.qr_access_code_hash <> p_qr_access_code_hash then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The session QR access code is already assigned.',
      'code', 'qr_access_code_conflict'
    );
  end if;

  update public.sessions
  set qr_access_code_hash = p_qr_access_code_hash,
      qr_access_code_ciphertext = p_qr_access_code_ciphertext,
      updated_at = pg_catalog.clock_timestamp()
  where session_id = p_session_id
  returning * into v_session;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'session_id', v_session.session_id,
      'qr_access_code_ciphertext', v_session.qr_access_code_ciphertext
    )
  );
end;
$function$;

create or replace function public.ylp_resolve_session_access_code_v1(
  p_qr_access_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.sessions%rowtype;
begin
  if p_qr_access_code_hash is null or p_qr_access_code_hash = '' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The class QR is invalid.',
      'code', 'invalid_session_credentials'
    );
  end if;

  select * into v_session
  from public.sessions
  where qr_access_code_hash = p_qr_access_code_hash;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The class QR is invalid.',
      'code', 'invalid_session_credentials'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'session_id', v_session.session_id,
      'qr_token_ciphertext', v_session.qr_token_ciphertext,
      'status', v_session.status
    )
  );
end;
$function$;

revoke all on function public.ylp_set_session_access_code_v1(text, text, text) from public;
revoke all on function public.ylp_set_session_access_code_v1(text, text, text) from anon;
revoke all on function public.ylp_set_session_access_code_v1(text, text, text) from authenticated;
grant execute on function public.ylp_set_session_access_code_v1(text, text, text) to service_role;

revoke all on function public.ylp_resolve_session_access_code_v1(text) from public;
revoke all on function public.ylp_resolve_session_access_code_v1(text) from anon;
revoke all on function public.ylp_resolve_session_access_code_v1(text) from authenticated;
grant execute on function public.ylp_resolve_session_access_code_v1(text) to service_role;

create or replace function public.ylp_get_session_access_code_v1(
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions where session_id = p_session_id;
  if not found or v_session.qr_access_code_ciphertext is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'The session QR access code is unavailable.', 'code', 'qr_access_code_unavailable');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'data', pg_catalog.jsonb_build_object(
    'session_id', v_session.session_id,
    'qr_access_code_ciphertext', v_session.qr_access_code_ciphertext
  ));
end;
$function$;

revoke all on function public.ylp_get_session_access_code_v1(text) from public;
revoke all on function public.ylp_get_session_access_code_v1(text) from anon;
revoke all on function public.ylp_get_session_access_code_v1(text) from authenticated;
grant execute on function public.ylp_get_session_access_code_v1(text) to service_role;

create or replace function public.ylp_dashboard_v1()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment_required boolean; v_offset text; v_open_minutes integer; v_close_minutes integer;
begin
 select max(value) filter(where key='enrollment_required')::boolean,
        max(value) filter(where key='timezone_offset'),
        max(value) filter(where key='open_minutes')::integer,
        max(value) filter(where key='close_minutes')::integer
   into v_enrollment_required,v_offset,v_open_minutes,v_close_minutes
   from public.settings
  where key in('enrollment_required','timezone_offset','open_minutes','close_minutes');
 if v_enrollment_required is null or v_offset is null or v_open_minutes is null or v_close_minutes is null
   then raise exception using message='Required YLP settings are missing'; end if;
 return pg_catalog.jsonb_build_object(
   'session_creation_idempotency',true,
   'sessions',coalesce((
     select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'session_id',s.session_id,'course',s.course,'date',s.scheduled_date,
       'start_time',s.start_time_local,'end_time',s.end_time_local,'status',s.status,
       'qr_token_ciphertext',s.qr_token_ciphertext,
       'qr_access_code_ciphertext',s.qr_access_code_ciphertext
     ) order by s.scheduled_date desc,s.start_time_local desc,s.created_at desc)
     from public.sessions s
   ),'[]'::pg_catalog.jsonb),
   'students',coalesce((
     select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('student_id',st.student_id,'name',st.name) order by st.student_id)
     from public.students st where st.active=true
   ),'[]'::pg_catalog.jsonb),
   'attendance',coalesce((
     select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'session_id',a.session_id,'student_id',a.student_id,'student_name',a.student_name,
       'scan_in',case when a.scan_in is null then '' else to_char(a.scan_in at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
       'scan_out',case when a.scan_out is null then '' else to_char(a.scan_out at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
       'duration_minutes',case when a.duration_minutes is null then '' else a.duration_minutes::text end,
       'status',a.status
     ) order by a.updated_at desc,a.created_at desc) from public.attendance a
   ),'[]'::pg_catalog.jsonb),
   'settings',pg_catalog.jsonb_build_object(
     'enrolled',v_enrollment_required,'offset',v_offset,'openMinutes',v_open_minutes,
     'closeMinutes',v_close_minutes
   ),
   'now',pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 );
end;
$function$;
