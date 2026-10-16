-- Keep manual session close timestamp behavior consistent across Staging and Production.
-- This migration intentionally changes only the explicit manual-close RPC path;
-- it does not restore table-wide timestamp triggers.
DO $$
DECLARE
  v_function_oid oid;
BEGIN
  v_function_oid := to_regprocedure('public.ylp_close_session_v1(text)');
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Expected public.ylp_close_session_v1(text) to exist before migration';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_function_oid) THEN
    RAISE EXCEPTION 'Unexpected SECURITY DEFINER setting on ylp_close_session_v1(text); review before replacing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
      AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'Expected public.sessions.updated_at column to exist';
  END IF;
END
$$;

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
    SET status = 'closed',
        updated_at = pg_catalog.clock_timestamp()
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

REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_close_session_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ylp_close_session_v1(text) TO postgres;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute ylp_close_session_v1(text)';
  END IF;
  IF has_function_privilege('authenticated', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute ylp_close_session_v1(text)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ylp_close_session_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute ylp_close_session_v1(text)';
  END IF;
END
$$;
