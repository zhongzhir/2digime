'use strict';
// 用法：node fetch-after.cjs <run-name> <t_ms>  列出某时刻之后的网络请求与返回（URL / 状态 / 耗时 / 体积）。
const fs = require('node:fs');
const path = require('node:path');
const DATA = require('./data-root.cjs');

const [run, after] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path.join(DATA, 'runs', run, 'trace.json'), 'utf8'));
const t0 = Number(after || 0);
const starts = new Map();
for (const row of data.trace) {
  if (row.t < t0) continue;
  if (row.kind === 'fetch.start') {
    starts.set(row.id, row);
    const body = typeof row.reqSummary === 'string' ? row.reqSummary.slice(0, 160) : '';
    console.log(`t=${row.t} start#${row.id} ${row.method} ${row.url} ${body}`);
  } else if (row.kind === 'fetch.end' || row.kind === 'fetch.error') {
    console.log(`t=${row.t} ${row.kind}#${row.id} ms=${row.ms} status=${row.status || ''} bytes=${row.bytes || ''} ${row.msg || ''} ${String(row.body || '').slice(0, 300)}`);
  } else if (row.kind.startsWith('content.')) {
    console.log(`t=${row.t} ${row.kind} ${row.label}`);
  }
}
