import { pendingScan, beginScan, clearScan } from './scan-attempt.js';
import { scanHandler } from './scan-handler.js';
import {
  thailandTimestamp,
  REPORT_TIME_ZONE_LABEL,
  sessionTimes,
  sessionLabel,
  sessionToBackend,
} from './time.js';
import { cameraLifecycle } from './camera.js';
import {
  pendingAttempt,
  beginAttempt,
  clearAttempt,
} from './session-attempt.js';
import './style.css';
import QRCode from 'qrcode';
import { api, configured } from './api.js';
import {
  report,
  filterReport,
  csv,
  percentage,
  scanLink,
  parseScan,
} from './reports.js';
const root = document.querySelector('#app');
let token = '',
  data = null,
  view = 'dashboard',
  pageVersion = 0;
const camera = cameraLifecycle();
function pageGuard() {
  const version = pageVersion,
    hash = location.hash;
  return () => version === pageVersion && hash === location.hash;
}
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const field = (label, name, type = 'text', extra = '') =>
  `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;
function frame(content, attendee = false) {
  pageVersion++;
  root.innerHTML = `<div class="shell"><aside><a class="brand" href="#" aria-label="YLP Attendance"><span class="mark" aria-hidden="true">Y</span><span>YLP<small>ATTENDANCE</small></span></a><div class="workspace">${attendee ? 'YLP STUDENTS' : 'YLP TEACHING TEAM'}</div><nav>${attendee ? '<a href="#">← Back to home</a>' : `<button data-nav="dashboard" class="${view === 'dashboard' ? 'selected' : ''}">▦ &nbsp; Overview</button><button data-nav="reports" class="${view === 'reports' ? 'selected' : ''}">≡ &nbsp; Attendance</button><button data-nav="scanner">▣ &nbsp; Scan a QR</button>`}</nav><div class="aside-bottom">Your class.<br>Your attendance.<hr><span class="tiny">YLP · YLP CLASS ATTENDANCE</span></div></aside><main><header><span>${attendee ? 'YLP / Student attendance' : 'YLP / ' + (view === 'reports' ? 'Attendance' : 'Overview')}</span>${token ? '<button class="text" id="logout">Sign out</button>' : '<span class="tiny">YLP ATTENDANCE</span>'}</header><div id="notice" role="status" aria-live="polite"></div>${content}<footer>YLP Attendance · For teachers and students</footer></main></div>`;
  root.querySelectorAll('a[href="#"]').forEach(
    (a) =>
      (a.onclick = () => {
        view = 'dashboard';
        if (!location.hash) render();
      }),
  );
  root.querySelectorAll('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.nav;
        render();
      }),
  );
  root.querySelector('#logout')?.addEventListener('click', async () => {
    const previousToken = token;
    token = '';
    data = null;
    render();
    try {
      await api('logout', {}, previousToken);
    } catch {}
  });
}
function notice(message, bad = true) {
  const el = document.querySelector('#notice');
  el.className = bad ? 'notice error' : 'notice success';
  el.textContent = message;
  el.scrollIntoView({ block: 'nearest' });
}
async function busy(button, fn) {
  if (button.disabled) return;
  const current = pageGuard();
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Please wait…';
  try {
    await fn();
  } catch (e) {
    if (!current()) return;
    notice(
      e.message ||
        'Camera access failed. Check permission or use your phone camera app.',
    );
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}
function login() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP ATTENDANCE</p><h1>Attendance for every YLP class.</h1><p>Create class sessions, share attendance QR codes, and review student records.</p></div></div><section class="login-grid"><div class="card"><span class="step">TEACHER &amp; ADMIN ACCESS</span><h2>Sign in to YLP Attendance</h2><p>Use the admin password provided by your YLP administrator.</p>${!configured ? '<div class="notice">YLP Attendance is not configured yet. Ask your YLP administrator to complete setup.</div>' : ''}<form id="login">${field('Admin password', 'password', 'password', 'autocomplete="current-password" minlength="16"')}<button class="primary full">Sign in →</button></form></div><div class="welcome-panel"><span class="large-qr">▦</span><h2>Joining a YLP class?</h2><p>Open the QR shared by your teacher. Choose Scan In when you arrive and Scan Out when you leave.</p><button id="student-scanner" class="light">Scan a class QR</button></div></section>`,
  );
  document.querySelector('#login').onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const current = pageGuard();
      const result = await api(
        'login',
        Object.fromEntries(new FormData(e.target)),
      );
      if (!current()) return;
      token = result.token;
      await refresh();
    });
  };
  document.querySelector('#student-scanner').onclick = () => {
    view = 'scanner';
    render();
  };
}
async function refresh() {
  const current = pageGuard(),
    auth = token;
  const result = await api('dashboard', {}, auth);
  if (!current() || auth !== token) return;
  data = result;
  if (pendingAttempt()) return createForm();
  render();
}
function dashboard() {
  const all = report(data),
    pct = percentage(all),
    active = data.sessions.filter((s) => s.status === 'active');
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP CLASS SESSIONS</p><h1>Class overview</h1><p>Manage your YLP sessions and review attendance.</p></div><button class="primary" id="create">＋ Create session</button></div><div class="stats"><div class="card"><span>Class sessions</span><strong>${data.sessions.length}</strong><small>${active.length} enabled for scanning</small></div><div class="card"><span>Enrolled students</span><strong>${data.students.length}</strong><small>Active students on the YLP roster</small></div><div class="card"><span>Attendance rate</span><strong>${pct === null ? '—' : pct + '<em>%</em>'}</strong><small>${data.settings.enrolled ? 'Scanned in across non-pending records' : 'Recorded attendees only; roster validation is off'}</small></div></div><section class="card sessions"><div class="section-title"><div><h2>Class sessions</h2><p>Share a session QR with your class for Scan In and Scan Out.</p></div><button class="text" id="refresh">↻ Refresh</button></div>${
      data.sessions.length
        ? `<div class="session-list">${[...data.sessions]
            .reverse()
            .map(
              (s) =>
                `<article class="session-row"><div class="date-tile"><b>${esc(sessionTimes(s, data.settings.offset).date.slice(8))}</b><span>${esc(sessionTimes(s, data.settings.offset).date.slice(0, 7))}</span></div><div class="session-info"><h3>${esc(s.course)}</h3><p>${esc(sessionLabel(s, data.settings.offset))}</p></div><span class="badge ${s.status === 'active' ? 'present' : ''}">${esc(s.status)}</span><button class="secondary" data-qr="${esc(s.session_id)}">Display QR ↗</button></article>`,
            )
            .join('')}</div>`
        : '<div class="empty"><span>▦</span><h3>No sessions yet</h3><p>Create a session to generate its attendance QR code.</p></div>'
    }</section><div class="tip"><b>Use the same QR for arrival and departure.</b><span>Keep the session QR on screen for Scan In, then share it again for Scan Out.</span></div>`,
  );
  document.querySelector('#create').onclick = createForm;
  document.querySelector('#refresh').onclick = (e) => busy(e.target, refresh);
  root
    .querySelectorAll('[data-qr]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          showQr(data.sessions.find((s) => s.session_id === b.dataset.qr))),
    );
}
function createForm() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">NEW YLP SESSION</p><h1>Create a session</h1><p>Times use ${REPORT_TIME_ZONE_LABEL}. Sessions start and end on the same day.</p></div></div><section class="card form-card"><form id="create-form">${field('Course name', 'course', 'text', 'maxlength="120" placeholder="e.g. English · Intermediate"')}<div class="form-grid">${field('Session date', 'date', 'date')}${field('Late threshold (minutes)', 'late_threshold', 'number', 'min="0" max="240" value="10"')}${field('Start time', 'start_time', 'time')}${field('End time', 'end_time', 'time')}</div><p class="helper">Scanning opens ${data.settings.openMinutes} minutes before class and closes ${data.settings.closeMinutes} minutes after class. Close a session manually to stop scans sooner.</p><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Create & display QR →</button></div></form></section>`,
  );
  const form = document.querySelector('#create-form');
  const submit = form.querySelector('button.primary');
  document.querySelector('#cancel').onclick = dashboard;
  const restore = () => {
    const pending = pendingAttempt();
    if (pending) {
      for (const [key, value] of Object.entries({
        ...pending,
        ...sessionTimes(pending, data.settings.offset),
      }))
        if (form.elements[key]) {
          form.elements[key].value = value;
          form.elements[key].disabled = true;
        }
      submit.textContent = 'Retry confirmation';
      notice(
        'A session request is awaiting confirmation. Retry confirmation to check or complete that same request safely.',
      );
    }
  };
  try {
    restore();
  } catch {
    submit.disabled = true;
    notice(
      'Cannot read pending session storage. Resolve browser storage access before creating a session.',
    );
  }
  if (!data.session_creation_idempotency) {
    submit.disabled = true;
    notice(
      'Update the Apps Script deployment for safe session retries, then sign in again. Creation is disabled until that update is active.',
    );
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    // Reject invalid drafts before persisting an immutable retry request.
    const values = Object.fromEntries(new FormData(form));
    let pending;
    try {
      pending = pendingAttempt();
    } catch {
      notice(
        'Cannot read pending session storage. Resolve browser storage access before creating a session.',
      );
      return;
    }
    if (
      !pending &&
      (!values.course.trim() || values.end_time <= values.start_time)
    ) {
      notice('Enter a course name and an end time later than the start time.');
      return;
    }
    const current = pageGuard();
    submit.disabled = true;
    try {
      const attempt =
        pending || beginAttempt(sessionToBackend(values, data.settings.offset));
      restore();
      submit.textContent = 'Confirming…';
      let session;
      try {
        session = await api('createSession', attempt, token);
      } catch (error) {
        if (!current()) return;
        restore();
        notice(
          error.kind === 'server'
            ? error.message +
                ' The pending request has been retained; sign in again if needed, then retry confirmation.'
            : 'We couldn’t confirm whether this session was saved. Use “Retry confirmation” to check or complete this same request safely.',
        );
        return;
      }
      if (
        session?.session_id !== attempt.request_id ||
        typeof session.qr_token !== 'string'
      )
        throw new Error(
          'The session confirmation did not match. The pending request is retained; contact your administrator.',
        );
      if (!current()) return;
      clearAttempt(attempt.request_id);
      const index = data.sessions.findIndex(
        (s) => s.session_id === session.session_id,
      );
      if (index < 0) data.sessions.push(session);
      else data.sessions[index] = session;
      await showQr(session);
    } catch (error) {
      if (!current()) return;
      notice(
        error.message ||
          'Unable to preserve the pending request. Nothing new was submitted.',
      );
    } finally {
      submit.disabled = false;
      if (submit.isConnected) {
        try {
          submit.textContent = pendingAttempt()
            ? 'Retry confirmation'
            : 'Create & display QR →';
        } catch {
          submit.disabled = true;
        }
      }
    }
  };
}
async function showQr(s) {
  frame(
    `<div class="page-title"><div><p class="eyebrow">SESSION QR</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, data.settings.offset))}</p></div><button id="back" class="secondary">Back to overview</button></div><section class="card qr-card"><span class="badge present">${esc(s.status)}</span><h2>Record your YLP attendance</h2><canvas id="qr" aria-label="Class attendance QR code"></canvas><p>Open your phone camera and point it at this QR.<br>Enter your student ID, then choose Scan In or Scan Out.</p><div class="actions"><button id="copy" class="secondary">Copy student link</button><button id="download" class="secondary">Download QR</button>${s.status === 'active' ? '<button id="close" class="danger">Close session</button>' : ''}</div><p class="helper">Share this QR only with students in this YLP class. It gives access to this session.</p></section>`,
  );
  const current = pageGuard();
  document.querySelector('#back').onclick = dashboard;
  await QRCode.toCanvas(document.querySelector('#qr'), scanLink(s), {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#152c2a', light: '#ffffff' },
  });
  if (!current()) return;
  document.querySelector('#copy').onclick = (e) =>
    busy(e.target, async () => {
      await navigator.clipboard.writeText(scanLink(s));
      if (current()) notice('Student link copied.', false);
    });
  document.querySelector('#download').onclick = () => {
    const a = document.createElement('a');
    a.download = `ylp-${s.session_id}.png`;
    a.href = document.querySelector('#qr').toDataURL();
    a.click();
  };
  document.querySelector('#close')?.addEventListener('click', (e) => {
    if (
      confirm(
        'Close this session? Students will no longer be able to scan in or out.',
      )
    )
      busy(e.target, async () => {
        Object.assign(
          s,
          await api('closeSession', { session_id: s.session_id }, token),
        );
        if (current()) showQr(s);
      });
  });
}
function reports() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP ATTENDANCE RECORDS</p><h1>Attendance report</h1><p>Review student attendance by session, course, date, or student.</p></div><button class="primary" id="export">↓ Export CSV</button></div><section class="card"><form id="filters" class="filters"><label>Session<select name="session"><option value="">All sessions</option>${data.sessions.map((s) => `<option value="${esc(s.session_id)}">${esc(s.course)} · ${esc(sessionTimes(s, data.settings.offset).date)}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${[...new Set(data.sessions.map((s) => s.course))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><label>Date<input name="date" type="date"></label><label>Student<input name="student" placeholder="Name or ID" type="search"></label></form><div id="report-summary" class="section-title"></div><div class="table-wrap"><table><thead><tr>${['Student', 'Course / date', 'Scan In', 'Scan Out', 'Minutes', 'Status'].map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div><p class="helper">Timestamps shown in ${REPORT_TIME_ZONE_LABEL}. Dates beside course names are the scheduled session dates. Absent is calculated after class ends; upcoming students are Pending. Percentage counts students with Scan In, including late and early departures. ${data.settings.enrolled ? 'The current active roster is used for all courses.' : 'Enrollment validation is disabled: percentage covers recorded attendees only.'}</p></section>`,
  );
  const allRows = report(data);
  let current = [];
  const update = () => {
    current = filterReport(
      allRows,
      Object.fromEntries(new FormData(document.querySelector('#filters'))),
    );
    const pct = percentage(current);
    document.querySelector('#report-summary').innerHTML =
      `<h2>${current.length} records</h2><span>${pct === null ? '—' : pct + '%'} attendance</span>`;
    document.querySelector('#rows').innerHTML = current.length
      ? current
          .map(
            (r) =>
              `<tr><td><b>${esc(r.student_name)}</b><small>${esc(r.student_id)}</small></td><td>${esc(r.course)}<small>${esc(r.date)}</small></td><td>${thailandTimestamp(r.scan_in)}</td><td>${thailandTimestamp(r.scan_out)}</td><td>${esc(r.duration_minutes ?? '—')}</td><td><span class="badge ${r.status === 'Present' ? 'present' : r.status === 'Absent' ? 'absent' : ''}">${esc(r.status)}</span></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="empty">No records match these filters.</td></tr>';
  };
  document.querySelector('#filters').oninput = update;
  document.querySelector('#filters').onsubmit = (e) => e.preventDefault();
  document.querySelector('#export').onclick = () => {
    const u = URL.createObjectURL(
        new Blob([csv(current)], { type: 'text/csv;charset=utf-8;' }),
      ),
      a = document.createElement('a');
    a.href = u;
    a.download = 'ylp-attendance.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  update();
}
async function student() {
  const params = new URLSearchParams(location.hash.slice(1)),
    credentials = {
      session_id: params.get('session'),
      qr_token: params.get('token'),
    };
  frame(
    '<section class="card student-card"><h1>Loading your class…</h1></section>',
    true,
  );
  const loadingCurrent = pageGuard();
  try {
    const s = await api('session', credentials);
    if (!loadingCurrent()) return;
    frame(
      `<section class="card student-card"><p class="eyebrow">YLP CLASS ATTENDANCE</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, s.offset))}</p><hr><form id="scan-form">${field('Student ID', 'student_id', 'text', 'autocomplete="username" pattern="[a-zA-Z0-9_-]+" maxlength="40" placeholder="Your student ID"')}${field('Student name', 'student_name', 'text', 'autocomplete="name" maxlength="100" placeholder="Your full name"')}<div class="scan-actions"><button name="direction" value="in" class="primary">↳ Scan In</button><button name="direction" value="out" class="secondary">↗ Scan Out</button></div></form><p class="helper">Choose Scan In when you arrive and Scan Out when you leave. Use the same student ID both times. Enrolled students use the name on the YLP roster.</p></section>`,
      true,
    );
    const current = pageGuard();
    const form = document.querySelector('#scan-form');
    const buttons = [...form.querySelectorAll('button')];
    let submitting = false;
    const restoreScan = (showNotice = false) => {
      try {
        const pending = pendingScan(s.session_id);
        for (const name of ['student_id', 'student_name']) {
          if (pending) form.elements[name].value = pending[name];
          form.elements[name].disabled = !!pending;
        }
        buttons.forEach((button) => {
          const label = button.value === 'in' ? 'Scan In' : 'Scan Out';
          button.textContent =
            pending && pending.direction === button.value
              ? 'Retry ' + label + ' confirmation'
              : label;
          button.disabled =
            submitting ||
            !s.scan_request_idempotency ||
            (!!pending && pending.direction !== button.value);
        });
        if (!s.scan_request_idempotency)
          notice(
            'Scan submissions need a backend update for safe retries. Contact your YLP administrator.',
          );
        else if (pending && showNotice)
          notice(
            'A scan is awaiting confirmation. Retry this same request to check or complete it safely.',
          );
      } catch (error) {
        buttons.forEach((button) => {
          button.disabled = true;
        });
        notice(error.message);
      }
    };
    restoreScan(true);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (
        submitting ||
        !s.scan_request_idempotency ||
        !e.submitter ||
        e.submitter.disabled
      )
        return;
      let attempt;
      submitting = true;
      try {
        attempt = beginScan({
          session_id: s.session_id,
          ...Object.fromEntries(new FormData(form)),
          direction: e.submitter.value,
        });
        restoreScan();
        e.submitter.textContent = 'Confirming attendance…';
        const payload = { ...attempt, qr_token: credentials.qr_token };
        const r = await api('scan', payload);
        if (
          r?.request_id !== attempt.request_id ||
          r.session_id !== attempt.session_id ||
          r.student_id !== attempt.student_id ||
          !r[attempt.direction === 'in' ? 'scan_in' : 'scan_out']
        )
          throw new Error(
            'The scan receipt did not match the pending request.',
          );
        if (!current()) return;
        clearScan(s.session_id, attempt.request_id);
        frame(
          `<section class="card student-card result"><div class="check">✓</div><p class="eyebrow">ATTENDANCE SAVED</p><h1>${payload.direction === 'in' ? 'You’re checked in.' : 'You’re checked out.'}</h1><p>${esc(r.student_name)} · ${esc(r.student_id)}</p><div class="receipt"><b>${esc(s.course)}</b><p>${esc(r.status)} · ${thailandTimestamp(r.updated_at)} · ${REPORT_TIME_ZONE_LABEL}</p>${r.duration_minutes !== '' ? `<p>${esc(r.duration_minutes)} minutes attended</p>` : ''}</div><p>Your YLP attendance is saved. You can close this page.</p><button class="secondary full" id="return">Return to session</button></section>`,
          true,
        );
        document.querySelector('#return').onclick = student;
      } catch (error) {
        if (!current()) return;
        if (error.code === 'scan_rejected' && attempt) {
          try {
            clearScan(s.session_id, attempt.request_id);
            notice(error.message);
          } catch {
            notice(
              'The scan was rejected, but its pending draft could not be cleared. Restore browser storage access before trying again.',
            );
          }
        } else {
          notice(
            attempt
              ? 'Attendance could not be confirmed. It may already be saved. Retry the same scan confirmation; do not start a new request.'
              : error.message,
          );
        }
      } finally {
        submitting = false;
        if (form.isConnected) restoreScan();
      }
    };
  } catch (e) {
    if (!loadingCurrent()) return;
    frame(
      '<section class="card student-card"><h1>Unable to open class</h1><p>Try loading the class again. If it still does not open, ask your YLP teacher for help.</p><button class="secondary" id="retry">Try again</button></section>',
      true,
    );
    notice(e.message);
    document.querySelector('#retry').onclick = student;
  }
}
async function scannerPage() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP STUDENT ATTENDANCE</p><h1>Scan your class QR</h1><p>Allow camera access, then point your camera at the QR shared by your teacher.</p></div></div><section class="card student-card"><div id="reader"></div><button id="start-camera" class="primary full">Open camera</button><p class="helper">If the camera does not open, check your browser’s camera permission or use your phone’s camera app. You can also paste the class link below.</p><form id="paste"><label>Or paste a class link<input name="url" type="url" required placeholder="https://…"></label><button class="secondary full">Open class link</button></form></section>`,
    true,
  );
  const current = pageGuard();
  const handle = scanHandler(
    parseScan,
    stopCamera,
    (hash) => {
      if (current()) location.hash = hash;
    },
    (error) => {
      if (current()) notice(error.message);
    },
  );
  const accept = (value) => {
    if (current()) return handle(value);
  };
  document.querySelector('#start-camera').onclick = (e) =>
    busy(e.target, async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!current()) return;
      const started = await camera.start(
        new Html5Qrcode('reader'),
        (scanner) =>
          scanner.start(
            { facingMode: 'environment' },
            { fps: 8, qrbox: { width: 230, height: 230 } },
            accept,
            () => {},
          ),
        current,
      );
      if (started && current()) e.target.hidden = true;
    });
  document.querySelector('#paste').onsubmit = (e) => {
    e.preventDefault();
    accept(new FormData(e.target).get('url'));
  };
}
async function stopCamera() {
  await camera.stop();
}
function render() {
  stopCamera();
  if (location.hash.includes('session=')) return student();
  if (view === 'scanner') return scannerPage();
  if (!token || !data) return login();
  if (view === 'reports') return reports();
  dashboard();
}
window.addEventListener('hashchange', render);
window.addEventListener('pagehide', stopCamera);
render();
