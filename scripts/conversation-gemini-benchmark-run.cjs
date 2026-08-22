/**
 * DIGITALME-SEARCH-PROVIDER-GEMINI-01B — Gemini provider 32 题 benchmark 运行器。
 * Arm A = 当前 Gemini grounded provider（+ Bing 显式 degraded fallback）。
 * Arm B = 既有冻结 baseline（deepseek-raw），不重新配置；本脚本只产出 Arm A。
 *
 * 测试基建：不改产品逻辑、不改 benchmark 题目/rubric。usage/cost 沿用 gate 口径（保守估算）。
 *
 * 运行：QR_EVIDENCE_DIR=<dir> node scripts/conversation-gemini-benchmark-run.cjs
 * 输出：<dir>/benchmark-runs-gemini.jsonl（仅 arm-A-2digime 行）
 */
const fs = require('node:fs');
const path = require('node:path');

const { runConversationSearch } = require('../dist/capability/conversation-search');
const { createGeminiSearchConnector } = require('../dist/capability/adapters/gemini-search');
const { createBingHtmlSearchConnector } = require('../dist/capability/adapters/bing-html-search');
const { buildConversationSystemContent } = require('../dist/subject-core/conversation-context');

const FIXTURE = require('./fixtures/conversation-p95-benchmark-01.json');
const OUT_DIR = process.env.QR_EVIDENCE_DIR
  ? path.resolve(process.env.QR_EVIDENCE_DIR)
  : path.join(__dirname, '_conversation-gemini-benchmark-evidence');
const OUT_FILE = path.join(OUT_DIR, 'benchmark-runs-gemini.jsonl');

const PRICE = {
  gemini: { input: 0.35, output: 1.2 },
  deepseek: { input: 0.55, output: 2.19 },
};

function resolveCredential() {
  const fromEnv = {
    baseUrl: process.env.DIGITALME_CONVERSATION_SEARCH_BASE_URL,
    model: process.env.DIGITALME_CONVERSATION_SEARCH_MODEL,
    apiKey: process.env.DIGITALME_CONVERSATION_SEARCH_API_KEY,
  };
  if (fromEnv.baseUrl && fromEnv.model && fromEnv.apiKey) return fromEnv;
  const devCredential = path.join(__dirname, '..', 'digitalme-v2', 'scripts', '_mvp-p14-real-capability-evidence', '.runtime-model-credential.json');
  if (fs.existsSync(devCredential)) {
    const j = JSON.parse(fs.readFileSync(devCredential, 'utf8'));
    if (j.baseUrl && j.model && j.apiKey) return { baseUrl: j.baseUrl, model: j.model, apiKey: j.apiKey };
  }
  return null;
}

async function rawChat(baseUrl, apiKey, model, messages, opts) {
  const startedAt = Date.now();
  const resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts && typeof opts.temperature === 'number' ? opts.temperature : 0.4,
      max_tokens: opts && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 1600,
      ...(opts && opts.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
    }),
    signal: AbortSignal.timeout(opts && opts.timeoutMs ? opts.timeoutMs : 180000),
  });
  const body = await resp.json();
  const ms = Date.now() - startedAt;
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}: ${JSON.stringify(body).slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }
  const choice = body.choices && body.choices[0];
  const content = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  const reasoning = choice && choice.message && typeof choice.message.reasoning_content === 'string' ? choice.message.reasoning_content : '';
  return { text: content, reasoning, finishReason: choice && choice.finish_reason, usage: body.usage || null, ms };
}

function usageCost(usage) {
  if (!usage) return 0;
  const inT = usage.prompt_tokens || 0;
  const outT = usage.completion_tokens || 0;
  return inT / 1e6 * PRICE.deepseek.input + outT / 1e6 * PRICE.deepseek.output;
}

function geminiCost(usage) {
  if (!usage) return 0;
  const inT = usage.promptTokens || 0;
  const outT = usage.completionTokens || 0;
  return inT / 1e6 * PRICE.gemini.input + outT / 1e6 * PRICE.gemini.output;
}

async function runArmA(credential, task) {
  const deepseekUsage = [];
  const geminiUsage = [];
  const providerErrors = [];
  const chat = async (messages, opts) => {
    const r = await rawChat(credential.baseUrl, credential.apiKey, credential.model, messages, opts);
    if (r.usage) deepseekUsage.push(r.usage);
    if (r.text.trim().length === 0) {
      if (r.finishReason === 'length') return { text: '', finishReason: r.finishReason, truncated: true };
      throw new Error('bad_response empty content');
    }
    return { text: r.text, finishReason: r.finishReason, truncated: r.finishReason === 'length' };
  };
  const bing = createBingHtmlSearchConnector();
  const gkey = process.env.GEMINI_API_KEY;
  const base = createGeminiSearchConnector({
    apiKey: gkey,
    onUsage: (u) => geminiUsage.push({ promptTokens: u.promptTokens, completionTokens: u.completionTokens }),
  });
  const wrapSearch = (fn, name) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      providerErrors.push({ where: name, message: String(err && err.message || err) });
      throw err;
    }
  };
  const connector = {
    id: base.id,
    search: wrapSearch(base.search.bind(base), 'gemini.search'),
    read: base.read ? wrapSearch(base.read.bind(base), 'gemini.read') : undefined,
  };
  const startedAt = Date.now();
  const reply = await runConversationSearch({
    userText: task.text,
    subjectFacts: task.ownerContext || [],
    currentDate: new Date().toISOString().slice(0, 10),
    chat,
    connector,
    fallbackConnector: bing,
    providerId: 'gemini-search',
  });
  let text = reply.text;
  let finalMode = reply.mode;
  let fallback = false;
  if (reply.mode === 'no_search') {
    fallback = true;
    const systemContent = buildConversationSystemContent({ subjectFacts: task.ownerContext || [] });
    const fb = await chat(
      [{ role: 'system', content: systemContent }, { role: 'user', content: task.text }],
      { temperature: 0.4, maxTokens: 1600 },
    );
    text = fb.text;
    if (!text.trim()) throw new Error('no_search fallback empty');
  }
  const ms = Date.now() - startedAt;
  const dsTotal = deepseekUsage.reduce(
    (a, u) => { a.prompt_tokens += u.prompt_tokens || 0; a.completion_tokens += u.completion_tokens || 0; a.calls += 1; return a; },
    { prompt_tokens: 0, completion_tokens: 0, calls: 0 },
  );
  const gmTotal = geminiUsage.reduce(
    (a, u) => { a.promptTokens += u.promptTokens || 0; a.completionTokens += u.completionTokens || 0; a.calls += 1; return a; },
    { promptTokens: 0, completionTokens: 0, calls: 0 },
  );
  return {
    mode: finalMode,
    fallbackUsed: fallback,
    text,
    usedExternal: reply.usedExternal,
    evidence: reply.evidence,
    ms,
    usageTotal: { ...dsTotal, geminiPromptTokens: gmTotal.promptTokens, geminiCompletionTokens: gmTotal.completionTokens, geminiCalls: gmTotal.calls },
    costUsd: +(usageCost(dsTotal) + geminiCost(gmTotal)).toFixed(6),
    providerDegraded: !!reply.evidence.providerDegraded,
    providerErrors,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const credential = resolveCredential();
  if (!credential) { console.error('no credential'); process.exitCode = 2; return; }
  const startUtc = new Date();
  // 断点续跑：跳过已有成功结果的任务；仅重跑失败/缺失任务。
  const done = new Set();
  if (fs.existsSync(OUT_FILE)) {
    for (const l of fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (r.taskId && !r.error) done.add(r.taskId);
    }
  }
  let totalCost = 0;
  const runs = [];
  for (const task of FIXTURE.tasks) {
    if (done.has(task.id)) {
      const existing = fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.taskId === task.id);
      runs.push(existing);
      totalCost += (existing.result && existing.result.costUsd) || 0;
      console.log(`skip ${task.id} (resumed)`);
      continue;
    }
    const row = {
      fixtureId: FIXTURE.id,
      taskId: task.id,
      cat: task.cat,
      mode_expected: task.mode,
      question: task.text,
      ownerContext: task.ownerContext || null,
      arm: 'arm-A-2digime',
      startedAtUtc: new Date().toISOString(),
      result: null,
      error: null,
    };
    try {
      const result = await runArmA(credential, task);
      row.result = result;
      totalCost += result.costUsd || 0;
    } catch (err) {
      row.error = String(err && err.message ? err.message : err);
    }
    runs.push(row);
    const line = JSON.stringify(row);
    fs.appendFileSync(OUT_FILE, line + '\n', 'utf8');
    const dg = row.result && row.result.providerDegraded ? ' [DEGRADED]' : '';
    console.log(`${row.taskId} ${row.cat} -> ${row.result ? row.result.mode : 'ERR'}${dg} ${row.error ? '[' + row.error.slice(0, 60) + ']' : ''} cost=${row.result ? row.result.costUsd : '?'}`);
  }
  const summary = {
    fixtureId: FIXTURE.id,
    startedAtUtc: startUtc.toISOString(),
    endedAtUtc: new Date().toISOString(),
    arm: 'arm-A-2digime (Gemini grounded provider)',
    runs: runs.length,
    errors: runs.filter((r) => r.error).length,
    totalCostUsd: +totalCost.toFixed(4),
    hardCapUsd: 1.35,
    note: 'Gemini 32题运行；usage/cost 保守估算（gemini $0.35/1M in $1.20/1M out；deepseek $0.55/1M in $2.19/1M out）。',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'benchmark-runs-meta.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nWrote', OUT_FILE, 'runs:', runs.length, 'errors:', summary.errors, 'totalCostUsd:', summary.totalCostUsd);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });