-- Atomically close only sessions whose existing 15-minute scan grace period has elapsed.
-- No caller-supplied session IDs or time values are accepted.
create or replace function public.ylp_auto_close_sessions_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_closed_count integer := 0;
begin
  with eligible as (
    select s.session_id
    from public.sessions as s
    where s.status = 'active'
      and ((s.scheduled_date + s.end_time_local) at time zone 'Asia/Bangkok')
        + interval '15 minutes' <= clock_timestamp()
    order by s.scheduled_date, s.end_time_local, s.session_id
    for update skip locked
    limit 100
  )
  update public.sessions as s
     set status = 'closed',
         updated_at = clock_timestamp()
    from eligible as e
   where s.session_id = e.session_id;

  get diagnostics v_closed_count = row_count;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('closed_count', v_closed_count));
end;
$$;

revoke all on function public.ylp_auto_close_sessions_v1() from public;
revoke all on function public.ylp_auto_close_sessions_v1() from anon;
revoke all on function public.ylp_auto_close_sessions_v1() from authenticated;
grant execute on function public.ylp_auto_close_sessions_v1() to service_role;
grant execute on function public.ylp_auto_close_sessions_v1() to postgres;

do $$
begin
  if has_function_privilege('anon', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') then
    raise exception 'anon must not execute ylp_auto_close_sessions_v1';
  end if;
  if has_function_privilege('authenticated', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') then
    raise exception 'authenticated must not execute ylp_auto_close_sessions_v1';
  end if;
  if not has_function_privilege('service_role', 'public.ylp_auto_close_sessions_v1()', 'EXECUTE') then
    raise exception 'service_role must execute ylp_auto_close_sessions_v1';
  end if;
end;
$$;
