-- Keep attendance/session RPCs behind the server-side Edge Function boundary.
--
-- PR #68 restricted anon/authenticated EXECUTE privileges, but PostgreSQL
-- PUBLIC membership can also confer EXECUTE. Explicitly revoke PUBLIC so
-- public clients cannot bypass ylp-api authorization and rate limiting.

revoke execute on function public.ylp_create_session_v1(
  uuid, text, date, time without time zone, time without time zone,
  integer, text, text, text
) from public;

revoke execute on function public.ylp_close_session_v1(text)
from public;

revoke execute on function public.ylp_scan_v1(
  uuid, text, text, text, text, text, text
) from public;

revoke execute on function public.ylp_consume_rate_limit_v1(
  text, text, integer, integer
) from public;

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
