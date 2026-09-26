-- Security hardening: backend-only tables must not be directly accessible
-- through the anon/authenticated Data API roles. The Edge Function uses
-- service_role for database access.

revoke all on table public.admin_profiles from anon, authenticated;
revoke all on table public.api_rate_limit_counters from anon, authenticated;
revoke all on table public.scan_receipts from anon, authenticated;
revoke all on table public.session_creation_receipts from anon, authenticated;

grant all on table public.admin_profiles to service_role;
grant all on table public.api_rate_limit_counters to service_role;
grant all on table public.scan_receipts to service_role;
grant all on table public.session_creation_receipts to service_role;