-- Use the business timezone for default enrollment dates, independent of the DB session timezone.
-- This migration is additive and does not rewrite existing Student enrollment dates.

ALTER TABLE public.students
  ALTER COLUMN enrolled_from
  SET DEFAULT ((pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date);

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
