alter table public.students
  add column if not exists email text;

alter table public.students
  drop constraint if exists students_email_format_check;

alter table public.students
  add constraint students_email_format_check
  check (
    email is null
    or (
      char_length(email) <= 254
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
    )
  );

drop function if exists public.ylp_student_create_v1(text,text);
drop function if exists public.ylp_student_update_v1(text,text);

create or replace function public.ylp_students_v1()
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', s.student_id,
        'name', s.name,
        'email', s.email,
        'active', s.active,
        'enrolled_from', s.enrolled_from,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      ) order by s.student_id
    ),
    '[]'::jsonb
  )
  from public.students s;
$function$;

create or replace function public.ylp_student_create_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date default current_date,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id text := pg_catalog.btrim(coalesce(p_student_id,''));
  v_name text := pg_catalog.btrim(coalesce(p_name,''));
  v_email text := nullif(pg_catalog.btrim(coalesce(p_email,'')), '');
  v_date date := coalesce(p_enrolled_from,current_date);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
begin
  if v_id='' or pg_catalog.length(v_id)>40 or v_id !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok',false,'error','Student ID may contain letters, numbers, _ and -.');
  end if;
  if v_name='' or pg_catalog.length(v_name)>100 or v_name ~ '[[:cntrl:]\\x7f]' then
    return jsonb_build_object('ok',false,'error','Invalid student name.');
  end if;
  if v_email is not null and (pg_catalog.length(v_email)>254 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$') then
    return jsonb_build_object('ok',false,'error','Invalid student email.');
  end if;
  if exists(select 1 from public.students where student_id=v_id) then
    return jsonb_build_object('ok',false,'code','student_exists','error','Student ID already exists.');
  end if;
  insert into public.students(student_id,name,email,active,enrolled_from,created_at,updated_at)
  values(v_id,v_name,v_email,true,v_date,v_now,v_now)
  returning * into v_row;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'student_id',v_row.student_id,'name',v_row.name,'email',v_row.email,'active',v_row.active,
    'enrolled_from',v_row.enrolled_from,'created_at',v_row.created_at,'updated_at',v_row.updated_at
  ));
end;
$function$;

create or replace function public.ylp_student_update_v1(
  p_student_id text,
  p_name text,
  p_enrolled_from date default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id text := pg_catalog.btrim(coalesce(p_student_id,''));
  v_name text := pg_catalog.btrim(coalesce(p_name,''));
  v_email text := nullif(pg_catalog.btrim(coalesce(p_email,'')), '');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
begin
  if v_id='' or pg_catalog.length(v_id)>40 or v_id !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok',false,'error','Student ID may contain letters, numbers, _ and -.');
  end if;
  if v_name='' or pg_catalog.length(v_name)>100 or v_name ~ '[[:cntrl:]\\x7f]' then
    return jsonb_build_object('ok',false,'error','Invalid student name.');
  end if;
  if v_email is not null and (pg_catalog.length(v_email)>254 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$') then
    return jsonb_build_object('ok',false,'error','Invalid student email.');
  end if;
  update public.students
  set name=v_name,email=v_email,enrolled_from=coalesce(p_enrolled_from,enrolled_from),updated_at=v_now
  where student_id=v_id
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok',false,'code','student_not_found','error','Student not found.');
  end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'student_id',v_row.student_id,'name',v_row.name,'email',v_row.email,'active',v_row.active,
    'enrolled_from',v_row.enrolled_from,'created_at',v_row.created_at,'updated_at',v_row.updated_at
  ));
end;
$function$;