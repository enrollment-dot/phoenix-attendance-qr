import {
  pendingAttempt,
  beginAttempt,
  clearAttempt,
} from './session-attempt.js';
import './style.css';
import QRCode from 'qrcode';
import { api, configured } from './api.js';
import { report, csv, percentage, scanLink, parseScan } from './reports.js';
const root = document.querySelector('#app');
let token = '',
  data = null,
  view = 'dashboard',
  scanner = null;
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const time = (v) =>
  v
    ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
const field = (label, name, type = 'text', extra = '') =>
  `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;
function frame(content, attendee = false) {
  root.innerHTML = `<div class="shell"><aside><a class="brand" href="#" aria-label="YLP Attendance"><span class="mark" aria-hidden="true">Y</span><span>YLP<small>ATTENDANCE</small></span></a><div class="workspace">${attendee ? 'STUDENT SPACE' : 'CLASSROOM WORKSPACE'}</div><nav>${attendee ? '<a href="#">← Back to home</a>' : `<button data-nav="dashboard" class="${view === 'dashboard' ? 'selected' : ''}">▦ &nbsp; Overview</button><button data-nav="reports" class="${view === 'reports' ? 'selected' : ''}">≡ &nbsp; Attendance</button><button data-nav="scanner">▣ &nbsp; Scan a QR</button>`}</nav><div class="aside-bottom">Simple attendance.<br>More time to teach.<hr><span class="tiny">GOOGLE SHEETS CONNECTED WORKFLOW</span></div></aside><main><header><span>${attendee ? 'Student check-in' : 'Classroom / ' + (view === 'reports' ? 'Attendance' : 'Overview')}</span>${token ? '<button class="text" id="logout">Sign out</button>' : '<span class="tiny">YLP ATTENDANCE</span>'}</header><div id="notice" role="status" aria-live="polite"></div>${content}<footer>Attendance for online classes · Independent of Google Meet</footer></main></div>`;
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
    try {
      await api('logout', {}, token);
    } catch {}
    token = '';
    data = null;
    render();
  });
}
function notice(message, bad = true) {
  const el = document.querySelector('#notice');
  el.className = bad ? 'notice error' : 'notice success';
  el.textContent = message;
  el.scrollIntoView({ block: 'nearest' });
}
async function busy(button, fn) {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Please wait…';
  try {
    await fn();
  } catch (e) {
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
    `<div class="page-title"><div><p class="eyebrow">WELCOME BACK</p><h1>Your classroom, accounted for.</h1><p>Manage sessions and keep attendance in one place.</p></div></div><section class="login-grid"><div class="card"><span class="step">ADMIN ACCESS</span><h2>Sign in to your workspace</h2><p>Use the admin password set up by your school.</p>${!configured ? '<div class="notice">Setup required: add your Apps Script URL to .env.local and rebuild. See README.md.</div>' : ''}<form id="login">${field('Admin password', 'password', 'password', 'autocomplete="current-password" minlength="16"')}<button class="primary full">Sign in →</button></form></div><div class="welcome-panel"><span class="large-qr">▦</span><h2>A scan at the start.<br>A scan at the end.</h2><p>Students can use their phone camera to open the class QR, or scan it here.</p><button id="student-scanner" class="light">Scan a class QR</button></div></section>`,
  );
  document.querySelector('#login').onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      token = (await api('login', Object.fromEntries(new FormData(e.target))))
        .token;
      await refresh();
    });
  };
  document.querySelector('#student-scanner').onclick = () => {
    view = 'scanner';
    render();
  };
}
async function refresh() {
  data = await api('dashboard', {}, token);
  if (pendingAttempt()) return createForm();
  render();
}
function dashboard() {
  const all = report(data),
    pct = percentage(all),
    active = data.sessions.filter((s) => s.status === 'active');
  frame(
    `<div class="page-title"><div><p class="eyebrow">CLASSROOM OVERVIEW</p><h1>Make every class count.</h1><p>Create a session, share its QR, and let attendance take care of itself.</p></div><button class="primary" id="create">＋ Create session</button></div><div class="stats"><div class="card"><span>Class sessions</span><strong>${data.sessions.length}</strong><small>${active.length} enabled for scanning</small></div><div class="card"><span>Enrolled students</span><strong>${data.students.length}</strong><small>Active students in your roster</small></div><div class="card"><span>Attendance rate</span><strong>${pct === null ? '—' : pct + '<em>%</em>'}</strong><small>${data.settings.enrolled ? 'Across completed attendance opportunities' : 'Recorded attendees only; no enrollment denominator'}</small></div></div><section class="card sessions"><div class="section-title"><div><h2>Your sessions</h2><p>Display a QR code to begin collecting attendance.</p></div><button class="text" id="refresh">↻ Refresh</button></div>${
      data.sessions.length
        ? `<div class="session-list">${[...data.sessions]
            .reverse()
            .map(
              (s) =>
                `<article class="session-row"><div class="date-tile"><b>${esc(s.date.slice(8))}</b><span>${esc(s.date.slice(0, 7))}</span></div><div class="session-info"><h3>${esc(s.course)}</h3><p>${esc(s.start_time)} – ${esc(s.end_time)} <span class="divider">/</span> UTC${esc(data.settings.offset)}</p></div><span class="badge ${s.status === 'active' ? 'present' : ''}">${esc(s.status)}</span><button class="secondary" data-qr="${esc(s.session_id)}">Display QR ↗</button></article>`,
            )
            .join('')}</div>`
        : '<div class="empty"><span>▦</span><h3>Your first class starts here</h3><p>Create a session to generate its attendance QR code.</p></div>'
    }</section><div class="tip"><b>One QR. Two simple actions.</b><span>Keep the session QR on screen for Scan In, then share it again for Scan Out.</span></div>`,
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
    `<div class="page-title"><div><p class="eyebrow">NEW CLASS</p><h1>Create a session</h1><p>Times use UTC${esc(data.settings.offset)}. Sessions start and end on the same day.</p></div></div><section class="card form-card"><form id="create-form">${field('Course name', 'course', 'text', 'maxlength="120" placeholder="e.g. English · Intermediate"')}<div class="form-grid">${field('Session date', 'date', 'date')}${field('Late threshold (minutes)', 'late_threshold', 'number', 'min="0" max="240" value="10"')}${field('Start time', 'start_time', 'time')}${field('End time', 'end_time', 'time')}</div><p class="helper">Scanning opens ${data.settings.openMinutes} minutes before class and closes ${data.settings.closeMinutes} minutes after class. Close a session manually to stop scans sooner.</p><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Create & display QR →</button></div></form></section>`,
  );
  const form = document.querySelector('#create-form');
  const submit = form.querySelector('button.primary');
  document.querySelector('#cancel').onclick = dashboard;
  const restore = () => {
    const pending = pendingAttempt();
    if (pending) {
      for (const [key, value] of Object.entries(pending))
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
    submit.disabled = true;
    try {
      const attempt = beginAttempt(Object.fromEntries(new FormData(form)));
      restore();
      submit.textContent = 'Confirming…';
      let session;
      try {
        session = await api('createSession', attempt, token);
      } catch (error) {
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
      clearAttempt();
      const index = data.sessions.findIndex(
        (s) => s.session_id === session.session_id,
      );
      if (index < 0) data.sessions.push(session);
      else data.sessions[index] = session;
      await showQr(session);
    } catch (error) {
      notice(
        error.message ||
          'Unable to preserve the pending request. Nothing new was submitted.',
      );
    } finally {
      submit.disabled = false;
      if (submit.isConnected) submit.textContent = 'Retry confirmation';
    }
  };
}
async function showQr(s) {
  frame(
    `<div class="page-title"><div><p class="eyebrow">SESSION QR</p><h1>${esc(s.course)}</h1><p>${esc(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)} · UTC${esc(data.settings.offset)}</p></div><button id="back" class="secondary">Back to overview</button></div><section class="card qr-card"><span class="badge present">${esc(s.status)}</span><h2>Scan to record your attendance</h2><canvas id="qr" aria-label="Class attendance QR code"></canvas><p>Open your phone camera and point it at this QR.<br>Enter your student ID, then choose Scan In or Scan Out.</p><div class="actions"><button id="copy" class="secondary">Copy student link</button><button id="download" class="secondary">Download QR</button>${s.status === 'active' ? '<button id="close" class="danger">Close session</button>' : ''}</div><p class="helper">This QR grants access to this session. Share it only with your class.</p></section>`,
  );
  document.querySelector('#back').onclick = dashboard;
  await QRCode.toCanvas(document.querySelector('#qr'), scanLink(s), {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#152c2a', light: '#ffffff' },
  });
  document.querySelector('#copy').onclick = (e) =>
    busy(e.target, async () => {
      await navigator.clipboard.writeText(scanLink(s));
      notice('Student link copied.', false);
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
        showQr(s);
      });
  });
}
function reports() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">ATTENDANCE RECORDS</p><h1>The full class picture.</h1><p>Review arrivals, departures, and attendance across your sessions.</p></div><button class="primary" id="export">↓ Export CSV</button></div><section class="card"><form id="filters" class="filters"><label>Session<select name="session"><option value="">All sessions</option>${data.sessions.map((s) => `<option value="${esc(s.session_id)}">${esc(s.course)} · ${esc(s.date)}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${[...new Set(data.sessions.map((s) => s.course))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><label>Date<input name="date" type="date"></label><label>Student<input name="student" placeholder="Name or ID" type="search"></label></form><div id="report-summary" class="section-title"></div><div class="table-wrap"><table><thead><tr>${['Student', 'Course / date', 'Scan In', 'Scan Out', 'Minutes', 'Status'].map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div><p class="helper">Times shown in your device timezone. Absent is calculated after class ends; upcoming students are Pending. Percentage counts students with Scan In, including late and early departures. ${data.settings.enrolled ? 'The current active roster is used for all courses.' : 'Enrollment validation is disabled: percentage covers recorded attendees only.'}</p></section>`,
  );
  let current = [];
  const update = () => {
    current = report(
      data,
      Object.fromEntries(new FormData(document.querySelector('#filters'))),
    );
    const pct = percentage(current);
    document.querySelector('#report-summary').innerHTML =
      `<h2>${current.length} records</h2><span>${pct === null ? '—' : pct + '%'} attendance</span>`;
    document.querySelector('#rows').innerHTML = current.length
      ? current
          .map(
            (r) =>
              `<tr><td><b>${esc(r.student_name)}</b><small>${esc(r.student_id)}</small></td><td>${esc(r.course)}<small>${esc(r.date)}</small></td><td>${time(r.scan_in)}</td><td>${time(r.scan_out)}</td><td>${esc(r.duration_minutes ?? '—')}</td><td><span class="badge ${r.status === 'Present' ? 'present' : r.status === 'Absent' ? 'absent' : ''}">${esc(r.status)}</span></td></tr>`,
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
  try {
    const s = await api('session', credentials);
    frame(
      `<section class="card student-card"><p class="eyebrow">CLASS ATTENDANCE</p><h1>${esc(s.course)}</h1><p>${esc(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)}<br>UTC${esc(s.offset)}</p><hr><form id="scan-form">${field('Student ID', 'student_id', 'text', 'autocomplete="username" pattern="[a-zA-Z0-9_-]+" maxlength="40" placeholder="Your student ID"')}${field('Student name', 'student_name', 'text', 'autocomplete="name" maxlength="100" placeholder="Your full name"')}<div class="scan-actions"><button name="direction" value="in" class="primary">↳ Scan In</button><button name="direction" value="out" class="secondary">↗ Scan Out</button></div></form><p class="helper">Use the same student ID when you leave. Your teacher’s roster name is used when enrolled.</p></section>`,
      true,
    );
    document.querySelector('#scan-form').onsubmit = (e) => {
      e.preventDefault();
      const button = e.submitter,
        buttons = [...e.target.querySelectorAll('button')],
        payload = {
          ...credentials,
          ...Object.fromEntries(new FormData(e.target)),
          direction: button.value,
        };
      buttons.forEach((b) => (b.disabled = true));
      busy(button, async () => {
        const r = await api('scan', payload);
        frame(
          `<section class="card student-card result"><div class="check">✓</div><p class="eyebrow">ATTENDANCE SAVED</p><h1>${payload.direction === 'in' ? 'You’re checked in.' : 'You’re checked out.'}</h1><p>${esc(r.student_name)} · ${esc(r.student_id)}</p><div class="receipt"><b>${esc(s.course)}</b><p>${esc(r.status)} · ${time(r.updated_at)}</p>${r.duration_minutes !== '' ? `<p>${esc(r.duration_minutes)} minutes attended</p>` : ''}</div><p>Your attendance has been recorded. You can close this page.</p><button class="secondary full" id="return">Return to session</button></section>`,
          true,
        );
        document.querySelector('#return').onclick = student;
      }).finally(() => buttons.forEach((b) => (b.disabled = false)));
    };
  } catch (e) {
    frame(
      '<section class="card student-card"><h1>Unable to open class</h1><p>Scan the class QR again or contact your teacher.</p><button class="secondary" id="retry">Try again</button></section>',
      true,
    );
    notice(e.message);
    document.querySelector('#retry').onclick = student;
  }
}
async function scannerPage() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">STUDENT ATTENDANCE</p><h1>Scan your class QR</h1><p>Allow camera access, then point your camera at the QR shared by your teacher.</p></div></div><section class="card student-card"><div id="reader"></div><button id="start-camera" class="primary full">Open camera</button><p class="helper">Camera access requires HTTPS or localhost. You can also use your phone’s camera app to open the class QR.</p><form id="paste"><label>Or paste a class link<input name="url" type="url" required placeholder="https://…"></label><button class="secondary full">Open class link</button></form></section>`,
    true,
  );
  const accept = async (value) => {
    try {
      const hash = parseScan(value);
      await stopCamera();
      location.hash = hash;
    } catch (e) {
      notice(e.message);
    }
  };
  document.querySelector('#start-camera').onclick = (e) =>
    busy(e.target, async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      scanner = new Html5Qrcode('reader');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 230, height: 230 } },
        accept,
        () => {},
      );
      e.target.hidden = true;
    });
  document.querySelector('#paste').onsubmit = (e) => {
    e.preventDefault();
    accept(new FormData(e.target).get('url'));
  };
}
async function stopCamera() {
  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch {}
    scanner = null;
  }
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
