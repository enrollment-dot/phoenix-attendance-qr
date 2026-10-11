import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, resolveCorsOrigin } from '../supabase/functions/ylp-api/cors.js';

const stableStaging = 'https://phoenix-attendance-rbac-staging.vercel.app';
const previewStaging = 'https://phoenix-attendance-rbac-staging-puge2fmay.vercel.app';

test('allows the stable staging hostname only when preview origins are enabled', () => {
  assert.equal(isAllowedOrigin(stableStaging, [], false), false);
  assert.equal(isAllowedOrigin(stableStaging, [], true), true);
  assert.equal(resolveCorsOrigin(stableStaging, [], true), stableStaging);
});

test('continues to allow valid staging preview deployment hostnames', () => {
  assert.equal(isAllowedOrigin(previewStaging, [], true), true);
});

test('does not allow unrelated or malformed origins as staging previews', () => {
  assert.equal(isAllowedOrigin('https://attacker.vercel.app', [], true), false);
  assert.equal(isAllowedOrigin('http://phoenix-attendance-rbac-staging.vercel.app', [], true), false);
  assert.equal(isAllowedOrigin('https://phoenix-attendance-rbac-staging.vercel.app.evil.test', [], true), false);
  assert.equal(isAllowedOrigin('https://phoenix-attendance-rbac-staging.vercel.app/path', [], true), false);
});

test('continues to allow explicitly configured origins without preview mode', () => {
  assert.equal(isAllowedOrigin(stableStaging, [stableStaging], false), true);
});
