-- Keep manual session-close timestamp behavior consistent across Staging and Production.
-- This migration is deliberately narrow: it updates the RPC rather than restoring
-- table-wide timestamp triggers whose historical origin and full write-path impact
-- have not been established.

DO $preflight$
DECLARE
  v_definition text;
  v_proc record;
BEGIN
  SELECT p.proowner,
         p.prosecdef,
         p.prorettype,
         p.prolang,
         p.proconfig,
         p.proacl,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
    INTO v_proc
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = pg_catalog.to_regprocedure('public.ylp_close_session_v1(text)');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preflight failed: public.ylp_close_session_v1(text) is missing';
  END IF;

  IF v_proc.owner_name <> 'postgres'
     OR v_proc.prosecdef
     OR v_proc.prorettype <> 'jsonb'::pg_catalog.regtype
     OR v_proc.prolang <> (
       SELECT l.oid FROM pg_catalog.pg_language AS l WHERE l.lanname = 'plpgsql'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(v_proc.proconfig) AS cfg(setting)
        WHERE cfg.setting = 'search_path=""'
     ) THEN
    RAISE EXCEPTION 'Preflight failed: close-session RPC owner, security mode, return type, language, or search_path differs from the reviewed baseline';
  END IF;

  -- Check explicit ACL entries, not only effective privileges (postgres is a superuser).
  IF EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(v_proc.proacl) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND acl.grantee IN (
            0::oid,
            'anon'::pg_catalog.regrole::oid,
            'authenticated'::pg_catalog.regrole::oid
          )
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(v_proc.proacl) AS acl
        WHERE acl.grantee = 'service_role'::pg_catalog.regrole::oid
          AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(v_proc.proacl) AS acl
        WHERE acl.grantee = 'postgres'::pg_catalog.regrole::oid
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Preflight failed: explicit close-session RPC ACL entries differ from the reviewed baseline';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
           'public.ylp_close_session_v1(text)'::pg_catalog.regprocedure
         )
    INTO v_definition;

  IF v_definition !~* 'update[[:space:]]+public[.]sessions[[:space:]]+set[[:space:]]+status[[:space:]]*=[[:space:]]*''closed'''
     OR v_definition !~* 'for[[:space:]]+update'
     OR v_definition !~* 'if[[:space:]]+not[[:space:]]+found'
     OR v_definition !~* 'session_not_found'
     OR v_definition !~* 'v_session[.]status[[:space:]]*<>[[:space:]]*''closed'''
     OR v_definition !~* '''updated_at'''
     OR v_definition !~* '''session_id''' THEN
    RAISE EXCEPTION 'Preflight failed: close-session RPC body differs from the reviewed baseline';
  END IF;

  -- Reject any existing assignment regardless of SET-column ordering or formatting.
  IF v_definition ~* 'updated_at[[:space:]]*=' THEN
    RAISE EXCEPTION 'Preflight stopped: close-session RPC already appears to assign updated_at; review the current definition before applying';
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
