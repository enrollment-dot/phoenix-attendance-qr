# SIFer Lab Attendance / YLP — Final Security Audit Snapshot
**Audit date:** 2026-10-17  
**Scope:** GitHub main, GitHub Actions scheduler, Supabase Staging and Production, Vercel deployments  
**Verdict:** **PASS WITH OPEN ITEMS** — scheduler execution path has fresh positive evidence, but the wider security and schema audit has unresolved findings and production close-count evidence does not show an eligible session being closed during the latest scheduled runs.

## 1. Safety and change record
- This audit used read-only Supabase catalog/count queries, GitHub workflow history/job logs, PR metadata, and Vercel deployment metadata.
- No live sessions were created or closed for testing.
- No scheduler was manually invoked during this audit.
- No database migration, schema/security/configuration change, PR merge, or deployment was performed.
- Production and Staging must continue to be treated as separate environments.

## 2. Step 4 — Scheduler and attendance verification

### Workflow source
Current `main` is `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.
- [Staging workflow](https://github.com/enrollment-dot/phoenix-attendance-qr/blob/main/.github/workflows/session-auto-close-staging.yml)
- [Production workflow](https://github.com/enrollment-dot/phoenix-attendance-qr/blob/main/.github/workflows/session-auto-close-production.yml)

Both workflows declare `*/15 * * * *`, use separate concurrency groups and GitHub Environments, validate the exact environment-specific `ylp-api` URL, send `schedulerAutoClose` with `x-ylp-scheduler-secret`, and require `.ok == true` plus numeric `.data.closed_count`. The response-envelope regression step passed in the inspected runs.

### Fresh scheduled-run evidence
| Environment | Run | Started (UTC) | Workflow/job result | API result |
|---|---|---|---|---|
| Staging | [#39008893665](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/39008893665) | 2026-10-17 06:10:02 | Completed / success; configuration validation and close step passed | `ok=true, closed_count=0` |
| Production | [#39006679386](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/39006679386) | 2026-10-17 05:33:12 | Completed / success; configuration validation and close step passed | `ok=true, closed_count=0` |

Job logs were read directly. The returned response envelopes passed validation. These runs establish successful scheduled invocation and response validation, **not** that an eligible session was closed. Earlier manual runs that closed 12 Staging and 2 Production sessions remain historical positive-path evidence, but are not a substitute for a scheduled eligible-session close.

### Live database catalog
Read-only catalog checks at approximately 2026-10-17 07:19 UTC in both environments found:
- `public.ylp_auto_close_sessions_v1()`: `SECURITY DEFINER`, `search_path=pg_catalog, public`, EXECUTE ACL only `postgres` and `service_role`.
- `public.ylp_close_session_v1(text)`: not `SECURITY DEFINER`, empty `search_path`, EXECUTE ACL only `postgres` and `service_role`.
- Function definitions use Bangkok-local `scheduled_date + end_time_local`, the approved 15-minute post-end grace period, `LIMIT 100`, `FOR UPDATE SKIP LOCKED`, status transition to `closed`, and update `updated_at`.
- `cron.job` is absent; GitHub Actions is the scheduler, not `pg_cron`.
- A fresh read-only count query at 2026-10-17 07:33 UTC again showed 0 active sessions and 0 active sessions past the close cutoff in both Staging and Production. This current snapshot cannot prove the scheduler closed any particular session.

**Step 4 assessment: PARTIAL PASS.** Scheduled invocations and their API response envelopes are verified. Reliable scheduled closure of an eligible session remains unproven without a naturally occurring eligible session and corresponding safe post-run evidence. Do not manufacture a test by creating/closing live sessions.

## 3. Step 5 — Current repository, CI and deployment snapshot

### Main and Vercel
- GitHub `main`: `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.
- Vercel Production deployment is `READY`, points to the same main SHA, and lists `ylp.siferlab.space` as an alias. This verifies deployment metadata, not all live application/API/DB behavior.
- Vercel Staging previously showed a `READY` preview for PR #133 head `59944d5bb1a06050c269b6821dea449a0c558c58`; this is an older preview snapshot and is not evidence that the latest documentation commit was deployed to Preview.

### Relevant PRs — still proposals
- [#133 audit documentation](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/133): open, Draft, unmerged; latest checked head `80fac4572a39cc9ad42fdd2ec3a36825392763fe`. Test run [#39014160321](https://github.com/enrollment-dot/phoenix-attendance-qr/actions/runs/39014160321) completed successfully for this head. Direct job-step records show `npm install`, Playwright Chromium setup, `npm test`, and `npm run test:browser` all passed; Vercel Preview Comments also succeeded.
- [#139 manual-close preflight regression tests](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/139): open, Draft, unmerged; PostgreSQL Regression #70 and Test #468 passed on its recorded head.
- [#130 Student schema/RPC reconciliation](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/130): open, Draft, unmerged. Its three approved migrations are Staging-only; do not promote to Production without separate approval.
- [#137 helper-function ACL remediation](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/137): open, Draft, unmerged; Production ACL issue remains.
- [#138 postgres default-function-ACL remediation](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/138): open, Draft, unmerged; Production default-ACL issue remains. Does not address `supabase_admin` defaults.
- [#126 duplicate scheduler migration cleanup](https://github.com/enrollment-dot/phoenix-attendance-qr/pull/126): open, Draft, unmerged; repository-only proposal. Do not use `supabase db push` to reconcile historical drift.

No PR was merged and no Production deployment was triggered as part of this audit. A Vercel deployment was automatically created for the audit branch; direct deployment metadata shows `target=null` and only a branch-specific alias, not `ylp.siferlab.space`. The current Production deployment remains the separate READY deployment for `main` SHA `b2a3a3714a6e856f1bffbb17d7c2c193a0ef48c9`.

## 4. Open findings register

| ID / Severity | Finding and evidence | Environment | Recommended next action / approval |
|---|---|---|---|
| AUD-01 — Medium, verification gap | Latest scheduled runs return `closed_count=0`; no scheduled run has yet proved it closed an eligible session. | Staging + Production | Observe naturally eligible sessions and correlate run logs with read-only session state. Do not create/close sessions for testing. |
| AUD-02 — High, contract/data-integrity risk | Student RPC overload/default drift. Production 3-/4-argument create/update functions have defaults; Staging has explicit 2-/3-/4-argument wrappers without defaults. Legacy update resolution could omit email unexpectedly; no data loss observed. | Production vs Staging | Review API call shapes and use the tracked PR #130 migration/rollout design. Production change requires explicit approval and full pre/postflight plan. |
| AUD-03 — Medium, least-privilege drift | Three helper functions allow `PUBLIC`/`anon`/`authenticated` EXECUTE in Production while Staging is backend-only. No privilege escalation was demonstrated. | Production | Review call sites and PR #137 regression/preflight; apply only after explicit Production approval. |
| AUD-04 — High, future privilege drift | Production `postgres` function default ACL includes `anon` and `authenticated` in `public`; Staging is restricted. `supabase_admin` defaults are separately broader and need authority review. | Production and Staging | Review PR #138 and ownership/default-privilege authority. Do not alter `supabase_admin` defaults without separate approval. |
| AUD-05 — Medium, hardening drift | Branding SECURITY DEFINER search_path differs: Staging uses `pg_catalog, public`; Production uses `public`. Branding GET return type also differs (`jsonb` vs composite). | Production vs Staging | Keep tracked migration and runtime contract tests; do not apply Production migration without approval. |
| AUD-06 — Medium, timestamp correctness | Staging has `set_updated_at()` triggers; Production lacks the reviewed session timestamp triggers. Production manual close does not explicitly update `updated_at`; PR #134/#139 propose a focused fix and regression coverage. | Production vs Staging | Review the focused PR stack and prove intended semantics before an approved change. |
| AUD-07 — Medium, referential-integrity drift | Staging has `branding_settings.updated_by -> auth.users(id)`; Production lacks the FK. Intent and compatibility are not yet proven. | Production vs Staging | Establish desired invariant and impact before proposing a migration; approval required. |
| AUD-08 — Low/Info | Nine public tables have RLS enabled with zero policies; direct anon/authenticated table privileges were previously verified absent. Security Advisor currently reports `rls_enabled_no_policy` INFO x9 in each environment. | Both | Do not add policies just to silence INFO. Recheck server-only access paths and RPC ACLs when relevant. |
| AUD-09 — Medium / configuration decision | Supabase Auth leaked-password protection is disabled; Advisor reports WARN x1 in each environment. | Both | Decide product/security policy; enabling it changes Auth configuration and requires explicit approval. |
| AUD-10 — Medium, migration drift | Staging has 27 ledger entries and Production 28 with historical differences; counts alone are not a security incident. Production has no `students_set_updated_at` / `sessions_set_updated_at` triggers seen in Staging. | Both | Continue object/effect reconciliation. No ledger edits, baseline replay, migration reordering/squashing, or `supabase db push` shortcut. |
| AUD-11 — Medium, operational proof gap | `query_logs` failed with backend errors in the prior audit window; direct workflow-list UI URL was unsupported. GitHub API run/job records and logs were available for the runs cited above. | Both | Use GitHub Actions job history and read-only database evidence; do not repeatedly poll the failing Supabase log query. |

Severity labels are audit triage priorities, not claims that an exploit or data loss has occurred. In particular, the Student email issue is a potential contract risk, not evidence of existing data loss.

## 5. Supabase Security Advisor snapshot
Read directly on 2026-10-17:
- Staging: `rls_enabled_no_policy` INFO ×9; `auth_leaked_password_protection` WARN ×1.
- Production: `rls_enabled_no_policy` INFO ×9; `auth_leaked_password_protection` WARN ×1.
- These Advisor results are findings, not proof of direct table exposure. Previously verified absence of direct anon/authenticated CRUD grants remains important context.

## 6. Verdict and release gates

**Final verdict: PASS WITH OPEN ITEMS.**

Passed:
- Latest inspected Staging and Production scheduled runs completed successfully.
- Scheduler response validation and exact environment endpoint checks passed in the cited jobs.
- Live scheduler function definitions and EXECUTE ACLs were directly inspected in both Supabase environments.
- Vercel Production deployment metadata is READY and points to the current GitHub main SHA.
- Current audit PR CI evidence: Test run `39014160321` passed on head `80fac4572a39cc9ad42fdd2ec3a36825392763fe`; direct job-step records confirm `npm install`, Playwright Chromium setup, `npm test`, and `npm run test:browser` all passed.

Open:
- No recent scheduled run closed an eligible session; both latest inspected runs returned zero.
- Student RPC contract drift and multiple Production/Staging schema/security differences remain.
- Helper/default ACL remediation, branding search_path/return-contract, timestamp behavior, FK drift, and Auth leaked-password protection remain unresolved.
- Historical migration drift still needs an object/effect reconciliation plan.

**Not authorized by this verdict:** merging any PR, deploying code, applying Production migrations, changing Production settings or environment variables, modifying security policies/ACLs, changing account/role/password/email, or performing destructive operations. Each requires the relevant explicit approval.

## 7. Next actions
1. Keep Step 4 open for natural-run evidence of a scheduled eligible-session close; no test session creation or closure.
2. Review the open PRs as proposals and refresh their CI/check status immediately before any future release decision.
3. Continue the object/effect migration reconciliation and resolve the Student API/database contract before any Production promotion.
4. Preserve this report as an audit snapshot; refresh it after new direct evidence or approved changes.
