import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIMARY_BUTTON_LABEL, renderPrimaryButton } from './label';

test('primary button label is user-facing Chinese', () => {
  assert.equal(typeof PRIMARY_BUTTON_LABEL, 'string');
  assert.ok(PRIMARY_BUTTON_LABEL.length > 0);
  assert.match(renderPrimaryButton(), /<button type="button">.+<\/button>/);
});
