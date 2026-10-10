-- Align Staging account-management RPC behavior with the supported RBAC roles.
-- Preserve at least one active administrative authority (admin or super_admin).
-- A transaction-scoped advisory lock serializes account authority mutations across
-- create/update/remove RPCs so concurrent requests cannot remove the final authority.

BEGIN;

ALTER TABLE public.admin_profiles
  DROP CONSTRAINT IF EXISTS admin_profiles_role_check;

ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'operator'::text]));

CREATE OR REPLACE FUNCTION public.ylp_admin_account_create_profile_v1(
  p_admin_id uuid,
  p_username text,
  p_role text
)
RETURNS TABLE(admin_id uuid, username text, role text, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(741852963);

  IF p_role NOT IN ('super_admin', 'admin', 'operator') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF p_username IS NOT NULL AND p_username !~ '^[A-Za-z0-9._-]{3,40}$' THEN
    RAISE EXCEPTION 'Invalid username';
  END IF;

  INSERT INTO public.admin_profiles(admin_id, username, role, active, created_at, updated_at)
  VALUES (p_admin_id, NULLIF(trim(p_username), ''), p_role, true, now(), now())
  RETURNING admin_profiles.admin_id, admin_profiles.username, admin_profiles.role, admin_profiles.active
  INTO admin_id, username, role, active;

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ylp_admin_account_update_v1(
  p_admin_id uuid,
  p_username text,
  p_role text,
  p_active boolean
)
RETURNS TABLE(admin_id uuid, username text, role text, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  target_role text;
  target_active boolean;
  other_active_authority_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(741852963);

  SELECT ap.role, ap.active
    INTO target_role, target_active
    FROM public.admin_profiles AS ap
   WHERE ap.admin_id = p_admin_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF p_role NOT IN ('super_admin', 'admin', 'operator') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF p_username IS NOT NULL AND p_username !~ '^[A-Za-z0-9._-]{3,40}$' THEN
    RAISE EXCEPTION 'Invalid username';
  END IF;

  IF target_role IN ('admin', 'super_admin')
     AND target_active IS TRUE
     AND (p_role NOT IN ('admin', 'super_admin') OR p_active IS NOT TRUE) THEN
    SELECT count(*)
      INTO other_active_authority_count
      FROM public.admin_profiles AS ap
     WHERE ap.admin_id <> p_admin_id
       AND ap.active IS TRUE
       AND ap.role IN ('admin', 'super_admin');

    IF other_active_authority_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last active administrative authority';
    END IF;
  END IF;

  UPDATE public.admin_profiles AS ap
     SET username = NULLIF(trim(p_username), ''),
         role = p_role,
         active = p_active,
         updated_at = now()
   WHERE ap.admin_id = p_admin_id
   RETURNING ap.admin_id, ap.username, ap.role, ap.active
        INTO admin_id, username, role, active;

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ylp_admin_account_remove_profile_v1(p_admin_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  target_role text;
  target_active boolean;
  other_active_authority_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(741852963);

  SELECT ap.role, ap.active
    INTO target_role, target_active
    FROM public.admin_profiles AS ap
   WHERE ap.admin_id = p_admin_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF target_role IN ('admin', 'super_admin') AND target_active IS TRUE THEN
    SELECT count(*)
      INTO other_active_authority_count
      FROM public.admin_profiles AS ap
     WHERE ap.admin_id <> p_admin_id
       AND ap.active IS TRUE
       AND ap.role IN ('admin', 'super_admin');

    IF other_active_authority_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last active administrative authority';
    END IF;
  END IF;

  DELETE FROM public.admin_profiles AS ap
   WHERE ap.admin_id = p_admin_id;

  RETURN true;
END;
$function$;

COMMIT;
