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
  assert.match(sought.notice, /没有找到这个视频节目本身/);
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
  assert.equal(/iframe/i.test(ui), false);
});

// 原意（CONTENT-SOURCE-CAPABILITY-GATE-01）：不在读不到正文的入口页上"猜片名再搜"，不爬站、不收链接、不写站点表。
// 从这次实际读到的片单/评论里由模型点名作品、再用现有搜索核实一次，是允许的；名字必须出现在原文里。
test('REGRESSION: no hub crawler / link harvest / site listing table', async () => {
  const seekSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/content-seek.ts'), 'utf8');
  const intentSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/discover-intent.ts'), 'utf8');
  assert.equal(/puppeteer|playwright|crawlSite|querySelectorAll\(['"]a/i.test(seekSrc), false);
  assert.equal(/youtube\.com|bilibili|iqiyi|douyin/i.test(seekSrc + intentSrc), false);
});

test('PROGRAMS: listing is basis, named works verified by search; unread names and unverified works are not programs', async () => {
  const listing = itemOf({
    id: 'ni_listing_doc',
    title: '周末纪录片片单',
    text: '这份片单推荐《河西走廊》，豆瓣口碑很好，共十集；还推荐《人生七年》，跟拍几十年。适合周末慢慢看。',
    url: 'https://example.org/list/weekend-docs',
  });
  const searched: string[] = [];
  const chat: ChatCompleteFn = async ({ messages }) => {
    const system = String(messages[0]?.content || '');
    const user = JSON.parse(String(messages[messages.length - 1]?.content || '{}')) as {
      query: string;
      candidates?: Array<{ id: string; url: string }>;
      sources?: Array<{ id: string }>;
    };
    if (system.includes('取出被明确点名')) {
      const sourceId = user.sources![0]!.id;
      return {
        text: JSON.stringify({
          works: [
            { title: '河西走廊', kind: '纪录片', medium: 'video', sourceId, basis: '片单说口碑很好，共十集。', searchQuery: '河西走廊 纪录片' },
            { title: '人生七年', kind: '纪录片', medium: 'video', sourceId, basis: '片单说跟拍几十年。', searchQuery: '人生七年 纪录片' },
            { title: '地球脉动', kind: '纪录片', medium: 'video', sourceId, basis: '评分 9.9', searchQuery: '地球脉动' },
          ],
        }),
      };
    }
    if (system.includes('判断每个候选')) {
      return {
        text: JSON.stringify({
          roles: (user.candidates || []).map((row) => ({
            id: row.id,
            role: row.url.includes('/list/') ? 'LISTING' : row.url.includes('/show/') ? 'SERIES' : 'COMMENTARY',
            medium: row.url.includes('/show/') ? 'video' : 'article',
            entrance: row.url.includes('/show/') ? 'full' : 'none',
          })),
        }),
      };
    }
    return { text: '{}' };
  };
  const sought = await seekContent({
    query: '适合周末看的纪录片',
    items: [],
    intent: {
      intent: 'consume',
      topic: '纪录片',
      requestedMedia: ['video'],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['周末 纪录片 片单'],
      suggestTalk: false,
    } as never,
    chatComplete: chat,
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async (q) => {
      searched.push(q);
      if (q.includes('河西走廊')) return [{ title: '河西走廊 第1集', url: 'https://tv.example.org/show/hexi', snippet: '纪录片正片' }];
      if (q.includes('人生七年')) return [{ title: '人生七年 影评', url: 'https://news.example.org/review/7up', snippet: '一篇影评' }];
      return [{ title: listing.content.title, url: listing.content.url!, snippet: listing.content.text }];
    },
    ingestHit: async () => [listing],
  });
  // 名字不在原文里的《地球脉动》不会被拿去搜索，也不会出现。
  assert.equal(searched.some((q) => q.includes('地球脉动')), false);
  const program = sought.cards.find((card) => card.url === 'https://tv.example.org/show/hexi');
  assert.ok(program, 'verified program page becomes a card');
  assert.equal(program!.contentType, 'video');
  assert.equal(program!.basisSource?.url, 'https://example.org/list/weekend-docs');
  assert.match(program!.reason, /周末纪录片片单/);
  // 片单本身不冒充节目。
  assert.equal(sought.cards.some((card) => card.url === 'https://example.org/list/weekend-docs'), false);
  // 只找到影评的《人生七年》列为"提到过、未核实"，不进主结果。
  assert.equal(sought.cards.some((card) => /人生七年/.test(card.title)), false);
  const mention = sought.relatedCards.find((card) => card.url === 'https://example.org/list/weekend-docs');
  assert.ok(mention, 'the listing stays as related basis');
  assert.match(mention!.reason, /《人生七年》.*还没有核实/);
  assert.equal(mention!.title, '周末纪录片片单');
  assert.equal(/评分|9\.9/.test(JSON.stringify(sought.cards)), false);

  // 搜索有配额：核实遇到限流就停，不再继续发；没核实的仍标在依据文章上。
  const limited: string[] = [];
  const throttled = await seekContent({
    query: '适合周末看的纪录片',
    items: [],
    intent: {
      intent: 'consume',
      topic: '纪录片',
      requestedMedia: ['video'],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['周末 纪录片 片单'],
      suggestTalk: false,
    } as never,
    chatComplete: chat,
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async (q) => {
      if (q.includes('片单')) return [{ title: listing.content.title, url: listing.content.url!, snippet: listing.content.text }];
      limited.push(q);
      throw Object.assign(new Error('rate_limited'), { status: 429 });
    },
    ingestHit: async () => [listing],
  });
  assert.ok(limited.length <= 2, `verification stops after a failed search, got ${limited.length}`);
  assert.equal(throttled.cards.length, 0);
  assert.match(throttled.relatedCards.find((card) => card.url === listing.content.url)?.reason || '', /还没有核实.*额度已经用完/);
  assert.equal(throttled.trace.searchRateLimited, true);
  assert.match(throttled.notice, /搜索额度已经用完/);
  assert.doesNotMatch(throttled.notice, /没有找到|检查联网/);

  // 作品页连不上（例如证书不匹配）就不是可用的观看入口：不进主结果，在依据文章上说明打不开。
  // 读取端返回 403 之类状态不代表浏览器里打不开，仍算入口。
  const opened: string[] = [];
  const unreachable = await seekContent({
    query: '适合周末看的纪录片',
    items: [],
    intent: {
      intent: 'consume',
      topic: '纪录片',
      requestedMedia: ['video'],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['周末 纪录片 片单'],
      suggestTalk: false,
    } as never,
    chatComplete: chat,
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async (q) => {
      if (q.includes('河西走廊')) return [{ title: '河西走廊 第1集', url: 'https://tv.example.org/show/hexi', snippet: '纪录片正片' }];
      if (q.includes('人生七年')) return [{ title: '人生七年 第1集', url: 'https://tv.example.org/show/7up', snippet: '纪录片正片' }];
      return [{ title: listing.content.title, url: listing.content.url!, snippet: listing.content.text }];
    },
    openPage: async (url) => {
      opened.push(url);
      if (url.includes('/show/hexi')) {
        throw Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      }
      return { status: 403, body: '', finalUrl: url };
    },
    ingestHit: async () => [listing],
  });
  assert.ok(opened.includes('https://tv.example.org/show/hexi'));
  assert.equal(unreachable.cards.some((card) => card.url === 'https://tv.example.org/show/hexi'), false);
  assert.ok(unreachable.cards.some((card) => card.url === 'https://tv.example.org/show/7up'), '403 from the reader still counts as an entrance');
  assert.match(
    unreachable.relatedCards.find((card) => card.url === listing.content.url)?.reason || '',
    /《河西走廊》，找到的作品页目前打不开/,
  );
});

test('CONDITIONS: a work whose stated conditions the model cannot confirm stays out of main results', async () => {
  const chat: ChatCompleteFn = async ({ messages }) => {
    const system = String(messages[0]?.content || '');
    const user = JSON.parse(String(messages[messages.length - 1]?.content || '{}')) as {
      candidates?: Array<{ id: string; url: string }>;
    };
    if (system.includes('判断每个候选')) {
      return {
        text: JSON.stringify({
          roles: (user.candidates || []).map((row) => ({
            id: row.id,
            role: 'PRIMARY_CONTENT',
            medium: 'video',
            conditions: row.url.includes('/silent/') ? 'unconfirmed' : 'met',
            basis: row.url.includes('/silent/') ? '材料没有评分或口碑，还没确认是否高分。' : '材料写明口碑很好。',
          })),
        }),
      };
    }
    return { text: '{}' };
  };
  const sought = await seekContent({
    query: '值得一看的高分科幻电影',
    items: [],
    intent: {
      intent: 'consume',
      topic: '科幻电影',
      requestedMedia: ['video'],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      preferences: '高分',
      searchQueries: ['高分 科幻电影'],
      suggestTalk: false,
    } as never,
    chatComplete: chat,
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async () => [
      { title: 'A Trip to the Moon (1902)', url: 'https://films.example.org/silent/moon', snippet: '一部早期科幻默片' },
      { title: '高分科幻 正片', url: 'https://tv.example.org/show/scifi', snippet: '口碑很好的科幻电影正片' },
    ],
  });
  assert.ok(sought.cards.some((card) => card.url === 'https://tv.example.org/show/scifi'));
  assert.equal(sought.cards.some((card) => card.url === 'https://films.example.org/silent/moon'), false);
  const maybe = sought.relatedCards.find((card) => card.url === 'https://films.example.org/silent/moon');
  assert.ok(maybe, 'unconfirmed work is still shown as related');
  assert.match(maybe!.reason, /还没确认/);
});

test('JUDGE PAGES: duplicates merge first, later pages are judged, candidates not sent stay visible as not judged', async () => {
  const albumHits = () => [
    ...Array.from({ length: 20 }, (_, i) => ({
      title: `古典专辑 第${i + 1}张`,
      url: `https://music.example.org/album/${i + 1}`,
      snippet: '一张古典音乐专辑，可在线收听。',
    })),
    // 同一站点、标题完全相同的另一条链接：合并，不重复送判断。
    { title: '古典专辑 第1张', url: 'https://music.example.org/album/1?from=share', snippet: '同一张专辑' },
    { title: '古典专辑 第2张', url: 'https://music.example.org/mirror/2', snippet: '同一张专辑' },
  ];
  const intent = {
    intent: 'consume',
    topic: '古典音乐',
    requestedMedia: ['audio'],
    objectWanted: 'work_itself',
    freshness: 'unspecified',
    popularityClaim: false,
    searchQueries: ['古典音乐 专辑'],
    suggestTalk: false,
  } as never;
  const judgeWith = (primaryIds: (id: string, url: string) => boolean, sent: string[]): ChatCompleteFn => async ({ messages }) => {
    const system = String(messages[0]?.content || '');
    const user = JSON.parse(String(messages[messages.length - 1]?.content || '{}')) as {
      candidates?: Array<{ id: string; url: string }>;
    };
    if (system.includes('判断每个候选')) {
      sent.push(...(user.candidates || []).map((row) => row.id));
      return {
        text: JSON.stringify({
          roles: (user.candidates || []).map((row) => ({
            id: row.id,
            role: primaryIds(row.id, row.url) ? 'PRIMARY_CONTENT' : 'UNRELATED',
            medium: 'audio',
            conditions: 'none',
          })),
        }),
      };
    }
    return { text: '{}' };
  };

  // 第一页主结果不够一屏：继续判断第二页，20 条都判断过。
  const sentAll: string[] = [];
  const paged = await seekContent({
    query: '经典古典音乐专辑',
    items: [],
    intent,
    chatComplete: judgeWith((_id, url) => /album\/[1-4]$/.test(url), sentAll),
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async () => albumHits(),
  });
  assert.equal(sentAll.length, 20);
  assert.equal(new Set(sentAll).size, 20);
  assert.equal(paged.trace.duplicates, 2);
  assert.equal(paged.trace.judgePages, 2);
  assert.equal(paged.trace.notSentToJudge, undefined);
  assert.equal(paged.unjudgedCards.length, 0);

  // 第一页已经够一屏：后面不再判断，没送去的仍列出，标明还没判断，不算无关。
  const sentFirst: string[] = [];
  const stopped = await seekContent({
    query: '经典古典音乐专辑',
    items: [],
    intent,
    chatComplete: judgeWith(() => true, sentFirst),
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async () => albumHits(),
  });
  assert.equal(sentFirst.length, 16);
  assert.equal(stopped.trace.notSentToJudge, 4);
  assert.equal(stopped.trace.judgePages, 1);
  assert.equal(stopped.unjudgedCards.length, 4);
  assert.ok(stopped.unjudgedCards.every((card) => /还没送去判断，不代表不相关/.test(card.reason)));
  assert.equal(stopped.trace.unrelated, 0);

  // 剩余时间不够再判一页：同样停下，并如实列出。
  const sentLate: string[] = [];
  const late = await seekContent({
    query: '经典古典音乐专辑',
    items: [],
    intent,
    chatComplete: judgeWith((_id, url) => /album\/1$/.test(url), sentLate),
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async () => albumHits(),
    deadlineAt: Date.now() + 5_000,
  });
  assert.equal(sentLate.length, 16);
  assert.equal(late.trace.notSentToJudge, 4);
  assert.equal(late.unjudgedCards.length, 4);
});

test('ENTRANCE: excerpts are labeled and ranked after full programs; unconfirmed "full episode" reposts are not confirmed entrances', async () => {
  const chat: ChatCompleteFn = async ({ messages }) => {
    const system = String(messages[0]?.content || '');
    const user = JSON.parse(String(messages[messages.length - 1]?.content || '{}')) as {
      candidates?: Array<{ id: string; url: string }>;
      sources?: Array<{ id: string }>;
    };
    if (system.includes('取出被明确点名')) {
      const sourceId = user.sources![0]!.id;
      return {
        text: JSON.stringify({
          works: [
            { title: '大江大河', kind: '电视剧', medium: 'video', sourceId, basis: '片单说口碑很好。', searchQuery: '大江大河 正片' },
            { title: '山海情', kind: '电视剧', medium: 'video', sourceId, basis: '片单说值得追。', searchQuery: '山海情 正片' },
          ],
        }),
      };
    }
    if (system.includes('判断每个候选')) {
      // 模型依据页面证据给出 entrance；这里用固定页面模拟模型的判断结果。
      const entranceOf = (url: string) =>
        url.includes('/official/') ? 'full' : url.includes('/clip/') ? 'excerpt' : url.includes('/repost/') ? 'unverified' : 'none';
      return {
        text: JSON.stringify({
          roles: (user.candidates || []).map((row) => ({
            id: row.id,
            role: row.url.includes('/list/') ? 'LISTING' : 'PRIMARY_CONTENT',
            medium: row.url.includes('/list/') ? 'article' : 'video',
            conditions: 'none',
            entrance: entranceOf(row.url),
          })),
        }),
      };
    }
    return { text: '{}' };
  };
  const listingText = '这份周末追剧片单推荐《大江大河》，豆瓣口碑很好；还推荐《山海情》，讲西海固移民，值得追。都适合周末一口气看完。';
  const sought = await seekContent({
    query: '适合周末追的国产剧',
    items: [],
    intent: {
      intent: 'consume',
      topic: '国产剧',
      requestedMedia: ['video'],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['周末 国产剧'],
      suggestTalk: false,
    } as never,
    chatComplete: chat,
    model: { baseUrl: 'https://model.example', model: 'm' },
    searchWeb: async (q) => {
      if (q.includes('大江大河')) {
        return [
          { title: '大江大河 精彩片段', url: 'https://tv.example.org/clip/djdh', snippet: '第3集片段' },
          { title: '大江大河 第1集', url: 'https://tv.example.org/official/djdh', snippet: '出品方官方频道正片' },
        ];
      }
      if (q.includes('山海情')) {
        return [{ title: '山海情 HD高清全集', url: 'https://blog.example.net/repost/shq', snippet: '全集在线看' }];
      }
      return [
        { title: '周末追剧片单', url: 'https://example.org/list/weekend', snippet: listingText },
        { title: '某剧 片段合集', url: 'https://tv.example.org/clip/other', snippet: '剪辑片段' },
        { title: '某剧 第1集', url: 'https://tv.example.org/official/other', snippet: '平台正片' },
        { title: '某剧 高清全集', url: 'https://blog.example.net/repost/other', snippet: '全集' },
      ];
    },
  });
  const urls = sought.cards.map((card) => card.url);
  // 节目核实优先取完整入口：同一部作品有正片就不用片段。
  assert.ok(urls.includes('https://tv.example.org/official/djdh'));
  assert.equal(urls.includes('https://tv.example.org/clip/djdh'), false);
  // 只找到来源不明的"高清全集"页：不算核实到的观看入口，在依据文章上说明。
  assert.equal(urls.includes('https://blog.example.net/repost/shq'), false);
  const listing = sought.relatedCards.find((card) => card.url === 'https://example.org/list/weekend');
  assert.match(listing?.reason || '', /《山海情》，找到的页面没能确认是完整节目或可信来源/);
  // 主路径：片段保留并标明，排在完整节目后面；来源不明的全集页不进主结果。
  const clip = sought.cards.find((card) => card.url === 'https://tv.example.org/clip/other');
  assert.ok(clip, 'a clip stays, labeled');
  assert.equal(clip!.excerpt, true);
  assert.ok(urls.indexOf('https://tv.example.org/official/other') < urls.indexOf('https://tv.example.org/clip/other'));
  assert.equal(urls.includes('https://blog.example.net/repost/other'), false);
  const repost = sought.relatedCards.find((card) => card.url === 'https://blog.example.net/repost/other');
  assert.match(repost?.reason || '', /没能确认这是完整节目或来自可信来源/);
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
