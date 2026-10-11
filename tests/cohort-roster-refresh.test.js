import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('cohort roster hides cached records with unknown statuses after refresh failure', () => {
  assert.match(source, /rosterRefreshError = Array\.isArray\(data\?\.students\) && data\.students\.some\(\(student\) => typeof student\?\.active !== 'boolean'\)/);
  assert.match(source, /The last loaded roster is hidden until it can be refreshed/);
  assert.match(source, /No student status changes can be made from this screen/);
});

test('cohort roster retry requires an array with confirmed boolean statuses', () => {
  assert.match(source, /freshStudents\.some\(\(student\) => typeof student\?\.active !== 'boolean'\)/);
  assert.match(source, /rosterRefreshError = false;[\s\S]*?render\(\);/);
});
