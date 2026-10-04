import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { validateNetworkItem, type NetworkItem, type NetworkItemDiscoveryVia } from '../network-item';
import { ensurePersonalFeed } from '../personal-feed';
import { OPEN_SOURCE_CATALOG } from '../open-source-catalog';
import { networkItemFromOpenHit } from '../content-source-capabilities';
import {
  contentPreferencesPath,
  formatPreferenceDirectives,
  listContentPreferences,
  upsertContentPreference,
} from '../content-preferences';
import { appendNetworkContentFeedback, createUserContentFeedback } from '../network-content-feedback';
import { saveLaterItem, listLaterItems } from '../later-items';

const NOW = '2026-10-04T01:00:00.000Z';

function selfOf(subjectId: string): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '我关心公开科学、影像和节目。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
}

function itemOf(input: {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publisherId: string;
  contentType?: 'article' | 'image' | 'audio' | 'video';
  via?: NetworkItemDiscoveryVia;
  mediaUrl?: string;
}): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: input.id,
    publisherSubjectId: input.publisherId,
    publisherDisplayName: input.publisher,
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: input.title,
      text: `${input.title}正文`,
      url: input.url,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: input.via || 'feed' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

function showAllChat() {
  return async ({ messages }: { messages: Array<{ content: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向')) {
      return {
        text: JSON.stringify({
          intents: [
            {
              topic: 'open science',
              contentTypes: ['article', 'image'],
              searchQuery: 'open science',
              explorationMode: 'core',
            },
          ],
        }),
      };
    }
    const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({
        decisions: [...new Set(ids)].map((itemId) => ({
          itemId,
          decision: 'show',
          reason: '已经取到的可用内容',
        })),
      }),
    };
  };
}

test('catalog covers news tech culture film audio without foreign cores or type quotas', async () => {
  const ids = OPEN_SOURCE_CATALOG.map((row) => row.id);
  assert.equal(ids.includes('chinanews-scroll'), true);
  assert.equal(ids.includes('sspai-feed'), true);
  assert.equal(ids.includes('gcores-feed'), true);
  assert.equal(ids.includes('douban-movie-review'), true);
  assert.equal(ids.includes('itunes-top-podcasts'), true);
  assert.equal(
    OPEN_SOURCE_CATALOG.some((row) => /bbc|guardian|npr|aljazeera|epoch|people\.com\.cn/i.test(row.url)),
    false,
  );
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-feed.ts'), 'utf8');
  assert.equal(/MAX_ARTICLE|articleRatio|typeQuota|articles:\s*3/.test(src), false);
});

test('classic catalog media are not dropped as stale news', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-classic-media-'));
  const news = itemOf({
    id: 'ni_news_recent',
    title: '今日科技一则',
    url: 'https://www.ithome.com/0/today.htm',
    publisher: 'IT之家',
    publisherId: 'pub_ithome',
    contentType: 'article',
    via: 'feed',
  });
  const classic = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_classic_photo',
    publisherSubjectId: 'pub_commons',
    publisherDisplayName: 'commons.wikimedia.org',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: '卡西尼拍摄的木星',
      text: '公开影像作品',
      url: 'https://commons.wikimedia.org/wiki/File:Jupiter.jpg',
      contentType: 'image',
      mediaUrl: 'https://upload.wikimedia.org/wikipedia/commons/j.jpg',
      publishedAt: '2000-12-29T00:00:00.000Z',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!classic.ok) throw new Error(classic.reason);
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_classic'),
    items: [news, classic.item],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const titles = result.view.cards.map((card) => card.title);
  assert.equal(titles.includes('今日科技一则'), true);
  assert.equal(titles.includes('卡西尼拍摄的木星'), true);
});

test('open catalog media stay in the default pool when RSS already exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-catalog-via-'));
  const rss = itemOf({
    id: 'ni_rss',
    title: '科技新闻一则',
    url: 'https://www.ithome.com/0/1.htm',
    publisher: 'IT之家',
    publisherId: 'pub_ithome',
    contentType: 'article',
    via: 'feed',
  });
  const photo = itemOf({
    id: 'ni_photo',
    title: '公开影像作品',
    url: 'https://commons.wikimedia.org/wiki/File:Saturn.jpg',
    publisher: 'commons.wikimedia.org',
    publisherId: 'pub_commons',
    contentType: 'image',
    via: 'feed',
    mediaUrl: 'https://upload.wikimedia.org/wikipedia/commons/s.jpg',
  });
  const leftover = itemOf({
    id: 'ni_seek',
    title: '临时搜索残留',
    url: 'https://example.org/jupiter-seek',
    publisher: '搜索',
    publisherId: 'pub_seek',
    contentType: 'article',
    via: 'search',
  });
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_mix'),
    items: [rss, photo, leftover],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const titles = result.view.cards.map((card) => card.title);
  assert.equal(titles.includes('科技新闻一则'), true);
  assert.equal(titles.includes('公开影像作品'), true);
  assert.equal(titles.includes('临时搜索残留'), false);
  const types = new Set(result.view.cards.map((card) => card.contentType || 'article'));
  assert.equal(types.has('article'), true);
  assert.equal(types.has('image'), true);
});

test('user search open-hit stays search; default catalog open-hit is feed', () => {
  const hit = {
    title: '公开播客',
    url: 'https://podcasts.apple.com/cn/podcast/id1',
    contentType: 'audio' as const,
    capability: 'itunes-top-podcasts',
    snippet: '节目',
  };
  const sought = networkItemFromOpenHit(hit, NOW);
  const catalog = networkItemFromOpenHit(hit, NOW, 'feed');
  assert.equal(sought?.provenance?.via, 'search');
  assert.equal(catalog?.provenance?.via, 'feed');
});

test('one-off seek does not become a default-feed standing direction', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-seek-default-'));
  const article = itemOf({
    id: 'ni_a',
    title: '目录文章',
    url: 'https://www.ithome.com/0/2.htm',
    publisher: 'IT之家',
    publisherId: 'pub_ithome',
  });
  let intentBlob = '';
  let selectBlob = '';
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_seek'),
    items: [article],
    preferences: [],
    recentEvents: [{ type: 'seek_topic', topic: '木星大红斑', at: NOW }],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        intentBlob = blob;
        return {
          text: JSON.stringify({
            intents: [
              {
                topic: 'open science',
                contentTypes: ['article'],
                searchQuery: 'open science',
                explorationMode: 'core',
              },
            ],
          }),
        };
      }
      selectBlob = blob;
      return {
        text: JSON.stringify({
          decisions: [{ itemId: article.itemId, decision: 'show', reason: '已经取到' }],
        }),
      };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => [],
    mode: 'reset',
    now: NOW,
  });
  assert.ok(result.view.cards.length >= 1);
  assert.equal(intentBlob.includes('木星大红斑'), false);
  assert.match(selectBlob, /一次性检索/);
  assert.match(selectBlob, /木星大红斑/);
});

test('open and later persist as log/list only; boost reduce block persist as preferences', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fb-matrix-'));
  const keep = itemOf({
    id: 'ni_keep',
    title: '可继续看的科技',
    url: 'https://www.ithome.com/0/keep.htm',
    publisher: 'IT之家',
    publisherId: 'pub_ithome',
  });
  const reduce = itemOf({
    id: 'ni_reduce',
    title: '同一主题里不喜欢的一条',
    url: 'https://www.ithome.com/0/reduce.htm',
    publisher: 'IT之家',
    publisherId: 'pub_ithome',
  });
  const blocked = itemOf({
    id: 'ni_block',
    title: '被屏蔽来源的一条',
    url: 'https://www.solidot.org/story?sid=1',
    publisher: 'Solidot',
    publisherId: 'pub_solidot',
  });
  const similar = itemOf({
    id: 'ni_similar',
    title: '相近的新科技条目',
    url: 'https://sspai.com/post/1',
    publisher: '少数派',
    publisherId: 'pub_sspai',
  });
  const feedbackFile = path.join(root, 'content', 'network-content-feedback.jsonl');
  await appendNetworkContentFeedback(
    feedbackFile,
    createUserContentFeedback({ subjectId: 'subj_fb', contentId: keep.itemId, action: 'open' }),
  );
  await saveLaterItem(root, {
    itemId: keep.itemId,
    url: String(keep.content.url || ''),
    title: keep.content.title,
    text: String(keep.content.text || ''),
    publisher: String(keep.publisherDisplayName || ''),
    savedAt: NOW,
  });
  assert.equal(await fs.access(contentPreferencesPath(root)).then(() => true, () => false), false);
  assert.equal((await listLaterItems(root)).length, 1);

  await upsertContentPreference(root, {
    kind: 'boost',
    targetType: 'item',
    target: keep.itemId,
    text: `多推荐和「${keep.content.title}」相近的内容，但不要只重复这一条。`,
    now: NOW,
  });
  await upsertContentPreference(root, {
    kind: 'reduce',
    targetType: 'item',
    target: reduce.itemId,
    text: `不喜欢「${reduce.content.title}」这一条。结合语境理解，不要因此封禁整个主题或来源。`,
    now: NOW,
  });
  await upsertContentPreference(root, {
    kind: 'block',
    targetType: 'source',
    target: blocked.publisherSubjectId,
    text: `不再看来源 ${blocked.publisherDisplayName}`,
    now: NOW,
  });
  const prefs = await listContentPreferences(root);
  assert.equal(prefs.some((row) => row.kind === 'boost'), true);
  assert.equal(prefs.some((row) => row.kind === 'reduce'), true);
  assert.equal(prefs.some((row) => row.kind === 'block'), true);
  const directives = formatPreferenceDirectives(prefs);

  const first = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_fb'),
    items: [keep, reduce, blocked, similar],
    preferences: prefs.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
    preferenceDirectives: directives,
    preferenceRows: prefs,
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const titles = first.view.cards.map((card) => card.title);
  assert.equal(titles.includes('被屏蔽来源的一条'), false);
  assert.equal(titles.includes('同一主题里不喜欢的一条'), true);
  assert.equal(titles.includes('相近的新科技条目'), true);
  assert.ok(titles.indexOf('相近的新科技条目') < titles.indexOf('可继续看的科技'));
  assert.ok(titles.indexOf('同一主题里不喜欢的一条') >= titles.indexOf('相近的新科技条目'));
  assert.match(directives, /不要只重复这一条/);
  assert.match(directives, /不要因此封禁整个主题或来源/);

  const restarted = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_fb'),
    items: [keep, reduce, blocked, similar],
    preferences: prefs.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
    preferenceDirectives: formatPreferenceDirectives(await listContentPreferences(root)),
    preferenceRows: await listContentPreferences(root),
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: '2026-10-04T01:10:00.000Z',
  });
  assert.equal(restarted.view.cards.some((card) => card.title === '被屏蔽来源的一条'), false);
  assert.equal(restarted.view.cards.some((card) => card.title === '同一主题里不喜欢的一条'), true);
});
