-- Align postgres-owned function defaults with the reviewed Staging baseline.
-- Scope: future functions created by role postgres; PUBLIC is handled globally
-- because per-schema default ACL revokes cannot cancel a global default grant.
-- The public schema retains the expected service_role default grant.

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: postgres role is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: service_role role is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: anon/authenticated roles are missing';
  END IF;
END
$preflight$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

DO $postflight$
DECLARE
  v_global_acl text;
  v_public_acl text;
BEGIN
  SELECT coalesce(array_to_string(d.defaclacl, ','), '(none)')
    INTO v_global_acl
    FROM pg_catalog.pg_default_acl AS d
   WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
     AND d.defaclnamespace = 0
     AND d.defaclobjtype = 'f';

  IF v_global_acl IS NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_default_acl AS d
         CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
        WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
          AND d.defaclnamespace = 0
          AND d.defaclobjtype = 'f'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_default_acl AS d
         CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
        WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
          AND d.defaclnamespace = 0
          AND d.defaclobjtype = 'f'
          AND acl.grantee IN (
            'anon'::pg_catalog.regrole::oid,
            'authenticated'::pg_catalog.regrole::oid
          )
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Postflight failed: postgres global function defaults still grant PUBLIC/anon/authenticated EXECUTE';
  END IF;

  SELECT coalesce(array_to_string(d.defaclacl, ','), '(none)')
    INTO v_public_acl
    FROM pg_catalog.pg_default_acl AS d
   WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
     AND d.defaclnamespace = 'public'::pg_catalog.regnamespace
     AND d.defaclobjtype = 'f';

  IF v_public_acl IS NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_default_acl AS d
         CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
        WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
          AND d.defaclnamespace = 'public'::pg_catalog.regnamespace
          AND d.defaclobjtype = 'f'
          AND acl.grantee IN (
            'anon'::pg_catalog.regrole::oid,
            'authenticated'::pg_catalog.regrole::oid
          )
          AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_default_acl AS d
         CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
        WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
          AND d.defaclnamespace = 'public'::pg_catalog.regnamespace
          AND d.defaclobjtype = 'f'
          AND acl.grantee = 'service_role'::pg_catalog.regrole::oid
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Postflight failed: postgres public function defaults do not match the restricted backend-only baseline (ACL: %)',
      coalesce(v_public_acl, '(missing)');
  END IF;
END
$postflight$;
