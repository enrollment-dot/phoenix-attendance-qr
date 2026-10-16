-- Minimal isolated schema for testing session-close and auto-close migrations.
-- This file runs only inside the disposable PostgreSQL service used by CI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;

CREATE TABLE public.sessions (
  session_id text PRIMARY KEY,
  scheduled_date date NOT NULL,
  end_time_local time NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'closed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Recreate the reviewed pre-fix baseline so the migration's preflight is exercised.
CREATE OR REPLACE FUNCTION public.ylp_close_session_v1(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_session
    FROM public.sessions
   WHERE session_id = p_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'The session was not found.',
      'code', 'session_not_found',
      'reason', 'session_not_found'
    );
  END IF;

  IF v_session.status <> 'closed' THEN
    UPDATE public.sessions
       SET status = 'closed'
     WHERE session_id = p_session_id
     RETURNING * INTO v_session;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'session_id', v_session.session_id,
      'status', v_session.status,
      'updated_at', v_session.updated_at
    )
  );
END;
$function$;

-- Mirror the reviewed live baseline ACLs before running the migration preflight.
REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_close_session_v1(text) TO service_role, postgres;
