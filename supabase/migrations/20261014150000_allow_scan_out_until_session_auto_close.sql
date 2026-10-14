-- Keep Scan In's configured window, but allow Scan Out while the session remains active.
-- The scheduler closes active sessions 120 minutes after scheduled end.
-- This migration rewrites only the exact end-window predicate in the existing
-- scan RPC, with strict source-shape checks to avoid silently patching drift.

DO $migration$
DECLARE
  v_definition text;
  v_pattern constant text := 'v_now\s*>\s*v_end_at\s*\+\s*pg_catalog\.make_interval\(mins\s*=>\s*v_close_minutes\)';
  v_replacement constant text := '(p_direction = ''in'' AND v_now > v_end_at + pg_catalog.make_interval(mins => v_close_minutes))';
  v_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ylp_scan_v1'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_request_id uuid, p_session_id text, p_qr_token_hash text, p_student_id text, p_student_name text, p_direction text, p_fingerprint text';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected public.ylp_scan_v1 signature was not found; refusing to modify scan behavior';
  END IF;

  v_occurrences := pg_catalog.regexp_count(v_definition, v_pattern);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one scan close-window predicate, found %; refusing to modify scan behavior', v_occurrences;
  END IF;

  v_definition := pg_catalog.regexp_replace(v_definition, v_pattern, v_replacement, 'g');
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ylp_scan_v1'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_request_id uuid, p_session_id text, p_qr_token_hash text, p_student_id text, p_student_name text, p_direction text, p_fingerprint text';

  IF v_definition IS NULL
     OR pg_catalog.strpos(v_definition, 'p_direction = ''in'' AND v_now > v_end_at + pg_catalog.make_interval(mins => v_close_minutes)') = 0 THEN
    RAISE EXCEPTION 'Scan RPC did not retain the Scan In-only close-window predicate';
  END IF;
END
$migration$;

-- Replace the scheduler's fallback boundary. CREATE OR REPLACE preserves the
-- function identity; explicitly reassert its restricted ACL below.
CREATE OR REPLACE FUNCTION public.ylp_auto_close_sessions_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_closed_count integer := 0;
BEGIN
  WITH eligible AS (
    SELECT s.session_id
    FROM public.sessions AS s
    WHERE s.status = 'active'
      AND ((s.scheduled_date + s.end_time_local) AT TIME ZONE 'Asia/Bangkok')
        + interval '120 minutes' <= clock_timestamp()
    ORDER BY s.scheduled_date, s.end_time_local, s.session_id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sessions AS s
     SET status = 'closed',
         updated_at = clock_timestamp()
    FROM eligible AS e
   WHERE s.session_id = e.session_id;

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('closed_count', v_closed_count)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM anon;
REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_auto_close_sessions_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.ylp_auto_close_sessions_v1() TO postgres;

DO $assert_acl$
BEGIN
  IF has_function_privilege('anon', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute ylp_auto_close_sessions_v1';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute ylp_auto_close_sessions_v1';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute ylp_auto_close_sessions_v1';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres must execute ylp_auto_close_sessions_v1';
  END IF;
END
$assert_acl$;
