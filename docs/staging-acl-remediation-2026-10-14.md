# Staging Function ACL Remediation — 2026-10-14

## Scope and approval

This is the follow-up record for the user-approved Staging-only remediation in Supabase project `yvtgwzvjpztvztozcfir`. Production project `fsxdsdixxnslismxghfz` was not modified.

## Applied change

Staging migration recorded by Supabase as:

`20261014052752_restrict_public_function_default_execute`

The migration:
- Revokes default function `EXECUTE` from `anon` and `authenticated` for functions created by role `postgres` in schema `public`.
- Revokes direct `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` on `public.ylp_advisory_key_v1(text,text)`, `public.ylp_is_uuid_v4_v1(uuid)`, and `public.ylp_scan_rejection_v1(text,text)`.
- Explicitly retains `service_role` execution on those three helpers.

Post-migration read-only catalog verification found:
- All three helpers: `anon` EXECUTE = false; `authenticated` EXECUTE = false; `service_role` EXECUTE = true.
- `postgres` default function ACL in `public`: no `anon` or `authenticated` EXECUTE grants.
- No existing public-schema functions were executable by `anon` or `authenticated` in Staging.
- Staging migration history contains the applied migration.

## Remaining limitation

The `supabase_admin`-owned default function ACL in schema `public` still grants `EXECUTE` to `anon` and `authenticated`. An attempt to change it through the available Supabase migration connection failed with PostgreSQL error `42501: permission denied to change default privileges`. The connection reports `current_user = postgres`, but is not authorized to alter default privileges for `supabase_admin`.

Do not attempt to bypass this by granting role membership, changing platform roles, or broadening privileges. Investigate a supported privileged path or explicitly set restrictive ACLs in every migration that creates public functions owned by `supabase_admin`. This is a forward-looking least-privilege issue; current catalog checks do not show any Staging public functions executable by client roles.

## Migration filename reconciliation

The initial repository migration filename used version `20261014130000`, but Supabase recorded the applied migration as `20261014052752`. A follow-up repository-only PR renames the file to match the actual Staging migration version so CLI history will not treat the same migration as a second unapplied version. It does not apply SQL again or change the database.

## Validation

- Staging post-change catalog checks: passed for the three helper functions and `postgres` default ACL.
- Staging migration history: applied migration present.
- GitHub Actions for PR #121: `Test` passed; `Session Auto-Close PostgreSQL Regression` passed.
- Vercel staging and production status checks for the merged migration commit reported success. These statuses are not proof of custom-domain mapping or an end-to-end attendance smoke test.
- Supabase Security Advisor still reports nine RLS-enabled tables with no policies and leaked-password protection disabled. The no-policy state is intentional for the server-mediated design while client table grants remain absent; do not add broad policies to silence the advisory. Leaked-password protection remains a Free Plan limitation/configuration item.

## Production safety

No Production SQL, migration, ACL, RLS, Auth, Edge Function, environment variable, or attendance data was changed. Any Production security remediation still requires separate explicit approval.
