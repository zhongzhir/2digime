'use strict';
// 用法：node judge-report.cjs <run-name>
// 列出：意图调用、每批相关性判断的请求候选 / 原始响应 / finish_reason / 解析结果，以及每次 content 返回的视图。
const fs = require('node:fs');
const path = require('node:path');
const DATA = require('./data-root.cjs');

const run = process.argv[2];
const file = path.join(DATA, 'runs', run, 'trace.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const trace = data.trace || [];
const starts = new Map();
for (const row of trace) if (row.kind === 'fetch.start') starts.set(row.id, row);

const out = [];
const say = (s) => out.push(s);
say(`# ${run}  scenario=${data.scenario}  totalMs=${data.totalMs}`);
for (const row of trace) {
  if (row.kind === 'fetch.end' || row.kind === 'fetch.error') {
    const st = starts.get(row.id);
    const req = st && st.reqSummary;
    if (!req || typeof req !== 'object' || !req.system) continue;
    const kind = /判断每个候选/.test(req.system)
      ? 'JUDGE'
      : /判断用户在「发现」里/.test(req.system)
        ? 'INTENT'
        : /提取|节目/.test(req.system)
          ? 'OTHER'
          : 'LLM';
    say(`\n## ${kind} fetch#${row.id} t=${st.t}..${row.t} ms=${row.ms} status=${row.status || row.kind} maxTokens=${req.maxTokens}`);
    if (kind === 'JUDGE') {
      try {
        const u = JSON.parse(req.lastUser.replace(/…\(\+\d+\)$/, ''));
        for (const c of u.candidates || []) say(`  cand ${c.id} [${c.contentType}] ${String(c.title).slice(0, 60)} | ${c.url}`);
      } catch {
        say(`  lastUser(trunc): ${req.lastUser.slice(0, 600)}`);
      }
    } else if (kind === 'INTENT') {
      say(`  user: ${String(req.lastUser).slice(0, 300)}`);
    }
    if (row.body) {
      let finish = '';
      let content = '';
      try {
        const b = JSON.parse(row.body.replace(/…\(\+\d+\)$/, ''));
        finish = b.choices && b.choices[0] && b.choices[0].finish_reason;
        content = b.choices && b.choices[0] && b.choices[0].message && b.choices[0].message.content;
        const usage = b.usage ? JSON.stringify(b.usage) : '';
        say(`  finish=${finish} usage=${usage}`);
      } catch {
        say(`  body(unparsed,${row.bytes}B): ${row.body.slice(0, 300)}`);
      }
      if (content) say(`  content: ${content.replace(/\s+/g, ' ').slice(0, 1800)}`);
    }
    if (row.kind === 'fetch.error') say(`  error: ${row.name} ${row.msg}`);
  }
  if (row.kind === 'content.return') {
    const v = row.view || {};
    say(`\n## VIEW ${row.label} t=${row.t} ms=${row.ms} replenishing=${v.replenishing} notice=${v.notice}`);
    for (const c of v.cards || []) say(`  card  [${c.type}] ${c.title} | ${c.host} fid=${c.fidelity} media=${c.media}`);
    for (const c of v.relatedRows || []) say(`  rel   [${c.type}] ${c.title} | ${c.host}`);
    say(`  unjudged=${v.unjudged} ${JSON.stringify(v.unjudgedTitles || [])}`);
    const st = v.seekTrace;
    if (st) {
      say(`  trace raw=${st.raw} primary=${st.primary} about=${st.about} unrelated=${st.unrelated} selected=${st.selected} hits=${st.hits}`);
      for (const it of st.items || []) say(`    ${it.fid.padEnd(15)} typeOk=${it.typeOk} sel=${it.sel} vis=${it.vis} [${it.type}] ${it.origin} ${it.title}`);
    }
  }
  if (row.kind === 'content.throw' || row.kind === 'fatal') say(`\n## ${row.kind} ${row.msg}`);
}
fs.writeFileSync(path.join(DATA, 'runs', run, 'judge-report.txt'), out.join('\n'));
console.log(out.join('\n'));
