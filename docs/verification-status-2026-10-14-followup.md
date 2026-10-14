# YLP Attendance — Verification Follow-up

**Verified at:** 2026-10-14  
**Base commit:** `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`  
**Scope:** Read-only review of GitHub, Supabase Staging/Production, and available Vercel status metadata. No database, Auth, Edge Function, environment, account, or attendance data was changed.

## GitHub and CI

- `main` points to `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.
- PR #124 is merged. It aligns the branding hardening migration filename with the version already recorded by Staging; it does not apply SQL.
- Checks for the merge commit passed: `test`, `postgres-regression`, `auto-close-staging`, and `auto-close-production`.
- The GitHub branch API reports `main` as unprotected (`protected: false`). This is a repository-governance gap; no repository settings were changed during this audit.
- PR #102 remains open and is not merged. Its branch is 1 commit ahead and 33 commits behind current `main`; its only changed file is `20261011101546_allow_super_admin_role_constraint.sql`. Do not merge the stale branch blindly.
- **Staging scheduler negative-auth workflow passed:** [Run #2](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38521682488), commit `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`. The job `reject-unauthenticated-scheduler-calls` completed successfully; the step verifies both missing and invalid scheduler secrets against the Staging endpoint. This does not test valid-secret scheduler execution.

### Follow-up CI verification — 2026-10-14

- PR #125 head `16120ce614bafcdf605126c0dfcdea1fd96c7613` passed GitHub Actions run [#349](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38524385004), including `npm test` and `npm run test:browser`.
- Commit `07f8ec90f0ad77a99e80a454c03d33abe058e1f4` passed GitHub Actions run [#350](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/38532163958), including `npm test` and `npm run test:browser`. The current PR #125 head has since advanced to `e5f753cd448b6e74d025edb1ca5ea778e0eeff92` with a docs-only commit. Run #350 is therefore for the parent commit, not the exact current head; the current head's latest combined status currently shows the two Vercel checks as successful, but a fresh GitHub Actions test run for this exact SHA has not been verified.
- GitHub Vercel status checks on current PR head report success for both Staging and Production project preview deployments: [Staging](https://vercel.com/chillvibesonlyphyo-9992/phoenix-attendance-rbac-staging/9Yo385yGzSoD2uPrqFZS5SfAvWzM) and [Production project deployment](https://vercel.com/chillvibesonlyphyo-9992/phoenix-attendance-rbac-production/BJs7sHebhKMDDJ51GRMErcKxRUb8). These are provider status signals only; direct Vercel API access returned 403/404 for project/deployment detail, so they do not independently prove the custom domain is serving this exact SHA.
- PR #125 remains open and unmerged. Its changes are documentation-only; do not merge without the normal review/approval decision.

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

### Scheduler migration comparison

- Git contains `20261012120000_secure_session_auto_close_scheduler.sql` and `20261014120000_secure_session_auto_close_scheduler.sql`.
- Neither Staging nor Production records the exact version `20261014120000`; both already have the scheduler function recorded under environment-specific versions (`20261012052803` in Staging and `20261013174134` in Production).
- Both files define the same core eligibility rule: only active sessions whose scheduled end plus 15 minutes has elapsed in `Asia/Bangkok`, processing up to 100 rows with `FOR UPDATE SKIP LOCKED`.
- The older file explicitly grants EXECUTE to `postgres` and includes a post-migration ACL assertion block. The newer file omits both. The currently inspected live ACLs already permit `postgres` and `service_role` while denying `anon` and `authenticated`.
- These files are not byte-equivalent and should not both remain as competing migration candidates. **No file was renamed, deleted, reordered, or applied during this audit.** The next action remains a focused repository-only decision on canonical history after checking the full live function definition and migration ledger; do not apply either migration again as part of that decision.

### Role constraint capture gap

The live `admin_profiles_role_check` constraint allows `admin`, `operator`, and `super_admin` in both environments. Staging records `20261011101546_allow_super_admin_role_constraint`, but the corresponding migration file is only in open PR #102, not current `main`. Production already has the equivalent allowed-role constraint. PR #102 is 33 commits behind `main`; its migration drops and recreates the constraint. Do not merge the stale branch or apply the migration to either database without a deliberate reconciliation plan. A repository capture must avoid creating a migration that would unexpectedly replay against Production.

## Vercel verification limits

- GitHub Vercel status checks report Staging and Production project preview deployments as successful for PR #125 head `16120ce614bafcdf605126c0dfcdea1fd96c7613`.
- Direct Vercel project/deployment detail calls remain inaccessible through the current team scope `chillvibesonlyphyo-9992` (403/404). This audit does not claim independent verification of the exact live deployment Git SHA, custom-domain mapping, or end-to-end browser behavior.
- Do not repeat the same unauthorized calls unchanged. Use a supported authenticated Vercel connection/CLI when available.

## Supabase Security Advisor

Staging still reports:
- INFO: nine RLS-enabled tables without policies.
- WARN: leaked-password protection disabled.

Do not add broad RLS policies merely to silence the INFO finding. No plan upgrade or Auth change is authorized by this audit.

## Next steps

1. Reconcile the duplicate scheduler migration files and live migration histories in a repository-only change; do not apply SQL.
2. Decide how to capture the already-applied Staging role-constraint migration without accidentally replaying it against Production.
3. Investigate a supported approach for the `supabase_admin` default function ACL. Do not bypass PostgreSQL platform protections.
4. Prepare a separate Production helper-function ACL migration only after explicit approval.
5. Reauthorize the Vercel connection/team scope so deployment SHA/domain mapping can be independently verified.
6. Consider enabling required status checks and branch protection for `main`; no repository settings were changed here.
7. If scheduler positive-path verification is needed, design a Staging-only test using a valid secret and controlled safe fixture; the current negative-auth workflow deliberately does not exercise valid-secret execution.

## Safety statement

No Production SQL, migration, ACL, RLS, Auth, Edge Function, environment-variable, account, or attendance-data changes were performed during this verification. Production security remediation remains gated by separate explicit approval.
