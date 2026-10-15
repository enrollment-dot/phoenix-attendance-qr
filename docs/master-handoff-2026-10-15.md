# SIFer Lab Attendance — Master Handoff

**Updated:** 2026-10-15  
**Repository:** `enrollment-dot/phoenix-attendance-qr`  
**Production:** https://ylp.siferlab.space  
**Supabase Edge Function:** `ylp-api`  
**Purpose:** Continue from the verified state below. Do not restart the project or assume environments are synchronized.

## 1. Current operating rules

- Source-of-truth order: GitHub `main`, Supabase Production, Vercel Production, current handoff documents, then historical chat.
- Production and Staging must be checked independently.
- Never perform destructive production actions, account/role/email/password changes, schema/security-policy changes, environment changes, migration applications, deployments, or merges without the specific approval required for that action.
- “Next” means continue safe read-only work and code/documentation work; it is not approval to merge or modify a database.
- Frontend RBAC is not a security boundary. Verify authorization in `ylp-api`, RPC definitions, and PostgreSQL ACLs.
- Do not replay/reorder/squash historical migrations or use `supabase db push` to work around migration drift without a reviewed reconciliation plan.

## 2. Environments and architecture

Browser → Vercel frontend → Supabase Edge Function (`ylp-api`) → PostgreSQL/RPC → Supabase Auth.

- Production Supabase project: `fsxdsdixxnslismxghfz`
- Staging Supabase project: `yvtgwzvjpztvztozcfir`
- Production domain: `https://ylp.siferlab.space`
- Main SHA observed in the latest handoff evidence: `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`
- Staging Edge Function was previously observed active at v50; Production at v43. Recheck before relying on these version numbers.
- Vercel READY status proves deployment state only, not login, RBAC, QR scanning, or complete end-to-end behavior.

## 3. RBAC and product invariants

Roles: `super_admin`, `admin`, `operator`.

- `super_admin`: full management, including Students, Sessions, Accounts, and destructive operations.
- `admin`: normal Student, Session, and attendance management; no Accounts access; cannot delete Students or Sessions.
- `operator`: normal session/attendance operations only; no Students or Accounts access and no destructive operations.
- Student and Session destructive actions require `super_admin`, fresh username/password re-authentication, same-account verification, and rate limiting.
- Preserve the safeguard that prevents removal/deactivation of the last active administrative authority.
- Account email is managed through the server-side Supabase Auth Admin API. Never expose service-role credentials in the browser.
- Student email is optional; blank email becomes `NULL`; server-side validation is required.
- Attendance window is fixed at UTC+07:00: 30 minutes before session start through 15 minutes after session end. Do not change without product approval.
- `scan_in` and `scan_out` are separate. “Late” is not equivalent to “Not Scanned Out.”
- Live sessions must not be counted as completed sessions.

## 4. Current security work — PR #131

PR: https://github.com/enrollment-dot/phoenix-attendance-qr/pull/131  
Branch: `security/global-function-default-acl-hardening`  
Latest known head before the latest test-fix commit: `8ac30e550be2ca7817bf5fca00345453b472e7de`. The test-fix commit was then created as `a3ee1ed1a0e20fa279866a563efa08194a4f490d`; re-fetch the PR head and CI before proceeding.

### Migration status

- `20261015150000_harden_global_function_default_execute.sql` was applied to **Staging only** after explicit approval.
- The applied migration revokes global default EXECUTE from `PUBLIC` for future functions created by `postgres`, and excludes `anon`/`authenticated` from future `public`-schema functions.
- A read-only post-apply check reported the global default ACL as `postgres=X/postgres`; public-schema default ACL as `postgres=X/postgres, service_role=X/postgres`.
- No Production database change was made.
- Follow-up migration `20261015160000_preserve_extensions_function_default_execute.sql` adds a schema-specific `PUBLIC EXECUTE` default for future functions created in `extensions`, to preserve extension compatibility. **It has not been applied to Staging or Production and needs separate explicit approval before application.**
- The carve-out is a compatibility tradeoff: it preserves broad execution on future extension functions in that schema. Review the scope and test before any rollout.
- Existing function ACLs are not changed by either default-privilege migration. `supabase_admin` defaults are not addressed.

### CI failure and next action

- The PostgreSQL regression workflow for the prior PR head passed.
- The `Test` workflow failed at `npm test`: 45 passed, 1 failed. The failed test was `extension compatibility carve-out affects defaults only`; the assertion incorrectly expected a phrase across a SQL comment line prefix. A narrow test-only correction was committed as `a3ee1ed1a0e20fa279866a563efa08194a4f490d`.
- Next: fetch PR #131 latest head, wait for/check CI on that exact SHA, inspect any remaining failure, then review the final diff. Do not merge without explicit approval.

## 5. Student schema reconciliation — PR #130

PR: https://github.com/enrollment-dot/phoenix-attendance-qr/pull/130  
- Open draft, not merged; latest known head `91d832cd5e10fc3a5b39beec81b4780cd7eefa6e`.
- Proposed migration adds `enrolled_from` (backfilled from `created_at`), nullable `email`, and aligns student list/create/update RPC contracts.
- Important business risk: `created_at` may not represent the true enrollment date. Obtain business acceptance before applying the migration.
- Staging was previously found missing `email` and `enrolled_from`, while Production has them. Recheck current schema before acting.
- No live migration has been applied for PR #130. Do not merge without explicit approval.

## 6. Migration drift

Previously verified inventory (2026-10-14): Production 28 ledger entries, Staging 23, repository `main` 25 migration files. These are historical counts and must be refreshed before making decisions. Drift is technical debt, not automatically a security incident.

Before any reconciliation:
1. Compare Git migration files with both migration ledgers.
2. Inspect actual schemas, function definitions, and ACLs in each environment.
3. Identify logically equivalent migrations recorded under different IDs.
4. Produce a safe reconciliation plan; never replay old migrations based on counts alone.

## 7. Scheduler / auto-close

- Staging scheduler and negative-auth regression workflow exist.
- Negative-auth success verifies missing/invalid secrets are rejected; it does not prove valid-secret execution or automatic closure of an eligible session.
- Earlier read-only checks found no active sessions to serve as a safe fixture.
- The scheduled close behavior must retain the +07:00 time interpretation and the existing 15-minute post-end grace period.
- Verify a controlled Staging positive-path fixture before claiming full scheduler verification. Do not create/alter production sessions for testing without explicit approval.

## 8. Current CI / release posture

- Main SHA last documented: `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.
- PR #125 (documentation follow-up): https://github.com/enrollment-dot/phoenix-attendance-qr/pull/125 — open, unmerged; docs-only.
- PR #126 (duplicate scheduler migration candidate): open draft; do not merge without review.
- PR #130 (student schema reconciliation): open draft; business acceptance needed for enrollment-date backfill.
- PR #131 (default function EXECUTE ACL hardening): open draft; one test-only fix just committed, CI must be rechecked.
- Do not merge any PR automatically. Confirm current head SHA, CI, changed files, and review status immediately before a merge decision.

## 9. Verification checklist

For every meaningful feature, verify all relevant layers:

1. UI behavior
2. Edge Function/API contract
3. Server-side authorization
4. RPC/function definition
5. PostgreSQL EXECUTE ACL and RLS/policies
6. CI regression coverage
7. Vercel deployment and deployed SHA
8. Actual environment behavior (Staging first; Production only when safe and authorized)
9. Documentation and handoff update

Required code checks: `npm test` and `npm run test:browser`. Security/RBAC changes require regression tests.

## 10. Immediate next steps

1. Re-fetch PR #131 and check CI for the latest head after commit `a3ee1ed1a0e20fa279866a563efa08194a4f490d`.
2. Review the default-ACL migration pair and compatibility tradeoff; keep the follow-up migration unapplied until separately approved.
3. Refresh PR #125 documentation with any verified new findings and re-check its CI.
4. Continue read-only Staging/Production verification, recording the exact project and query result.
5. Ask for approval only when an action crosses a protected boundary. No Production change is currently authorized by this handoff.
