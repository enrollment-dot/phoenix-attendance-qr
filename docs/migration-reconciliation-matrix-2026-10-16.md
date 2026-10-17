# Migration Reconciliation Matrix — 2026-10-16

## Scope and safety

This is a read-only reconciliation artifact for GitHub main, Supabase Staging (yvtgwzvjpztvztozcfir), and Supabase Production (fsxdsdixxnslismxghfz). It compares migration filenames and ledger entries with previously inspected live schema and function evidence. Matching names or similar timestamps are not proof that SQL effects are identical.

**No migration was applied, no ledger was edited, and no Production or Staging database writes were performed for this document.** Do not replay historical baseline migrations or run supabase db push against either live environment as a reconciliation shortcut.

## Snapshot

| Source | Observed entries | Interpretation |
|---|---:|---|
| GitHub main supabase/migrations | 25 SQL files | Includes two similar session auto-close candidates; count alone does not prove every live object has a current tracked migration. |
| Staging migration ledger | 27 rows | Includes Staging-specific historical baseline entries and the three October 16 Student migrations. |
| Production migration ledger | 28 rows | Includes a different Production baseline/RPC history. |

Staging and Production are not expected to have identical migration version strings given their historical baselines. Reconciliation must be object/effect-based, not ledger-count-based.

## Feature-level ledger and object matrix

| Feature / object | Git main migration evidence | Staging ledger / live evidence | Production ledger / live evidence | Current assessment / safe action |
|---|---|---|---|---|
| Initial schema and RPC baselines | Current Git migration set does not reproduce the full historical baseline naming found in either environment. | Ledger starts with ylp_phase5_option_b_v3_staging and other ylp_phase entries. | Ledger starts with ylp_production_schema_v1 and ylp_production_rpc_v entries. | Historical lineage differs; do not replay or rewrite baseline history. Compare actual object definitions where a drift matters. |
| Safe session delete | Git migration version 20260924123000. | Ledger version 20260924053304; read-only review found closed-session guard and backend-only execution. | Production has its own safe-delete history; read-only review found closed-session guard and backend-only execution. | Behavior/ACL evidence supports reviewed safety controls, but ledger versions are not one-to-one. Do not align version numbers alone. |
| Short QR access code | Git version 20260927010000. | Ledger 20260926175255. | Ledger 20260926175644. | Same feature label with different recorded versions. Treat as historical drift until full object diff proves parity; do not replay. |
| Admin login identity execution hardening | Git version 20260929200000; reviewed identity RPC is backend-only. | Ledger 20261010183050; effective client EXECUTE denied in reviewed RPC. | Ledger 20260928184349; effective client EXECUTE denied in reviewed RPC. | Reviewed effective permissions align despite version drift. No action based on ledger names alone. |
| Branding settings | Git version 20261001010000 plus follow-up branding migrations. | Ledger 20261010183337 and related welcome/QR/update RPC entries. | Ledger 20261001192300 and related branding entries. | Not fully equivalent: Staging GET RPC returns jsonb while Production returns a composite; Production SECURITY DEFINER search_path also differs from Git/Staging. Keep as a separately reviewed contract/security remediation; no automatic change. |
| Restrict existing helper EXECUTE | Git 20261014052752_restrict_public_function_default_execute.sql. | Ledger 20261014052752; reviewed helper EXECUTE is denied to anon/authenticated. | No matching version/name in returned Production ledger; reviewed helper ACLs still allow client roles for three helpers. | Confirmed ACL drift. Helpers were reviewed as immutable, non-SECURITY-DEFINER SQL helpers with no demonstrated data bypass. Review compatibility/call sites and propose a separate Production remediation; no direct SQL patch. |
| Branding SECURITY DEFINER search_path | Git 20261014060002_harden_branding_definer_search_path.sql. | Ledger 20261014060002; definitions match pg_catalog, public. | No matching version/name in returned Production ledger; definitions still use search_path=public. | Confirmed hardening drift. Client EXECUTE denied in both reviewed environments. Prepare tracked Production migration proposal with pre/postflight checks; do not apply without approval. |
| Global default function EXECUTE | Git main includes a global default-privilege hardening migration; exact filename/version needs re-verification from the current repository tree before claiming exact ledger parity. | Ledger 20261015094240; postgres default ACL for public is restricted to postgres and service_role; supabase_admin defaults remain broader. | No corresponding ledger row in the returned Production snapshot; postgres default ACL for public includes anon/authenticated; supabase_admin defaults are also broader. | Confirmed default-ACL drift. Default privileges are owner-specific; a migration connection cannot safely fix supabase_admin defaults. Check object owners/callers before any approved remediation. |
| Session auto-close scheduler | Git has 20261012120000_secure_session_auto_close_scheduler.sql and duplicate candidate 20261014120000_secure_session_auto_close_scheduler.sql. Both close eligible active sessions after the approved Bangkok-time 15-minute grace period and explicitly update updated_at; the second candidate omits some explicit grant/assertion lines. | Ledger 20261012052803; scheduler RPC has backend-only execute in reviewed state. | Ledger 20261013174134; scheduler RPC has backend-only execute in reviewed state. | Resolve duplicate Git candidate in a focused reviewed PR, not by replaying a migration. pg_cron is absent in both environments; the 15-minute GitHub Actions scheduler is configured. |
| Student schema/RPC reconciliation | Git has Student schema/RPC migrations corresponding to the recent change set. | Versions 20261016040903, 20261016043513, 20261016072742 are already applied; Bangkok enrollment-date default was verified. | These versions are absent from the returned Production ledger; Production's current default behavior differs from Staging's Bangkok-time default. | Staging-only drift is tracked. Do not reapply Staging migrations. Production promotion requires a separate reviewed migration/rollout plan and explicit approval. |
| Timestamp triggers and manual session close | Current Git migration filenames do not identify the origin of Staging's four timestamp triggers. | Four triggers call set_updated_at(); manual close refreshes updated_at through the trigger. | No public timestamp triggers; manual ylp_close_session_v1(text) does not assign updated_at. | Confirmed observable timestamp defect. Smallest candidate is explicit updated_at assignment in the manual-close RPC plus a regression test; do not blanket-restore triggers or apply schema changes without approval. Exact trigger lineage remains unproven. |

## Required preflight / postflight protocol for any future migration

Do not execute these against live databases until the migration has been separately reviewed and explicitly approved for the target environment.

### Preflight
1. Confirm the target project ID and environment.
2. Confirm the migration is absent from that target's ledger; never assume the filename timestamp is enough.
3. Assert the exact existing function signature, owner, language, SECURITY DEFINER status, search_path, and effective ACLs relevant to the change.
4. Capture the current function definition and affected table constraints/triggers/defaults.
5. Check call sites and response-contract consumers; establish backward compatibility.
6. Use a disposable/local PostgreSQL regression fixture first. For session-close timestamp behavior, prove the test cannot close a real session.
7. Document expected object changes and an explicit rollback/forward-fix strategy.

### Postflight
1. Confirm the migration ledger contains the intended version exactly once.
2. Compare pg_get_functiondef, function configuration, owner, and effective has_function_privilege results to the intended state.
3. Confirm client roles remain denied for backend-only RPCs and required backend roles retain execution.
4. Run targeted SQL regression assertions and the repository's required npm test and npm run test:browser checks for code changes.
5. Re-run relevant Supabase Security/Performance Advisor checks and inspect scheduler/API behavior without triggering destructive or real attendance operations.
6. Record target project, migration version, commit SHA, test outputs, and what remains unverified.

## Current disposition

- No live database changes are authorized by this document.
- Do not force-align or edit migration ledgers.
- Prioritize exact object/effect reconciliation for confirmed functional/security drift; do not remediate based on migration counts or filenames alone.
- Step 3 remains in progress. Step 4 (scheduler/attendance verification) and Step 5 (final audit/documentation) remain pending.

## Student RPC signature reconciliation — live catalog recheck 2026-10-17

This section records a fresh read-only comparison of `pg_proc` in Staging and Production. No Student RPC was invoked and no database changes were made during this check.

| Contract | Staging | Production | Assessment |
|---|---|---|---|
| `ylp_student_create_v1` signatures | 2-, 3-, and 4-argument overloads; no argument defaults | 3- and 4-argument overloads; 3-argument enrollment date defaults to `CURRENT_DATE`, 4-argument date/email defaults are present | Confirmed contract drift. The older 2-argument wrapper is absent in Production. |
| `ylp_student_update_v1` signatures | 2-, 3-, and 4-argument overloads; no argument defaults | 3- and 4-argument overloads; the 3-argument enrollment date and 4-argument enrollment date/email have defaults | Confirmed contract drift. Defaulted overloads can overlap for legacy call shapes; verify PostgREST resolution in disposable tests, not by invoking Production. |
| Legacy update email semantics | The 2- and 3-argument wrappers do not write `email` | The 4-argument update has `p_email DEFAULT NULL` and writes `email = v_email`; the 3-argument update does not write email | Potential data-loss path if a legacy request resolves to the 4-argument overload with omitted email. This is a contract risk, not proof that a Production row was changed. |
| Security configuration | All six overloads are `SECURITY DEFINER`, empty `search_path`, ACL only `postgres` and `service_role` | All four overloads are `SECURITY DEFINER`, empty `search_path`, ACL only `postgres` and `service_role` | The sampled RPC execution boundary is consistent; signature/default semantics are not. |
| `ylp_students_v1()` | Present, `SECURITY DEFINER`, empty `search_path`, backend-only ACL | Present, `SECURITY DEFINER`, empty `search_path`, backend-only ACL | No drift observed in the sampled catalog properties. |
| `students.enrolled_from` default | `(now() AT TIME ZONE 'Asia/Bangkok')::date` | `CURRENT_DATE` | Confirmed business-timezone default drift. Staging behavior was explicitly approved and verified; Production promotion is a separate release decision. |

### Student reconciliation disposition

- Staging has already received the three Student migrations recorded in its ledger: `20261016040903`, `20261016043513`, and `20261016072742`. Do not reapply them.
- The corresponding migration implementation remains on Draft/open/unmerged PR #130, not on `main`. Treat this as intentional Staging-only rollout state pending review/approval, not as evidence that Production has been upgraded.
- PR #130's compatibility migration removes defaults from the 4-argument create/update signatures and recreates explicit 2-/3-argument wrappers. The legacy update wrappers intentionally preserve email. Its disposable PostgreSQL regressions passed on the recorded PR head.
- Do not apply these migrations to Production as part of this audit. Before a future Production promotion, review the complete current PR #130 diff, re-check current Production schema/ledger, confirm API callers and overload resolution, obtain explicit approval, and then verify postflight catalog/behavior.
- No Production or Staging data was changed during this recheck. The findings are catalog evidence; no live Student create/update RPC was executed.

