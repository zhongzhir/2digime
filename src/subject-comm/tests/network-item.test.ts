import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatePoolHash,
  forbiddenPersonalizationKeys,
  isNetworkItemExpired,
  validateNetworkItem,
} from '../network-item';
import { FEED_01_EXPIRED_ITEM, FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

test('NetworkItem: seed serializes and keeps provenance', () => {
  assert.equal(FEED_01_SEED_ITEMS.length, 32);
  for (const raw of FEED_01_SEED_ITEMS) {
    const checked = validateNetworkItem(JSON.parse(JSON.stringify(raw)));
    assert.equal(checked.ok, true);
    if (checked.ok) {
      assert.equal(checked.item.provenance.origin, 'seed');
      assert.equal(checked.item.kind, 'content');
      assert.equal(checked.item.visibility, 'public');
    }
  }
});

test('NetworkItem: invalid and expired', () => {
  assert.equal(validateNetworkItem({}).ok, false);
  assert.equal(validateNetworkItem({ ...FEED_01_SEED_ITEMS[0], score: 0.9 }).ok, false);
  assert.equal(isNetworkItemExpired(FEED_01_EXPIRED_ITEM, '2026-09-08T05:00:00.000Z'), true);
  assert.equal(isNetworkItemExpired(FEED_01_SEED_ITEMS[0]!, '2026-09-08T05:00:00.000Z'), false);
});

test('NetworkItem: candidate pool hash is order-sensitive and stable', () => {
  const ids = FEED_01_SEED_ITEMS.map((item) => item.itemId);
  assert.equal(candidatePoolHash(ids), candidatePoolHash([...ids]));
  assert.notEqual(candidatePoolHash(ids), candidatePoolHash([...ids].reverse()));
});

test('NetworkItem: personalization key detector', () => {
  assert.deepEqual(forbiddenPersonalizationKeys({ digitalSelf: 'x' }), ['digitalSelf']);
  assert.deepEqual(forbiddenPersonalizationKeys({ kind: 'content' }), []);
});
