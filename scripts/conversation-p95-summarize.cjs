/**
 * DIGITALME-CONVERSATION-P95-BENCHMARK-01 — 汇总计算。
 * 输入：benchmark-runs.jsonl + blind-scores.json + blind-key.json
 * 输出：benchmark-summary.json
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = process.env.P95_DIR
  ? path.resolve(process.env.P95_DIR)
  : path.join(__dirname, '_conversation-p95-benchmark-01-evidence');
const RUNS = fs.readFileSync(path.join(OUT_DIR, 'benchmark-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SCORES = require(path.join(OUT_DIR, 'blind-scores.json'));
const KEY = require(path.join(OUT_DIR, 'blind-key.json'));

const DIMENSIONS = [
  'correctness', 'freshness', 'source_quality', 'citation_entailment', 'citation_completeness',
  'coverage', 'contradiction_handling', 'reasoning', 'research_depth',
  'personalization_usefulness', 'irrelevant_personalization_penalty',
];

const DETERMINISTIC_DIMENSIONS = ['latency', 'cost'];

// 反向映射：Arm A/B -> 真实 arm
const reverseMap = {};
for (const [realArm, label] of Object.entries(KEY.mapping)) reverseMap[label] = realArm;

// 确定性指标：URL 可达性检查（抽样：每题每 arm 最多 5 个 URL）
async function checkUrls(urls) {
  const results = [];
  for (const u of urls) {
    let ok = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      ok = res.ok || (res.status >= 200 && res.status < 500);
    } catch { ok = false; }
    results.push(ok);
  }
  return results;
}

async function main() {
  const runsByTaskArm = {};
  for (const r of RUNS) {
    if (!r.taskId || !r.arm) continue;
    runsByTaskArm[r.taskId] = runsByTaskArm[r.taskId] || {};
    runsByTaskArm[r.taskId][r.arm] = r;
  }

  const summary = {
    id: 'DIGITALME-CONVERSATION-P95-BENCHMARK-01',
    arms: {},
    perDimension: {},
    byCategory: {},
    hardFails: [],
    notes: {},
  };

  const armAgg = {};
  const dimAgg = {};
  const catAgg = {};

  for (const label of ['Arm A', 'Arm B']) {
    armAgg[label] = { scoreSum: 0, scoreCount: 0, perDim: {}, latencyMs: [], costUsd: [], tasks: 0, errors: 0 };
    for (const d of DIMENSIONS) armAgg[label].perDim[d] = [];
    armAgg[label].perDim.latency = [];
    armAgg[label].perDim.cost = [];
  }
  for (const d of [...DIMENSIONS, ...DETERMINISTIC_DIMENSIONS]) dimAgg[d] = { sum: 0, count: 0 };

  const hardFailTags = [];

  for (const score of SCORES) {
    const taskId = score.taskId;
    const cat = score.cat;
    for (const label of ['Arm A', 'Arm B']) {
      const realArm = reverseMap[label];
      const run = runsByTaskArm[taskId] && runsByTaskArm[taskId][realArm];
      const armScore = score[label];
      const agg = armAgg[label];
      agg.tasks++;
      if (run && run.error) agg.errors++;
      if (!armScore || !armScore.scores) {
        console.log('missing scores', taskId, label);
        continue;
      }
      // AI judge 维度
      for (const d of DIMENSIONS) {
        let v = armScore.scores[d];
        if (typeof v !== 'number' || Number.isNaN(v)) v = 0;
        agg.perDim[d].push(v);
        dimAgg[d].sum += v; dimAgg[d].count++;
        agg.scoreSum += v; agg.scoreCount++;
      }
      // 确定性：latency / cost
      if (run && run.result) {
        agg.perDim.latency.push(run.result.ms || 0);
        agg.perDim.cost.push(run.result.costUsd || 0);
        dimAgg.latency.sum += (run.result.ms || 0); dimAgg.latency.count++;
        dimAgg.cost.sum += (run.result.costUsd || 0); dimAgg.cost.count++;
      }
      // 来源 URL 可达性
      let sourceUrls = [];
      if (run && run.result && run.result.evidence && Array.isArray(run.result.evidence.rounds)) {
        for (const rd of run.result.evidence.rounds) {
          for (const s of rd.sources || []) if (s.url) sourceUrls.push(s.url);
        }
      }
      const unique = [...new Set(sourceUrls)];
      const checked = await checkUrls(unique.slice(0, 5));
      const reachable = checked.filter(Boolean).length;
      agg.perDim.urlReachability = agg.perDim.urlReachability || [];
      agg.perDim.urlReachability.push(unique.length ? reachable / Math.max(1, checked.length) : null);

      // hard fail：correctness=0
      if (armScore.scores.correctness === 0) {
        hardFailTags.push({ taskId, label, realArm });
      }

      // 分类聚合
      catAgg[cat] = catAgg[cat] || { [label]: [] };
      catAgg[cat][label] = catAgg[cat][label] || [];
      catAgg[cat][label].push({
        correctness: armScore.scores.correctness,
        freshness: armScore.scores.freshness,
        source_quality: armScore.scores.source_quality,
        citation_entailment: armScore.scores.citation_entailment,
        citation_completeness: armScore.scores.citation_completeness,
        coverage: armScore.scores.coverage,
        reasoning: armScore.scores.reasoning,
        research_depth: armScore.scores.research_depth,
        ms: run && run.result ? run.result.ms : null,
        cost: run && run.result ? run.result.costUsd : null,
      });
    }
  }

  for (const label of ['Arm A', 'Arm B']) {
    const agg = armAgg[label];
    const realArm = reverseMap[label];
    summary.arms[label] = {
      realArm,
      tasks: agg.tasks,
      errors: agg.errors,
      avgScore: agg.scoreCount ? +(agg.scoreSum / agg.scoreCount).toFixed(2) : null,
      perDim: {},
    };
    for (const d of DIMENSIONS) {
      const vals = agg.perDim[d] || [];
      summary.arms[label].perDim[d] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
    }
    summary.arms[label].perDim.latency = agg.perDim.latency.length ? Math.round(agg.perDim.latency.reduce((a, b) => a + b, 0) / agg.perDim.latency.length) : null;
    summary.arms[label].perDim.cost = agg.perDim.cost.length ? +(agg.perDim.cost.reduce((a, b) => a + b, 0) / agg.perDim.cost.length).toFixed(4) : null;
    const urls = agg.perDim.urlReachability || [];
    const urlVals = urls.filter((u) => u !== null);
    summary.arms[label].perDim.urlReachability = urlVals.length ? +(urlVals.reduce((a, b) => a + b, 0) / urlVals.length).toFixed(2) : null;
    summary.arms[label].totalCostUsd = agg.perDim.cost.length ? +(agg.perDim.cost.reduce((a, b) => a + b, 0)).toFixed(4) : null;
  }

  summary.perDimension = {};
  for (const d of [...DIMENSIONS, ...DETERMINISTIC_DIMENSIONS]) {
    summary.perDimension[d] = { avg: dimAgg[d].count ? +(dimAgg[d].sum / dimAgg[d].count).toFixed(2) : null };
    summary.perDimension[d].armA = summary.arms['Arm A'].perDim[d];
    summary.perDimension[d].armB = summary.arms['Arm B'].perDim[d];
  }

  summary.byCategory = {};
  for (const cat of Object.keys(catAgg)) {
    summary.byCategory[cat] = {};
    for (const label of ['Arm A', 'Arm B']) {
      const items = catAgg[cat][label] || [];
      if (!items.length) { summary.byCategory[cat][label] = null; continue; }
      summary.byCategory[cat][label] = {
        n: items.length,
        correctness: +(items.reduce((a, b) => a + b.correctness, 0) / items.length).toFixed(2),
        source_quality: +(items.reduce((a, b) => a + b.source_quality, 0) / items.length).toFixed(2),
        citation_entailment: +(items.reduce((a, b) => a + b.citation_entailment, 0) / items.length).toFixed(2),
        reasoning: +(items.reduce((a, b) => a + b.reasoning, 0) / items.length).toFixed(2),
        research_depth: +(items.reduce((a, b) => a + b.research_depth, 0) / items.length).toFixed(2),
        avgMs: Math.round(items.reduce((a, b) => a + (b.ms || 0), 0) / items.length),
        totalCost: +(items.reduce((a, b) => a + (b.cost || 0), 0)).toFixed(4),
      };
    }
  }

  summary.hardFails = hardFailTags;

  // 个性化专项（G 类）
  const gScores = SCORES.filter((s) => s.cat === 'G');
  summary.personalization = { tasks: gScores.length, detail: [] };
  for (const s of gScores) {
    const row = { taskId: s.taskId };
    for (const label of ['Arm A', 'Arm B']) {
      const realArm = reverseMap[label];
      row[label] = {
        realArm,
        personalization_usefulness: s[label] && s[label].scores ? s[label].scores.personalization_usefulness : null,
        irrelevant_personalization_penalty: s[label] && s[label].scores ? s[label].scores.irrelevant_personalization_penalty : null,
      };
    }
    summary.personalization.detail.push(row);
  }

  // Deep Research 过程指标（F 类）
  const fRuns = RUNS.filter((r) => r.arm === 'arm-A-2digime' && r.taskId && r.taskId.startsWith('F-'));
  summary.deepResearch = {
    note: '仅 2digime 有真实 deep_research 过程；DeepSeek 裸 API 无搜索过程。',
    iterations: {},
    queries: {},
    sourceCounts: {},
  };
  for (const r of fRuns) {
    const ev = r.result && r.result.evidence;
    const rounds = (ev && Array.isArray(ev.rounds)) ? ev.rounds : [];
    const srcs = rounds.reduce((a, rd) => a + (rd.sources || []).length, 0);
    summary.deepResearch.iterations[r.taskId] = ev ? ev.iterations : null;
    summary.deepResearch.queries[r.taskId] = rounds.map((rd) => rd.query);
    summary.deepResearch.sourceCounts[r.taskId] = srcs;
  }

  // 决策一致性：期望模式 vs 实际模式（Arm A）
  const fixture = require(path.join(__dirname, 'fixtures', 'conversation-p95-benchmark-01.json'));
  const exp = {};
  fixture.tasks.forEach((t) => { exp[t.id] = t.mode; });
  const decisionMismatch = [];
  const decisionCount = { no_search: { exp: 0, act: 0 }, web_search: { exp: 0, act: 0 }, deep_research: { exp: 0, act: 0 } };
  for (const r of RUNS.filter((x) => x.arm === 'arm-A-2digime')) {
    const e = exp[r.taskId];
    decisionCount[e].exp++;
    decisionCount[r.result.mode].act++;
    if (e !== r.result.mode) {
      decisionMismatch.push({ taskId: r.taskId, expected: e, actual: r.result.mode });
    }
  }
  summary.decision = {
    armA: decisionCount,
    mismatches: decisionMismatch,
    note: '自动决策与 fixture 期望的偏差；实际模式以模型判断为准（含硬覆盖/特征正则/模型 json 判断）。',
  };

  // 结论（不自动判定 P95）
  summary.conclusion = {
    market_p95_met: false,
    p95_candidate: false,
    defaultPerTask: '本任务默认 market_p95_met=false（无真实市场头部对照 arm 可运行；禁止因功能齐全或多数题通过即宣称 P95）。',
  };

  fs.writeFileSync(path.join(OUT_DIR, 'benchmark-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('wrote benchmark-summary.json');
  console.log('Arm A avg:', summary.arms['Arm A'].avgScore, 'Arm B avg:', summary.arms['Arm B'].avgScore);
  console.log('hard fails:', hardFailTags.length);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });