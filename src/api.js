const endpoint = import.meta.env.VITE_API_URL;
export const configured = !!endpoint && !endpoint.includes('YOUR_DEPLOYMENT');
export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}
const sessionReadFailure =
  'The service could not deliver the class details. Attendance has not been submitted.';
export async function api(action, payload = {}, token = '') {
  try {
    return await request(action, payload, token);
  } catch (error) {
    if (
      action === 'session' &&
      ['http', 'timeout', 'transport', 'response'].includes(error.kind)
    ) {
      throw new ApiError(sessionReadFailure, error.kind);
    }
    throw error;
  }
}
async function request(action, payload, token) {
  if (!configured)
    throw new ApiError(
      'Young Leadership Academy is not configured yet. Contact your administrator.',
      'configuration',
    );
  let response, signal, timer;
  try {
    try {
      const body = JSON.stringify({ action, payload, token });
      for (let attempt = 0; ; attempt++) {
        // Always restart at the configured API URL, never at response.url (/echo).
        clearTimeout(timer);
        const controller = new AbortController();
        signal = controller.signal;
        timer = setTimeout(
          () =>
            controller.abort(
              new DOMException('Request deadline', 'TimeoutError'),
            ),
          action === 'login' ? 60000 : 30000,
        );
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body,
          redirect: 'follow',
          credentials: 'omit',
          signal,
        });
        // Reads can be replayed; login only issues another expiring cached token.
        // Keep this allowlist explicit: attendance/session writes must never retry.
        if (
          !['login', 'dashboard', 'session'].includes(action) ||
          attempt !== 0 ||
          !response.redirected ||
          response.status !== 404
        )
          break;
        // Discard the failed body without inspecting or logging its temporary URL.
        try {
          await response.body?.cancel();
        } catch {
          /* Best-effort cleanup only. */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      throw transportError(error, signal);
    }
    if (!response.ok)
      throw new ApiError(
        'The service response could not be confirmed.',
        'http',
      );
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (
        signal?.aborted ||
        ['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name)
      )
        throw transportError(error, signal);
      throw new ApiError(
        'The service returned an unreadable response.',
        'response',
      );
    }
    if (result?.ok !== true && result?.ok !== false)
      throw new ApiError(
        'The service returned an unexpected response.',
        'response',
      );
    if (!result.ok) {
      const error = new ApiError(result.error || 'Request failed.', 'server');
      if (result.code === 'scan_rejected') error.code = result.code;
      throw error;
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

function transportError(error, signal) {
  const kind =
    signal?.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError'
      ? 'timeout'
      : 'transport';
  // Never log exception messages, URLs, request payloads, or credentials.
  if (import.meta.env.DEV)
    console.warn(
      '[Young Leadership Academy API]',
      kind,
      ['TimeoutError', 'TypeError', 'AbortError'].includes(error?.name)
        ? error.name
        : 'UnknownFetchError',
    );
  return new ApiError(
    kind === 'timeout'
      ? 'The request timed out. Its result could not be confirmed.'
      : 'The connection failed. The request result could not be confirmed.',
    kind,
  );
}
