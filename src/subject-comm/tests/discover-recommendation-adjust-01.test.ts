import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { digitalSelfBytes } from '../content-discover';
import { ensurePersonalFeed, presentableFeedCandidates, seatThisTurnItems } from '../personal-feed';
import { OPEN_SOURCE_CATALOG } from '../open-source-catalog';
import { searchOpenWorks } from '../content-source-capabilities';
import { seekContent } from '../content-seek';
import {
  formatPreferenceDirectives,
  listContentPreferences,
  upsertContentPreference,
} from '../content-preferences';
import {
  STEER_PREFERENCE_TARGET,
  adjustmentSteersFeed,
  clearRecommendationAdjustment,
  formatAdjustmentDirective,
  interpretRecommendationAdjust,
  loadRecommendationAdjustment,
  saveRecommendationAdjustment,
} from '../recommendation-adjustment';
import { validateNetworkItem } from '../network-item';

const NOW = '2026-10-04T02:00:00.000Z';

function selfOf(text: string): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId: 'subj_adjust',
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text,
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
}

test('catalog adds bangumi wikivoyage steam without foreign cores or course fixtures', () => {
  const ids = OPEN_SOURCE_CATALOG.map((row) => row.id);
  assert.equal(ids.includes('bangumi-calendar'), true);
  assert.equal(ids.includes('wikivoyage-zh'), true);
  assert.equal(ids.includes('steam-featured'), true);
  assert.equal(OPEN_SOURCE_CATALOG.some((row) => /bbc|epoch|qidian|douyin|bilibili/i.test(row.url)), false);
});

test('session adjustment is not process-bound; it does not steer a new topic search', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-adjust-scope-'));
  const self = selfOf('我关心公开科学和影像。');
  await writeDigitalSelf(root, self);
  const before = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  const session = await saveRecommendationAdjustment(root, {
    text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
    summary: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。',
    scope: 'session',
    runtimeId: 'rt_a',
    now: NOW,
  });
  assert.equal((await loadRecommendationAdjustment(root, 'rt_b'))?.scope, 'session');
  assert.equal(adjustmentSteersFeed(session, 'personal'), true);
  assert.equal(adjustmentSteersFeed(session, 'intent'), false);
  assert.match(formatAdjustmentDirective(session), /默认推荐/);
  assert.equal(/跟当前进程|重启后失效/.test(formatAdjustmentDirective(session)), false);
  await saveRecommendationAdjustment(root, {
    text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
    summary: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。',
    scope: 'keep',
    runtimeId: 'rt_a',
    now: NOW,
  });
  await upsertContentPreference(root, {
    kind: 'steer',
    targetType: 'directive',
    target: STEER_PREFERENCE_TARGET,
    text: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。（持续保留的本次调整，不是数字之我，也不表示长期不喜欢某类内容。）',
    now: NOW,
  });
  const kept = await loadRecommendationAdjustment(root, 'rt_b');
  assert.equal(kept?.scope, 'keep');
  assert.equal(adjustmentSteersFeed(kept, 'intent'), false);
  const prefs = await listContentPreferences(root);
  assert.equal(prefs.some((row) => row.kind === 'steer'), true);
  await clearRecommendationAdjustment(root);
  assert.equal(await loadRecommendationAdjustment(root, 'rt_a'), null);
  const after = createHash('sha256').update((await digitalSelfBytes(root))!).digest('hex');
  assert.equal(after, before);
});

test('model interpretation stays a this-time request for course, game and travel phrasing', async () => {
  const cases = [
    {
      text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
      summary: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。',
    },
    {
      text: '最近想找几个适合晚上玩的独立游戏。',
      summary: '本次优先找适合晚上玩的独立游戏。',
    },
    {
      text: '给我准备几条杭州周边能走的旅游攻略。',
      summary: '本次优先寻找杭州周边可走的旅游攻略。',
    },
  ];
  for (const row of cases) {
    const got = await interpretRecommendationAdjust({
      text: row.text,
      selfContext: '我喜欢动手学习和徒步。',
      chatComplete: async ({ messages }) => {
        const blob = messages.map((item) => String(item.content || '')).join('\n');
        assert.match(blob, /不要写成「用户不喜欢/);
        assert.match(blob, /本次/);
        assert.match(blob, /先交候选/);
        assert.match(blob, /不要再为细分方向追问/);
        return {
          text: JSON.stringify({ summary: row.summary, sufficient: true, question: '' }),
        };
      },
      model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    });
    assert.equal(got.summary, row.summary);
    assert.equal(/用户不喜欢看剧|以后都不看剧/.test(got.summary), false);
    assert.match(got.summary, /本次/);
  }
});

test('user expression changes default-feed search direction; a single search is not standing interest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-adjust-feed-'));
  const item = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_course',
    publisherSubjectId: 'pub_course',
    publisherDisplayName: '公开课',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: '摄影基础公开课',
      text: '一门可以核对着手的摄影课，价格未在来源标明。',
      url: 'https://example.org/course/photo',
      contentType: 'article',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!item.ok) throw new Error(item.reason);
  const drama = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_drama',
    publisherSubjectId: 'pub_drama',
    publisherDisplayName: '剧集',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: '热播连续剧第12集', text: '剧集介绍', url: 'https://example.org/drama/12', contentType: 'article' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!drama.ok) throw new Error(drama.reason);
  const adjustment = await saveRecommendationAdjustment(root, {
    text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
    summary: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。',
    scope: 'session',
    runtimeId: 'rt_test',
    now: NOW,
  });
  const directive = formatAdjustmentDirective(adjustment);
  let intentBlob = '';
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('我喜欢摄影和徒步。'),
    items: [item.item, drama.item],
    preferences: [],
    preferenceDirectives: directive,
    recentEvents: [{ type: 'seek_topic', topic: '木星大红斑', at: NOW }],
    adjustment: {
      id: adjustment.id,
      summary: adjustment.summary,
      text: adjustment.text,
      scope: 'session',
    },
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
                topic: 'photography course',
                contentTypes: ['article'],
                searchQuery: 'photography course',
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
            decision: itemId === item.item.itemId ? 'show' : 'ignore',
            reason: itemId === item.item.itemId ? '符合本次找课程的要求' : '本次先少看剧集',
          })),
        }),
      };
    },
    searchWeb: async () => [],
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  assert.match(intentBlob, /本次减少剧集推荐/);
  assert.equal(intentBlob.includes('木星大红斑'), false);
  assert.equal(result.view.adjustment?.summary, adjustment.summary);
  assert.equal(result.view.cards.some((card) => card.itemId === item.item.itemId), true);
  assert.equal(/用户不喜欢看剧/.test(formatPreferenceDirectives([]) + directive), false);
});

test('bangumi calendar returns specific works, not a ranking article', async () => {
  const hits = await searchOpenWorks({
    fetchImpl: async (url) => {
      if (String(url).includes('calendar')) {
        return {
          status: 200,
          body: JSON.stringify([
            {
              weekday: { cn: '星期一' },
              items: [
                {
                  id: 390200,
                  name: 'Girls Band Cry',
                  name_cn: '哭泣少女乐队',
                  summary: '一支女子乐队的故事。',
                  url: 'http://bgm.tv/subject/390200',
                },
              ],
            },
          ]),
          finalUrl: url,
        };
      }
      return { status: 404, body: '{}', finalUrl: url };
    },
  });
  assert.equal(hits[0]?.title, '哭泣少女乐队');
  assert.equal(hits[0]?.url, 'https://bgm.tv/subject/390200');
  assert.equal(hits[0]?.pageKind, 'work');
});

test('discover page exposes visible adjustment controls without a second profile', async () => {
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  const js = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  assert.match(html, /调整推荐/);
  assert.match(html, /修改调整/);
  assert.match(html, /持续保留/);
  assert.match(html, /content-discover-adjust-scope/);
  assert.match(js, /action === 'adjust'/);
  assert.match(js, /adjustRevoke/);
  assert.match(js, /scopeNote/);
  assert.equal(/userProfile|interestVector/.test(js), false);
});

test('already fetched works and media get a seat in the ranking window without a type quota', () => {
  const items = [];
  for (let i = 1; i <= 12; i += 1) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId: `ni_news_${i}`,
      publisherSubjectId: `pub_news_${i}`,
      publisherDisplayName: `新闻${i}`,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: {
        title: `今日要闻${i}`,
        text: '新闻正文',
        url: `https://news.example/n${i}`,
        contentType: 'article',
        publishedAt: NOW,
      },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    items.push(checked.item);
  }
  const work = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_work',
    publisherSubjectId: 'pub_bgm',
    publisherDisplayName: 'bgm.tv',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: '迷宫饭',
      text: '冒险与料理。',
      url: 'https://bgm.tv/subject/106391',
      contentType: 'article',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  const audio = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_audio',
    publisherSubjectId: 'pub_audio',
    publisherDisplayName: 'podcasts',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: '科技播客',
      text: '一期节目',
      url: 'https://itunes.apple.com/cn/podcast/id1',
      contentType: 'audio',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!work.ok || !audio.ok) throw new Error('item');
  items.push(work.item, audio.item);
  const window = presentableFeedCandidates(items, 12, 2);
  assert.equal(window.some((item) => item.itemId === 'ni_work'), true);
  assert.equal(window.some((item) => item.itemId === 'ni_audio'), true);
  assert.ok(window.filter((item) => item.content.contentType === 'article').length < 12);
});

test('this-turn search hits keep a seat in the ranking window ahead of dated news', () => {
  const news = [];
  for (let i = 1; i <= 12; i += 1) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId: `ni_news_${i}`,
      publisherSubjectId: `pub_news_${i}`,
      publisherDisplayName: `新闻${i}`,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: {
        title: `今日要闻${i}`,
        text: '新闻正文',
        url: `https://news.example/n${i}`,
        contentType: 'article',
        publishedAt: NOW,
      },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    news.push(checked.item);
  }
  const course = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_course_fresh',
    publisherSubjectId: 'pub_learn',
    publisherDisplayName: '公开课',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: 'AI 投研实战课',
      text: '每天约一小时，价格未知。',
      url: 'https://learn.example.org/ai-invest',
      contentType: 'article',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!course.ok) throw new Error(course.reason);
  const window = presentableFeedCandidates(news, 12, 2);
  assert.equal(window.some((item) => item.itemId === 'ni_course_fresh'), false);
  const seated = seatThisTurnItems(window, [course.item], 12, 8);
  assert.equal(seated[0]?.itemId, 'ni_course_fresh');
});

test('adjustment search result is shown even when the dated news pool is already full', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-adjust-seat-'));
  const self = selfOf('我做 AI 投资与产品落地。');
  await writeDigitalSelf(root, self);
  const news = [];
  for (let i = 1; i <= 12; i += 1) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId: `ni_pool_${i}`,
      publisherSubjectId: `pub_pool_${i}`,
      publisherDisplayName: `新闻${i}`,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: {
        title: `今日要闻${i}`,
        text: '新闻正文',
        url: `https://news.example/p${i}`,
        contentType: 'article',
        publishedAt: NOW,
      },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    news.push(checked.item);
  }
  const course = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_ai_course',
    publisherSubjectId: 'pub_course',
    publisherDisplayName: '公开课',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: 'AI 投资与产品落地公开课',
      text: '每天约一小时。价格未知。',
      url: 'https://learn.example.org/ai-product',
      contentType: 'article',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!course.ok) throw new Error(course.reason);
  const adjustment = await saveRecommendationAdjustment(root, {
    text: '每天一小时，帮我找 AI 投资与产品落地的课程。',
    summary: '本次按每天一小时寻找 AI 投资与产品落地课程。',
    scope: 'session',
    runtimeId: 'rt_test',
    now: NOW,
  });
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: self,
    items: news,
    preferences: [],
    preferenceDirectives: formatAdjustmentDirective(adjustment),
    adjustment: {
      id: adjustment.id,
      summary: adjustment.summary,
      text: adjustment.text,
      scope: 'session',
    },
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        return {
          text: JSON.stringify({
            intents: [
              {
                topic: 'AI 投资课程',
                contentTypes: ['article'],
                searchQuery: 'AI 投资 产品落地 课程',
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
            decision: itemId === course.item.itemId ? 'show' : 'ignore',
            reason:
              itemId === course.item.itemId
                ? '符合本次找课程的要求，价格未知已标明。'
                : '本次先少看新闻评论',
          })),
        }),
      };
    },
    searchWeb: async () => [
      {
        title: course.item.content.title,
        url: course.item.content.url || '',
        snippet: course.item.content.text,
      },
    ],
    ingestHit: async () => [course.item],
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  assert.equal(result.view.cards.some((card) => card.itemId === course.item.itemId), true);
  assert.match(result.view.cards.find((card) => card.itemId === course.item.itemId)?.reason || '', /课程|价格未知/);
});

test('complex travel seek uses split destination queries, not the whole sentence', async () => {
  const queried: string[] = [];
  await seekContent({
    query: '川西线自驾去稻城亚丁怎么走、在哪过夜',
    items: [],
    intent: {
      intent: 'consume',
      topic: '稻城亚丁',
      requestedMedia: [],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['稻城亚丁', '川西过夜'],
      suggestTalk: false,
    } as never,
    fetchOpenMedia: async (url) => {
      queried.push(String(url));
      if (String(url).includes(encodeURIComponent('稻城亚丁'))) {
        return {
          status: 200,
          body: JSON.stringify({
            query: {
              search: [{ title: '稻城', pageid: 88, snippet: '川西亚丁的过夜与路线。' }],
            },
          }),
          finalUrl: url,
        };
      }
      return { status: 200, body: JSON.stringify({ query: { search: [] } }), finalUrl: url };
    },
  });
  assert.equal(queried.some((url) => url.includes(encodeURIComponent('稻城亚丁'))), true);
  assert.equal(queried.some((url) => decodeURIComponent(url).includes('川西线自驾去稻城亚丁怎么走')), false);
});

test('listing-only game seek still delivers named or listing candidates', async () => {
  const listingText =
    '周末一个人玩可以看《战场女武神》。这是一部回合制策略作品，适合单人慢慢打。';
  const sought = await seekContent({
    query: '适合周末一个人玩的回合制策略',
    items: [],
    intent: {
      intent: 'consume',
      topic: '回合制策略',
      requestedMedia: [],
      objectWanted: 'work_itself',
      freshness: 'unspecified',
      popularityClaim: false,
      searchQueries: ['回合制策略'],
      suggestTalk: false,
    } as never,
    chatComplete: async ({ messages }) => {
      const system = String(messages[0]?.content || '');
      const user = String(messages[messages.length - 1]?.content || '');
      if (system.includes('取出被明确点名')) {
        const payload = JSON.parse(user) as { sources?: Array<{ id: string }> };
        return {
          text: JSON.stringify({
            works: [
              {
                title: '战场女武神',
                kind: '游戏',
                medium: 'unknown',
                sourceId: payload.sources?.[0]?.id || '',
                basis: '适合单人慢慢打的回合制策略。',
                searchQuery: '战场女武神',
              },
            ],
          }),
        };
      }
      if (system.includes('判断每个候选')) {
        const payload = JSON.parse(user) as { candidates?: Array<{ id: string; url: string }> };
        return {
          text: JSON.stringify({
            roles: (payload.candidates || []).map((row) => ({
              id: row.id,
              role: /list/.test(row.url) ? 'LISTING' : 'PRIMARY_CONTENT',
              medium: 'article',
              conditions: 'unconfirmed',
              basis: /list/.test(row.url) ? '这是回合制策略盘点。' : '作品页，价格未知。',
            })),
          }),
        };
      }
      return { text: '{}' };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (q) => {
      if (String(q).includes('战场女武神')) {
        return [{ title: '战场女武神', url: 'https://bgm.tv/subject/123', snippet: '回合制策略作品页' }];
      }
      return [
        {
          title: '回合制策略游戏盘点',
          url: 'https://games.example.org/list/tactics',
          snippet: listingText,
        },
      ];
    },
    ingestHit: async (hit) => {
      const item = validateNetworkItem({
        schemaVersion: 1,
        itemId: 'ni_list_game',
        publisherSubjectId: 'pub_list',
        publisherDisplayName: '盘点',
        kind: 'content',
        createdAt: NOW,
        visibility: 'public',
        content: { title: hit.title, text: listingText, url: hit.url, contentType: 'article' },
        provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
      });
      if (!item.ok) throw new Error(item.reason);
      return [item.item];
    },
  });
  assert.ok(sought.cards.length > 0, 'game seek must not empty the main list');
  assert.equal(
    sought.cards.some((card) => /战场女武神|回合制策略/.test(`${card.title} ${card.reason || ''}`)),
    true,
  );
});

test('explicit seek reuses work catalog for a new game request and does not pad calendar', async () => {
  let searched = '';
  let calendarCalled = false;
  const result = await seekContent({
    query: '适合周末一个人玩的回合制策略',
    items: [],
    fetchOpenMedia: async (url) => {
      if (String(url).includes('calendar')) {
        calendarCalled = true;
        return { status: 200, body: '[]', finalUrl: url };
      }
      if (String(url).includes('search/subject')) {
        searched = String(url);
        return {
          status: 200,
          body: JSON.stringify({
            list: [
              {
                id: 123,
                name_cn: '战场女武神',
                name: 'Valkyria Chronicles',
                summary: '回合制策略作品。',
                url: 'http://bgm.tv/subject/123',
              },
            ],
          }),
          finalUrl: url,
        };
      }
      return { status: 404, body: '{}', finalUrl: url };
    },
  });
  assert.match(searched, /%E5%9B%9E%E5%90%88%E5%88%B6%E7%AD%96%E7%95%A5|回合制策略/);
  assert.equal(calendarCalled, false);
  assert.equal(result.cards.some((card) => card.title === '战场女武神'), true);
  assert.equal(result.cards.some((card) => /十大|盘点/.test(card.title || '')), false);
});
