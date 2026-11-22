#!/usr/bin/env node
/* Bounded, no-model-cost live check for DISCOVER-50-STAGE1 supply. */
const { MemoryNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { ingestSource } = require('../dist/subject-comm/content-ingest.js');
const {
  listOpenCatalog,
  networkItemFromOpenHit,
  searchOpenWorks,
} = require('../dist/subject-comm/content-source-capabilities.js');
const { catalogEndpointsFor } = require('../dist/subject-comm/open-source-catalog.js');
const {
  buildDiscoverCandidateReservoir,
  DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
} = require('../dist/subject-comm/discover-candidate-reservoir.js');

async function main() {
  const now = new Date().toISOString();
  const store = new MemoryNetworkItemStore();
  const feeds = catalogEndpointsFor(['article', 'video', 'image', 'audio'])
    .filter((endpoint) => endpoint.kind === 'media_rss');
  const feedRuns = await Promise.all(
    feeds.map(async (endpoint) => {
      const result = await ingestSource({ sourceUrl: endpoint.url, store, limit: 12, now, via: 'feed' });
      return { id: endpoint.id, items: result.items.length };
    }),
  );
  const [media, works] = await Promise.all([
    listOpenCatalog({ kinds: ['video', 'image', 'audio'] }),
    searchOpenWorks(),
  ]);
  for (const hit of [...media, ...works]) {
    const item = networkItemFromOpenHit(hit, now, 'feed');
    if (item) await store.put(item);
  }

  const items = [];
  let cursor;
  do {
    const page = await store.list({ limit: 100, ...(cursor ? { cursor } : {}) }, now);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  const reservoir = buildDiscoverCandidateReservoir({
    items,
    now,
    capacity: DEFAULT_DISCOVER_RESERVOIR_CAPACITY,
  });
  const report = {
    checkedAt: now,
    feedSourcesAttempted: feedRuns.length,
    feedSourcesWithItems: feedRuns.filter((row) => row.items > 0).length,
    feedItems: feedRuns.reduce((sum, row) => sum + row.items, 0),
    openMediaItems: media.length,
    openWorkItems: works.length,
    directoryItems: items.length,
    reservoirItems: reservoir.items.length,
    reservoirSources: reservoir.stats.sourceCount,
    canonicalDuplicatesRemoved: reservoir.stats.duplicates,
    minimumSupplyGate: {
      requiredItems: 60,
      requiredSources: 6,
      result: reservoir.items.length >= 60 && reservoir.stats.sourceCount >= 6 ? 'PASS' : 'FAIL',
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.minimumSupplyGate.result !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

