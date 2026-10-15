# Session Auto-Close Scheduler Design

Status: scheduler implementation exists on `main`. This document preserves design rationale; GitHub workflow presence and deployment metadata do not, by themselves, prove that scheduled executions are succeeding in both environments.

## Goal

Automatically close sessions after their existing attendance scan grace period, without changing attendance policy or granting normal users additional authority.

## Existing behavior verified during audit

- Session creation starts sessions with status `active`.
- `ylp_close_session_v1(p_session_id)` is idempotent and only executable by `postgres` and `service_role`.
- Scanning requires an active session and uses the configured window from 30 minutes before session start through 15 minutes after session end.
- Scheduled GitHub Actions workflows exist for Staging and Production at `.github/workflows/session-auto-close-staging.yml` and `.github/workflows/session-auto-close-production.yml`. Both are configured for every 15 minutes and manual dispatch.
- Workflow check runs on `main` have reported success, but that is not sufficient evidence that cron-triggered runs are succeeding independently in both environments. Verify actual workflow-run history before claiming scheduled production operation.
- Existing session close actions are admin-authorized; the scheduler uses a dedicated server-to-server action and must not impersonate a browser admin or weaken that authorization.

## Database facts verified in both staging and production

The `public.sessions` table has these scheduling fields: `session_id text`, `scheduled_date date`, `start_time_local time without time zone`, `end_time_local time without time zone`, and `status text`. The scan RPC converts local schedule values with `AT TIME ZONE 'Asia/Bangkok'` and reads the configured close window from `public.settings`.

Therefore the eligibility boundary must use the same conversion as scanning:

```sql
(scheduled_date + end_time_local) AT TIME ZONE 'Asia/Bangkok'
  + interval '15 minutes' <= clock_timestamp()
```

This is a design expression, not an executed statement or migration. Keep the existing settings and use the audited +07:00 / Asia-Bangkok behavior; do not use the Edge Function host's local timezone.

## Implemented trigger and safety design

The repository contains separate scheduled GitHub Actions workflows for Staging and Production. They use distinct GitHub environments/secrets, validate that the endpoint matches the expected Supabase project, call `ylp-api` with the dedicated `x-ylp-scheduler-secret`, and validate the response shape. The workflows run every 15 minutes and support manual dispatch.

The scheduler database operation is implemented as a narrowly scoped function that selects only eligible active sessions, batches work, uses `FOR UPDATE SKIP LOCKED`, and updates session status. Its execute permissions must remain restricted to trusted backend roles. The Edge Function uses a dedicated scheduler action rather than accepting arbitrary session IDs from the trigger.

The following safeguards remain acceptance requirements for verification:

1. Use a dedicated high-entropy secret stored as a GitHub Actions secret and Supabase Edge Function secret. Never put service-role credentials in GitHub Actions or browser code.
2. Do not accept arbitrary session IDs from the scheduler trigger.
3. Select only sessions that are still `active` and whose scheduled end plus the existing 15-minute grace period has elapsed, using the configured `+07:00` business timezone semantics.
4. Make repeated scheduler runs safe and bound each run.
5. Return counts without exposing student data or secrets.
6. Reject missing/invalid scheduler credentials with a generic unauthorized response; compare secrets safely and avoid logging them.
7. Maintain regression coverage for authentication failure, arbitrary-session-ID rejection, grace-period boundary, timezone handling, idempotency, and ensuring regular operator/admin endpoints cannot invoke the scheduler action.
8. Verify actual scheduled runs separately for Staging and Production. Do not infer cron success from a successful static/test check alone.

## Database implementation safeguards

- Candidate selection and status transition should be atomic to avoid a race with scans or manual session closure.
- Keep the existing `ylp_close_session_v1` RPC behavior unchanged for normal authorized user actions.
- The scheduler-only RPC must have explicit ACL verification in the migration and tests proving `anon` and `authenticated` cannot execute it.
- Do not add an unrestricted REST table query or grant direct table access to make scheduling easier.

## Out of scope

- Do not manually close or alter existing production sessions.
- Do not change `timezone_offset = +07:00`, `open_minutes = 30`, or `close_minutes = 15`.
- Do not change scan-in/scan-out behavior or role permissions.
- Do not expose the service-role key to clients.
- Any future production schema/security change or deployment remains subject to separate approval and verification.

## Acceptance criteria

- A session remains active until its scheduled end plus 15 minutes.
- A session past that boundary is closed automatically on the next successful scheduler run.
- Sessions already closed are left unchanged.
- Invalid scheduler credentials cause no database writes.
- The scheduler cannot close a caller-selected session outside the eligibility rule.
- Existing attendance, RBAC, and destructive-action regression tests continue to pass.
- Actual scheduled-run evidence is recorded independently for Staging and Production.
- Production behavior is claimed as verified only after relevant production evidence is available.
