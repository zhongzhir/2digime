'use strict';
const fs = require('node:fs');
const t = JSON.parse(fs.readFileSync('D:/Projects/_dm-audit-data/discover-actual-failure-audit-01/runs/quality-05/trace.json', 'utf8'));
console.log('totalMs', t.totalMs);
for (const e of t.trace) {
  if (e.kind === 'content.call' || e.kind === 'content.return' || String(e.kind || '').startsWith('after') || e.kind === 'adjust-first-paint' || e.kind === 'revoke-first-paint') {
    if (e.kind === 'content.call') {
      console.log('CALL', e.t, e.label, e.payload && String(JSON.stringify(e.payload)).slice(0, 80));
    } else if (e.kind === 'content.return') {
      const v = e.view || {};
      console.log('RET ', e.t, e.label, e.ms, v.reasonCode, 'cards', (v.cards || []).length, 'access', v.access, 'replenishing', v.replenishing, 'banner', !!(v.adjustment));
    } else {
      const v = e.view || {};
      console.log(e.kind, {
        reason: v.reasonCode,
        n: (v.cards || []).length,
        access: v.access,
        replenishing: v.replenishing,
        banner: !!(v.adjustment),
        titles: (v.cards || []).map((c) => c.title),
        cond: (v.cards || []).map((c) => c.condNote || c.cond),
        accessState: (v.cards || []).map((c) => c.access),
        notice: v.notice,
      });
    }
  }
}
