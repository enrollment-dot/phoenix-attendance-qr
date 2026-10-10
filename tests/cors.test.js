import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, resolveCorsOrigin } from '../supabase/functions/ylp-api/cors.js';

const allowlist = ['https://ylp.siferlab.space'];

test('allows explicitly configured origins regardless of preview flag', () => {
  assert.equal(isAllowedOrigin('https://ylp.siferlab.space', allowlist), true);
  assert.equal(resolveCorsOrigin('https://ylp.siferlab.space', allowlist), 'https://ylp.siferlab.space');
});

test('preview origins are denied unless staging preview opt-in is enabled', () => {
  const origin = 'https://phoenix-attendance-rbac-staging-c81p7bnjy.vercel.app';
  assert.equal(isAllowedOrigin(origin, allowlist), false);
  assert.equal(isAllowedOrigin(origin, allowlist, true), true);
  assert.equal(resolveCorsOrigin(origin, allowlist, true), origin);
});

test('preview opt-in rejects other projects, lookalike hosts, HTTP and malformed origins', () => {
  for (const origin of [
    'https://other-project-c81p7bnjy.vercel.app',
    'https://phoenix-attendance-rbac-staging-c81p7bnjy.vercel.app.evil.test',
    'https://phoenix-attendance-rbac-staging-.vercel.app',
    'http://phoenix-attendance-rbac-staging-c81p7bnjy.vercel.app',
    'https://phoenix-attendance-rbac-staging-c81p7bnjy.vercel.app/path',
    'null',
    '',
  ]) {
    assert.equal(isAllowedOrigin(origin, allowlist, true), false, origin);
    assert.equal(resolveCorsOrigin(origin, allowlist, true), '', origin);
  }
});

test('preview opt-in does not allow arbitrary Vercel deployment hosts', () => {
  assert.equal(isAllowedOrigin('https://phoenix-attendance-rbac-production-abc123.vercel.app', allowlist, true), false);
});
