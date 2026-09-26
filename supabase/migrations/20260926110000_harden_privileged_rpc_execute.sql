-- Security hardening: privileged admin/session RPCs are only callable by the Edge Function's service-role client.
-- The Edge Function performs application-level JWT/RBAC checks before invoking these functions.
-- Keep username -> auth identity lookup public because it is part of the pre-auth login flow.

revoke all on function public.ylp_admin_account_create_profile_v1(uuid, text, text) from public;
revoke all on function public.ylp_admin_account_remove_profile_v1(uuid) from public;
revoke all on function public.ylp_admin_account_update_v1(uuid, text, text, boolean) from public;
revoke all on function public.ylp_admin_accounts_v1() from public;

grant execute on function public.ylp_admin_account_create_profile_v1(uuid, text, text) to service_role;
grant execute on function public.ylp_admin_account_remove_profile_v1(uuid) to service_role;
grant execute on function public.ylp_admin_account_update_v1(uuid, text, text, boolean) to service_role;
grant execute on function public.ylp_admin_accounts_v1() to service_role;

-- Keep ylp_delete_session_v1 aligned with the same service-role-only policy.
revoke all on function public.ylp_delete_session_v1(text) from public;
grant execute on function public.ylp_delete_session_v1(text) to service_role;

-- ylp_admin_login_identity_v1 intentionally remains executable by anon/authenticated
-- because the username-login flow must resolve the configured Auth email before sign-in.
