-- Restrict sensitive account-management and session-delete RPCs to trusted backend roles.
-- Safe to apply repeatedly; production already has these restrictions.
BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.ylp_admin_account_create_profile_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.ylp_admin_account_remove_profile_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.ylp_admin_account_update_v1(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.ylp_admin_accounts_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.ylp_delete_session_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ylp_admin_account_create_profile_v1(uuid, text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_admin_account_remove_profile_v1(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_admin_account_update_v1(uuid, text, text, boolean) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_admin_accounts_v1() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_delete_session_v1(text) TO service_role, postgres;

COMMIT;
