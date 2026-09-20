// Pending scan drafts survive same-tab reloads. Never persist QR/admin tokens.
const PREFIX = 'ylp.pending-scan.v1:';
const fields = [
  'request_id',
  'session_id',
  'student_id',
  'student_name',
  'direction',
];
function clean(value) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.request_id || '',
    ) ||
    fields.some((key) => typeof value[key] !== 'string') ||
    !['in', 'out'].includes(value.direction) ||
    !value.session_id ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(value.student_id) ||
    !value.student_name.trim() ||
    value.student_name.length > 100
  )
    throw new Error(
      'Cannot read the pending scan. Contact your Academy administrator before submitting again.',
    );
  return Object.fromEntries(
    fields.map((key) => [
      key,
      key === 'request_id' ? value[key].toLowerCase() : value[key],
    ]),
  );
}
export function pendingScan(sessionId) {
  const raw = sessionStorage.getItem(PREFIX + sessionId);
  if (!raw) return null;
  const value = clean(JSON.parse(raw));
  if (value.session_id !== sessionId)
    throw new Error('Pending scan belongs to another class.');
  return value;
}
export function beginScan(values) {
  const pending = pendingScan(values.session_id);
  if (pending) return pending;
  const value = clean({
    ...values,
    student_id: values.student_id.trim(),
    student_name: values.student_name.trim(),
    request_id: crypto.randomUUID(),
  });
  sessionStorage.setItem(PREFIX + value.session_id, JSON.stringify(value));
  if (JSON.stringify(pendingScan(value.session_id)) !== JSON.stringify(value))
    throw new Error(
      'Could not preserve the scan request. Nothing was submitted.',
    );
  return value;
}
export function clearScan(sessionId, requestId) {
  const pending = pendingScan(sessionId);
  if (pending?.request_id === requestId)
    sessionStorage.removeItem(PREFIX + sessionId);
}
