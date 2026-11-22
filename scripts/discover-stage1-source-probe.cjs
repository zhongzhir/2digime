#!/usr/bin/env node
/* Read-only source candidate probe through the product's real safe ingestion path. */
const { MemoryNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { ingestSource } = require('../dist/subject-comm/content-ingest.js');

async function probe(url) {
  const store = new MemoryNetworkItemStore();
  try {
    const result = await ingestSource({
      sourceUrl: url,
      store,
      limit: 12,
      now: new Date().toISOString(),
      via: 'feed',
    });
    const unavailable = result.records.filter(
      (record) => record.status === 'unavailable' || record.status === 'rejected',
    );
    return {
      url,
      ok: unavailable.length === 0 && result.items.length > 0,
      itemCount: result.items.length,
      contentTypes: [...new Set(result.items.map((item) => item.content.contentType || 'article'))],
      reasons: [...new Set(unavailable.map((record) => record.reason).filter(Boolean))],
      sampleTitles: result.items.slice(0, 2).map((item) => item.content.title),
    };
  } catch (error) {
    return {
      url,
      ok: false,
      itemCount: 0,
      contentTypes: [],
      reasons: [String(error?.code || error?.message || 'source_error')],
      sampleTitles: [],
    };
  }
}

async function main() {
  const urls = process.argv.slice(2).filter((url) => /^https?:\/\//i.test(url));
  if (!urls.length) throw new Error('provide one or more public HTTP(S) source URLs');
  const rows = [];
  for (const url of urls) rows.push(await probe(url));
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  if (!rows.some((row) => row.ok)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
