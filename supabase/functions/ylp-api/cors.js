const STAGING_PREVIEW_ORIGIN = /^https:\/\/phoenix-attendance-rbac-staging-[a-z0-9-]+\.vercel\.app$/i;

/**
 * Match an explicit origin, or an opt-in preview origin belonging to the
 * staging Vercel project. Never use a wildcard Access-Control-Allow-Origin.
 */
export function isAllowedOrigin(origin, allowedOrigins, allowVercelPreviewOrigins = false) {
  if (typeof origin !== 'string' || !origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (!allowVercelPreviewOrigins || !STAGING_PREVIEW_ORIGIN.test(origin)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.origin === origin &&
      parsed.username === '' && parsed.password === '' &&
      parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(origin, allowedOrigins, allowVercelPreviewOrigins = false) {
  return isAllowedOrigin(origin, allowedOrigins, allowVercelPreviewOrigins) ? origin : '';
}
