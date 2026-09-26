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
