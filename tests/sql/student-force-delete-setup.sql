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
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  enrolled_from date not null default current_date,
  email text
);
create table public.attendance (
  attendance_id text primary key,
  session_id text not null,
  student_id text not null,
  student_name text not null,
  scan_in timestamptz,
  scan_out timestamptz,
  duration_minutes integer,
  status text not null default 'present',
  legacy_reference boolean not null default false,
  legacy_reason text,
  version bigint not null default 1
);
create table public.scan_receipts (
  request_id uuid primary key,
  attendance_id text not null,
  session_id text not null,
  student_id text not null,
  direction text not null,
  fingerprint text not null,
  receipt_json jsonb not null,
  created_at timestamptz not null default now()
);

insert into public.students (student_id, name) values ('STU-DELETE-TEST', 'Disposable Test Student');
insert into public.attendance (attendance_id, session_id, student_id, student_name, status)
values ('ATT-DELETE-TEST', 'SESSION-TEST', 'STU-DELETE-TEST', 'Disposable Test Student', 'present');
insert into public.scan_receipts (request_id, attendance_id, session_id, student_id, direction, fingerprint, receipt_json)
values ('00000000-0000-0000-0000-000000000001', 'ATT-DELETE-TEST', 'SESSION-TEST', 'STU-DELETE-TEST', 'in', 'delete-test-fingerprint', '{}'::jsonb);
