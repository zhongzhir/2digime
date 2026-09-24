'use strict';
// Real direct-read proof for >=3 distinct domestic public sites: Feed -> resolve -> Readability body.
// No hardcoded articles; each body comes from the live public page.
const fs = require('node:fs/promises');
const { acquirePublicFeeds } = require('../dist/subject-comm/news-supply');
const { resolveContent } = require('../dist/subject-comm/content-resolution');

(async () => {
  const cards = await acquirePublicFeeds();
  const wanted = ['sspai.com', 'ithome.com', 'ifanr.com', 'chinanews.com.cn', 'gcores.com'];
  const picked = new Map();
  for (const card of cards) {
    if (!card.url) continue;
    let host = '';
    try { host = new URL(card.url).hostname.replace(/^www\./, ''); } catch { continue; }
    const site = wanted.find((w) => host.endsWith(w));
    if (!site || picked.has(site)) continue;
    if (/\/rss|\/feed|\.xml/i.test(card.url)) continue;
    picked.set(site, card);
  }
  const rows = [];
  for (const [site, card] of picked) {
    try {
      const resolved = await resolveContent(card);
      rows.push({
        site,
        url: resolved.url,
        title: resolved.title,
        contentType: resolved.contentType || null,
        bodyCharacters: resolved.representation?.bodyText?.length || 0,
        parse: resolved.representation?.provenance || null,
        publishedAt: resolved.publishedAt || null,
        originalPublishedAt: resolved.originalPublishedAt || null,
        sourceFeedTimestamp: resolved.sourceFeedTimestamp || null,
        provenance: resolved.dateProvenance || null,
      });
    } catch (err) {
      rows.push({ site, url: card.url, error: String(err && err.message || err) });
    }
  }
  await fs.mkdir('docs/audits/evidence/domestic-content-04', { recursive: true });
  await fs.writeFile('docs/audits/evidence/domestic-content-04/articles.json', JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => { console.error(e.name, e.message); process.exitCode = 1; });
