# Session Auto-Close Scheduler Design

Status: implementation exists in GitHub Actions and the deployed `ylp-api`; positive-path execution is not yet fully verified. This document retains the original design rationale, with the current implementation status recorded below.

## Implementation status — 2026-10-14

- GitHub Actions contains a Staging scheduler workflow scheduled every 15 minutes and a separate manually triggered negative-auth regression workflow.
- The Staging negative-auth workflow passed for missing and invalid scheduler secrets. This verifies rejection only; it does not verify valid-secret execution or successful closure of an eligible session.
- Staging and Production `ylp-api` deployments both contain the `schedulerAutoClose` action, validate `x-ylp-scheduler-secret`, and call `ylp_auto_close_sessions_v1` only after the secret check passes.
- The live migration ledgers record the scheduler under environment-specific versions: Staging `20261012052803`, Production `20261013174134`. The repository contains two similar scheduler migration files with different ACL assertion/grant details; do not replay either migration as part of documentation reconciliation.
- At the latest read-only inventory, both environments had zero active sessions, so there was no eligible session available to verify the automatic-close success path without a controlled Staging fixture.
- Production SQL, configuration, and attendance data were not changed during this verification.

## Goal

Automatically close sessions after their existing attendance scan grace period, without changing attendance policy or granting normal users additional authority.

## Existing behavior verified during audit

- Session creation starts sessions with status `active`.
- `ylp_close_session_v1(p_session_id)` is idempotent and only executable by `postgres` and `service_role`.
- Scanning requires an active session and uses the configured window from 30 minutes before session start through 15 minutes after session end.
- A GitHub Actions scheduler workflow now exists; verify its successful scheduled runs separately from Edge Function RPC logs.
- Existing session close actions are admin-authorized; a scheduler must not impersonate a browser admin or weaken that authorization.

## Database facts verified in both staging and production

The `public.sessions` table has these scheduling fields: `session_id text`, `scheduled_date date`, `start_time_local time without time zone`, `end_time_local time without time zone`, and `status text`. The scan RPC converts local schedule values with `AT TIME ZONE 'Asia/Bangkok'` and reads the configured close window from `public.settings`.

Therefore the eligibility boundary must use the same conversion as scanning:

```sql
(scheduled_date + end_time_local) AT TIME ZONE 'Asia/Bangkok'
  + interval '15 minutes' <= clock_timestamp()
```

This is a design expression, not an executed statement or migration. Keep the existing settings and use the audited +07:00 / Asia-Bangkok behavior; do not use the Edge Function host's local timezone.

## Design rationale and expected behavior

Use a scheduled GitHub Actions workflow as the trigger and a dedicated server-to-server action handled by `ylp-api`. Keep the trigger separate from ordinary user-facing session actions.

1. Run on a modest schedule (for example, every 5 minutes) and support manual dispatch for controlled staging tests.
2. Authenticate the trigger with a dedicated high-entropy secret stored as GitHub Actions secret and Supabase Edge Function secret. Never put service-role credentials in GitHub Actions or browser code.
3. Add a dedicated scheduler action; do not reuse the general user `closeSession` action and do not accept arbitrary session IDs from the trigger.
4. Server-side logic must identify only sessions that are still `active` and whose scheduled end plus the existing 15-minute grace period has elapsed, using the configured `+07:00` business timezone semantics.
5. Close eligible sessions through the existing idempotent close RPC. Repeated scheduler runs must be safe.
6. Bound each run and return counts for eligible, closed, skipped, and failed sessions without exposing student data or secrets.
7. Reject missing/invalid secrets with a generic unauthorized response; compare secrets safely and avoid logging them.
8. Add regression tests for authentication failure, arbitrary-session-ID rejection, grace-period boundary, timezone handling, idempotency, and ensuring regular operator/admin endpoints cannot invoke the scheduler action.
9. Deploy to staging first and verify boundary cases before enabling the production workflow.

## Important implementation decision

The current close RPC accepts one session ID. The scheduler must not query sessions and close them through a public unauthenticated path. Before production enablement, choose and review one safe server-side implementation:

- Prefer a narrowly scoped database function that atomically selects and closes only eligible active sessions, using `FOR UPDATE SKIP LOCKED` or equivalent concurrency protection, callable only by `service_role`/ `postgres`; or
- Use a server-side query to select eligible sessions and call the existing RPC for each, provided the server-side adapter and function permissions support this without widening database grants.

The first option reduces race conditions and centralizes eligibility rules, but requires a schema/security change and a migration. Such a change requires explicit production approval under project policy.

## Out of scope

- Do not manually close or alter existing production sessions.
- Do not change `timezone_offset = +07:00`, `open_minutes = 30`, or `close_minutes = 15`.
- Do not change scan-in/scan-out behavior or role permissions.
- Do not expose the service-role key to clients.
- Do not enable production scheduling until staging tests and production configuration review pass.

## Implementation safeguards

- The database operation must select candidates itself; the caller must not submit a `session_id` list.
- Candidate selection and status transition should be atomic to avoid a race with scans or manual session closure.
- Keep the existing `ylp_close_session_v1` RPC behavior unchanged for normal authorized user actions.
- The new scheduler-only RPC must have explicit ACL verification in the migration and tests proving `anon` and `authenticated` cannot execute it.
- Do not add an unrestricted REST table query or grant direct table access to make scheduling easier.

## Acceptance criteria

- A session remains active until its scheduled end plus 15 minutes.
- A session past that boundary is closed automatically on the next successful scheduler run.
- Sessions already closed are left unchanged.
- Invalid scheduler credentials cause no database writes.
- The scheduler cannot close a caller-selected session outside the eligibility rule.
- Existing attendance, RBAC, and destructive-action regression tests continue to pass.
- Production enablement is separately approved and verified.
