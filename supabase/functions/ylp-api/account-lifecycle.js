function notifyPartialFailure(deps, event) {
  try {
    deps.onPartialFailure?.(event);
  } catch {
    // Diagnostics must never replace the original account lifecycle failure.
  }
}

function authHeaders(config, includeContentType = false) {
  return {
    apikey: config.supabaseServiceRoleKey,
    authorization: 'Bearer ' + config.supabaseServiceRoleKey,
    ...(includeContentType ? { 'content-type': 'application/json' } : {}),
  };
}

function authUserUrl(config, adminId) {
  const base = config.supabaseUrl + '/auth/v1/admin/users';
  return adminId ? base + '/' + encodeURIComponent(adminId) : base;
}

export async function createAdminAccountLifecycle(deps, input) {
  const request = deps.request ?? ((url, init) => fetch(url, init));
  const response = await request(authUserUrl(deps.config), {
    method: 'POST',
    headers: authHeaders(deps.config, true),
    body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true }),
  });
  if (!response.ok) throw new Error('auth user creation failed');

  let created;
  try {
    created = await response.json();
  } catch {
    notifyPartialFailure(deps, 'create_response_unparseable');
    throw new Error('auth user creation returned an unusable response');
  }
  const nestedUser = created.user && typeof created.user === 'object' ? created.user : null;
  const adminId = typeof created.id === 'string' ? created.id : nestedUser && typeof nestedUser.id === 'string' ? nestedUser.id : null;
  if (!adminId) {
    notifyPartialFailure(deps, 'create_missing_user_id');
    throw new Error('auth user creation returned no user id');
  }

  try {
    const profile = await deps.rpc('ylp_admin_account_create_profile_v1', {
      p_admin_id: adminId,
      p_username: input.username,
      p_role: input.role,
    });
    return { ok: true, data: profile };
  } catch (error) {
    try {
      const rollback = await request(authUserUrl(deps.config, adminId), {
        method: 'DELETE',
        headers: authHeaders(deps.config),
      });
      if (!rollback.ok) notifyPartialFailure(deps, 'create_rollback_failed');
    } catch {
      notifyPartialFailure(deps, 'create_rollback_failed');
    }
    throw error;
  }
}

export async function updateAdminAccountLifecycle(deps, input) {
  const request = deps.request ?? ((url, init) => fetch(url, init));
  const authUpdates = { email: input.email, email_confirm: true };
  if (input.password) authUpdates.password = input.password;
  const response = await request(authUserUrl(deps.config, input.adminId), {
    method: 'PUT',
    headers: authHeaders(deps.config, true),
    body: JSON.stringify(authUpdates),
  });
  if (!response.ok) throw new Error('auth user update failed');

  try {
    const profile = await deps.rpc('ylp_admin_account_update_v1', {
      p_admin_id: input.adminId,
      p_username: input.username,
      p_role: input.role,
      p_active: input.active,
    });
    return { ok: true, data: profile };
  } catch (error) {
    notifyPartialFailure(deps, 'update_profile_failed_after_auth_update');
    throw error;
  }
}

export async function removeAdminAccountLifecycle(deps, input) {
  const request = deps.request ?? ((url, init) => fetch(url, init));
  // Keep profile-first ordering: the database safety guard must reject removal before Auth deletion.
  const removed = await deps.rpc('ylp_admin_account_remove_profile_v1', { p_admin_id: input.adminId });
  let deleted;
  try {
    deleted = await request(authUserUrl(deps.config, input.adminId), {
      method: 'DELETE',
      headers: authHeaders(deps.config),
    });
  } catch {
    notifyPartialFailure(deps, 'remove_auth_delete_failed_after_profile_removal');
    throw new Error('auth user removal failed after profile removal');
  }
  if (!deleted.ok) {
    notifyPartialFailure(deps, 'remove_auth_delete_failed_after_profile_removal');
    throw new Error('auth user removal failed after profile removal');
  }
  return { ok: true, data: removed };
}
