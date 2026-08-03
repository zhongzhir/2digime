"use strict";
/**
 * V2 模型凭证引导(App Shell only)。
 * - packaged:仅 V2 FileSecretStore + Electron safeStorage,禁止 Legacy 路径;
 * - 一次性导入文件 DIGITALME_V2_CREDENTIAL_IMPORT(JSON),读入后写入 V2 存储,不落 env/日志;
 * - 开发态也可写入同一 V2 存储;可选从既有运行时文件导入(仍不经领域层)。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  FileSecretStore,
  providerCredentialKey,
} = require("../dist/infrastructure/secret-store");
const {
  createElectronSafeStorageCipherAdapter,
  isElectronSafeStorageAvailable,
} = require("../dist/infrastructure/electron-safe-storage-cipher");

function modelConfigPath(userDataPath) {
  return path.join(userDataPath, "model-config.json");
}

function secretsPath(userDataPath) {
  return path.join(userDataPath, "secrets.v2.json");
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeModelConfig(userDataPath, cfg) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const safe = {
    providerId: cfg.providerId || "openai-compatible",
    baseUrl: String(cfg.baseUrl || "").replace(/\/+$/, ""),
    model: String(cfg.model || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(modelConfigPath(userDataPath), `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

function readModelConfig(userDataPath) {
  const parsed = readJsonSafe(modelConfigPath(userDataPath));
  if (!parsed || !parsed.baseUrl || !parsed.model) return null;
  return {
    providerId: parsed.providerId || "openai-compatible",
    baseUrl: String(parsed.baseUrl).replace(/\/+$/, ""),
    model: String(parsed.model).trim(),
  };
}

/**
 * 一次性导入:文件可含 apiKey/baseUrl/model/providerId。
 * 返回导入的元数据(不含 key)。
 */
async function importCredentialOnce(store, userDataPath, importFile) {
  if (!importFile) return null;
  let raw;
  try {
    raw = fs.readFileSync(importFile, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const apiKey = String(parsed.apiKey || "").trim();
  const baseUrl = String(parsed.baseUrl || "").replace(/\/+$/, "");
  const model = String(parsed.model || "").trim();
  const providerId = String(parsed.providerId || "openai-compatible").trim() || "openai-compatible";
  if (!apiKey || !baseUrl || !model) return null;

  await store.put(providerCredentialKey(providerId), apiKey);
  writeModelConfig(userDataPath, { providerId, baseUrl, model });
  // 不删除导入文件(可能只读);调用方负责放在临时目录。
  return { providerId, baseUrl, model, source: "credential_import" };
}

/**
 * @param {{
 *   safeStorage: import('electron').SafeStorage,
 *   userDataPath: string,
 *   isPackaged: boolean,
 *   allowDevRuntimeFile?: boolean,
 * }} opts
 */
async function resolveModelConfig(opts) {
  const { safeStorage, userDataPath, isPackaged } = opts;
  if (!isElectronSafeStorageAvailable(safeStorage)) {
    return {
      ok: false,
      reason: "safeStorage_unavailable",
      documentCapability: "fake",
    };
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const cipher = createElectronSafeStorageCipherAdapter(safeStorage);
  const store = new FileSecretStore({
    filePath: secretsPath(userDataPath),
    cipher,
  });

  // 一次性导入(工程验收 / 首次设置)
  const importFile = process.env.DIGITALME_V2_CREDENTIAL_IMPORT || "";
  if (importFile) {
    await importCredentialOnce(store, userDataPath, importFile);
  }

  // 开发态:可从本机运行时凭证文件导入到 V2 存储(仍不读 Legacy SecretStore)
  if (!isPackaged && opts.allowDevRuntimeFile !== false) {
    const runtimeFile = path.resolve(
      __dirname,
      "..",
      "scripts",
      "_mvp-p14-real-capability-evidence",
      ".runtime-model-credential.json",
    );
    const existingKey = await store.get(providerCredentialKey("openai-compatible"));
    if (!existingKey && fs.existsSync(runtimeFile)) {
      await importCredentialOnce(store, userDataPath, runtimeFile);
    }
  }

  let cfg = readModelConfig(userDataPath);
  if (!cfg) {
    cfg = {
      providerId: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    };
  }

  const apiKey = await store.get(providerCredentialKey(cfg.providerId));
  if (!apiKey) {
    return {
      ok: false,
      reason: "no_model_credential",
      documentCapability: "fake",
      needsCredentialSetup: true,
    };
  }

  return {
    ok: true,
    documentCapability: "openai-compatible",
    openaiCompatible: {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      providerId: cfg.providerId,
      displayName: "对话模型",
      timeoutMs: 120_000,
    },
    secrets: store.accessor(),
    modelMeta: {
      model: cfg.model,
      baseUrlHost: (() => {
        try {
          return new URL(cfg.baseUrl).host;
        } catch {
          return "unknown";
        }
      })(),
      source: isPackaged ? "v2_secret_store_packaged" : "v2_secret_store_dev",
    },
    saveCredential: async (input) => {
      const providerId = input.providerId || "openai-compatible";
      await store.put(providerCredentialKey(providerId), String(input.apiKey || "").trim());
      writeModelConfig(userDataPath, {
        providerId,
        baseUrl: input.baseUrl,
        model: input.model,
      });
    },
  };
}

/** @deprecated 兼容旧名 */
async function resolveDevModelConfig(opts) {
  const { app } = require("electron");
  return resolveModelConfig({
    safeStorage: opts.safeStorage,
    userDataPath: opts.userDataPath || app.getPath("userData"),
    isPackaged: !!(opts.isPackaged ?? require("electron").app.isPackaged),
    allowDevRuntimeFile: opts.allowDevRuntimeFile,
  });
}

module.exports = {
  resolveModelConfig,
  resolveDevModelConfig,
  writeModelConfig,
  readModelConfig,
  secretsPath,
  modelConfigPath,
};
