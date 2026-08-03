"use strict";
/**
 * 开发态模型凭证引导(仅 Electron App Shell)。
 * 优先运行时文件 → 环境变量 → 应用 SecretStore(只读 sibling digitalme-app userData)。
 * 领域层零 Legacy import;本文件不属于 domain src。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
  readRuntimeModelCredential,
} = require("../dist/infrastructure/env-secrets");

async function tryLoadAppSecretStore(safeStorage) {
  const appRoot = path.resolve(__dirname, "..", "..", "digitalme-app");
  const productUd = path.join(
    process.env.APPDATA || path.join(require("node:os").homedir(), "AppData", "Roaming"),
    "digitalme-app",
  );
  try {
    const { SecretStore } = require(path.join(appRoot, "src", "security", "secret-store"));
    const { ConfigSecretsService } = require(path.join(appRoot, "src", "security", "config-secrets"));
    const {
      createElectronSafeStorageAdapter,
    } = require(path.join(appRoot, "src", "security", "electron-safe-storage-adapter"));
    const { resolveModelRoute } = require(path.join(appRoot, "src", "model-routing"));
    const encryptAdapter = createElectronSafeStorageAdapter(safeStorage);
    const productSecrets = new ConfigSecretsService({
      userDataPath: productUd,
      configPath: path.join(productUd, "config.json"),
      secretStore: new SecretStore({ userDataPath: productUd, encryptAdapter }),
      defaultPackageDir: "",
    });
    const routing = (productSecrets.getRuntimeConfig() || {}).modelRouting || null;
    const resolved = resolveModelRoute(routing, "artifact", productSecrets.secretStore);
    const primary = (resolved.candidates || []).find((c) => c.apiKey) || null;
    if (!primary || !primary.apiKey) return null;

    const outDir = path.join(
      __dirname,
      "..",
      "scripts",
      "_mvp-p14-real-capability-evidence",
    );
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, ".runtime-model-credential.json");
    const payload = {
      providerId: "openai-compatible",
      baseUrl: String(primary.provider.baseUrl || "").replace(/\/+$/, ""),
      model: String(primary.model.model || "").trim(),
      apiKey: String(primary.apiKey),
      source: "app_secret_store_model_routing",
      appProviderId: primary.provider.id,
      writtenAt: new Date().toISOString(),
    };
    fs.writeFileSync(outPath, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  } catch {
    return null;
  }
}

/**
 * @param {{ safeStorage: import('electron').SafeStorage }} opts
 */
async function resolveDevModelConfig(opts) {
  const root = path.resolve(__dirname, "..");
  let resolved = await resolveModelEnvAsync(root, process.env);
  if (!resolved.runtime) {
    await tryLoadAppSecretStore(opts.safeStorage);
    resolved = await resolveModelEnvAsync(root, process.env);
  }
  const runtime = resolved.runtime || (await readRuntimeModelCredential(root, process.env));
  if (!resolved.configured && !runtime) {
    return {
      ok: false,
      reason: "no_model_credential",
      documentCapability: "fake",
    };
  }
  const baseUrl = (runtime && runtime.baseUrl) || resolved.baseUrl;
  const model = (runtime && runtime.model) || resolved.model;
  const providerId = (runtime && runtime.providerId) || resolved.providerId;
  return {
    ok: true,
    documentCapability: "openai-compatible",
    openaiCompatible: {
      baseUrl,
      model,
      providerId,
      displayName: "对话模型",
      timeoutMs: 120_000,
    },
    secrets: createEnvSecretAccessor(process.env, providerId, runtime),
    modelMeta: {
      model,
      baseUrlHost: (() => {
        try {
          return new URL(baseUrl).host;
        } catch {
          return "unknown";
        }
      })(),
      source: resolved.source,
    },
  };
}

module.exports = { resolveDevModelConfig };
