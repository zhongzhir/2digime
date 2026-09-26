'use strict';
// Real source-health + coverage snapshot for DISCOVER-2.0-SOURCE-COVERAGE-07.
// Fetches every registered domestic Feed once and records availability, counts and types.
const fs = require('node:fs/promises');
const { acquirePublicFeeds, sourceHealthSnapshot } = require('../dist/subject-comm/news-supply');

(async () => {
  const started = Date.now();
  const cards = await acquirePublicFeeds();
  const elapsed = Date.now() - started;
  const health = sourceHealthSnapshot();
  const byHost = new Map();
  const byType = {};
  for (const c of cards) {
    const type = c.contentType || 'article';
    byType[type] = (byType[type] || 0) + 1;
    let host = ''; try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch { /* */ }
    if (host) byHost.set(host, (byHost.get(host) || 0) + 1);
  }
  const out = {
    at: new Date().toISOString(), elapsedMs: elapsed, totalCards: cards.length,
    distinctHosts: byHost.size, byType,
    byCategory: health.reduce((acc, h) => { acc[h.category] = (acc[h.category] || 0) + (h.availability === 'AVAILABLE' ? 1 : 0); return acc; }, {}),
    available: health.filter((h) => h.availability === 'AVAILABLE').length,
    unavailable: health.filter((h) => h.availability !== 'AVAILABLE').map((h) => ({ label: h.label, reason: h.lastFailureReason })),
    sources: health,
  };
  await fs.mkdir('docs/audits/evidence/source-coverage-07', { recursive: true });
  await fs.writeFile('docs/audits/evidence/source-coverage-07/source-health.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ elapsedMs: elapsed, totalCards: cards.length, distinctHosts: byHost.size, byType, byCategory: out.byCategory, available: out.available, unavailable: out.unavailable }, null, 2));
})().catch((e) => { console.error(e.name, e.message); process.exitCode = 1; });
