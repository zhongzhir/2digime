'use strict';
// 用法：node ipc-cards.cjs <run-name>  列出 UI 回放里每次 content 返回的主卡片（标题 / 来源 / objectFidelity / 依据）。
const fs = require('node:fs');
const path = require('node:path');
const DATA = require('./data-root.cjs');

const file = path.join(DATA, 'runs', process.argv[2], 'ipc.ndjson');
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  const view = row && (row.view || (row.result && row.result.view) || (row.out && row.out.view));
  if (!view) continue;
  const head = `${row.kind || row.event || ''} id=${row.id || ''} action=${(row.input && row.input.action) || row.action || ''} gen=${view.searchGenerationId || ''} repl=${view.replenishing} notice=${String(view.notice || '').slice(0, 80)}`;
  console.log(head);
  for (const c of view.cards || []) {
    let host = '';
    try { host = new URL(c.url || '').host; } catch { /* ignore */ }
    console.log(`  [${c.contentType || ''}] ${String(c.title || '').slice(0, 60)} | ${host} fid=${c.objectFidelity || '-'} reason=${String(c.reason || '').slice(0, 70)}`);
  }
}
