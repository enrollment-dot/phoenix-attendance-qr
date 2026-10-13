-- Minimal isolated schema for testing the real auto-close migration.
-- This file runs only inside the disposable PostgreSQL service used by CI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;

CREATE TABLE public.sessions (
  session_id text PRIMARY KEY,
  scheduled_date date NOT NULL,
  end_time_local time NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'closed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
