-- Minimal isolated schema for testing the real auto-close migration.
-- This file runs only inside the disposable PostgreSQL service used by CI.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;

-- Minimal helper-function fixtures matching the live signatures and security
-- properties. PostgreSQL grants PUBLIC EXECUTE by default; the real migration
-- must explicitly remove that access and grant only backend roles.
CREATE FUNCTION public.ylp_advisory_key_v1(p_namespace text, p_value text)
RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO ''
AS 'SELECT 1::bigint';

CREATE FUNCTION public.ylp_is_uuid_v4_v1(p_value uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO ''
AS 'SELECT true';

CREATE FUNCTION public.ylp_scan_rejection_v1(p_reason text, p_error text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO ''
AS 'SELECT ''{}''::jsonb';

CREATE TABLE public.sessions (
  session_id text PRIMARY KEY,
  scheduled_date date NOT NULL,
  end_time_local time NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'closed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
