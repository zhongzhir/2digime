import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import {
  addManagedContentSource,
  toggleManagedContentSource,
} from '../content-source-management';

const NOW = '2026-11-10T09:00:00.000Z';
const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Owner Chosen Source</title>
  <item><title>Open item one</title><link>https://example.org/items/one</link><description>Useful item one.</description></item>
  <item><title>Open item two</title><link>https://example.org/items/two</link><description>Useful item two.</description></item>
</channel></rss>`;

test('user source is registered only after the open feed produces real candidates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-onboarding-'));
  const store = new MemoryNetworkItemStore();
  const added = await addManagedContentSource({
    packageRoot: root,
    url: 'https://example.org/feed.xml',
    label: '',
    store,
    now: NOW,
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });

  const source = added.sources.find((row) => row.origin === 'user');
  assert.ok(source);
  assert.equal(source!.label, 'Owner Chosen Source');
  assert.equal(source!.availability, 'available');
  assert.equal(source!.lastItemCount, 2);
  assert.deepEqual(source!.contentTypes, ['article']);
  assert.match(String(added.notice || ''), /本次读到 2 条/);
  assert.equal((await store.list({ limit: 20 }, NOW)).items.length, 2);

  const disabled = await toggleManagedContentSource({
    packageRoot: root,
    sourceId: source!.id,
    enabled: false,
    now: '2026-11-10T09:01:00.000Z',
  });
  const disabledSource = disabled.sources.find((row) => row.id === source!.id)!;
  assert.equal(disabledSource.availability, 'disabled');
  assert.equal(disabledSource.lastItemCount, 2);
});

test('unreadable source is not added to the portfolio', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-onboarding-empty-'));
  const result = await addManagedContentSource({
    packageRoot: root,
    url: 'https://example.org/empty.xml',
    label: 'Empty Source',
    store: new MemoryNetworkItemStore(),
    now: NOW,
    fetchImpl: async () => ({
      status: 200,
      body: '<rss><channel><title>Empty Source</title></channel></rss>',
      finalUrl: 'https://example.org/empty.xml',
    }),
  });

  assert.match(String(result.notice || ''), /暂未加入/);
  assert.equal(result.sources.some((row) => row.origin === 'user'), false);
});

test('an explicit user source is not rejected by the automatic default-supply boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-owner-choice-'));
  const result = await addManagedContentSource({
    packageRoot: root,
    url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml',
    label: 'BBC 中文公开源验收',
    store: new MemoryNetworkItemStore(),
    now: NOW,
    fetchImpl: async () => ({
      status: 200,
      body: RSS,
      finalUrl: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml',
    }),
  });

  const source = result.sources.find((row) => row.origin === 'user');
  assert.ok(source);
  assert.equal(source!.label, 'BBC 中文公开源验收');
  assert.match(String(result.notice || ''), /^已加入/);
});
