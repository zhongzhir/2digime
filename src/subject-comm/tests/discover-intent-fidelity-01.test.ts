import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../content-ingest';
import { parsePageMetadata } from '../page-metadata';
import { seekContent } from '../content-seek';
import { intentFromModelText } from '../discover-intent';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import type { ChatCompleteFn } from '../../subject-core/structured-distill';

const NOW = '2026-09-18T12:00:00.000Z';

function itemOf(input: {
  id: string;
  title: string;
  text: string;
  url: string;
  contentType?: 'article' | 'image' | 'audio' | 'video';
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
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

const VIDEO = itemOf({
  id: 'ni_ai_video',
  title: 'A public AI short film',
  text: 'An actual short film.',
  url: 'https://example.org/watch/ai-short',
  contentType: 'video',
  mediaUrl: 'https://cdn.example.org/ai-short.mp4',
});
const ABOUT = itemOf({
  id: 'ni_watchlist',
  title: 'Best AI Short Films to Watch: A 2026 Watchlist',
  text: 'A roundup of AI shorts.',
  url: 'https://example.org/news/ai-watchlist',
  contentType: 'article',
});
const RWA = itemOf({
  id: 'ni_rwa',
  title: 'RWA 资产上链改变金融基础设施',
  text: 'Real world assets and tokenization news.',
  url: 'https://example.org/finance/rwa',
  contentType: 'article',
});
const AI_ARTICLE = itemOf({
  id: 'ni_ai_essay',
  title: 'Why open models matter this week',
  text: 'A long essay on open-weight models.',
  url: 'https://example.org/ai-essay',
  contentType: 'article',
});

function chatFromScript(script: {
  intent?: Record<string, unknown>;
  roles?: Array<{ id: string; role: string }>;
}): ChatCompleteFn {
  return async ({ messages }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('判断用户在「发现」里')) {
      return { text: JSON.stringify(script.intent || { mode: 'consume', topic: 'AI', requestedContentTypes: ['video'] }) };
    }
    if (blob.includes('判断每个候选')) {
      return { text: JSON.stringify({ roles: script.roles || [] }) };
    }
    return { text: '{}' };
  };
}

test('SEARCH SCOPE: current intent overrides Personal Feed and cached/default items do not leak', async () => {
  const sought = await seekContent({
    query: '找几个AI精品视频看一下',
    items: [VIDEO, ABOUT, RWA, AI_ARTICLE],
    searchWeb: async () => [{ title: RWA.content.title, url: RWA.content.url || '', snippet: RWA.content.text }],
    chatComplete: chatFromScript({
      intent: {
        mode: 'consume',
        topic: 'AI',
        requestedContentTypes: ['video'],
        objectWanted: 'primary_content',
        searchQueries: ['AI short films'],
      },
      roles: [
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
        { id: ABOUT.itemId, role: 'LISTING' },
        { id: RWA.itemId, role: 'UNRELATED' },
        { id: AI_ARTICLE.itemId, role: 'COMMENTARY' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.length, 1);
  assert.equal(sought.cards[0]?.itemId, VIDEO.itemId);
  assert.equal(sought.cards.some((card) => card.itemId === RWA.itemId), false);
  assert.equal(sought.cards.some((card) => card.itemId === ABOUT.itemId), false);
  assert.equal(sought.relatedCards.some((card) => card.itemId === ABOUT.itemId), true);
  assert.equal(sought.cards.some((card) => /finance\/rwa/.test(String(card.url || ''))), false);
  assert.equal(sought.unjudgedCards.some((card) => /finance\/rwa/.test(String(card.url || ''))), true);
  assert.equal(sought.intent.scope, 'current_search');
});

test('SEARCH SCOPE: recent state / explicit preference cannot broaden current search', async () => {
  const parsed = intentFromModelText(
    JSON.stringify({
      mode: 'consume',
      topic: 'AI',
      requestedContentTypes: ['video'],
      objectWanted: 'primary_content',
      searchQueries: ['AI short film watch'],
    }),
    '找几个AI精品视频看一下',
  );
  assert.equal(parsed.topic, 'AI');
  assert.deepEqual(parsed.requestedMedia, ['video']);
  assert.equal(parsed.searchQueries.some((row) => /RWA|金融|投资/i.test(row)), false);
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/discover-intent.ts'), 'utf8');
  assert.equal(src.includes('数字之我、长期偏好或最近浏览去扩大范围'), true);
});

test('OBJECT FIDELITY: video request keeps primary video, about articles, unrelated RWA', async () => {
  const sought = await seekContent({
    query: '找几个AI精品视频看一下',
    items: [VIDEO, ABOUT, RWA],
    searchWeb: async () => [{ title: RWA.content.title, url: RWA.content.url || '', snippet: RWA.content.text }],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: ['video'], objectWanted: 'primary_content' },
      roles: [
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
        { id: ABOUT.itemId, role: 'COMMENTARY' },
        { id: RWA.itemId, role: 'UNRELATED' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.trace.primaryContent, 1);
  assert.equal(sought.trace.aboutContent, 1);
  assert.equal(sought.cards.length, 1);
  assert.equal(sought.cards[0]?.contentType, 'video');
  assert.equal(sought.cards.some((card) => /finance\/rwa/.test(String(card.url || ''))), false);
  assert.equal(sought.unjudgedCards.some((card) => /finance\/rwa/.test(String(card.url || ''))), true);
});

test('OBJECT FIDELITY: broad AI content allows AI article; research allows commentary', async () => {
  const broad = await seekContent({
    query: '最近值得看的 AI 内容',
    items: [AI_ARTICLE, RWA],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: [], objectWanted: 'primary_content' },
      roles: [
        { id: AI_ARTICLE.itemId, role: 'PRIMARY_CONTENT' },
        { id: RWA.itemId, role: 'UNRELATED' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(broad.cards.some((card) => card.itemId === AI_ARTICLE.itemId), true);
  assert.equal(broad.cards.some((card) => card.itemId === RWA.itemId), false);

  const research = await seekContent({
    query: '分析一下最近 AI 短片为什么火',
    items: [ABOUT, VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'research', topic: 'AI', requestedContentTypes: ['article'], objectWanted: 'commentary' },
      roles: [
        { id: ABOUT.itemId, role: 'COMMENTARY' },
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(research.intent.intent, 'research');
  assert.equal(research.cards.some((card) => card.itemId === ABOUT.itemId), true);
});

test('TYPE SEMANTICS: Article + embedded media stays article; VideoObject/AudioObject/ImageObject stay themselves', async () => {
  const articleAudio = parsePageMetadata(
    `<!doctype html><html><head>
<meta property="og:type" content="article">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"NewsArticle","headline":"Market wrap","url":"https://example.org/news/wrap"},
  {"@type":"AudioObject","name":"Clip","contentUrl":"https://cdn.example.org/clip.mp3","duration":"PT0S"}
]}
</script></head><body><audio src="https://cdn.example.org/clip.mp3"></audio></body></html>`,
    'https://example.org/news/wrap',
  );
  assert.equal(articleAudio.contentType, 'article');
  assert.equal(articleAudio.mediaUrl, 'https://cdn.example.org/clip.mp3');

  const articleVideo = parsePageMetadata(
    `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Article","headline":"AI shorts boom","url":"https://example.org/news/ai-shorts"},
  {"@type":"VideoObject","name":"Embed","contentUrl":"https://cdn.example.org/embed.mp4","embedUrl":"https://example.org/embed/1"}
]}
</script></head><body><video src="https://cdn.example.org/embed.mp4"></video></body></html>`,
    'https://example.org/news/ai-shorts',
  );
  assert.equal(articleVideo.contentType, 'article');

  const video = parsePageMetadata(
    `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VideoObject","name":"Film","contentUrl":"https://cdn.example.org/v.mp4"}
</script></head></html>`,
    'https://example.org/watch/9',
  );
  assert.equal(video.contentType, 'video');
  const audio = parsePageMetadata(
    `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"AudioObject","name":"Episode","contentUrl":"https://cdn.example.org/a.mp3"}
</script></head></html>`,
    'https://example.org/ep',
  );
  assert.equal(audio.contentType, 'audio');
  const image = parsePageMetadata(
    `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ImageObject","name":"Photo","contentUrl":"https://cdn.example.org/i.jpg"}
</script></head></html>`,
    'https://example.org/i',
  );
  assert.equal(image.contentType, 'image');
});

test('FAILURE: zero matching video is honest empty and does not use cached feed cards', async () => {
  const sought = await seekContent({
    query: '找几个AI精品视频看一下',
    items: [ABOUT, RWA],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: ['video'], objectWanted: 'primary_content' },
      roles: [
        { id: ABOUT.itemId, role: 'LISTING' },
        { id: RWA.itemId, role: 'UNRELATED' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.length, 0);
  assert.match(sought.notice, /还没有可以播放的AI视频|没有找到可以直接观看的 AI 视频|没有找到这个视频节目本身/);
  assert.equal(sought.cards.some((card) => card.itemId === RWA.itemId), false);
  assert.equal(sought.trace.visible, 0);
});

test('a playable video stays unrelated when the model says it is unrelated', async () => {
  const sought = await seekContent({
    query: 'A public AI short film',
    items: [VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: '木星', requestedContentTypes: ['video'], objectWanted: 'primary_content' },
      roles: [{ id: VIDEO.itemId, role: 'UNRELATED' }],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.some((card) => card.itemId === VIDEO.itemId), false);
  assert.equal(sought.trace.items.some((row) => row.contentId === VIDEO.itemId && row.fidelity === 'UNRELATED'), true);
});

test('video and audio are not treated as relevant when relevance was not judged', async () => {
  const sought = await seekContent({
    query: 'A public AI short film',
    items: [VIDEO],
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户在「发现」里')) {
        return {
          text: JSON.stringify({
            mode: 'consume',
            topic: '木星',
            requestedContentTypes: ['video'],
            objectWanted: 'primary_content',
          }),
        };
      }
      return { text: 'not json' };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.some((card) => card.itemId === VIDEO.itemId), false);
  assert.equal(sought.unjudgedCards.some((card) => card.itemId === VIDEO.itemId), true);
  assert.equal(
    sought.trace.items.some((row) => row.contentId === VIDEO.itemId && row.fidelity === 'UNRELATED'),
    false,
  );
  assert.match(sought.notice, /没有完成相关性判断/);
  assert.match(sought.notice, /已确认/);
});

test('hub-only search is reported as excluded entrances, not as no request', async () => {
  const sought = await seekContent({
    query: '今日新闻',
    items: [],
    searchWeb: async () => [{ title: '今日新闻', url: 'https://news.example.com/', snippet: '门户' }],
  });
  assert.equal(sought.cards.length, 0);
  assert.equal(sought.trace.searchCalled, true);
  assert.equal(sought.trace.rawSearchHits, 1);
  assert.equal(sought.trace.excludedHub, 1);
  assert.match(sought.notice, /网站入口/);
});

test('a site entrance can be continued into a concrete story', async () => {
  const story = itemOf({
    id: 'ni_news_story',
    title: '周五早报里的一条具体报道',
    text: '这是一条带日期的报道，不是栏目介绍。',
    url: 'https://news.example.com/2026/1002/story.html',
    contentType: 'article',
  });
  const sought = await seekContent({
    query: '今日新闻',
    items: [],
    searchWeb: async () => [{ title: '新闻网', url: 'https://news.example.com/', snippet: '入口' }],
    ingestHit: async (hit) => (hit.url === 'https://news.example.com/' ? [story] : []),
  });
  assert.equal(sought.cards.some((card) => card.itemId === story.itemId), true);
  assert.equal(sought.cards.some((card) => card.url === 'https://news.example.com/'), false);
});

test('an audio request keeps an article as introduction, not as playback', async () => {
  const note = itemOf({
    id: 'ni_chopin_note',
    title: '肖邦夜曲介绍',
    text: '这是一篇介绍，不是录音。',
    url: 'https://example.org/chopin-note',
    contentType: 'article',
  });
  const sought = await seekContent({
    query: '肖邦夜曲',
    items: [note],
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户在「发现」里')) {
        return {
          text: JSON.stringify({
            mode: 'consume',
            topic: '肖邦夜曲',
            requestedContentTypes: ['audio'],
            objectWanted: 'primary_content',
            freshness: 'classic',
          }),
        };
      }
      return {
        text: JSON.stringify({ roles: [{ id: note.itemId, role: 'COMMENTARY' }] }),
      };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.length, 0);
  assert.equal(sought.relatedCards.some((card) => card.itemId === note.itemId), true);
  assert.match(sought.notice, /介绍/);
  assert.match(sought.notice, /播放|听完|没有找到这个音频节目本身/);
});

test('TYPE SEMANTICS: RSS enclosure audio is still audio', async () => {
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/audio.xml',
    store: new MemoryNetworkItemStore(),
    now: NOW,
    fetchImpl: async () => ({
      status: 200,
      body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Pod</title>
<item><title>Episode</title><link>https://example.org/ep1</link>
<enclosure url="https://cdn.example.org/ep1.mp3" type="audio/mpeg" length="12"/></item></channel></rss>`,
      finalUrl: 'https://example.org/audio.xml',
    }),
  });
  assert.equal(ingested.items[0]?.content.contentType, 'audio');
});
