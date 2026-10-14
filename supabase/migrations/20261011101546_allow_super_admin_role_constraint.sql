-- Allow the supported super_admin role while preserving existing role values.
-- Staging applied this migration as 20261011101546_allow_super_admin_role_constraint.
-- Account bootstrap is intentionally separate and must never be embedded in a reusable migration.
alter table public.admin_profiles
  drop constraint if exists admin_profiles_role_check;

alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role = any (array['admin'::text, 'operator'::text, 'super_admin'::text]));
