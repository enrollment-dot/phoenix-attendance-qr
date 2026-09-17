// Presentation only: never mutate the original UTC ISO record values.
export const REPORT_TIME_ZONE = 'Asia/Bangkok';
export const REPORT_TIME_ZONE_LABEL = 'Thailand time (Asia/Bangkok, UTC+7)';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export function thailandTimestamp(value, missing = '—') {
  if (
    !value ||
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  )
    return missing;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return missing;
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function sessionTimes(session, offset) {
  const start = thailandTimestamp(
    `${session.date}T${session.start_time}:00${offset}`,
    '',
  );
  const end = thailandTimestamp(
    `${session.date}T${session.end_time}:00${offset}`,
    '',
  );
  if (!start || !end)
    throw new Error(
      'Invalid session date or time. Contact your administrator.',
    );
  return {
    date: start.slice(0, 10),
    start_time: start.slice(11, 16),
    end_time: end.slice(11, 16),
    end_date: end.slice(0, 10),
  };
}
export function sessionLabel(session, offset) {
  const time = sessionTimes(session, offset);
  return `${time.date} · ${time.start_time}–${time.end_date !== time.date ? time.end_date + ' ' : ''}${time.end_time} · ${REPORT_TIME_ZONE_LABEL}`;
}
// Inputs are Bangkok wall times; API fields retain the configured backend offset.
export function sessionToBackend(values, offset) {
  const threshold = Number(values.late_threshold);
  if (
    typeof values.course !== 'string' ||
    !values.course.trim() ||
    values.course.trim().length > 120 ||
    /[\x00-\x1f\x7f]/.test(values.course) ||
    !Number.isInteger(threshold) ||
    threshold < 0 ||
    threshold > 240 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.start_time) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.end_time) ||
    values.end_time <= values.start_time ||
    new Date(values.date + 'T00:00:00Z').toISOString().slice(0, 10) !==
      values.date
  )
    throw new Error(
      'Enter a valid course, date, time range and whole-minute late threshold. Nothing was submitted.',
    );
  values = {
    ...values,
    course: values.course.trim().normalize('NFC'),
    late_threshold: threshold,
  };
  if (!/^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset))
    throw new Error('Invalid session timezone configuration.');
  const wall = new Date(`${values.date}T${values.start_time}:00Z`);
  const zone =
    new Intl.DateTimeFormat('en-US', {
      timeZone: REPORT_TIME_ZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(wall)
      .find((p) => p.type === 'timeZoneName')
      .value.replace('GMT', '') || '+00:00';
  const minutes =
    (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) *
    (offset[0] === '-' ? -1 : 1);
  const convert = (time) =>
    new Date(
      Date.parse(`${values.date}T${time}:00${zone}`) + minutes * 60000,
    ).toISOString();
  const start = convert(values.start_time),
    end = convert(values.end_time);
  if (end <= start || start.slice(0, 10) !== end.slice(0, 10))
    throw new Error(
      'These times cross the configured class-day boundary. Choose times within one class day. Nothing was submitted.',
    );
  return {
    ...values,
    date: start.slice(0, 10),
    start_time: start.slice(11, 16),
    end_time: end.slice(11, 16),
  };
}
