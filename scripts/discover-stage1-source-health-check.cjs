#!/usr/bin/env node
/*
 * DISCOVER-50-STAGE1: bounded, no-model-cost source health and continuation gate.
 * Default duration is 30 minutes. Set DISCOVER_HEALTH_DURATION_MS=0 for one-cycle smoke.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MemoryNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { safePublicHttpGet } = require('../dist/work-runtime/public-http-safety.js');
const { ingestSource } = require('../dist/subject-comm/content-ingest.js');
const {
  listOpenCatalog,
  networkItemFromOpenHit,
  searchOpenWorks,
} = require('../dist/subject-comm/content-source-capabilities.js');
const {
  OPEN_SOURCE_CATALOG,
  supportsDefaultCatalogListing,
} = require('../dist/subject-comm/open-source-catalog.js');
const {
  contentSourceConditionalHeaders,
  dueCatalogFeedSources,
  dueCatalogSources,
  ensureContentSourcePortfolio,
  listContentSourceViews,
  recordContentSourceAttempts,
} = require('../dist/subject-comm/content-source-portfolio.js');
const {
  buildDiscoverCandidateReservoir,
  DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
} = require('../dist/subject-comm/discover-candidate-reservoir.js');
const { sourcePublisherId } = require('../dist/subject-comm/content-canonical.js');

const DURATION_MS = Math.max(0, Number(process.env.DISCOVER_HEALTH_DURATION_MS ?? 30 * 60 * 1000));
const INTERVAL_MS = Math.max(1000, Number(process.env.DISCOVER_HEALTH_INTERVAL_MS ?? 5 * 60 * 1000));
const ENFORCE = process.env.DISCOVER_HEALTH_ENFORCE !== '0';

async function listStore(store, now) {
  const items = [];
  let cursor;
  do {
    const page = await store.list({ limit: 100, ...(cursor ? { cursor } : {}) }, now);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function ingestFeedSource(source, store, now) {
  let response;
  const conditionalHeaders = contentSourceConditionalHeaders(source);
  const ingested = await ingestSource({
    sourceUrl: source.url,
    store,
    limit: 12,
    now,
    via: 'feed',
    fetchImpl: async (url, headers, redirectLeft, deps) => {
      const sourceRequest = url === source.url;
      const fetched = await safePublicHttpGet(
        url,
        { ...(headers || {}), ...(sourceRequest ? conditionalHeaders : {}) },
        redirectLeft,
        { ...(deps || {}), timeoutMs: 8_000 },
      );
      if (sourceRequest) response = fetched;
      return fetched;
    },
  });
  const unavailable = ingested.records.some(
    (record) => record.status === 'unavailable' || record.status === 'rejected',
  );
  const sampleUrls = [...new Set(
    ingested.items.map((item) => String(item.content.url || '')).filter(Boolean),
  )].slice(0, 2);
  const linkResults = await Promise.all(
    sampleUrls.map(async (url) => {
      try {
        const fetched = await safePublicHttpGet(
          url,
          { range: 'bytes=0-65535' },
          undefined,
          { timeoutMs: 8_000, maxBodyBytes: 256 * 1024 },
        );
        return fetched.status >= 200 && fetched.status < 400;
      } catch (error) {
        const status = Number(error?.status || 0);
        return error?.code === 'too_large' && status >= 200 && status < 400;
      }
    }),
  );
  const contentReachable = !sampleUrls.length || linkResults.some(Boolean);
  const unchangedStillUnreachable =
    ingested.notModified === true && source.lastErrorCode === 'content_unreachable';
  const headers = response?.headers || {};
  return {
    sourceId: source.id,
    ok:
      !unchangedStillUnreachable &&
      (ingested.notModified === true || (!unavailable && contentReachable)),
    itemCount: ingested.items.length,
    ...((unchangedStillUnreachable || (!ingested.notModified && !contentReachable))
      ? { errorCode: 'content_unreachable' }
      : {}),
    ...(ingested.notModified ? { notModified: true } : {}),
    etag: headers.etag || (ingested.notModified ? source.etag || null : null),
    lastModified: headers['last-modified'] || (ingested.notModified ? source.lastModified || null : null),
  };
}

async function runCycle({ packageRoot, store, cycle }) {
  const now = new Date().toISOString();
  const before = await ensureContentSourcePortfolio(packageRoot, now);
  const beforeCursor = new Map(before.map((source) => [source.id, source.cursor || '']));
  const feeds = await dueCatalogFeedSources(packageRoot, now, ['article', 'video', 'image', 'audio']);
  const feedAttempts = await Promise.all(
    feeds.map(async (source) => {
      try {
        return await ingestFeedSource(source, store, now);
      } catch {
        return { sourceId: source.id, ok: false, itemCount: 0 };
      }
    }),
  );
  await recordContentSourceAttempts(packageRoot, now, feedAttempts);

  const due = await dueCatalogSources(packageRoot, now, ['article', 'video', 'image', 'audio']);
  const endpointById = new Map(OPEN_SOURCE_CATALOG.map((endpoint) => [endpoint.id, endpoint]));
  const endpoints = due
    .map((source) => endpointById.get(source.id))
    .filter((endpoint) => endpoint && endpoint.kind !== 'media_rss' && supportsDefaultCatalogListing(endpoint));
  const cursorBySourceId = Object.fromEntries(
    due.flatMap((source) => (source.cursor ? [[source.id, source.cursor]] : [])),
  );
  const apiAttempts = [];
  const apiErrors = [];
  const apiFetch = async (url, headers) => {
    try {
      return await safePublicHttpGet(url, headers, undefined, { timeoutMs: 8_000 });
    } catch (error) {
      apiErrors.push({
        url,
        errorCode: String(error?.code || 'source_error'),
      });
      throw error;
    }
  };
  const mediaEndpoints = endpoints.filter((endpoint) => endpoint.kind !== 'bangumi_api');
  const workEndpoints = endpoints.filter((endpoint) => endpoint.kind === 'bangumi_api');
  const [media, works] = await Promise.all([
    listOpenCatalog({
      kinds: ['video', 'image', 'audio'],
      endpoints: mediaEndpoints,
      cursorBySourceId,
      fetchImpl: apiFetch,
      onSourceAttempt: (attempt) => apiAttempts.push(attempt),
    }),
    searchOpenWorks({
      endpoints: workEndpoints,
      fetchImpl: apiFetch,
      onSourceAttempt: (attempt) => apiAttempts.push(attempt),
    }),
  ]);
  await recordContentSourceAttempts(packageRoot, now, apiAttempts);
  for (const hit of [...media, ...works]) {
    const item = networkItemFromOpenHit(hit, now, 'feed');
    if (item) await store.put(item);
  }

  const after = await ensureContentSourcePortfolio(packageRoot, now);
  const inactivePublisherIds = new Set(
    after
      .filter((source) => !source.enabled || source.consecutiveFailures > 0)
      .map((source) => sourcePublisherId(source.url)),
  );
  const cursorTransitions = after
    .filter((source) => (beforeCursor.get(source.id) || '') !== (source.cursor || ''))
    .map((source) => ({ sourceId: source.id, from: beforeCursor.get(source.id) || null, to: source.cursor || null }));
  const items = (await listStore(store, now)).filter(
    (item) => !inactivePublisherIds.has(item.publisherSubjectId),
  );
  const reservoir = buildDiscoverCandidateReservoir({
    items,
    now,
    capacity: DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  });
  const snapshot = {
    cycle,
    checkedAt: now,
    feedAttempts: feedAttempts.length,
    feedSuccesses: feedAttempts.filter((attempt) => attempt.ok).length,
    feedNotModified: feedAttempts.filter((attempt) => attempt.notModified).length,
    feedAttemptResults: feedAttempts.map((attempt) => ({
      sourceId: attempt.sourceId,
      ok: attempt.ok,
      itemCount: attempt.itemCount,
      notModified: attempt.notModified === true,
    })),
    apiAttempts: apiAttempts.length,
    apiSuccesses: apiAttempts.filter((attempt) => attempt.ok).length,
    apiAttemptResults: apiAttempts.map((attempt) => ({
      sourceId: attempt.sourceId,
      ok: attempt.ok,
      itemCount: attempt.itemCount,
      cursor: attempt.cursor ?? undefined,
      errorCode: attempt.errorCode,
    })),
    apiErrors,
    cursorTransitions,
    directoryItems: items.length,
    reservoirItems: reservoir.items.length,
    reservoirSources: reservoir.stats.sourceCount,
    canonicalDuplicatesRemoved: reservoir.stats.duplicates,
    inactivePublisherSubjectIds: [...inactivePublisherIds],
  };
  process.stdout.write(`${JSON.stringify({ event: 'cycle', ...snapshot })}\n`);
  return snapshot;
}

async function main() {
  const startedAtMs = Date.now();
  const packageRoot = process.env.DISCOVER_HEALTH_PACKAGE_ROOT
    ? path.resolve(process.env.DISCOVER_HEALTH_PACKAGE_ROOT)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-health-'));
  const store = new MemoryNetworkItemStore();
  const snapshots = [];
  const endAtMs = startedAtMs + DURATION_MS;
  let cycle = 0;
  while (true) {
    cycle += 1;
    snapshots.push(await runCycle({ packageRoot, store, cycle }));
    if (Date.now() >= endAtMs) break;
    const waitMs = Math.min(INTERVAL_MS, Math.max(0, endAtMs - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const finishedAt = new Date().toISOString();
  const views = await listContentSourceViews(packageRoot, finishedAt);
  const healthy = views.filter((source) => source.availability === 'available');
  const domains = new Set(healthy.map((source) => new URL(source.url).hostname.replace(/^www\./, '')));
  const inactivePublisherIds = new Set(
    views
      .filter((source) => source.availability !== 'available')
      .map((source) => sourcePublisherId(source.url)),
  );
  const items = (await listStore(store, finishedAt)).filter(
    (item) => !inactivePublisherIds.has(item.publisherSubjectId),
  );
  const expressions = new Set(items.map((item) => item.content.contentType || 'article'));
  const reservoir = buildDiscoverCandidateReservoir({
    items,
    now: finishedAt,
    capacity: DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  });
  const cursorTransitions = snapshots.flatMap((snapshot) => snapshot.cursorTransitions);
  const continuationTransitions = cursorTransitions.filter(
    (transition) => transition.from && transition.to && transition.from !== transition.to,
  );
  const elapsedMs = Date.now() - startedAtMs;
  const gate = {
    requiredObservationMs: 30 * 60 * 1000,
    actualObservationMs: elapsedMs,
    requiredHealthySources: 20,
    actualHealthySources: healthy.length,
    requiredDomains: 6,
    actualDomains: domains.size,
    requiredExpressions: 4,
    actualExpressions: expressions.size,
    requiredReservoirItems: 60,
    actualReservoirItems: reservoir.items.length,
    cursorTransitions: cursorTransitions.length,
    requiredContinuationTransitions: 1,
    actualContinuationTransitions: continuationTransitions.length,
  };
  const pass =
    gate.actualObservationMs >= gate.requiredObservationMs &&
    gate.actualHealthySources >= gate.requiredHealthySources &&
    gate.actualDomains >= gate.requiredDomains &&
    gate.actualExpressions >= gate.requiredExpressions &&
    gate.actualReservoirItems >= gate.requiredReservoirItems &&
    gate.actualContinuationTransitions >= gate.requiredContinuationTransitions;
  const report = {
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt,
    elapsedMs,
    requestedDurationMs: DURATION_MS,
    packageRoot,
    cycles: snapshots,
    healthySourceIds: healthy.map((source) => source.id),
    inactivePublisherSubjectIds: [...inactivePublisherIds],
    domains: [...domains].sort(),
    expressions: [...expressions].sort(),
    continuationTransitions,
    gate: { ...gate, result: pass ? 'PASS' : 'FAIL' },
  };
  const output = process.env.DISCOVER_HEALTH_OUTPUT;
  if (output) {
    const target = path.resolve(output);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ event: 'final', report }, null, 2)}\n`);
  if (ENFORCE && !pass) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { listStore, runCycle };
