export function report(data, filters = {}) {
  const sessions = data.sessions.filter(
    (s) =>
      (!filters.session || s.session_id === filters.session) &&
      (!filters.date || s.date === filters.date) &&
      (!filters.course || s.course === filters.course),
  );
  const result = [];
  for (const s of sessions) {
    const records = data.attendance.filter(
      (a) => a.session_id === s.session_id,
    );
    for (const a of records)
      result.push({ ...a, course: s.course, date: s.date });
    if (data.settings.enrolled)
      for (const student of data.students)
        if (!records.some((a) => a.student_id === student.student_id))
          result.push({
            session_id: s.session_id,
            course: s.course,
            date: s.date,
            student_id: student.student_id,
            student_name: student.name,
            status:
              Date.parse(
                s.date + 'T' + s.end_time + ':00' + data.settings.offset,
              ) < Date.parse(data.now)
                ? 'Absent'
                : 'Pending',
          });
  }
  return result.filter(
    (a) =>
      !filters.student ||
      `${a.student_id} ${a.student_name}`
        .toLowerCase()
        .includes(filters.student.toLowerCase()),
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
    [columns, ...rows.map((r) => columns.map((k) => r[k] ?? ''))]
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
