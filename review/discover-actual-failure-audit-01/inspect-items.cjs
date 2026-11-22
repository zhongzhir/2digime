// 只读：汇总 owner-copy 里今天写入的 network-items
const fs = require('fs'), path = require('path');
const DATA = require('./data-root.cjs');
const dir = path.join(DATA, 'owner-copy/userData/subjects/default/content/network-items');
const since = new Date('2026-10-03T11:50:00+08:00').getTime();
const rows = [];
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f); const st = fs.statSync(p);
  if (st.mtimeMs < since) continue;
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  rows.push({ t: new Date(st.mtimeMs).toLocaleTimeString('zh-CN', { hour12: false }), j });
}
rows.sort((a, b) => a.t.localeCompare(b.t));
console.log('count', rows.length);
for (const r of rows) {
  const j = r.j, c = j.content || {}; let host = ''; try { host = new URL(c.url || '').host; } catch {}
  console.log([r.t, j.itemId.slice(0, 11), c.contentType, c.consumption, host, j.provenance?.via, (c.title || '').slice(0, 34), '«' + (c.text || '').slice(0, 26).replace(/\s+/g, ' ') + '»'].join(' | '));
}
