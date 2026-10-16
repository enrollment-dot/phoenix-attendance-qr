-- Regression test for the manual close-session timestamp update.
-- Runs only in the disposable PostgreSQL service used by CI.

INSERT INTO public.sessions (session_id, scheduled_date, end_time_local, status, updated_at)
VALUES ('manual-close-timestamp-test', DATE '2000-01-01', TIME '10:00', 'active', TIMESTAMPTZ '2000-01-01 00:00:00+00');

DO $$
DECLARE
  v_result jsonb;
  v_first_updated_at timestamptz;
  v_second_updated_at timestamptz;
BEGIN
  IF has_function_privilege('anon', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE on close-session RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on close-session RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE on close-session RPC';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres is missing EXECUTE on close-session RPC';
  END IF;

  v_result := public.ylp_close_session_v1('manual-close-timestamp-test');
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'manual close RPC failed: %', v_result;
  END IF;
  IF v_result #>> '{data,status}' <> 'closed' THEN
    RAISE EXCEPTION 'expected response status=closed, got %', v_result;
  END IF;

  v_first_updated_at := (v_result #>> '{data,updated_at}')::timestamptz;
  IF v_first_updated_at <= TIMESTAMPTZ '2000-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'updated_at did not advance on manual close: %', v_first_updated_at;
  END IF;
  IF (SELECT updated_at FROM public.sessions WHERE session_id = 'manual-close-timestamp-test') <> v_first_updated_at THEN
    RAISE EXCEPTION 'response updated_at does not match persisted row timestamp';
  END IF;

  v_result := public.ylp_close_session_v1('manual-close-timestamp-test');
  v_second_updated_at := (v_result #>> '{data,updated_at}')::timestamptz;
  IF v_second_updated_at <> v_first_updated_at THEN
    RAISE EXCEPTION 'idempotent repeat close unexpectedly changed updated_at: first %, second %',
      v_first_updated_at, v_second_updated_at;
  END IF;
END
$$;

SELECT 'PASS: manual close advances updated_at; response matches persisted timestamp; repeated close is idempotent; RPC ACLs are backend-only' AS regression_result;
