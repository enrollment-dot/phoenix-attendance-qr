import { thailandTimestamp, REPORT_TIME_ZONE, sessionTimes } from './time.js';

function selectedSessions(data, filters = {}) {
  return data.sessions.filter(
    (s) =>
      (!filters.session || s.session_id === filters.session) &&
      (!filters.date ||
        sessionTimes(s, data.settings.offset).date === filters.date) &&
      (!filters.course || s.course === filters.course) &&
      (!filters.from || sessionTimes(s, data.settings.offset).date >= filters.from) &&
      (!filters.to || sessionTimes(s, data.settings.offset).date <= filters.to),
  );
}

function sessionHasEnded(session, data) {
  const date = sessionTimes(session, data.settings.offset).date;
  return Date.parse(
    date + 'T' + session.end_time + ':00' + data.settings.offset,
  ) < Date.parse(data.now);
}

export function report(data, filters = {}) {
  const sessions = selectedSessions(data, filters);
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
      (!filters.from || a.date >= filters.from) &&
      (!filters.to || a.date <= filters.to) &&
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

/**
 * Attendance percentage is based on eligible student-session pairs.
 * Completed sessions use the roster as the denominator when enrollment
 * validation is enabled. Pending rows never count as completed attendance.
 */
export function percentage(rows) {
  const counted = rows.filter((r) => r.status !== 'Pending');
  return counted.length
    ? Math.round(
        (counted.filter((r) => r.scan_in).length / counted.length) * 100,
      )
    : null;
}

/**
 * Returns one row per session. For an in-progress session, the percentage
 * is a live participation rate (present / eligible roster). For completed
 * sessions, it is the final session attendance rate.
 */
export function sessionAttendanceSummary(data, filters = {}) {
  const rows = report(data, { ...filters, student: '' });
  const bySession = new Map();
  for (const row of rows) {
    const group = bySession.get(row.session_id) || [];
    group.push(row);
    bySession.set(row.session_id, group);
  }

  return selectedSessions(data, filters).map((session) => {
    const group = bySession.get(session.session_id) || [];
    const ended = sessionHasEnded(session, data);
    const eligible = data.settings.enrolled
      ? group.length
      : group.filter((row) => row.status !== 'Pending').length;
    const attended = group.filter((row) => row.scan_in).length;
    const absent = ended
      ? Math.max(eligible - attended, 0)
      : group.filter((row) => row.status === 'Absent').length;

    return {
      session_id: session.session_id,
      course: session.course,
      date: sessionTimes(session, data.settings.offset).date,
      total_students: eligible,
      attended,
      absent,
      pending: Math.max(eligible - attended - absent, 0),
      percentage: eligible ? Math.round((attended / eligible) * 1000) / 10 : null,
      completed: ended,
    };
  });
}

/**
 * Returns each student's cumulative attendance across completed sessions.
 * The denominator is actual sessions held, not planned sessions.
 *
 * Enrollment-date handling is intentionally not inferred here because the
 * current student model does not expose a join/enrollment date. Once that
 * field exists, eligible sessions can be narrowed to sessions on/after it.
 */
export function studentAttendanceSummary(data, filters = {}) {
  const sessions = selectedSessions(data, filters).filter((s) =>
    sessionHasEnded(s, data),
  );
  const rows = report(data, { ...filters, student: '' });
  const byStudent = new Map();

  for (const student of data.students) {
    byStudent.set(student.student_id, {
      student_id: student.student_id,
      student_name: student.name,
      sessions_held: sessions.length,
      attended: 0,
      absent: 0,
      percentage: null,
    });
  }

  for (const row of rows) {
    if (!byStudent.has(row.student_id)) continue;
    if (row.status === 'Pending') continue;
    const item = byStudent.get(row.student_id);
    if (row.scan_in) item.attended++;
    else item.absent++;
  }

  for (const item of byStudent.values()) {
    if (item.sessions_held) {
      item.percentage =
        Math.round((item.attended / item.sessions_held) * 1000) / 10;
    }
  }

  const q = filters.student?.trim().toLowerCase();
  return [...byStudent.values()]
    .filter((item) => !q || `${item.student_id} ${item.student_name}`.toLowerCase().includes(q))
    .sort((a, b) => a.student_name.localeCompare(b.student_name));
}

export function overallAttendanceSummary(data, filters = {}) {
  const sessions = selectedSessions(data, filters).filter((s) =>
    sessionHasEnded(s, data),
  );
  const summary = sessionAttendanceSummary(data, filters).filter((s) => s.completed);
  const eligible = summary.reduce((total, s) => total + s.total_students, 0);
  const attended = summary.reduce((total, s) => total + s.attended, 0);
  return {
    sessions_held: sessions.length,
    eligible,
    attended,
    absent: Math.max(eligible - attended, 0),
    percentage: eligible ? Math.round((attended / eligible) * 1000) / 10 : null,
  };
}

export function scanLink(session) {
  // QR codes must always point to the stable public app URL, not the
  // Vercel preview/deployment URL used by the teacher's browser.
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  const u = new URL(configuredBase || location.origin);
  if (typeof session.qr_access_code === 'string' && session.qr_access_code) {
    return new URL(
      `s/${session.qr_access_code}`,
      `${u.origin}${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`,
    ).href;
  }
  u.hash = new URLSearchParams({
    session: session.session_id,
    token: session.qr_token,
  }).toString();
  return u.href;
}

export function parseScan(value) {
  const u = new URL(value, location.href);
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  const baseUrl = new URL(configuredBase || location.origin);
  const publicOrigin = baseUrl.origin;
  const basePath = baseUrl.pathname.replace(/\/$/, '');
  if (u.origin !== publicOrigin)
    throw new Error('This QR is not for this attendance app.');
  const shortPrefix = `${basePath}/s/`;
  if (u.pathname.startsWith(shortPrefix)) {
    const code = u.pathname.slice(shortPrefix.length);
    if (/^[A-Za-z0-9_-]{22}$/.test(code) && !u.search && !u.hash)
      return `#access=${code}`;
    throw new Error('Invalid attendance QR.');
  }
  const p = new URLSearchParams(u.hash.slice(1));
  if (!p.get('session') || !p.get('token')) throw new Error('Invalid attendance QR.');
  return u.hash;
}
