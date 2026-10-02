# Production Migration Reconciliation

This document records the verified relationship between the production Supabase migration history and repository migrations. It is a reconciliation record, not an instruction to replay historical production migrations.

## Verified production history

Production currently records 23 migrations:

- 20260922120037 ylp_production_schema_v1
- 20260922120126 ylp_production_rpc_v1
- 20260922120247 ylp_production_rpc_v2_lock_rate_limit
- 20260922120338 ylp_production_rpc_v3_admin_create_session
- 20260922120525 ylp_production_rpc_v4_close_public_session
- 20260922120625 ylp_production_rpc_v5_scan
- 20260922120706 ylp_production_rpc_v6_dashboard
- 20260922120740 ylp_production_rpc_v7_student_management
- 20260922135636 ylp_production_rpc_execute_hardening_v1
- 20260924185228 promote_rbac_functions_to_production_v3
- 20260926045139 restrict_backend_only_table_access
- 20260926050300 restrict_public_table_access
- 20260926082550 20260926140000_add_scan_receipts_session_id_index
- 20260926175644 short_qr_access_code
- 20260928145918 admin_secured_force_delete_session
- 20260928150757 lock_attendance_enrollment_rules
- 20260928151403 super_admin_destructive_rbac_v2
- 20260928155309 add_optional_student_email
- 20260928165142 set_attendance_scan_close_grace_15_minutes
- 20260928184349 harden_admin_login_identity_execute
- 20260929095541 allow_admin_removal_with_super_admin
- 20261001192300 add_branding_settings

## Verified logical matches

These production history entries have repository migrations with the same logical change but different migration versions:

| Production | Repository | Status |
| --- | --- | --- |
| 20260926045139 restrict_backend_only_table_access | 20260926120000_restrict_backend_table_access.sql | Logical match |
| 20260926050300 restrict_public_table_access | 20260926130000_restrict_public_table_access.sql | Logical match |
| 20260926082550 scan receipt index | 20260926140000_add_scan_receipts_session_id_index.sql | Logical match |
| 20260926175644 short_qr_access_code | 20260927010000_short_qr_access_code.sql | Logical match |
| 20260928145918 admin_secured_force_delete_session | 20260928200000_admin_secured_force_delete_session.sql | Logical match |
| 20260928150757 lock_attendance_enrollment_rules | 20260928210000_lock_attendance_enrollment_rules.sql | Logical match |

Do not rename or replay these migrations against production merely to make version numbers identical.

## Production-history-only items

The production bootstrap/RPC chain and promote_rbac_functions_to_production_v3 are not represented one-to-one in the current repository. super_admin_destructive_rbac_v2 is also present in production history without a recoverable matching migration file in repository history. Missing original SQL must not be guessed.

## Current security-capture migrations

- PR #68: attendance/session RPC EXECUTE hardening was merged as a repository migration.
- PR #69: explicitly revokes PUBLIC EXECUTE on `ylp_create_session_v1`, `ylp_close_session_v1`, `ylp_scan_v1`, and `ylp_consume_rate_limit_v1`, and grants `service_role` EXECUTE.
- Production ACL verification after the controlled SQL application confirmed for all four functions: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`.
- The production ACL change was applied through the controlled SQL path because `supabase db push --dry-run` is blocked by historical migration drift. PR #69 records the exact ACL change for repository reproducibility.



- PR #44: student RPC EXECUTE hardening capture. Production ACLs were already verified as backend-only.
- PR #45: admin login identity RPC EXECUTE hardening. Deployed Edge Function and production log review showed application calls using the service-role backend.

PR #44 and PR #45 remain repository-side capture/reconciliation work; they must not be treated as evidence that their ACL migrations were applied to production.

## Safety rules

Until reconciliation is formally completed:

- Do not run supabase db push against production.
- Do not use db push --include-all.
- Do not delete migration history rows.
- Do not rename historical migration versions just to match production metadata.
- Do not guess missing production migration SQL.
- Do not replay historical bootstrap migrations against the existing production schema.

## Next controlled phase

1. Keep migration-history drift documented and do not replay historical migrations.
2. Treat repository-only security-capture migrations as records until their production ACL state is independently verified.
3. When a production ACL change is explicitly approved, apply it through a controlled path and record the exact effective privileges in Git.
4. Maintain separate verification for Edge Function authorization, RPC ACLs, database schema, and production deployment.
5. Establish a deliberate migration-history repair/recording plan; metadata reconciliation must not substitute for schema verification.
