/** 第 3 批复验：五类新请求、调整前后、默认窗诊断。不写真实 AppData，不改 owner-copy。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC_COPY = path.join(
  'D:\\Projects\\_dm-audit-data\\discover-actual-failure-audit-01\\owner-copy\\userData\\subjects\\default',
);
const ISO_ROOT = path.join('D:\\Projects\\_dm-audit-data\\discover-adjust-03\\isolated');
const PKG = path.join(ISO_ROOT, 'userData', 'subjects', 'default');
const OUT = path.join('D:\\Projects\\_dm-audit-data\\discover-adjust-03\\report.json');
const NOW = new Date().toISOString();

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  spawnSync('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'], {
    windowsHide: true,
  });
}

function readItems(dir) {
  const folder = path.join(dir, 'content', 'network-items');
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
}

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function presentationKind(item) {
  const type = String(item.content?.contentType || 'article');
  if (type === 'video' || type === 'image' || type === 'audio') return type;
  const host = hostOf(item.content?.url);
  if (host === 'bgm.tv' || host === 'bangumi.tv' || String(host).endsWith('steampowered.com')) return 'work';
  if (host === 'zh.wikivoyage.org') return 'guide';
  return type || 'article';
}

function mixOf(items) {
  const types = {};
  const kinds = {};
  const vias = {};
  for (const item of items) {
    const type = item.content?.contentType || 'article';
    const kind = presentationKind(item);
    const via = item.provenance?.via || 'unknown';
    types[type] = (types[type] || 0) + 1;
    kinds[kind] = (kinds[kind] || 0) + 1;
    vias[via] = (vias[via] || 0) + 1;
  }
  return { count: items.length, types, kinds, vias };
}

(async () => {
  if (!fs.existsSync(SRC_COPY)) throw new Error('owner-copy missing');
  fs.rmSync(ISO_ROOT, { recursive: true, force: true });
  copyTree(SRC_COPY, PKG);

  const root = path.join(__dirname, '..', '..');
  const { searchOpenWorks, listOpenCatalog, catalogFeedUrls, networkItemFromOpenHit } = require(
    path.join(root, 'dist/subject-comm/content-source-capabilities.js'),
  );
  const { ingestSource } = require(path.join(root, 'dist/subject-comm/content-ingest.js'));
  const { FileNetworkItemStore } = require(path.join(root, 'dist/relay-service/network-item-store.js'));
  const { presentableFeedCandidates, ensurePersonalFeed } = require(
    path.join(root, 'dist/subject-comm/personal-feed.js'),
  );
  const { interpretRecommendationAdjust, saveRecommendationAdjustment, formatAdjustmentDirective, adjustmentSteersFeed } =
    require(path.join(root, 'dist/subject-comm/recommendation-adjustment.js'));
  const { writeDigitalSelf } = require(path.join(root, 'dist/subject-core/digital-self/store.js'));

  const store = new FileNetworkItemStore(path.join(PKG, 'content'));
  const feedReport = [];
  for (const url of catalogFeedUrls(['article', 'video', 'audio', 'image'])) {
    const started = Date.now();
    try {
      const ingested = await ingestSource({ sourceUrl: url, store, now: NOW, limit: 8 });
      feedReport.push({
        url,
        ok: true,
        ms: Date.now() - started,
        items: ingested.items.length,
        sample: ingested.items.slice(0, 2).map((item) => item.content.title),
      });
    } catch (err) {
      feedReport.push({ url, ok: false, ms: Date.now() - started, error: String(err && err.message) });
    }
  }

  let mediaHits = [];
  let workHits = [];
  try {
    mediaHits = await listOpenCatalog({ kinds: ['video', 'image', 'audio'] });
    for (const hit of mediaHits.slice(0, 8)) {
      const item = networkItemFromOpenHit(hit, NOW, 'feed');
      if (item) await store.put(item);
    }
  } catch (err) {
    mediaHits = [{ error: String(err && err.message) }];
  }
  try {
    workHits = await searchOpenWorks();
    for (const hit of workHits.slice(0, 8)) {
      const item = networkItemFromOpenHit(hit, NOW, 'feed');
      if (item) await store.put(item);
    }
  } catch (err) {
    workHits = [{ error: String(err && err.message) }];
  }

  const items = readItems(PKG);
  const pool = items.filter((item) => item.provenance?.via !== 'search');
  const window12 = presentableFeedCandidates(pool, 12, 2);
  const window24 = presentableFeedCandidates(pool, 24, 2);

  const demands = [
    { topic: '游戏', query: '适合周末一个人玩的回合制策略' },
    { topic: '网文', query: '完结的都市修仙长篇' },
    { topic: '动漫', query: '近年播出的校园日常番' },
    { topic: '旅游', query: '川西线自驾过夜攻略' },
    { topic: '课程', query: '零基础 Python 数据分析 可核对价格' },
  ];
  const demandHits = [];
  for (const row of demands) {
    const started = Date.now();
    try {
      const hits = await searchOpenWorks({ query: row.query });
      demandHits.push({
        topic: row.topic,
        query: row.query,
        ms: Date.now() - started,
        count: hits.length,
        sample: hits.slice(0, 3).map((hit) => ({
          title: hit.title,
          url: hit.url,
          pageKind: hit.pageKind || '',
          snippet: String(hit.snippet || '').slice(0, 120),
        })),
        note:
          row.topic === '课程' || row.topic === '网文'
            ? '开放作品目录通常给不出中文课程/网文货架，须再走托管搜索。'
            : '',
      });
    } catch (err) {
      demandHits.push({ topic: row.topic, query: row.query, error: String(err && err.message) });
    }
  }

  const self = {
    schemaVersion: 1,
    subjectId: 'subj_adjust03',
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '我喜欢摄影和徒步。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
  await writeDigitalSelf(PKG, self);

  const beforeIntents = [];
  const before = await ensurePersonalFeed({
    packageRoot: PKG,
    digitalSelf: self,
    items: pool,
    preferences: [],
    networking: 'AVAILABLE',
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        beforeIntents.push(blob.slice(0, 400));
        return {
          text: JSON.stringify({
            intents: [{ topic: 'fusion news', contentTypes: ['article'], searchQuery: 'fusion news', explorationMode: 'core' }],
          }),
        };
      }
      return { text: JSON.stringify({ decisions: [] }) };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });

  const interpreted = await interpretRecommendationAdjust({
    text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
    selfContext: '我喜欢摄影和徒步。',
    chatComplete: async () => ({
      text: JSON.stringify({
        summary: '本次减少剧集推荐，优先寻找与你的兴趣相关的课程。',
        sufficient: false,
        question: '你更想先学摄影后期，还是每天能投入多少时间？',
      }),
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  const adjustment = await saveRecommendationAdjustment(PKG, {
    text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
    summary: interpreted.summary,
    question: interpreted.question,
    scope: 'session',
    runtimeId: 'rt_verify',
    now: NOW,
  });
  const afterIntents = [];
  const after = await ensurePersonalFeed({
    packageRoot: PKG,
    digitalSelf: self,
    items: pool,
    preferences: [],
    preferenceDirectives: formatAdjustmentDirective(adjustment),
    adjustment: { id: adjustment.id, summary: adjustment.summary, text: adjustment.text, scope: 'session' },
    networking: 'AVAILABLE',
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        afterIntents.push(blob.includes('本次减少剧集推荐'));
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
      return { text: JSON.stringify({ decisions: [] }) };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });

  const report = {
    layer: 'runtime_and_catalog',
    ui: 'not_run',
    productShaAccepted: '230cfc6',
    generatedAt: NOW,
    defaultPool: mixOf(pool),
    firstWindow12: {
      mix: mixOf(window12),
      titles: window12.map((item) => ({
        title: item.content.title,
        kind: presentationKind(item),
        type: item.content.contentType || 'article',
        host: hostOf(item.content.url),
      })),
    },
    rankingWindow24: mixOf(window24),
    catalogFeeds: feedReport,
    openCatalog: {
      media: Array.isArray(mediaHits) ? mediaHits.slice(0, 4).map((hit) => ({ title: hit.title, url: hit.url })) : mediaHits,
      works: Array.isArray(workHits) ? workHits.slice(0, 4).map((hit) => ({ title: hit.title, url: hit.url, pageKind: hit.pageKind })) : workHits,
    },
    fiveDemands: demandHits,
    adjustment: {
      summary: interpreted.summary,
      sufficient: interpreted.sufficient,
      question: interpreted.question || '',
      steersDefault: adjustmentSteersFeed(adjustment, 'personal'),
      steersSeek: adjustmentSteersFeed(adjustment, 'intent'),
      beforeIntentMentionsCourse: beforeIntents.some((blob) => /课程/.test(blob)),
      afterIntentMentionsCourse: afterIntents.includes(true),
      beforeCards: before.view.cards.slice(0, 6).map((card) => card.title),
      afterCards: after.view.cards.slice(0, 6).map((card) => card.title),
    },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ out: OUT, windowKinds: report.firstWindow12.mix.kinds, demands: demandHits.map((row) => `${row.topic}:${row.count || 0}`) }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
