-- Restrict client-role execution on future public-schema functions in Staging.
-- Scope is deliberately limited to public-schema functions created by these owners.
-- Existing service_role/postgres grants are preserved; other schemas are untouched.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Explicitly enforce least privilege for the three reviewed helper functions.
REVOKE EXECUTE ON FUNCTION public.ylp_advisory_key_v1(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ylp_is_uuid_v4_v1(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ylp_scan_rejection_v1(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ylp_advisory_key_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ylp_is_uuid_v4_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ylp_scan_rejection_v1(text, text) TO service_role;
