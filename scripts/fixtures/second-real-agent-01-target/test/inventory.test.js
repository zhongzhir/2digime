'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Inventory } = require('../src/inventory');

describe('Inventory', () => {
  it('adds and removes within available quantity', () => {
    const inv = new Inventory();
    inv.addItem('sku-1', 5);
    inv.removeItem('sku-1', 2);
    assert.equal(inv.getQuantity('sku-1'), 3);
  });

  it('reports zero for unknown sku', () => {
    const inv = new Inventory();
    assert.equal(inv.getQuantity('missing'), 0);
  });

  it('does not produce negative quantity when removing more than stock', () => {
    const inv = new Inventory();
    inv.addItem('sku-1', 3);
    inv.removeItem('sku-1', 10);
    assert.ok(inv.getQuantity('sku-1') >= 0);
  });
});
