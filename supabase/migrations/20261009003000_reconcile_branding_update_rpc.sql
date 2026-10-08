-- Reconcile production branding RPC with the actual branding_settings schema.
-- Production drift left the RPC using stale column names (org_name, muted_color).
-- Keep the Edge Function's current parameter names and service_role-only ACL.

drop function if exists public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid
);

create function public.ylp_branding_update_v1(
  p_org_name text,
  p_tagline text,
  p_logo_url text,
  p_favicon_url text,
  p_primary_color text,
  p_accent_color text,
  p_sidebar_color text,
  p_page_background text,
  p_card_background text,
  p_text_color text,
  p_muted_color text,
  p_footer_text text,
  p_login_welcome_title text,
  p_login_welcome_description text,
  p_login_welcome_button_text text,
  p_scan_background_color text,
  p_scan_logo_url text,
  p_updated_by uuid
)
returns public.branding_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.branding_settings;
begin
  if p_org_name is null or length(trim(p_org_name)) < 1 or length(p_org_name) > 160 then
    raise exception 'Invalid organization name';
  end if;

  if p_tagline is not null and length(p_tagline) > 240 then
    raise exception 'Invalid tagline';
  end if;

  if p_logo_url is not null and (length(p_logo_url) < 1 or length(p_logo_url) > 2048) then
    raise exception 'Invalid logo URL';
  end if;

  if p_favicon_url is not null and length(p_favicon_url) > 2048 then
    raise exception 'Invalid favicon URL';
  end if;

  if p_footer_text is not null and length(p_footer_text) > 240 then
    raise exception 'Invalid footer text';
  end if;

  if p_login_welcome_title is null
     or length(trim(p_login_welcome_title)) < 1
     or length(p_login_welcome_title) > 160 then
    raise exception 'Invalid login welcome title';
  end if;

  if p_login_welcome_description is null
     or length(trim(p_login_welcome_description)) < 1
     or length(p_login_welcome_description) > 400 then
    raise exception 'Invalid login welcome description';
  end if;

  if p_login_welcome_button_text is null
     or length(trim(p_login_welcome_button_text)) < 1
     or length(p_login_welcome_button_text) > 80 then
    raise exception 'Invalid login welcome button text';
  end if;

  if p_scan_background_color is null or p_scan_background_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Invalid scan background color';
  end if;

  if p_scan_logo_url is null or length(trim(p_scan_logo_url)) < 1 or length(p_scan_logo_url) > 500 then
    raise exception 'Invalid scan logo URL';
  end if;

  if p_logo_url is not null and not (p_logo_url like '/%' or p_logo_url ~* '^https://') then
    raise exception 'Logo URL must be same-origin path or HTTPS URL';
  end if;

  if p_favicon_url is not null and not (p_favicon_url like '/%' or p_favicon_url ~* '^https://') then
    raise exception 'Favicon URL must be same-origin path or HTTPS URL';
  end if;

  if not (p_scan_logo_url like '/%' or p_scan_logo_url ~* '^https://') then
    raise exception 'Scan logo URL must be same-origin path or HTTPS URL';
  end if;

  update public.branding_settings
  set organization_name = p_org_name,
      tagline = p_tagline,
      logo_url = p_logo_url,
      favicon_url = p_favicon_url,
      primary_color = p_primary_color,
      accent_color = p_accent_color,
      sidebar_color = p_sidebar_color,
      page_background = p_page_background,
      card_background = p_card_background,
      text_color = p_text_color,
      muted_text_color = p_muted_color,
      footer_text = p_footer_text,
      login_welcome_title = p_login_welcome_title,
      login_welcome_description = p_login_welcome_description,
      login_welcome_button_text = p_login_welcome_button_text,
      scan_background_color = p_scan_background_color,
      scan_logo_url = p_scan_logo_url,
      updated_by = p_updated_by,
      updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid
) to service_role;
