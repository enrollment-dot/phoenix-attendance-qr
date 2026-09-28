import assert from 'node:assert/strict';
import {
  percentage,
  sessionAttendanceSummary,
  studentAttendanceSummary,
  overallAttendanceSummary,
} from '../src/reports.js';

const data = {
  now: '2026-09-28T21:30:00+07:00',
  settings: {
    offset: '+07:00',
    enrolled: true,
    openMinutes: 15,
    closeMinutes: 15,
  },
  students: [
    { student_id: 'A', name: 'Alice', active: true },
    { student_id: 'B', name: 'Bob', active: true },
    { student_id: 'C', name: 'Cara', active: true },
  ],
  sessions: [
    { session_id: 's1', course: 'Class 1', date: '2026-09-20', start_time: '09:00', end_time: '10:00', status: 'closed' },
    { session_id: 's2', course: 'Class 1', date: '2026-09-22', start_time: '09:00', end_time: '10:00', status: 'closed' },
    { session_id: 's3', course: 'Class 1', date: '2026-09-28', start_time: '21:00', end_time: '22:00', status: 'active' },
  ],
  attendance: [
    { attendance_id: 'a1', session_id: 's1', student_id: 'A', student_name: 'Alice', scan_in: '2026-09-20T09:01:00+07:00', scan_out: '', status: 'Present' },
    { attendance_id: 'a2', session_id: 's1', student_id: 'B', student_name: 'Bob', scan_in: '2026-09-20T09:05:00+07:00', scan_out: '', status: 'Present' },
    { attendance_id: 'a3', session_id: 's2', student_id: 'A', student_name: 'Alice', scan_in: '2026-09-22T09:01:00+07:00', scan_out: '', status: 'Present' },
    { attendance_id: 'a4', session_id: 's2', student_id: 'B', student_name: 'Bob', scan_in: '2026-09-22T09:05:00+07:00', scan_out: '', status: 'Present' },
    { attendance_id: 'a5', session_id: 's2', student_id: 'C', student_name: 'Cara', scan_in: '2026-09-22T09:02:00+07:00', scan_out: '', status: 'Present' },
    { attendance_id: 'a6', session_id: 's3', student_id: 'A', student_name: 'Alice', scan_in: '2026-09-28T21:01:00+07:00', scan_out: '', status: 'Present' },
  ],
};

const sessionSummary = sessionAttendanceSummary(data);
assert.deepEqual(
  sessionSummary.map((s) => [s.session_id, s.attended, s.absent, s.pending, s.percentage, s.completed]),
  [
    ['s1', 2, 1, 0, 66.7, true],
    ['s2', 3, 0, 0, 100, true],
    ['s3', 1, 0, 2, 33.3, false],
  ],
);

const students = studentAttendanceSummary(data);
assert.deepEqual(
  students.map((s) => [s.student_id, s.sessions_held, s.attended, s.absent, s.percentage]),
  [
    ['A', 2, 2, 0, 100],
    ['B', 2, 2, 0, 100],
    ['C', 2, 1, 1, 50],
  ],
);

const overall = overallAttendanceSummary(data);
assert.deepEqual(overall, {
  sessions_held: 2,
  eligible: 6,
  attended: 5,
  absent: 1,
  percentage: 83.3,
});

assert.equal(percentage([
  { status: 'Present', scan_in: 'x' },
  { status: 'Absent', scan_in: '' },
  { status: 'Pending', scan_in: '' },
]), 50);

console.log('Attendance calculation tests passed.');
