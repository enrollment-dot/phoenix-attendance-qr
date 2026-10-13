-- Secure server-side RPC used by the YLP session auto-close scheduler.
-- Closes only active sessions whose scheduled end time plus the approved
-- 15-minute grace period has elapsed in the Asia/Bangkok timezone.

CREATE OR REPLACE FUNCTION public.ylp_auto_close_sessions_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_closed_count integer := 0;
BEGIN
  WITH eligible AS (
    SELECT s.session_id
    FROM public.sessions AS s
    WHERE s.status = 'active'
      AND ((s.scheduled_date + s.end_time_local) AT TIME ZONE 'Asia/Bangkok')
        + interval '15 minutes' <= clock_timestamp()
    ORDER BY s.scheduled_date, s.end_time_local, s.session_id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sessions AS s
     SET status = 'closed',
         updated_at = clock_timestamp()
    FROM eligible AS e
   WHERE s.session_id = e.session_id;

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('closed_count', v_closed_count)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM anon;
REVOKE ALL ON FUNCTION public.ylp_auto_close_sessions_v1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ylp_auto_close_sessions_v1() TO service_role;
