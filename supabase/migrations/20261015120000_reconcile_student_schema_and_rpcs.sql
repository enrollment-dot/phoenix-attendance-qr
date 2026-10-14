-- Reconcile Staging Student schema with the current ylp-api contract.
-- Safe for existing rows: enrollment dates are backfilled from created_at in Asia/Bangkok.
-- Apply only after reviewing the live schema and migration history; do not replay on Production blindly.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS enrolled_from date;

UPDATE public.students
SET enrolled_from = (created_at AT TIME ZONE 'Asia/Bangkok')::date
WHERE enrolled_from IS NULL;

ALTER TABLE public.students
  ALTER COLUMN enrolled_from SET DEFAULT current_date,
  ALTER COLUMN enrolled_from SET NOT NULL;

COMMENT ON COLUMN public.students.enrolled_from IS
  'First program date from which this student is eligible for attendance calculation.';

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_email_format_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_email_format_check
  CHECK (
    email IS NULL OR (
      char_length(email) <= 254
      AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

-- Remove legacy overloads so calls using default arguments are unambiguous.
DROP FUNCTION IF EXISTS public.ylp_student_create_v1(text, text);
DROP FUNCTION IF EXISTS public.ylp_student_create_v1(text, text, date);
DROP FUNCTION IF EXISTS public.ylp_student_update_v1(text, text);
DROP FUNCTION IF EXISTS public.ylp_student_update_v1(text, text, date);

CREATE OR REPLACE FUNCTION public.ylp_students_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', s.student_id,
        'name', s.name,
        'email', s.email,
        'active', s.active,
        'enrolled_from', s.enrolled_from,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      ) ORDER BY s.student_id
    ),
    '[]'::jsonb
  )
  FROM public.students s;
$function$;

CREATE OR REPLACE FUNCTION public.ylp_student_create_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date DEFAULT current_date,
  p_email text DEFAULT NULL
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

CREATE OR REPLACE FUNCTION public.ylp_student_update_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date DEFAULT NULL,
  p_email text DEFAULT NULL
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

-- Explicit least-privilege ACLs for the exact signatures introduced here.
REVOKE ALL ON FUNCTION public.ylp_students_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ylp_student_update_v1(text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_students_v1() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_create_v1(text, text, date, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ylp_student_update_v1(text, text, date, text) TO service_role, postgres;
