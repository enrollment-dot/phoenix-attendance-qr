-- Regression assertions for the 120-minute fallback and scan predicate hardening.
INSERT INTO public.sessions (session_id, scheduled_date, end_time_local, status)
VALUES
  ('expired-active', DATE '2000-01-01', TIME '10:00', 'active'),
  ('within-fallback-active',
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Bangkok' - interval '119 minutes')::date,
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Bangkok' - interval '119 minutes')::time,
    'active'),
  ('past-fallback-active',
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Bangkok' - interval '121 minutes')::date,
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Bangkok' - interval '121 minutes')::time,
    'active'),
  ('future-active', DATE '2999-01-01', TIME '10:00', 'active'),
  ('already-closed', DATE '2000-01-01', TIME '10:00', 'closed');

DO $$
DECLARE
  result jsonb;
  scan_definition text;
BEGIN
  IF has_function_privilege('anon', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE on auto-close RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on auto-close RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE on auto-close RPC';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres is missing EXECUTE on auto-close RPC';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO scan_definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ylp_scan_v1';

  IF scan_definition IS NULL OR
     pg_catalog.strpos(scan_definition, 'p_direction = ''in'' AND v_now > v_end_at + pg_catalog.make_interval(mins => v_close_minutes)') = 0 THEN
    RAISE EXCEPTION 'scan RPC must apply close-window cutoff only to Scan In';
  END IF;

  result := public.ylp_auto_close_sessions_v1();
  IF (result #>> '{data,closed_count}')::integer <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 sessions beyond 120 minutes to close, got %', result;
  END IF;

  IF (SELECT status FROM public.sessions WHERE session_id = 'expired-active') <> 'closed' THEN
    RAISE EXCEPTION 'old expired active session was not closed';
  END IF;
  IF (SELECT status FROM public.sessions WHERE session_id = 'past-fallback-active') <> 'closed' THEN
    RAISE EXCEPTION 'session beyond 120-minute fallback was not closed';
  END IF;
  IF (SELECT status FROM public.sessions WHERE session_id = 'within-fallback-active') <> 'active' THEN
    RAISE EXCEPTION 'session within 120-minute fallback was incorrectly closed';
  END IF;
  IF (SELECT status FROM public.sessions WHERE session_id = 'future-active') <> 'active' THEN
    RAISE EXCEPTION 'future session was incorrectly closed';
  END IF;
  IF (SELECT status FROM public.sessions WHERE session_id = 'already-closed') <> 'closed' THEN
    RAISE EXCEPTION 'already-closed session status changed';
  END IF;

  result := public.ylp_auto_close_sessions_v1();
  IF (result #>> '{data,closed_count}')::integer <> 0 THEN
    RAISE EXCEPTION 'expected closed_count=0 on second run, got %', result;
  END IF;
END
$$;

SELECT 'PASS: Scan In cutoff retained, Scan Out predicate widened, 120-minute fallback and restricted ACLs verified' AS regression_result;
