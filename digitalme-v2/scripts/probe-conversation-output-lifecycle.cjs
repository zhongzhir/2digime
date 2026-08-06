/**
 * 对话输出完整性 — 真实 DeepSeek 响应生命周期取证（脱敏）。
 * 不启动 UI；只记录字段形状 / finish_reason / reasoning 与截断。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const evidenceDir = path.join(ROOT, 'scripts', '_conversation-output-integrity-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function redactText(text, max = 240) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, 120)}…[${s.length} chars]…${s.slice(-80)}`;
}

async function main() {
  spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), 'scripts/load-app-model-credential.cjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const { resolveModelEnvAsync } = require('../dist/infrastructure/env-secrets');
  const { chatComplete } = require('../dist/infrastructure/model-http');
  const modelEnv = await resolveModelEnvAsync(ROOT, process.env);
  if (!modelEnv.runtime) throw new Error('no credential');
  const cred = modelEnv.runtime;
  const host = new URL(cred.baseUrl).host;

  const lifecycle = {
    writtenAt: new Date().toISOString(),
    host,
    model: cred.model,
    keyChars: String(cred.apiKey || '').length,
    probes: [],
  };

  async function rawComplete(label, messages, maxTokens) {
    const url = `${cred.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const started = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify({
        model: cred.model,
        messages,
        stream: false,
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
    });
    const rawText = await res.text();
    let body;
    try {
      body = JSON.parse(rawText);
    } catch {
      body = null;
    }
    const choice = body && body.choices && body.choices[0];
    const message = choice && choice.message;
    const content = message && typeof message.content === 'string' ? message.content : null;
    const reasoning =
      message && typeof message.reasoning_content === 'string' ? message.reasoning_content : null;
    const finishReason = choice && choice.finish_reason;
    const viaHelper = await chatComplete({
      baseUrl: cred.baseUrl,
      apiKey: cred.apiKey,
      model: cred.model,
      messages,
      temperature: 0.4,
      maxTokens,
      timeoutMs: 180000,
    });

    const probe = {
      label,
      maxTokens,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      finishReason: finishReason || null,
      messageKeys: message ? Object.keys(message) : [],
      contentChars: content ? content.length : 0,
      reasoningChars: reasoning ? reasoning.length : 0,
      contentPreview: content ? redactText(content, 280) : null,
      reasoningPreview: reasoning ? redactText(reasoning, 200) : null,
      hasEndMarkerInContent: !!(content && content.includes('END_OF_REPLY_20260805')),
      hasEndMarkerInReasoning: !!(reasoning && reasoning.includes('END_OF_REPLY_20260805')),
      helperReturnedChars: String(viaHelper.text || '').length,
      helperEqualsContent: viaHelper.text === content,
      helperEqualsReasoning: reasoning != null && viaHelper.text === reasoning,
      helperUsedReasoningFallback:
        (!content || !String(content).trim()) &&
        !!reasoning &&
        viaHelper.text === reasoning,
      helperHasEndMarker: String(viaHelper.text || '').includes('END_OF_REPLY_20260805'),
      usage: body && body.usage ? body.usage : null,
    };
    lifecycle.probes.push(probe);
    console.log(JSON.stringify({ label, finishReason, contentChars: probe.contentChars, reasoningChars: probe.reasoningChars, helperChars: probe.helperReturnedChars, helperUsedReasoningFallback: probe.helperUsedReasoningFallback, hasEnd: probe.helperHasEndMarker }, null, 2));
    return probe;
  }

  await rawComplete(
    'short',
    [
      { role: 'system', content: '你是助手。直接回答。' },
      { role: 'user', content: '只回复：CHAT_SHORT_OK' },
    ],
    256,
  );

  await rawComplete(
    'long_max1024_current_bug',
    [
      {
        role: 'system',
        content: '你是助手。直接输出最终文章正文，不要输出分析过程。',
      },
      {
        role: 'user',
        content:
          '用中文完整写一篇不少于 1200 字的文章，分 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
      },
    ],
    1024,
  );

  await rawComplete(
    'long_max4096',
    [
      {
        role: 'system',
        content: '你是助手。直接输出最终文章正文，不要输出分析过程。',
      },
      {
        role: 'user',
        content:
          '用中文完整写一篇不少于 1200 字的文章，分 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
      },
    ],
    4096,
  );

  fs.writeFileSync(
    path.join(evidenceDir, 'deepseek-response-lifecycle-redacted.json'),
    `${JSON.stringify(lifecycle, null, 2)}\n`,
    'utf8',
  );
  console.log(`OK evidence=${path.join(evidenceDir, 'deepseek-response-lifecycle-redacted.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
