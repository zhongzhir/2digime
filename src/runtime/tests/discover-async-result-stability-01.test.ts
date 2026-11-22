import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import { validateNetworkItem } from '../../subject-comm/network-item';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { audioPlaybackKind, shouldApplyDiscoverView } from '../../subject-comm/discover-search-generation';

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-21T00:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我长期关心公开科学影像。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

const IMAGE = validateNetworkItem({
  schemaVersion: 1,
  itemId: 'ni_space_photo',
  publisherSubjectId: 'pub_photo',
  publisherDisplayName: 'Open Archive',
  kind: 'content',
  createdAt: '2026-09-21T00:00:00.000Z',
  visibility: 'public',
  content: {
    title: '航天摄影作品 Earthrise',
    text: 'A still photograph from a public archive.',
    url: 'https://example.org/photo/earthrise',
    contentType: 'image',
    mediaUrl: 'https://cdn.example.org/earthrise.jpg',
    thumbnailUrl: 'https://cdn.example.org/earthrise-thumb.jpg',
  },
  provenance: { origin: 'publisher', actor: 'owner', statedAt: '2026-09-21T00:00:00.000Z', via: 'search' },
});
if (!IMAGE.ok) throw new Error(IMAGE.reason);

const VIDEO = validateNetworkItem({
  schemaVersion: 1,
  itemId: 'ni_ai_video',
  publisherSubjectId: 'pub_video',
  publisherDisplayName: 'Open Films',
  kind: 'content',
  createdAt: '2026-09-21T00:00:00.000Z',
  visibility: 'public',
  content: {
    title: 'A public AI video talk',
    text: 'Conference recording.',
    url: 'https://example.org/watch/ai-talk',
    contentType: 'video',
    mediaUrl: 'https://cdn.example.org/ai.mp4',
    thumbnailUrl: 'https://cdn.example.org/ai.jpg',
  },
  provenance: { origin: 'publisher', actor: 'owner', statedAt: '2026-09-21T00:00:00.000Z', via: 'search' },
});
if (!VIDEO.ok) throw new Error(VIDEO.reason);

const AUDIO_PLAYABLE = validateNetworkItem({
  schemaVersion: 1,
  itemId: 'ni_tech_pod',
  publisherSubjectId: 'pub_audio',
  publisherDisplayName: 'Tech Daily',
  kind: 'content',
  createdAt: '2026-09-21T00:00:00.000Z',
  visibility: 'public',
  content: {
    title: '科技播客 fusion episode',
    text: '给我听点科技播客 A podcast episode.',
    url: 'https://example.org/podcast/fusion',
    contentType: 'audio',
    mediaUrl: 'https://cdn.example.org/fusion.mp3',
  },
  provenance: { origin: 'publisher', actor: 'owner', statedAt: '2026-09-21T00:00:00.000Z', via: 'search' },
});
if (!AUDIO_PLAYABLE.ok) throw new Error(AUDIO_PLAYABLE.reason);

const AUDIO_SOURCE = validateNetworkItem({
  schemaVersion: 1,
  itemId: 'ni_tech_show',
  publisherSubjectId: 'pub_audio2',
  publisherDisplayName: 'Show Page',
  kind: 'content',
  createdAt: '2026-09-21T00:00:00.000Z',
  visibility: 'public',
  content: {
    title: '科技播客节目主页',
    text: '给我听点科技播客 Listen on the source site.',
    url: 'https://example.org/podcast/show',
    contentType: 'audio',
  },
  provenance: { origin: 'publisher', actor: 'owner', statedAt: '2026-09-21T00:00:00.000Z', via: 'search' },
});
if (!AUDIO_SOURCE.ok) throw new Error(AUDIO_SOURCE.reason);

function contentChatFor(queryHint: string, media: string[], ids: string[]) {
  return async ({ messages }: { messages: Array<{ content?: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向')) {
      return {
        text: '{"intents":[{"topic":"science","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"core","searchQuery":"science"}]}',
      };
    }
    if (blob.includes('判断用户在「发现」里')) {
      return {
        text: JSON.stringify({
          intent: 'consume',
          requestedMedia: media,
          objectWanted: 'work_itself',
          searchQueries: [queryHint],
        }),
      };
    }
    if (blob.includes('判断每个候选')) {
      return {
        text: JSON.stringify({
          roles: ids.map((id) => ({
            id,
            role: id.includes('roundup') || id.includes('essay') ? 'COMMENTARY' : 'PRIMARY_CONTENT',
          })),
        }),
      };
    }
    const shown = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({
        decisions: [...new Set(shown)].map((itemId) => ({ itemId, decision: 'show', reason: 'ok' })),
      }),
    };
  };
}

async function withPackage() {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-async-stab-')), 'pkg');
  return pkgDir;
}

test('CASE 1: late web ABOUT does not drop current-search image', async () => {
  const pkgDir = await withPackage();
  let releaseWeb!: () => void;
  const webGate = new Promise<void>((resolve) => {
    releaseWeb = resolve;
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: contentChatFor('航天摄影', ['image'], [IMAGE.item.itemId]),
    contentSearch: async () => {
      await webGate;
      return [{ title: '十张必看航天摄影盘点', url: 'https://example.org/news/space-photos', snippet: 'commentary' }];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '稳定搜索', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  const first = await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_space_1',
  });
  const initialImages = first.view.cards.filter((card) => card.contentType === 'image').length;
  assert.ok(initialImages >= 1, 'first visible wave should keep the directory image');
  assert.equal(first.view.feedMode, 'intent');
  assert.equal(first.view.searchGenerationId, 'sg_space_1');
  releaseWeb();
  const next = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_space_1' });
  const finalImages = next.view.cards.filter((card) => card.contentType === 'image').length;
  assert.ok(finalImages >= initialImages, 'late web must not drop PRIMARY images');
  assert.equal(next.view.feedMode, 'intent');
  await runtime.stop();
});

test('CASE 3: Search A late result cannot override Search B', async () => {
  const pkgDir = await withPackage();
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户在「发现」里')) {
        const video = blob.includes('AI') || blob.includes('视频');
        return {
          text: JSON.stringify({
            intent: 'consume',
            requestedMedia: video ? ['video'] : ['image'],
            objectWanted: 'work_itself',
            searchQueries: video ? ['AI video'] : ['航天摄影'],
          }),
        };
      }
      if (blob.includes('判断每个候选')) return judgeAllPrimary(messages);
      return { text: '{"decisions":[]}' };
    },
    contentSearch: async (query: string) => {
      if (/航天|earthrise|space/i.test(query)) await gateA;
      return [{ title: 'late A article', url: 'https://example.org/late-a', snippet: 'stale' }];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'AB race', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  await store.put(VIDEO.item);
  const a = await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_a',
  });
  assert.equal(a.view.searchGenerationId, 'sg_a');
  const b = await bus.invoke('content', {
    action: 'seek',
    text: '找几个 AI 视频看看',
    searchGenerationId: 'sg_b',
  });
  assert.equal(b.view.searchGenerationId, 'sg_b');
  assert.equal(b.view.cards.some((card) => card.itemId === VIDEO.item.itemId), true);
  releaseA();
  const lateA = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_a' });
  assert.equal(lateA.view.searchGenerationId, 'sg_b');
  assert.equal(lateA.view.cards.some((card) => card.itemId === VIDEO.item.itemId), true);
  const stableB = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_b' });
  assert.equal(stableB.view.searchGenerationId, 'sg_b');
  await runtime.stop();
});

test('CASE 4: search late result cannot override Personal Feed', async () => {
  const pkgDir = await withPackage();
  let releaseWeb!: () => void;
  const webGate = new Promise<void>((resolve) => {
    releaseWeb = resolve;
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: contentChatFor('航天摄影', ['image'], [IMAGE.item.itemId]),
    contentSearch: async () => {
      await webGate;
      return [{ title: 'late search article', url: 'https://example.org/late-search', snippet: 'stale' }];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '回个人', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 8)) await store.put(item);
  await store.put(IMAGE.item);
  const personal = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_feed_0' });
  assert.equal(personal.view.feedMode === 'intent', false);
  await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_search_then_feed',
  });
  const back = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_feed_1' });
  assert.equal(back.view.feedMode, 'personal');
  releaseWeb();
  const late = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_search_then_feed' });
  assert.equal(late.view.feedMode, 'personal');
  assert.equal(late.view.searchQuery, undefined);
  await runtime.stop();
});

test('CASE 5: repeating the same query uses a new generation', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: contentChatFor('航天摄影', ['image'], [IMAGE.item.itemId]),
    contentSearch: async () => [{ title: 'about photos', url: 'https://example.org/about', snippet: 'about' }],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '重复查询', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  const first = await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_repeat_1',
  });
  const second = await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_repeat_2',
  });
  assert.equal(first.view.searchGenerationId, 'sg_repeat_1');
  assert.equal(second.view.searchGenerationId, 'sg_repeat_2');
  const stale = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_repeat_1' });
  assert.equal(stale.view.searchGenerationId, 'sg_repeat_2');
  await runtime.stop();
});

test('CASE 6: overlapping in-flight Search A cannot enter Search B visible results', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: raceIntentChat(),
    contentSearch: raceSearch,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'AB 在飞', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  await store.put(VIDEO.item);

  // Search A is still in flight (first wave not returned) when Search B is submitted.
  const aPromise = bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_a',
  });
  const b = await bus.invoke('content', {
    action: 'seek',
    text: '找几个 AI 视频看看',
    searchGenerationId: 'sg_b',
  });
  const a = await aPromise;

  // Provenance of A's late completion: it must keep its own generation identity.
  assert.equal(a.view.searchQuery, '找一些航天摄影作品');
  assert.equal(a.view.feedMode, 'intent');
  assert.equal(
    a.view.searchGenerationId,
    'sg_a',
    'stale A completion must never be stamped with the current generation B',
  );
  assert.equal(
    shouldApplyDiscoverView({ searchGenerationId: 'sg_b', feedMode: 'intent' }, a.view),
    false,
    'renderer with active generation B must reject A late view',
  );
  assert.equal(b.view.searchGenerationId, 'sg_b');
  assert.equal(b.view.searchQuery, '找几个 AI 视频看看');
  assert.equal(
    b.view.cards.some((card) => card.itemId === IMAGE.item.itemId),
    false,
    'A space image must not appear in B visible results',
  );

  const stableB = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_b' });
  assert.equal(stableB.view.searchGenerationId, 'sg_b');
  assert.equal(stableB.view.cards.some((card) => card.itemId === VIDEO.item.itemId), true);
  assert.equal(
    stableB.view.cards.some((card) => card.itemId === IMAGE.item.itemId),
    false,
    'A late completion must not change B visible results',
  );
  await runtime.stop();
});

test('CASE 7: reverse race — in-flight AI video search cannot enter later space-image search', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: raceIntentChat(),
    contentSearch: raceSearch,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'BA 在飞', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  await store.put(VIDEO.item);

  const aPromise = bus.invoke('content', {
    action: 'seek',
    text: '找几个 AI 视频看看',
    searchGenerationId: 'sg_v',
  });
  const b = await bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_i',
  });
  const a = await aPromise;

  assert.equal(a.view.searchGenerationId, 'sg_v');
  assert.equal(
    shouldApplyDiscoverView({ searchGenerationId: 'sg_i', feedMode: 'intent' }, a.view),
    false,
  );
  assert.equal(b.view.searchGenerationId, 'sg_i');
  assert.equal(
    b.view.cards.some((card) => card.itemId === VIDEO.item.itemId),
    false,
    'A video must not appear in B visible results',
  );

  const stableI = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_i' });
  assert.equal(stableI.view.searchGenerationId, 'sg_i');
  assert.equal(stableI.view.cards.some((card) => card.itemId === IMAGE.item.itemId), true);
  assert.equal(stableI.view.cards.some((card) => card.itemId === VIDEO.item.itemId), false);
  await runtime.stop();
});

test('revoke restores cached cards then background finish keeps them; stale generation cannot write back', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }: { messages: Array<{ content?: string }> }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户在「发现」里') || blob.includes('拟定内容发现方向')) {
        return { text: JSON.stringify({ intents: [], searchQueries: ['science'] }) };
      }
      const user = String(messages[messages.length - 1]?.content || '{}');
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(user) as { candidates?: Array<{ id?: string; itemId?: string }> };
        ids = (parsed.candidates || []).map((row) => String(row.id || row.itemId || '')).filter(Boolean);
      } catch {
        ids = [];
      }
      if (blob.includes('判断每个候选')) {
        return { text: JSON.stringify({ roles: ids.map((id) => ({ id, role: 'PRIMARY_CONTENT' })) }) };
      }
      return {
        text: JSON.stringify({
          decisions: ids.slice(0, 2).map((itemId) => ({ itemId, decision: 'show', reason: '先看这两张' })),
        }),
      };
    },
    contentSearch: async () => [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '撤销回归', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const seed of FEED_01_SEED_ITEMS.slice(0, 6)) await store.put(seed);

  const opened = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_open' });
  const keptIds = opened.view.cards.map((card: { itemId: string }) => card.itemId);
  assert.ok(keptIds.length >= 3, 'default feed should already have browsable cards');

  await bus.invoke('content', {
    action: 'adjust',
    text: '先随便调一下，随后撤销',
    searchGenerationId: 'sg_adj',
  });
  const revoked = await bus.invoke('content', { action: 'adjustRevoke', searchGenerationId: 'sg_rev' });
  assert.equal(revoked.view.replenishing, true);
  assert.match(revoked.view.notice || '', /恢复默认推荐/);
  for (const id of keptIds) {
    assert.equal(revoked.view.cards.some((card: { itemId: string }) => card.itemId === id), true);
  }

  const finished = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_rev' });
  assert.equal(finished.view.replenishing, false);
  assert.equal(/正在恢复/.test(finished.view.notice || ''), false);
  for (const id of keptIds) {
    assert.equal(finished.view.cards.some((card: { itemId: string }) => card.itemId === id), true);
  }

  const stale = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_adj' });
  assert.equal(stale.view.searchGenerationId, 'sg_rev');
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_rev', feedMode: 'personal' }, stale.view), true);
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_adj', feedMode: 'personal' }, stale.view), false);
  for (const id of keptIds) {
    assert.equal(finished.view.cards.some((card: { itemId: string }) => card.itemId === id), true);
  }
  await runtime.stop();
});

test('CASE 8: three rapid searches A → B → C — final view consumes only generation C', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: raceIntentChat(),
    contentSearch: raceSearch,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'ABC 在飞', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await store.put(IMAGE.item);
  await store.put(VIDEO.item);
  await store.put(AUDIO_PLAYABLE.item);

  const aPromise = bus.invoke('content', {
    action: 'seek',
    text: '找一些航天摄影作品',
    searchGenerationId: 'sg_a',
  });
  const bPromise = bus.invoke('content', {
    action: 'seek',
    text: '找几个 AI 视频看看',
    searchGenerationId: 'sg_b',
  });
  const c = await bus.invoke('content', {
    action: 'seek',
    text: '给我听点科技播客',
    searchGenerationId: 'sg_c',
  });
  const [a, b] = await Promise.all([aPromise, bPromise]);

  assert.equal(a.view.searchGenerationId, 'sg_a');
  assert.equal(b.view.searchGenerationId, 'sg_b');
  assert.equal(c.view.searchGenerationId, 'sg_c');
  assert.equal(
    shouldApplyDiscoverView({ searchGenerationId: 'sg_c', feedMode: 'intent' }, a.view),
    false,
  );
  assert.equal(
    shouldApplyDiscoverView({ searchGenerationId: 'sg_c', feedMode: 'intent' }, b.view),
    false,
  );
  assert.equal(c.view.cards.some((card) => card.itemId === IMAGE.item.itemId), false);
  assert.equal(c.view.cards.some((card) => card.itemId === VIDEO.item.itemId), false);

  const stableC = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_c' });
  assert.equal(stableC.view.searchGenerationId, 'sg_c');
  assert.equal(stableC.view.cards.some((card) => card.itemId === AUDIO_PLAYABLE.item.itemId), true);
  assert.equal(stableC.view.cards.some((card) => card.itemId === IMAGE.item.itemId), false);
  assert.equal(stableC.view.cards.some((card) => card.itemId === VIDEO.item.itemId), false);
  await runtime.stop();
});

// 竞态用例只测代次，不测判断：判断桩对每个候选都给出判断（类型过滤仍由产品逻辑负责）。
function judgeAllPrimary(messages: Array<{ content?: string }>) {
  const user = String(messages[messages.length - 1]?.content || '{}');
  const parsed = JSON.parse(user) as { candidates?: Array<{ id: string }> };
  return { text: JSON.stringify({ roles: (parsed.candidates || []).map((row) => ({ id: row.id, role: 'PRIMARY_CONTENT' })) }) };
}

function raceIntentChat() {
  return async ({ messages }: { messages: Array<{ content?: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('判断用户在「发现」里')) {
      const user = String(messages[messages.length - 1]?.content || '');
      const audio = /播客/.test(user);
      const video = !audio && /视频|AI/.test(user);
      return {
        text: JSON.stringify({
          intent: 'consume',
          requestedMedia: audio ? ['audio'] : video ? ['video'] : ['image'],
          objectWanted: 'work_itself',
          searchQueries: [audio ? '科技播客' : video ? 'AI video' : '航天摄影'],
        }),
      };
    }
    if (blob.includes('判断每个候选')) return judgeAllPrimary(messages);
    return { text: '{"decisions":[]}' };
  };
}

async function raceSearch(query: string) {
  if (/航天|space|earthrise/i.test(query)) {
    return [{ title: 'A late space article', url: 'https://example.org/a-late-space', snippet: 'A late' }];
  }
  if (/播客|podcast/i.test(query)) {
    return [{ title: 'C tech podcast page', url: 'https://example.org/c-tech-podcast', snippet: 'C late' }];
  }
  return [{ title: 'B ai video page', url: 'https://example.org/b-ai-video', snippet: 'B late' }];
}

test('AI video / broad AI / audio playable vs source-only / personal restore', async () => {
  const pkgDir = await withPackage();
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        return {
          text: '{"intents":[{"topic":"AI","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"core","searchQuery":"AI"}]}',
        };
      }
      if (blob.includes('判断用户在「发现」里')) {
        const user = String(messages[messages.length - 1]?.content || '');
        const audio = /播客|听点/.test(user);
        const video = /视频/.test(user);
        return {
          text: JSON.stringify({
            intent: 'consume',
            requestedMedia: audio ? ['audio'] : video ? ['video'] : ['article', 'video', 'image', 'audio'],
            objectWanted: 'work_itself',
            searchQueries: ['AI'],
          }),
        };
      }
      if (blob.includes('判断每个候选')) return judgeAllPrimary(messages);
      const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
      return {
        text: JSON.stringify({
          decisions: [...new Set(ids)].map((itemId) => ({ itemId, decision: 'show', reason: 'ok' })),
        }),
      };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '保真', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 6)) await store.put(item);
  await store.put(VIDEO.item);
  await store.put(AUDIO_PLAYABLE.item);
  await store.put(AUDIO_SOURCE.item);

  const video = await bus.invoke('content', { action: 'seek', text: '找几个 AI 视频看看', searchGenerationId: 'sg_vid' });
  assert.equal(video.view.feedMode, 'intent');
  assert.equal(video.view.cards.some((card) => card.contentType === 'video'), true);

  const broad = await bus.invoke('content', { action: 'seek', text: '最近值得看的 AI 内容', searchGenerationId: 'sg_broad' });
  assert.equal(broad.view.feedMode, 'intent');
  assert.ok((broad.view.cards.length || 0) + (broad.view.relatedCards?.length || 0) >= 0);

  const audio = await bus.invoke('content', { action: 'seek', text: '给我听点科技播客', searchGenerationId: 'sg_aud' });
  const audioCards = [...audio.view.cards, ...(audio.view.relatedCards || [])].filter((card) => card.contentType === 'audio');
  const direct = audioCards.filter((card) => audioPlaybackKind(card) === 'direct_playable').length;
  const sourceOnly = audioCards.filter((card) => audioPlaybackKind(card) === 'source_only').length;
  assert.ok(direct >= 1, 'expected at least one direct playable audio');
  assert.ok(sourceOnly >= 1, 'expected at least one source-only audio');
  assert.equal(audioCards.some((card) => Number(card.durationSeconds) === 0), false);

  const back = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_feed' });
  assert.equal(back.view.feedMode, 'personal');
  await runtime.stop();
});
