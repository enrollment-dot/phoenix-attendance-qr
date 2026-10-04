-- Extend super-admin appearance branding to cover the public login welcome panel.
-- Production application requires explicit approval before applying this migration.

alter table public.branding_settings
  add column if not exists login_welcome_title text not null
    default 'Joining a Young Leadership Program cohort?',
  add column if not exists login_welcome_description text not null
    default 'Open the QR shared by your facilitator. Choose Scan In when you arrive and Scan Out when you leave.',
  add column if not exists login_welcome_button_text text not null
    default 'Scan a cohort QR';

drop function if exists public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, uuid
);

create or replace function public.ylp_branding_update_v1(
  p_organization_name text,
  p_tagline text,
  p_logo_url text,
  p_favicon_url text,
  p_primary_color text,
  p_accent_color text,
  p_sidebar_color text,
  p_page_background text,
  p_card_background text,
  p_text_color text,
  p_muted_text_color text,
  p_footer_text text,
  p_login_welcome_title text,
  p_login_welcome_description text,
  p_login_welcome_button_text text,
  p_updated_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_updated_by is null then
    raise exception 'updated_by is required';
  end if;

  if length(trim(p_organization_name)) not between 1 and 120
     or length(trim(p_tagline)) not between 1 and 160
     or length(trim(p_logo_url)) not between 1 and 500
     or length(coalesce(trim(p_favicon_url), '')) > 500
     or length(trim(p_footer_text)) > 240
     or length(trim(p_login_welcome_title)) not between 1 and 160
     or length(trim(p_login_welcome_description)) not between 1 and 400
     or length(trim(p_login_welcome_button_text)) not between 1 and 80 then
    raise exception 'Invalid branding text or asset URL';
  end if;

  if trim(p_logo_url) !~ '^(/[^/]|https://)'
     or (nullif(trim(coalesce(p_favicon_url, '')), '') is not null
         and trim(p_favicon_url) !~ '^(/[^/]|https://)') then
    raise exception 'Branding assets must use a same-origin path or HTTPS URL';
  end if;

  if p_primary_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_accent_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_sidebar_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_page_background !~ '^#[0-9A-Fa-f]{6}$'
     or p_card_background !~ '^#[0-9A-Fa-f]{6}$'
     or p_text_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_muted_text_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Invalid branding color';
  end if;

  update public.branding_settings
  set organization_name = trim(p_organization_name),
      tagline = trim(p_tagline),
      logo_url = trim(p_logo_url),
      favicon_url = nullif(trim(coalesce(p_favicon_url, '')), ''),
      primary_color = upper(p_primary_color),
      accent_color = upper(p_accent_color),
      sidebar_color = upper(p_sidebar_color),
      page_background = upper(p_page_background),
      card_background = upper(p_card_background),
      text_color = upper(p_text_color),
      muted_text_color = upper(p_muted_text_color),
      footer_text = trim(p_footer_text),
      login_welcome_title = trim(p_login_welcome_title),
      login_welcome_description = trim(p_login_welcome_description),
      login_welcome_button_text = trim(p_login_welcome_button_text),
      updated_at = now(),
      updated_by = p_updated_by
  where id = true
  returning to_jsonb(branding_settings.*)
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.ylp_branding_update_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid
) to service_role;
