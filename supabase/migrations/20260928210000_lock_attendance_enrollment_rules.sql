alter table public.students
  add column if not exists enrolled_from date;

update public.students
set enrolled_from = (created_at at time zone 'Asia/Bangkok')::date
where enrolled_from is null;

alter table public.students
  alter column enrolled_from set default current_date;

alter table public.students
  alter column enrolled_from set not null;

comment on column public.students.enrolled_from is
  'First program date from which this student is eligible for attendance calculation.';

create or replace function public.ylp_student_create_v1(p_student_id text, p_name text, p_enrolled_from date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id text:=pg_catalog.btrim(coalesce(p_student_id,''));
  v_name text:=pg_catalog.btrim(coalesce(p_name,''));
  v_date date:=coalesce(p_enrolled_from,current_date);
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
begin
  if v_id='' or pg_catalog.length(v_id)>40 or v_id !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok',false,'error','Student ID may contain letters, numbers, _ and -.');
  end if;
  if v_name='' or pg_catalog.length(v_name)>100 or v_name ~ '[[:cntrl:]\\x7f]' then
    return jsonb_build_object('ok',false,'error','Invalid student name.');
  end if;
  if v_date is null then
    return jsonb_build_object('ok',false,'error','Enrollment date is required.');
  end if;
  if exists(select 1 from public.students where student_id=v_id) then
    return jsonb_build_object('ok',false,'code','student_exists','error','Student ID already exists.');
  end if;
  insert into public.students(student_id,name,active,enrolled_from,created_at,updated_at)
  values(v_id,v_name,true,v_date,v_now,v_now)
  returning * into v_row;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'student_id',v_row.student_id,'name',v_row.name,'active',v_row.active,
    'enrolled_from',v_row.enrolled_from,'created_at',v_row.created_at,'updated_at',v_row.updated_at
  ));
end;
$function$;

create or replace function public.ylp_student_update_v1(p_student_id text, p_name text, p_enrolled_from date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id text:=pg_catalog.btrim(coalesce(p_student_id,''));
  v_name text:=pg_catalog.btrim(coalesce(p_name,''));
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_row public.students%rowtype;
begin
  if v_id='' or pg_catalog.length(v_id)>40 or v_id !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok',false,'error','Student ID may contain letters, numbers, _ and -.');
  end if;
  if v_name='' or pg_catalog.length(v_name)>100 or v_name ~ '[[:cntrl:]\\x7f]' then
    return jsonb_build_object('ok',false,'error','Invalid student name.');
  end if;
  update public.students
  set name=v_name,
      enrolled_from=coalesce(p_enrolled_from,enrolled_from),
      updated_at=v_now
  where student_id=v_id
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok',false,'code','student_not_found','error','Student not found.');
  end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'student_id',v_row.student_id,'name',v_row.name,'active',v_row.active,
    'enrolled_from',v_row.enrolled_from,'created_at',v_row.created_at,'updated_at',v_row.updated_at
  ));
end;
$function$;

create or replace function public.ylp_students_v1()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'student_id',s.student_id,
      'name',s.name,
      'active',s.active,
      'enrolled_from',s.enrolled_from,
      'created_at',s.created_at,
      'updated_at',s.updated_at
    ) order by s.student_id
  ),
  '[]'::jsonb
)
from public.students s;
$function$;