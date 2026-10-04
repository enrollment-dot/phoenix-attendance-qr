import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frontend = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const backend = readFileSync(
  new URL('../supabase/functions/ylp-api/index.ts', import.meta.url),
  'utf8',
);

test('frontend allows super_admin to access the students view', () => {
  assert.match(
    frontend,
    /if \(view === 'students'\) \{\n    if \(!\['admin', 'super_admin'\]\.includes\(role\)\)/,
  );
});

test('frontend preserves super_admin role after login', () => {
  assert.match(
    frontend,
    /role = \['super_admin', 'admin', 'operator'\]\.includes\(result\.role\) \? result\.role : '';/,
  );
});

test('frontend exposes destructive student/session/account UI only to super_admin', () => {
  assert.match(frontend, /role === 'super_admin' \? .*data-delete/s);
  assert.match(frontend, /role === 'super_admin' \? '<button id="delete-session"/);
  assert.match(frontend, /role === 'super_admin' \? `<button data-nav="accounts"/);
});

test('backend requires super_admin for destructive student and session deletion', () => {
  const studentDelete = backend.slice(
    backend.indexOf("case 'deleteStudent'"),
    backend.indexOf("case 'adminAccounts'"),
  );
  const sessionDelete = backend.slice(
    backend.indexOf("case 'deleteSession'"),
    backend.indexOf("case 'migrateSession'"),
  );

  assert.match(studentDelete, /requireAdminRole\(token, config, backend, \['super_admin'\]\)/);
  assert.match(studentDelete, /requireAdminRole\(reauthToken, config, backend, \['super_admin'\]\)/);
  assert.match(studentDelete, /reauthClaims\.sub !== currentClaims\.sub/);

  assert.match(sessionDelete, /requireAdminRole\(token, config, backend, \['super_admin'\]\)/);
  assert.match(sessionDelete, /requireAdminRole\(reauthToken, config, backend, \['super_admin'\]\)/);
  assert.match(sessionDelete, /reauthClaims\.sub !== currentClaims\.sub/);
});

test('backend restricts account management to super_admin', () => {
  for (const action of [
    'adminAccounts',
    'createAdminAccount',
    'updateAdminAccount',
    'removeAdminAccount',
  ]) {
    const start = backend.indexOf(`case '${action}'`);
    assert.notEqual(start, -1, `missing action: ${action}`);
    const end = backend.indexOf('\n      case ', start + 1);
    const block = backend.slice(start, end === -1 ? backend.length : end);
    assert.match(
      block,
      /requireAdminRole\(token, config, backend, \['super_admin'\]\)/,
      `missing super_admin authorization for ${action}`,
    );
  }
});


test('backend accepts super_admin even when legacy role allowlist omits it', () => {
  assert.match(
    backend,
    /admin\.role !== 'super_admin' && !config\.adminAllowedRoles\.includes\(admin\.role\)/,
  );
});

test('backend account updates allow the super_admin role', () => {
  const start = backend.indexOf("case 'updateAdminAccount'");
  const end = backend.indexOf('\\n      case ', start + 1);
  const block = backend.slice(start, end === -1 ? backend.length : end);
  assert.match(block, /\['super_admin', 'admin', 'operator'\]\.includes\(payload\.role\)/);
});


test('student email is optional and supported through the roster flow', () => {
  assert.match(frontend, /name="email" type="email"/);
  assert.match(frontend, /rawEmail/);
  assert.match(frontend, /createStudent', \{ student_id, name, enrolled_from, email \}/);
  assert.match(backend, /const EMAIL =/);
  assert.match(backend, /const email = typeof payload\.email === 'string' \? payload\.email\.trim\(\) : ''/);
  assert.match(backend, /email: student\.email \?\? null/);
});


test('attendance records explicitly show whether a student scanned out', () => {
  assert.match(frontend, /scan_out \? '<small class="scan-state">Scanned Out<\/small>'/);
  assert.match(frontend, /scan_in \? '<small class="scan-state">Not Scanned Out<\/small>'/);
  assert.match(frontend, /r\.scan_out \? 'Scanned Out' : 'Not Scanned Out'/);
});


test('attendance scan window uses 30 minutes before start and 15 minutes after end', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260928165142_set_attendance_scan_close_grace_15_minutes.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /set value = '15'/);
});

test('super_admin account editor allows changing email and sends it to the backend', () => {
  assert.match(frontend, /name="email" type="email" autocomplete="email"/);
  assert.doesNotMatch(frontend, /<label>Email<input value="\$\{esc\(account\.email\)\}" disabled>/);
  assert.match(frontend, /updateAdminAccount', payload, token/);
  assert.match(frontend, /const payload = \{ admin_id: account\.admin_id, email: v\.email,/);
});

test('backend account email updates stay server-side and preserve email confirmation', () => {
  const start = backend.indexOf("async updateAdminAccount(");
  const end = backend.indexOf("\n  async removeAdminAccount", start);
  const method = backend.slice(start, end);
  assert.match(method, /auth\/v1\/admin\/users/);
  assert.match(method, /body: JSON\.stringify\(authUpdates\)/);
  assert.match(method, /email_confirm: true/);
  assert.match(method, /this\.config\.supabaseServiceRoleKey/);

  const actionStart = backend.indexOf("case 'updateAdminAccount'");
  const actionEnd = backend.indexOf("\n      case ", actionStart + 1);
  const action = backend.slice(actionStart, actionEnd === -1 ? backend.length : actionEnd);
  assert.match(action, /requireAdminRole\(token, config, backend, \['super_admin'\]\)/);
  assert.match(action, /payload\.email/);
  assert.match(action, /Invalid account email/);
});

test('admin removal keeps the safety guard but allows a remaining super_admin', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260929210000_allow_admin_removal_with_super_admin.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /role = 'admin'/);
  assert.match(migration, /role = 'super_admin'/);
  assert.match(migration, /active_admin_count = 0 and active_super_admin_count = 0/);
  assert.match(migration, /Cannot remove the last active admin/);
});


test('appearance branding includes configurable login welcome content', () => {
  assert.match(frontend, /name="login_welcome_title"/);
  assert.match(frontend, /name="login_welcome_description"/);
  assert.match(frontend, /name="login_welcome_button_text"/);
  assert.match(frontend, /branding\.login_welcome_title/);
  assert.match(frontend, /branding\.login_welcome_description/);
  assert.match(frontend, /branding\.login_welcome_button_text/);
  assert.match(backend, /p_login_welcome_title/);
  assert.match(backend, /p_login_welcome_description/);
  assert.match(backend, /p_login_welcome_button_text/);
});

test('branding migration keeps the privileged RPC service_role-only', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261005010000_add_login_welcome_branding.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /login_welcome_title/);
  assert.match(migration, /login_welcome_description/);
  assert.match(migration, /login_welcome_button_text/);
  assert.match(migration, /revoke execute on function public\.ylp_branding_update_v1/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
});
