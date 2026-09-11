#!/usr/bin/env node
/**
 * Export local digitalme-v2 SecretStore model API key into spike .env (gitignored).
 * Does not print the key. Used only for Slice A real spike on this machine.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_ENV = path.join(__dirname, '.env');

app.setPath('userData', path.join(app.getPath('appData'), 'digitalme-v2'));

async function main() {
  await app.whenReady();
  const { resolveModelConfig } = require(path.join(ROOT, 'electron', 'bootstrap-secrets.cjs'));
  const { providerCredentialKey } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store'));
  const model = await resolveModelConfig({
    safeStorage,
    userDataPath: app.getPath('userData'),
    isPackaged: false,
    allowDevRuntimeFile: false,
  });
  if (!model.ok || !model.openaiCompatible || !model.secrets) {
    console.error(JSON.stringify({ ok: false, reason: model.reason || 'no credential' }));
    app.quit();
    process.exit(2);
  }
  const cfg = model.openaiCompatible;
  const apiKey = await model.secrets.get(providerCredentialKey(cfg.providerId || 'openai-compatible'));
  if (!apiKey) {
    console.error(JSON.stringify({ ok: false, reason: 'empty key' }));
    app.quit();
    process.exit(2);
  }
  const host = (() => {
    try {
      return new URL(String(cfg.baseUrl || '')).host;
    } catch {
      return '';
    }
  })();
  if (!host.includes('deepseek.com')) {
    console.error(JSON.stringify({ ok: false, reason: 'configured provider is not deepseek', host, model: cfg.model }));
    app.quit();
    process.exit(3);
  }
  const master = process.env.LITELLM_MASTER_KEY || 'sk-institution-spike-local-only';
  const salt = process.env.LITELLM_SALT_KEY || 'sk-institution-spike-salt-change-me';
  const body = [
    `# generated locally for institution litellm spike; do not commit`,
    `DEEPSEEK_API_KEY=${String(apiKey)}`,
    `LITELLM_MASTER_KEY=${master}`,
    `LITELLM_SALT_KEY=${salt}`,
    '',
  ].join('\n');
  fs.writeFileSync(OUT_ENV, body, 'utf8');
  console.log(
    JSON.stringify({
      ok: true,
      outPath: OUT_ENV,
      model: cfg.model,
      host,
      apiKeyChars: String(apiKey).length,
    })
  );
  app.quit();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
