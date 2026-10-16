# Attendance Window and Scheduler Verification — 2026-10-16

## Scope and safety

Read-only verification of Supabase Staging (`yvtgwzvjpztvztozcfir`) and Production (`fsxdsdixxnslismxghfz`). No settings, session rows, migrations, RPCs, grants, or deployments were changed by this check.

## Settings comparison

| Setting | Staging | Production | Assessment |
|---|---:|---:|---|
| `timezone_offset` | `+07:00` | `+07:00` | Matches |
| `open_minutes` | `30` | `30` | Matches |
| `close_minutes` | `120` | `15` | Confirmed drift; product intent needs review before any change |

The values are read from `public.settings`. Staging's values had `updated_at = 2026-09-19T10:20:00.628453+00:00`; Production's values had `updated_at = 2026-09-22T16:31:20.906644+00:00`. Those timestamps show when the settings rows were last updated, but do not establish why the values differ.

The live `public.ylp_scan_v1(...)` definition in both environments reads `open_minutes`, `close_minutes`, and `timezone_offset` and enforces the scan window using those values. Thus, the configured post-session scan allowance differs. However, scans also require the session to remain `active`; the auto-close scheduler closes eligible active sessions after the end time plus 15 minutes, so the effective window also depends on scheduler timing and session state.

Do not change Staging's `close_minutes` without explicit product approval. The approved Production target currently documented for YLP is 15 minutes after session end; first confirm whether Staging's 120-minute setting is an intentional testing override or drift.

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

1. Record `close_minutes` as an environment configuration drift, not automatically as a security incident.
2. Confirm whether Staging's 120-minute value is intentional before deciding on remediation.
3. If the intended Staging value is 15, obtain explicit approval before changing the setting and then verify the row, dashboard response, and scan-window behavior.
4. Continue to verify scheduled GitHub Actions runs and the session-close timestamp fix separately. CI success on a disposable PostgreSQL database does not prove live database behavior.
5. No live changes were performed or authorized by this audit note.
