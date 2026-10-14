-- Harden SECURITY DEFINER functions against object/operator shadowing.
-- Keep public objects accessible by explicit qualification while resolving built-ins first.
-- This migration changes function configuration only; it does not change function bodies or grants.

ALTER FUNCTION public.ylp_branding_get_v1()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, uuid
)
  SET search_path = pg_catalog, public;
