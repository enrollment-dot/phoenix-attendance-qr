-- Runs only in a disposable PostgreSQL CI database after the default ACL migration.
CREATE FUNCTION public.default_acl_probe_v1()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS 'SELECT 1';

DO $assertions$
DECLARE
  v_oid oid := 'public.default_acl_probe_v1()'::regprocedure;
BEGIN
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
    RAISE EXCEPTION 'New postgres-owned function has client/PUBLIC EXECUTE ACL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
     WHERE p.oid = v_oid
       AND acl.grantee = 'service_role'::pg_catalog.regrole::oid
       AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'New public function is missing expected service_role EXECUTE ACL';
  END IF;

  IF NOT pg_catalog.has_function_privilege('postgres', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'New function effective privileges do not match backend-only expectations';
  END IF;
END
$assertions$;

SELECT 'PASS: newly created postgres-owned public function has backend-only default EXECUTE ACLs' AS regression_result;
