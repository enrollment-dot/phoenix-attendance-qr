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

## Change log

- This is documentation-only; no database, RLS, Auth, environment variable, Edge Function, function ACL, default privilege, or production data was changed by this audit.
- Clarified the leaked-password protection advisory as a Supabase Free Plan limitation/configuration note; no plan or Auth setting changes are requested or made.
- Added read-only function ACL/default-privilege comparison and recorded the required approval-gated follow-up.
