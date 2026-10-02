-- Restrict attendance/session RPCs to the server-side Edge Function boundary.
--
-- These functions are intentionally callable by service_role/postgres only.
-- Public clients must use the ylp-api Edge Function, which performs
-- authentication/authorization and rate limiting before invoking them.

revoke execute on function public.ylp_create_session_v1(
  uuid, text, date, time without time zone, time without time zone,
  integer, text, text, text
) from anon, authenticated;

revoke execute on function public.ylp_close_session_v1(text)
from anon, authenticated;

revoke execute on function public.ylp_scan_v1(
  uuid, text, text, text, text, text, text
) from anon, authenticated;

revoke execute on function public.ylp_consume_rate_limit_v1(
  text, text, integer, integer
) from anon, authenticated;

grant execute on function public.ylp_create_session_v1(
  uuid, text, date, time without time zone, time without time zone,
  integer, text, text, text
) to service_role;

grant execute on function public.ylp_close_session_v1(text)
to service_role;

grant execute on function public.ylp_scan_v1(
  uuid, text, text, text, text, text, text
) to service_role;

grant execute on function public.ylp_consume_rate_limit_v1(
  text, text, integer, integer
) to service_role;
