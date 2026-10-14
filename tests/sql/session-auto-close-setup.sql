-- Minimal isolated schema for testing the scheduler migration and scan-window rewrite.
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

-- Isolated stand-in with the same signature and target predicate as the deployed
-- scan RPC. The migration must modify only the Scan In end-window condition.
CREATE FUNCTION public.ylp_scan_v1(
  p_request_id uuid,
  p_session_id text,
  p_qr_token_hash text,
  p_student_id text,
  p_student_name text,
  p_direction text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_end_at timestamptz := v_now;
  v_close_minutes integer := 15;
  v_session record;
BEGIN
  SELECT 'active'::text AS status INTO v_session;
  IF v_session.status <> 'active'
     OR v_now > v_end_at + pg_catalog.make_interval(mins => v_close_minutes) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$function$;
