-- Use the business timezone for default enrollment dates, independent of the DB session timezone.
-- This migration is additive and does not rewrite existing Student enrollment dates.

ALTER TABLE public.students
  ALTER COLUMN enrolled_from
  SET DEFAULT ((pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date);

-- The four-argument API must also use Bangkok's date when a caller explicitly sends NULL.
-- This function inserts enrolled_from directly, so the table default alone is insufficient.
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
  v_date date := coalesce(p_enrolled_from, (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date);
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

-- Legacy two-argument create calls must use the same business-date default.
CREATE OR REPLACE FUNCTION public.ylp_student_create_v1(
  p_student_id text,
  p_name text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.ylp_student_create_v1(
    p_student_id,
    p_name,
    (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date,
    NULL::text
  );
$function$;

-- Reassert the intended least-privilege ACL after replacing the wrapper.
REVOKE ALL ON FUNCTION public.ylp_student_create_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_student_create_v1(text, text) TO service_role, postgres;
