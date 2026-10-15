# Account-management authority invariant — regression test plan

This plan applies to the migration `20261010150000_align_super_admin_authority_invariant.sql`.
It is a verification checklist, not evidence that the tests have already run.

## Preconditions

- Run only against an isolated test database or approved Staging environment.
- Use synthetic account IDs and never delete or change real production accounts.
- Verify the four sensitive RPC ACLs remain backend-only: `anon=false`, `authenticated=false`, `service_role=true`, `postgres=true`.
- Verify `admin_profiles_role_check` accepts `super_admin`, `admin`, and `operator`, and rejects any other role.

## Required RPC behavior

1. Create a `super_admin`: succeeds and returns an active profile.
2. Update a test profile to `super_admin`: succeeds.
3. Create/update with an unknown role or `NULL` role: fails with `Invalid role`.
4. Create with `NULL` `p_admin_id`: fails with `Admin ID is required`.
5. Update with `NULL` `p_admin_id`: fails with `Admin ID is required`.
6. Update with `NULL` `p_active`: fails with `Active status is required`.
7. Remove with `NULL` `p_admin_id`: fails with `Admin ID is required`.
8. Demote/deactivate the only active `admin` when no other active `admin` or `super_admin` exists: fails.
9. Demote/deactivate the only active `super_admin` when no other active `admin` or `super_admin` exists: fails.
10. Remove the only active administrative authority: fails.
11. Demote/deactivate/remove an active `admin` while another active `super_admin` remains: succeeds.
12. Demote/deactivate/remove an active `super_admin` while another active `admin` remains: succeeds.
13. Change an `operator` or inactive profile without removing the last active authority: follows normal validation and succeeds.
14. Remove a nonexistent profile: returns `false`.
15. Invalid username format: fails with `Invalid username`.
16. Two concurrent mutations that would each remove an authority must serialize; the final committed state must retain at least one active `admin` or `super_admin`.
17. Verify the migration preserves `SECURITY DEFINER`, fixed `search_path`, function signatures, and RPC ACLs.

## Important implementation review

The migration uses one transaction-scoped advisory lock shared by all three profile mutation RPCs. Confirm no alternate application path writes to `admin_profiles` directly; if one exists, it must use the same invariant/serialization strategy or be denied write access. The migration does not change authorization logic in the Edge Function and does not apply itself to any database.
