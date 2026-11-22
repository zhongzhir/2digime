'use strict';
// 用法：node summarize-replay.cjs <run-name>  汇总 ui-trace.json：搜索时间线、终态、卡片明细、滚动加载、原站打开、播放。
const fs = require('node:fs');
const path = require('node:path');
const DATA = require('./data-root.cjs');

const rows = JSON.parse(fs.readFileSync(path.join(DATA, 'runs', process.argv[2], 'ui-trace.json'), 'utf8'));
const pick = (kind) => rows.filter((r) => r.kind === kind);
const submit = rows.find((r) => r.kind === 'submit');
for (const r of rows) {
  if (r.kind === 'seek' || r.kind === 'cancel' || r.kind === 'open') {
    const rel = submit && r.t >= submit.t ? `+${((r.t - submit.t) / 1000).toFixed(0)}s` : `${(r.t / 1000).toFixed(0)}s`;
    console.log(`${rel.padStart(6)} ${r.kind} rep=${r.replenishing} status=${r.status || '-'} cards=${r.cards} rel=${r.related} empty=${r.emptyShown} notice=${(r.notice || '').slice(0, 50)}`);
  } else if (!['layout.wide.open', 'layout.narrow.open', 'click', 'ready'].includes(r.kind) || process.env.ALL) {
    if (r.kind === 'cards.detail') {
      console.log('cards.detail');
      for (const c of r.cards) console.log(`  · ${c.title} | ${c.meta}\n      理由: ${c.reason}\n      按钮: ${c.buttons.join(' / ')}`);
    } else console.log(r.kind, JSON.stringify(Object.assign({}, r, { t: undefined, kind: undefined })).slice(0, 600));
  }
}
void pick;
