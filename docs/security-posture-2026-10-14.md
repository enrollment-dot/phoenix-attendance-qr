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

## Sensitive RPC ACL sample

A read-only sample of privileged `public` functions, including account-management, authorization, auto-close, branding, student, session, and deletion functions, showed explicit execution ACLs restricted to `postgres` and `service_role`. The sampled functions did not list `anon` or `authenticated` as grantees.

This is a sample, not a claim that every function in the database was exhaustively audited. Continue to verify all overloads, function definitions, default privileges, and new migrations during the next full security review.

## Supabase Security Advisor

Both environments reported:

1. **Info — RLS Enabled No Policy:** nine tables. This is documented above and should be interpreted together with actual grants and the service-mediated architecture, not addressed by adding permissive policies.
2. **Warning — Leaked Password Protection Disabled:** Supabase Auth's compromised-password protection is disabled.

Enabling leaked-password protection changes an Auth security setting. No setting was changed during this audit; obtain explicit product approval and coordinate the change with authentication regression testing before enabling it.

## PR #118 verification record

PR #118, “Embed YLP logo in session QR code,” was merged on 2026-10-14 (merge commit `e771cbbf326913ed936e31cac594c8555c2db26b`). Its CI run reported `npm test` and `npm run test:browser` passing. The user supplied Production screenshots confirming the session title, subtitle, centered YLP logo, and the QR landing page. The user subsequently reported that a new Production session test worked end-to-end, including the attendance flow and report.

Note: deployment status checks reported success for the Vercel Staging and Production projects, but direct verification of the custom production domain's exact deployment mapping was not available from the assistant's Vercel connector. Production behavior is therefore recorded from user-provided screenshots and test confirmation rather than an independently queried deployment mapping.

## Change log

- This is documentation-only; no database, RLS, Auth, environment variable, Edge Function, or production data was changed by this audit.
