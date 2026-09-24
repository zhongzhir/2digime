// Acceptance-only credential adapter. The product main, runtime, IPC and renderer are unchanged.
// No import, export, credential writes, or access to an existing Subject/Package.
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const evidencePath = path.resolve('build/evidence/news-supply-live-gate-02/model.jsonl');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
const http = require('../dist/infrastructure/model-http');
const complete = http.chatComplete;
http.chatComplete = async (options) => {
  if (new URL(options.baseUrl).origin !== 'https://api.deepseek.com') {
    throw new Error('Unauthorized model destination');
  }
  try {
    const result = await complete(options);
    fs.appendFileSync(evidencePath, JSON.stringify({ at: new Date().toISOString(), ok: true,
      finishReason: result.finishReason, text: result.text }) + '\n');
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
  if (isPackaged || !path.resolve(userDataPath).startsWith(path.join(os.tmpdir(), 'news-supply-ui-'))) {
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
require('../electron/main.cjs');
