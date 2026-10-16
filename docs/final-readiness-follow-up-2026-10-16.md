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


### Core constraint equivalence and naming drift

Read-only `pg_constraint` comparison of `admin_profiles`, `students`, `sessions`, `attendance`, and `scan_receipts` found the checked core validation definitions semantically equivalent across environments:
- Role allow-list: `super_admin`, `admin`, `operator`.
- Username format: optional/null or 3–40 characters from `A–Z`, `a–z`, digits, dot, underscore, hyphen.
- Student email: optional/null, maximum 254 characters, basic email-shape check.
- Session status: `active` or `closed`; end time must be later than start time; late threshold 0–240.
- Attendance duration nonnegative; Scan Out requires Scan In; Scan Out timestamp cannot precede Scan In.
- Scan receipt direction limited to `in` or `out`.

Constraint names differ for the username-format constraint (`admin_profiles_username_format_check` in Staging vs `admin_profiles_username_check` in Production), and the role value order differs, but the inspected expressions are equivalent. The extra `2200_..._not_null` catalog entries appear in both environments with different internal identifiers; do not treat those generated names as business-schema drift by themselves.

This is a bounded comparison of the listed core constraints, not a complete canonical schema diff of every table, trigger, policy, view, and function.


### Trigger and RLS policy inventory

A read-only catalog comparison found **four non-internal triggers in Staging and zero in Production**. Staging triggers are:
- `admin_profiles_set_updated_at`
- `sessions_set_updated_at`
- `settings_set_updated_at`
- `students_set_updated_at`

All four call `public.set_updated_at()`, which sets `NEW.updated_at = now()` and has `search_path=pg_catalog, public`. Production has no non-internal triggers in the `public` schema according to the same query.

This is a real schema difference and requires function-by-function review before deciding whether it affects application behavior. Many RPCs may already set `updated_at` explicitly; do not add triggers to Production until reviewing all update paths, avoiding behavior changes or timestamp semantics changes. No trigger or function was modified during this audit.

The same inventory returned no `public` RLS policies in either environment. The reviewed application tables have RLS enabled and direct `anon`/`authenticated` table privileges revoked, so an empty policy inventory is consistent with a backend-only table-access model. Continue validating the Edge Function/RPC authorization boundary as the application access path.


### Follow-up: impact of missing Production `updated_at` triggers (read-only, 2026-10-16)

Function-by-function review narrowed the trigger drift impact for the inspected update RPCs:

- `ylp_admin_account_update_v1(...)` explicitly assigns `updated_at = now()` in both environments.
- All inspected `ylp_student_update_v1(...)` overloads explicitly assign `updated_at`; `ylp_student_set_active_v1(...)` also explicitly updates it in both environments.
- `ylp_branding_update_v1(...)`, `ylp_auto_close_sessions_v1()`, and `ylp_set_session_access_code_v1(...)` explicitly assign `updated_at` in both environments.
- **Confirmed affected path:** `ylp_close_session_v1(text)` updates `public.sessions.status = 'closed'` but does not explicitly assign `updated_at` in either environment. Staging's `sessions_set_updated_at` trigger therefore refreshes `updated_at`; Production has no corresponding trigger, so a session closed through this RPC may retain its prior `updated_at` value. The RPC returns that timestamp in its response, making this an observable Staging/Production behavior difference.
- The automated close function does explicitly assign `updated_at = clock_timestamp()` in both environments, so this specific difference does not affect the inspected auto-close path.

**Assessment:** This is a confirmed timestamp-consistency defect in the manual session-close path, not evidence of an authorization bypass. Do not add a Production trigger automatically: a trigger changes behavior for every update to that table, and must be evaluated against intended Production semantics and a tracked migration. Safest focused remediation options are (a) update `ylp_close_session_v1` to set `updated_at` explicitly in both environments through a reviewed migration, or (b) restore the intended trigger consistently after checking all write paths. Choose one approach, test it in Staging, and require explicit Production schema-change approval before Production rollout. No database changes were made.


### Production helper-RPC usage check (bounded static inspection, 2026-10-16)

A read-only static search of the current `main` frontend source modules and `supabase/functions/ylp-api` source files inspected during this follow-up found no literal references to `ylp_advisory_key_v1`, `ylp_is_uuid_v4_v1`, or `ylp_scan_rejection_v1`. The inspected frontend modules also showed no direct `.rpc(...)` calls; the architecture uses the Edge Function API boundary. This is bounded source inspection, not a complete runtime call-graph proof, so it supports but does not by itself authorize revoking Production privileges.

The read-only privilege query reconfirmed that all three helpers are executable by `anon` and `authenticated` in Production, but not in Staging; they are not `SECURITY DEFINER` functions and use an empty search path. Keep this as an explicit Production ACL drift item. Any Production grant change still requires explicit approval and a focused migration with regression coverage.


### CI status refresh and default-function ACL comparison (2026-10-16)

The documentation commit `56f9fea538365b1ffe491a86c1056ba12d34f50c` completed GitHub Actions Test run [38901032231](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38901032231) successfully. The run completed `npm test` and `npm run test:browser`. Its Vercel Staging and Production preview status checks were also successful. These are PR preview/CI checks only; they are not evidence of a Production deployment or live Production end-to-end behavior.

A fresh direct catalog read reconfirmed default EXECUTE ACL differences:

| Owner | Schema | Staging default function ACL | Production default function ACL |
| --- | --- | --- | --- |
| `postgres` | `public` | `postgres, service_role` | `postgres, anon, authenticated, service_role` |
| `postgres` | `storage` | `postgres, anon, authenticated, service_role` | `postgres, anon, authenticated, service_role` |
| `postgres` | global (no schema) | `postgres` | No global default ACL record returned |
| `supabase_admin` | `public` | `postgres, anon, authenticated, service_role` | `postgres, anon, authenticated, service_role` |

This confirms the previously recorded Production `postgres` public-schema default ACL drift. It also confirms that Staging's explicit `storage` default grants to client roles remain, and that `supabase_admin` retains a public-schema default ACL with client grants in both environments. The current Staging hardening migration does not remediate `supabase_admin`-owned defaults; do not claim that it does. Production changes remain unapproved and untouched.

### Documentation consistency follow-up

The existing `docs/migration-reconciliation.md` on `main` lists an older Production migration ledger count of 23 and an older history snapshot. Current direct read-only checks for this audit report 28 Production ledger records. Treat that document as historical rather than the current ledger source until it is refreshed from a new export/catalog check; do not use its old count as current Production evidence.


### Supabase Security Advisor refresh (read-only, 2026-10-16)

The Supabase Security Advisor was queried directly for both Staging and Production. Both environments returned the same two finding categories:

- **Leaked Password Protection Disabled (WARN):** Supabase Auth's compromised-password check is disabled in both environments. This is an Auth configuration finding, not a PostgreSQL migration finding. No setting was changed. Enabling it requires an explicitly approved Auth configuration change and a follow-up login/password regression check in Staging before any separate Production approval.
- **RLS Enabled No Policy (INFO):** the advisor reports nine `public` tables with RLS enabled and no policies: `admin_profiles`, `api_rate_limit_counters`, `attendance`, `branding_settings`, `scan_receipts`, `session_creation_receipts`, `sessions`, `settings`, and `students`. A direct read-only `information_schema.role_table_grants` check found only `service_role` table grants among `anon`, `authenticated`, and `service_role` for these nine tables; no direct table grants were returned for `anon` or `authenticated` in either environment. Therefore, the no-policy advisor finding is consistent with the backend-only table access model and is not, by itself, evidence of direct client table access. Preserve the RLS/no-policy design unless the access model is intentionally changed.

**Security status:** Staging and Production have equal status for these two advisor categories as of this check. The leaked-password warning remains an unresolved security-hardening item in both environments. Do not silently change Auth settings as part of a read-only audit.


### Supabase Performance Advisor refresh (read-only, 2026-10-16)

The Performance Advisor returned no findings for Production in this check. Staging returned informational findings:

- **Unindexed foreign key:** `public.branding_settings.branding_settings_updated_by_fkey` has no covering index according to the advisor. This may affect parent-row update/delete performance; it is not by itself a security issue. Inspect actual FK columns, query patterns, and index inventory before proposing an index migration.
- **Four unused-index notices:** `attendance_status_session_idx`, `attendance_scan_in_idx`, `attendance_scan_out_idx`, and `api_rate_limit_updated_at_idx` were reported unused in Staging. Do not drop them based on a single advisor snapshot; usage statistics may reset and indexes can serve infrequent or future queries. Compare workload and query plans before any change.

These findings are **Staging-only advisor results at the observation time**, not proof that Production is perfectly optimized or that Staging's indexes should be changed immediately. No indexes were added or removed. Any schema change remains subject to explicit approval and a tracked migration.


### Follow-up: `branding_settings.updated_by` foreign-key drift (read-only, 2026-10-16)

A direct `pg_constraint` / `pg_index` comparison was run to validate the Staging Performance Advisor finding:

- **Staging:** `branding_settings_updated_by_fkey` exists as `FOREIGN KEY (updated_by) REFERENCES auth.users(id)`, but `branding_settings` has only its primary-key index; no valid index begins with `updated_by`.
- **Production:** the same query returned no foreign-key constraints on `public.branding_settings`, so the Staging FK is not present there. Production's absence of this FK is a schema-integrity difference, not an index-performance finding.

Do not automatically add the FK to Production or an index to Staging. First inspect the migration history and current values/nullability of `updated_by`, establish the intended invariant, and confirm how Auth user deletion should behave. If the invariant is approved, plan separate tracked migrations with preflight checks and test referential behavior in Staging. No schema changes were made.



## Follow-up read-only reconciliation — 2026-10-16 (second pass)

### Latest PR/CI/preview evidence

- PR #133 remains open, Draft, unmerged; head remains `0ce8ede4d5fa1f823496c19478b8099913511867` at the time of this check.
- GitHub Actions Test run #439 (`38914671378`) completed successfully for that exact commit.
- GitHub combined status reports Vercel Staging and Production preview checks as successful. Latest listed deployments for the same commit are `READY`:
  - Staging: `dpl_Fdmqr43n7UCzkzbd2V2XqoigeRx7`
  - Production preview project: `dpl_6Q3MbNghfQiux4fL4an3n6oamFLw`
- These remain PR preview builds, not a claim of a new Production deployment or live Production end-to-end verification.

### Branding `updated_by` FK — current values and delete semantics

Read-only queries against `public.branding_settings` and `auth.users` found:

| Check | Staging | Production |
|---|---:|---:|
| Branding rows | 1 | 1 |
| `updated_by IS NULL` | 1 | 0 |
| `updated_by IS NOT NULL` | 0 | 1 |
| Non-null `updated_by` matching an Auth user | 0 | 1 |
| Non-null orphaned Auth reference | 0 | 0 |
| FK `branding_settings_updated_by_fkey` | Present | Absent |

Staging FK definition is `FOREIGN KEY (updated_by) REFERENCES auth.users(id)`; PostgreSQL reports `confdeltype='a'` and `confupdtype='a'`, i.e. default NO ACTION behavior for parent delete/update. The Staging row currently has NULL attribution, so it does not exercise the FK. Production's current non-null attribution resolves to an existing `auth.users` row, so there is no present orphan in the one-row table.

**Assessment:** the observed data is compatible with the FK invariant today, but it does not establish the intended lifecycle policy when an Auth user is deleted. Do not add the FK to Production or add an index to Staging yet. Decide whether `updated_by` is a durable audit attribution (in which case NO ACTION may intentionally block user deletion), should be cleared on user deletion (SET NULL), or should be managed by a different audit model. That product/security invariant must be explicit before migration design.

### Source migration vs current database — branding search path

- Git `main` migration `20261014060002_harden_branding_definer_search_path.sql` explicitly sets both branding SECURITY DEFINER functions to `pg_catalog, public`.
- Current Staging definitions match that setting.
- Current Production definitions still have `search_path=public`; both functions deny EXECUTE to `anon` and `authenticated` in the effective privilege check.
- This confirms Production is not converged to the hardening migration's intended configuration despite the relevant historical migration-ledger entry naming the branding feature differently. It is a hardening/configuration drift; no exploit was demonstrated and no change was made.

### Helper EXECUTE grants — source intent vs live effective privileges

Git migration `20261014052752_restrict_public_function_default_execute.sql` explicitly revokes `PUBLIC`, `anon`, and `authenticated` from:
- `ylp_advisory_key_v1(text,text)`
- `ylp_is_uuid_v4_v1(uuid)`
- `ylp_scan_rejection_v1(text,text)`

Fresh `has_function_privilege` checks reconfirmed all three are not executable by `anon`/ `authenticated` in Staging, but are executable by both client roles in Production. Their live definitions are non-SECURITY-DEFINER SQL helpers with empty search paths and do not directly query application tables. The result remains an ACL-policy mismatch and unnecessary public function surface, not an identified table-data bypass. Before remediation, finish the call-path compatibility check and prepare a focused, tracked Production migration with pre/post ACL assertions. Production changes require separate explicit approval.

### Default ACL and scheduler migration candidate reconciliation

- Live Staging `postgres` default function ACL for `public` is restricted to `postgres, service_role`; Production still includes `anon, authenticated`.
- Both environments show client-role EXECUTE in `supabase_admin`'s `public` default function ACL and in `postgres`'s `storage` default ACL. The current migration explicitly scopes its change to `postgres` in `public`; it does not fix the other owner/schema combinations.
- Git `20261012120000_secure_session_auto_close_scheduler.sql` and duplicate candidate `20261014120000_secure_session_auto_close_scheduler.sql` both define the same auto-close function logic and grant `service_role`, but neither explicitly grants `postgres` EXECUTE. The later candidate does not improve that grant assertion. Live Staging and Production function ACLs currently grant `postgres` and `service_role` and deny client roles. PR #126's duplicate-file removal remains the appropriate source-history cleanup candidate; do not infer database history equivalence or replay either migration from file similarity alone.

### Updated migration reconciliation matrix (bounded scope)

| Change family | Git/source evidence | Staging live evidence | Production live evidence | Current classification |
|---|---|---|---|---|
| Student schema/RPC and Bangkok enrollment date | PR #130 migrations | Three recorded versions present; Bangkok default and RPC behavior verified in prior rollback-only test | Staging-specific versions absent; prior read-only check found 35 Students and `CURRENT_DATE` default | Intentional environment divergence pending release decision |
| QR access code | Git migration vs differently versioned ledgers | Core columns, index and backend-only functions present | Same reviewed columns/index/functions and ACL behavior present | Reviewed objects semantically equivalent; ledger versions differ |
| Admin login identity | Git hardening migration vs differently versioned ledgers | Backend-only function ACL verified | Backend-only function ACL verified | Reviewed ACL intent equivalent |
| Safe session deletion | Current final function vs historical migrations | Closed-session guard and backend-only EXECUTE verified | Same reviewed guard and ACL verified | Reviewed behavior equivalent; compare final definitions |
| Branding function search path | Git hardening migration requires `pg_catalog, public` | Matches | `public` only | Confirmed hardening drift |
| Three helper function ACLs | Git migration explicitly revokes client roles | Client EXECUTE denied | Client EXECUTE allowed | Confirmed Production ACL drift |
| Default function ACL | Git migration scoped to `postgres/public` | `postgres/public` restricted | `postgres/public` includes client roles; other owner/schema defaults remain permissive in both | Partial remediation / residual drift |
| Branding `updated_by` FK | Original Git branding migration declares FK | FK present, no covering index; current row NULL | FK absent; current non-null value maps to existing Auth user | Invariant/lifecycle decision needed |
| `updated_at` triggers | Staging has four triggers; Production none | Trigger refreshes manual session-close timestamp | Manual close RPC omits explicit timestamp assignment | Confirmed timestamp consistency defect |
| Scheduler migration candidates | Two Git candidates; duplicate candidate lacks explicit postgres grant/assertion | Current function has intended backend-only ACL | Current function has intended backend-only ACL | PR #126 cleanup candidate; no replay |

This matrix is intentionally bounded to reviewed families and does not claim a full canonical schema diff.

### Read-only safety statement

This follow-up used catalog reads and migration-ledger reads only. No database writes, migrations, grants, Auth configuration changes, index/trigger changes, deployments, merges, or account changes were performed. The existing Staging-only Bangkok enrollment-date migrations were not reapplied. All Production changes remain on hold pending exact-scope approval.


### Additional API/RPC contract drift — branding GET return type

A fresh PostgreSQL catalog comparison found a return-type mismatch not captured by the earlier search-path-only note:

- Staging `ylp_branding_get_v1()` returns `jsonb` and its body selects `to_jsonb(b)`.
- Production `ylp_branding_get_v1()` returns the composite type `branding_settings`.
- Both functions are `SECURITY DEFINER`; both deny effective EXECUTE to `anon` and `authenticated`; search-path drift remains as recorded above.
- The current `main` Edge Function `supabase/functions/ylp-api/index.ts`, method `branding()` (around lines 926–929), calls the RPC and normalizes an array result to its first item, otherwise returning the result as-is. This appears intended to tolerate different result shapes, but static inspection is not live API contract verification.

**Assessment:** this is an API/RPC contract drift even though the current adapter may normalize the observed return shapes. Do not alter either database function solely to make signatures identical without checking client expectations and regression tests. Add a focused test covering the normalized branding response shape, then decide whether to standardize both environments on one return type through a tracked migration. No runtime request or database write was performed for this finding.


### Locked audit checkpoint — latest CI and advisor refresh (2026-10-16)

This checkpoint continues the existing read-only audit plan; it does not authorize any database, Auth, Vercel configuration, merge, or Production change.

#### PR #133 and CI

- PR #133 remains open, Draft, and unmerged; current head is `f06a2e1304e3891e93ae5b735cea12667fed61c9`.
- GitHub Actions Test run [#441](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38920467532) completed successfully for that exact head commit. The job completed both `npm test` and `npm run test:browser`.
- The Vercel Production-project PR preview check is successful. The Vercel Staging preview check is failing due to the provider's build rate limit (reported retry in 24 hours), not a reported application test failure. Do not change the Vercel plan or configuration without approval.
- Preview readiness is not live Production deployment verification.

#### Current Supabase advisor and Edge Function snapshot

A fresh read-only advisor refresh at approximately 2026-10-16 15:02 UTC found:

- Staging and Production Security Advisor both report 9 RLS-enabled tables without policies and leaked-password protection disabled (WARN). The no-policy result is consistent with the reviewed backend-only table-access model; no client table grants were found in the prior direct grant checks. The Auth setting remains an unresolved hardening item and must not be changed during this read-only audit.
- Staging Performance Advisor reports one unindexed FK on `branding_settings.updated_by` and four unused-index notices. Production Performance Advisor returned no findings in this snapshot. Do not add/drop indexes based on these notices alone.
- Staging `ylp-api` is ACTIVE at function version 50; Production `ylp-api` is ACTIVE at function version 43. This is a deployment-version difference only; it does not prove the code versions are equivalent or incompatible. Compare deployed source/hash against the intended repository commit before drawing a deployment-parity conclusion.

#### Locked procedure / next work

Continue in this order: (1) complete the bounded migration/object equivalence matrix and identify unreviewed high-risk objects; (2) inspect deployed Staging and Production `ylp-api` source/version parity; (3) finish manual session-close timestamp and branding RPC contract test design; (4) prepare proposed migrations only as tracked files with preflight/postflight assertions, without applying them; (5) run relevant tests and update the Master Handoff. Keep all changes read-only unless separately approved. PR #133 remains Draft/unmerged pending review.


### Deployed Edge Function source parity — read-only (2026-10-16)

Fetched the active deployed `ylp-api` source from both Supabase projects and compared the returned file contents:

- Staging: ACTIVE, version 50, source hash `540a4d6db58f4d86b3d92ee6ceb4cea7a34ebecb872aaf0caf31042f062f9e39`.
- Production: ACTIVE, version 43, source hash `c201461db172288cb41ba7d654f20a46123dcc6cc922b784da2aa106f71b9e51`.
- `index.ts`: 1,336 lines in each; contents are byte-for-byte identical in the fetched source.
- `types.ts`: 42 lines in each; contents are byte-for-byte identical.
- `cors.js`: Staging matches current Git `main`; Production differs on the preview-origin regular expression. Staging accepts the `phoenix-attendance-rbac-stag` / `staging` variants with optional preview suffix; Production only accepts the strict `phoenix-attendance-rbac-staging-<suffix>.vercel.app` form.

**Assessment:** The version numbers and source hashes differ, but the main API implementation and type definitions are identical in the fetched source. The CORS difference appears narrower in Production; do not broaden Production CORS or deploy code merely to equalize hashes. Confirm intended preview-origin policy and inspect the effective `YLP_ALLOW_VERCEL_PREVIEW_ORIGINS` runtime setting through an approved non-secret configuration check before deciding whether this is intentional. No secrets were retrieved or displayed; no Edge Function was deployed or changed.


### Expanded high-risk RPC and trigger matrix — read-only (2026-10-16)

A fresh catalog comparison covered all `public` functions named `ylp_%` plus all SECURITY DEFINER functions, effective EXECUTE privileges, and triggers on `sessions`, `attendance`, `branding_settings`, and `students`.

#### Confirmed client-role EXECUTE drift

- Production permits `anon` and `authenticated` EXECUTE on `ylp_advisory_key_v1(text,text)`, `ylp_is_uuid_v4_v1(uuid)`, and `ylp_scan_rejection_v1(text,text)`; Staging denies both client roles.
- The three functions are non-SECURITY-DEFINER, immutable SQL helpers with empty search paths and use only built-in expressions / `pg_catalog` functions in their bodies. The reviewed definitions do not directly read or mutate application tables, so this is unnecessary public RPC surface rather than evidence of a direct data-access bypass. Keep the Production ACL mismatch tracked for a narrowly scoped, approved migration after call-path and compatibility checks.
- In this bounded function inventory, all listed SECURITY DEFINER functions deny effective EXECUTE to `anon` and `authenticated` in both environments. This is not a complete audit of every schema or object in PostgreSQL.

#### Production-only destructive RPC

- Production contains `ylp_force_delete_student_v1(text)`; Staging does not.
- The Production definition is SECURITY DEFINER with an empty search path and explicitly schema-qualifies `public.students`, `public.attendance`, and `public.scan_receipts`. Effective EXECUTE is restricted to backend roles; `anon` and `authenticated` are denied.
- The function deletes scan receipts, attendance rows, and the student. Its presence alone does not establish a vulnerability because the direct RPC is backend-only, but the environment difference must be reconciled with the Edge Function route and super-admin fresh re-authentication flow. Do not invoke it in either environment as part of audit/testing and do not add it to Staging without a tracked, reviewed migration and explicit approval.

#### Student RPC overload drift

- Staging has additional two-argument overloads of `ylp_student_create_v1(text,text)` and `ylp_student_update_v1(text,text)`; Production does not.
- Both environments have the enrolled-date and email-aware overloads recorded in the existing migration matrix. All overloads in the bounded inventory deny client-role EXECUTE.
- Determine whether the legacy overloads are still referenced by any backend/deployment path before considering removal; do not drop functions based solely on this inventory.

#### Trigger drift

- Staging has `sessions_set_updated_at` and `students_set_updated_at` BEFORE UPDATE triggers calling `set_updated_at()`.
- Production returned no triggers for the four queried tables (`sessions`, `attendance`, `branding_settings`, `students`) in this snapshot. This confirms a broader trigger-parity difference than the previously documented manual-close timestamp symptom. Before proposing a trigger migration, inspect all table columns, existing trigger functions, update paths, and timestamp expectations to avoid duplicate or unintended side effects.

#### CI checkpoint

- The latest documentation commit `1777e35889f723c1257961099db7e2b03cf25341` triggered GitHub Actions Test run [#443](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38920847667). At the time of this update, dependency installation had passed, Playwright browser installation was still in progress, and the test steps had not yet completed. Do not mark this commit CI-green until the run concludes successfully.
- Vercel Staging and Production PR preview checks were both blocked by the provider build rate limit at the latest check. This is not proof of an application build failure and is not live Production deployment verification.

No database writes, migrations, function ACL changes, deployments, or destructive calls were performed during this inspection.


### Follow-up: destructive student route and close-session timestamp parity — read-only (2026-10-16)

#### Student deletion authorization path confirmed in Git `main`

Reviewed `supabase/functions/ylp-api/index.ts` at current `main`:

- `deleteStudent` requires `super_admin` on the current authenticated token.
- It requires a non-empty username and password, applies the global login rate limit, performs a fresh login, validates the re-authenticated token as `super_admin`, and compares the re-authenticated subject to the current session subject before calling `backend.forceDeleteStudent(...)`.
- The backend adapter invokes `ylp_force_delete_student_v1`; the route does not call the destructive RPC until these checks pass.
- The Production database definition of `ylp_force_delete_student_v1(text)` is SECURITY DEFINER with an empty search path and schema-qualified table references. Effective EXECUTE is denied to `anon` and `authenticated`, and allowed to `service_role`. Staging does not currently contain this function.

**Assessment:** The checked-in route implements the required super-admin + fresh re-authentication + same-account check + rate limit. Production's backend-only RPC permission is consistent with that boundary. Remaining work is to verify the deployed Production Edge Function version's route matches Git and to check the client UI's confirmation flow without performing a deletion. This is source/catalog verification, not a destructive end-to-end test. No RPC was invoked.

#### Manual session-close timestamp behavior

Compared `ylp_close_session_v1(text)`, trigger definitions, and effective RPC permissions in both databases:

- Both environments' close RPC locks the target session, changes `status` to `closed` only when it is not already closed, and returns the row's `updated_at`. Effective EXECUTE is denied to `anon` and `authenticated`, and allowed to `service_role`.
- Staging has `sessions_set_updated_at` and `students_set_updated_at` BEFORE UPDATE triggers calling `set_updated_at()`; that trigger function assigns `new.updated_at = now()`.
- Production has no non-internal triggers on the queried `sessions`, `students`, `attendance`, or `branding_settings` tables in this snapshot.
- Consequently, when the Production close RPC changes a session from non-closed to closed, the shown function does not itself assign `updated_at`, and the queried table has no trigger to assign it. The returned timestamp can therefore remain unchanged. In Staging, the sessions trigger supplies the timestamp on the update.

**Assessment:** This is a confirmed cross-environment behavior difference and a likely Production `updated_at` consistency defect, not just a theoretical migration mismatch. Do not apply a trigger or function change yet. First inspect all timestamp columns, other table triggers, current migration history, and update paths; then prepare a tracked migration with preflight/postflight checks and regression coverage. A live close-session write was intentionally not performed during this read-only audit.

#### Latest CI / PR checkpoint

- GitHub Actions Test run [#443](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38920847667) remains `in_progress` at the latest poll: `npm install` passed; Playwright Chromium installation is still running; `npm test` and `npm run test:browser` have not started. CI is not yet green for the latest documentation commit.
- The latest commit's Vercel Staging and Production preview status checks both report provider build-rate-limit failures. This is not evidence that application tests failed and does not verify live Production.
- PR [#133](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/133) remains open, Draft, and unmerged. No database writes, migrations, ACL changes, deployments, merges, or destructive actions were performed.


### Follow-up: deployed destructive-route parity and full timestamp-trigger inventory — read-only (2026-10-16)

#### Deployed Production/Staging API route parity

Fetched active deployed `ylp-api` source from both Supabase projects and compared `index.ts` against Git `main`:

- Production active version 43, source hash `c201461db172288cb41ba7d654f20a46123dcc6cc922b784da2aa106f71b9e51`.
- Staging active version 50, source hash `540a4d6db58f4d86b3d92ee6ceb4cea7a34ebecb872aaf0caf31042f062f9e39`.
- All three fetched `index.ts` contents are exactly equal (67,732 characters); both deployed `types.ts` files are also equal to each other and match the prior parity finding.
- The deployed Production and Staging `deleteStudent` route exactly matches Git `main`: super-admin authorization, required username/password, global login rate limiting, fresh login, re-check of the re-authenticated super-admin role, and subject equality before the backend calls `ylp_force_delete_student_v1`.
- Git's `src/main.js` renders the student-delete confirmation only for `super_admin`, requests username/password with a password input, and submits those credentials with the student ID to `deleteStudent`. The existing `tests/super-admin-rbac.test.js` includes source-level regression assertions for destructive student/session authorization. No live delete was performed.

**Assessment:** The deployed API route does not show source drift for the destructive student authorization path. This is source-level parity plus catalog ACL verification, not a live end-to-end deletion test. The separate Production-only RPC presence remains a migration/environment drift item.

#### Complete timestamp-column and public-trigger inventory

Expanded the read-only comparison from four tables to every `public` table with `created_at`, `updated_at`, or `closed_at` columns, and every non-internal trigger in `public`:

- The timestamp-column inventory matched between environments for the reviewed columns on `admin_profiles`, `api_rate_limit_counters`, `attendance`, `branding_settings`, `scan_receipts`, `session_creation_receipts`, `sessions`, `settings`, and `students`.
- Staging has four public timestamp triggers: `admin_profiles_set_updated_at`, `sessions_set_updated_at`, `settings_set_updated_at`, and `students_set_updated_at`; each calls `set_updated_at()`.
- Production has **zero non-internal triggers in schema `public`** in this snapshot, not merely zero triggers on the original four tables.
- Git `main` currently has 25 SQL migrations in `supabase/migrations`; none of their filenames identifies an `updated_at` trigger migration. This alone does not prove trigger creation is absent from all historical baseline/setup paths, and migration-ledger drift means it is not safe to infer the intended trigger set from filenames alone.

**Assessment:** The drift affects timestamp behavior on `admin_profiles`, `sessions`, `settings`, and `students` updates, subject to each table's actual update paths. Do not blindly recreate all four triggers in Production. Next determine where Staging's triggers originated, compare the full migration ledger and initial schema/bootstrap history, then decide table-by-table whether to standardize trigger behavior or explicitly set timestamps in RPCs. Any proposed change must be a separate tracked migration with preflight assertions, postflight catalog checks, and tests; it remains unapplied pending explicit approval.

No database writes, migrations, ACL changes, deployments, merges, account changes, or destructive actions were performed.
