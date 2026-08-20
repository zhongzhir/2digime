'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatFullName } = require('../src/format');

describe('formatFullName', () => {
  it('joins given and family names with a single space', () => {
    assert.equal(formatFullName('Ada', 'Lovelace'), 'Ada Lovelace');
  });

  it('has no leading space when given name is empty', () => {
    assert.equal(formatFullName('', 'Lovelace'), 'Lovelace');
  });

  it('has no trailing space when family name is empty', () => {
    assert.equal(formatFullName('Ada', ''), 'Ada');
  });
});
