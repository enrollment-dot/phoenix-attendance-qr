-- Disposable PostgreSQL fixture for the Student Delete RPC migration test.
-- This runs only in the CI PostgreSQL service, never in Supabase environments.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

drop table if exists public.scan_receipts;
drop table if exists public.attendance;
drop table if exists public.students;

create table public.students (
  student_id text primary key,
  name text not null
);
create table public.attendance (
  id bigint generated always as identity primary key,
  student_id text not null,
  session_id text
);
create table public.scan_receipts (
  id bigint generated always as identity primary key,
  student_id text not null,
  session_id text
);

insert into public.students (student_id, name) values ('STU-DELETE-TEST', 'Disposable Test Student');
insert into public.attendance (student_id, session_id) values ('STU-DELETE-TEST', 'SESSION-TEST');
insert into public.scan_receipts (student_id, session_id) values ('STU-DELETE-TEST', 'SESSION-TEST');
