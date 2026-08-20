/**
 * DIGITALME-CONVERSATION-P95-BENCHMARK-01 — 运行器。
 * 冻结 9188696 的真实实现，对 benchmark fixture 全部任务执行：
 *   Arm A: 2digime (DeepSeek + Bing HTML)   [product]
 *   Arm B: DeepSeek-v4-flash 裸 API（无搜索） [api-capability]
 *
 * 运行：node scripts/conversation-p95-run.cjs
 * 输出：scripts/_conversation-p95-benchmark-01-evidence/benchmark-runs.jsonl（每行一个 run 记录）
 */
const fs = require('node:fs');
const path = require('node:path');

const { runConversationSearch } = require('../dist/capability/conversation-search');
const { createBingHtmlSearchConnector } = require('../dist/capability/adapters/bing-html-search');
const { buildConversationSystemContent } = require('../dist/subject-core/conversation-context');

const FIXTURE = require('./fixtures/conversation-p95-benchmark-01.json');
const OUT_DIR = path.join(__dirname, '_conversation-p95-benchmark-01-evidence');
const OUT_FILE = path.join(OUT_DIR, 'benchmark-runs.jsonl');

function resolveCredential() {
  const fromEnv = {
    baseUrl: process.env.DIGITALME_CONVERSATION_SEARCH_BASE_URL,
    model: process.env.DIGITALME_CONVERSATION_SEARCH_MODEL,
    apiKey: process.env.DIGITALME_CONVERSATION_SEARCH_API_KEY,
  };
  if (fromEnv.baseUrl && fromEnv.model && fromEnv.apiKey) return fromEnv;
  const devCredential = path.join(
    __dirname,
    '..',
    'digitalme-v2',
    'scripts',
    '_mvp-p14-real-capability-evidence',
    '.runtime-model-credential.json',
  );
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
    signal: AbortSignal.timeout(opts && opts.timeoutMs ? opts.timeoutMs : 180_000),
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
  return {
    text: content,
    reasoning,
    finishReason: choice && choice.finish_reason,
    usage: body.usage || null,
    ms,
  };
}

function costUsd(usage) {
  // DeepSeek 定价假设（每百万 token）：输入 $0.28 / 输出 $0.42（flash 档，估算，非官方精确价）。
  if (!usage) return null;
  const inT = usage.prompt_tokens || 0;
  const outT = usage.completion_tokens || 0;
  return inT / 1e6 * 0.28 + outT / 1e6 * 0.42;
}

async function runArmA(credential, task) {
  const allUsage = [];
  const chat = async (messages, opts) => {
    const r = await rawChat(credential.baseUrl, credential.apiKey, credential.model, messages, opts);
    if (r.usage) allUsage.push(r.usage);
    if (r.text.trim().length === 0) {
      if (r.finishReason === 'length') return { text: '', finishReason: r.finishReason, truncated: true };
      throw new Error('bad_response empty content');
    }
    return { text: r.text, finishReason: r.finishReason, truncated: r.finishReason === 'length' };
  };
  const connector = createBingHtmlSearchConnector();
  const startedAt = Date.now();
  const reply = await runConversationSearch({
    userText: task.text,
    subjectFacts: task.ownerContext || [],
    currentDate: new Date().toISOString().slice(0, 10),
    chat,
    connector,
  });
  let text = reply.text;
  let finalMode = reply.mode;
  let fallback = false;
  if (reply.mode === 'no_search') {
    // 与 electron 一致：no_search 决策后回落普通对话路径（system + subjectFacts + user）
    fallback = true;
    const systemContent = buildConversationSystemContent({ subjectFacts: task.ownerContext || [] });
    const fb = await chat(
      [
        { role: 'system', content: systemContent },
        { role: 'user', content: task.text },
      ],
      { temperature: 0.4, maxTokens: 1600 },
    );
    text = fb.text;
    if (!text.trim()) throw new Error('no_search fallback empty');
  }
  const ms = Date.now() - startedAt;
  const usageTotal = allUsage.reduce(
    (a, u) => {
      a.prompt_tokens += u.prompt_tokens || 0;
      a.completion_tokens += u.completion_tokens || 0;
      a.calls += 1;
      return a;
    },
    { prompt_tokens: 0, completion_tokens: 0, calls: 0 },
  );
  return {
    mode: finalMode,
    fallbackUsed: fallback,
    text,
    usedExternal: reply.usedExternal,
    evidence: reply.evidence,
    ms,
    usageTotal,
    costUsd: costUsd(usageTotal),
  };
}

async function runArmB(credential, task) {
  const messages = [
    { role: 'system', content: '你是数字之我 2digime。今天 ' + new Date().toISOString().slice(0, 10) + '。' },
  ];
  if (task.ownerContext && task.ownerContext.length > 0) {
    messages.push({ role: 'user', content: '已确认本人信息：\n' + task.ownerContext.map((f) => '- ' + f).join('\n') });
  }
  messages.push({ role: 'user', content: task.text });
  const startedAt = Date.now();
  const r = await rawChat(credential.baseUrl, credential.apiKey, credential.model, messages, { maxTokens: 1600, timeoutMs: 120_000 });
  const ms = Date.now() - startedAt;
  const usageTotal = r.usage || { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  if (r.usage) usageTotal.calls = 1;
  return {
    mode: 'no_search',
    text: r.text,
    reasoning: r.reasoning,
    usedExternal: false,
    evidence: { mode: 'no_search', rounds: [], iterations: 0 },
    usageTotal,
    costUsd: costUsd(usageTotal),
    ms,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const credential = resolveCredential();
  if (!credential) {
    console.error('no credential available');
    process.exitCode = 2;
    return;
  }
  const runs = [];
  const startUtc = new Date();
  for (const task of FIXTURE.tasks) {
    for (const arm of ['arm-A-2digime', 'arm-B-deepseek-raw']) {
      const row = {
        fixtureId: FIXTURE.id,
        taskId: task.id,
        cat: task.cat,
        mode_expected: task.mode,
        question: task.text,
        ownerContext: task.ownerContext || null,
        arm,
        startedAtUtc: new Date().toISOString(),
        result: null,
        error: null,
      };
      try {
        const result = arm === 'arm-A-2digime' ? await runArmA(credential, task) : await runArmB(credential, task);
        row.result = result;
      } catch (err) {
        row.error = String(err && err.message ? err.message : err);
      }
      runs.push(row);
      const line = JSON.stringify(row);
      fs.appendFileSync(OUT_FILE, line + '\n', 'utf8');
      console.log(`${arm} ${task.id} ${task.cat} -> ${row.result ? row.result.mode : 'ERR'} ${row.error ? '[' + row.error.slice(0, 60) + ']' : ''}`);
    }
  }
  const summary = {
    fixtureId: FIXTURE.id,
    startedAtUtc: startUtc.toISOString(),
    endedAtUtc: new Date().toISOString(),
    armA: { runs: runs.filter((r) => r.arm === 'arm-A-2digime').length, errors: runs.filter((r) => r.arm === 'arm-A-2digime' && r.error).length },
    armB: { runs: runs.filter((r) => r.arm === 'arm-B-deepseek-raw').length, errors: runs.filter((r) => r.arm === 'arm-B-deepseek-raw' && r.error).length },
    note: '完整 usage/cost 以原始运行记录为准；Deep Research 内部多轮搜索 token 未计入 costUsd（标记为需在报告注明）。',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'benchmark-runs-meta.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nWrote', OUT_FILE, 'runs:', runs.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});