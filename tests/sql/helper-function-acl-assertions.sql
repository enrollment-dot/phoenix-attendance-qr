-- Verify helper RPCs are backend-only using both explicit ACL entries and
-- effective privileges. Runs only in the disposable PostgreSQL service used by CI.
DO $$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.ylp_advisory_key_v1(text,text)',
    'public.ylp_is_uuid_v4_v1(uuid)',
    'public.ylp_scan_rejection_v1(text,text)'
  ]
  LOOP
    v_oid := v_signature::regprocedure;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Client role retains effective EXECUTE on %', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Backend role is missing effective EXECUTE on %', v_signature;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
       WHERE p.oid = v_oid
         AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee IN (
           0::oid,
           'anon'::pg_catalog.regrole::oid,
           'authenticated'::pg_catalog.regrole::oid
         )
    ) THEN
      RAISE EXCEPTION 'PUBLIC/anon/authenticated has an explicit EXECUTE ACL on %', v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
       WHERE p.oid = v_oid
         AND acl.grantee = 'service_role'::pg_catalog.regrole::oid
         AND acl.privilege_type = 'EXECUTE'
    ) OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
       WHERE p.oid = v_oid
         AND acl.grantee = 'postgres'::pg_catalog.regrole::oid
         AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Explicit backend EXECUTE ACL entry missing on %', v_signature;
    END IF;
  END LOOP;
END
$$;

SELECT 'PASS: helper functions are executable by backend roles only; explicit ACLs verified' AS regression_result;
