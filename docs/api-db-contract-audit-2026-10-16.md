# API ↔ RPC ↔ Database Contract Audit — 2026-10-16

## Purpose and scope

This is a read-only verification snapshot of the SIFer Lab Attendance Web App's Staging and Production Supabase database contracts, compared with the current `main` Edge Function source. It records observed facts and follow-up requirements; it does not authorize a database migration or deployment.

Repository: `enrollment-dot/phoenix-attendance-qr`  
Main SHA at audit start: `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`  
Edge Function: `ylp-api`  
Audit date: 2026-10-16

## Executive finding

**BLOCKED: Student create/update contract is inconsistent in Staging.** The current `main` Edge Function calls the student create/update RPCs with `p_student_id`, `p_name`, `p_enrolled_from`, and `p_email`. Production has matching four-argument overloads and the required columns. Staging has only two-argument RPC signatures and lacks `enrolled_from` and `email` columns. A four-argument call is therefore expected to fail in Staging unless another unobserved path changes the contract. This is a catalog-based finding; no synthetic runtime request was sent.

## Verified facts

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

## Verification status

| Check | Result | Evidence / limitation |
|---|---|---|
| Compare student columns | Confirmed mismatch | Read-only `information_schema.columns` query in both databases |
| Compare student RPC signatures | Confirmed mismatch | Read-only `pg_proc` catalog query in both databases |
| Account RPC ACL sample | Pass for sampled RPCs | `anon=false`, `authenticated=false`, `service_role=true` |
| Direct DML grants on `admin_profiles` | Public client roles denied; service role can write | Catalog privilege check |
| All backend writer paths | Not verified | Repository-wide search was inconclusive |
| Student create/update runtime behavior | Not tested | No synthetic request was sent |
| Staging/Production reconciliation | Not approved or performed | Requires separate review and explicit approval |

## Required next actions

1. Review the existing student contract reconciliation proposal (PR #130) against the current Staging and Production schemas, including backfill behavior for `enrolled_from`.
2. Add/confirm executable tests for the four-argument student RPC contract and optional-email handling in an isolated database or explicitly approved Staging test.
3. Audit all server-side paths that can write to `admin_profiles`; document whether each uses the serialized RPCs or another invariant-preserving mechanism.
4. Review the `ylp_authorize_admin_v1` search-path difference against both actual function definitions and intended security hardening.
5. Reconcile Git migrations, each environment's migration ledger, and actual schema before proposing any migration sequence.

## Safety note

This audit performed read-only SQL catalog queries and source inspection only. No database data, schema, grants, secrets, Edge Function deployment, Vercel deployment, or account was changed. Production and Staging must continue to be treated as separate environments.


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

The proposed PR #130 migration version `20261015120000` is later than both current ledger maxima, but this ordering alone does not resolve the broader historical drift or prove the migration should be applied to Production.

A read-only `pg_depend` query found no catalog-tracked dependent objects referencing the Student create/update overloads in either database. This is not a complete application-caller audit: dynamic SQL, deployed application versions, and callers outside the current `main` Edge Function source are not covered. Production currently has both three-argument and four-argument create/update overloads; PR #130 intentionally drops the three-argument overloads. Keep that as a compatibility review item before any application.

The PR #130 workflow's preliminary anon privilege assertion was corrected in commit `7b89a990205c638b1540dc8c550753dddd9117da` to raise only when anon actually has EXECUTE. Follow-up GitHub Actions runs for that exact commit completed successfully: Student Schema PostgreSQL Regression run #4, Test run #380, and Session Auto-Close PostgreSQL Regression run #30. These are repository CI results using isolated test environments; they do not constitute live Staging/Production migration validation.
