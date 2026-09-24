'use strict';
const fs = require('node:fs/promises');
const { acquirePublicFeeds, selectSupply } = require('../dist/subject-comm/news-supply');
const { resolveContent } = require('../dist/subject-comm/content-resolution');
const { readRuntimeModelCredential } = require('../dist/infrastructure/env-secrets');
const { chatComplete } = require('../dist/infrastructure/model-http');
(async () => {
  const cards = await acquirePublicFeeds();
  // This exact URL is the Owner-requested regression from the prior real audit, not product supply.
  const old = cards.find(c => c.url === 'https://sspai.com/post/114395');
  if (!old) throw Error('Previous real sample no longer in public feed');
  const resolved = await resolveContent(old);
  const credential = await readRuntimeModelCredential();
  if (!credential || new URL(credential.baseUrl).origin !== 'https://api.deepseek.com') throw Error('DeepSeek required');
  const result = await selectSupply({ cards: [resolved], query: '今天发表的文章', selfContext: '', preferences: '', resolve: false,
    model: { baseUrl: credential.baseUrl, model: credential.model },
    chatComplete: options => chatComplete({ ...options, apiKey: credential.apiKey }) });
  const row = { at: new Date().toISOString(), url: old.url, feedPublishedAt: old.publishedAt,
    publishedAt: resolved.publishedAt, sourceFeedTimestamp: resolved.sourceFeedTimestamp,
    originalPublishedAt: resolved.originalPublishedAt, discoveredAt: resolved.discoveredAt,
    updatedAt: resolved.updatedAt, provenance: resolved.dateProvenance,
    bodyCharacters: resolved.representation?.bodyText?.length || 0,
    todayQuerySelectedCount: result.length };
  await fs.mkdir('docs/audits/evidence/news-reliability-03', { recursive: true });
  await fs.writeFile('docs/audits/evidence/news-reliability-03/date.json', JSON.stringify(row, null, 2));
  console.log(JSON.stringify(row));
})().catch(e => { console.error(e.name, e.code || ''); process.exitCode = 1; });
