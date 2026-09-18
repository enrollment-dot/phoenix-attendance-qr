import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the actual transport with a test-only Vite environment.
const source = (
  await readFile(new URL('../src/api.js', import.meta.url), 'utf8')
)
  .replaceAll(
    'import.meta.env.VITE_API_URL',
    JSON.stringify('https://example.test/exec'),
  )
  .replaceAll('import.meta.env.DEV', 'false');
const { api } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('redirect retry policy preserves requests, bounds retries, and never replays writes', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const action of [
    'login',
    'dashboard',
    'session',
    'createSession',
    'scan',
    'closeSession',
    'logout',
  ]) {
    for (const failure of [
      'redirect404',
      'direct404',
      'http500',
      'transport',
      'invalidJSON',
      'server',
    ]) {
      for (const recover of [true, false]) {
        const calls = [];
        const safe = ['login', 'dashboard', 'session'].includes(action);
        const retry = safe && failure === 'redirect404';
        const payload =
          action === 'login'
            ? { password: 'test-only-password' }
            : { request_id: 'test-id' };
        globalThis.fetch = async (url, options) => {
          calls.push({ url, ...options });
          if (recover && calls.length === 2)
            return {
              ok: true,
              json: async () => ({ ok: true, data: { recovered: true } }),
            };
          if (failure === 'transport')
            throw new TypeError('test-only network failure');
          if (failure === 'invalidJSON')
            return {
              ok: true,
              json: async () => {
                throw new SyntaxError('invalid JSON');
              },
            };
          if (failure === 'server')
            return {
              ok: true,
              json: async () => ({ ok: false, error: 'Rejected' }),
            };
          return {
            ok: false,
            status: failure === 'http500' ? 500 : 404,
            redirected: failure !== 'direct404',
            body: { cancel: async () => {} },
          };
        };
        if (retry && recover)
          assert.deepEqual(await api(action, payload, 'test-token'), {
            recovered: true,
          });
        else await assert.rejects(api(action, payload, 'test-token'));
        assert.equal(
          calls.length,
          retry ? 2 : 1,
          `${action}/${failure}/${recover}`,
        );
        for (const call of calls) {
          assert.equal(call.url, 'https://example.test/exec');
          assert.equal(call.method, 'POST');
          assert.equal(call.redirect, 'follow');
          assert.equal(call.credentials, 'omit');
          assert.deepEqual(JSON.parse(call.body), {
            action,
            payload,
            token: 'test-token',
          });
        }
        if (retry) assert.notEqual(calls[0].signal, calls[1].signal);
      }
    }
  }
});
