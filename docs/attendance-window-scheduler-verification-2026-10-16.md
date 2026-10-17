# Attendance Window and Scheduler Verification — 2026-10-16

## Scope and safety

Read-only verification of Supabase Staging (`yvtgwzvjpztvztozcfir`) and Production (`fsxdsdixxnslismxghfz`). No settings, session rows, migrations, RPCs, grants, or deployments were changed by this check.

## Settings comparison

| Setting | Staging | Production | Assessment |
|---|---:|---:|---|
| `timezone_offset` | `+07:00` | `+07:00` | Matches |
| `open_minutes` | `30` | `30` | Matches |
| `close_minutes` | `120` | `15` | Confirmed environment-specific configuration; retain both values for now |

The values are read from `public.settings`. Staging's values had `updated_at = 2026-09-19T10:20:00.628453+00:00`; Production's values had `updated_at = 2026-09-22T16:31:20.906644+00:00`. Those timestamps show when the settings rows were last updated, but do not establish why the values originally differed.

**Product decision confirmed 2026-10-17:** Keep Staging `close_minutes=120` for testing and Production `close_minutes=15` for live attendance. Do not change either value as part of this audit without a new explicit product decision. This records the current approved operating choice; it does not prove the historical reason the values diverged.

The live `public.ylp_scan_v1(...)` definition in both environments reads `open_minutes`, `close_minutes`, and `timezone_offset` and enforces the scan window using those values. Thus, the configured post-session scan allowance differs. However, scans also require the session to remain `active`; the auto-close scheduler closes eligible active sessions after the end time plus 15 minutes, so the effective window also depends on scheduler timing and session state. The 120-minute setting alone does not guarantee that scanning remains possible for two hours after the session ends.

## RPC execution/security comparison

Read-only `has_function_privilege` checks for the following RPCs returned matching effective execution privileges in both environments:

- `public.ylp_auto_close_sessions_v1()`: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`; SECURITY DEFINER with `search_path=pg_catalog, public`.
- `public.ylp_close_session_v1(text)`: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`; not SECURITY DEFINER, empty `search_path`.
- `public.ylp_dashboard_v1()`: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`; SECURITY DEFINER with empty `search_path`.
- `public.ylp_scan_v1(...)`: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`; not SECURITY DEFINER, empty `search_path`.

The reviewed auto-close function in both environments closes active sessions whose Bangkok-local scheduled end time plus 15 minutes is at or before `clock_timestamp()`, updates `updated_at`, and limits each run to 100 rows with `FOR UPDATE SKIP LOCKED`. Definitions differ in formatting/casing but the reviewed logic is equivalent.

## Session state snapshot

The read-only status count returned only closed sessions at the time of inspection: Staging 15, Production 3. No active sessions were returned by the grouped status query. This is a point-in-time count, not a full attendance-data parity claim.

## Disposition / next steps

1. Retain Staging `close_minutes=120` as the approved testing configuration and Production `close_minutes=15` as the approved live configuration for now.
2. Do not modify either live setting as part of this audit; any future change requires a separate explicit product decision.
3. Continue to verify scheduled GitHub Actions runs and the session-close timestamp fix separately. CI success on a disposable PostgreSQL database does not prove live database behavior.
4. No live changes were performed or authorized by this audit note.


## Follow-up checkpoint — scheduler evidence reviewed 2026-10-17

### Workflow source inspection

The current repository Staging and Production workflows both use `*/15 * * * *`, target their environment-specific `ylp-api` endpoint, and call `schedulerAutoClose`. Both require a response envelope with `ok == true` and numeric `data.closed_count`; HTTP 200 alone is not accepted as a successful application response.

### Latest visible Supabase edge logs

- Staging: `2026-10-16T18:00:29.102Z`, `POST | 200` to `ylp_auto_close_sessions_v1`.
- Production: `2026-10-16T17:59:37.166Z`, `POST | 200` to `ylp_auto_close_sessions_v1`.

The current log query does not expose the scheduler response body or `closed_count`. A search for the action name in the edge event text returned no matches. Treat these logs as endpoint reachability evidence only, not as proof that eligible sessions were closed.

### Evidence limitation and disposition

The available GitHub connector view does not expose complete scheduled-trigger run history; its commit-associated workflow-run wrapper is limited to pull-request-triggered runs. Previously recorded scheduled run evidence from 2026-10-16 includes successful Staging and Production runs with `closed_count: 0`, and earlier manual runs returned positive counts (Staging 12; Production 2). Those historical examples support that the API can close eligible sessions, but they do not prove every 15-minute scheduled run succeeds or establish a fresh eligible-session close on 2026-10-17.

**Current status:** Workflow configuration and endpoint reachability have supporting evidence. Full cadence reliability and current end-to-end eligible-session closure remain partially verified. Do not create or close live sessions for testing; do not change cadence or attendance settings. No live database writes, migrations, ACL changes, merges, or deployments were performed for this checkpoint.
