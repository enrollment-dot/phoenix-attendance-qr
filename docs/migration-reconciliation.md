# Production Migration Reconciliation

This document records the verified relationship between the production Supabase migration history and repository migrations. It is a reconciliation record, not an instruction to replay historical production migrations.

## Verified production history

Production currently records 19 migrations:

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

- PR #44: student RPC EXECUTE hardening capture. Production ACLs were already verified as backend-only.
- PR #45: admin login identity RPC EXECUTE hardening. Deployed Edge Function and production log review showed application calls using the service-role backend.

Neither PR has changed production.

## Safety rules

Until reconciliation is formally completed:

- Do not run supabase db push against production.
- Do not use db push --include-all.
- Do not delete migration history rows.
- Do not rename historical migration versions just to match production metadata.
- Do not guess missing production migration SQL.
- Do not replay historical bootstrap migrations against the existing production schema.

## Next controlled phase

1. Review PR #44 and PR #45.
2. Merge only after CI/review is clean.
3. Treat the new migrations as repository history until production application is explicitly approved.
4. Apply login-identity ACL hardening to production only through an explicitly approved migration path, then verify login and super-admin re-authentication.
5. Establish a deliberate migration-history repair/recording plan; metadata reconciliation must not substitute for schema verification.
