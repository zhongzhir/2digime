const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPrice } = require('../src/price-card.cjs');

test('keeps two decimal places', () => {
  assert.equal(formatPrice(1250), '¥12.50');
});
