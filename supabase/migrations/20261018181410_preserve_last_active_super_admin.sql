-- Preserve at least one active super_admin across account lifecycle changes.
-- Serialize profile lifecycle RPCs so concurrent changes cannot remove the final
-- active super_admin. Keep all profile-management RPCs service_role-only.

create or replace function public.ylp_admin_account_create_profile_v1(
  p_admin_id uuid,
  p_username text,
  p_role text
)
returns table(admin_id uuid, username text, role text, active boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(71420, 1);

  if p_role not in ('super_admin', 'admin', 'operator') then
    raise exception 'Invalid role';
  end if;

  if p_username is not null and p_username !~ '^[A-Za-z0-9._-]{3,40}$' then
    raise exception 'Invalid username';
  end if;

  insert into public.admin_profiles(admin_id, username, role, active, created_at, updated_at)
  values (p_admin_id, nullif(trim(p_username), ''), p_role, true, now(), now())
  returning admin_profiles.admin_id, admin_profiles.username, admin_profiles.role, admin_profiles.active
  into admin_id, username, role, active;

  return next;
end;
$function$;

create or replace function public.ylp_admin_account_update_v1(
  p_admin_id uuid,
  p_username text,
  p_role text,
  p_active boolean
)
returns table(admin_id uuid, username text, role text, active boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  active_admin_count integer;
  active_super_admin_count integer;
  target_role text;
  target_active boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(71420, 1);

  select ap.role, ap.active
    into target_role, target_active
    from public.admin_profiles as ap
   where ap.admin_id = p_admin_id
   for update;

  if not found then
    raise exception 'Account not found';
  end if;

  if p_role not in ('super_admin', 'admin', 'operator') then
    raise exception 'Invalid role';
  end if;

  if target_role = 'super_admin'
     and target_active = true
     and (p_role <> 'super_admin' or p_active = false) then
    select count(*)
      into active_super_admin_count
      from public.admin_profiles as ap
     where ap.role = 'super_admin'
       and ap.active = true
       and ap.admin_id <> p_admin_id;

    if active_super_admin_count = 0 then
      raise exception 'Cannot demote or deactivate the last active super_admin';
    end if;
  end if;

  if target_role = 'admin'
     and target_active = true
     and (p_role <> 'admin' or p_active = false) then
    select count(*)
      into active_admin_count
      from public.admin_profiles as ap
     where ap.role = 'admin'
       and ap.active = true
       and ap.admin_id <> p_admin_id;

    select count(*)
      into active_super_admin_count
      from public.admin_profiles as ap
     where ap.role = 'super_admin'
       and ap.active = true;

    if active_admin_count = 0 and active_super_admin_count = 0 then
      raise exception 'Cannot remove the last active admin';
    end if;
  end if;

  if p_username is not null and p_username !~ '^[A-Za-z0-9._-]{3,40}$' then
    raise exception 'Invalid username';
  end if;

  update public.admin_profiles as ap
     set username = nullif(trim(p_username), ''),
         role = p_role,
         active = p_active,
         updated_at = now()
   where ap.admin_id = p_admin_id
  returning ap.admin_id, ap.username, ap.role, ap.active
       into admin_id, username, role, active;

  return next;
end;
$function$;

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
  perform pg_catalog.pg_advisory_xact_lock(71420, 1);

  select ap.role, ap.active
    into target_role, target_active
    from public.admin_profiles as ap
   where ap.admin_id = p_admin_id
   for update;

  if not found then
    return false;
  end if;

  if target_role = 'super_admin' and target_active = true then
    select count(*)
      into active_super_admin_count
      from public.admin_profiles as ap
     where ap.role = 'super_admin'
       and ap.active = true
       and ap.admin_id <> p_admin_id;

    if active_super_admin_count = 0 then
      raise exception 'Cannot remove the last active super_admin';
    end if;
  end if;

  if target_role = 'admin' and target_active = true then
    select count(*)
      into active_admin_count
      from public.admin_profiles as ap
     where ap.role = 'admin'
       and ap.active = true
       and ap.admin_id <> p_admin_id;

    select count(*)
      into active_super_admin_count
      from public.admin_profiles as ap
     where ap.role = 'super_admin'
       and ap.active = true;

    if active_admin_count = 0 and active_super_admin_count = 0 then
      raise exception 'Cannot remove the last active admin';
    end if;
  end if;

  delete from public.admin_profiles
   where admin_id = p_admin_id;

  return true;
end;
$function$;

revoke all on function public.ylp_admin_account_create_profile_v1(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ylp_admin_account_update_v1(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.ylp_admin_account_remove_profile_v1(uuid) from public, anon, authenticated;
grant execute on function public.ylp_admin_account_create_profile_v1(uuid, text, text) to service_role;
grant execute on function public.ylp_admin_account_update_v1(uuid, text, text, boolean) to service_role;
grant execute on function public.ylp_admin_account_remove_profile_v1(uuid) to service_role;
