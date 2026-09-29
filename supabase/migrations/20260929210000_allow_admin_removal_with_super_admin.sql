-- Allow removal of the last active normal admin when an active super_admin remains.
-- Preserve the safety guard when there is no active super_admin.
create or replace function public.ylp_admin_account_remove_profile_v1(p_admin_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  target_role text;
  target_active boolean;
  active_admin_count integer;
  active_super_admin_count integer;
begin
  select role, active
    into target_role, target_active
    from public.admin_profiles
   where admin_id = p_admin_id
   for update;

  if not found then
    return false;
  end if;

  if target_role = 'admin' and target_active = true then
    select count(*)
      into active_admin_count
      from public.admin_profiles
     where role = 'admin'
       and active = true
       and admin_id <> p_admin_id;

    select count(*)
      into active_super_admin_count
      from public.admin_profiles
     where role = 'super_admin'
       and active = true;

    if active_admin_count = 0 and active_super_admin_count = 0 then
      raise exception 'Cannot remove the last active admin';
    end if;
  end if;

  delete from public.admin_profiles
   where admin_id = p_admin_id;

  return true;
end;
$function$;
