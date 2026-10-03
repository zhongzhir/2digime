// 用法: node print-ui.cjs <run-name> [--net]   合并 UI 状态时间线(相对启动)与主进程 IPC/网络时间线(相对主进程启动)
const fs = require('fs'), path = require('path');
const run = path.join(__dirname, 'runs', process.argv[2]);
const net = process.argv.includes('--net');
const ui = JSON.parse(fs.readFileSync(path.join(run, 'ui-trace.json'), 'utf8'));
console.log('=== UI (t=秒, 相对脚本启动)');
for (const e of ui) { const { t, kind, ...r } = e; console.log(String((t / 1000).toFixed(1)).padStart(6), kind.padEnd(13), JSON.stringify(r).slice(0, 360)); }
const f = path.join(run, 'ipc.ndjson');
if (fs.existsSync(f)) {
  console.log('\n=== MAIN-PROCESS IPC (t=秒, 相对主进程启动)');
  const starts = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line); const s = String((e.t / 1000).toFixed(1)).padStart(6);
    if (/^(fetch|get)\./.test(e.k)) { if (net) console.log(s, e.k, JSON.stringify(e).slice(0, 200)); continue; }
    if (e.k === 'ipc.start' && e.name !== 'content') { continue; }
    if (e.k === 'ipc.end' && e.name && e.name !== 'content') { continue; }
    console.log(s, e.k, JSON.stringify(Object.assign({}, e, { t: undefined, k: undefined })).slice(0, 420));
  }
}
