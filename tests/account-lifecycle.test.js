import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminAccountLifecycle,
  updateAdminAccountLifecycle,
  removeAdminAccountLifecycle,
} from '../supabase/functions/ylp-api/account-lifecycle.js';

const config = { supabaseUrl: 'https://example.supabase.co', supabaseServiceRoleKey: 'test-service-role-secret' };
const okResponse = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const failedResponse = (status = 500) => ({ ok: false, status, json: async () => ({}) });

function deps({ rpc = async () => ({ id: 'profile-1' }), request = async () => okResponse({ id: 'auth-1' }), onPartialFailure } = {}) {
  const events = [];
  const calls = [];
  onPartialFailure = onPartialFailure ?? ((event) => events.push(event));
  return {
    events,
    calls,
    deps: {
      config,
      rpc: async (name, body) => { calls.push({ type: 'rpc', name, body }); return rpc(name, body); },
      request: async (url, init) => { calls.push({ type: 'auth', url, init }); return request(url, init); },
      onPartialFailure,
    },
  };
}

test('create: Auth failure does not call profile RPC', async () => {
  const d = deps({ request: async () => failedResponse(400) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }));
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].type, 'auth');
  assert.equal(d.events.length, 0);
});

test('create: successful Auth and profile creation returns success', async () => {
  const d = deps({ request: async () => okResponse({ id: 'auth-1' }), rpc: async (name, body) => ({ name, body }) });
  const result = await createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' });
  assert.equal(result.ok, true);
  assert.equal(d.calls[1].name, 'ylp_admin_account_create_profile_v1');
  assert.equal(d.calls[1].body.p_admin_id, 'auth-1');
});

test('create: malformed Auth response reports reconciliation', async () => {
  const d = deps({ request: async () => okResponse(null) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }));
  assert.deepEqual(d.events, ['create_response_unparseable']);
  assert.equal(d.calls.length, 1);
});

test('create: missing Auth user ID reports reconciliation and never creates a profile', async () => {
  const d = deps({ request: async () => okResponse({ user: {} }) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }));
  assert.deepEqual(d.events, ['create_missing_user_id']);
  assert.equal(d.calls.length, 1);
});

test('create: profile failure with successful rollback attempts Auth DELETE', async () => {
  const d = deps({ rpc: async () => { throw new Error('simulated profile failure'); }, request: async (url, init) => init.method === 'POST' ? okResponse({ id: 'auth-1' }) : okResponse({}) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }));
  assert.deepEqual(d.calls.map((call) => call.type === 'auth' ? call.init.method : call.name), ['POST', 'ylp_admin_account_create_profile_v1', 'DELETE']);
  assert.deepEqual(d.events, []);
});

test('create: failed rollback is reported without masking profile failure', async () => {
  const d = deps({ rpc: async () => { throw new Error('simulated profile failure'); }, request: async (url, init) => init.method === 'POST' ? okResponse({ id: 'auth-1' }) : failedResponse(500) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }), /simulated profile failure/);
  assert.deepEqual(d.events, ['create_rollback_failed']);
});

test('create: rollback network failure is reported safely', async () => {
  const d = deps({ rpc: async () => { throw new Error('profile failure'); }, request: async (url, init) => { if (init.method === 'DELETE') throw new Error('network details'); return okResponse({ id: 'auth-1' }); } });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'x@example.com', password: 'very-long-test-password', username: 'tester', role: 'operator' }));
  assert.deepEqual(d.events, ['create_rollback_failed']);
});

test('update: successful Auth and profile update returns success', async () => {
  const d = deps({ request: async () => okResponse({}), rpc: async (name, body) => ({ name, body }) });
  const result = await updateAdminAccountLifecycle(d.deps, { adminId: 'auth-1', email: 'x@example.com', username: 'tester', role: 'operator', active: true });
  assert.equal(result.ok, true);
  assert.equal(d.calls[0].init.method, 'PUT');
  assert.equal(d.calls[1].name, 'ylp_admin_account_update_v1');
  assert.equal(d.events.length, 0);
});

test('update: Auth failure does not call profile RPC', async () => {
  const d = deps({ request: async () => failedResponse(401) });
  await assert.rejects(updateAdminAccountLifecycle(d.deps, { adminId: 'auth-1', email: 'x@example.com', username: 'tester', role: 'operator', active: true }));
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].type, 'auth');
});

test('update: profile failure after Auth success emits reconciliation event', async () => {
  const d = deps({ rpc: async () => { throw new Error('profile RPC failed'); } });
  await assert.rejects(updateAdminAccountLifecycle(d.deps, { adminId: 'auth-1', email: 'x@example.com', username: 'tester', role: 'operator', active: true, password: 'never-log-this-password' }), /profile RPC failed/);
  assert.deepEqual(d.events, ['update_profile_failed_after_auth_update']);
  assert.equal(d.calls[0].init.method, 'PUT');
  assert.equal(d.calls[1].type, 'rpc');
  assert.equal(JSON.stringify(d.events).includes('never-log-this-password'), false);
});

test('remove: successful profile and Auth removal returns success', async () => {
  const d = deps({ request: async () => okResponse({}), rpc: async () => ({ removed: true }) });
  const result = await removeAdminAccountLifecycle(d.deps, { adminId: 'auth-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(d.calls.map((call) => call.type === 'auth' ? call.init.method : call.name), ['ylp_admin_account_remove_profile_v1', 'DELETE']);
  assert.equal(d.events.length, 0);
});

test('remove: profile safety guard failure prevents Auth DELETE', async () => {
  const d = deps({ rpc: async () => { throw new Error('last active super_admin'); } });
  await assert.rejects(removeAdminAccountLifecycle(d.deps, { adminId: 'auth-1' }), /last active super_admin/);
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].type, 'rpc');
  assert.deepEqual(d.events, []);
});

test('remove: Auth DELETE failure after profile removal emits reconciliation event', async () => {
  const d = deps({ request: async () => failedResponse(500) });
  await assert.rejects(removeAdminAccountLifecycle(d.deps, { adminId: 'auth-1' }), /after profile removal/);
  assert.deepEqual(d.calls.map((call) => call.type === 'auth' ? call.init.method : call.name), ['ylp_admin_account_remove_profile_v1', 'DELETE']);
  assert.deepEqual(d.events, ['remove_auth_delete_failed_after_profile_removal']);
});

test('remove: Auth DELETE network failure emits reconciliation event', async () => {
  const d = deps({ request: async () => { throw new Error('network details'); } });
  await assert.rejects(removeAdminAccountLifecycle(d.deps, { adminId: 'auth-1' }), /after profile removal/);
  assert.deepEqual(d.events, ['remove_auth_delete_failed_after_profile_removal']);
});

test('lifecycle diagnostics contain fixed event codes only, not supplied secrets', async () => {
  const secretPassword = 'password-that-must-not-be-logged';
  const d = deps({ rpc: async () => { throw new Error(secretPassword); }, request: async (url, init) => init.method === 'POST' ? okResponse({ id: 'auth-1' }) : failedResponse(500) });
  await assert.rejects(createAdminAccountLifecycle(d.deps, { email: 'private@example.com', password: secretPassword, username: 'tester', role: 'operator' }));
  assert.deepEqual(d.events, ['create_rollback_failed']);
  assert.equal(JSON.stringify(d.events).includes(secretPassword), false);
  assert.equal(JSON.stringify(d.events).includes('private@example.com'), false);
});
