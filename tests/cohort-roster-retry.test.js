import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('cohort roster retry restores the roster only after confirmed statuses', () => {
  const retryHandler = source.slice(
    source.indexOf("document.querySelector('#retry-roster')"),
    source.indexOf('\n    return;\n  }', source.indexOf("document.querySelector('#retry-roster')")),
  );

  assert.ok(retryHandler.length > 0, 'retry handler should exist');
  assert.match(retryHandler, /const freshStudents = await api\('students', \{\}, auth\)/);
  assert.match(retryHandler, /!Array\.isArray\(freshStudents\) \|\| freshStudents\.some\(\(student\) => typeof student\?\.active !== 'boolean'\)/);
  assert.match(retryHandler, /data = \{ \.\.\.data, students: freshStudents \}/);
  assert.match(retryHandler, /rosterRefreshError = false/);
  assert.match(retryHandler, /render\(\)/);
});

test('failed cohort roster retry keeps the blocking state and re-enables retry', () => {
  const retryHandler = source.slice(
    source.indexOf("document.querySelector('#retry-roster')"),
    source.indexOf('\n    return;\n  }', source.indexOf("document.querySelector('#retry-roster')")),
  );

  assert.ok(retryHandler.length > 0, 'retry handler should exist');
  assert.match(retryHandler, /catch \{/);
  assert.match(retryHandler, /button\.disabled = false/);
  assert.match(retryHandler, /button\.textContent = 'Retry refresh'/);
  assert.match(retryHandler, /notice\('Could not verify the cohort roster\. Please retry\.'\)/);
  const catchBlock = retryHandler.slice(retryHandler.indexOf('} catch {'));
  assert.doesNotMatch(catchBlock, /rosterRefreshError = false/);
});
