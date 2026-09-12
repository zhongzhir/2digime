/**
 * SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01 机械门：中立 Relay + 接收侧 Digital Self。
 * 不含真实模型；真模型在 e2e。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { networkItemPayloadHash, type NetworkItem } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import { readDigitalSelf, writeDigitalSelf } from '../../subject-core/digital-self/store';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

function realShapedItem(): NetworkItem {
  return {
    schemaVersion: 1,
    itemId: 'ni_real_tower_of_god',
    publisherSubjectId: 'subj_real_publisher',
    publisherDisplayName: 'WEBTOON',
    kind: 'content',
    createdAt: '2026-09-12T06:00:00.000Z',
    visibility: 'public',
    content: {
      title: 'Tower of God',
      text: 'Official WEBTOON listing for the long-running fantasy webtoon by SIU.',
      url: 'https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95',
    },
    provenance: {
      origin: 'publisher',
      actor: 'owner',
      statedAt: '2026-09-12T06:00:00.000Z',
      excerpt: 'public listing metadata only',
    },
  };
}

function selfOf(subjectId: string, text: string): DigitalSelf {
  const now = '2026-09-12T06:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text,
        facet: 'about_me',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

async function listenRelay(): Promise<{ server: Server; relayUrl: string; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-real-content-relay-'));
  const { server } = createRelayServer({
    store: new FileRelayStore(dataDir),
    networkItems: new FileNetworkItemStore(dataDir),
    host: '127.0.0.1',
    port: 0,
  });
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

test('Relay neutrality: same broadcast payload hash to two subjects', async () => {
  const { server, relayUrl, dataDir } = await listenRelay();
  try {
    const item = realShapedItem();
    const publisher = new RelayClient(relayUrl);
    const a = new RelayClient(relayUrl);
    const b = new RelayClient(relayUrl);
    const published = await publisher.publishNetworkItem(item);
    assert.equal(published.ok, true);
    const listedA = await a.listNetworkItems({ kind: 'content', visibility: 'public' });
    const listedB = await b.listNetworkItems({ kind: 'content', visibility: 'public' });
    assert.equal(listedA.items.length, 1);
    assert.deepEqual(listedA.items[0], listedB.items[0]);
    const hashA = networkItemPayloadHash(listedA.items[0]!);
    const hashB = networkItemPayloadHash(listedB.items[0]!);
    assert.equal(hashA, hashB);
    assert.equal(listedA.items[0]?.itemId, item.itemId);
    assert.equal(listedA.items[0]?.content.url, item.content.url);

    const rejected = await fetch(`${relayUrl}/v1/network-items?preference=secret`);
    assert.equal(rejected.status, 400);
    const names = await fs.readdir(path.join(dataDir, 'network-items'));
    for (const name of names) {
      const raw = await fs.readFile(path.join(dataDir, 'network-items', name), 'utf8');
      assert.equal(raw.toLowerCase().includes('digital self'), false);
      assert.equal(raw.includes('preference vector'), false);
      assert.equal(raw.includes('ranking'), false);
    }
  } finally {
    server.close();
  }
});

test('Recipient-side selection loads each subject Digital Self, not a central profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-real-content-self-'));
  const pkgA = path.join(root, 'a');
  const pkgB = path.join(root, 'b');
  const selfA = selfOf('subj_trial_a', '我长期追连载漫画和动态漫剧。');
  const selfB = selfOf('subj_trial_b', '我把业余时间花在看球赛上，不想被长篇漫画打扰。');
  await writeDigitalSelf(pkgA, selfA);
  await writeDigitalSelf(pkgB, selfB);
  const loadedA = await readDigitalSelf(pkgA, selfA.subjectId, '2026-09-12T06:01:00.000Z');
  const loadedB = await readDigitalSelf(pkgB, selfB.subjectId, '2026-09-12T06:01:00.000Z');
  assert.equal(loadedA.subjectId, 'subj_trial_a');
  assert.equal(loadedB.subjectId, 'subj_trial_b');
  assert.notEqual(loadedA.understandings[0]?.text, loadedB.understandings[0]?.text);

  const item = realShapedItem();
  let sawA = false;
  let sawB = false;
  const selectedA = await selectNetworkItems({
    digitalSelf: loadedA,
    items: [item],
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /连载漫画和动态漫剧/);
      assert.equal(blob.includes(selfB.understandings[0]!.text), false);
      sawA = true;
      return {
        text: JSON.stringify({
          decisions: [{ itemId: item.itemId, decision: 'show', reason: '与已确认的连载兴趣相符。' }],
        }),
      };
    },
  });
  const selectedB = await selectNetworkItems({
    digitalSelf: loadedB,
    items: [item],
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /看球赛/);
      assert.equal(blob.includes(selfA.understandings[0]!.text), false);
      sawB = true;
      return {
        text: JSON.stringify({
          decisions: [{ itemId: item.itemId, decision: 'ignore', reason: '与当前看球习惯关系弱。' }],
        }),
      };
    },
  });
  assert.equal(selectedA.ok, true);
  assert.equal(selectedB.ok, true);
  assert.equal(sawA && sawB, true);
  if (selectedA.ok && selectedB.ok) {
    assert.equal(selectedA.decisions[0]?.decision, 'show');
    assert.equal(selectedB.decisions[0]?.decision, 'ignore');
  }
});

test('Trial source does not introduce central recommender names', async () => {
  const files = [
    'src/subject-comm/network-item.ts',
    'src/subject-comm/personal-selection.ts',
    'src/subject-comm/network-content-feedback.ts',
    'src/relay-service/server.ts',
    'src/relay-service/network-item-store.ts',
  ];
  for (const rel of files) {
    const src = await fs.readFile(path.join(process.cwd(), rel), 'utf8');
    for (const banned of [
      'RecommendationService',
      'CentralRanking',
      'UserInterestProfile',
      'ContentRankingScore',
      'PersonalizationServer',
      'AudienceSegment',
      'InterestEmbedding',
      'ManjuCMS',
      'ContentPlatform',
    ]) {
      assert.equal(src.includes(banned), false, `${rel} ${banned}`);
    }
  }
});
