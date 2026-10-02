import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { seekContent } from '../content-seek';
import type { DiscoverCard, DiscoverView } from '../content-discover';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import {
  audioPlaybackKind,
  createSearchGenerationId,
  durationLabel,
  settleBackgroundSeek,
  hasDirectMediaRepresentation,
  isBrokenImageRepresentation,
  mergeIntentViews,
  mergeSeekCardSets,
  shouldApplyDiscoverView,
} from '../discover-search-generation';
import type { ChatCompleteFn } from '../../subject-core/structured-distill';

const NOW = '2026-09-21T02:00:00.000Z';

function itemOf(input: {
  id: string;
  title: string;
  text: string;
  url: string;
  contentType?: 'article' | 'image' | 'audio' | 'video';
  thumbnailUrl?: string;
  mediaUrl?: string;
}): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: input.id,
    publisherSubjectId: 'pub_' + input.id,
    publisherDisplayName: 'Example Pub',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: input.title,
      text: input.text,
      url: input.url,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

function chatFromScript(script: {
  intent?: Record<string, unknown>;
  roles?: Array<{ id: string; role: string }>;
}): ChatCompleteFn {
  return async ({ messages }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('判断用户在「发现」里')) {
      return { text: JSON.stringify(script.intent || { intent: 'consume', objectWanted: 'work_itself' }) };
    }
    if (blob.includes('判断每个候选')) {
      return { text: JSON.stringify({ roles: script.roles || [] }) };
    }
    return { text: '{}' };
  };
}

function card(partial: {
  itemId: string;
  title: string;
  text?: string;
  reason?: string;
  url?: string | undefined;
  contentType?: string | undefined;
  thumbnailUrl?: string | undefined;
  mediaUrl?: string | undefined;
  embedUrl?: string | undefined;
  objectFidelity?: DiscoverCard['objectFidelity'];
  consumption?: string | undefined;
  durationSeconds?: number | undefined;
}): DiscoverCard {
  const next: DiscoverCard = {
    itemId: partial.itemId,
    title: partial.title,
    text: partial.text || '',
    reason: partial.reason || 'test',
  };
  if (partial.url) next.url = partial.url;
  if (partial.contentType) next.contentType = partial.contentType;
  if (partial.thumbnailUrl) next.thumbnailUrl = partial.thumbnailUrl;
  if (partial.mediaUrl) next.mediaUrl = partial.mediaUrl;
  if (partial.embedUrl) next.embedUrl = partial.embedUrl;
  if (partial.objectFidelity) next.objectFidelity = partial.objectFidelity;
  if (partial.consumption) next.consumption = partial.consumption;
  if (partial.durationSeconds != null) next.durationSeconds = partial.durationSeconds;
  return next;
}

function intentView(partial: Partial<DiscoverView> & Pick<DiscoverView, 'searchGenerationId' | 'cards'>): DiscoverView {
  return {
    headline: '发现',
    lead: '',
    relatedCards: [],
    preferences: [],
    notice: '',
    feedMode: 'intent',
    ...partial,
  };
}

const IMAGE = itemOf({
  id: 'ni_space_photo',
  title: '航天摄影作品：地球出升',
  text: 'A still photograph.',
  url: 'https://example.org/photo/earthrise',
  contentType: 'image',
  mediaUrl: 'https://cdn.example.org/earthrise.jpg',
  thumbnailUrl: 'https://cdn.example.org/earthrise-thumb.jpg',
});
const ABOUT = itemOf({
  id: 'ni_space_roundup',
  title: '航天摄影作品盘点十张',
  text: 'An article about photographs.',
  url: 'https://example.org/news/space-photos',
  contentType: 'article',
});
const VIDEO = itemOf({
  id: 'ni_ai_video',
  title: 'A public AI video talk',
  text: 'Conference recording.',
  url: 'https://example.org/watch/ai',
  contentType: 'video',
  mediaUrl: 'https://cdn.example.org/ai.mp4',
  thumbnailUrl: 'https://cdn.example.org/ai.jpg',
});
const AUDIO_PLAYABLE = itemOf({
  id: 'ni_pod_play',
  title: '科技播客：可直接听',
  text: 'Episode with enclosure.',
  url: 'https://example.org/podcast/playable',
  contentType: 'audio',
  mediaUrl: 'https://cdn.example.org/tech.mp3',
});
const AUDIO_SOURCE = itemOf({
  id: 'ni_pod_src',
  title: '科技播客：请来源收听',
  text: 'Show page only.',
  url: 'https://example.org/podcast/source-only',
  contentType: 'audio',
});

test('stale generation is ignored; same generation merges', () => {
  const gen = createSearchGenerationId();
  assert.match(gen, /^sg_/);
  const current = intentView({
    searchGenerationId: gen,
    cards: [card({ itemId: IMAGE.itemId, title: IMAGE.content.title, contentType: 'image', mediaUrl: IMAGE.content.mediaUrl, objectFidelity: 'PRIMARY_CONTENT' })],
  });
  const stale = intentView({
    searchGenerationId: 'sg_old',
    cards: [card({ itemId: ABOUT.itemId, title: ABOUT.content.title, contentType: 'article' })],
  });
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: gen, feedMode: 'intent' }, stale), false);
  assert.deepEqual(mergeIntentViews(current, stale).cards.map((row) => row.itemId), [IMAGE.itemId]);

  const extra = intentView({
    searchGenerationId: gen,
    cards: [
      card({
        itemId: 'ni_space_photo_2',
        title: '航天摄影：月面',
        contentType: 'image',
        mediaUrl: 'https://cdn.example.org/moon.jpg',
        objectFidelity: 'PRIMARY_CONTENT',
      }),
    ],
  });
  const merged = mergeIntentViews(current, extra);
  assert.equal(merged.cards.length, 2);
  assert.equal(merged.cards.some((row) => row.itemId === IMAGE.itemId), true);
});

test('PRIMARY cannot be downgraded by ABOUT; Directory cannot replace current search', () => {
  const gen = 'sg_now';
  const current = intentView({
    searchGenerationId: gen,
    cards: [
      card({
        itemId: IMAGE.itemId,
        title: IMAGE.content.title,
        url: IMAGE.content.url,
        contentType: 'image',
        thumbnailUrl: IMAGE.content.thumbnailUrl,
        mediaUrl: IMAGE.content.mediaUrl,
        objectFidelity: 'PRIMARY_CONTENT',
      }),
    ],
  });
  const about = intentView({
    searchGenerationId: gen,
    cards: [],
    relatedCards: [
      card({
        itemId: IMAGE.itemId,
        title: IMAGE.content.title,
        url: IMAGE.content.url,
        contentType: 'article',
        objectFidelity: 'ABOUT_CONTENT',
      }),
      card({
        itemId: ABOUT.itemId,
        title: ABOUT.content.title,
        url: ABOUT.content.url,
        contentType: 'article',
        objectFidelity: 'ABOUT_CONTENT',
      }),
    ],
  });
  const merged = mergeIntentViews(current, about);
  assert.equal(merged.cards.some((row) => row.itemId === IMAGE.itemId && row.contentType === 'image'), true);
  assert.equal(hasDirectMediaRepresentation(merged.cards.find((row) => row.itemId === IMAGE.itemId)!), true);
  assert.equal(merged.relatedCards?.some((row) => row.itemId === ABOUT.itemId), true);
  assert.equal(merged.relatedCards?.some((row) => row.itemId === IMAGE.itemId), false);

  const directory = {
    ...current,
    feedMode: 'personal' as const,
    searchGenerationId: 'sg_feed',
    cards: [card({ itemId: 'ni_feed', title: '个人库存文章', contentType: 'article' })],
  };
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: gen, feedMode: 'intent' }, directory), false);
  assert.equal(mergeIntentViews(current, directory).cards[0]?.itemId, IMAGE.itemId);
});

test('CASE 1/2: late web ABOUT keeps images; late images upgrade PRIMARY', async () => {
  const imageSeek = await seekContent({
    query: '找一些航天摄影作品',
    items: [IMAGE],
    skipWeb: true,
    chatComplete: chatFromScript({
      intent: {
        intent: 'consume',
        requestedMedia: ['image'],
        objectWanted: 'work_itself',
        searchQueries: ['航天摄影'],
      },
      roles: [{ id: IMAGE.itemId, role: 'COMMENTARY' }],
    }),
    model: { baseUrl: 'https://example.invalid', model: 'x' },
  });
  assert.equal(imageSeek.cards.some((row) => row.itemId === IMAGE.itemId && row.contentType === 'image'), true);

  const webSeek = await seekContent({
    query: '找一些航天摄影作品',
    items: [ABOUT],
    skipOpenMedia: true,
    searchWeb: async () => [{ title: ABOUT.content.title, url: ABOUT.content.url!, snippet: ABOUT.content.text }],
    chatComplete: chatFromScript({
      intent: {
        intent: 'consume',
        requestedMedia: ['image'],
        objectWanted: 'work_itself',
        searchQueries: ['航天摄影'],
      },
      roles: [{ id: ABOUT.itemId, role: 'COMMENTARY' }],
    }),
    model: { baseUrl: 'https://example.invalid', model: 'x' },
  });
  assert.equal(webSeek.cards.some((row) => row.contentType === 'image'), false);

  const case1 = mergeSeekCardSets(
    { cards: imageSeek.cards, relatedCards: imageSeek.relatedCards },
    { cards: webSeek.cards, relatedCards: webSeek.relatedCards },
  );
  assert.equal(case1.cards.some((row) => row.itemId === IMAGE.itemId && row.contentType === 'image'), true);
  assert.equal(case1.cards.some((row) => row.itemId === ABOUT.itemId), false);

  const case2 = mergeSeekCardSets(
    { cards: webSeek.cards, relatedCards: webSeek.relatedCards },
    { cards: imageSeek.cards, relatedCards: imageSeek.relatedCards },
  );
  assert.equal(case2.cards.some((row) => row.itemId === IMAGE.itemId && row.contentType === 'image'), true);
  assert.equal(case2.relatedCards.some((row) => row.itemId === ABOUT.itemId) || case2.cards.some((row) => row.itemId === ABOUT.itemId), true);
});

test('valid image representation remains image; broken image may be removed', () => {
  const live = card({
    itemId: 'ni_img',
    title: '航天摄影作品',
    contentType: 'image',
    thumbnailUrl: 'https://cdn.example.org/ok.jpg',
    objectFidelity: 'PRIMARY_CONTENT',
  });
  const metaRefresh = card({
    itemId: 'ni_img',
    title: '航天摄影作品',
    url: 'https://example.org/photo/page',
    contentType: 'article',
    objectFidelity: 'ABOUT_CONTENT',
  });
  const kept = mergeSeekCardSets(
    { cards: [live], relatedCards: [] },
    { cards: [], relatedCards: [metaRefresh] },
  );
  assert.equal(kept.cards[0]?.contentType, 'image');
  assert.equal(isBrokenImageRepresentation(kept.cards[0]!), false);

  const broken = card({ itemId: 'ni_broken', title: '丢失的图', contentType: 'image', url: 'https://example.org/gone' });
  assert.equal(isBrokenImageRepresentation(broken), true);
  const removed = mergeSeekCardSets(
    { cards: [broken], relatedCards: [] },
    { cards: [], relatedCards: [] },
  );
  assert.equal(removed.cards.some((row) => row.itemId === 'ni_broken' && isBrokenImageRepresentation(row)), true);
});

test('audio playable vs source-only; no fake 0:00/0:00', () => {
  const playable = card({
    itemId: AUDIO_PLAYABLE.itemId,
    title: AUDIO_PLAYABLE.content.title,
    contentType: 'audio',
    mediaUrl: AUDIO_PLAYABLE.content.mediaUrl,
  });
  const sourceOnly = card({
    itemId: AUDIO_SOURCE.itemId,
    title: AUDIO_SOURCE.content.title,
    contentType: 'audio',
    url: AUDIO_SOURCE.content.url,
  });
  assert.equal(audioPlaybackKind(playable), 'direct_playable');
  assert.equal(audioPlaybackKind(sourceOnly), 'source_only');
  assert.equal(durationLabel(0), undefined);
  assert.equal(durationLabel(-1), undefined);
  assert.equal(durationLabel(undefined), undefined);
  assert.equal(durationLabel(125), '2:05');
});

test('late search cannot override Personal Feed; Search A cannot override Search B', () => {
  const personal: DiscoverView = {
    headline: '发现',
    lead: '',
    cards: [card({ itemId: 'ni_feed', title: '为你发现', contentType: 'article' })],
    preferences: [],
    notice: '',
    feedMode: 'personal',
    searchGenerationId: 'sg_personal',
  };
  const lateA = intentView({
    searchGenerationId: 'sg_a',
    cards: [card({ itemId: IMAGE.itemId, title: IMAGE.content.title, contentType: 'image' })],
  });
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_personal', feedMode: 'personal' }, lateA), false);
  const b = intentView({
    searchGenerationId: 'sg_b',
    cards: [card({ itemId: VIDEO.itemId, title: VIDEO.content.title, contentType: 'video', mediaUrl: VIDEO.content.mediaUrl })],
  });
  assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_b', feedMode: 'intent' }, lateA), false);
  assert.equal(mergeIntentViews(b, lateA).cards[0]?.itemId, VIDEO.itemId);
  assert.equal(personal.feedMode, 'personal');
});

test('an in-flight empty notice is replaced once later cards arrive', () => {
  const gen = 'sg_notice';
  const current = intentView({
    searchGenerationId: gen,
    cards: [],
    notice: '这次没有找到可以直接看的内容。',
  });
  const incoming = intentView({
    searchGenerationId: gen,
    cards: [
      card({
        itemId: IMAGE.itemId,
        title: IMAGE.content.title,
        contentType: 'image',
        mediaUrl: IMAGE.content.mediaUrl,
        objectFidelity: 'PRIMARY_CONTENT',
      }),
    ],
    notice: '',
  });
  const merged = mergeIntentViews(current, incoming);
  assert.equal(merged.cards.length, 1);
  assert.equal(merged.notice, '');
});

test('renderer keeps generation gate, skipRefresh, audio duration guard', async () => {
  const js = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  assert.match(js, /searchGenerationId/);
  assert.match(js, /activeFeedMode === 'intent'/);
  assert.match(js, /mergeClientIntent/);
  assert.match(js, /skipRefresh: true/);
  assert.match(js, /btn-discover-personal/);
  assert.match(js, /Number\.isFinite\(n\) && n > 0/);
  assert.match(js, /audio\.duration <= 0/);
  assert.equal(js.includes('0:00/0:00'), false);
  assert.match(js, /在来源收听/);
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  assert.match(html, /id="content-discover-feed-title"/);
  assert.match(html, /id="btn-discover-cancel"/);
  assert.match(js, /action: 'cancel'/);
});

test('background seek settles on timeout instead of staying pending', async () => {
  let finished = false;
  const late = new Promise<null>((resolve) => {
    setTimeout(() => {
      finished = true;
      resolve(null);
    }, 80);
  });
  const started = Date.now();
  const settled = await settleBackgroundSeek(late, 20);
  assert.equal(settled, null);
  assert.equal(finished, false);
  assert.ok(Date.now() - started < 70);
});
