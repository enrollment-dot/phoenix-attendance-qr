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


## Read-only database security comparison (2026-10-16, follow-up)

The following checks were executed directly against both Supabase projects using PostgreSQL catalogs and effective privilege functions. They were read-only.

### Table grants and RLS

For the eight application tables checked — `admin_profiles`, `api_rate_limit_counters`, `scan_receipts`, `session_creation_receipts`, `attendance`, `sessions`, `settings`, and `students` — RLS is enabled in both environments. Effective `anon` and `authenticated` SELECT/INSERT privileges were false for all eight tables in both environments. `service_role` has the required table privileges checked by the audit.

### Sensitive RPCs and helper-function ACL drift

- The checked account-management RPCs, `ylp_delete_session_v1`, attendance/session RPCs, and Student create/update/list overloads were not executable by `anon` or `authenticated` in either environment; `service_role` and `postgres` had execute permission.
- **Production-specific drift:** `ylp_advisory_key_v1(text,text)`, `ylp_is_uuid_v4_v1(uuid)`, and `ylp_scan_rejection_v1(text,text)` are executable by `anon` and `authenticated` in Production, while all three are not executable by those client roles in Staging. The definitions were inspected: they are simple immutable SQL helpers (hash-derived advisory key, UUIDv4 predicate, and JSON scan-rejection envelope), are not `SECURITY DEFINER`, and use an empty search path. This does not by itself demonstrate data access or a direct authorization bypass, but it is inconsistent with Git migration `20261014052752_restrict_public_function_default_execute.sql` and its explicit helper-function revokes. Record as a Production ACL drift item requiring a separately approved, targeted remediation after confirming intended API compatibility.
- **Default privileges drift:** the `postgres` default ACL for future functions in schema `public` is restricted in Staging (`postgres` and `service_role` only), but Production's `postgres` default ACL still includes `anon` and `authenticated`. Both environments also show a separate `supabase_admin` default ACL with client execute grants. The repository migration explicitly notes that the migration connection cannot change `supabase_admin`-owned defaults. Do not infer that the existing migration fully resolves default-privilege drift across all owners.
- **Branding function configuration drift:** Staging's `ylp_branding_get_v1()` and `ylp_branding_update_v1(...)` use `search_path=pg_catalog, public`; Production still reports `search_path=public`. The corresponding Git migration is recorded/applied in Staging but Production's current function configuration has not converged. The functions are not executable by `anon` or `authenticated` in either environment. Treat this as hardening drift, not proof of an exploit.

### Recommended next steps (no changes applied)

1. Keep the above Production ACL/default-privilege differences in the release-blocking security reconciliation list until the owner confirms whether the public helper RPC surface is intentional.
2. Prepare a narrow Production migration that explicitly revokes `PUBLIC`, `anon`, and `authenticated` from the three helper functions and grants only the intended backend roles, after verifying the frontend and `ylp-api` do not invoke them through a client-role database connection.
3. Separately plan owner-specific default-privilege remediation for `postgres` and, if authorized/possible, `supabase_admin`; do not claim the latter is fixed by the current migration.
4. Apply the branding search-path hardening to Production only after explicit Production security-change approval and pre/post verification.
5. Do not make any of these changes automatically: this audit only recorded findings and did not alter Production or Staging.


## Additional migration equivalence checks (read-only)

### QR access-code migration and admin-login hardening

Both environments have `sessions.qr_access_code_hash`, `sessions.qr_access_code_ciphertext`, the partial unique index `sessions_qr_access_code_hash_uidx`, and the backend-only `ylp_set_session_access_code_v1`, `ylp_resolve_session_access_code_v1`, and `ylp_get_session_access_code_v1` functions. The checked functions are `SECURITY DEFINER`, use an empty search path, deny `anon`/`authenticated` EXECUTE, and permit `service_role`/`postgres`. This supports semantic equivalence for the reviewed QR objects despite differing migration-ledger versions.

Both environments also have `ylp_admin_login_identity_v1(text)` restricted to `service_role` and `postgres`, with `anon` and `authenticated` denied. Thus the admin-login hardening's intended ACL state is present in both environments even though the ledger versions differ.

### Safe session deletion

The current `ylp_force_delete_session_v1(text)` definition in both environments checks that the target session status is `closed` and returns the `session_must_be_closed` guard otherwise. Both environments deny client-role EXECUTE and grant it to `service_role` and `postgres`. The unsafe earlier implementation in Git migration `20260928200000_admin_secured_force_delete_session.sql` is superseded by the later closed-session-only implementation; compare the final function definition, not that historical file alone.

### Scan-receipt index difference

- Production has `idx_scan_receipts_session_id` on `scan_receipts(session_id)`, matching Git migration `20260926140000_add_scan_receipts_session_id_index.sql`.
- Staging does not have that exact index, but it does have `scan_receipts_session_student_idx` on `(session_id, student_id)`. Because `session_id` is the leading column, that composite index can support lookups by `session_id`; the intended access path may therefore already be covered. Staging also has `scan_receipts_created_at_idx`, while Production's current index list does not show that index. This is index-definition drift, not by itself proof of a functional or security defect. Check representative query plans and workload before proposing an extra index; no index was created or dropped during this audit.


### Full SECURITY DEFINER client-execution sweep

A read-only catalog sweep across all functions in schema `public` found **zero `SECURITY DEFINER` functions executable by `anon` or `authenticated` in either Staging or Production**. This is an important positive control: the three Production helper functions noted above are not `SECURITY DEFINER` functions. Their client EXECUTE grants remain ACL drift and should be reviewed, but they are not an identified public SECURITY DEFINER execution path.
