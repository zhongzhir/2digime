'use strict';
// Build-vs-Integrate Gate diagnostic: does the SAME DeepSeek model/credential/endpoint accept
// (A) thinking enabled, (B) thinking.type=disabled, (C) reasoning_effort=none, and still return
// the required structured JSON? Records reasoning-token usage and latency. No new provider.
const fs = require('node:fs');

const file = process.env.DIGITALME_MODEL_RUNTIME_FILE;
if (!file || !fs.existsSync(file)) {
  console.error('missing DIGITALME_MODEL_RUNTIME_FILE');
  process.exit(2);
}
const cred = JSON.parse(fs.readFileSync(file, 'utf8'));
const url = `${String(cred.baseUrl).replace(/\/+$/, '')}/chat/completions`;
const messages = [
  { role: 'system', content: '只输出 JSON {"ids":[输入id]}，最多3个。不要输出分析。' },
  { role: 'user', content: JSON.stringify({ query: '今天有什么重要科技新闻？', candidates: [
    { id: 0, title: '某公司发布新芯片' }, { id: 1, title: '某地天气晴朗' },
    { id: 2, title: 'AI 模型登上期刊' }, { id: 3, title: '某明星结婚' },
  ] }) },
];

async function call(label, extra) {
  const started = Date.now();
  const payload = { model: cred.model, messages, temperature: 0, max_tokens: 1024,
    response_format: { type: 'json_object' }, ...extra };
  try {
    const res = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cred.apiKey}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch {}
    const usage = body?.usage || {};
    const msg = body?.choices?.[0]?.message || {};
    const reasoningChars = typeof msg.reasoning_content === 'string' ? msg.reasoning_content.length : 0;
    return { label, status: res.status, ms: Date.now() - started,
      usage: { input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens },
      reasoningChars, finish: body?.choices?.[0]?.finish_reason, content: (msg.content || '').slice(0, 160),
      rawError: res.ok ? undefined : text.slice(0, 200) };
  } catch (err) {
    return { label, status: 0, ms: Date.now() - started, error: err.name + ':' + err.message };
  }
}

(async () => {
  const rows = [];
  rows.push(await call('A thinking enabled', {}));
  rows.push(await call('B thinking.type=disabled', { thinking: { type: 'disabled' } }));
  rows.push(await call('C reasoning_effort=none', { reasoning_effort: 'none' }));
  const out = { at: new Date().toISOString(), model: cred.model, baseUrl: cred.baseUrl, rows };
  fs.mkdirSync('build/evidence/fast-selection-06', { recursive: true });
  fs.writeFileSync('docs/audits/evidence/fast-selection-06/thinking-probe.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
