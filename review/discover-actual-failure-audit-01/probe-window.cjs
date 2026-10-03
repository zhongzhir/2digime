// 只读探针（在 owner-copy 副本上）：loadDiscoverItems 的 limit:80 窗口到底取到了哪些条目
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { FileNetworkItemStore } = require(path.join(ROOT, 'dist/relay-service/network-item-store'));
const dir = path.join(__dirname, process.argv[2] || 'owner-copy', 'userData/subjects/default/content');
(async () => {
  const s = new FileNetworkItemStore(dir);
  const now = new Date().toISOString();
  const win = (await s.list({ kind: 'content', visibility: 'public', limit: 80 }, now)).items;
  const all = (await s.list({ kind: 'content', visibility: 'public', limit: 5000 }, now)).items;
  console.log('store total:', all.length, '| window returned:', win.length);
  console.log('window createdAt:', win[0].createdAt, '->', win[win.length - 1].createdAt);
  console.log('store  createdAt:', all[0].createdAt, '->', all[all.length - 1].createdAt);
  const cutoff = Date.now() - 21 * 86400000;
  const recent = (arr) => arr.filter((i) => { const p = Date.parse(i.content.publishedAt || ''); return !Number.isFinite(p) || p >= cutoff; });
  console.log('21d-recent (publishedAt) in window:', recent(win).length, '| in whole store:', recent(all).length);
  const byDay = {};
  for (const i of all) { const d = i.createdAt.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
  console.log('createdAt by day:', JSON.stringify(byDay));
  const winDays = {};
  for (const i of win) { const d = i.createdAt.slice(0, 10); winDays[d] = (winDays[d] || 0) + 1; }
  console.log('window by day   :', JSON.stringify(winDays));
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
