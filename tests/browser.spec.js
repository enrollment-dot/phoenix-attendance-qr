import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
const session = {
  session_id: 'test-session',
  qr_token: 'test-token',
  course: 'English · Intermediate',
  date: '2026-09-15',
  start_time: '10:00',
  end_time: '11:00',
  late_threshold: 10,
  status: 'active',
  offset: '+07:00',
  scan_request_idempotency: true,
};
const row = {
  attendance_id: 'a',
  session_id: 'test-session',
  student_id: 'S001',
  student_name: 'Alex Morgan',
  scan_in: '2026-09-15T03:00:00Z',
  scan_out: '',
  duration_minutes: '',
  status: 'Present',
  updated_at: '2026-09-15T03:00:00Z',
};
async function mock(page, supportsRetries = true) {
  let record = null;
  await page.route('**/__test_api', async (route) => {
    const r = JSON.parse(route.request().postData() || '{}');
    let data = {},
      error = '';
    switch (r.action) {
      case 'login':
        data = { token: 'test-admin', role: 'admin' };
        break;
      case 'dashboard':
        data = {
          session_creation_idempotency: supportsRetries,
          sessions: [session],
          students: [
            { student_id: 'S001', name: 'Alex Morgan' },
            { student_id: 'S002', name: 'Jamie' },
          ],
          attendance: record ? [record] : [],
          settings: {
            enrolled: true,
            offset: '+07:00',
            openMinutes: 30,
            closeMinutes: 120,
          },
          now: '2026-09-16T00:00:00Z',
        };
        break;
      case 'createSession':
        data = { ...session, ...r.payload, session_id: r.payload.request_id };
        break;
      case 'session':
        data = session;
        break;
      case 'scan':
        if (r.payload.direction === 'in') {
          if (record) error = 'You have already scanned in.';
          else record = { ...row };
        } else if (!record) error = 'Scan In is required before Scan Out.';
        else if (record.scan_out) error = 'You have already scanned out.';
        else
          record = {
            ...record,
            scan_out: '2026-09-15T04:00:00Z',
            duration_minutes: 60,
          };
        data = record
          ? { ...record, request_id: r.payload.request_id }
          : record;
        break;
    }
    await route.fulfill({
      json: error
        ? { ok: false, error, code: 'scan_rejected' }
        : { ok: true, data },
    });
  });
}
test('login and dashboard replay the original POST once after redirected 404', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { api } = await import('/src/api.js');
    const original = window.fetch;
    const calls = [];
    try {
      window.fetch = async (_, options) => {
        calls.push(JSON.parse(options.body));
        if (calls.length === 1 || calls.length === 3)
          return {
            ok: false,
            status: 404,
            redirected: true,
            body: { cancel: async () => {} },
          };
        return {
          ok: true,
          status: 200,
          redirected: true,
          json: async () => ({
            ok: true,
            data:
              calls[calls.length - 1].action === 'login'
                ? { token: 'abc' }
                : { sessions: [] },
          }),
        };
      };
      const login = await api('login', { password: 'x' });
      const dashboard = await api('dashboard', {}, 'abc');
      return { login, dashboard, calls };
    } finally {
      window.fetch = original;
    }
  });
  expect(result.login).toEqual({ token: 'abc' });
  expect(result.dashboard).toEqual({ sessions: [] });
  expect(result.calls).toHaveLength(4);
  expect(result.calls[0]).toEqual(result.calls[1]);
  expect(result.calls[2]).toEqual(result.calls[3]);
});

test('safe read-only actions retry redirected 404; writes and other failures do not', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { api } = await import('/src/api.js');
    const original = window.fetch;
    const results = [];
    const cases = [
      ...['login', 'dashboard', 'session'].flatMap((action) => [
        [action, true, 404],
        [action, false, 404],
        [action, true, 500],
        [action, false, 0],
      ]),
      ['createSession', true, 404],
      ['scan', true, 404, 'in'],
      ['scan', true, 404, 'out'],
      ['closeSession', true, 404],
      ['logout', true, 404],
    ];
    try {
      for (const [action, redirected, status, direction] of cases) {
        let calls = 0;
        window.fetch = async () => {
          calls++;
          if (status === 0) throw new TypeError('PRIVATE_QR_SENTINEL');
          return { ok: false, status, redirected };
        };
        let message;
        try {
          await api(action, { direction, qr_token: 'PRIVATE_QR_SENTINEL' });
        } catch (e) {
          message = e.message;
        }
        results.push({ action, direction, redirected, status, calls, message });
      }
    } finally {
      window.fetch = original;
    }
    return results;
  });
  for (const r of results) {
    const retry =
      ['login', 'dashboard', 'session'].includes(r.action) &&
      r.redirected &&
      r.status === 404;
    expect(r.calls, JSON.stringify(r)).toBe(retry ? 2 : 1);
  }
  for (const r of results.filter((r) => r.action === 'session'))
    expect(r.message).toBe(
      'The service could not deliver the class details. Attendance has not been submitted.',
    );
});

test('session QR uses the YLA branded layout and embeds the app logo', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Academy').waitFor();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Class overview').waitFor();
  await page.getByRole('button', { name: 'Display QR ↗' }).click();
  await expect(page.locator('.qr-brand strong')).toHaveText('Young Leadership Academy');
  await expect(page.locator('.qr-brand span')).toHaveText('LEARN • LEAD • GROW');
  await expect(page.locator('.qr-session-name')).toHaveText('English · Intermediate');
  await expect(page.locator('.qr-attendance-title')).toHaveText('Record your attendance');
  await expect(page.locator('#qr')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download QR' })).toBeVisible();
});


test('password recovery waits for the Supabase recovery session and updates the password', async ({ page }) => {
  const payload = btoa(
    JSON.stringify({
      sub: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'recovery-test@example.invalid',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const accessToken = `eyJhbGciOiJub25lIn0.${payload.replace(/=+$/, '')}.test-signature`;
  const refreshToken = 'recovery-refresh-token-test';

  let updateCalls = 0;
  await page.route('**/auth/v1/user', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          email: 'recovery-test@example.invalid',
        }),
      });
      return;
    }

    updateCalls++;
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
    const body = JSON.parse(route.request().postData() || '{}');
    expect(body).toEqual({ password: 'A-very-secure-new-password-1234' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-000000000001',
        email: 'recovery-test@example.invalid',
      }),
    });
  });

  await page.goto(
    `/#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&expires_in=3600&token_type=bearer`,
  );

  await expect(page.getByText('Reset your password.')).toBeVisible();
  await expect(page.getByText('Set a new password')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5184/');

  await page.getByLabel('New password').fill('A-very-secure-new-password-1234');
  await page.getByLabel('Confirm new password').fill('A-very-secure-new-password-1234');
  await page.getByRole('button', { name: 'Save new password →' }).click();

  await expect(page.getByText('Password updated. Please sign in with your new password.')).toBeVisible();
  expect(updateCalls).toBe(1);
});
