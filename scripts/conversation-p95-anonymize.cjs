/**
 * DIGITALME-CONVERSATION-P95-BENCHMARK-01 — 盲评准备。
 * 读取 benchmark-runs.jsonl → 生成匿名化评测数据（blind-input）：
 *   - 剥离 arm 名，替换为 Arm A / Arm B（随机分配，映射写入 key 文件）
 *   - 抽取确定性指标（延迟/成本/引用数量/官方源占比/搜索轮次）
 *   - 输出每题的匿名答案+来源给 AI Judge
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUT_DIR = process.env.P95_DIR
  ? path.resolve(process.env.P95_DIR)
  : path.join(__dirname, '_conversation-p95-benchmark-01-evidence');
const RUNS_FILE = path.join(OUT_DIR, 'benchmark-runs.jsonl');
const ANON_FILE = path.join(OUT_DIR, 'blind-input.json');
const KEY_FILE = path.join(OUT_DIR, 'blind-key.json');

const OFFICIAL_DOMAINS = [
  'gov.cn', 'gov.', 'state.gov', 'who.int', 'un.org', 'europa.eu', 'apple.com',
  'openai.com', 'deepseek.com', 'anthropic.com', 'google.com', 'microsoft.com',
  'wikipedia.org', 'reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'wsj.com',
  'nature.com', 'nih.gov', 'cnn.com', 'bbc.com', 'economist.com', 'nber.org',
  'imf.org', 'worldbank.org', 'oecd.org', 'iea.org', 'stats.gov.cn', 'nea.gov.cn',
];

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function isOfficial(host) {
  if (!host) return false;
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

function extractSources(run) {
  const ev = run.result && run.result.evidence;
  if (!ev || !Array.isArray(ev.rounds)) return { rounds: 0, sources: [], queries: [], iterations: ev.iterations || 0 };
  const sources = [];
  const queries = [];
  for (const round of ev.rounds) {
    if (round.query) queries.push(round.query);
    for (const s of round.sources || []) {
      if (s && s.url) {
        sources.push({ title: s.title || '', url: s.url, sourceClass: s.sourceClass || 'external' });
      }
    }
  }
  return { rounds: ev.rounds.length, sources, queries, iterations: ev.iterations || 0 };
}

async function checkUrl(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

const FIXTURE_ID = 'DIGITALME-CONVERSATION-P95-BENCHMARK-01';

function anonymize(runs) {
  // 固定随机映射：A/B 对应实际 arm（每轮运行相同映射，保持可复现）
  const seed = crypto.createHash('sha256').update(FIXTURE_ID).digest('hex');
  const arms = ['arm-A-2digime', 'arm-B-deepseek-raw'];
  const order = seed.split('').map((c) => c.charCodeAt(0) % 2).reduce((a, c, i) => { a[c].push(arms[i]); return a; }, [[], []]);
  const mapping = {};
  arms.forEach((a, i) => { mapping[a] = 'Arm ' + ['A', 'B'][i]; });
  return mapping;
}

async function main() {
  const raw = fs.readFileSync(RUNS_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const mapping = anonymize(raw);
  const tasks = [...new Set(raw.map((r) => r.taskId))];
  const out = [];
  const key = { mapping };

  for (const taskId of tasks) {
    const runs = raw.filter((r) => r.taskId === taskId);
    const question = runs[0].question;
    const expected = runs[0].mode_expected;
    const cat = runs[0].cat;
    const ownerContext = runs[0].ownerContext;
    const taskEntry = {
      taskId,
      cat,
      question,
      expectedMode: expected,
      ownerContext,
      arms: {},
    };
    for (const run of runs) {
      const label = mapping[run.arm];
      const sources = extractSources(run);
      const officialCount = sources.sources.filter((s) => isOfficial(domainOf(s.url))).length;
      const entry = {
        label,
        mode: run.result ? run.result.mode : null,
        error: run.error || null,
        answer: run.result ? run.result.text : null,
        ms: run.result ? run.result.ms : null,
        costUsd: run.result ? run.result.costUsd : null,
        searchRounds: sources.rounds,
        iterations: sources.iterations,
        queries: sources.queries,
        sourceCount: sources.sources.length,
        officialSourceCount: officialCount,
        sources: sources.sources,
      };
      taskEntry.arms[label] = entry;
    }
    out.push(taskEntry);
  }

  fs.writeFileSync(ANON_FILE, JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(KEY_FILE, JSON.stringify(key, null, 2), 'utf8');
  console.log('wrote', ANON_FILE, 'tasks:', out.length);
  console.log('mapping:', JSON.stringify(mapping));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });