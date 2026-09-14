import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../content-ingest';
import { discoverForSubject, digitalSelfBytes } from '../content-discover';
import {
  contentPreferencesPath,
  formatPreferenceDirectives,
  listContentPreferences,
  reverseContentPreference,
  upsertContentPreference,
} from '../content-preferences';
import { appendNetworkContentFeedback, createUserContentFeedback } from '../network-content-feedback';
import { selectNetworkItems } from '../personal-selection';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';

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

function selfOf(subjectId: string, text: string): DigitalSelf {
  const now = '2026-09-14T06:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text,
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

async function ingestTwo() {
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-14T06:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });
  return ingested.items;
}

test('open/later/AI do not write preferences; boost writes user_action and next selection consumes it; reverse works', async () => {
  const items = await ingestTwo();
  const fusion = items.find((item) => /fusion/i.test(item.content.title))!;
  const sports = items.find((item) => /sports/i.test(item.content.title))!;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pref-'));
  const self = selfOf('subj_pref', '我几乎只看球赛和体育新闻。');
  await writeDigitalSelf(root, self);
  const before = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  const feedbackFile = path.join(root, 'content', 'network-content-feedback.jsonl');

  const firstStub = async (options: { messages: Array<{ content: string }> }) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.equal(blob.includes('用户明确的内容偏好指令：'), false);
    return {
      text: JSON.stringify({
        decisions: items.map((item) => ({
          itemId: item.itemId,
          decision: item.itemId === sports.itemId ? 'show' : 'ignore',
          reason: item.itemId === sports.itemId ? '和你关心的球赛有关' : '和球赛关系不大',
        })),
      }),
    };
  };
  const first = await discoverForSubject({
    digitalSelf: self,
    items,
    chatComplete: firstStub,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    feedbackFile,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.view.cards.length, 1);
  assert.match(first.view.cards[0]!.title, /Sports/i);
  await appendNetworkContentFeedback(
    feedbackFile,
    createUserContentFeedback({ subjectId: self.subjectId, contentId: sports.itemId, action: 'open' }),
  );
  await appendNetworkContentFeedback(
    feedbackFile,
    createUserContentFeedback({ subjectId: self.subjectId, contentId: sports.itemId, action: 'later' }),
  );
  assert.equal(await fs.access(contentPreferencesPath(root)).then(() => true, () => false), false);
  assert.deepEqual(await listContentPreferences(root), []);

  const boosted = await upsertContentPreference(root, {
    kind: 'boost',
    targetType: 'item',
    target: fusion.itemId,
    text: `更想看到类似「${fusion.content.title}」的内容`,
    now: '2026-09-14T06:05:00.000Z',
  });
  assert.equal(boosted.origin, 'user_action');
  const stored = await listContentPreferences(root);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.origin, 'user_action');
  const directives = formatPreferenceDirectives(stored);

  let sawDirective = false;
  const secondStub = async (options: { messages: Array<{ content: string }> }) => {
    const blob = options.messages.map((m) => m.content).join('\n');
    if (blob.includes('用户明确的内容偏好指令：') && blob.includes(fusion.content.title)) sawDirective = true;
    const honorBoost = blob.includes('更想看到类似');
    return {
      text: JSON.stringify({
        decisions: items.map((item) => ({
          itemId: item.itemId,
          decision: honorBoost && item.itemId === fusion.itemId ? 'show' : item.itemId === sports.itemId ? 'show' : 'ignore',
          reason: honorBoost && item.itemId === fusion.itemId ? '你明确要求加推这类内容' : '按数字之我挑选',
        })),
      }),
    };
  };
  const selected = await selectNetworkItems({
    digitalSelf: self,
    items,
    chatComplete: secondStub,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    preferenceDirectives: directives,
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.equal(sawDirective, true);
  assert.ok(selected.shownItemIds.includes(fusion.itemId));

  const secondDiscover = await discoverForSubject({
    digitalSelf: self,
    items,
    chatComplete: secondStub,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    feedbackFile,
    preferenceDirectives: directives,
    preferences: stored.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
  });
  assert.equal(secondDiscover.ok, true);
  if (!secondDiscover.ok) return;
  assert.ok(secondDiscover.view.cards.some((card) => /Fusion/i.test(card.title)));
  assert.equal(secondDiscover.view.preferences.length, 1);

  const reversed = await reverseContentPreference(root, boosted.id);
  assert.equal(reversed, true);
  assert.deepEqual(await listContentPreferences(root), []);

  const after = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  assert.equal(after, before);

  const feedback = await fs.readFile(feedbackFile, 'utf8');
  assert.match(feedback, /"origin":"ai_decision"/);
  assert.match(feedback, /"origin":"user_action"/);
  assert.match(feedback, /"action":"open"/);
  assert.equal(JSON.parse(await fs.readFile(contentPreferencesPath(root), 'utf8')).directives.length, 0);

  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
  assert.equal(src.includes('content-preferences'), false);
  assert.equal(src.includes('writeDigitalSelf'), false);
  assert.equal(src.includes('network-content-feedback'), false);
});

test('block source is consumed by the next decision and remains reversible', async () => {
  const items = await ingestTwo();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pref-block-'));
  const self = selfOf('subj_block', '我关心科学新闻。');
  await writeDigitalSelf(root, self);
  const publisher = items[0]!.publisherSubjectId;
  await upsertContentPreference(root, {
    kind: 'block',
    targetType: 'source',
    target: publisher,
    text: `不再看来源 ${publisher}`,
  });
  const selected = await selectNetworkItems({
    digitalSelf: self,
    items,
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /不再看来源/);
      const blocked = blob.includes('不再看来源');
      return {
        text: JSON.stringify({
          decisions: items.map((item) => ({
            itemId: item.itemId,
            decision: blocked ? 'ignore' : 'show',
            reason: blocked ? '你明确要求不再看这个来源' : '可以看',
          })),
        }),
      };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    preferenceDirectives: formatPreferenceDirectives(await listContentPreferences(root)),
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.deepEqual(selected.shownItemIds, []);
  const [directive] = await listContentPreferences(root);
  assert.ok(directive);
  await reverseContentPreference(root, directive!.id);
  assert.deepEqual(await listContentPreferences(root), []);
});

test('real BBC item can receive explicit boost without rewriting Digital Self', async (t) => {
  const store = new MemoryNetworkItemStore();
  let ingested;
  try {
    ingested = await ingestSource({
      sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
      store,
      limit: 3,
    });
  } catch {
    t.skip('real feed unavailable');
    return;
  }
  if (!ingested.items.length) {
    t.skip('real feed unavailable');
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pref-bbc-'));
  const self = selfOf('subj_bbc', '我关心国际新闻。');
  await writeDigitalSelf(root, self);
  const before = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  const item = ingested.items[0]!;
  await upsertContentPreference(root, {
    kind: 'boost',
    targetType: 'item',
    target: item.itemId,
    text: `更想看到类似「${item.content.title}」的内容`,
  });
  const selected = await selectNetworkItems({
    digitalSelf: self,
    items: ingested.items,
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /用户明确的内容偏好指令：/);
      assert.match(blob, /更想看到类似/);
      return {
        text: JSON.stringify({
          decisions: ingested.items.map((row) => ({
            itemId: row.itemId,
            decision: row.itemId === item.itemId ? 'show' : 'ignore',
            reason: row.itemId === item.itemId ? '你明确要求加推这类内容' : '这次先不看',
          })),
        }),
      };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    preferenceDirectives: formatPreferenceDirectives(await listContentPreferences(root)),
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.deepEqual(selected.shownItemIds, [item.itemId]);
  const after = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  assert.equal(after, before);
  const evidenceDir = path.join(process.cwd(), 'build', 'evidence', 'content-distribution-01');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'slice-3-real-preference.json'),
    `${JSON.stringify(
      {
        sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
        boostedTitle: item.content.title,
        shownItemIds: selected.shownItemIds,
        digitalSelfUnchanged: true,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});
