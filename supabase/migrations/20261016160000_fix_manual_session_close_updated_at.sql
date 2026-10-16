-- Keep manual session-close timestamp behavior consistent across Staging and Production.
-- This migration is deliberately narrow: it updates the RPC rather than restoring
-- table-wide timestamp triggers whose historical origin and full write-path impact
-- have not been established.

DO $preflight$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.ylp_close_session_v1(text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.ylp_close_session_v1(text) is missing';
  END IF;

  SELECT pg_get_functiondef('public.ylp_close_session_v1(text)'::regprocedure)
    INTO v_definition;

  IF v_definition !~* 'update[[:space:]]+public\.sessions[[:space:]]+set[[:space:]]+status[[:space:]]*=[[:space:]]*''closed''' THEN
    RAISE EXCEPTION 'Preflight failed: close-session RPC definition differs from the reviewed baseline';
  END IF;

  IF v_definition ~* 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''closed''[[:space:]]*,[[:space:]]*updated_at' THEN
    RAISE EXCEPTION 'Preflight stopped: close-session RPC appears to already assign updated_at; review current definition before applying';
  END IF;
END
$preflight$;

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
REVOKE ALL ON FUNCTION public.ylp_close_session_v1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_close_session_v1(text) TO service_role, postgres;
