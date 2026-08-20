'use strict';

/**
 * 库存。公共 API：Inventory#addItem / removeItem / getQuantity。
 */
class Inventory {
  constructor() {
    this._qty = Object.create(null);
  }

  addItem(sku, qty) {
    const id = String(sku || '').trim();
    const n = Number(qty);
    if (!id || !(n > 0) || !Number.isFinite(n)) {
      throw new Error('invalid item');
    }
    this._qty[id] = (this._qty[id] || 0) + n;
    return this._qty[id];
  }

  removeItem(sku, qty) {
    const id = String(sku || '').trim();
    const n = Number(qty);
    if (!id || !(n > 0) || !Number.isFinite(n)) {
      throw new Error('invalid item');
    }
    const current = this._qty[id] || 0;
    this._qty[id] = current - n;
    return this._qty[id];
  }

  getQuantity(sku) {
    const id = String(sku || '').trim();
    return this._qty[id] || 0;
  }
}

module.exports = { Inventory };
