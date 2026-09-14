import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { ingestSource } from '../content-ingest';
import { discoverForSubject, digitalSelfBytes } from '../content-discover';
import { forbiddenPersonalizationKeys } from '../network-item';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { chatComplete } from '../../infrastructure/model-http';
import { resolveModelEnvAsync } from '../../infrastructure/env-secrets';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion</link>
      <description>A lab published new confinement results.</description>
    </item>
    <item>
      <title>Sports roundup</title>
      <link>https://example.org/sports</link>
      <description>Scores and fixtures.</description>
    </item>
  </channel>
</rss>`;

function selfOf(
  subjectId: string,
  lines: Array<{ text: string; facet: DigitalSelf['understandings'][number]['facet'] }>,
): DigitalSelf {
  const now = '2026-09-14T04:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: lines.map((line, index) => ({
      id: `u_${index + 1}`,
      text: line.text,
      facet: line.facet,
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
      updatedAt: now,
    })),
  };
}

async function listenRelay(): Promise<{ server: Server; relayUrl: string; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-relay-'));
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

test('Discover: identical relay pool, recipient-side SHOW, AI decision does not rewrite Digital Self', async () => {
  const { server, relayUrl } = await listenRelay();
  try {
    const ingestStore = new MemoryNetworkItemStore();
    const ingested = await ingestSource({
      sourceUrl: 'https://example.org/feed.xml',
      store: ingestStore,
      now: '2026-09-14T04:00:00.000Z',
      fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
    });
    assert.equal(ingested.items.length, 2);
    const publisher = new RelayClient(relayUrl);
    for (const item of ingested.items) {
      await publisher.publishNetworkItem(item);
    }
    const listedA = await new RelayClient(relayUrl).listNetworkItems({ kind: 'content' });
    const listedB = await new RelayClient(relayUrl).listNetworkItems({ kind: 'content' });
    assert.deepEqual(
      listedA.items.map((item) => item.itemId).sort(),
      listedB.items.map((item) => item.itemId).sort(),
    );
    const rejected = await fetch(`${relayUrl}/v1/network-items?preference=secret`);
    assert.equal(rejected.status, 400);

    const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-a-'));
    const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-b-'));
    const selfA = selfOf('subj_a', [{ text: '我长期关注核聚变与能源研究。', facet: 'goals' }]);
    const selfB = selfOf('subj_b', [{ text: '我几乎只看球赛和体育新闻。', facet: 'goals' }]);
    await writeDigitalSelf(rootA, selfA);
    await writeDigitalSelf(rootB, selfB);
    const hashA = createHash('sha256').update((await digitalSelfBytes(rootA))!).digest('hex');
    const hashB = createHash('sha256').update((await digitalSelfBytes(rootB))!).digest('hex');

    const stub = async (options: { messages: Array<{ content: string }> }) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      const energy = /核聚变|能源/.test(blob);
      const sports = /球赛|体育/.test(blob);
      const decisions = ingested.items.map((item) => {
        const fusion = /fusion/i.test(item.content.title);
        const show = (energy && fusion) || (sports && !fusion);
        return {
          itemId: item.itemId,
          decision: show ? 'show' : 'ignore',
          reason: show ? '和你现在关心的事有关' : '和你现在关心的事关系不大',
        };
      });
      return { text: JSON.stringify({ decisions }) };
    };

    const a = await discoverForSubject({
      digitalSelf: selfA,
      items: listedA.items,
      chatComplete: stub,
      model: { baseUrl: 'http://127.0.0.1', model: 'test' },
      feedbackFile: path.join(rootA, 'content', 'network-content-feedback.jsonl'),
    });
    const b = await discoverForSubject({
      digitalSelf: selfB,
      items: listedB.items,
      chatComplete: stub,
      model: { baseUrl: 'http://127.0.0.1', model: 'test' },
      feedbackFile: path.join(rootB, 'content', 'network-content-feedback.jsonl'),
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.view.cards.length, 1);
    assert.match(a.view.cards[0]!.title, /Fusion/i);
    assert.equal(b.view.cards.length, 1);
    assert.match(b.view.cards[0]!.title, /Sports/i);
    assert.match(a.view.cards[0]!.reason, /关心/);
    assert.equal(directorySafe(a.view.cards[0]!), true);

    const hashAAfter = createHash('sha256').update((await digitalSelfBytes(rootA))!).digest('hex');
    const hashBAfter = createHash('sha256').update((await digitalSelfBytes(rootB))!).digest('hex');
    assert.equal(hashAAfter, hashA);
    assert.equal(hashBAfter, hashB);

    const feedbackA = await fs.readFile(path.join(rootA, 'content', 'network-content-feedback.jsonl'), 'utf8');
    assert.match(feedbackA, /"origin":"ai_decision"/);
    assert.equal(feedbackA.includes('user_action'), false);
    const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
    assert.equal(src.includes('network-content-feedback'), false);
    assert.equal(src.includes('writeDigitalSelf'), false);
  } finally {
    server.close();
  }
});

test('Discover with real model keeps Digital Self unchanged', async (t) => {
  const env = await resolveModelEnvAsync();
  const apiKey = (
    process.env.DIGITALME_MODEL_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    env.runtime?.apiKey ||
    ''
  ).trim();
  if (!env.configured || !apiKey) {
    t.skip('no model credential');
    return;
  }
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
    store,
    limit: 4,
  });
  if (!ingested.items.length) {
    t.skip('real feed unavailable');
    return;
  }
  const { server, relayUrl } = await listenRelay();
  try {
    const publisher = new RelayClient(relayUrl);
    for (const item of ingested.items) await publisher.publishNetworkItem(item);
    const listed = await new RelayClient(relayUrl).listNetworkItems({ kind: 'content' });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-real-'));
    const self = selfOf('subj_real', [{ text: '我关心国际新闻、科学与公共事务。', facet: 'goals' }]);
    await writeDigitalSelf(root, self);
    const before = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
    const result = await discoverForSubject({
      digitalSelf: self,
      items: listed.items,
      chatComplete,
      model: { baseUrl: env.baseUrl, model: env.model, apiKey },
      feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    });
    if (!result.ok) {
      t.skip(`model unavailable: ${result.detail}`);
      return;
    }
    const after = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
    assert.equal(after, before);
    const feedback = await fs.readFile(path.join(root, 'content', 'network-content-feedback.jsonl'), 'utf8');
    assert.match(feedback, /"origin":"ai_decision"/);
    assert.equal(feedback.includes('"origin":"user_action"'), false);
    for (const card of result.view.cards) {
      assert.ok(card.reason);
      assert.equal(directorySafe(card), true);
    }
    const evidenceDir = path.join(process.cwd(), 'build', 'evidence', 'content-distribution-01');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(
      path.join(evidenceDir, 'slice-2-real-discover.json'),
      `${JSON.stringify(
        {
          model: env.model,
          itemCount: listed.items.length,
          shown: result.view.cards.map((card) => ({ title: card.title, reason: card.reason })),
          notice: result.view.notice,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } finally {
    server.close();
  }
});

function directorySafe(card: { title: string; text: string; url?: string }): boolean {
  return forbiddenPersonalizationKeys(card as unknown as Record<string, unknown>).length === 0;
}
