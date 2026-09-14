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
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { contentPreferencesPath, listContentPreferences } from '../../subject-comm/content-preferences';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

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

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-14T06:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我几乎只看球赛和体育新闻。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('content command: open does not write preferences; boost is reversible and consumed next round', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-content-pref-rt-'));
  const pkgDir = path.join(root, 'pkg');
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store: new MemoryNetworkItemStore(),
    now: '2026-09-14T06:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });
  const fusion = ingested.items.find((item) => /fusion/i.test(item.content.title))!;
  const sports = ingested.items.find((item) => /sports/i.test(item.content.title))!;

  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    contentChat: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      const honorBoost = blob.includes('更想看到类似');
      return {
        text: JSON.stringify({
          decisions: ingested.items.map((item) => ({
            itemId: item.itemId,
            decision: honorBoost && item.itemId === fusion.itemId ? 'show' : item.itemId === sports.itemId ? 'show' : 'ignore',
            reason: honorBoost && item.itemId === fusion.itemId ? '你明确要求加推这类内容' : '按数字之我挑选',
          })),
        }),
      };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '偏好主体',
    targetDir: pkgDir,
  });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const local = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of ingested.items) await local.put(item);

  const opened = await bus.invoke('content', { action: 'open', itemId: sports.itemId });
  assert.equal(opened.view.headline, '发现');
  assert.equal(opened.view.cards.some((card) => /Sports/i.test(card.title)), true);
  assert.equal(await fs.access(contentPreferencesPath(pkgDir)).then(() => true, () => false), false);

  const boosted = await bus.invoke('content', { action: 'boost', itemId: fusion.itemId });
  const prefs = await listContentPreferences(pkgDir);
  assert.equal(prefs.length, 1);
  assert.equal(prefs[0]!.origin, 'user_action');
  assert.equal(prefs[0]!.kind, 'boost');
  assert.equal(boosted.view.preferences.length, 1);
  assert.equal(boosted.view.cards.some((card) => /Fusion/i.test(card.title)), true);

  const reversed = await bus.invoke('content', { action: 'reverse', directiveId: prefs[0]!.id });
  assert.deepEqual(await listContentPreferences(pkgDir), []);
  assert.equal(reversed.view.preferences.length, 0);
  assert.equal(reversed.view.cards.some((card) => /Fusion/i.test(card.title)), false);

  await runtime.stop();
});
