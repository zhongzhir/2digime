"use strict";
/**
 * V2 模型凭证引导(App Shell only)。
 * - packaged/dev:仅 V2 FileSecretStore + Electron safeStorage,禁止 Legacy 路径;
 * - 未配置凭证时 documentCapability=none(禁止静默 Fake);
 * - API Key 只进加密 SecretStore,不进 model-config.json / 日志 / 命令行。
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
const { chatComplete } = require("../dist/infrastructure/model-http");

const DEFAULT_PROVIDER_PRESETS = {
  deepseek: {
    providerId: "openai-compatible",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
  },
  "openai-compatible": {
    providerId: "openai-compatible",
    label: "自定义服务",
    baseUrl: "",
    model: "",
  },
};

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
    providerPreset: cfg.providerPreset || "openai-compatible",
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
  if (!parsed) return null;
  return {
    providerPreset: parsed.providerPreset || inferPreset(parsed.baseUrl),
    providerId: parsed.providerId || "openai-compatible",
    baseUrl: String(parsed.baseUrl || "").replace(/\/+$/, ""),
    model: String(parsed.model || "").trim(),
  };
}

function inferPreset(baseUrl) {
  const host = String(baseUrl || "").toLowerCase();
  if (host.includes("deepseek.com")) return "deepseek";
  return "openai-compatible";
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "unknown";
  }
}

function publicStatus(cfg, credentialConfigured, isPackaged, reason) {
  return {
    credentialConfigured: !!credentialConfigured,
    needsCredentialSetup: !credentialConfigured,
    providerPreset: (cfg && cfg.providerPreset) || "deepseek",
    providerId: (cfg && cfg.providerId) || "openai-compatible",
    baseUrl: (cfg && cfg.baseUrl) || DEFAULT_PROVIDER_PRESETS.deepseek.baseUrl,
    model: (cfg && cfg.model) || DEFAULT_PROVIDER_PRESETS.deepseek.model,
    modelMeta: credentialConfigured
      ? {
          model: cfg.model,
          baseUrlHost: hostOf(cfg.baseUrl),
          source: isPackaged ? "v2_secret_store_packaged" : "v2_secret_store_dev",
        }
      : null,
    reason: reason || null,
    presets: {
      deepseek: {
        label: DEFAULT_PROVIDER_PRESETS.deepseek.label,
        baseUrl: DEFAULT_PROVIDER_PRESETS.deepseek.baseUrl,
        model: DEFAULT_PROVIDER_PRESETS.deepseek.model,
      },
      "openai-compatible": {
        label: DEFAULT_PROVIDER_PRESETS["openai-compatible"].label,
        baseUrl: "",
        model: "",
      },
    },
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
  writeModelConfig(userDataPath, {
    providerPreset: inferPreset(baseUrl),
    providerId,
    baseUrl,
    model,
  });
  return { providerId, baseUrl, model, source: "credential_import" };
}

function createCredentialOps(store, userDataPath) {
  return {
    saveCredential: async (input) => {
      const providerId = input.providerId || "openai-compatible";
      const baseUrl = String(input.baseUrl || "").replace(/\/+$/, "");
      const model = String(input.model || "").trim();
      let apiKey = String(input.apiKey || "").trim();
      if (!apiKey) {
        apiKey = String((await store.get(providerCredentialKey(providerId))) || "").trim();
      }
      if (!apiKey) {
        throw new Error("请输入 API Key 后再保存");
      }
      if (!baseUrl || !model) {
        throw new Error("请填写服务地址与模型名称");
      }
      await store.put(providerCredentialKey(providerId), apiKey);
      writeModelConfig(userDataPath, {
        providerPreset: input.providerPreset || inferPreset(baseUrl),
        providerId,
        baseUrl,
        model,
      });
      return { ok: true };
    },
    deleteCredential: async (input = {}) => {
      const cfg = readModelConfig(userDataPath);
      const providerId =
        (input && input.providerId) || (cfg && cfg.providerId) || "openai-compatible";
      await store.delete(providerCredentialKey(providerId));
      return { ok: true };
    },
    testConnection: async (input = {}) => {
      const cfg = readModelConfig(userDataPath) || {};
      const providerId =
        String(input.providerId || cfg.providerId || "openai-compatible").trim() ||
        "openai-compatible";
      const baseUrl = String(input.baseUrl || cfg.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      const model = String(input.model || cfg.model || "").trim();
      const apiKeyFromInput = String(input.apiKey || "").trim();
      const apiKey = apiKeyFromInput || (await store.get(providerCredentialKey(providerId)));
      if (!apiKey || !baseUrl || !model) {
        throw new Error("请先填写并保存完整的模型连接信息");
      }
      const result = await chatComplete({
        baseUrl,
        apiKey,
        model,
        messages: [
          {
            role: "user",
            content: "请只回复一个字：好",
          },
        ],
        maxTokens: 64,
        temperature: 0,
        timeoutMs: 45_000,
      });
      const text = String(result.text || "").trim();
      if (!text) {
        throw new Error("模型未返回有效内容");
      }
      return {
        ok: true,
        model,
        baseUrlHost: hostOf(baseUrl),
        previewChars: text.length,
      };
    },
  };
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
    const cfg = readModelConfig(userDataPath) || {
      providerPreset: "deepseek",
      providerId: "openai-compatible",
      baseUrl: DEFAULT_PROVIDER_PRESETS.deepseek.baseUrl,
      model: DEFAULT_PROVIDER_PRESETS.deepseek.model,
    };
    return {
      ok: false,
      reason: "safeStorage_unavailable",
      documentCapability: "none",
      needsCredentialSetup: true,
      status: publicStatus(cfg, false, isPackaged, "safeStorage_unavailable"),
    };
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const cipher = createElectronSafeStorageCipherAdapter(safeStorage);
  const store = new FileSecretStore({
    filePath: secretsPath(userDataPath),
    cipher,
  });
  const ops = createCredentialOps(store, userDataPath);

  const importFile = process.env.DIGITALME_V2_CREDENTIAL_IMPORT || "";
  if (importFile) {
    await importCredentialOnce(store, userDataPath, importFile);
  }

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
  if (!cfg || !cfg.baseUrl || !cfg.model) {
    cfg = {
      providerPreset: "deepseek",
      providerId: "openai-compatible",
      baseUrl: DEFAULT_PROVIDER_PRESETS.deepseek.baseUrl,
      model: DEFAULT_PROVIDER_PRESETS.deepseek.model,
    };
  }

  const apiKey = await store.get(providerCredentialKey(cfg.providerId));
  if (!apiKey) {
    return {
      ok: false,
      reason: "no_model_credential",
      documentCapability: "none",
      needsCredentialSetup: true,
      status: publicStatus(cfg, false, isPackaged, "no_model_credential"),
      secrets: store.accessor(),
      ...ops,
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
      baseUrlHost: hostOf(cfg.baseUrl),
      source: isPackaged ? "v2_secret_store_packaged" : "v2_secret_store_dev",
    },
    status: publicStatus(cfg, true, isPackaged, null),
    needsCredentialSetup: false,
    ...ops,
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
  DEFAULT_PROVIDER_PRESETS,
};
