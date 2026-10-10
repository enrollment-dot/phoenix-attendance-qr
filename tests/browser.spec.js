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
async function mock(page, supportsRetries = true, studentsRefreshFails = false) {
  let branding = {
    organization_name: 'Young Leadership Program',
    tagline: 'Learn. Lead. Build. Inspire',
    logo_url: '/ylp-logo-exact.svg',
    favicon_url: null,
    primary_color: '#183E32',
    accent_color: '#6A9A3C',
    sidebar_color: '#183E32',
    page_background: '#F4F7F5',
    card_background: '#FFFFFF',
    text_color: '#183E32',
    muted_text_color: '#6B7D78',
    footer_text: 'Young Leadership Program · For facilitators and cohort members',
    login_welcome_title: 'Joining a Young Leadership Program cohort?',
    login_welcome_description: 'Open the QR shared by your facilitator. Choose Scan In when you arrive and Scan Out when you leave.',
    login_welcome_button_text: 'Scan a cohort QR',
  };
  let record = null;
  await page.route('**/__test_api', async (route) => {
    const r = JSON.parse(route.request().postData() || '{}');
    let data = {},
      error = '';
    switch (r.action) {
      case 'login':
        data = { token: 'test-admin', role: r.payload.username === 'super-admin' ? 'super_admin' : 'admin' };
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
      case 'students':
        if (studentsRefreshFails) error = 'Roster refresh failed for test.';
        else data = [
          { student_id: 'S001', name: 'Alex Morgan', active: true },
          { student_id: 'S002', name: 'Jamie', active: false },
        ];
        break;
      case 'createSession':
        data = { ...session, ...r.payload, session_id: r.payload.request_id };
        break;
      case 'session':
        data = session;
        break;
      case 'publicBranding':
        data = branding;
        break;
      case 'branding':
        data = branding;
        break;
      case 'updateBranding':
        branding = { ...branding, ...r.payload };
        data = branding;
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
test('public header renders the branding tagline instead of the template literal', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header .tiny')).toHaveText('Learn. Lead. Build. Inspire');
  await expect(page.locator('header .tiny')).not.toContainText('esc(branding.tagline)');
});

test('cohort and facilitator terminology is shown in the main attendance UI', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await expect(page.getByText('FACILITATOR & ADMIN ACCESS')).toBeVisible();
  await expect(page.getByText('Joining a Young Leadership Program cohort?')).toBeVisible();
  await expect(page.getByText('Open the QR shared by your facilitator. Choose Scan In when you arrive and Scan Out when you leave.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan a cohort QR' })).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await expect(page.getByText('Cohort overview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cohort' })).toBeVisible();
  await expect(page.getByText('Cohort', { exact: true })).toBeVisible();
  await expect(page.getByText('Cohort members', { exact: true })).toHaveCount(0);
  const dashboardTabs = [
    { nav: 'dashboard', text: 'Cohort overview' },
    { nav: 'reports', text: 'Attendance report' },
    { nav: 'students', text: 'YLP' },
  ];
  for (const tab of dashboardTabs) {
    await page.locator(`[data-nav="${tab.nav}"]`).click();
    await expect(page.getByText(tab.text, { exact: true })).toBeVisible();
    await expect(page.getByText(/ACADEMY/, { exact: false })).toHaveCount(0);
  }

  await page.locator('[data-nav="students"]').click();
  await expect(page.getByRole('heading', { name: 'YLP', exact: true })).toBeVisible();
  await expect(page.getByText('YLP roster', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ Add YLP member' })).toBeVisible();
  await expect(page.getByText('Cohort Members', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cohort member roster', { exact: true })).toHaveCount(0);

  await page.goto('/');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await expect(page.getByText('Cohort overview')).toBeVisible();
  await page.locator('[data-nav="scanner"]').click();
  await expect(page.getByText('YLP ATTENDANCE', { exact: true })).toBeVisible();

  await expect(page.getByText('Students')).toHaveCount(0);
  await expect(page.getByText('TEACHER & ADMIN ACCESS')).toHaveCount(0);
});

test('appearance branding save consumes the API data without showing a response-shape error', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Program').waitFor();
  await page.getByLabel('Username').fill('super-admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();

  await page.locator('[data-nav="appearance"]').click();
  await page.getByRole('heading', { name: 'Appearance & Branding' }).waitFor();
  await expect(page.getByLabel('Organization name')).toHaveValue('Young Leadership Program');
  await expect(page.getByLabel('Tagline')).toHaveValue('Learn. Lead. Build. Inspire');
  await expect(page.getByLabel('Login welcome title')).toHaveValue('Joining a Young Leadership Program cohort?');
  await expect(page.getByLabel('Login welcome description')).toHaveValue('Open the QR shared by your facilitator. Choose Scan In when you arrive and Scan Out when you leave.');
  await expect(page.getByLabel('Login welcome button text')).toHaveValue('Scan a cohort QR');

  await page.getByLabel('Tagline').fill('Learn. Lead. Build. Inspire · Test');
  await page.getByLabel('Login welcome title').fill('Join your YLP cohort');
  await page.getByLabel('Login welcome button text').fill('Open cohort scanner');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByLabel('Tagline')).toHaveValue('Learn. Lead. Build. Inspire · Test');
  await expect(page.getByLabel('Login welcome title')).toHaveValue('Join your YLP cohort');
  await expect(page.getByLabel('Login welcome button text')).toHaveValue('Open cohort scanner');
  await expect(page.locator('#notice')).not.toContainText('unexpected response');

  await page.reload();
  await expect(page.getByText('Sign in to Young Leadership Program')).toBeVisible();
  await expect(page.locator('header .tiny')).toHaveText('Learn. Lead. Build. Inspire · Test');
});
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

test('cohort QR uses the YLP branded layout without an embedded logo', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Program').waitFor();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();
  await page.getByRole('button', { name: 'Display QR ↗' }).click();
  await expect(page.locator('.qr-brand')).toHaveCount(1);
  await expect(page.locator('.qr-brand-mark')).toHaveAttribute('src', '/ylp-logo-icon.png');
  await expect(page.locator('.qr-visual')).toBeVisible();
  await expect(page.locator('.qr-scan-frame')).toBeVisible();
  await expect(page.locator('.qr-corner')).toHaveCount(0);
  await expect(page.locator('.qr-brand strong')).toHaveText('YLP');
  await expect(page.locator('.qr-brand span')).toHaveText('Learn. Lead. Build. Inspire');
  const logoAsset = await page.request.get('/ylp-logo-exact.svg?v=ylp-v10');
  expect(logoAsset.ok()).toBeTruthy();
  expect(logoAsset.headers()['content-type']).toContain('image/svg+xml');
  await expect(page.locator('.qr-session-name')).toHaveText('English · Intermediate');
  await expect(page.locator('.qr-attendance-title')).toHaveText('Record your attendance');
  await expect(page.locator('.qr-instructions p')).toContainText(
    'Enter your cohort member name and cohort ID, then choose Scan In or Scan Out.',
  );
  const qr = page.locator('#qr');
  await expect(qr).toBeVisible();
  const centerLightGreenPixels = await qr.evaluate((canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('QR canvas context is unavailable.');
    const image = ctx.getImageData(119, 119, 82, 82).data;
    let count = 0;
    for (let i = 0; i < image.length; i += 4) {
      if (
        image[i] === 242 &&
        image[i + 1] === 247 &&
        image[i + 2] === 237 &&
        image[i + 3] === 255
      )
        count++;
    }
    return count;
  });
  expect(centerLightGreenPixels).toBe(0);
  await expect(page.getByRole('button', { name: 'Download QR' })).toBeVisible();
});


test('mobile layout keeps the YLP branding within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Program').waitFor();
  await expect(page.locator('.mark')).toHaveAttribute('src', '/ylp-logo-exact.svg');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.viewport + 1);
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
          aud: 'authenticated',
          role: 'authenticated',
          email: 'recovery-test@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          phone: '',
          confirmed_at: '2026-01-01T00:00:00Z',
          last_sign_in_at: '2026-01-01T00:00:00Z',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          is_anonymous: false,
        }),
      });
      return;
    }

    updateCalls++;
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
    const body = JSON.parse(route.request().postData() || '{}');
    expect(body.password).toBe('A-very-secure-new-password-1234');
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
    `/#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&expires_in=3600&token_type=bearer&type=recovery`,
  );

  await expect(page.getByText('Reset your password.')).toBeVisible();
  await expect(page.getByText('Set a new password')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5184/');

  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('A-very-secure-new-password-1234');
  await page.getByLabel('Confirm new password').fill('A-very-secure-new-password-1234');
  await page.getByRole('button', { name: 'Save new password →' }).click();

  await expect(page.getByText('Password updated. Please sign in with your new password.')).toBeVisible();
  expect(updateCalls).toBe(1);
});


test('dashboard uses Scan In and Scan Out wording for the shared QR', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Program').waitFor();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();
  await expect(page.getByText('Use the same QR for Scan In and Scan Out.')).toBeVisible();
  await expect(page.getByText('Use the same QR for arrival and departure.')).toHaveCount(0);
  await expect(page.getByText('Keep the same session QR on screen for both Scan In and Scan Out.')).toBeVisible();
  await expect(page.getByText('Keep the session QR on screen for Scan In, then share it again for Scan Out.')).toHaveCount(0);
});

test('attendance report describes the roster as eligible rather than active', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await page.getByText('Sign in to Young Leadership Program').waitFor();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();
  await page.locator('[data-nav="reports"]').click();
  await page.getByText('Attendance report').waitFor();
  await expect(page.getByText('Cohort members in the selected view')).toBeVisible();
  await expect(page.getByText('Active cohort members in the selected view')).toHaveCount(0);
  await expect(page.getByText('The eligible cohort roster is used as the session denominator.')).toBeVisible();
  await expect(page.getByText('The active roster is used as the session denominator.')).toHaveCount(0);
});

test('cohort roster never labels missing status as inactive when refresh fails', async ({ page }) => {
  await mock(page, true, true);
  await page.goto('/');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('test-admin-password-123');
  await page.locator('#login button.primary').click();
  await page.getByText('Cohort overview').waitFor();
  await page.locator('[data-nav="students"]').click();

  await expect(page.getByRole('status')).toContainText('Could not refresh the cohort roster.');
  await expect(page.getByText('Status unknown', { exact: true })).toBeVisible();
  await expect(page.getByText('35', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#student-rows .badge.absent')).toHaveCount(0);
  await expect(page.getByText('Status unavailable').first()).toBeVisible();
});
