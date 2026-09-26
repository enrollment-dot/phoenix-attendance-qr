-- Security hardening: this application uses the ylp-api Edge Function as the
-- only database access layer. Browser clients do not need direct Data API
-- access to application tables.
--
-- Keep RLS enabled as defense in depth, but remove direct anon/authenticated
-- table privileges. The Edge Function uses service_role after its own
-- authentication/RBAC checks.
--
-- Backend-only tables were already restricted in a previous migration.
-- This migration closes the remaining direct table grants.

revoke all on table public.attendance from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
revoke all on table public.settings from anon, authenticated;
revoke all on table public.students from anon, authenticated;

grant all on table public.attendance to service_role;
grant all on table public.sessions to service_role;
grant all on table public.settings to service_role;
grant all on table public.students to service_role;
