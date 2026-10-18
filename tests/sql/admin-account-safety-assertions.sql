-- Runtime regression assertions against the actual migration in a disposable DB.
DO $assertions$
DECLARE
  v_failed boolean;
  v_message text;
BEGIN
  -- Last active super_admin cannot be demoted.
  v_failed := false;
  BEGIN
    PERFORM public.ylp_admin_account_update_v1(
      '10000000-0000-4000-8000-000000000001', 'sole_super_admin', 'admin', true
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Cannot demote or deactivate the last active super_admin';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Expected last-super-admin demotion to be rejected'; END IF;

  -- Last active super_admin cannot be deactivated.
  v_failed := false;
  BEGIN
    PERFORM public.ylp_admin_account_update_v1(
      '10000000-0000-4000-8000-000000000001', 'sole_super_admin', 'super_admin', false
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Cannot demote or deactivate the last active super_admin';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Expected last-super-admin deactivation to be rejected'; END IF;

  -- Last active super_admin cannot be removed.
  v_failed := false;
  BEGIN
    PERFORM public.ylp_admin_account_remove_profile_v1('10000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Cannot remove the last active super_admin';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Expected last-super-admin removal to be rejected'; END IF;

  -- Guards must leave the original authority intact.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE admin_id = '10000000-0000-4000-8000-000000000001'
      AND role = 'super_admin' AND active = true
  ) THEN RAISE EXCEPTION 'Rejected operations unexpectedly changed the last super_admin'; END IF;

  -- With two active super_admins, removing/demoting one remains possible.
  INSERT INTO public.admin_profiles(admin_id, username, role, active)
  VALUES ('10000000-0000-4000-8000-000000000004', 'second_super_admin', 'super_admin', true);

  PERFORM public.ylp_admin_account_update_v1(
    '10000000-0000-4000-8000-000000000004', 'second_super_admin', 'admin', true
  );

  IF EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE admin_id = '10000000-0000-4000-8000-000000000004'
      AND role = 'super_admin' AND active = true
  ) THEN RAISE EXCEPTION 'Demotion with another active super_admin should succeed'; END IF;

  -- Removing one active super_admin is also allowed when another remains.
  INSERT INTO public.admin_profiles(admin_id, username, role, active)
  VALUES ('10000000-0000-4000-8000-000000000007', 'third_super_admin', 'super_admin', true);
  PERFORM public.ylp_admin_account_remove_profile_v1('10000000-0000-4000-8000-000000000007');
  IF EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE admin_id = '10000000-0000-4000-8000-000000000007'
  ) THEN RAISE EXCEPTION 'Removal with another active super_admin should succeed'; END IF;

  -- All supported roles can be created (role parity across environments).
  PERFORM public.ylp_admin_account_create_profile_v1(
    '10000000-0000-4000-8000-000000000005', 'new_super_admin', 'super_admin'
  );
  PERFORM public.ylp_admin_account_create_profile_v1(
    '10000000-0000-4000-8000-000000000006', 'new_operator', 'operator'
  );

  -- RPCs must be inaccessible to client roles and executable by service_role.
  IF pg_catalog.has_function_privilege('anon', 'public.ylp_admin_account_create_profile_v1(uuid,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.ylp_admin_account_create_profile_v1(uuid,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.ylp_admin_account_create_profile_v1(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Account create RPC effective privileges are incorrect';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.ylp_admin_account_update_v1(uuid,text,text,boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.ylp_admin_account_update_v1(uuid,text,text,boolean)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.ylp_admin_account_update_v1(uuid,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Account update RPC effective privileges are incorrect';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.ylp_admin_account_remove_profile_v1(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.ylp_admin_account_remove_profile_v1(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.ylp_admin_account_remove_profile_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Account removal RPC effective privileges are incorrect';
  END IF;
END
$assertions$;

SELECT 'PASS: last active super_admin guards, allowed role lifecycle, and RPC privileges' AS regression_result;
