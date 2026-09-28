-- Reproducibility hardening: keep student management RPCs backend-only.
-- Production was verified to already have these ACLs; this migration records
-- the intended state for fresh/rebuilt environments.

revoke execute on function public.ylp_student_create_v1(text, text, date) from public, anon, authenticated;
revoke execute on function public.ylp_student_create_v1(text, text, date, text) from public, anon, authenticated;
revoke execute on function public.ylp_student_update_v1(text, text, date) from public, anon, authenticated;
revoke execute on function public.ylp_student_update_v1(text, text, date, text) from public, anon, authenticated;

grant execute on function public.ylp_student_create_v1(text, text, date, text) to service_role;
grant execute on function public.ylp_student_update_v1(text, text, date, text) to service_role;
