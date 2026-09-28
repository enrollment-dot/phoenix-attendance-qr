-- Security hardening: admin username -> Auth identity lookup is backend-only.
-- The deployed Edge Function is the only known application caller and uses the service-role client.
-- Production log review found 109 observed calls in the available log window, all using the service-role key.
-- This migration removes the unnecessary public/anon/authenticated EXECUTE surface.

revoke execute on function public.ylp_admin_login_identity_v1(text)
  from public, anon, authenticated;

grant execute on function public.ylp_admin_login_identity_v1(text)
  to service_role;
