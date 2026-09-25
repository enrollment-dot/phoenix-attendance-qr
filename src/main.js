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
  initializeRecovery,
  recoveryMessage,
  updateRecoveryPassword,
} from './auth-recovery.js';
import {
  report,
  filterReport,
  csv,
  percentage,
  scanLink,
  parseScan,
} from './reports.js';
// RBAC staging frontend deployment marker: 2026-09-24
const YLA_LOGO_SRC = 'yla-logo-mark.png';
const root = document.querySelector('#app');
let token = '',
  role = '',
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
  root.innerHTML = `<div class="shell"><aside><a class="brand" href="#" aria-label="Young Leadership Academy"><img class="mark" src="${YLA_LOGO_SRC}" alt="" /><span>Young Leadership Academy<small>LEARN • LEAD • GROW</small></span></a><div class="workspace">${attendee ? 'STUDENTS' : 'TEACHING TEAM'}</div><nav>${attendee ? '<a href="#">← Back to home</a>' : `<button data-nav="dashboard" class="${view === 'dashboard' ? 'selected' : ''}">▦ &nbsp; Overview</button><button data-nav="reports" class="${view === 'reports' ? 'selected' : ''}">≡ &nbsp; Attendance</button>${role === 'admin' ? `<button data-nav="students" class="${view === 'students' ? 'selected' : ''}">♙ &nbsp; Students</button>` : ''}${role === 'admin' ? `<button data-nav="accounts" class="${view === 'accounts' ? 'selected' : ''}">♙ &nbsp; Accounts</button>` : ''}<button data-nav="scanner">▣ &nbsp; Scan a QR</button>`}</nav><div class="aside-bottom">Your class.<br>Your attendance.<hr><span class="tiny">LEARN • LEAD • GROW</span></div></aside><main><header><span>${attendee ? 'Young Leadership Academy / Student attendance' : 'Young Leadership Academy / ' + (view === 'reports' ? 'Attendance' : 'Overview')}</span>${token ? '<button class="text" id="logout">Sign out</button>' : '<span class="tiny">LEARN • LEAD • GROW</span>'}</header><div id="notice" role="status" aria-live="polite"></div>${content}<footer>Young Leadership Academy · For teachers and students</footer></main></div>`;
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
    role = '';
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
    `<div class="page-title"><div><p class="eyebrow">YOUNG LEADERSHIP ACADEMY</p><h1>Attendance for every Academy class.</h1><p>Create class sessions, share attendance QR codes, and review student records.</p></div></div><section class="login-grid"><div class="card"><span class="step">TEACHER &amp; ADMIN ACCESS</span><h2>Sign in to Young Leadership Academy</h2><p>Use your Academy username and password.</p>${!configured ? '<div class="notice">Young Leadership Academy is not configured yet. Ask your administrator to complete setup.</div>' : ''}<form id="login">${field('Username', 'username', 'text', 'autocomplete="username"')}${field('Password', 'password', 'password', 'autocomplete="current-password" minlength="16"')}<button class="primary full">Sign in →</button></form></div><div class="welcome-panel"><span class="large-qr">▦</span><h2>Joining a Young Leadership Academy class?</h2><p>Open the QR shared by your teacher. Choose Scan In when you arrive and Scan Out when you leave.</p><button id="student-scanner" class="light">Scan a class QR</button></div></section>`,
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
      if (!result || typeof result.token !== 'string' || !result.token.trim()) {
        throw new Error('The service returned an invalid login confirmation.');
      }
      token = result.token;
      role = result.role === 'admin' || result.role === 'operator' ? result.role : '';
      await refresh();
    });
  };
  document.querySelector('#student-scanner').onclick = () => {
    view = 'scanner';
    render();
  };
}
function resetPassword(kind = null) {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YOUNG LEADERSHIP ACADEMY</p><h1>Reset your password.</h1><p>Choose a new password for your Academy administrator account.</p></div></div><section class="login-grid"><div class="card"><span class="step">ADMIN PASSWORD RECOVERY</span><h2>Set a new password</h2><p>Use at least 16 characters. Your password is sent directly to Supabase Auth and is never displayed or logged.</p>${kind ? `<div class="notice error">${esc(recoveryMessage(kind))}</div><button class="secondary full" id="return-login">Return to sign in</button>` : `<form id="reset-password"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="16" required></label><label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="16" required></label><button class="primary full">Save new password →</button></form>`}</div><div class="welcome-panel"><span class="large-qr">✓</span><h2>Secure account access</h2><p>After the password changes, this recovery session will be signed out and you will return to the normal admin sign-in screen.</p></div></section>`,
  );
  document.querySelector('#return-login')?.addEventListener('click', () => {
    render();
  });
  const form = document.querySelector('#reset-password');
  if (!form) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const values = Object.fromEntries(new FormData(form));
      if (values.password !== values.confirm_password) {
        throw new Error('The passwords do not match.');
      }
      await updateRecoveryPassword(values.password);
      notice('Password updated. Please sign in with your new password.', false);
      setTimeout(() => render(), 700);
    });
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
    `<div class="page-title"><div><p class="eyebrow">ACADEMY CLASS SESSIONS</p><h1>Class overview</h1><p>Manage your Academy sessions and review attendance.</p></div><button class="primary" id="create">＋ Create session</button></div><div class="stats"><div class="card"><span>Class sessions</span><strong>${data.sessions.length}</strong><small>${active.length} enabled for scanning</small></div><div class="card"><span>Enrolled students</span><strong>${data.students.length}</strong><small>Active students on the Academy roster</small></div><div class="card"><span>Attendance rate</span><strong>${pct === null ? '—' : pct + '<em>%</em>'}</strong><small>${data.settings.enrolled ? 'Scanned in across non-pending records' : 'Recorded attendees only; roster validation is off'}</small></div></div><section class="card sessions"><div class="section-title"><div><h2>Class sessions</h2><p>Share a session QR with your class for Scan In and Scan Out.</p></div><button class="text" id="refresh">↻ Refresh</button></div>${
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
    `<div class="page-title"><div><p class="eyebrow">NEW ACADEMY SESSION</p><h1>Create a session</h1><p>Times use ${REPORT_TIME_ZONE_LABEL}. Sessions start and end on the same day.</p></div></div><section class="card form-card"><form id="create-form">${field('Course name', 'course', 'text', 'maxlength="120" placeholder="e.g. English · Intermediate"') }<div class="form-grid">${field('Session date', 'date', 'date')}${field('Late threshold (minutes)', 'late_threshold', 'number', 'min="0" max="240" value="10"')}${field('Start time', 'start_time', 'time')}${field('End time', 'end_time', 'time')}</div><p class="helper">Scanning opens ${data.settings.openMinutes} minutes before class and closes ${data.settings.closeMinutes} minutes after class. Close a session manually to stop scans sooner.</p><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Create & display QR →</button></div></form></section>`,
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
    `<div class="page-title"><div><p class="eyebrow">SESSION QR</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, data.settings.offset))}</p></div><button id="back" class="secondary">Back to overview</button></div><section class="card qr-card"><span class="badge present">${esc(s.status)}</span><div class="qr-brand" aria-label="Young Leadership Academy"><strong>Young Leadership Academy</strong><span>LEARN • LEAD • GROW</span></div><canvas id="qr" aria-label="Class attendance QR code"></canvas><h2 class="qr-session-name">${esc(s.course)}</h2><h3 class="qr-attendance-title">Record your attendance</h3><p>Open your phone camera and point it at this QR.<br>Enter your student ID, then choose Scan In or Scan Out.</p><div class="actions"><button id="copy" class="secondary">Copy student link</button><button id="download" class="secondary">Download QR</button>${s.status === 'active' ? '<button id="close" class="danger">Close session</button>' : role === 'admin' ? '<button id="delete-session" class="danger">Delete session</button>' : ''}</div><p class="helper">Share this QR only with students in this Academy class. It gives access to this session.</p></section>`,
  );
  const current = pageGuard();
  document.querySelector('#back').onclick = dashboard;
  const canvas = document.querySelector('#qr');
  await QRCode.toCanvas(canvas, scanLink(s), {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#152c2a', light: '#ffffff' },
  });
  if (!current()) return;

  // Brand the QR itself with the same YLA logo already used by the web app.
  const logo = new Image();
  await new Promise((resolve) => {
    logo.onload = resolve;
    logo.onerror = resolve;
    logo.src = YLA_LOGO_SRC;
  });
  if (current() && logo.complete && logo.naturalWidth) {
    const ctx = canvas.getContext('2d');
    const size = 72;
    const logoSize = 52;
    const x = (canvas.width - size) / 2;
    const y = (canvas.height - size) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.drawImage(
      logo,
      (canvas.width - logoSize) / 2,
      (canvas.height - logoSize) / 2,
      logoSize,
      logoSize,
    );
  }

  document.querySelector('#copy').onclick = (e) =>
    busy(e.target, async () => {
      await navigator.clipboard.writeText(scanLink(s));
      if (current()) notice('Student link copied.', false);
    });
  document.querySelector('#download').onclick = () => {
    const a = document.createElement('a');
    a.download = `young-leadership-academy-${s.session_id}.png`;
    a.href = canvas.toDataURL();
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
  document.querySelector('#delete-session')?.addEventListener('click', (e) => {
    if (!confirm('Delete this closed session? Sessions with attendance history cannot be deleted.')) return;
    busy(e.target, async () => {
      await api('deleteSession', { session_id: s.session_id }, token);
      data.sessions = data.sessions.filter((session) => session.session_id !== s.session_id);
      dashboard();
    });
  });
}
function students() {
  const students = Array.isArray(data?.students) ? [...data.students] : [];
  let filtered = students;
  frame(
    `<div class="page-title"><div><p class="eyebrow">ACADEMY ROSTER</p><h1>Students</h1><p>Manage the active Academy roster used for attendance validation.</p></div><div class="actions"><button class="secondary" id="import">Import CSV</button><button class="primary" id="add">＋ Add student</button></div></div><section class="card"><div class="section-title"><div><h2>Student roster</h2><p>Active students can Scan In and Scan Out. Deactivated students remain in attendance history.</p></div><label class="search-field">Search<input id="student-search" type="search" placeholder="ID or name"></label></div><div id="student-editor"></div><div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody id="student-rows"></tbody></table></div><input id="csv-input" type="file" accept=".csv,text/csv" hidden></section>`,
  );
  const rows = document.querySelector('#student-rows');
  const editor = document.querySelector('#student-editor');
  const search = document.querySelector('#student-search');
  const renderRows = () => {
    const q = search.value.trim().toLowerCase();
    filtered = students.filter((s) => !q || s.student_id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    rows.innerHTML = filtered.length
      ? filtered.map((s) => `<tr><td><b>${esc(s.student_id)}</b></td><td>${esc(s.name)}</td><td><span class="badge ${s.active ? 'present' : 'absent'}">${s.active ? 'Active' : 'Inactive'}</span></td><td><button class="text" data-edit="${esc(s.student_id)}">Edit</button> <button class="text" data-toggle="${esc(s.student_id)}">${s.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No students match this search.</td></tr>';
    rows.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEditor(students.find((s) => s.student_id === b.dataset.edit)));
    rows.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => toggleStudent(students.find((s) => s.student_id === b.dataset.toggle)));
  };
  const openEditor = (student = null) => {
    editor.innerHTML = `<div class="card inline-editor"><h3>${student ? 'Edit student' : 'Add student'}</h3><form id="student-form"><div class="form-grid"><label>Student ID<input name="student_id" maxlength="40" pattern="[A-Za-z0-9_-]+" required ${student ? 'readonly' : ''} value="${student ? esc(student.student_id) : ''}" placeholder="e.g. YLA001"></label><label>Student name<input name="name" maxlength="100" required value="${student ? esc(student.name) : ''}" placeholder="Full name"></label></div><div class="actions"><button type="button" class="secondary" id="cancel-student">Cancel</button><button class="primary">${student ? 'Save changes' : 'Add student'}</button></div></form></div>`;
    document.querySelector('#cancel-student').onclick = () => editor.innerHTML = '';
    document.querySelector('#student-form').onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        const v = Object.fromEntries(new FormData(e.target));
        const result = student ? await api('updateStudent', v, token) : await api('createStudent', v, token);
        const saved = result?.data ?? result;
        if (!saved?.student_id) throw new Error('The student record could not be confirmed.');
        const i = students.findIndex((s) => s.student_id === saved.student_id);
        if (i < 0) students.push(saved); else students[i] = saved;
        editor.innerHTML = '';
        renderRows();
        notice(student ? 'Student updated.' : 'Student added.', false);
      });
    };
    document.querySelector('#student-form input[name="name"]').focus();
  };
  const toggleStudent = (student) => {
    if (!student) return;
    const button = document.querySelector(`[data-toggle="${CSS.escape(student.student_id)}"]`);
    busy(button, async () => {
      const result = await api('setStudentActive', { student_id: student.student_id, active: !student.active }, token);
      const saved = result?.data ?? result;
      student.active = saved.active;
      student.name = saved.name;
      renderRows();
      notice(student.active ? 'Student activated.' : 'Student deactivated.', false);
    });
  };
  document.querySelector('#add').onclick = () => openEditor();
  search.oninput = renderRows;
  document.querySelector('#import').onclick = () => document.querySelector('#csv-input').click();
  document.querySelector('#csv-input').onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    busy(document.querySelector('#import'), async () => {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) throw new Error('The CSV file is empty.');
      const parse = (line) => {
        const out = []; let cur = ''; let quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
          else if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        out.push(cur.trim()); return out;
      };
      const first = parse(lines[0]).map((v) => v.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '_'));
      const hasHeader = first.includes('student_id') || first.includes('studentid');
      const start = hasHeader ? 1 : 0;
      let added = 0, skipped = 0;
      const failures = [];
      const seen = new Set(students.map((s) => s.student_id.trim().toLowerCase()));
      for (let rowIndex = start; rowIndex < lines.length; rowIndex++) {
        const line = lines[rowIndex];
        const [rawStudentId, rawName] = parse(line);
        const student_id = rawStudentId?.replace(/^\uFEFF/, '').trim();
        const name = rawName?.trim();
        if (!student_id || !name) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: Student ID and name are required`);
          continue;
        }
        const key = student_id.toLowerCase();
        if (seen.has(key)) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: ${student_id} already exists or is duplicated in this import`);
          continue;
        }
        try {
          const result = await api('createStudent', { student_id, name }, token);
          const saved = result?.data ?? result;
          if (!saved?.student_id) {
            skipped++;
            failures.push(`row ${rowIndex + 1}: server did not confirm the student record`);
            continue;
          }
          students.push(saved);
          seen.add(key);
          added++;
        } catch (error) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: ${error?.message || 'server rejected the student'}`);
        }
      }
      renderRows();
      const summary = `CSV import complete: ${added} added, ${skipped} skipped.`;
      notice(
        failures.length
          ? `${summary} ${failures.slice(0, 3).join(' • ')}${failures.length > 3 ? ` • +${failures.length - 3} more` : ''}`
          : summary,
        !!failures.length,
      );
      e.target.value = '';
    });
  };
  renderRows();
}
function accounts() {
  if (role !== 'admin') { view = 'dashboard'; return dashboard(); }
  let rows = [];
  frame('<div class="page-title"><div><p class="eyebrow">ACADEMY ACCESS CONTROL</p><h1>Accounts</h1><p>Admin accounts can manage Academy access. Operators can create sessions but cannot manage students, attendance, or accounts.</p></div><button class="primary" id="add-account">＋ Add account</button></div><section class="card"><div id="account-editor"></div><div class="table-wrap"><table><thead><tr><th>Email</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody id="account-rows"><tr><td colspan="5" class="empty">Loading accounts…</td></tr></tbody></table></div></section>');
  const editor = document.querySelector('#account-editor');
  const table = document.querySelector('#account-rows');
  const load = async () => { const result = await api('adminAccounts', {}, token); rows = Array.isArray(result) ? result : []; renderRows(); };
  const renderRows = () => {
    table.innerHTML = rows.length ? rows.map((a) => `<tr><td><b>${esc(a.email)}</b></td><td>${esc(a.username || '—')}</td><td><span class="badge">${esc(a.role)}</span></td><td><span class="badge ${a.active ? 'present' : 'absent'}">${a.active ? 'Active' : 'Inactive'}</span></td><td><button class="text" data-edit="${esc(a.admin_id)}">Edit</button> <button class="text" data-toggle="${esc(a.admin_id)}">${a.active ? 'Deactivate' : 'Activate'}</button> <button class="text" data-remove="${esc(a.admin_id)}">Remove</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No accounts found.</td></tr>';
    table.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEditor(rows.find((a) => a.admin_id === b.dataset.edit)));
    table.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => toggleAccount(rows.find((a) => a.admin_id === b.dataset.toggle)));
    table.querySelectorAll('[data-remove]').forEach((b) => b.onclick = () => removeAccount(rows.find((a) => a.admin_id === b.dataset.remove)));
  };
  const openEditor = (account = null) => {
    editor.innerHTML = `<div class="card inline-editor"><h3>${account ? 'Edit account' : 'Add account'}</h3><form id="account-form"><div class="form-grid">${account ? `<label>Email<input value="${esc(account.email)}" disabled></label>` : `<label>Email<input name="email" type="email" autocomplete="email" required placeholder="operator@example.com"></label>`}<label>Username<input name="username" maxlength="40" pattern="[A-Za-z0-9._\-]{3,40}" value="${esc(account?.username || '')}" required placeholder="academy.operator"></label></div><div class="form-grid"><label>Role<select name="role"><option value="operator" ${account?.role === 'operator' ? 'selected' : ''}>Operator</option><option value="admin" ${account?.role === 'admin' ? 'selected' : ''}>Admin</option></select></label><label>${account ? 'New password (optional)' : 'Password'}<input name="password" type="password" autocomplete="new-password" minlength="16" ${account ? '' : 'required'} placeholder="Minimum 16 characters"></label></div><div class="actions"><button type="button" class="secondary" id="cancel-account">Cancel</button><button class="primary">${account ? 'Save account' : 'Create account'}</button></div></form></div>`;
    document.querySelector('#cancel-account').onclick = () => editor.innerHTML = '';
    document.querySelector('#account-form').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { const v = Object.fromEntries(new FormData(e.target)); if (account) { const payload = { admin_id: account.admin_id, username: v.username, role: v.role, active: account.active }; if (v.password) payload.password = v.password; await api('updateAdminAccount', payload, token); notice('Account updated.', false); } else { await api('createAdminAccount', { email: v.email, password: v.password, username: v.username, role: v.role }, token); notice('Account created.', false); } editor.innerHTML = ''; await load(); }); };
  };
  const toggleAccount = (account) => { if (!account) return; const button = document.querySelector(`[data-toggle="${CSS.escape(account.admin_id)}"]`); busy(button, async () => { await api('updateAdminAccount', { admin_id: account.admin_id, username: account.username, role: account.role, active: !account.active }, token); await load(); notice(account.active ? 'Account deactivated.' : 'Account activated.', false); }); };
  const removeAccount = (account) => { if (!account) return; if (!confirm(`Remove ${account.email}? This permanently removes the authentication account.`)) return; const button = document.querySelector(`[data-remove="${CSS.escape(account.admin_id)}"]`); busy(button, async () => { await api('removeAdminAccount', { admin_id: account.admin_id }, token); await load(); notice('Account removed.', false); }); };
  document.querySelector('#add-account').onclick = () => openEditor();
  load().catch((e) => notice(e.message));
}
function reports() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">ACADEMY ATTENDANCE RECORDS</p><h1>Attendance report</h1><p>Review student attendance by session, course, date, or student.</p></div><button class="primary" id="export">↓ Export CSV</button></div><section class="card"><form id="filters" class="filters"><label>Session<select name="session"><option value="">All sessions</option>${data.sessions.map((s) => `<option value="${esc(s.session_id)}">${esc(s.course)} · ${esc(sessionTimes(s, data.settings.offset).date)}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${[...new Set(data.sessions.map((s) => s.course))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><label>Date<input name="date" type="date"></label><label>Student<input name="student" placeholder="Name or ID" type="search"></label></form><div id="report-summary" class="section-title"></div><div class="table-wrap"><table><thead><tr>${['Student', 'Course / date', 'Scan In', 'Scan Out', 'Minutes', 'Status'].map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div><p class="helper">Timestamps shown in ${REPORT_TIME_ZONE_LABEL}. Dates beside course names are the scheduled session dates. Absent is calculated after class ends; upcoming students are Pending. Percentage counts students with Scan In, including late and early departures. ${data.settings.enrolled ? 'The current active roster is used for all courses.' : 'Enrollment validation is disabled: percentage covers recorded attendees only.'}</p></section>`,
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
    a.download = 'young-leadership-academy-attendance.csv';
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
      `<section class="card student-card"><p class="eyebrow">ACADEMY CLASS ATTENDANCE</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, s.offset))}</p><hr><form id="scan-form">${field('Student ID', 'student_id', 'text', 'autocomplete="username" pattern="[a-zA-Z0-9_-]+" maxlength="40" placeholder="Your student ID"')}${field('Student name', 'student_name', 'text', 'autocomplete="name" maxlength="100" placeholder="Your full name"')}<div class="scan-actions"><button name="direction" value="in" class="primary">↳ Scan In</button><button name="direction" value="out" class="secondary">↗ Scan Out</button></div></form><p class="helper">Choose Scan In when you arrive and Scan Out when you leave. Use the same student ID both times. Enrolled students use the name on the Academy roster.</p></section>`,
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
            'Scan submissions need a backend update for safe retries. Contact your Academy administrator.',
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
          `<section class="card student-card result"><div class="check">✓</div><p class="eyebrow">ATTENDANCE SAVED</p><h1>${payload.direction === 'in' ? 'You’re checked in.' : 'You’re checked out.'}</h1><p>${esc(r.student_name)} · ${esc(r.student_id)}</p><div class="receipt"><b>${esc(s.course)}</b><p>${esc(r.status)} · ${thailandTimestamp(r.updated_at)} · ${REPORT_TIME_ZONE_LABEL}</p>${r.duration_minutes !== '' ? `<p>${esc(r.duration_minutes)} minutes attended</p>` : ''}</div><p>Your attendance is saved. You can close this page.</p><button class="secondary full" id="return">Return to session</button></section>`,
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
      '<section class="card student-card"><h1>Unable to open class</h1><p>Try loading the class again. If it still does not open, ask your Academy teacher for help.</p><button class="secondary" id="retry">Try again</button></section>',
      true,
    );
    notice(e.message);
    document.querySelector('#retry').onclick = student;
  }
}
async function scannerPage() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">ACADEMY STUDENT ATTENDANCE</p><h1>Scan your class QR</h1><p>Allow camera access, then point your camera at the QR shared by your teacher.</p></div></div><section class="card student-card"><div id="reader"></div><button id="start-camera" class="primary full">Open camera</button><p class="helper">If the camera does not open, check your browser’s camera permission or use your phone’s camera app. You can also paste the class link below.</p><form id="paste"><label>Or paste a class link<input name="url" type="url" required placeholder="https://…"></label><button class="secondary full">Open class link</button></form></section>`,
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
  if (view === 'students') {
    if (role !== 'admin') { view = 'dashboard'; return dashboard(); }
    return students();
  }
  if (view === 'accounts') return accounts();
  dashboard();
}
window.addEventListener('hashchange', render);
window.addEventListener('pagehide', stopCamera);
async function bootstrap() {
  const recovery = await initializeRecovery();
  if (recovery.active) resetPassword();
  else if (recovery.error) resetPassword(recovery.error);
  else render();
}
bootstrap();
