-- Assertions against the actual function created by the production migration.
INSERT INTO public.sessions (session_id, scheduled_date, end_time_local, status)
VALUES
  ('expired-active', DATE '2000-01-01', TIME '10:00', 'active'),
  ('future-active', DATE '2999-01-01', TIME '10:00', 'active'),
  ('already-closed', DATE '2000-01-01', TIME '10:00', 'closed');

DO $$
DECLARE
  result jsonb;
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

  result := public.ylp_auto_close_sessions_v1();
  IF (result #>> '{data,closed_count}')::integer <> 1 THEN
    RAISE EXCEPTION 'expected closed_count=1 on first run, got %', result;
  END IF;

  IF (SELECT status FROM public.sessions WHERE session_id = 'expired-active') <> 'closed' THEN
    RAISE EXCEPTION 'expired active session was not closed';
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

SELECT 'PASS: expired active session closes; future and closed sessions remain unchanged; repeat run is idempotent; RPC ACLs are restricted' AS regression_result;
