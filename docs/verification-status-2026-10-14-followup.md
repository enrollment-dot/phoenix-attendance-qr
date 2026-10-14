# YLP Attendance — Verification Follow-up

**Verified at:** 2026-10-14  
**Base commit:** `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`  
**Scope:** Read-only review of GitHub, Supabase Staging/Production, and available Vercel status metadata. No database, Auth, Edge Function, environment, account, or attendance data was changed.

## GitHub and CI

- `main` points to `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.
- PR #124 is merged. It aligns the branding hardening migration filename with the version already recorded by Staging; it does not apply SQL.
- Checks for the merge commit passed:
  - `test`
  - `postgres-regression`
  - `auto-close-staging`
  - `auto-close-production`
- The GitHub branch API currently reports `main` as unprotected (`protected: false`). This is a repository-governance gap; no repository settings were changed during this audit.
- PR #102 remains open and is not merged. It captures the Staging role constraint migration `20261011101546_allow_super_admin_role_constraint`. Before deciding its disposition, reconcile its older branch/base with current `main`. Do not merge it blindly.

## Supabase project health and current scheduler state

Both Supabase projects report `ACTIVE_HEALTHY`.

| Read-only check | Staging | Production |
| --- | ---: | ---: |
| Recorded migration entries | 23 | 28 |
| Public tables | 9 | 9 |
| Public tables with RLS enabled | 9 | 9 |
| RLS-enabled tables with no policies | 9 | 9 |
| `SECURITY DEFINER` functions | 20 | 23 |
| `SECURITY DEFINER` functions executable by client roles | 0 | 0 |
| `SECURITY DEFINER` functions without explicit `search_path` | 0 | 0 |
| Active sessions | 0 | 0 |
| Closed sessions | 15 | 4 |
| Overdue active sessions | 0 | 0 |

For the nine public tables in both environments, direct `SELECT` privileges for `anon`, `authenticated`, and `PUBLIC` were not present in the queried ACLs. RLS remains enabled without policies, consistent with the current service-mediated architecture only while direct client table grants remain absent and the Edge Function continues to authorize every protected action.

### Function ACL details

- Staging's three reviewed helper functions (`ylp_advisory_key_v1`, `ylp_is_uuid_v4_v1`, `ylp_scan_rejection_v1`) are not executable by `PUBLIC`, `anon`, or `authenticated`; `service_role` execution is retained.
- Production still permits client execution of those same three **non-`SECURITY DEFINER`** immutable helper functions. The inspected bodies do not directly read student/attendance tables or mutate data, so this is a least-privilege inconsistency, not evidence by itself of data exposure. A Production ACL change requires separate explicit approval.
- The `postgres` default function ACL in Staging's `public` schema no longer grants execution to `anon` or `authenticated`.
- The `supabase_admin`-owned default function ACL still grants execution to `anon` and `authenticated`. The available migration connection cannot alter this owner-specific default ACL (PostgreSQL `42501`). Do not bypass the restriction through role membership or platform-role changes. Continue using explicit restrictive grants in migrations and investigate a supported privileged path.
- The two branding `SECURITY DEFINER` RPCs in Staging have `search_path = pg_catalog, public`, with execution restricted to `postgres` and `service_role`.

## Migration drift — do not auto-reconcile

The repository currently contains 25 migration files, while Staging records 23 entries and Production records 28. Many history versions and names differ. These counts are inventory indicators only; they are not a safe replay plan.

A noteworthy item requires investigation before any future database action:

- Git contains `20261014120000_secure_session_auto_close_scheduler.sql`.
- Neither Staging nor Production records that exact migration version.
- Both databases already have the scheduler function, recorded under environment-specific historical versions (`20261012052803` in Staging and `20261013174134` in Production).
- Git also contains an earlier scheduler migration file, `20261012120000_secure_session_auto_close_scheduler.sql`.

Do not apply either migration again or alter migration history until the SQL, live function definition, and intended canonical migration are reconciled. Do not reorder, squash, delete, or fabricate historical entries.

The live `admin_profiles_role_check` constraint allows `admin`, `operator`, and `super_admin` in both environments. Staging records `20261011101546_allow_super_admin_role_constraint`, but the corresponding migration file is still only in open PR #102, not in current `main`. Production already has the equivalent allowed-role constraint. Resolve this repository capture gap after reviewing PR #102 against current `main`; do not infer that the Production change should be applied again.

## Vercel verification limits

- The Vercel Staging project metadata reports its latest deployment as `READY`.
- GitHub's Vercel Staging and Production status checks for the current merge commit report `success`.
- Direct Vercel deployment-detail and project-domain API calls returned `403 forbidden` for team scope `chillvibesonlyphyo-9992`. Therefore this audit does not claim independent verification of the exact deployment's Git SHA, custom-domain mapping, or end-to-end browser behavior.
- Do not repeat the same unauthorized calls unchanged. Use a supported authenticated Vercel connection/CLI when available.

## Supabase Security Advisor

Staging still reports:
- INFO: nine RLS-enabled tables without policies.
- WARN: leaked-password protection disabled.

Do not add broad RLS policies merely to silence the INFO finding. The current Free Plan/Auth limitation is documented; no plan upgrade or Auth change is authorized by this audit.

## Next steps

1. Review PR #102 and capture the already-applied Staging role-constraint migration in a focused, current branch without replaying it against Staging.
2. Reconcile the duplicate scheduler migration files with actual Staging/Production migration histories and live function definitions. Do not apply SQL as part of this investigation.
3. Continue the Staging-only scheduler negative-auth workflow for missing and invalid secrets. The workflow exists as a manual-dispatch workflow; this audit did not dispatch it.
4. Investigate a supported approach for the `supabase_admin` default function ACL. Do not bypass PostgreSQL platform protections.
5. Prepare a separate Production helper-function ACL migration only after explicit approval.
6. Address Vercel team-scope access so deployment SHA/domain mapping can be independently verified.
7. Consider enabling required status checks and branch protection for `main`; no repository settings were changed here.

## Safety statement

No Production SQL, migration, ACL, RLS, Auth, Edge Function, environment-variable, account, or attendance-data changes were performed during this verification. Production security remediation remains gated by separate explicit approval.
