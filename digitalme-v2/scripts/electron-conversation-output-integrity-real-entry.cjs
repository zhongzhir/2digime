/**
 * 对话输出完整性 — 真实 DeepSeek Electron 入口。
 * 复用生产 main；隔离 userData；包装 chatComplete 记录 finishReason/truncated（脱敏）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const evidenceDir =
  process.env.DIGITALME_COI_REAL_EVIDENCE ||
  path.join(ROOT, 'scripts', '_conversation-output-integrity-evidence', 'real');
const userData =
  process.env.DIGITALME_COI_REAL_USER_DATA || path.join(evidenceDir, 'userData');

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_V2_P21_DETERMINISTIC;
delete process.env.DIGITALME_FORCE_FAKE;

if (!process.env.DIGITALME_V2_CREDENTIAL_IMPORT) {
  const fallback = path.join(
    ROOT,
    'scripts',
    '_mvp-p14-real-capability-evidence',
    '.runtime-model-credential.json',
  );
  if (fs.existsSync(fallback)) {
    process.env.DIGITALME_V2_CREDENTIAL_IMPORT = fallback;
  }
}

/** @type {object[]} */
const modelCalls = [];

function redact(text, max = 160) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, 80)}…[${s.length} chars]…${s.slice(-60)}`;
}

function writeEvidence() {
  const payload = {
    writtenAt: new Date().toISOString(),
    modelCallCount: modelCalls.length,
    usedDeepSeekHost: modelCalls.some((c) => /deepseek/i.test(c.baseUrlHost)),
    calls: modelCalls,
  };
  fs.writeFileSync(
    path.join(evidenceDir, 'model-calls-redacted.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

const origRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(request) {
  const exported = origRequire.apply(this, arguments);
  const norm = String(request || '').replace(/\\/g, '/');
  if (
    exported &&
    typeof exported.chatComplete === 'function' &&
    exported.ModelHttpError &&
    !exported.__coiRealPatched &&
    norm.includes('model-http')
  ) {
    const origChat = exported.chatComplete;
    exported.chatComplete = async function wrappedChatComplete(opts) {
      let host = '';
      try {
        host = new URL(String(opts.baseUrl || '')).host;
      } catch {
        host = 'invalid';
      }
      try {
        const result = await origChat.apply(this, arguments);
        const text = String((result && result.text) || '');
        modelCalls.push({
          at: new Date().toISOString(),
          baseUrlHost: host,
          model: String(opts.model || ''),
          maxTokens: opts.maxTokens,
          finishReason: result && result.finishReason,
          truncated: !!(result && result.truncated),
          chars: text.length,
          hasEndMarker: text.includes('END_OF_REPLY_20260805'),
          hasShortOk: /CHAT_SHORT_OK/.test(text),
          hasReasoningLeak: /reasoning_content|内部分析过程|用户想要什么：/.test(text),
          preview: redact(text),
        });
        writeEvidence();
        return result;
      } catch (err) {
        modelCalls.push({
          at: new Date().toISOString(),
          baseUrlHost: host,
          model: String(opts.model || ''),
          maxTokens: opts.maxTokens,
          error: String((err && err.message) || err).slice(0, 240),
          kind: err && err.kind,
        });
        writeEvidence();
        throw err;
      }
    };
    exported.__coiRealPatched = true;
  }
  return exported;
};

global.__coiReal = {
  getModelCalls: () => modelCalls.slice(),
  getMeta: () => ({
    evidenceDir,
    userData,
    modelCallCount: modelCalls.length,
    usedDeepSeekHost: modelCalls.some((c) => /deepseek/i.test(c.baseUrlHost)),
  }),
  writeEvidence,
};

writeEvidence();
require(path.join(ROOT, 'electron', 'main.cjs'));
