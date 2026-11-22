'use strict';
const fs = require('node:fs');
const t = JSON.parse(
  fs.readFileSync('D:/Projects/_dm-audit-data/discover-actual-failure-audit-01/runs/delivery-04/trace.json', 'utf8'),
);
console.log('totalMs', t.totalMs, 'events', t.trace.length);
const starts = t.trace.filter((e) => e.kind === 'fetch.start' && String(e.url || '').includes('web-discovery/search'));
console.log('managed_searches', starts.map((e) => e.reqSummary));
const views = t.trace.filter((e) => e.kind === 'content.return' || String(e.kind || '').startsWith('after-'));
for (const v of views) {
  const view = v.view || {};
  console.log('\nVIEW', v.label || v.kind, view.reasonCode, 'cards', (view.cards || []).length, 'related', view.related, 'ms', v.ms);
  console.log(' notice', view.notice);
  if (view.adjustment) console.log(' adj', view.adjustment.summary, '| q=', view.adjustment.question || '');
  for (const c of (view.cards || []).slice(0, 8)) console.log('  *', c.title, '|', c.host, '|', c.reason);
  for (const c of (view.relatedRows || []).slice(0, 4)) console.log('  rel', c.title, c.host, c.fidelity);
}
