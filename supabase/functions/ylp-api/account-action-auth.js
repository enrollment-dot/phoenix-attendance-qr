/** Shared account-mutation guard, exported for deterministic runtime regression tests. */
export async function withFreshSuperAdminAuth({
  token,
  config,
  backend,
  payload,
  requireAdminRole,
  enforceRateLimit,
  AuthenticationError,
}, mutation) {
  const currentClaims = await requireAdminRole(token, config, backend, ['super_admin']);
  const reauth = payload.reauth;
  if (
    !reauth || typeof reauth !== 'object' || Array.isArray(reauth) ||
    typeof reauth.username !== 'string' || !reauth.username ||
    typeof reauth.password !== 'string' || !reauth.password
  ) throw new AuthenticationError();

  await enforceRateLimit(backend, config, 'login-global', 'global');
  const fresh = await backend.login(
    { username: reauth.username.trim(), password: reauth.password },
    token,
  );
  const freshToken =
    fresh && typeof fresh === 'object' && 'data' in fresh &&
    fresh.data && typeof fresh.data === 'object' &&
    'token' in fresh.data && typeof fresh.data.token === 'string'
      ? fresh.data.token
      : '';
  if (!freshToken) throw new AuthenticationError();

  const freshClaims = await requireAdminRole(freshToken, config, backend, ['super_admin']);
  if (freshClaims.sub !== currentClaims.sub) throw new AuthenticationError();
  return mutation(freshClaims);
}
