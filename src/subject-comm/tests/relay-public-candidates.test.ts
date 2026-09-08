import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { candidatePoolHash } from '../network-item';
import { FEED_01_EXPIRED_ITEM, FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

async function listen(prefix: string): Promise<{
  server: Server;
  relayUrl: string;
  dataDir: string;
}> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `dm-netitem-${prefix}-`));
  const store = new FileRelayStore(dataDir);
  const networkItems = new FileNetworkItemStore(dataDir);
  const { server } = createRelayServer({ store, networkItems, host: '127.0.0.1', port: 0 });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}`, dataDir };
}

test('Relay public candidates: publish, list, TTL, pagination, same query same pool', async () => {
  const { server, relayUrl } = await listen('main');
  try {
    const a = new RelayClient(relayUrl);
    const b = new RelayClient(relayUrl);
    for (const item of FEED_01_SEED_ITEMS) {
      const published = await a.publishNetworkItem(item);
      assert.equal(published.ok, true);
      assert.equal(published.itemId, item.itemId);
    }
    await a.publishNetworkItem(FEED_01_EXPIRED_ITEM);

    const query = { kind: 'content', visibility: 'public', limit: 50 } as const;
    const listedA = await a.listNetworkItems(query);
    const listedB = await b.listNetworkItems(query);
    const idsA = listedA.items.map((item) => item.itemId);
    const idsB = listedB.items.map((item) => item.itemId);
    assert.deepEqual(idsA, idsB);
    assert.equal(idsA.length, 32);
    assert.ok(!idsA.includes('ni_99'));
    assert.equal(candidatePoolHash(idsA), candidatePoolHash(idsB));
    assert.equal(listedA.items[0]?.provenance.origin, 'seed');

    const page1 = await a.listNetworkItems({ kind: 'content', limit: 10 });
    assert.equal(page1.items.length, 10);
    assert.ok(page1.nextCursor);
    const page2 = await a.listNetworkItems({ kind: 'content', limit: 10, cursor: page1.nextCursor });
    assert.equal(page2.items.length, 10);
    assert.notEqual(page1.items[0]?.itemId, page2.items[0]?.itemId);

    await assert.rejects(() => a.publishNetworkItem({ ...FEED_01_SEED_ITEMS[0]!, itemId: '' } as never));
  } finally {
    server.close();
  }
});

test('Relay public candidates: reject personalized query and leave mailbox intact', async () => {
  const { server, relayUrl, dataDir } = await listen('reject');
  try {
    const client = new RelayClient(relayUrl);
    await client.publishNetworkItem(FEED_01_SEED_ITEMS[0]!);
    const res = await fetch(`${relayUrl}/v1/network-items?kind=content&digitalSelf=secret`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'query_keys_rejected');

    const mailbox = await fetch(`${relayUrl}/v1/envelopes?to=ep_nobody`);
    assert.equal(mailbox.status, 200);
    const mail = (await mailbox.json()) as { items?: unknown[] };
    assert.ok(Array.isArray(mail.items));
    assert.equal(mail.items?.length, 0);

    const names = await fs.readdir(path.join(dataDir, 'envelopes')).catch(() => []);
    assert.equal(names.filter((n) => n.endsWith('.json')).length, 0);
  } finally {
    server.close();
  }
});

test('Relay public candidate source has no ranking algorithm', async () => {
  const serverSrc = await fs.readFile(path.join(process.cwd(), 'src/relay-service/server.ts'), 'utf8');
  const storeSrc = await fs.readFile(path.join(process.cwd(), 'src/relay-service/network-item-store.ts'), 'utf8');
  const blob = `${serverSrc}\n${storeSrc}`;
  assert.equal(blob.includes('self.json'), false);
  assert.equal(blob.includes('cosine'), false);
  assert.equal(blob.includes('embedding'), false);
  assert.equal(blob.includes('interestScore'), false);
  assert.equal(blob.includes('relevanceScore'), false);
  assert.equal(/function\s+rank/i.test(blob), false);
});
