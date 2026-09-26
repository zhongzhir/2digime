// Acceptance-only credential adapter. The product main, runtime, IPC and renderer are unchanged.
// No import, export, credential writes, or access to an existing Subject/Package.
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const evidenceDir = process.env.EVIDENCE_DIR || (process.env.DOMESTIC_CONTENT === '1' ? 'build/evidence/domestic-content-04'
  : process.env.NEWS_RELIABILITY === '1' ? 'build/evidence/news-reliability-03'
  : 'build/evidence/news-supply-live-gate-02');
const ACCEPTANCE = process.env.DOMESTIC_CONTENT === '1' || process.env.NEWS_RELIABILITY === '1';
const evidencePath = path.resolve(evidenceDir, 'model.jsonl');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
const http = require('../dist/infrastructure/model-http');
const complete = http.chatComplete;
http.chatComplete = async (options) => {
  if (new URL(options.baseUrl).origin !== 'https://api.deepseek.com') {
    throw new Error('Unauthorized model destination');
  }
  try {
    const result = await complete(options);
    let judge;
    try {
      const sys = String((options.messages && options.messages[0] && options.messages[0].content) || '');
      if (sys.includes('同一具体事件的多篇报道可合并')) {
        const user = JSON.parse(String((options.messages && options.messages[1] && options.messages[1].content) || '{}'));
        judge = { merge: !!(user.candidates && user.candidates[0] && user.candidates[0].members),
          candidates: (user.candidates || []).length,
          members: (user.candidates || []).map(c => (c.members || []).length) };
      }
    } catch { /* ignore */ }
    fs.appendFileSync(evidencePath, JSON.stringify({ at: new Date().toISOString(), ok: true,
      finishReason: result.finishReason, usage: result.usage, text: result.text, ...(judge ? { judge } : {}) }) + '\n');
    return result;
  } catch (error) {
    fs.appendFileSync(evidencePath, JSON.stringify({ at: new Date().toISOString(), ok: false,
      name: error.name, kind: error.kind, status: error.status }) + '\n');
    throw error;
  }
};
const { readRuntimeModelCredential, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
const bootstrap = require('../electron/bootstrap-secrets.cjs');
bootstrap.resolveModelConfig = async ({ userDataPath, isPackaged }) => {
  const isolatedPrefixes = ['news-supply-ui-', 'domestic-content-ui-'];
  const isolated = isolatedPrefixes.some((prefix) => path.resolve(userDataPath).startsWith(path.join(os.tmpdir(), prefix)));
  if (isPackaged || !isolated) {
    throw new Error('Isolated acceptance directory required');
  }
  const credential = await readRuntimeModelCredential(process.cwd(), {
    DIGITALME_MODEL_RUNTIME_FILE: process.env.DIGITALME_MODEL_RUNTIME_FILE,
  });
  if (!credential || new URL(credential.baseUrl).origin !== 'https://api.deepseek.com') {
    throw new Error('Authorized DeepSeek credential required');
  }
  const { baseUrl, model, providerId } = credential;
  const status = { credentialConfigured: true, needsCredentialSetup: false,
    providerPreset: 'deepseek', providerId, baseUrl, model, geminiSearchConfigured: false };
  return { ok: true, documentCapability: 'openai-compatible', needsCredentialSetup: false,
    openaiCompatible: { baseUrl, model, providerId, timeoutMs: 600000 },
    secrets: createEnvSecretAccessor({}, providerId, credential), status,
    modelMeta: { model, baseUrlHost: 'api.deepseek.com', source: 'existing_readonly_runtime_credential' },
  };
};
if (ACCEPTANCE) {
  const commands = require('../dist/runtime/command-bus');
  const create = commands.createCommandBus;
  commands.createCommandBus = (...args) => {
    const bus = create(...args);
    const invoke = bus.invoke.bind(bus);
    bus.invoke = async (name, input) => {
      const result = await invoke(name, input);
      if (name === 'content') {
        const view = result?.view;
        const record = { at: new Date().toISOString(), action: input.action, query: input.text,
          ...(view ? { replenishing: view.replenishing, trace: view.seekTrace, supply: view.supplyTrace, providers: view.searchProviders, notice: view.notice,
            cards: view.cards.map(c => ({ itemId: c.itemId, title: c.title, url: c.url, type: c.contentType,
              publishedAt: c.publishedAt, originalPublishedAt: c.originalPublishedAt, sourceFeedTimestamp: c.sourceFeedTimestamp,
              discoveredAt: c.discoveredAt, updatedAt: c.updatedAt, dateProvenance: c.dateProvenance, reason: c.reason,
              sources: c.sources, bodyCharacters: c.representation?.bodyText?.length || 0 })) } : {}) };
        fs.appendFileSync(path.join(evidenceDir, 'commands.jsonl'), JSON.stringify(record) + '\n');
      }
      return result;
    };
    return bus;
  };
  const { app, shell } = require('electron');
  const open = shell.openExternal.bind(shell);
  shell.openExternal = async (...args) => {
    const result = await open(...args);
    fs.appendFileSync(path.join(evidenceDir, 'opens.jsonl'), JSON.stringify({ url: args[0], completed: true }) + '\n');
    return result;
  };
  // Acceptance instrumentation only: record the renderer's real window.open target and
  // keep the automated run from spawning an uncontrolled in-app window. The formal
  // renderer path (openCard -> window.open) still executes.
  app.on('web-contents-created', (_evt, contents) => {
    contents.setWindowOpenHandler(details => {
      fs.appendFileSync(path.join(evidenceDir, 'opens.jsonl'), JSON.stringify({ at: new Date().toISOString(), url: details.url, via: 'window.open', disposition: details.disposition }) + '\n');
      return { action: 'deny' };
    });
  });
}
require('../electron/main.cjs');
