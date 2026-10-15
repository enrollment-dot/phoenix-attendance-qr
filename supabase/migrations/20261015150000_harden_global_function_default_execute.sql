-- Harden default EXECUTE privileges for future functions created by postgres.
--
-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- A per-schema REVOKE cannot cancel that global default grant, so revoke it
-- globally for functions created by postgres. Existing functions are unchanged.
--
-- Keep public-schema client roles explicitly excluded from future function ACLs.
-- Existing service_role/postgres grants and existing function ACLs are unchanged.
--
-- This does not change supabase_admin-owned defaults; that requires a separately
-- authorized privileged remediation and must not be attempted from this migration.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
