import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../../subject-comm/content-ingest';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion</link>
      <description>A lab published new confinement results.</description>
    </item>
  </channel>
</rss>`;

test('Talk query hits directory; seek keeps provenance and can add web sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-content-seek-rt-'));
  const pkgDir = path.join(root, 'pkg');
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store: new MemoryNetworkItemStore(),
    now: '2026-09-14T07:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });
  let talkSawSource = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentSearch: async () => [
      { title: 'IAEA fusion notes', url: 'https://www.iaea.org/topics/fusion', snippet: 'Public fusion overview.' },
    ],
    talkChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('https://example.org/fusion')) talkSawSource = true;
      return { text: '目录里有 Fusion progress this week，来源 https://example.org/fusion' };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '检索主体',
    targetDir: pkgDir,
  });
  const local = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of ingested.items) await local.put(item);

  const talked = await bus.invoke('talk', { text: '帮我找 fusion 进展' });
  assert.equal(talkSawSource, true);
  assert.match(talked.view.turns.map((turn) => turn.text).join('\n'), /example\.org\/fusion/);

  const sought = await bus.invoke('content', { action: 'seek', text: '帮我找 fusion 进展' });
  assert.equal(sought.view.cards.some((card) => card.url === 'https://example.org/fusion' && card.source === 'directory'), true);
  assert.equal(sought.view.cards.some((card) => card.url === 'https://www.iaea.org/topics/fusion' && card.source === 'web'), true);
  await runtime.stop();
});
