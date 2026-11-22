#!/usr/bin/env node
/* Real-source, real-model five-page delivery gate for DISCOVER-50-STAGE1. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MemoryNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { chatComplete } = require('../dist/infrastructure/model-http.js');
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} = require('../dist/infrastructure/env-secrets.js');
const { providerCredentialKey } = require('../dist/infrastructure/secret-store.js');
const { normalizeCanonicalUrl } = require('../dist/subject-comm/content-canonical.js');
const {
  buildDiscoverCandidateReservoir,
  DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  presentationKind,
} = require('../dist/subject-comm/discover-candidate-reservoir.js');
const {
  commitPersonalFeedPrefetch,
  ensurePersonalFeed,
} = require('../dist/subject-comm/personal-feed.js');
const { safePublicHttpGet } = require('../dist/work-runtime/public-http-safety.js');
const { listStore, runCycle } = require('./discover-stage1-source-health-check.cjs');

const OUTPUT_DIR = path.resolve(
  process.env.DISCOVER_REAL_FEED_OUTPUT_DIR ||
    'build/evidence/discover-stage1-real-feed-20261111',
);
const REPORT_FILE = path.join(OUTPUT_DIR, 'report.json');
const HEALTH_REPORT = path.resolve(
  process.env.DISCOVER_REAL_FEED_HEALTH_REPORT ||
    'build/evidence/discover-stage1-source-health-20261111/report.json',
);
const NOW = new Date().toISOString();

function digitalSelf() {
  const lines = [
    ['about_me', '我长期关注人工智能产品、开放技术与数字内容。'],
    ['goals', '我希望发现有事实、有来源、能扩展视野的内容。'],
    ['preferences', '在文章之外，也愿意看优质图片、音频和视频。'],
  ];
  return {
    schemaVersion: 1,
    subjectId: 'subject_discover_real_feed_gate',
    updatedAt: NOW,
    understandings: lines.map(([facet, text], index) => ({
      id: `u_real_feed_${index + 1}`,
      text,
      facet,
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
      updatedAt: NOW,
    })),
  };
}

async function mapLimit(rows, concurrency, worker) {
  const out = new Array(rows.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      out[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => run()));
  return out;
}

async function probeUrl(url) {
  try {
    const response = await safePublicHttpGet(
      url,
      { range: 'bytes=0-65535' },
      undefined,
      { timeoutMs: 8_000, maxBodyBytes: 256 * 1024 },
    );
    return {
      url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalHost: new URL(response.finalUrl).hostname,
    };
  } catch (error) {
    const status = Number(error?.status || 0);
    const errorCode = String(error?.code || error?.message || 'open_failed').slice(0, 120);
    if (errorCode === 'too_large' && status >= 200 && status < 400) {
      return {
        url,
        ok: true,
        status,
        finalHost: new URL(String(error?.finalUrl || url)).hostname,
        bodyLimited: true,
      };
    }
    return {
      url,
      ok: false,
      ...(status ? { status } : {}),
      errorCode,
    };
  }
}

async function main() {
  const health = JSON.parse(await fs.readFile(HEALTH_REPORT, 'utf8'));
  if (health.gate?.result !== 'PASS') throw new Error('30-minute source health gate is not PASS');
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  if (!resolved.configured) throw new Error('no configured model credential');
  const secrets = createEnvSecretAccessor(process.env, resolved.providerId, resolved.runtime);
  const apiKey = await secrets.get(providerCredentialKey(resolved.providerId));
  if (!apiKey) throw new Error('configured model credential could not be read');

  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-real-feed-'));
  const store = new MemoryNetworkItemStore();
  const sourceCycle = await runCycle({ packageRoot, store, cycle: 1 });
  const inactivePublishers = new Set(sourceCycle.inactivePublisherSubjectIds || []);
  const items = (await listStore(store, NOW)).filter(
    (item) => !inactivePublishers.has(item.publisherSubjectId),
  );
  const reservoir = buildDiscoverCandidateReservoir({
    items,
    now: NOW,
    capacity: DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  });
  const feedbackFile = path.join(packageRoot, 'content', 'network-content-feedback.jsonl');
  let modelCalls = 0;
  const complete = async (options) => {
    modelCalls += 1;
    return chatComplete({
      ...options,
      apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
    });
  };
  const shared = {
    packageRoot,
    digitalSelf: digitalSelf(),
    items: reservoir.items,
    preferences: [],
    feedbackFile,
    networking: 'DISABLED',
    chatComplete: complete,
    model: { baseUrl: resolved.baseUrl, model: resolved.model, apiKey },
    now: NOW,
  };
  const pages = [];
  const first = await ensurePersonalFeed({ ...shared, mode: 'open' });
  pages.push(first.view.cards);
  const prefetched = await ensurePersonalFeed({ ...shared, mode: 'prefetch' });
  const rankedCandidates = prefetched.prefetch?.rankedIds.length || 0;
  const committedCandidates = prefetched.prefetch
    ? await commitPersonalFeedPrefetch(packageRoot, prefetched.prefetch)
    : 0;
  for (let index = 1; index < 5; index += 1) {
    const next = await ensurePersonalFeed({ ...shared, mode: 'more' });
    pages.push(next.view.cards);
  }

  const cards = pages.flat();
  const itemById = new Map(reservoir.items.map((item) => [item.itemId, item]));
  const ids = cards.map((card) => card.itemId);
  const canonicalUrls = cards.map((card) => normalizeCanonicalUrl(card.url));
  const sourceCounts = new Map();
  for (const card of cards) {
    const sourceId = card.publisherSubjectId || itemById.get(card.itemId)?.publisherSubjectId || 'unknown';
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
  }
  const urls = [...new Set(cards.map((card) => card.url).filter(Boolean))];
  const probes = await mapLimit(urls, 6, probeUrl);
  let judgmentCount = 0;
  try {
    const feedback = await fs.readFile(feedbackFile, 'utf8');
    judgmentCount = feedback.trim().split('\n').filter(Boolean).length;
  } catch {
    judgmentCount = 0;
  }
  const maxSourceCount = Math.max(0, ...sourceCounts.values());
  const expressions = [...new Set(cards.map((card) => {
    const item = itemById.get(card.itemId);
    return item ? presentationKind(item) : card.contentType || 'article';
  }))].sort();
  const metrics = {
    pageSizes: pages.map((page) => page.length),
    cards: cards.length,
    uniqueItems: new Set(ids).size,
    duplicateItems: ids.length - new Set(ids).size,
    canonicalDuplicates: canonicalUrls.length - new Set(canonicalUrls).size,
    sources: sourceCounts.size,
    maxSourceCount,
    maxSourceShare: cards.length ? maxSourceCount / cards.length : 1,
    expressions,
    modelCalls,
    aiJudgments: judgmentCount,
    rankedCandidates,
    committedCandidates,
    probedUrls: probes.length,
    openableUrls: probes.filter((probe) => probe.ok).length,
    openableRate: probes.length ? probes.filter((probe) => probe.ok).length / probes.length : 0,
  };
  const gates = {
    healthSession: { required: 'PASS', actual: health.gate.result, pass: health.gate.result === 'PASS' },
    realReservoir: { required: 72, actual: reservoir.items.length, pass: reservoir.items.length >= 72 },
    fullPages: { required: '5x12', actual: metrics.pageSizes, pass: metrics.pageSizes.every((size) => size === 12) },
    uniqueCards: { required: 60, actual: metrics.uniqueItems, pass: metrics.uniqueItems === 60 },
    duplicateItems: { required: 0, actual: metrics.duplicateItems, pass: metrics.duplicateItems === 0 },
    canonicalDuplicates: { required: 0, actual: metrics.canonicalDuplicates, pass: metrics.canonicalDuplicates === 0 },
    sourceConcentration: { requiredMax: 0.25, actual: metrics.maxSourceShare, pass: metrics.maxSourceShare <= 0.25 },
    expressions: { required: 4, actual: metrics.expressions.length, pass: metrics.expressions.length >= 4 },
    modelSelection: {
      required: 'all queued candidates judged; at least 48 for four more pages; at least 6 model calls',
      actual: {
        judgments: metrics.aiJudgments,
        rankedCandidates: metrics.rankedCandidates,
        committedCandidates: metrics.committedCandidates,
        modelCalls,
      },
      pass:
        metrics.rankedCandidates >= 48 &&
        metrics.committedCandidates >= 48 &&
        metrics.aiJudgments >= metrics.rankedCandidates &&
        modelCalls >= 6,
    },
    linkOpenability: { required: 0.95, actual: metrics.openableRate, pass: metrics.openableRate >= 0.95 },
  };
  const pass = Object.values(gates).every((gate) => gate.pass);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: resolved.model,
    packageRoot,
    sourceCycle,
    reservoir: reservoir.stats,
    metrics,
    gates,
    failedUrlProbes: probes.filter((probe) => !probe.ok),
    pages: pages.map((page, index) => ({
      page: index + 1,
      cards: page.map((card) => ({
        itemId: card.itemId,
        title: card.title,
        url: card.url,
        publisherSubjectId: card.publisherSubjectId,
        contentType: card.contentType || 'article',
      })),
    })),
    result: pass ? 'PASS' : 'FAIL',
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'final', reportFile: REPORT_FILE, metrics, gates, result: report.result }, null, 2)}\n`);
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
