/**
 * Owner blockers 真实 DeepSeek 预检 — Electron 入口。
 * - 隔离 userData
 * - 复用生产 electron/main.cjs + preload + renderer
 * - 不注册 Fake；不 stub conversationReply
 * - 仅拦截 chatComplete 做脱敏证据（不改产品源码）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { app, dialog } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const evidenceDir =
  process.env.DIGITALME_REAL_PREFLIGHT_EVIDENCE ||
  path.join(ROOT, 'scripts', '_owner-acceptance-blockers-01-real-preflight-evidence');
const userData =
  process.env.DIGITALME_REAL_PREFLIGHT_USER_DATA || path.join(evidenceDir, 'userData');
const markerPdf =
  process.env.DIGITALME_REAL_PREFLIGHT_PDF || path.join(evidenceDir, 'fixtures', 'owner-real-marker.pdf');
const MARKER = process.env.DIGITALME_REAL_PREFLIGHT_MARKER || 'OWNER_REAL_PDF_FACT_20260805_X7K9';

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

// 禁止 UX Fake / 其它冒充路径
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

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m && m.role,
    chars: String((m && m.content) || '').length,
    hasMarker: String((m && m.content) || '').includes(MARKER),
    // 仅保留含标记附近的短摘录，便于核对；不含密钥
    markerSnippet: String((m && m.content) || '').includes(MARKER)
      ? String(m.content)
          .split(MARKER)
          .slice(0, 2)
          .map((part, idx, arr) =>
            idx < arr.length - 1
              ? `${part.slice(-40)}${MARKER}${String(arr[idx + 1] || '').slice(0, 40)}`
              : '',
          )
          .filter(Boolean)[0] || MARKER
      : undefined,
  }));
}

function recordModelCall(opts, resultMeta) {
  let host = '';
  try {
    host = new URL(String(opts.baseUrl || '')).host;
  } catch {
    host = 'invalid';
  }
  const messages = sanitizeMessages(opts.messages);
  modelCalls.push({
    at: new Date().toISOString(),
    baseUrlHost: host,
    model: String(opts.model || ''),
    messageCount: messages.length,
    markerInAnyMessage: messages.some((m) => m.hasMarker),
    messages,
    resultChars: resultMeta && resultMeta.chars,
    resultHasMarker: !!(resultMeta && resultMeta.hasMarker),
    resultHasAckStub: !!(resultMeta && resultMeta.hasAckStub),
  });
  writeEvidence();
}

function writeEvidence() {
  const payload = {
    writtenAt: new Date().toISOString(),
    adapterExpectation: 'openai-compatible → api.deepseek.com',
    marker: MARKER,
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

// 在生产 main 加载 Adapter 之前包装 chatComplete（CJS 导出替换）
const origRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(request) {
  const exported = origRequire.apply(this, arguments);
  const norm = String(request || '').replace(/\\/g, '/');
  if (
    exported &&
    typeof exported.chatComplete === 'function' &&
    exported.ModelHttpError &&
    !exported.__ownerRealPreflightPatched &&
    norm.includes('model-http')
  ) {
    const origChat = exported.chatComplete;
    exported.chatComplete = async function wrappedChatComplete(opts) {
      try {
        const result = await origChat.apply(this, arguments);
        recordModelCall(opts, {
          chars: String((result && result.text) || '').length,
          hasMarker: String((result && result.text) || '').includes(MARKER),
          hasAckStub: /已记下。需要做成具体工作时/.test(String((result && result.text) || '')),
        });
        return result;
      } catch (err) {
        recordModelCall(opts, {
          chars: 0,
          hasMarker: false,
          hasAckStub: false,
          error: String((err && err.message) || err).slice(0, 200),
        });
        throw err;
      }
    };
    exported.__ownerRealPreflightPatched = true;
  }
  return exported;
};

// 文件选择：固定返回预检 PDF（不改产品源码，仅入口侧替换 dialog）
const origShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async function showOpenDialogPatched(browserWindow, options) {
  const opts = options || browserWindow || {};
  const props = (opts.properties || []);
  if (props.includes('openDirectory')) {
    return { canceled: true, filePaths: [] };
  }
  if (fs.existsSync(markerPdf)) {
    return { canceled: false, filePaths: [markerPdf] };
  }
  return origShowOpenDialog(browserWindow, options);
};

global.__ownerRealPreflight = {
  getModelCalls: () => modelCalls.slice(),
  getMeta: () => ({
    evidenceDir,
    userData,
    markerPdf,
    marker: MARKER,
    modelCallCount: modelCalls.length,
    usedDeepSeekHost: modelCalls.some((c) => /deepseek/i.test(c.baseUrlHost)),
  }),
  writeEvidence,
};

writeEvidence();
require(path.join(ROOT, 'electron', 'main.cjs'));
