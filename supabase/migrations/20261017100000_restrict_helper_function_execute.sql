-- Restrict pure helper RPCs to backend roles. These helpers are used by backend-only
-- session/scan RPCs and do not need to be directly callable by PostgREST client roles.
-- This migration is additive and must be applied through the normal reviewed migration path.

DO $preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.ylp_advisory_key_v1(text,text)',
    'public.ylp_is_uuid_v4_v1(uuid)',
    'public.ylp_scan_rejection_v1(text,text)'
  ]
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Preflight failed: expected helper function % is missing', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(p.proowner),
           p.prosecdef,
           p.provolatile,
           p.proconfig
      INTO v_owner, v_security_definer, v_volatility, v_config
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_oid;

    IF v_owner <> 'postgres'
       OR v_security_definer
       OR v_volatility <> 'i'
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(v_config) AS cfg(setting)
          WHERE cfg.setting = 'search_path=""'
       ) THEN
      RAISE EXCEPTION
        'Preflight failed: helper % owner/security/volatility/search_path differs from reviewed baseline',
        v_signature;
    END IF;
  END LOOP;
END
$preflight$;

REVOKE ALL ON FUNCTION public.ylp_advisory_key_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_advisory_key_v1(text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_advisory_key_v1(text,text) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.ylp_is_uuid_v4_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_is_uuid_v4_v1(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_is_uuid_v4_v1(uuid) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.ylp_scan_rejection_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_scan_rejection_v1(text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_scan_rejection_v1(text,text) TO service_role, postgres;
