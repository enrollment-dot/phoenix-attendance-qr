# API ↔ RPC ↔ Database Contract Audit — 2026-10-16

## Current status — verified after Staging timezone migration

**Current verified state:** PR #130 and PR #133 remain Draft/open/unmerged. No PR was merged. The Bangkok enrollment-date migration was applied to **Staging only** after explicit approval. Production was not modified.

### Staging and Production database state

- **Staging** project `yvtgwzvjpztvztozcfir`: migration versions `20261016040903`, `20261016043513`, and `20261016072742` are present. The third ledger row is named `20261016045000_use_bangkok_enrollment_date_default`; the migration tool generated ledger version `20261016072742`, so the PR #130 migration file was renamed to `supabase/migrations/20261016072742_use_bangkok_enrollment_date_default.sql` to match the actual Staging ledger.
- Staging Student count remains 13. `students.enrolled_from` is `date NOT NULL`; its default now resolves to `(now() AT TIME ZONE 'Asia/Bangkok')::date`.
- The six Student create/update RPC overloads (2-, 3-, and 4-argument signatures) remain `SECURITY DEFINER` with empty `search_path`, no argument defaults, `anon`/ `authenticated` EXECUTE denied, and `service_role`/ `postgres` EXECUTE granted.
- **Production** project `fsxdsdixxnslismxghfz`: previous read-only audit observed 35 Student rows and did not include compatibility migration `20261016043513`. No Production migration, database change, or deployment was performed during this operation.

### Post-migration behavior verification

- Read-only catalog query confirmed the Bangkok timezone table default and the function definitions for `ylp_student_create_v1(text,text,date,text)` and the legacy `ylp_student_create_v1(text,text)` wrapper.
- A transaction changed the session timezone to `Pacific/Honolulu`, called the four-argument create RPC with explicit `p_enrolled_from = NULL`, and called the legacy two-argument create wrapper. Both returned the Bangkok business date; the legacy wrapper returned NULL email as expected. The transaction was rolled back.
- Post-test Student count remains 13 and the specific regression IDs `TEST-NULL-4` and `TEST-LEGACY-2` are absent.
- ACL verification confirmed no EXECUTE for `anon` or `authenticated` on the Student RPC overloads and EXECUTE for `service_role` and `postgres`.

### Latest PR #130 CI after ledger filename alignment

PR #130 head is `97720ce05f604072e3cc28addb98c58e436c34d8`. The migration filename and references in the Node regression test and PostgreSQL regression workflow now match the actual Staging ledger version. The latest observed runs are still in progress at this snapshot:
- Student Schema PostgreSQL Regression #32, run ID `38867499938`.
- Session Auto-Close PostgreSQL Regression #58, run ID `38867499675`.
- Test #425, run ID `38867499729`.
- Vercel Staging and Production PR status checks were pending at the last check.

Do not report these checks as passed until the final outcomes are observed. Vercel PR checks are not evidence that a Production database migration was applied.

### Remaining gates

1. Confirm latest PR #130 CI and Vercel status checks after the migration-file/ledger alignment.
2. Review the final PR #130 diff; leave PRs Draft/unmerged until reviewed and explicitly approved.
3. Continue final audit, risk-register, and documentation reconciliation. Production remains read-only and unchanged.

Do not reapply the Staging migration. The Staging ledger entry is already present under version `20261016072742`. Any future Production migration requires separate explicit approval and a fresh Production schema/ledger review.

---


## Previous status snapshot — superseded 2026-10-16

**Current verified state:** PR #130 remains Draft/open/unmerged. Its compatibility migration has been applied to Staging project `yvtgwzvjpztvztozcfir` with explicit approval only. The applied ledger version is `20261016043513`, matching the renamed migration file `supabase/migrations/20261016043513_preserve_legacy_student_rpc_contracts.sql`. Production project `fsxdsdixxnslismxghfz` was not targeted.

Latest live database checks:
- Staging: 13 Student rows; migration versions `20261016040903` and `20261016043513` are present. Six Student create/update overloads exist (2-, 3-, and 4-argument signatures); all have zero argument defaults. All six are `SECURITY DEFINER`, use an empty `search_path`, deny EXECUTE to `anon` and `authenticated`, and grant EXECUTE to `service_role` and `postgres`.
- Staging compatibility regression calls succeeded for 2-/3-/4-argument create/update behavior, including preservation of existing email during legacy updates. The test ran in a transaction and was rolled back; no test rows remain and the count is still 13.
- Production: 35 Student rows. Compatibility migration version `20261016043513` is absent, and the previously observed 3-/4-argument RPC signatures remain. No Production migration or deployment was performed.
- The compatibility migration's filename now matches Staging's actual recorded ledger version. The Student regression workflow and Node test references were updated to that filename on the PR #130 branch.
- Latest observed CI after the filename/reference fix: Student Schema PostgreSQL Regression #19 (run ID `38851588692`) passed; Session Auto-Close PostgreSQL Regression #45 (run ID `38851588667`) passed; Test #407 (run ID `38851588608`) completed successfully, including `npm test` and `npm run test:browser`. Earlier Test #406 failed because it referenced the old migration filename; its browser tests were skipped after `npm test` failed. The path mismatch was fixed in the PR branch and the rerun passed.

**Latest follow-up — Bangkok enrollment date default:** Final review identified that PostgreSQL session timezone is UTC while the product business timezone is Asia/Bangkok. A new additive proposal, `supabase/migrations/20261016045000_use_bangkok_enrollment_date_default.sql`, has been added to PR #130. It changes only the future `enrolled_from` column default and the legacy two-argument create wrapper to calculate the date in `Asia/Bangkok`; it does not rewrite existing Student dates. Regression coverage now checks the catalog default and calls the legacy create wrapper under a deliberately different session timezone. This migration has **not** been applied to Staging or Production. Latest PR #130 head `85ba97611e3609d4bbad72daae11bad5e2d1bed6` has Test #413, Student Schema PostgreSQL Regression #23, and Session Auto-Close PostgreSQL Regression #49 running; do not claim they passed until final results are observed. Vercel Staging and Production status checks were pending at the last check. PR #130 and PR #133 remain unmerged; no deployment was initiated. Do not reapply either existing Staging migration or apply any migration to Production without separate explicit approval and fresh schema/ledger review.


## Initial audit snapshot (historical pre-application baseline)


## Purpose and scope

This is a read-only verification snapshot of the SIFer Lab Attendance Web App's Staging and Production Supabase database contracts, compared with the current `main` Edge Function source. It records observed facts and follow-up requirements; it does not authorize a database migration or deployment.

Repository: `enrollment-dot/phoenix-attendance-qr`  
Main SHA at audit start: `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`  
Edge Function: `ylp-api`  
Audit date: 2026-10-16

### Initial executive finding (before the Staging migration)

**BLOCKED: Student create/update contract is inconsistent in Staging.** The current `main` Edge Function calls the student create/update RPCs with `p_student_id`, `p_name`, `p_enrolled_from`, and `p_email`. Production has matching four-argument overloads and the required columns. Staging has only two-argument RPC signatures and lacks `enrolled_from` and `email` columns. A four-argument call is therefore expected to fail in Staging unless another unobserved path changes the contract. This is a catalog-based finding; no synthetic runtime request was sent.

### Initial verified facts (before the Staging migration)

### Student schema and RPC signatures

| Item | Staging | Production |
|---|---|---|
| `students.enrolled_from` | Missing | Present, `date NOT NULL` |
| `students.email` | Missing | Present, nullable `text` |
| `ylp_student_create_v1` | `(p_student_id text, p_name text)` | Three-argument and four-argument overloads; four-argument overload includes `p_enrolled_from date, p_email text` |
| `ylp_student_update_v1` | `(p_student_id text, p_name text)` | Three-argument and four-argument overloads; four-argument overload includes `p_enrolled_from date, p_email text` |
| API call in `supabase/functions/ylp-api/index.ts` | Sends four arguments | Sends four arguments |

Source locations in `main`: `createStudent` and `updateStudent` methods call `ylp_student_create_v1` and `ylp_student_update_v1` with `p_enrolled_from` and `p_email`.

### RPC security metadata

For the sampled account-management RPCs in both environments:

- Owner: `postgres`
- `SECURITY DEFINER`: enabled
- Fixed `search_path`: `pg_catalog, public`
- `anon EXECUTE`: denied
- `authenticated EXECUTE`: denied
- `service_role EXECUTE`: granted

The sampled RPCs are:
- `ylp_admin_account_create_profile_v1(uuid, text, text)`
- `ylp_admin_account_update_v1(uuid, text, text, boolean)`
- `ylp_admin_account_remove_profile_v1(uuid)`

The catalog snapshot also shows `ylp_authorize_admin_v1` is backend-only in both environments. Its per-environment function configuration differs: Staging has a fixed `search_path=pg_catalog, public`; Production has an empty search path. This difference should be reviewed against the actual function body and the intended hardening policy before changing it.

### `admin_profiles` table privileges

In both environments, direct `INSERT`, `UPDATE`, and `DELETE` are denied to `anon` and `authenticated`, but granted to `service_role`. The current `main` `ylp-api` account handlers call the corresponding account RPCs; the source audit of that file did not find direct `admin_profiles` table writes. This does **not** prove there are no alternate service-role writers elsewhere. The last-active-authority invariant must not be described as globally enforced until all writer paths are accounted for.

### Role constraint

Both environments currently have a role check accepting `super_admin`, `admin`, and `operator`.

### Migration history snapshot

- Staging migration ledger: 24 entries returned.
- Production migration ledger: 28 entries returned.

The ledgers differ and the repository has historical migration drift. These counts alone do not identify a safe reconciliation sequence. Do not replay, reorder, squash, or apply migrations solely from this report.

### Initial verification status (before the Staging migration)

| Check | Result | Evidence / limitation |
|---|---|---|
| Compare student columns | Confirmed mismatch | Read-only `information_schema.columns` query in both databases |
| Compare student RPC signatures | Confirmed mismatch | Read-only `pg_proc` catalog query in both databases |
| Account RPC ACL sample | Pass for sampled RPCs | `anon=false`, `authenticated=false`, `service_role=true` |
| Direct DML grants on `admin_profiles` | Public client roles denied; service role can write | Catalog privilege check |
| All backend writer paths | Not verified | Repository-wide search was inconclusive |
| Student create/update runtime behavior | Not tested | No synthetic request was sent |
| Staging/Production reconciliation | Not approved or performed | Requires separate review and explicit approval |

### Initial required actions (historical; update against the current status above)

1. Review the existing student contract reconciliation proposal (PR #130) against the current Staging and Production schemas, including backfill behavior for `enrolled_from`.
2. Add/confirm executable tests for the four-argument student RPC contract and optional-email handling in an isolated database or explicitly approved Staging test.
3. Audit all server-side paths that can write to `admin_profiles`; document whether each uses the serialized RPCs or another invariant-preserving mechanism.
4. Review the `ylp_authorize_admin_v1` search-path difference against both actual function definitions and intended security hardening.
5. Reconcile Git migrations, each environment's migration ledger, and actual schema before proposing any migration sequence.

### Initial safety note (historical pre-application snapshot)

The initial audit phase performed read-only SQL catalog queries and source inspection only. The later Staging-only migration application is documented below. Production and Staging must continue to be treated as separate environments.


### Authorization helper definition difference

A follow-up read-only definition comparison confirmed that `ylp_authorize_admin_v1(uuid, uuid)` has the same basic query intent in both environments: it returns an active profile only when the supplied admin ID matches a row in `auth.sessions` for the supplied session ID. Both versions are `SECURITY DEFINER` and deny `EXECUTE` to `anon` and `authenticated`, while granting it to `service_role`.

Differences:
- Staging uses `SET search_path TO 'pg_catalog', 'public'` and does not declare the SQL function `STABLE` (so it defaults to `VOLATILE`).
- Production uses `SET search_path TO ''` and declares the function `STABLE`.
- Both versions schema-qualify the referenced relations as `public.admin_profiles` and `auth.sessions`.

This is configuration/volatility drift, not evidence by itself of an authorization bypass. Production's empty search path is more restrictive; Staging should not be changed without a separate reviewed migration and explicit approval. Confirm whether the function is safe to mark `STABLE` under the intended behavior before harmonizing it.


## Follow-up review of student reconciliation PR #130

At the follow-up review, PR #130 remained Draft and unmerged. Its head commit was `91d832cd5e10fc3a5b39beec81b4780cd7eefa6e`, based on main `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.

The following GitHub Actions runs for that PR head were observed as completed successfully:
- `Student Schema PostgreSQL Regression`, run #3
- `Test`, run #369
- `Session Auto-Close PostgreSQL Regression`, run #25

The Student Schema PostgreSQL Regression workflow uses a disposable PostgreSQL service and a minimal synthetic pre-migration schema. This is useful executable regression evidence, but it is **not** proof that the migration is compatible with the actual Staging or Production schema, nor does it validate the live migration ledger. No live migration was applied.

### Review notes before any database application

- The SQL test file correctly checks that `anon` and `authenticated` cannot execute sampled Student RPCs and that `service_role` can execute the create RPC. The workflow's preliminary inline `anon` check is logically inverted/redundant; the subsequent SQL test currently performs the meaningful denial check. Correct the inline check to avoid confusing future readers.
- The migration backfills missing `enrolled_from` values from `created_at` in `Asia/Bangkok`, then sets the column `NOT NULL`. This is consistent with the documented intended business timezone but still needs validation against actual row counts, nullability, and data before applying to an environment.
- The migration drops the legacy two- and three-argument create/update overloads. Confirm all deployed callers and any other database functions that depend on those overloads before application; current `main` Edge Function calls the four-argument contract.
- The migration has not been applied to either environment. Its synthetic-schema workflow cannot replace the required live-schema and migration-ledger reconciliation.

Status remains: **Staging mismatch verified; remediation PR has promising isolated CI evidence, but live compatibility and deployment are not verified.**

### Follow-up: row profile, overload dependencies, and migration ledger detail

A second read-only pass checked the live Student rows and the exact legacy overload dependencies:

| Check | Staging | Production |
|---|---:|---:|
| Existing Student rows | 13 | 35 |
| Rows with `created_at IS NULL` | 0 | 0 |
| Rows with blank/null names | 0 | 0 |
| Non-null emails failing the proposed format check | Not applicable; column absent | 0 |

Production already has the `students_email_format_check` constraint with the same basic expression used by PR #130. These checks reduce known data-shape concerns, but do not establish that `created_at` is the approved business source for every historical enrollment date.

The exact latest migration ledger entries at this check were:

- Staging: `20261015094240` (`harden_global_function_default_execute`)
- Production: `20261013174134` (`secure_session_auto_close_scheduler`)

At the time of the pre-application audit, the PR #130 migration filename used version `20261015120000`, which was later than both then-current ledger maxima. That ordering alone did not resolve broader historical drift or prove the migration should be applied to Production.

A read-only `pg_depend` query found no catalog-tracked dependent objects referencing the Student create/update overloads in either database. This is not a complete application-caller audit: dynamic SQL, deployed application versions, and callers outside the current `main` Edge Function source are not covered. Production currently has both three-argument and four-argument create/update overloads; PR #130 intentionally drops the three-argument overloads. Keep that as a compatibility review item before any application.

The PR #130 workflow's preliminary anon privilege assertion was corrected in commit `7b89a990205c638b1540dc8c550753dddd9117da` to raise only when anon actually has EXECUTE. Follow-up GitHub Actions runs for that exact commit completed successfully: Student Schema PostgreSQL Regression run #4, Test run #380, and Session Auto-Close PostgreSQL Regression run #30. These are repository CI results using isolated test environments; they do not constitute live Staging/Production migration validation.

### Staging application and post-migration verification (2026-10-16)

With explicit approval scoped to Staging project `yvtgwzvjpztvztozcfir`, the Student schema/RPC reconciliation SQL from PR #130 was applied to Staging only. Production was not targeted by the migration operation.

Immediately before applying, read-only checks confirmed:
- Staging ledger latest version was `20261015094240` (`harden_global_function_default_execute`).
- Staging had 13 Student rows, with no null `created_at`.
- Neither `email` nor `enrolled_from` existed.
- Student create/update RPCs were still two-argument overloads; anon and authenticated could not execute them.

Post-apply verification confirmed:
- Supabase recorded the applied migration as version `20261016040903`, name `reconcile_student_schema_and_rpcs`.
- `students.enrolled_from` exists as `date NOT NULL DEFAULT CURRENT_DATE`; `students.email` exists as nullable `text`.
- Existing Student row count remains 13. No `enrolled_from` values are null, and every existing value matches `(created_at AT TIME ZONE 'Asia/Bangkok')::date`.
- The validated `students_email_format_check` constraint exists.
- Only the four-argument create/update RPC signatures remain, plus `ylp_students_v1()`. All three are `SECURITY DEFINER` with empty `search_path`; anon/authenticated EXECUTE is false, while service_role/postgres EXECUTE is true.
- The SQL regression behavior checks passed against Staging inside an explicit transaction followed by `ROLLBACK`. This exercised valid create, invalid email, missing email dot, blank-email normalization, control-character rejection, update semantics, list response fields, table constraint, and RPC ACLs. Follow-up verification confirmed the Student row count remained 13 and no transient test IDs remained.
- Production read-only verification still showed 35 Student rows, both expected columns already present, and no `reconcile_student_schema_and_rpcs` migration-name entry in its ledger. No Production migration was applied.

**Migration-ledger reconciliation follow-up:** after confirming Staging's recorded version `20261016040903`, PR #130's working branch was updated to rename the migration file to `20261016040903_reconcile_student_schema_and_rpcs.sql` and update the regression workflow and Node test path references. This is a repository-branch change only; it does not modify either database. The purpose is to make the repository version match Staging's already-applied ledger entry and avoid an accidental second migration during a future `db push`. The updated branch must pass CI and receive normal review before merge. Production has not received this migration.

CI for PR #130 commit `7b89a990205c638b1540dc8c550753dddd9117da` also passed: Student Schema PostgreSQL Regression #4, Test #380, and Session Auto-Close PostgreSQL Regression #30. These CI runs are separate from the Staging transaction checks described above.


### Latest PR #130 review update — 2026-10-16

The latest PR #130 head `82ec0f877d4ed54b232ba66493b59fefeb555af4` has all three observed CI workflows passing: Student Schema PostgreSQL Regression #6, Session Auto-Close PostgreSQL Regression #32, and Test #385. The API's current four-argument Student create/update calls match the new RPC signatures. This is not an approval to merge. A repository source search does not establish whether any external or previously deployed caller still depends on Production's legacy three-argument overloads; treat that as an unresolved compatibility question. PR #130 remains Draft/open/unmerged.


### Production legacy RPC compatibility review — 2026-10-16

A targeted source review compared the current `main` Edge Function, frontend API client, Student-related migrations, and available tests:

- The current `supabase/functions/ylp-api/index.ts` calls `ylp_student_create_v1` and `ylp_student_update_v1` with four named arguments, including `p_email`.
- The frontend `src/api.js` uses the application's API request layer; the frontend does not directly call the Supabase Student RPCs in the reviewed source.
- The repository's historical Student migration `20260928210000_lock_attendance_enrollment_rules.sql` defines the three-argument create/update overloads. `20260928155309_add_optional_student_email.sql` defines the four-argument versions and optional email behavior. The current PR #130 migration drops the legacy two- and three-argument overloads.
- No additional direct Student RPC invocation was identified in the files reviewed. This is limited to the tracked source and tests inspected; it cannot rule out older deployed Edge Function versions, external scripts, manual SQL clients, or other callers outside this repository.

**Conclusion:** The current repository's API contract uses four arguments, but Production compatibility is not fully proven for removal of the three-argument overloads. Preserve this as a release gate until deployed callers and external integrations are accounted for. No database change or deployment was made during this review.

### Live deployed caller and historical query-statistics review — 2026-10-16

A read-only check of Supabase's live Edge Function inventory confirmed:

- Production `ylp-api` is ACTIVE at version 43, SHA `c201461db172288cb41ba7d654f20a46123dcc6cc922b784da2aa106f71b9e51`.
- Staging `ylp-api` is ACTIVE at version 50, SHA `540a4d6db58f4d86b3d92ee6ceb4cea7a34ebecb872aaf0caf31042f062f9e39`.
- The retrieved deployed `index.ts` code in both projects uses the four-argument `ylp_student_create_v1` and `ylp_student_update_v1` RPC contract (`p_student_id`, `p_name`, `p_enrolled_from`, `p_email`). This confirms the deployed Edge Function source currently inspected, not every historical deployment or external client.

Production's read-only `pg_stat_statements` data records historical query shapes that supplied only the two named Student arguments; it does not identify the resolved function OID:

| Query pattern in PostgreSQL statistics | Calls recorded |
|---|---:|
| `ylp_student_create_v1` with two named arguments | 11 |
| `ylp_student_update_v1` with two named arguments | 2 |
| `ylp_student_create_v1` with four named arguments | 36 |
| `ylp_student_update_v1` with four named arguments | 1 |
| `ylp_students_v1()` | 42 |

The database statistics reset timestamp observed was `2026-08-25 20:33:23+00`; the two-argument create/update query entries report `stats_since` dates of 2026-09-26. These counters do **not** expose the last execution timestamp, so they prove historical two-argument calls were recorded but do not establish whether those callers remain active. The statistics query did not return a runtime call pattern for the three-argument overload; absence from this aggregate is not proof that no such caller exists.

A read-only search of Production's Supabase `edge_logs` for the 24-hour window `2026-10-15T04:00:00Z` through `2026-10-16T04:00:00Z` found no requests whose logged RPC path contained `ylp_student_create_v1`, `ylp_student_update_v1`, or `ylp_students_v1`. This only describes that queried log window and is not proof of no usage outside it. PostgreSQL function-call statistics were unavailable from `pg_stat_user_functions` (no rows returned), so that view could not independently establish overload-specific call counts.

**Updated release decision:** Do not remove legacy payload support without a compatibility-safe replacement. The current four-argument update RPC defaults `p_email` to NULL; a caller that omits `p_email` can therefore unintentionally clear an existing email if the request resolves to the four-argument function. The current repository API always supplies all four arguments, but older clients may not. The recorded query shapes are not enough to prove which overload resolved or whether old clients remain active. A compatibility-first approach is to remove defaults from the four-argument functions and provide explicit 2-/3-argument wrappers, with legacy update wrappers preserving email, all under `service_role` / `postgres` ACLs. PR #130 is being updated to test this approach; its follow-up migration has not been applied to either environment. No Production database or deployment change was made during this review.

**Important interpretation limitation:** The `pg_stat_statements` query text records the named arguments supplied by the PostgREST request, not the resolved function OID. A request containing only `p_student_id` and `p_name` could resolve to a three-argument overload if `p_enrolled_from` has a default and the exact two-argument overload is absent. Because these statistics do not expose the last execution time or the resolved overload OID, the 11 create and 2 update calls cannot be safely classified as calls to the historical two-argument functions versus calls resolved to a defaulted three-argument function, nor can they be placed entirely before or after the 2026-09-28 migration activity. This uncertainty is directly relevant to PR #130's removal of the three-argument overloads; the release gate remains in place.

### Production overload defaults and targeted query-shape check

A further read-only catalog check confirmed the current Production overload defaults:

- Three-argument create: `p_enrolled_from date DEFAULT CURRENT_DATE`.
- Three-argument update: `p_enrolled_from date DEFAULT NULL`.
- Four-argument create: `p_enrolled_from date DEFAULT CURRENT_DATE, p_email text DEFAULT NULL`.
- Four-argument update: `p_enrolled_from date DEFAULT NULL, p_email text DEFAULT NULL`.

A focused `pg_stat_statements` query looking for a Student create invocation that includes `p_enrolled_from` but not `p_email` returned no rows. This is limited evidence only: statistics can be reset/evicted, query text is not a resolved overload OID, and it does not establish whether three-argument external calls occurred outside the retained statistics.

Because both three- and four-argument functions have defaulted parameters, do not infer overload resolution from argument count alone. Keep PR #130's compatibility gate until the exact client payload contract and PostgREST overload resolution are verified in a disposable environment or by equivalent safe evidence. No Production function was invoked for this check and no database changes were made.

### Follow-up: legacy update payload semantic compatibility — 2026-10-16

Reviewing the actual Production function definitions identified a more concrete compatibility concern than the historical query counters alone: the four-argument `ylp_student_update_v1` has `p_email DEFAULT NULL` and sets `students.email = v_email`. If an older update client omits `p_email` and the call resolves to that four-argument function, the omitted email is normalized to NULL and an existing email could be cleared. Historical update wrappers did not have an email parameter and did not change the email column.

PR #130 now has a follow-up migration proposal (not applied) to:
- remove default values from the four-argument create/update RPC signatures;
- restore explicit two- and three-argument create/update wrappers to preserve supported legacy payload shapes without overlapping default-argument resolution;
- keep legacy update wrappers from changing the email column;
- enforce `SECURITY DEFINER`, empty `search_path`, and explicit `service_role` / `postgres` EXECUTE grants while denying `PUBLIC`, `anon`, and `authenticated`;
- add disposable PostgreSQL regression checks for two- and three-argument create/update behavior, including email preservation.

The follow-up migration is committed on the PR #130 branch as `supabase/migrations/20261016100000_preserve_legacy_student_rpc_contracts.sql`. It has **not** been applied to Staging or Production. CI for the updated head has not yet been confirmed at the time of this note. Before applying the follow-up to Staging, review the migration against the exact live post-PR-130 schema and require a separate explicit approval. Production remains untouched.

### Latest PR #130 compatibility migration regression — 2026-10-16

The first disposable PostgreSQL run for the compatibility migration failed because PostgreSQL does not permit removing existing parameter defaults using `CREATE OR REPLACE FUNCTION`. The migration was corrected to drop and recreate the reviewed Student create/update overload set inside the migration transaction, then reapply explicit ACLs. A follow-up test assertion was also corrected to expect the enrollment date before and after each legacy update at the appropriate point.

Latest PR #130 head `e38a05733ba75a2ed496c95dfb24995b9d54d294` has these observed completed-successful GitHub Actions runs:
- Student Schema PostgreSQL Regression #16 (run ID `38850840634`): both migrations applied to a disposable PostgreSQL 17 schema; legacy 2-/3-argument create/update payload behavior, email preservation, no-default contract, `SECURITY DEFINER`, empty `search_path`, and role ACL checks passed.
- Session Auto-Close PostgreSQL Regression #42 (run ID `38850840649`).
- Test #402 (run ID `38850840612`): `npm test` and `npm run test:browser` passed.

This is isolated CI evidence only. The follow-up compatibility migration remains unapplied to Staging and Production. PR #130 remains Draft/open/unmerged; Staging application requires separate explicit approval, and Production remains untouched.

**Latest security refinement:** PR #130 head was subsequently advanced to `c3cd75683fd25e3fbe1489d2f5704d2c34003fa2`. The compatibility migration now revokes `PUBLIC`, `anon`, and `authenticated` EXECUTE immediately after each function creation, before the final explicit `service_role` / `postgres` grants. All three workflows passed on that exact head: Student Schema PostgreSQL Regression #17 (run ID `38851005741`), Session Auto-Close PostgreSQL Regression #43 (run ID `38851005737`), and Test #404 (run ID `38851005736`, including `npm test` and `npm run test:browser`). The migration remains unapplied to both live environments.
