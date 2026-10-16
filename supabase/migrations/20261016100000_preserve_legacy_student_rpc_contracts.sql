-- Preserve legacy Student RPC payloads without ambiguous default-argument overloads.
-- The four-argument API contract remains explicit; legacy update wrappers preserve email.
-- Apply only after reviewing each environment's current schema and migration ledger.

-- PostgreSQL does not allow removing existing input-parameter defaults with CREATE OR REPLACE.
-- Drop only the reviewed overload set, then recreate all signatures below in this migration transaction.
DROP FUNCTION IF EXISTS public.ylp_student_create_v1(text, text);
DROP FUNCTION IF EXISTS public.ylp_student_create_v1(text, text, date);
DROP FUNCTION IF EXISTS public.ylp_student_create_v1(text, text, date, text);
DROP FUNCTION IF EXISTS public.ylp_student_update_v1(text, text);
DROP FUNCTION IF EXISTS public.ylp_student_update_v1(text, text, date);
DROP FUNCTION IF EXISTS public.ylp_student_update_v1(text, text, date, text);

CREATE OR REPLACE FUNCTION public.ylp_student_create_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id text := pg_catalog.btrim(coalesce(p_student_id, ''));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := nullif(pg_catalog.btrim(coalesce(p_email, '')), '');
  v_date date := coalesce(p_enrolled_from, current_date);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
BEGIN
  IF v_id = '' OR pg_catalog.length(v_id) > 40 OR v_id !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student ID may contain letters, numbers, _ and -.');
  END IF;
  IF v_name = '' OR pg_catalog.length(v_name) > 100 OR v_name ~ '[[:cntrl:]\x7f]' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student name.');
  END IF;
  IF v_email IS NOT NULL AND (
    pg_catalog.length(v_email) > 254
    OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student email.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE student_id = v_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'student_exists', 'error', 'Student ID already exists.');
  END IF;
  INSERT INTO public.students(student_id, name, email, active, enrolled_from, created_at, updated_at)
  VALUES (v_id, v_name, v_email, true, v_date, v_now, v_now)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'student_id', v_row.student_id, 'name', v_row.name, 'email', v_row.email,
    'active', v_row.active, 'enrolled_from', v_row.enrolled_from,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ylp_student_update_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id text := pg_catalog.btrim(coalesce(p_student_id, ''));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := nullif(pg_catalog.btrim(coalesce(p_email, '')), '');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
BEGIN
  IF v_id = '' OR pg_catalog.length(v_id) > 40 OR v_id !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student ID may contain letters, numbers, _ and -.');
  END IF;
  IF v_name = '' OR pg_catalog.length(v_name) > 100 OR v_name ~ '[[:cntrl:]\x7f]' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student name.');
  END IF;
  IF v_email IS NOT NULL AND (
    pg_catalog.length(v_email) > 254
    OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student email.');
  END IF;
  UPDATE public.students
  SET name = v_name,
      email = v_email,
      enrolled_from = coalesce(p_enrolled_from, enrolled_from),
      updated_at = v_now
  WHERE student_id = v_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'student_not_found', 'error', 'Student not found.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'student_id', v_row.student_id, 'name', v_row.name, 'email', v_row.email,
    'active', v_row.active, 'enrolled_from', v_row.enrolled_from,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;

-- Two-argument create wrapper supports older payloads and defaults enrollment date.
CREATE OR REPLACE FUNCTION public.ylp_student_create_v1(
  p_student_id text,
  p_name text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.ylp_student_create_v1(p_student_id, p_name, current_date, NULL::text);
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text) FROM PUBLIC, anon, authenticated;

-- Three-argument create wrapper preserves the supplied enrollment date.
CREATE OR REPLACE FUNCTION public.ylp_student_create_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.ylp_student_create_v1(p_student_id, p_name, p_enrolled_from, NULL::text);
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text, date) FROM PUBLIC, anon, authenticated;

-- Legacy update wrappers intentionally do not update email: old callers have no email field.
CREATE OR REPLACE FUNCTION public.ylp_student_update_v1(
  p_student_id text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id text := pg_catalog.btrim(coalesce(p_student_id, ''));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
BEGIN
  IF v_id = '' OR pg_catalog.length(v_id) > 40 OR v_id !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student ID may contain letters, numbers, _ and -.');
  END IF;
  IF v_name = '' OR pg_catalog.length(v_name) > 100 OR v_name ~ '[[:cntrl:]\x7f]' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student name.');
  END IF;
  UPDATE public.students SET name = v_name, updated_at = v_now
  WHERE student_id = v_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'student_not_found', 'error', 'Student not found.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'student_id', v_row.student_id, 'name', v_row.name, 'email', v_row.email,
    'active', v_row.active, 'enrolled_from', v_row.enrolled_from,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ylp_student_update_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id text := pg_catalog.btrim(coalesce(p_student_id, ''));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
BEGIN
  IF v_id = '' OR pg_catalog.length(v_id) > 40 OR v_id !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student ID may contain letters, numbers, _ and -.');
  END IF;
  IF v_name = '' OR pg_catalog.length(v_name) > 100 OR v_name ~ '[[:cntrl:]\x7f]' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student name.');
  END IF;
  UPDATE public.students
  SET name = v_name,
      enrolled_from = coalesce(p_enrolled_from, enrolled_from),
      updated_at = v_now
  WHERE student_id = v_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'student_not_found', 'error', 'Student not found.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'student_id', v_row.student_id, 'name', v_row.name, 'email', v_row.email,
    'active', v_row.active, 'enrolled_from', v_row.enrolled_from,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text, date) FROM PUBLIC, anon, authenticated;

-- Explicit least-privilege ACLs: no direct execution by public client roles.
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_student_create_v1(text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_create_v1(text, text, date) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_update_v1(text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_update_v1(text, text, date) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_create_v1(text, text, date, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_update_v1(text, text, date, text) TO service_role, postgres;
