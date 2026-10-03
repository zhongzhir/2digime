// 只读分析：对 network-items 逐条跑 validateNetworkItem / isNetworkItemExpired，不删除任何文件
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { validateNetworkItem, isNetworkItemExpired } = require(path.join(ROOT, 'dist/subject-comm/network-item'));
const dir = process.argv[2];
const nowIso = process.argv[3] || new Date().toISOString();
const hist = {}; const samples = {};
let total = 0;
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.json')) continue;
  total += 1;
  let parsed; try { parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { hist.corrupt = (hist.corrupt || 0) + 1; continue; }
  const chk = validateNetworkItem(parsed);
  let key;
  if (!chk.ok) key = 'INVALID:' + String(chk.error || chk.reason || JSON.stringify(chk)).slice(0, 80);
  else if (isNetworkItemExpired(chk.item, nowIso)) key = 'EXPIRED expiresAt=' + String(chk.item.expiresAt).slice(0, 10);
  else key = 'ok';
  hist[key] = (hist[key] || 0) + 1;
  (samples[key] = samples[key] || []).length < 2 && samples[key].push({ created: parsed.createdAt, expires: parsed.expiresAt, type: parsed.content && parsed.content.contentType, via: parsed.provenance && parsed.provenance.via, title: String(parsed.content && parsed.content.title).slice(0, 30) });
}
console.log('now', nowIso, 'total', total);
console.log(JSON.stringify(hist, null, 1));
for (const k of Object.keys(samples)) if (k !== 'ok') console.log(k, JSON.stringify(samples[k]));
