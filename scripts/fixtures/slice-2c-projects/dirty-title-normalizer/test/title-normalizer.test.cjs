const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTitle } = require('../src/title-normalizer.cjs');

test('preserves meaningful inner spacing', () => {
  assert.equal(normalizeTitle('  Rabbit  Agent  '), 'Rabbit Agent');
});
