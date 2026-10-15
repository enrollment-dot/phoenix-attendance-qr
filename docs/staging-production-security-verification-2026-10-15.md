# YLP Attendance — Staging and Production Security Verification

**Verified:** 2026-10-15 (Asia/Bangkok)  
**Scope:** Read-only Supabase catalog and migration-ledger queries, plus GitHub Actions status checks. No Production or Staging database was modified during this verification pass.

## 1. Environment comparison

| Check | Staging | Production |
|---|---:|---:|
| Supabase project ID | `yvtgwzvjpztvztozcfir` | `fsxdsdixxnslismxghfz` |
| Migration ledger entries | 24 | 28 |
| Public base tables | 9 | 9 |
| Public tables with RLS enabled | 9 | 9 |
| `SECURITY DEFINER` functions | 23 | 26 |
| `SECURITY DEFINER` functions executable by `anon` or `authenticated` | 0 | 0 |
| `SECURITY DEFINER` functions without explicit `search_path` | 0 | 0 |
| `students.email` and `students.enrolled_from` columns | Absent | Present |
| Existing `extensions` functions executable by `anon` | 54 | 54 |
| Existing `extensions` functions executable by `authenticated` | 54 | 54 |

These are point-in-time catalog results. Equal counts do not prove that function definitions, policies, RPC contracts, or application behavior are identical.

## 2. Default function EXECUTE privileges

### Staging

The previously approved migration `20261015150000_harden_global_function_default_execute.sql` is reflected in the live catalog:

- Global default ACL for functions created by `postgres`: `postgres=X/postgres`.
- `public`-schema default ACL for functions created by `postgres`: `postgres=X/postgres, service_role=X/postgres`.
- No `anon` or `authenticated` execution privilege was found on current `SECURITY DEFINER` functions.
- This migration changed defaults for future functions; it did not rewrite existing function ACLs.

### Production

Production is not yet aligned with that Staging default-ACL change:

- No global `postgres` function default-ACL row was returned by the catalog query; PostgreSQL's built-in global default therefore remains relevant.
- The `public`-schema default ACL includes `anon` and `authenticated` as well as `postgres` and `service_role`.
- Despite these defaults, the current catalog query found zero `SECURITY DEFINER` functions executable by `anon` or `authenticated`. Current function ACLs and future-function defaults are distinct checks.

**Conclusion:** Production has not received the Staging default-ACL hardening. Do not infer Production is protected by Staging's migration. A Production rollout is a separate security change and requires explicit approval.

## 3. Student schema drift

- Staging `public.students` columns: `active, created_at, name, student_id, updated_at`.
- Production `public.students` columns: `active, created_at, email, enrolled_from, name, student_id, updated_at`.

This confirms the student-schema discrepancy remains live. PR #130's proposed reconciliation has not been applied in this audit. The proposed `enrolled_from` backfill from `created_at` has a business-data correctness risk and must not be applied without acceptance of that assumption and a separately approved rollout.

## 4. Migration ledger drift

- Staging: 24 recorded entries.
- Production: 28 recorded entries.
- The version lists differ substantially.

Ledger counts are inventory only; they are not a migration replay plan. Before reconciling, compare migration source files, exact live definitions, constraints, grants, and each environment's migration history. Do not reorder, delete, squash, or replay historical migrations casually.

## 5. CI and pull-request state

- PR #131 head: `a3ee1ed1a0e20fa279866a563efa08194a4f490d`.
  - GitHub `Test` run #373: **success**.
  - `Session Auto-Close PostgreSQL Regression` run #29: **success**.
  - PR remains draft/open/unmerged.
- PR #125 documentation head: `faaeb050ded78360cba24e8e8d4de29c8dc9c7de`.
  - GitHub `Test` run #374: **success**.
  - PR remains open/unmerged.

CI validates the committed test suite, not production runtime behavior. No PR was merged as part of this verification.

## 6. Extension compatibility carve-out — pending decision

PR #131 includes `20261015160000_preserve_extensions_function_default_execute.sql`, which restores `PUBLIC EXECUTE` as the default for future functions created by `postgres` in the `extensions` schema. This is a compatibility carve-out from the global revoke.

- The follow-up migration has **not** been applied to Staging or Production.
- Existing `extensions` function privileges are already broad in both environments (54 functions executable by each client role in the sampled catalog query).
- The carve-out intentionally retains broad execution for future extension functions; its compatibility benefit and security trade-off require review.
- Do not apply it or merge PR #131 without the relevant explicit approval.

## 7. Verification limits and next actions

Not verified by these queries: frontend login, live RBAC flows, QR scanning, valid-secret scheduler positive-path execution, complete API-to-RPC behavior, or whether the current custom domain serves a specific SHA. Vercel READY/provider checks are not end-to-end runtime evidence.

Next safe actions:
1. Continue read-only comparison of RPC signatures/definitions and relevant ACLs in both projects.
2. Review the extension compatibility carve-out before requesting approval for any migration.
3. Keep PR #130 blocked on business acceptance of the enrollment-date backfill.
4. Keep Production unchanged until a specific production change is reviewed and approved.
5. Update this report with new evidence rather than treating older handoff counts as current.
