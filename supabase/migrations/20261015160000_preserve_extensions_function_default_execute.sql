-- Preserve PostgreSQL extension-function compatibility after the global PUBLIC
-- default EXECUTE revoke introduced by 20261015150000.
--
-- This is an intentional compatibility carve-out for future functions created
-- by postgres in the extensions schema. It does not grant permissions on
-- existing functions and does not alter defaults for public, storage, or
-- Supabase-managed schemas. Existing extension functions retain their current
-- ACLs; this only restores the prior default for future extensions functions.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
