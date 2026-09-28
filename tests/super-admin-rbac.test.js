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
