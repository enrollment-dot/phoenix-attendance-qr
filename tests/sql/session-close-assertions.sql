-- Assertions against the migrated RPC in the disposable PostgreSQL CI service.
INSERT INTO public.sessions (session_id, status, updated_at)
VALUES
  ('active-fixture', 'active', clock_timestamp() - interval '1 day'),
  ('closed-fixture', 'closed', clock_timestamp() - interval '1 day');

DO $$
DECLARE
  v_before_active timestamptz;
  v_after_active timestamptz;
  v_before_closed timestamptz;
  v_after_closed timestamptz;
  v_result jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE on manual-close RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on manual-close RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE on manual-close RPC';
  END IF;

  SELECT updated_at INTO v_before_active FROM public.sessions WHERE session_id = 'active-fixture';
  v_result := public.ylp_close_session_v1('active-fixture');
  SELECT updated_at INTO v_after_active FROM public.sessions WHERE session_id = 'active-fixture';

  IF v_result->>'ok' <> 'true' OR v_result #>> '{data,status}' <> 'closed' THEN
    RAISE EXCEPTION 'manual close returned unexpected response: %', v_result;
  END IF;
  IF v_after_active <= v_before_active THEN
    RAISE EXCEPTION 'updated_at did not advance for active session close: before %, after %',
      v_before_active, v_after_active;
  END IF;
  IF (v_result #>> '{data,updated_at}')::timestamptz <> v_after_active THEN
    RAISE EXCEPTION 'response updated_at does not match persisted timestamp';
  END IF;

  SELECT updated_at INTO v_before_closed FROM public.sessions WHERE session_id = 'closed-fixture';
  v_result := public.ylp_close_session_v1('closed-fixture');
  SELECT updated_at INTO v_after_closed FROM public.sessions WHERE session_id = 'closed-fixture';
  IF v_after_closed <> v_before_closed THEN
    RAISE EXCEPTION 'idempotent close unexpectedly changed updated_at for already-closed session';
  END IF;

  v_result := public.ylp_close_session_v1('missing-fixture');
  IF v_result->>'ok' <> 'false' OR v_result->>'code' <> 'session_not_found' THEN
    RAISE EXCEPTION 'missing session response contract changed: %', v_result;
  END IF;
END
$$;

SELECT 'PASS: manual close advances updated_at; already-closed session remains unchanged; missing-session contract and backend-only ACLs are preserved' AS regression_result;
