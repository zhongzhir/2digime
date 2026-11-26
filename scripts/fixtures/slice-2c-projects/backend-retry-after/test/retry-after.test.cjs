const test = require('node:test');
const assert = require('node:assert/strict');
const { retryAfterMs } = require('../src/retry-after.cjs');

test('converts seconds to milliseconds', () => {
  assert.equal(retryAfterMs('3'), 3000);
});
