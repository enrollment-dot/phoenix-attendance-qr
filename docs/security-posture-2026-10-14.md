# Security Posture Audit — 2026-10-14

## Scope

Read-only verification of the Supabase Production and Staging databases after PR #118 (branded session QR) was merged. This document records observed state; it does not change database configuration.

- Production project: `fsxdsdixxnslismxghfz`
- Staging project: `yvtgwzvjpztvztozcfir`
- Repository: `enrollment-dot/phoenix-attendance-qr`
- Audit date: 2026-10-14

## RLS and table grants

The following nine `public` tables were found in both environments:

- `admin_profiles`
- `api_rate_limit_counters`
- `attendance`
- `branding_settings`
- `scan_receipts`
- `session_creation_receipts`
- `sessions`
- `settings`
- `students`

Observed in both Production and Staging:

- Row Level Security (RLS) is enabled on all nine tables.
- No RLS policies exist on these nine tables.
- The queried table grants list showed `service_role` privileges only; no grants to `anon`, `authenticated`, or `PUBLIC` were returned.
- Explicit checks for `anon` and `authenticated` SELECT privileges on `students`, `attendance`, and `sessions` returned `false`.

### Interpretation

The absence of policies is consistent with the current server-mediated architecture **only while direct client roles remain unable to access these tables** and the Edge Function authorizes every operation before using the service role. With RLS enabled and no policies, ordinary client-role queries are denied by default; the service role bypasses RLS and therefore must remain server-side only.

Do not add broad RLS policies merely to clear the Supabase advisory. Do not expose service-role credentials to browsers. If the architecture changes to direct client-table access, design least-privilege policies per table and role, then add regression tests before rollout.

## Function ACL and default-privilege findings

A full read-only inventory of functions in the `public` schema found a Production/Staging difference:

- Most application RPCs in both environments have explicit execution ACLs limited to `postgres` and `service_role`; direct `EXECUTE` checks for `anon` and `authenticated` return false for those functions.
- In Production, three non-`SECURITY DEFINER`, immutable helper functions are directly executable by `anon` and `authenticated`:
  - `ylp_advisory_key_v1(text, text)` — computes a deterministic hash from supplied strings.
  - `ylp_is_uuid_v4_v1(uuid)` — validates a UUID v4-shaped value.
  - `ylp_scan_rejection_v1(text, text)` — builds a rejection JSON object from supplied strings.
- These same functions have explicit ACLs restricted to `postgres` and `service_role` in Staging.
- The function definitions use an empty `search_path` and catalog-qualified built-ins. The reviewed definitions do not directly read attendance/student tables or mutate data. The observed direct execute grants are therefore a least-privilege inconsistency, not by themselves evidence of data exposure or an exploitable vulnerability.
- Default ACL entries for functions created by both `postgres` and `supabase_admin` in the `public` schema include `EXECUTE` grants for `anon` and `authenticated` in both environments. This can grant client execution to newly created functions unless each migration explicitly sets restrictive ACLs. Production's three helper grants demonstrate why defaults and per-function ACLs must both be reviewed.

### Required follow-up (not applied)

1. Compare the historical migrations and actual function ACLs to identify why Production has these grants while Staging does not.
2. Prepare a migration that explicitly revokes client execution from the identified helpers and corrects applicable `public`-schema function default privileges for the relevant object owners, while retaining `postgres` and `service_role` execution.
3. Review all existing functions affected by the intended default-privilege policy and test Edge Function/RPC flows in Staging.
4. Apply no database permission or default-privilege changes until the required explicit approval for a security-policy change is obtained.

No function ACL, default privilege, schema, or database setting was changed by this read-only audit.

## Supabase Security Advisor

Both environments reported:

1. **Info — RLS Enabled No Policy:** nine tables. This is documented above and should be interpreted together with actual grants and the service-mediated architecture, not addressed by adding permissive policies.
2. **Warning — Leaked Password Protection Disabled:** Supabase Auth's compromised-password protection is disabled. The projects are on the Supabase Free Plan, and this control is being recorded as a plan/configuration limitation for the current setup.

No Auth setting was changed. Do not upgrade the plan or attempt to enable this control solely to clear the advisory. Revisit only if plan eligibility or product requirements change.

## PR #118 verification record

PR #118, “Embed YLP logo in session QR code,” was merged on 2026-10-14 (merge commit `e771cbbf326913ed936e31cac594c8555c2db26b`). Its CI run reported `npm test` and `npm run test:browser` passing. The user supplied Production screenshots confirming the session title, subtitle, centered YLP logo, and the QR landing page. The user subsequently reported that a new Production session test worked end-to-end, including the attendance flow and report.

Note: deployment status checks reported success for the Vercel Staging and Production projects, but direct verification of the custom production domain's exact deployment mapping was not available from the assistant's Vercel connector. Production behavior is therefore recorded from user-provided screenshots and test confirmation rather than an independently queried deployment mapping.

## Architecture and trust boundaries

Observed application path:

`Browser frontend` → configured `VITE_API_URL` → Supabase Edge Function `ylp-api` → PostgreSQL RPCs/tables and Supabase Auth.

The frontend's `src/api.js` sends `{ action, payload, token }` to the configured API endpoint. It does not hardcode a database endpoint or contain a service-role credential. The Edge Function is deployed with platform JWT verification disabled (`verify_jwt=false`) because the handler implements custom token verification; therefore the custom JWT verification and action-level authorization are critical controls and must remain regression-tested. The server-side function source verifies JWT signature/claims, checks the active profile through `ylp_authorize_admin_v1`, and applies role allowlists before protected actions.

The service-role key is used only in the Edge Function's server-side backend adapter. Never move it into Vite environment variables or frontend bundles. Browser-side Supabase publishable/anon keys are not equivalent to service-role credentials and must not grant direct access to the protected public tables.

## Public schema inventory and relationships

The nine public tables observed in both environments are `admin_profiles`, `api_rate_limit_counters`, `attendance`, `branding_settings`, `scan_receipts`, `session_creation_receipts`, `sessions`, `settings`, and `students`.

Key relationships observed from Staging schema metadata:

- `admin_profiles.admin_id` references `auth.users.id`.
- `attendance.session_id` references `sessions.session_id`.
- `scan_receipts.session_id` references `sessions.session_id`; `scan_receipts.attendance_id` references `attendance.attendance_id`.
- `session_creation_receipts.session_id` references `sessions.session_id`.
- `attendance.student_id` intentionally has no foreign key to `students.student_id`, because historical attendance imports can contain unresolved student references. Do not invent an Auth-UID/student-ID relationship or add a foreign key without an explicit data migration plan.
- `sessions` stores QR token hashes and encrypted QR token/access-code material; do not expose those columns to clients directly.

The live Staging schema reports four BEFORE UPDATE timestamp triggers: `admin_profiles_set_updated_at`, `sessions_set_updated_at`, `settings_set_updated_at`, and `students_set_updated_at`, each calling `set_updated_at()`. Production reported zero public-schema triggers at audit time. This is a verified schema difference that can affect `updated_at` maintenance; reconcile it against repository migrations and intended behavior before proposing any change. It is not automatically a vulnerability. Neither environment reported public views in the catalog query.

## Authentication and RBAC inventory

Roles are `super_admin`, `admin`, and `operator`. The current Edge Function source enforces the following action gates before calling the service-role backend:

- All active authorized roles: login-authenticated dashboard/report/session operations, logout, normal session creation/closing, and scan-related service paths as applicable.
- `super_admin` and `admin`: list/create/update/activate/deactivate Students.
- `super_admin` only: delete Student; read/update branding; list/create/update/remove Accounts; delete Session.
- Student deletion and session deletion require fresh username/password re-authentication and verification that the re-authenticated identity matches the current Super Admin identity. Preserve rate limiting and same-account checks.
- Operator must not access Student management or Accounts and must not perform destructive actions. Keep authorization in the Edge Function; frontend hiding is not a security boundary.
- Only `super_admin` may delete a closed session. This is a required invariant for both code and regression tests.

These role gates are based on the currently retrieved Production and Staging `ylp-api` source. Production reports Edge Function version 43 and Staging version 50; their deployed source hashes differ. A direct comparison of retrieved deployed files found `index.ts` and `types.ts` byte-for-byte identical, while `cors.js` differs (Production content length 1,030 bytes; Staging 1,040 bytes). Thus the main action/auth implementation matches, but the CORS configuration is intentionally or historically different and must be reviewed before any release. Function metadata reports `verify_jwt=false` in both environments; custom JWT verification in `ylp-api` is therefore a critical control.

## RLS and database permission interpretation

The current catalog query confirms nine public tables with RLS enabled and zero policies in each environment. No `anon`, `authenticated`, or `PUBLIC` table grants were found for those public tables. This is a service-mediated design, not a recommendation to create permissive policies. RLS is not forced on table owners, and service-role/owner/SECURITY DEFINER paths must be assessed separately.

Production has three public helper functions executable by `anon` and `authenticated`: `ylp_advisory_key_v1(text,text)`, `ylp_is_uuid_v4_v1(uuid)`, and `ylp_scan_rejection_v1(text,text)`. They are not SECURITY DEFINER functions; reviewed definitions use an empty `search_path` and catalog-qualified built-ins and do not directly access protected attendance/student tables or mutate data. Staging restricts these helpers to `postgres` and `service_role`. Record this as a least-privilege inconsistency; current evidence does not demonstrate direct data exposure from these helpers.

Both environments' default ACL inventory includes `EXECUTE` for `anon` and `authenticated` for public-schema functions created by `postgres` and `supabase_admin`. This is a forward-looking risk: newly created functions may inherit client execution unless a migration explicitly revokes it. Review all function overloads and migration ACL statements before changing default privileges; do not apply a blanket ACL change without enumerating its effect on existing and future functions.

## Migration drift and unresolved architecture documentation

Read-only Supabase migration histories differ: Production has 28 recorded migration entries and Staging has 21, and their initial histories/versions are not identical. Treat this as known migration drift, not proof that the current schema is unsafe. Compare repository migrations, both histories, and actual functions/constraints/triggers before planning reconciliation. Never fake migration history, reorder/squash historical migrations casually, or recreate either database.

The current `README.md` still describes an older Google Apps Script / Google Sheets backend, while the live deployed application path observed in this audit is Vercel frontend → Supabase `ylp-api` → PostgreSQL RPCs. This is a documentation inconsistency requiring a source-of-truth review; do not infer that README text represents the live Production backend and do not rewrite it until all current deployment configuration is reconciled.

## Staging security verification plan (not yet executed as a new audit test suite)

After approval of a specific remediation, verify in Staging only:

1. Direct REST/RPC table access as `anon` and an ordinary `authenticated` user is denied for `students`, `attendance`, `sessions`, and other protected tables.
2. `ylp-api` rejects missing, invalid, expired, or mismatched JWT/session claims for every protected action.
3. `operator` cannot list or mutate Students, access Accounts, delete Students, or delete Sessions; `admin` cannot access Accounts or perform destructive deletes; `super_admin` can use authorized management flows.
4. Only `super_admin` can delete a closed session, with fresh credential re-authentication, same-account verification, and rate limiting. Test mismatched-account and invalid-credential denial without repeatedly retrying a real account.
5. QR public session resolution, Scan In/Out, idempotent retries, attendance reports, CSV export, session close/auto-close, and password recovery continue to work.
6. Verify the resulting function ACLs, default ACLs, RLS flags/policies, trigger definitions, and migration history by read-only catalog queries after any approved Staging migration.
7. Run `npm test`, `npm run test:browser`, and targeted security/RBAC regression tests. Record actual CI/run identifiers; do not mark a test complete merely because a plan exists.

## Release and rollback requirements

- No Production database, function, Auth, environment-variable, or Vercel deployment change is authorized by this audit.
- A future approved remediation must have a focused migration/PR, reviewed diff, passing CI, and a Staging-only rollout first.
- Before a Production release, require separate explicit approval, review Production migration drift and expected ACL impact, preserve the current migration history, and capture pre/post read-only catalog evidence.
- Rollback must be a reviewed forward migration that restores only the exact prior privileges/configuration where safe; do not blindly restore broad default EXECUTE grants or reverse a migration if application behavior/data dependencies have changed. If a function rollback is needed, redeploy a previously reviewed known-good function version only with separate approval.
- Confirm the deployment and actual Production behavior independently; a successful Vercel status check alone does not prove custom-domain deployment mapping or database parity.

## Change log

- This is documentation-only; no database, RLS, Auth, environment variable, Edge Function, function ACL, default privilege, or production data was changed by this audit.
- Clarified the leaked-password protection advisory as a Supabase Free Plan limitation/configuration note; no plan or Auth setting changes are requested or made.
- Added read-only function ACL/default-privilege comparison and recorded the required approval-gated follow-up.
