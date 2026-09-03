const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'manage-advisor-synthetic-scope.mjs'), 'utf8');

test('synthetic Advisor scope provisioning is explicit, isolated, and collision-safe', () => {
  assert.match(source, /I_AUTHORIZE_TEMPORARY_SYNTHETIC_ADVISOR_QA_SCOPE/);
  assert.match(source, /SYNTHETIC_ADVISOR_QA_20260829/);
  assert.match(source, /if \(existing\.length\)/);
  assert.match(source, /Refusing to provision/);
  assert.doesNotMatch(source, /ON CONFLICT/i);
});

test('synthetic Advisor scope cleanup is marker-guarded and tenant-bounded', () => {
  assert.match(source, /startsWith\(MARKER\)/);
  assert.match(source, /DELETE FROM tenants WHERE id = ANY\(\$1::text\[\]\) AND name LIKE \$2/);
  assert.match(source, /DELETE FROM advisor_recommendations WHERE tenant_id = ANY\(\$1::text\[\]\)/);
});
