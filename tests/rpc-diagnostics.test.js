import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../supabase/functions/ylp-api/index.ts', import.meta.url),
  'utf8',
);

test('RPC diagnostics include correlation fields without logging request or response data', () => {
  const failureBlock = source.match(
    /if \(!response\.ok\) \{([\s\S]*?)\n    return response\.json\(\);/,
  );
  assert.ok(failureBlock, 'RPC failure branch should be present');
  const block = failureBlock[1];

  for (const field of [
    'diagnostic_id: this.diagnosticId',
    'action: this.diagnosticAction',
    'rpc: name',
    'http_status: response.status',
  ]) {
    assert.ok(block.includes(field), `RPC diagnostic should include ${field}`);
  }

  assert.match(block, /console\.error\(/);
  assert.doesNotMatch(block, /JSON\.stringify\(body\)|response\.text\(|response\.json\(|serviceRoleKey|student_id|password|token/i);
  assert.match(source, /throw new Error\('backend rpc failed'\)/);
});

test('RPC diagnostic context is request-scoped and action is type-checked', () => {
  assert.match(source, /const diagnosticId = crypto\.randomUUID\(\)/);
  const contextPosition = source.indexOf('backend.setDiagnosticContext(diagnosticId, typeof body.action === \'string\' ? body.action : \'unknown\')');
  const dispatchPosition = source.indexOf('switch (body.action)', contextPosition);
  assert.ok(contextPosition >= 0, 'request diagnostic context should be attached');
  assert.ok(dispatchPosition > contextPosition, 'context must be attached before action dispatch and RPC calls');
  assert.match(
    source,
    /backend\.setDiagnosticContext\(diagnosticId, typeof body\.action === 'string' \? body\.action : 'unknown'\)/,
  );
});
