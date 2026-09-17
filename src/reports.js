import { thailandTimestamp, REPORT_TIME_ZONE, sessionTimes } from './time.js';
export function report(data, filters = {}) {
  const sessions = data.sessions.filter(
    (s) =>
      (!filters.session || s.session_id === filters.session) &&
      (!filters.date ||
        sessionTimes(s, data.settings.offset).date === filters.date) &&
      (!filters.course || s.course === filters.course),
  );
  const attendanceBySession = new Map();
  for (const record of data.attendance) {
    const records = attendanceBySession.get(record.session_id) || [];
    records.push(record);
    attendanceBySession.set(record.session_id, records);
  }
  const now = Date.parse(data.now);
  const result = [];
  for (const s of sessions) {
    const date = sessionTimes(s, data.settings.offset).date;
    const records = attendanceBySession.get(s.session_id) || [];
    const recordedStudents = new Set(records.map((a) => a.student_id));
    const missingStatus =
      Date.parse(s.date + 'T' + s.end_time + ':00' + data.settings.offset) < now
        ? 'Absent'
        : 'Pending';
    for (const a of records) result.push({ ...a, course: s.course, date });
    if (data.settings.enrolled)
      for (const student of data.students)
        if (!recordedStudents.has(student.student_id))
          result.push({
            session_id: s.session_id,
            course: s.course,
            date,
            student_id: student.student_id,
            student_name: student.name,
            status: missingStatus,
          });
  }
  return filterReport(result, filters);
}
export function filterReport(rows, filters = {}) {
  return rows.filter(
    (a) =>
      (!filters.session || a.session_id === filters.session) &&
      (!filters.date || a.date === filters.date) &&
      (!filters.course || a.course === filters.course) &&
      (!filters.student ||
        `${a.student_id} ${a.student_name}`
          .toLowerCase()
          .includes(filters.student.toLowerCase())),
  );
}
export const columns = [
  'date',
  'course',
  'student_id',
  'student_name',
  'scan_in',
  'scan_out',
  'duration_minutes',
  'status',
];
export function csv(rows) {
  return (
    '\uFEFF' +
    [
      columns.map((k) =>
        ['scan_in', 'scan_out'].includes(k)
          ? `${k} (${REPORT_TIME_ZONE} UTC+7)`
          : k,
      ),
      ...rows.map((r) =>
        columns.map((k) =>
          ['scan_in', 'scan_out'].includes(k)
            ? thailandTimestamp(r[k], '')
            : (r[k] ?? ''),
        ),
      ),
    ]
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@\-\t\r]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n')
  );
}
export function percentage(rows) {
  const counted = rows.filter((r) => r.status !== 'Pending');
  return counted.length
    ? Math.round(
        (counted.filter((r) => r.scan_in).length / counted.length) * 100,
      )
    : null;
}
export function scanLink(session) {
  const u = new URL(location.href);
  u.hash = new URLSearchParams({
    session: session.session_id,
    token: session.qr_token,
  }).toString();
  return u.href;
}
export function parseScan(value) {
  const u = new URL(value, location.href);
  if (u.origin !== location.origin || u.pathname !== location.pathname)
    throw new Error('This QR is not for this attendance app.');
  const p = new URLSearchParams(u.hash.slice(1));
  if (!p.get('session') || !p.get('token'))
    throw new Error('Invalid attendance QR.');
  return u.hash;
}
