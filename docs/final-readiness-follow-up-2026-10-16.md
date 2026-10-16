# Final Readiness Follow-up — Migration Drift and Scheduler Evidence (2026-10-16)

## Scope and safety

Read-only verification against GitHub `main`, Supabase Staging project `yvtgwzvjpztvztozcfir`, Supabase Production project `fsxdsdixxnslismxghfz`, and GitHub Actions run history. No database writes, migrations, merges, production configuration changes, or deployments were performed during this follow-up.

## Migration ledger comparison

| Source | Current count | Notes |
|---|---:|---|
| GitHub `main` `supabase/migrations` | 25 files | Includes two scheduler migration candidates. |
| Staging migration ledger | 27 records | Contains historical Staging-specific migrations and recent Student migrations. |
| Production migration ledger | 28 records | Contains historical Production baseline/RPC migrations and different recorded versions. |

The counts are not a one-to-one migration equivalence test. File versions and recorded ledger versions differ for several changes that appear to represent the same feature. Examples verified by ledger names include:

- Safe session delete: Git file version `20260924123000`; Staging ledger version `20260924053304`.
- Short QR access code: Git file version `20260927010000`; Staging `20260926175255`; Production `20260926175644`.
- Admin login identity hardening: Git file version `20260929200000`; Staging `20261010183050`; Production `20260928184349`.
- Branding settings: Git file version `20261001010000`; Staging `20261010183337`; Production `20261001192300`.
- Session auto-close scheduler: Git's retained candidate `20261012120000`; Staging ledger `20261012052803`; Production ledger `20261013174134`.

Git `main` also includes `20261014120000_secure_session_auto_close_scheduler.sql`, a duplicate scheduler candidate that omits explicit `postgres` EXECUTE grant and permission assertions. PR #126 proposes removing this duplicate. It remains open/Draft and has not been merged.

Staging contains ledger entries not represented by exact-version files on current `main`, including its historical Phase 5/6 migration series, `20261015094240` global function default ACL hardening, and Student migrations `20261016040903`, `20261016043513`, `20261016072742`. Production has its historical `ylp_production_schema_v1` / RPC v1–v7 series, a separate RBAC promotion record, and other differently versioned entries. Some current Git migrations have equivalent ledger names under a different version; some need actual schema/function comparison before equivalence can be claimed.

**Decision:** do not run `supabase db push`, replay migrations, edit either ledger, squash history, or apply a bulk reconciliation. Build and review a migration-by-migration matrix using SQL definitions, object presence, constraints, ACLs, triggers, and data effects before proposing any specific database change. Any Staging or Production schema/security change requires separate explicit approval.

## Scheduler execution verification

### Configuration and mechanism

Both repository workflows are configured for `*/15 * * * *` and target separate Supabase `ylp-api` endpoints:
- `.github/workflows/session-auto-close-staging.yml`
- `.github/workflows/session-auto-close-production.yml`

The workflows validate the environment-specific API URL and scheduler secret, call `schedulerAutoClose`, and fail unless the response envelope has `ok: true` and numeric `data.closed_count`.

Neither database exposes `cron.job` or `cron.job_run_details`, and neither has `pg_cron` installed. The configured scheduler mechanism is GitHub Actions, not database `pg_cron`.

### Runtime evidence

| Environment | Run | Event/time (UTC) | Result | Closed count |
|---|---|---|---|---:|
| Staging | [Run 38852289056](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38852289056) | Scheduled, 2026-10-16 04:45 | Success | 0 |
| Production | [Run 38852248929](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38852248929) | Scheduled, 2026-10-16 04:45 | Success | 0 |
| Staging | [Run 38211949742](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38211949742) | Manual, 2026-10-12 06:19 | Success | 12 |
| Production | [Run 38441185428](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38441185428) | Manual, 2026-10-13 17:45 | Success | 2 |

The latest scheduled runs completed their configuration validation and API-call steps successfully in both environments. `closed_count: 0` means those particular runs did not close any sessions; it is not a failure. The historical manual runs provide positive-path evidence that the Staging and Production API returned successful envelopes and closed eligible sessions.

The database RPC `public.ylp_auto_close_sessions_v1()` exists in both environments as `SECURITY DEFINER`, uses `search_path=pg_catalog, public`, and grants EXECUTE to `postgres` and `service_role`. The catalog query did not find a database-native cron job because `pg_cron` is not installed.

**Scheduler conclusion:** GitHub Actions scheduling and successful API execution are verified by run history. This does not prove every 15-minute run always succeeds, nor does a zero-count run test a live eligible-session close. Do not change cadence or attendance grace-period settings; the approved 15-minute cadence and 15-minute post-session grace remain unchanged.

## Remaining release gates

1. Reconcile each migration by actual schema/function equivalence and data impact; never infer equivalence from counts alone.
2. Review PR #126's duplicate scheduler migration removal before merge; it remains Draft/open/unmerged.
3. Continue full functional and security verification across UI → API → authorization → RPC → database ACLs → deployment.
4. Keep PR #130 and PR #133 Draft/unmerged until review and explicit approval.
5. Keep Production database changes separate from Staging and require explicit approval before any migration.

## Verified environment state from this follow-up

- Staging: 13 Student rows; `students.enrolled_from` default is `(now() AT TIME ZONE 'Asia/Bangkok')::date`; the three Student-related migration versions recorded for this rollout are present.
- Production: 35 Student rows; `students.enrolled_from` default remains `CURRENT_DATE`; none of those three Staging-specific migration versions are present.
- No Production migration or database change was performed.
- Vercel's latest preview deployments for the PR #133 commit were READY, but preview status is not evidence that a Production database migration was applied or that all browser workflows passed in live Production.
