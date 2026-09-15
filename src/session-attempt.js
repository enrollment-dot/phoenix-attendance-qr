const KEY = 'phoenix.pending-session.v1';
const fields = ['course', 'date', 'start_time', 'end_time', 'late_threshold'];
function allowlisted(value) {
  if (
    !value ||
    typeof value.request_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.request_id,
    )
  )
    throw new Error(
      'Pending session data is invalid. Contact your administrator before creating another session.',
    );
  const result = { request_id: value.request_id };
  for (const field of fields) {
    if (!['string', 'number'].includes(typeof value[field]))
      throw new Error('Pending session data is invalid.');
    result[field] = String(value[field]);
  }
  return result;
}
export function pendingAttempt() {
  const value = sessionStorage.getItem(KEY);
  return value ? allowlisted(JSON.parse(value)) : null;
}
export function beginAttempt(values) {
  const existing = pendingAttempt();
  if (existing) return existing;
  const attempt = allowlisted({ ...values, request_id: crypto.randomUUID() });
  sessionStorage.setItem(KEY, JSON.stringify(attempt));
  if (!pendingAttempt())
    throw new Error(
      'Could not preserve the session request. Nothing was submitted.',
    );
  return attempt;
}
export function clearAttempt() {
  sessionStorage.removeItem(KEY);
}
