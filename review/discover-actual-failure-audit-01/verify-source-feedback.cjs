/** 同一份隔离 Owner 副本上对照默认供给与反馈闭环。不写真实 AppData，不改 owner-copy。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC_COPY = path.join(
  'D:\\Projects\\_dm-audit-data\\discover-actual-failure-audit-01\\owner-copy\\userData\\subjects\\default',
);
const ISO_ROOT = path.join('D:\\Projects\\_dm-audit-data\\discover-source-feedback-02\\isolated');
const PKG = path.join(ISO_ROOT, 'userData', 'subjects', 'default');
const OUT = path.join('D:\\Projects\\_dm-audit-data\\discover-source-feedback-02\\report.json');
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

function mixOf(items) {
  const types = {};
  const vias = {};
  const publishers = {};
  for (const item of items) {
    const type = item.content?.contentType || 'article';
    const via = item.provenance?.via || 'unknown';
    const pub = item.publisherDisplayName || item.publisherSubjectId || 'unknown';
    types[type] = (types[type] || 0) + 1;
    vias[via] = (vias[via] || 0) + 1;
    publishers[pub] = (publishers[pub] || 0) + 1;
  }
  return { count: items.length, types, vias, publishers: Object.keys(publishers).length };
}

function defaultPool(items) {
  const inBound = items.filter((item) => {
    const url = String(item.content?.url || '');
    return !/bbc\.|epochtimes|ntdtv|voanews|rfa\.org/i.test(url);
  });
  const recent = inBound.filter((item) => {
    const type = item.content?.contentType;
    if (type === 'image' || type === 'video' || type === 'audio') return true;
    const published = item.content?.publishedAt || item.content?.published_at;
    if (!published) return true;
    const at = Date.parse(published);
    return Number.isFinite(at) ? Date.now() - at <= 21 * 24 * 60 * 60 * 1000 : true;
  });
  const steady = recent.filter((item) => item.provenance?.via !== 'search');
  return steady.length ? steady : recent;
}

(async () => {
  if (!fs.existsSync(SRC_COPY)) {
    throw new Error('owner-copy missing');
  }
  fs.rmSync(ISO_ROOT, { recursive: true, force: true });
  copyTree(SRC_COPY, PKG);
  const beforeItems = readItems(PKG);
  const beforePool = defaultPool(beforeItems);
  const before = {
    all: mixOf(beforeItems),
    defaultPool: mixOf(beforePool),
    prefs: fs.existsSync(path.join(PKG, 'content', 'content-preferences.json'))
      ? JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'content-preferences.json'), 'utf8'))
      : null,
    later: fs.existsSync(path.join(PKG, 'content', 'later-items.json'))
      ? JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'later-items.json'), 'utf8'))
      : null,
    recent: fs.existsSync(path.join(PKG, 'content', 'recent-recommendation-state.json'))
      ? JSON.parse(fs.readFileSync(path.join(PKG, 'content', 'recent-recommendation-state.json'), 'utf8'))
      : null,
  };

  const root = path.join(__dirname, '..', '..');
  const { catalogFeedUrls, listOpenCatalog, networkItemFromOpenHit } = require(path.join(
    root,
    'dist/subject-comm/content-source-capabilities.js',
  ));
  const { ingestSource } = require(path.join(root, 'dist/subject-comm/content-ingest.js'));
  const { FileNetworkItemStore } = require(path.join(root, 'dist/relay-service/network-item-store.js'));
  const {
    upsertContentPreference,
    listContentPreferences,
  } = require(path.join(root, 'dist/subject-comm/content-preferences.js'));
  const { appendNetworkContentFeedback, createUserContentFeedback } = require(path.join(
    root,
    'dist/subject-comm/network-content-feedback.js',
  ));
  const { ensurePersonalFeed } = require(path.join(root, 'dist/subject-comm/personal-feed.js'));

  const store = new FileNetworkItemStore(path.join(PKG, 'content'));
  const feedReport = [];
  for (const url of catalogFeedUrls(['article', 'video', 'audio', 'image'])) {
    const started = Date.now();
    try {
      const ingested = await ingestSource({
        sourceUrl: url,
        store,
        now: NOW,
        limit: 8,
      });
      feedReport.push({
        url,
        ok: true,
        ms: Date.now() - started,
        items: ingested.items.length,
        sample: ingested.items.slice(0, 2).map((item) => item.content.title),
      });
    } catch (err) {
      feedReport.push({ url, ok: false, ms: Date.now() - started, error: String(err && err.message || err) });
    }
  }

  let catalogMedia = 0;
  try {
    const hits = await listOpenCatalog({ kinds: ['video', 'image', 'audio'] });
    for (const hit of hits.slice(0, 12)) {
      const item = networkItemFromOpenHit(hit, NOW, 'feed');
      if (!item) continue;
      await store.put(item);
      catalogMedia += 1;
    }
  } catch (err) {
    catalogMedia = -1;
    feedReport.push({ url: 'listOpenCatalog', ok: false, error: String(err && err.message || err) });
  }

  const afterIngest = readItems(PKG);
  const afterPool = defaultPool(afterIngest);

  const pool = afterPool.filter((item) => item.content?.title);
  const boostItem = pool.find((item) => (item.content?.contentType || 'article') === 'article') || pool[0];
  const samePub = pool.find(
    (item) => item !== boostItem && item.publisherSubjectId === boostItem?.publisherSubjectId && item.itemId !== boostItem?.itemId,
  );
  const otherPub = pool.find((item) => item.publisherSubjectId && item.publisherSubjectId !== boostItem?.publisherSubjectId);
  const feedbackFile = path.join(PKG, 'content', 'network-content-feedback.jsonl');
  if (boostItem) {
    await appendNetworkContentFeedback(
      feedbackFile,
      createUserContentFeedback({ subjectId: 'default', contentId: boostItem.itemId, action: 'boost' }),
    );
    await upsertContentPreference(PKG, {
      kind: 'boost',
      targetType: 'item',
      target: boostItem.itemId,
      text: `多推荐和「${boostItem.content.title}」相近的内容，但不要只重复这一条。`,
      now: NOW,
    });
  }
  if (samePub) {
    await appendNetworkContentFeedback(
      feedbackFile,
      createUserContentFeedback({ subjectId: 'default', contentId: samePub.itemId, action: 'reduce' }),
    );
    await upsertContentPreference(PKG, {
      kind: 'reduce',
      targetType: 'item',
      target: samePub.itemId,
      text: `不喜欢「${samePub.content.title}」这一条。结合语境理解，不要因此封禁整个主题或来源。`,
      now: NOW,
    });
  }
  if (otherPub) {
    await appendNetworkContentFeedback(
      feedbackFile,
      createUserContentFeedback({ subjectId: 'default', contentId: otherPub.itemId, action: 'block' }),
    );
    await upsertContentPreference(PKG, {
      kind: 'block',
      targetType: 'source',
      target: otherPub.publisherSubjectId,
      text: `不再看来源 ${otherPub.publisherDisplayName || otherPub.publisherSubjectId}`,
      now: NOW,
    });
  }

  const prefs = await listContentPreferences(PKG);
  const self = {
    schemaVersion: 1,
    subjectId: 'default',
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '我关心公开科学与影像。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
  const chat = async ({ messages }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向')) {
      return {
        text: JSON.stringify({
          intents: [
            { topic: 'science', contentTypes: ['article', 'image'], searchQuery: 'science photo', explorationMode: 'core' },
          ],
        }),
      };
    }
    const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]);
    return {
      text: JSON.stringify({
        decisions: [...new Set(ids)].map((itemId) => ({ itemId, decision: 'show', reason: '已经取到的可用内容' })),
      }),
    };
  };
  const first = await ensurePersonalFeed({
    packageRoot: PKG,
    digitalSelf: self,
    items: afterIngest,
    preferences: prefs.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
    preferenceDirectives: prefs.map((row) => `- [${row.kind}] ${row.text}`).join('\n'),
    preferenceRows: prefs,
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: chat,
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const refreshed = await ensurePersonalFeed({
    packageRoot: PKG,
    digitalSelf: self,
    items: readItems(PKG),
    preferences: prefs.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
    preferenceDirectives: prefs.map((row) => `- [${row.kind}] ${row.text}`).join('\n'),
    preferenceRows: await listContentPreferences(PKG),
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: chat,
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'refresh',
    now: NOW,
  });
  const restartedPrefs = await listContentPreferences(PKG);
  const restarted = await ensurePersonalFeed({
    packageRoot: PKG,
    digitalSelf: self,
    items: readItems(PKG),
    preferences: restartedPrefs.map((row) => ({ id: row.id, kind: row.kind, text: row.text })),
    preferenceDirectives: restartedPrefs.map((row) => `- [${row.kind}] ${row.text}`).join('\n'),
    preferenceRows: restartedPrefs,
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: chat,
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: new Date().toISOString(),
  });

  const cardsOf = (view) => (view.view?.cards || []).map((card) => ({ id: card.itemId, title: card.title, type: card.contentType || 'article', publisher: card.publisherDisplayName }));
  const report = {
    isolatedRoot: ISO_ROOT,
    sourceCopy: SRC_COPY,
    touchedOwnerCopy: false,
    touchedAppData: false,
    before,
    ingest: { feeds: feedReport, catalogMedia },
    afterIngest: { all: mixOf(afterIngest), defaultPool: mixOf(afterPool) },
    feedback: {
      boost: boostItem ? { id: boostItem.itemId, title: boostItem.content.title } : null,
      reduce: samePub ? { id: samePub.itemId, title: samePub.content.title, samePublisher: true } : null,
      block: otherPub ? { id: otherPub.itemId, publisher: otherPub.publisherDisplayName, publisherId: otherPub.publisherSubjectId } : null,
      persisted: restartedPrefs.map((row) => ({ kind: row.kind, targetType: row.targetType, target: row.target })),
    },
    views: {
      afterFeedback: cardsOf(first),
      afterRefresh: cardsOf(refreshed),
      afterRestart: cardsOf(restarted),
    },
    checks: {
      blockGoneAfterRestart: otherPub
        ? !cardsOf(restarted).some((card) => card.id === otherPub.itemId)
        : null,
      reduceStillPresent: samePub ? cardsOf(first).some((card) => card.id === samePub.itemId) : null,
      boostNotOnlyRepeat: boostItem
        ? cardsOf(first).some((card) => card.id !== boostItem.itemId)
        : null,
      defaultPoolTypesBefore: Object.keys(before.defaultPool.types).length,
      defaultPoolTypesAfter: Object.keys(mixOf(afterPool).types).length,
    },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ out: OUT, checks: report.checks, afterTypes: report.afterIngest.defaultPool.types, beforeTypes: report.before.defaultPool.types }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
