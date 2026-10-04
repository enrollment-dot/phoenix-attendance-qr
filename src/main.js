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
  sessionAttendanceSummary,
  studentAttendanceSummary,
  overallAttendanceSummary,
  scanLink,
  parseScan,
} from './reports.js';
// RBAC staging frontend deployment marker: 2026-09-24
const YLA_LOGO_SRC = '/ylp-logo-exact.svg';
const root = document.querySelector('#app');
const DEFAULT_BRANDING = {
  organization_name: 'Young Leadership Program', tagline: 'Learn. Lead. Build. Inspire', logo_url: '/ylp-logo-exact.svg', favicon_url: null,
  primary_color: '#183E32', accent_color: '#72A93E', sidebar_color: '#152C2A', page_background: '#F5F7F6', card_background: '#FFFFFF', text_color: '#203833', muted_text_color: '#75827C', footer_text: 'Young Leadership Program · For facilitators and cohort members', login_welcome_title: 'Joining a Young Leadership Program cohort?', login_welcome_description: 'Open the QR shared by your facilitator. Choose Scan In when you arrive and Scan Out when you leave.', login_welcome_button_text: 'Scan a cohort QR',
};
let branding = { ...DEFAULT_BRANDING };
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
function applyBranding() {
  const style = document.documentElement.style;
  style.setProperty('--brand-primary', branding.primary_color);
  style.setProperty('--brand-accent', branding.accent_color);
  style.setProperty('--brand-sidebar', branding.sidebar_color);
  style.setProperty('--brand-page', branding.page_background);
  style.setProperty('--brand-card', branding.card_background);
  style.setProperty('--brand-text', branding.text_color);
  style.setProperty('--brand-muted', branding.muted_text_color);
  document.title = branding.organization_name;
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = branding.favicon_url || branding.logo_url;
}

async function loadBranding(publicOnly = false) {
  if (!publicOnly && !token) return;
  try {
    const response = await api(publicOnly ? 'publicBranding' : 'branding', {}, publicOnly ? '' : token);
    if (response && typeof response === 'object') branding = { ...DEFAULT_BRANDING, ...response };
  } catch {
    // Keep the built-in branding if the optional customization read fails.
  }
  applyBranding();
}

function frame(content, attendee = false) {
  pageVersion++;
  applyBranding();
  const dashboardBranding = token && !attendee;
  const displayOrganizationName = dashboardBranding
    ? branding.organization_name.replaceAll('Young Leadership Program', 'YLP')
    : branding.organization_name;
  const displayFooterText = dashboardBranding
    ? branding.footer_text.replaceAll('Young Leadership Program', 'YLP')
    : branding.footer_text;
  root.innerHTML = `<div class="shell"><aside><a class="brand" href="#" aria-label="${esc(displayOrganizationName)}"><img class="mark" src="${esc(branding.logo_url)}" alt="" /><span>${esc(displayOrganizationName)}<small>${esc(branding.tagline)}</small></span></a><div class="workspace">${attendee ? 'COHORT MEMBERS' : 'FACILITATORS'}</div><nav>${attendee ? '<a href="#">← Back to home</a>' : `<button data-nav="dashboard" class="${view === 'dashboard' ? 'selected' : ''}">▦ &nbsp; Overview</button><button data-nav="reports" class="${view === 'reports' ? 'selected' : ''}">≡ &nbsp; Attendance</button>${(role === 'admin' || role === 'super_admin') ? `<button data-nav="students" class="${view === 'students' ? 'selected' : ''}">♙ &nbsp; Cohort</button>` : ''}${role === 'super_admin' ? `<button data-nav="accounts" class="${view === 'accounts' ? 'selected' : ''}">♙ &nbsp; Accounts</button><button data-nav="appearance" class="${view === 'appearance' ? 'selected' : ''}">◐ &nbsp; Appearance</button>` : ''}<button data-nav="scanner">▣ &nbsp; Scan a QR</button>`}</nav><div class="aside-bottom">Your cohort.<br>Your attendance.<hr><span class="tiny">${esc(branding.tagline)}</span></div></aside><main><header><span>${attendee ? esc(displayOrganizationName) + ' / Cohort attendance' : esc(displayOrganizationName) + ' / ' + (view === 'reports' ? 'Attendance' : view === 'appearance' ? 'Appearance & Branding' : 'Overview')}</span>${token ? '<button class="text" id="logout">Sign out</button>' : `<span class="tiny">${esc(branding.tagline)}</span>`}</header><div id="notice" role="status" aria-live="polite"></div>${content}<footer>${esc(displayFooterText)}</footer></main></div>`;
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

async function appearance() {
  if (role !== 'super_admin') {
    view = 'dashboard';
    return dashboard();
  }
  frame('<div class="page-title"><div><p class="eyebrow">SUPER ADMIN</p><h1>Appearance & Branding</h1><p>Customize the application identity, colors, and safe interface text.</p></div><button class="secondary" id="reset-branding">Reset defaults</button></div><section class="card"><form id="branding-form" class="branding-grid"><div><label>Organization name<input name="organization_name" maxlength="120" required></label><label>Tagline<input name="tagline" maxlength="160" required></label><label>Logo URL<input name="logo_url" maxlength="500" required></label><label>Favicon URL<input name="favicon_url" maxlength="500"></label></div><div class="branding-colors"><label>Primary color<input name="primary_color" type="color" required></label><label>Accent color<input name="accent_color" type="color" required></label><label>Sidebar color<input name="sidebar_color" type="color" required></label><label>Page background<input name="page_background" type="color" required></label><label>Card background<input name="card_background" type="color" required></label><label>Text color<input name="text_color" type="color" required></label><label>Muted text color<input name="muted_text_color" type="color" required></label></div><label class="branding-wide">Footer text<textarea name="footer_text" maxlength="240" rows="3" required></textarea></label><div class="actions branding-wide"><button class="primary" type="submit">Save changes</button></div></form></section>');
  const form = document.querySelector('#branding-form');
  for (const [name, value] of Object.entries(branding)) {
    const input = form.elements.namedItem(name);
    if (input && value != null) input.value = value;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await busy(event.submitter, async () => {
      const payload = Object.fromEntries(new FormData(form).entries());
      const response = await api('updateBranding', payload, token);
      branding = { ...DEFAULT_BRANDING, ...response };
      applyBranding();
      render();
    });
  });
  document.querySelector('#reset-branding').addEventListener('click', () => {
    branding = { ...DEFAULT_BRANDING };
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
    `<div class="page-title"><div><p class="eyebrow">YOUNG LEADERSHIP PROGRAM</p><h1>Attendance for every Young Leadership Program cohort.</h1><p>Create cohort sessions, share attendance QR codes, and review cohort member records.</p></div></div><section class="login-grid"><div class="card"><span class="step">FACILITATOR &amp; ADMIN ACCESS</span><h2>Sign in to Young Leadership Program</h2><p>Use your Young Leadership Program username and password.</p>${!configured ? '<div class="notice">Young Leadership Program is not configured yet. Ask your administrator to complete setup.</div>' : ''}<form id="login">${field('Username', 'username', 'text', 'autocomplete="username"')}${field('Password', 'password', 'password', 'autocomplete="current-password" minlength="16"')}<button class="primary full">Sign in →</button></form></div><div class="welcome-panel"><span class="large-qr">▦</span><h2>${esc(branding.login_welcome_title)}</h2><p>${esc(branding.login_welcome_description)}</p><button id="student-scanner" class="light">${esc(branding.login_welcome_button_text)}</button></div></section>`,
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
      role = ['super_admin', 'admin', 'operator'].includes(result.role) ? result.role : '';
      await loadBranding();
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
    `<div class="page-title"><div><p class="eyebrow">YOUNG LEADERSHIP PROGRAM</p><h1>Reset your password.</h1><p>Choose a new password for your Young Leadership Program administrator account.</p></div></div><section class="login-grid"><div class="card"><span class="step">ADMIN PASSWORD RECOVERY</span><h2>Set a new password</h2><p>Use at least 16 characters. Your password is sent directly to Supabase Auth and is never displayed or logged.</p>${kind ? `<div class="notice error">${esc(recoveryMessage(kind))}</div><button class="secondary full" id="return-login">Return to sign in</button>` : `<form id="reset-password"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="16" required></label><label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="16" required></label><button class="primary full">Save new password →</button></form>`}</div><div class="welcome-panel"><span class="large-qr">✓</span><h2>Secure account access</h2><p>After the password changes, this recovery session will be signed out and you will return to the normal admin sign-in screen.</p></div></section>`,
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
  const attendanceSummary = overallAttendanceSummary(data),
    pct = attendanceSummary.percentage,
    active = data.sessions.filter((s) => s.status === 'active');
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP COHORT SESSIONS</p><h1>Cohort overview</h1><p>Manage your YLP sessions and review attendance.</p></div><button class="primary" id="create">＋ Create session</button></div><div class="stats"><div class="card"><span>Cohort sessions</span><strong>${data.sessions.length}</strong><small>${active.length} enabled for scanning</small></div><div class="card"><span>Cohort</span><strong>${data.students.length}</strong><small>Active YLP members on the YLP roster</small></div><div class="card"><span>Attendance rate</span><strong>${pct === null ? '—' : pct + '<em>%</em>'}</strong><small>${attendanceSummary.sessions_held ? 'Completed sessions only' : 'No completed sessions yet'}</small></div></div><section class="card sessions"><div class="section-title"><div><h2>Cohort sessions</h2><p>Share a session QR with your cohort for Scan In and Scan Out.</p></div><button class="text" id="refresh">↻ Refresh</button></div>${
      data.sessions.length
        ? `<div class="session-list">${[...data.sessions]
            .reverse()
            .map(
              (s) =>
                `<article class="session-row"><div class="date-tile"><b>${esc(sessionTimes(s, data.settings.offset).date.slice(8))}</b><span>${esc(sessionTimes(s, data.settings.offset).date.slice(0, 7))}</span></div><div class="session-info"><h3>${esc(s.course)}</h3><p>${esc(sessionLabel(s, data.settings.offset))}</p></div><span class="badge ${s.status === 'active' ? 'present' : ''}">${esc(s.status)}</span><button class="secondary" data-qr="${esc(s.session_id)}">Display QR ↗</button></article>`,
            )
            .join('')}</div>`
        : '<div class="empty"><span>▦</span><h3>No sessions yet</h3><p>Create a session to generate its attendance QR code.</p></div>'
    }</section><div class="tip"><b>Use the same QR for Scan In and Scan Out.</b><span>Keep the same session QR on screen for both Scan In and Scan Out.</span></div>`,
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
    `<div class="page-title"><div><p class="eyebrow">NEW YLP SESSION</p><h1>Create a session</h1><p>Times use ${REPORT_TIME_ZONE_LABEL}. Sessions start and end on the same day.</p></div></div><section class="card form-card"><form id="create-form">${field('Course name', 'course', 'text', 'maxlength="120" placeholder="e.g. English · Intermediate"') }<div class="form-grid">${field('Session date', 'date', 'date')}${field('Late threshold (minutes)', 'late_threshold', 'number', 'min="0" max="240" value="10"')}${field('Start time', 'start_time', 'time')}${field('End time', 'end_time', 'time')}</div><p class="helper">Scanning opens ${data.settings.openMinutes} minutes before class and closes ${data.settings.closeMinutes} minutes after class. Close a session manually to stop scans sooner.</p><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">Create & display QR →</button></div></form></section>`,
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
    `<div class="page-title"><div><p class="eyebrow">SESSION QR</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, data.settings.offset))}</p></div><button id="back" class="secondary">← Back to overview</button></div><section class="card qr-card"><div class="qr-status"><span class="badge present">${esc(s.status)}</span></div><div class="qr-visual"><div class="qr-brand"><img class="qr-brand-mark" src="${YLA_LOGO_SRC}" alt="" /><strong>YLP</strong><span>Learn. Lead. Build. Inspire</span></div><div class="qr-code-wrap"><div class="qr-scan-frame"><span class="qr-corner top-left" aria-hidden="true"></span><span class="qr-corner top-right" aria-hidden="true"></span><span class="qr-corner bottom-left" aria-hidden="true"></span><span class="qr-corner bottom-right" aria-hidden="true"></span><canvas id="qr" aria-label="Cohort attendance QR code"></canvas></div></div></div><div class="qr-session-panel"><h2 class="qr-session-name">${esc(s.course)}</h2><h3 class="qr-attendance-title">Record your attendance</h3></div><div class="qr-instructions"><span class="qr-instructions-icon" aria-hidden="true">▯</span><p>Open your phone camera and point it at this QR.<br>Enter your cohort member name and cohort ID, then choose Scan In or Scan Out.</p></div><div class="actions"><button id="copy" class="primary">↗ &nbsp; Copy cohort link</button><button id="download" class="secondary">↓ &nbsp; Download QR</button>${s.status === 'active' ? '<button id="close" class="danger">Close session</button>' : role === 'super_admin' ? '<button id="delete-session" class="danger">Delete session</button>' : ''}</div><p class="helper">Share this QR only with YLP members in this YLP cohort. It gives access to this session.</p></section>`,
  );  const current = pageGuard();
  document.querySelector('#back').onclick = dashboard;
  const canvas = document.querySelector('#qr');
  await QRCode.toCanvas(canvas, scanLink(s), {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: { dark: '#152c2a', light: '#ffffff' },
  });
  if (!current()) return;

  document.querySelector('#copy').onclick = (e) =>
    busy(e.target, async () => {
      await navigator.clipboard.writeText(scanLink(s));
      if (current()) notice('Cohort link copied.', false);
    });
  document.querySelector('#download').onclick = () => {
    const a = document.createElement('a');
    a.download = `ylp-${s.session_id}.png`;
    a.href = canvas.toDataURL();
    a.click();
  };
  document.querySelector('#close')?.addEventListener('click', (e) => {
    if (
      confirm(
        'Close this session? Cohort members will no longer be able to scan in or out.',
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
  const deleteDialog = document.querySelector('#delete-dialog');
  document.querySelector('#delete-session')?.addEventListener('click', () => {
    deleteDialog?.showModal();
    deleteDialog?.querySelector('input[name="username"]')?.focus();
  });
  document.querySelector('#delete-cancel')?.addEventListener('click', () => {
    deleteDialog?.close();
  });
  document.querySelector('#delete-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const username = new FormData(form).get('username');
    const password = new FormData(form).get('password');
    busy(document.querySelector('#delete-confirm'), async () => {
      await api('deleteSession', { session_id: s.session_id, username, password }, token);
      deleteDialog?.close();
      data.sessions = data.sessions.filter((session) => session.session_id !== s.session_id);
      dashboard();
    });
  });
}
function students() {
  const students = Array.isArray(data?.students) ? [...data.students] : [];
  let filtered = students;
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP ROSTER</p><h1>YLP</h1><p>Manage the YLP roster used for attendance validation.</p></div><div class="actions"><button class="secondary" id="import">Import CSV</button><button class="primary" id="add">＋ Add YLP member</button></div></div><section class="card"><div class="section-title"><div><h2>YLP roster</h2><p>Active YLP members can Scan In and Scan Out. Deactivated YLP members remain in attendance history.</p></div><label class="search-field">Search<input id="student-search" type="search" placeholder="ID or name"></label></div><div id="student-editor"></div><div class="table-wrap"><table><thead><tr><th>Cohort ID</th><th>Name</th><th>Email</th><th>Enrolled from</th><th>Status</th><th>Action</th></tr></thead><tbody id="student-rows"></tbody></table></div><input id="csv-input" type="file" accept=".csv,text/csv" hidden></section>${role === 'super_admin' ? '<dialog id="delete-student-dialog" class="confirm-dialog"><form method="dialog" id="delete-student-form"><span class="step">DESTRUCTIVE ACTION</span><h2>Delete cohort member?</h2><p>This permanently deletes <strong data-delete-student-name></strong> and the cohort member attendance history. Enter the <strong>super admin username and password</strong> you used to sign in.</p><label>Username<input name="username" type="text" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="16"></label><div class="actions"><button type="button" class="secondary" id="delete-student-cancel">Cancel</button><button type="submit" class="danger" id="delete-student-confirm">Delete permanently</button></div></form></dialog>' : ''}`,
  );
  const rows = document.querySelector('#student-rows');
  const editor = document.querySelector('#student-editor');
  const search = document.querySelector('#student-search');
  const renderRows = () => {
    const q = search.value.trim().toLowerCase();
    filtered = students.filter((s) => !q || s.student_id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    rows.innerHTML = filtered.length
      ? filtered.map((s) => `<tr><td><b>${esc(s.student_id)}</b></td><td>${esc(s.name)}</td><td>${esc(s.email || '—')}</td><td>${esc(s.enrolled_from || '—')}</td><td><span class="badge ${s.active ? 'present' : 'absent'}">${s.active ? 'Active' : 'Inactive'}</span></td><td><button class="text" data-edit="${esc(s.student_id)}">Edit</button> <button class="text" data-toggle="${esc(s.student_id)}">${s.active ? 'Deactivate' : 'Activate'}</button>${role === 'super_admin' ? ` <button class="text" data-delete="${esc(s.student_id)}">Delete</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No cohort members match this search.</td></tr>';
    rows.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEditor(students.find((s) => s.student_id === b.dataset.edit)));
    rows.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => toggleStudent(students.find((s) => s.student_id === b.dataset.toggle)));
    rows.querySelectorAll('[data-delete]').forEach((b) => b.onclick = () => openDeleteStudent(students.find((s) => s.student_id === b.dataset.delete)));
  };
  const openDeleteStudent = (student) => {
    if (!student || role !== 'super_admin') return;
    const dialog = document.querySelector('#delete-student-dialog');
    if (!dialog) return;
    dialog.dataset.studentId = student.student_id;
    dialog.querySelector('[data-delete-student-name]').textContent = student.name;
    dialog.showModal();
    dialog.querySelector('input[name="username"]')?.focus();
  };
  const openEditor = (student = null) => {
    editor.innerHTML = `<div class="card inline-editor"><h3>${student ? 'Edit student' : 'Add cohort member'}</h3><form id="student-form"><div class="form-grid"><label>Cohort ID<input name="student_id" maxlength="40" pattern="[A-Za-z0-9_-]+" required ${student ? 'readonly' : ''} value="${student ? esc(student.student_id) : ''}" placeholder="e.g. YLP26101"></label><label>Cohort member name<input name="name" maxlength="100" required value="${student ? esc(student.name) : ''}" placeholder="Full name"></label><label>Cohort member email <span class="tiny">(optional)</span><input name="email" type="email" maxlength="254" value="${student ? esc(student.email || '') : ''}" placeholder="student@example.com"></label><label>Enrolled from<input name="enrolled_from" type="date" required value="${student && student.enrolled_from ? esc(student.enrolled_from) : new Date().toISOString().slice(0,10)}"></label></div><div class="actions"><button type="button" class="secondary" id="cancel-student">Cancel</button><button class="primary">${student ? 'Save changes' : 'Add cohort member'}</button></div></form></div>`;
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
        notice(student ? 'Cohort member updated.' : 'Cohort member added.', false);
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
      notice(student.active ? 'Cohort member activated.' : 'Cohort member deactivated.', false);
    });
  };
  document.querySelector('#add').onclick = () => openEditor();
  document.querySelector('#delete-student-cancel')?.addEventListener('click', () => document.querySelector('#delete-student-dialog')?.close());
  document.querySelector('#delete-student-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const dialog = document.querySelector('#delete-student-dialog');
    const username = new FormData(form).get('username');
    const password = new FormData(form).get('password');
    const studentId = dialog?.dataset.studentId;
    busy(document.querySelector('#delete-student-confirm'), async () => {
      await api('deleteStudent', { student_id: studentId, username, password }, token);
      dialog?.close();
      const index = students.findIndex((student) => student.student_id === studentId);
      if (index >= 0) students.splice(index, 1);
      renderRows();
      notice('Cohort member and attendance history deleted.', false);
    });
  });
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
        const [rawStudentId, rawName, rawEnrolledFrom, rawEmail] = parse(line);
        const student_id = rawStudentId?.replace(/^\uFEFF/, '').trim();
        const name = rawName?.trim();
        const enrolled_from = rawEnrolledFrom?.trim() || new Date().toISOString().slice(0, 10);
        const email = rawEmail?.trim() || '';
        if (!student_id || !name) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: Cohort ID and name are required`);
          continue;
        }
        const key = student_id.toLowerCase();
        if (seen.has(key)) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: ${student_id} already exists or is duplicated in this import`);
          continue;
        }
        try {
          const result = await api('createStudent', { student_id, name, enrolled_from, email }, token);
          const saved = result?.data ?? result;
          if (!saved?.student_id) {
            skipped++;
            failures.push(`row ${rowIndex + 1}: server did not confirm the cohort member record`);
            continue;
          }
          students.push(saved);
          seen.add(key);
          added++;
        } catch (error) {
          skipped++;
          failures.push(`row ${rowIndex + 1}: ${error?.message || 'server rejected the cohort member'}`);
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
  if (role !== 'super_admin') { view = 'dashboard'; return dashboard(); }
  let rows = [];
  frame('<div class="page-title"><div><p class="eyebrow">YLP ACCESS CONTROL</p><h1>Accounts</h1><p>Admin accounts can manage YLP access. Operators can create sessions but cannot manage YLP members, attendance, or accounts.</p></div><button class="primary" id="add-account">＋ Add account</button></div><section class="card"><div id="account-editor"></div><div class="table-wrap"><table><thead><tr><th>Email</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody id="account-rows"><tr><td colspan="5" class="empty">Loading accounts…</td></tr></tbody></table></div></section>');
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
    editor.innerHTML = `<div class="card inline-editor"><h3>${account ? 'Edit account' : 'Add account'}</h3><form id="account-form"><div class="form-grid">${account ? `<label>Email<input name="email" type="email" autocomplete="email" value="${esc(account?.email || '')}" required placeholder="operator@example.com"></label>` : `<label>Email<input name="email" type="email" autocomplete="email" required placeholder="operator@example.com"></label>`}<label>Username<input name="username" maxlength="40" pattern="[A-Za-z0-9._\-]{3,40}" value="${esc(account?.username || '')}" required placeholder="academy.operator"></label></div><div class="form-grid"><label>Role<select name="role"><option value="operator" ${account?.role === 'operator' ? 'selected' : ''}>Operator</option><option value="admin" ${account?.role === 'admin' ? 'selected' : ''}>Admin</option><option value="super_admin" ${account?.role === 'super_admin' ? 'selected' : ''}>Super Admin</option></select></label><label>${account ? 'New password (optional)' : 'Password'}<input name="password" type="password" autocomplete="new-password" minlength="16" ${account ? '' : 'required'} placeholder="Minimum 16 characters"></label></div><div class="actions"><button type="button" class="secondary" id="cancel-account">Cancel</button><button class="primary">${account ? 'Save account' : 'Create account'}</button></div></form></div>`;
    document.querySelector('#cancel-account').onclick = () => editor.innerHTML = '';
    document.querySelector('#account-form').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { const v = Object.fromEntries(new FormData(e.target)); if (account) { const payload = { admin_id: account.admin_id, email: v.email, username: v.username, role: v.role, active: account.active }; if (v.password) payload.password = v.password; await api('updateAdminAccount', payload, token); notice('Account updated.', false); } else { await api('createAdminAccount', { email: v.email, password: v.password, username: v.username, role: v.role }, token); notice('Account created.', false); } editor.innerHTML = ''; await load(); }); };
  };
  const toggleAccount = (account) => { if (!account) return; const button = document.querySelector(`[data-toggle="${CSS.escape(account.admin_id)}"]`); busy(button, async () => { await api('updateAdminAccount', { admin_id: account.admin_id, email: account.email, username: account.username, role: account.role, active: !account.active }, token); await load(); notice(account.active ? 'Account deactivated.' : 'Account activated.', false); }); };
  const removeAccount = (account) => { if (!account) return; if (!confirm(`Remove ${account.email}? This permanently removes the authentication account.`)) return; const button = document.querySelector(`[data-remove="${CSS.escape(account.admin_id)}"]`); busy(button, async () => { await api('removeAdminAccount', { admin_id: account.admin_id }, token); await load(); notice('Account removed.', false); }); };
  document.querySelector('#add-account').onclick = () => openEditor();
  load().catch((e) => notice(e.message));
}
function reports() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP ATTENDANCE RECORDS</p><h1>Attendance report</h1><p>Review attendance by session and track each cohort member's cumulative attendance.</p></div><button class="primary" id="export">↓ Export CSV</button></div><section class="card"><form id="filters" class="filters"><label>Session<select name="session"><option value="">All sessions</option>${data.sessions.map((s) => `<option value="${esc(s.session_id)}">${esc(s.course)} · ${esc(sessionTimes(s, data.settings.offset).date)}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${[...new Set(data.sessions.map((s) => s.course))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><label>From<input name="from" type="date"></label><label>To<input name="to" type="date"></label><label>Cohort member<input name="student" placeholder="Name or ID" type="search"></label></form><div id="report-summary"></div><div class="report-sections"><section class="report-block"><div class="section-title"><div><h2>Session attendance</h2><p>Each session is measured against the eligible cohort roster. Live sessions show current participation; completed sessions show final attendance.</p></div></div><div class="table-wrap"><table><thead><tr><th>Session</th><th>Date</th><th>Attended</th><th>Absent</th><th>Pending</th><th>Attendance</th></tr></thead><tbody id="session-summary-rows"></tbody></table></div></section><section class="report-block"><div class="section-title"><div><h2>Cohort attendance</h2><p>Cumulative attendance across completed sessions in the selected period.</p></div></div><div class="table-wrap"><table><thead><tr><th>Cohort Member</th><th>Sessions held</th><th>Attended</th><th>Absent</th><th>Attendance</th></tr></thead><tbody id="student-summary-rows"></tbody></table></div></section><section class="report-block"><div class="section-title"><div><h2>Attendance records</h2><p>Detailed scan history for the selected filters.</p></div></div><div class="table-wrap"><table><thead><tr>${['Cohort Member', 'Course / date', 'Scan In', 'Scan Out', 'Minutes', 'Status'].map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div></section></div><p class="helper">Attendance formula: attended sessions ÷ actual sessions held × 100. Planned, cancelled, or future sessions are not included in a cohort member's cumulative percentage. Pending cohort members are not counted as completed attendance. ${data.settings.enrolled ? 'The eligible cohort roster is used as the session denominator.' : 'Enrollment validation is disabled, so session percentages use recorded attendance data only.'}</p></section>`,
  );
  const allRows = report(data);
  const filtersEl = document.querySelector('#filters');
  let current = [];

  const update = () => {
    const filters = Object.fromEntries(new FormData(filtersEl));
    current = filterReport(allRows, filters);
    const overall = overallAttendanceSummary(data, filters);
    const sessions = sessionAttendanceSummary(data, filters);
    const students = studentAttendanceSummary(data, filters);

    document.querySelector('#report-summary').innerHTML =
      `<div class="stats report-stats"><div class="card"><span>Sessions held</span><strong>${overall.sessions_held}</strong><small>Completed sessions in selected period</small></div><div class="card"><span>Overall attendance</span><strong>${overall.percentage === null ? '—' : overall.percentage + '<em>%</em>'}</strong><small>${overall.attended} attended of ${overall.eligible} eligible session places</small></div><div class="card"><span>Cohort members tracked</span><strong>${students.length}</strong><small>Cohort members in the selected view</small></div></div>`;

    document.querySelector('#session-summary-rows').innerHTML = sessions.length
      ? sessions
          .map(
            (s) =>
              `<tr><td><b>${esc(s.course)}</b></td><td>${esc(s.date)}</td><td>${s.attended}</td><td>${s.absent}</td><td>${s.pending}</td><td><span class="badge ${s.completed ? (s.percentage >= 75 ? 'present' : '') : ''}">${s.percentage === null ? '—' : s.percentage + '%'}${s.completed ? '' : ' · Live'}</span></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="empty">No sessions match these filters.</td></tr>';

    document.querySelector('#student-summary-rows').innerHTML = students.length
      ? students
          .map(
            (s) =>
              `<tr><td><b>${esc(s.student_name)}</b><small>${esc(s.student_id)}</small></td><td>${s.sessions_held}</td><td>${s.attended}</td><td>${s.absent}</td><td><span class="badge ${s.percentage !== null && s.percentage >= 75 ? 'present' : ''}">${s.percentage === null ? '—' : s.percentage + '%'}</span></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="empty">No cohort members match these filters.</td></tr>';

    document.querySelector('#rows').innerHTML = current.length
      ? current
          .map(
            (r) =>
              `<tr><td><b>${esc(r.student_name)}</b><small>${esc(r.student_id)}</small></td><td>${esc(r.course)}<small>${esc(r.date)}</small></td><td>${thailandTimestamp(r.scan_in)}</td><td>${thailandTimestamp(r.scan_out)}${r.scan_out ? '<small class="scan-state">Scanned Out</small>' : r.scan_in ? '<small class="scan-state">Not Scanned Out</small>' : '<small class="scan-state">Not Scanned In</small>'}</td><td>${esc(r.duration_minutes ?? '—')}</td><td><span class="badge ${r.status === 'Present' ? 'present' : r.status === 'Absent' ? 'absent' : ''}">${esc(r.status)}</span>${r.scan_in ? `<small class="scan-state">${r.scan_out ? 'Scanned Out' : 'Not Scanned Out'}</small>` : ''}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6" class="empty">No records match these filters.</td></tr>';
  };

  filtersEl.oninput = update;
  filtersEl.onsubmit = (e) => e.preventDefault();
  document.querySelector('#export').onclick = () => {
    const u = URL.createObjectURL(
        new Blob([csv(current)], { type: 'text/csv;charset=utf-8;' }),
      ),
      a = document.createElement('a');
    a.href = u;
    a.download = 'sifer-lab-attendance.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  update();
}
async function student() {
  const params = new URLSearchParams(location.hash.slice(1));
  const shortMatch = /^\/s\/([A-Za-z0-9_-]{22})$/.exec(location.pathname.replace(/\/$/, ''));
  const accessCode = shortMatch?.[1] || params.get('access');
  const credentials = accessCode
    ? { access_code: accessCode }
    : { session_id: params.get('session'), qr_token: params.get('token') };
  frame(
    '<section class="card student-card"><h1>Loading your cohort…</h1></section>',
    true,
  );
  const loadingCurrent = pageGuard();
  try {
    const s = await api('session', credentials);
    if (!loadingCurrent()) return;
    frame(
      `<section class="card student-card"><p class="eyebrow">YLP COHORT ATTENDANCE</p><h1>${esc(s.course)}</h1><p>${esc(sessionLabel(s, s.offset))}</p><hr><form id="scan-form">${field('Cohort ID', 'student_id', 'text', 'autocomplete="username" pattern="[a-zA-Z0-9_-]+" maxlength="40" placeholder="Your cohort ID"')}${field('Cohort member name', 'student_name', 'text', 'autocomplete="name" maxlength="100" placeholder="Your full name"')}<div class="scan-actions"><button name="direction" value="in" class="primary">↳ Scan In</button><button name="direction" value="out" class="secondary">↗ Scan Out</button></div></form><p class="helper">Choose Scan In when you arrive and Scan Out when you leave. Use the same cohort ID both times. YLP members use the name on the YLP roster.</p></section>`,
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
        const payload = { ...attempt, ...(credentials.access_code ? { access_code: credentials.access_code } : { qr_token: credentials.qr_token }) };
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
      '<section class="card student-card"><h1>Unable to open cohort</h1><p>Try loading the cohort again. If it still does not open, ask your YLP facilitator for help.</p><button class="secondary" id="retry">Try again</button></section>',
      true,
    );
    notice(e.message);
    document.querySelector('#retry').onclick = student;
  }
}
async function scannerPage() {
  frame(
    `<div class="page-title"><div><p class="eyebrow">YLP ATTENDANCE</p><h1>Scan your cohort QR</h1><p>Allow camera access, then point your camera at the QR shared by your facilitator.</p></div></div><section class="card student-card"><div id="reader"></div><button id="start-camera" class="primary full">Open camera</button><p class="helper">If the camera does not open, check your browser’s camera permission or use your phone’s camera app. You can also paste the cohort link below.</p><form id="paste"><label>Or paste a cohort link<input name="url" type="url" required placeholder="https://…"></label><button class="secondary full">Open cohort link</button></form></section>`,
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
  if (location.hash.includes('session=') || location.hash.includes('access=') || /^\/s\/[A-Za-z0-9_-]{22}\/?$/.test(location.pathname)) return student();
  if (view === 'scanner') return scannerPage();
  if (!token || !data) return login();
  if (view === 'reports') return reports();
  if (view === 'students') {
    if (!['admin', 'super_admin'].includes(role)) { view = 'dashboard'; return dashboard(); }
    return students();
  }
  if (view === 'accounts') return accounts();
  if (view === 'appearance') return appearance();
  dashboard();
}
window.addEventListener('pagehide', stopCamera);
async function bootstrap() {
  const recovery = await initializeRecovery();
  if (recovery.active) resetPassword();
  else if (recovery.error) resetPassword(recovery.error);
  else {
    await loadBranding(true);
    render();
  }

  // Only start normal hash navigation after recovery initialization has
  // finished, so Supabase clearing the recovery hash cannot render login
  // over the password-reset screen.
  window.addEventListener('hashchange', render);
}
bootstrap();
