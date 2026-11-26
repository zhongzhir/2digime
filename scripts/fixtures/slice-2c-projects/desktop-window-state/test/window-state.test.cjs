const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreWindowBounds } = require('../src/main.cjs');

test('moves an off-screen window to the primary display', () => {
  const primary = { workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  const saved = { x: 4000, y: 200, width: 900, height: 700 };
  assert.deepEqual(restoreWindowBounds(saved, primary), primary.workArea);
});
