-- Disposable fixture for the actual last-active-super-admin migration.
-- This file is run only by the isolated PostgreSQL CI service.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;

CREATE TABLE public.admin_profiles (
  admin_id uuid PRIMARY KEY,
  username text UNIQUE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'operator')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_profiles(admin_id, username, role, active) VALUES
  ('10000000-0000-4000-8000-000000000001', 'sole_super_admin', 'super_admin', true),
  ('10000000-0000-4000-8000-000000000002', 'normal_admin', 'admin', true),
  ('10000000-0000-4000-8000-000000000003', 'operator_user', 'operator', true);
