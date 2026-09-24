import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../content-ingest';
import { cardFromNetworkItem } from '../content-discover';
import { seekContent } from '../content-seek';
import {
  intentFromModelText,
  isDomainLikeTitle,
  isGenericHubUrl,
  rolesFromModelText,
} from '../discover-intent';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import { parseJsonFeed } from '../content-feed';
import { parsePageMetadata } from '../page-metadata';
import { parseOembedBody } from '../content-oembed';
import { looksLikeJsonFeed } from '../content-media';
import type { ChatCompleteFn } from '../../subject-core/structured-distill';

const NOW = '2026-09-15T12:00:00.000Z';

function itemOf(input: {
  id: string;
  title: string;
  text: string;
  url: string;
  contentType?: 'article' | 'image' | 'audio' | 'video';
  thumbnailUrl?: string;
  mediaUrl?: string;
  author?: string;
  publishedAt?: string;
  publisher?: string;
}): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: input.id,
    publisherSubjectId: 'pub_' + input.id,
    publisherDisplayName: input.publisher || 'Example Pub',
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
      ...(input.author ? { author: input.author } : {}),
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
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

const ARTICLE = itemOf({
  id: 'ni_article',
  title: 'Why open models matter this week',
  text: 'A long essay on open-weight models.',
  url: 'https://example.org/ai-essay',
  contentType: 'article',
  thumbnailUrl: 'https://cdn.example.org/essay.jpg',
  author: 'Ada',
  publishedAt: NOW,
});
const IMAGE = itemOf({
  id: 'ni_image',
  title: 'Earth from lunar distance',
  text: 'A still photograph from a public archive.',
  url: 'https://example.org/photo/earth',
  contentType: 'image',
  mediaUrl: 'https://cdn.example.org/earth.jpg',
  thumbnailUrl: 'https://cdn.example.org/earth-thumb.jpg',
  author: 'NASA',
});
const AUDIO = itemOf({
  id: 'ni_audio',
  title: 'Tech Daily: fusion episode',
  text: 'A podcast episode.',
  url: 'https://example.org/podcast/fusion',
  contentType: 'audio',
  mediaUrl: 'https://cdn.example.org/fusion.mp3',
  thumbnailUrl: 'https://cdn.example.org/pod.jpg',
});
const VIDEO = itemOf({
  id: 'ni_video',
  title: 'A public AI video talk on small models',
  text: 'Conference recording.',
  url: 'https://example.org/watch/small-models',
  contentType: 'video',
  thumbnailUrl: 'https://cdn.example.org/talk.jpg',
  mediaUrl: 'https://cdn.example.org/talk.mp4',
});
const COMMENTARY = itemOf({
  id: 'ni_news',
  title: 'AI 视频行业迎来爆发：盘点十大平台',
  text: '行业分析，不是作品本身。',
  url: 'https://example.org/news/ai-video-boom',
  contentType: 'article',
});
const DOMAIN = itemOf({
  id: 'ni_domain',
  title: 'qq.com',
  text: 'A site home.',
  url: 'https://www.qq.com/',
});

test('CONTENT CARD: article/image/audio/video keep source, canonical, thumbnail fallback', () => {
  const article = cardFromNetworkItem(ARTICLE, '目录里已有这条内容。');
  const image = cardFromNetworkItem(IMAGE, '目录里已有这条内容。');
  const audio = cardFromNetworkItem(AUDIO, '目录里已有这条内容。');
  const video = cardFromNetworkItem(VIDEO, '目录里已有这条内容。');
  assert.equal(article.contentType, 'article');
  assert.equal(article.thumbnailUrl, 'https://cdn.example.org/essay.jpg');
  assert.equal(article.author, 'Ada');
  assert.equal(article.url, 'https://example.org/ai-essay');
  assert.equal(image.contentType, 'image');
  assert.equal(image.mediaUrl, 'https://cdn.example.org/earth.jpg');
  assert.equal(audio.contentType, 'audio');
  assert.equal(audio.mediaUrl, 'https://cdn.example.org/fusion.mp3');
  assert.equal(video.contentType, 'video');
  assert.equal(video.thumbnailUrl, 'https://cdn.example.org/talk.jpg');
  const noThumb = cardFromNetworkItem(itemOf({
    id: 'ni_plain',
    title: 'Plain essay',
    text: 'No image.',
    url: 'https://example.org/plain',
    contentType: 'article',
  }), 'ok');
  assert.equal(noThumb.thumbnailUrl, undefined);
  assert.equal(noThumb.url, 'https://example.org/plain');
});

test('INTENT: consume vs research comes from model JSON, not keyword if/else', async () => {
  const consume = intentFromModelText(
    JSON.stringify({
      intent: 'consume',
      objectWanted: 'work_itself',
      requestedMedia: ['video'],
      searchQueries: ['AI videos'],
    }),
    '分析一下现在的 AI 视频',
  );
  assert.equal(consume.intent, 'consume');
  const research = intentFromModelText(
    JSON.stringify({
      intent: 'research',
      objectWanted: 'commentary',
      requestedMedia: ['article'],
      suggestTalk: true,
    }),
    '找几个 AI 视频看看',
  );
  assert.equal(research.intent, 'research');
  assert.equal(research.suggestTalk, true);

  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/discover-intent.ts'), 'utf8');
  assert.equal(/if\s*\(.*query.*(consume|research)/i.test(src), false);
  assert.equal(src.includes('extractMentionedObjects'), false);
});

test('INTENT: commentary is separated from the consumable feed', async () => {
  const sought = await seekContent({
    query: '找几个 AI 视频看看',
    items: [VIDEO, COMMENTARY, DOMAIN, ARTICLE],
    chatComplete: chatFromScript({
      intent: {
        intent: 'consume',
        requestedMedia: ['video'],
        objectWanted: 'work_itself',
        searchQueries: ['AI video talk'],
      },
      roles: [
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
        { id: COMMENTARY.itemId, role: 'COMMENTARY' },
        { id: ARTICLE.itemId, role: 'COMMENTARY' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.some((card) => card.itemId === VIDEO.itemId), true);
  assert.equal(sought.cards.some((card) => card.itemId === COMMENTARY.itemId), false);
  assert.equal(sought.relatedCards.some((card) => card.itemId === COMMENTARY.itemId), true);
  assert.equal(sought.cards.some((card) => card.title === 'qq.com' || card.url === 'https://www.qq.com/'), false);
});

test('INTENT: research keeps commentary in related info, not as fake works', async () => {
  const sought = await seekContent({
    query: '分析 AI 视频行业',
    items: [COMMENTARY, VIDEO],
    chatComplete: chatFromScript({
      intent: { intent: 'research', objectWanted: 'commentary', suggestTalk: true },
      roles: [
        { id: COMMENTARY.itemId, role: 'COMMENTARY' },
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.intent.intent, 'research');
  assert.equal(sought.cards.some((card) => card.itemId === COMMENTARY.itemId), true);
  assert.equal(sought.cards.some((card) => card.itemId === VIDEO.itemId), true);
  assert.match(sought.notice, /问兔机米|分析/);
});

test('DISCOVERY: domain-only / homepage cards are not main feed items', async () => {
  assert.equal(isDomainLikeTitle('qq.com', 'https://www.qq.com/'), true);
  assert.equal(isDomainLikeTitle('Earthrise.jpg'), false);
  assert.equal(isDomainLikeTitle('Saturn.jpg', 'https://commons.wikimedia.org/wiki/File:Saturn.jpg'), false);
  assert.equal(isGenericHubUrl('https://example.org/'), true);
  assert.equal(isGenericHubUrl('https://example.org/search?q=ai'), true);
  assert.equal(isGenericHubUrl('https://example.org/watch/ai-talk'), false);
  const sought = await seekContent({
    query: '最近值得看的 AI 内容',
    items: [DOMAIN, ARTICLE],
    searchWeb: async () => [
      { title: 'example.com', url: 'https://example.com/', snippet: 'home' },
      { title: 'Why open models matter this week', url: 'https://example.org/ai-essay', snippet: 'dup' },
    ],
  });
  assert.equal(sought.cards.every((card) => !isDomainLikeTitle(card.title, card.url)), true);
  assert.equal(sought.cards.some((card) => card.itemId === ARTICLE.itemId), true);
  assert.equal(sought.cards.some((card) => /example\.com$/i.test(card.title)), false);
});

test('DISCOVERY: honest empty when consume has no object', async () => {
  const sought = await seekContent({
    query: '找几个 AI 视频看看',
    items: [COMMENTARY],
    chatComplete: chatFromScript({
      intent: { intent: 'consume', objectWanted: 'work_itself', requestedMedia: ['video'] },
      roles: [{ id: COMMENTARY.itemId, role: 'COMMENTARY' }],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.length, 0);
  assert.match(sought.notice, /没有找到可以直接/);
  assert.equal(sought.relatedCards.some((card) => card.itemId === COMMENTARY.itemId), true);
});

test('ASK 2DIGIME: renderer preserves content context without auto-send', async () => {
  const ui = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  const talk = await fs.readFile(path.join(process.cwd(), 'electron/renderer/talk.js'), 'utf8');
  assert.match(ui, /问兔机米/);
  assert.match(ui, /setContentContext/);
  assert.match(ui, /contentId/);
  assert.match(ui, /canonicalUrl/);
  assert.match(ui, /contentType/);
  assert.equal(ui.includes('handleSend(text'), false);
  assert.match(talk, /【正在讨论的内容】/);
  assert.match(talk, /withContentContext/);
  // No raw third-party HTML is injected. The only iframe allowed is a sandboxed official
  // embed URL taken from structured metadata (never innerHTML from the source).
  assert.equal(/innerHTML\s*=\s*[^'"]*embed/i.test(ui), false);
  const iframeLines = ui.split('\n').filter((line) => /iframe/i.test(line));
  for (const line of iframeLines) assert.match(line, /createElement|sandbox|embedUrl/);
});

test('REGRESSION: no hub crawler / mentioned-object factory / site listing table', async () => {
  const seekSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/content-seek.ts'), 'utf8');
  const intentSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/discover-intent.ts'), 'utf8');
  assert.equal(/puppeteer|playwright|crawlSite|extractMentionedObjects|querySelectorAll\(['"]a/i.test(seekSrc), false);
  assert.equal(intentSrc.includes('extractMentionedObjects'), false);
  assert.equal(/youtube\.com|bilibili|iqiyi|douyin/i.test(seekSrc + intentSrc), false);
});

test('REGRESSION: Media RSS / JSON Feed / schema.org / oEmbed still parse', async () => {
  const store = new MemoryNetworkItemStore();
  const mediaRss = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>MRSS</title>
<item><title>Grouped video</title><link>https://example.org/watch/1</link><description>One item.</description>
<media:content url="https://cdn.example.org/full.mp4" type="video/mp4" medium="video" duration="72"/>
<media:thumbnail url="https://cdn.example.org/thumb.jpg"/></item></channel></rss>`;
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/mrss.xml',
    store,
    now: NOW,
    fetchImpl: async () => ({ status: 200, body: mediaRss, finalUrl: 'https://example.org/mrss.xml' }),
  });
  assert.equal(ingested.items[0]!.content.contentType, 'video');
  assert.equal(ingested.items[0]!.content.mediaProvenance, 'media_rss');

  const jsonFeed = `{
    "version": "https://jsonfeed.org/version/1.1",
    "title": "JSON Pub",
    "items": [{
      "id": "1",
      "url": "https://example.org/ep",
      "title": "Episode",
      "content_text": "A talk.",
      "attachments": [{ "url": "https://cdn.example.org/ep.mp3", "mime_type": "audio/mpeg", "duration_in_seconds": 90 }]
    }]
  }`;
  assert.equal(looksLikeJsonFeed(jsonFeed), true);
  const parsed = parseJsonFeed(jsonFeed);
  assert.equal('error' in parsed, false);
  if (!('error' in parsed)) assert.equal(parsed.items[0]!.media?.contentType, 'audio');

  const html = `<html><head>
    <meta property="og:title" content="A public video">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"A public video","url":"https://example.org/w/1"}</script>
    <link rel="alternate" type="application/json+oembed" href="https://example.org/oembed.json">
  </head></html>`;
  const meta = parsePageMetadata(html, 'https://example.org/w/1');
  assert.equal(meta.schemaType, 'VideoObject');
  const oem = parseOembedBody(JSON.stringify({
    type: 'video',
    title: 'A public video',
    thumbnail_url: 'https://cdn.example.org/t.jpg',
    html: '<iframe src="https://example.org/embed/1"></iframe>',
  }));
  assert.ok(oem);
  assert.equal(oem!.media.contentType, 'video');
});

test('STATE/UI: later and explicit preference stay explicit; opened is not a preference write', async () => {
  const ui = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  const pref = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/content-preferences.ts'), 'utf8');
  const runtime = await fs.readFile(path.join(process.cwd(), 'src/runtime/digitalme-runtime.ts'), 'utf8');
  assert.match(ui, /act\('later'/);
  assert.match(ui, /act\('boost'/);
  assert.match(ui, /act\('reduce'/);
  assert.equal(pref.includes("origin: 'user_action'"), true);
  assert.match(runtime, /action === 'open' \|\| action === 'later'/);
  assert.match(runtime, /action === 'boost' \|\| action === 'reduce' \|\| action === 'follow' \|\| action === 'block'/);
});
