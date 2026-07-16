"use strict";

/**
 * PublicConfig vs RuntimeConfig separation and legacy secret migration.
 * Main-process only. Never returns secret plaintext to renderer-facing serializers.
 */

const fs = require("node:fs");
const path = require("node:path");
const { SecretStore, atomicWriteJson } = require("./secret-store");

const MODEL_API_KEY_ID = "model.apiKey";
const MIGRATION_VERSION = 1;
const BACKUP_NAME = "config.json.pre-secret-migration.bak";

function extensionSecretId(extensionId, envKey) {
  return `extension.${String(extensionId)}.${String(envKey)}`;
}

function defaultPublicConfig(packageDir) {
  return {
    provider: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    packageDir: packageDir || "",
    capabilityExtensions: [],
  };
}

function looksLikeSecretEnvKey(key) {
  const k = String(key || "").toUpperCase();
  return (
    k.includes("KEY") ||
    k.includes("TOKEN") ||
    k.includes("SECRET") ||
    k.includes("PASSWORD") ||
    k.includes("PASSWD") ||
    k.includes("CREDENTIAL")
  );
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

class ConfigSecretsService {
  /**
   * @param {object} opts
   * @param {string} opts.userDataPath
   * @param {string} [opts.configPath]
   * @param {import('./secret-store').SecretStore} opts.secretStore
   * @param {string} [opts.defaultPackageDir]
   */
  constructor(opts) {
    this.userDataPath = opts.userDataPath;
    this.configPath = opts.configPath || path.join(opts.userDataPath, "config.json");
    this.secretStore = opts.secretStore;
    this.defaultPackageDir = opts.defaultPackageDir || "";
    this.lastMigration = null;
  }

  backupPath() {
    return path.join(this.userDataPath, BACKUP_NAME);
  }

  readRawConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
    } catch {
      return defaultPublicConfig(this.defaultPackageDir);
    }
  }

  writeRawConfig(cfg) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    atomicWriteJson(this.configPath, cfg);
  }

  /** Strip secrets from an extension record for disk / renderer. */
  sanitizeExtension(ext, secretStore) {
    if (!ext || typeof ext !== "object") return ext;
    const id = String(ext.id || "").trim();
    const out = { ...ext };
    const envKeys = new Set();
    if (Array.isArray(ext.envKeyNames)) {
      for (const k of ext.envKeyNames) if (k) envKeys.add(String(k));
    }
    if (ext.env && typeof ext.env === "object") {
      for (const [k, v] of Object.entries(ext.env)) {
        if (isNonEmptyString(v) || looksLikeSecretEnvKey(k)) envKeys.add(k);
      }
    }
    const envConfigured = {};
    for (const key of envKeys) {
      const sid = extensionSecretId(id, key);
      envConfigured[key] = !!(secretStore && secretStore.has(sid));
    }
    delete out.env;
    out.envKeyNames = [...envKeys];
    out.envConfigured = envConfigured;
    return out;
  }

  toPublicConfig(raw, secretStore) {
    const cfg = { ...(raw || defaultPublicConfig(this.defaultPackageDir)) };
    const store = secretStore || this.secretStore;
    const list = Array.isArray(cfg.capabilityExtensions)
      ? cfg.capabilityExtensions.map((e) => this.sanitizeExtension(e, store))
      : [];
    return {
      provider: cfg.provider || "openai-compatible",
      baseURL: cfg.baseURL || "",
      model: cfg.model || "",
      packageDir: cfg.packageDir || this.defaultPackageDir,
      apiKey: "",
      apiKeyConfigured: !!(store && store.has(MODEL_API_KEY_ID)),
      capabilityExtensions: list,
      secretsMigration: cfg.secretsMigration || null,
      secretStoreWarning: cfg.secretStoreWarning || null,
    };
  }

  readPublicConfig() {
    return this.toPublicConfig(this.readRawConfig(), this.secretStore);
  }

  /** Main-process runtime config: public fields + resolved model apiKey. */
  getRuntimeConfig() {
    const publicCfg = this.readPublicConfig();
    let apiKey = "";
    try {
      if (this.secretStore.has(MODEL_API_KEY_ID)) {
        apiKey = this.secretStore.get(MODEL_API_KEY_ID) || "";
      }
    } catch {
      apiKey = "";
    }
    return {
      provider: publicCfg.provider,
      baseURL: publicCfg.baseURL,
      model: publicCfg.model,
      packageDir: publicCfg.packageDir,
      apiKey,
      capabilityExtensions: this.readRawConfig().capabilityExtensions || [],
    };
  }

  /**
   * Persist public fields. apiKey behavior:
   * - undefined / "" => keep existing secret
   * - non-empty string => replace secret
   * Does not accept renderer-supplied apiKeyConfigured as truth.
   */
  setConfigFromRenderer(input) {
    if (!input || typeof input !== "object") {
      const err = new Error("invalid_config_payload");
      err.code = "invalid_config_payload";
      throw err;
    }
    const raw = this.readRawConfig();
    const next = {
      ...raw,
      provider: "openai-compatible",
      baseURL: typeof input.baseURL === "string" ? input.baseURL.trim() : raw.baseURL || "",
      model: typeof input.model === "string" ? input.model.trim() : raw.model || "",
      packageDir:
        typeof input.packageDir === "string" ? input.packageDir.trim() : raw.packageDir || this.defaultPackageDir,
    };
    // Never trust renderer apiKeyConfigured; never persist plaintext apiKey.
    delete next.apiKey;

    if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      if (!this.secretStore.isEncryptionAvailable()) {
        const err = new Error("secret_encryption_unavailable");
        err.code = "secret_encryption_unavailable";
        throw err;
      }
      const value = input.apiKey.trim();
      this.secretStore.set(MODEL_API_KEY_ID, value);
      if (!this.secretStore.verify(MODEL_API_KEY_ID, value)) {
        const err = new Error("secret_verify_failed");
        err.code = "secret_verify_failed";
        throw err;
      }
    }

    if (Array.isArray(input.capabilityExtensions)) {
      next.capabilityExtensions = input.capabilityExtensions.map((e) =>
        this.sanitizeExtension(e, this.secretStore)
      );
    } else if (Array.isArray(raw.capabilityExtensions)) {
      next.capabilityExtensions = raw.capabilityExtensions.map((e) =>
        this.sanitizeExtension(e, this.secretStore)
      );
    }

    this.writeRawConfig(next);
    return this.readPublicConfig();
  }

  clearModelApiKey() {
    this.secretStore.delete(MODEL_API_KEY_ID);
    const raw = this.readRawConfig();
    if (Object.prototype.hasOwnProperty.call(raw, "apiKey")) {
      delete raw.apiKey;
      this.writeRawConfig(raw);
    }
    return this.readPublicConfig();
  }

  collectLegacySecrets(raw) {
    const found = [];
    if (isNonEmptyString(raw.apiKey)) {
      found.push({ id: MODEL_API_KEY_ID, value: String(raw.apiKey).trim(), source: "config.apiKey" });
    }
    const list = Array.isArray(raw.capabilityExtensions) ? raw.capabilityExtensions : [];
    for (const ext of list) {
      if (!ext || !ext.id || !ext.env || typeof ext.env !== "object") continue;
      for (const [key, value] of Object.entries(ext.env)) {
        if (!isNonEmptyString(value)) continue;
        if (!looksLikeSecretEnvKey(key) && String(value).length < 8) continue;
        found.push({
          id: extensionSecretId(ext.id, key),
          value: String(value).trim(),
          source: `extension.${ext.id}.env.${key}`,
          extensionId: ext.id,
          envKey: key,
        });
      }
    }
    return found;
  }

  /**
   * Idempotent migration. On any failure, leave config plaintext intact.
   * @returns {{ status: string, migratedCount?: number, warning?: string }}
   */
  migrateLegacySecrets() {
    const raw = this.readRawConfig();
    const legacy = this.collectLegacySecrets(raw);
    const already =
      raw.secretsMigration &&
      raw.secretsMigration.version === MIGRATION_VERSION &&
      raw.secretsMigration.status === "completed";

    if (!legacy.length) {
      if (!already) {
        raw.secretsMigration = {
          version: MIGRATION_VERSION,
          status: "completed",
          completedAt: new Date().toISOString(),
          migratedCount: 0,
          note: "no_plaintext_secrets",
        };
        delete raw.secretStoreWarning;
        delete raw.apiKey;
        if (Array.isArray(raw.capabilityExtensions)) {
          raw.capabilityExtensions = raw.capabilityExtensions.map((e) =>
            this.sanitizeExtension(e, this.secretStore)
          );
        }
        this.writeRawConfig(raw);
      }
      this.lastMigration = { status: "completed", migratedCount: 0 };
      return this.lastMigration;
    }

    if (!this.secretStore.isEncryptionAvailable()) {
      const warning =
        "本机安全存储不可用，连接密钥仍留在普通配置中。请检查系统登录与凭据保护后重启应用；在修复前不会清除旧配置。";
      raw.secretStoreWarning = {
        code: "secret_encryption_unavailable",
        message: warning,
        at: new Date().toISOString(),
      };
      raw.secretsMigration = {
        version: MIGRATION_VERSION,
        status: "blocked",
        reason: "secret_encryption_unavailable",
        at: new Date().toISOString(),
        pendingCount: legacy.length,
      };
      this.writeRawConfig(raw);
      this.lastMigration = { status: "blocked", warning, pendingCount: legacy.length };
      return this.lastMigration;
    }

    // Backup before any mutation of secrets file / config cleanup.
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true });
      fs.copyFileSync(this.configPath, this.backupPath());
    } catch (err) {
      const warning = "无法备份旧配置，已中止密钥迁移；旧配置未改动。";
      this.lastMigration = { status: "failed", warning, code: "backup_failed" };
      return this.lastMigration;
    }

    try {
      for (const item of legacy) {
        this.secretStore.set(item.id, item.value);
        if (!this.secretStore.verify(item.id, item.value)) {
          const err = new Error("secret_verify_failed");
          err.code = "secret_verify_failed";
          err.secretId = item.id;
          throw err;
        }
      }
    } catch (err) {
      const warning =
        "密钥未能安全写入或校验失败，已保留旧配置明文。请重启应用重试；在成功前不会删除旧密钥。";
      raw.secretStoreWarning = {
        code: err.code || "migrate_write_failed",
        message: warning,
        at: new Date().toISOString(),
        secretId: err.secretId || undefined,
      };
      raw.secretsMigration = {
        version: MIGRATION_VERSION,
        status: "failed",
        reason: err.code || "migrate_write_failed",
        at: new Date().toISOString(),
        pendingCount: legacy.length,
      };
      // Do not strip plaintext.
      this.writeRawConfig(raw);
      this.lastMigration = { status: "failed", warning, code: err.code };
      return this.lastMigration;
    }

    // All secrets verified — now strip plaintext from config atomically.
    const cleaned = { ...raw };
    delete cleaned.apiKey;
    delete cleaned.secretStoreWarning;
    if (Array.isArray(cleaned.capabilityExtensions)) {
      cleaned.capabilityExtensions = cleaned.capabilityExtensions.map((ext) => {
        const envKeyNames = new Set();
        if (ext.env && typeof ext.env === "object") {
          for (const k of Object.keys(ext.env)) envKeyNames.add(k);
        }
        if (Array.isArray(ext.envKeyNames)) {
          for (const k of ext.envKeyNames) envKeyNames.add(k);
        }
        const copy = { ...ext };
        delete copy.env;
        copy.envKeyNames = [...envKeyNames];
        return this.sanitizeExtension(copy, this.secretStore);
      });
    }
    cleaned.secretsMigration = {
      version: MIGRATION_VERSION,
      status: "completed",
      completedAt: new Date().toISOString(),
      migratedCount: legacy.length,
    };
    this.writeRawConfig(cleaned);
    this.lastMigration = { status: "completed", migratedCount: legacy.length };
    return this.lastMigration;
  }

  /** Extract secrets from enable/save payloads; persist only names on disk. */
  ingestExtensionSecrets(extensionId, envObj) {
    const configured = {};
    if (!envObj || typeof envObj !== "object") return configured;
    for (const [key, value] of Object.entries(envObj)) {
      if (!isNonEmptyString(value)) {
        configured[key] = this.secretStore.has(extensionSecretId(extensionId, key));
        continue;
      }
      if (!this.secretStore.isEncryptionAvailable()) {
        const err = new Error("secret_encryption_unavailable");
        err.code = "secret_encryption_unavailable";
        throw err;
      }
      const sid = extensionSecretId(extensionId, key);
      const plain = String(value).trim();
      this.secretStore.set(sid, plain);
      if (!this.secretStore.verify(sid, plain)) {
        const err = new Error("secret_verify_failed");
        err.code = "secret_verify_failed";
        err.secretId = sid;
        throw err;
      }
      configured[key] = true;
    }
    return configured;
  }

  clearExtensionSecret(extensionId, envKey) {
    return this.secretStore.delete(extensionSecretId(extensionId, envKey));
  }

  /** Hydrate env for one extension from SecretStore (main process connect path). */
  hydrateExtensionEnv(ext) {
    if (!ext || !ext.id) return { ...ext, env: {} };
    const env = {};
    const names = new Set();
    if (Array.isArray(ext.envKeyNames)) {
      for (const k of ext.envKeyNames) names.add(k);
    }
    if (ext.envConfigured && typeof ext.envConfigured === "object") {
      for (const k of Object.keys(ext.envConfigured)) names.add(k);
    }
    if (ext.env && typeof ext.env === "object") {
      // Legacy in-memory shape during migration window.
      for (const [k, v] of Object.entries(ext.env)) {
        if (isNonEmptyString(v)) env[k] = String(v);
        else names.add(k);
      }
    }
    for (const key of names) {
      const sid = extensionSecretId(ext.id, key);
      if (this.secretStore.has(sid)) {
        try {
          const v = this.secretStore.get(sid);
          if (isNonEmptyString(v)) env[key] = v;
        } catch {
          /* leave missing */
        }
      }
    }
    return { ...ext, env };
  }

  getPublicExtensions() {
    return this.readPublicConfig().capabilityExtensions;
  }

  saveExtensionsList(list) {
    if (!Array.isArray(list)) {
      const err = new Error("extensions_must_be_array");
      err.code = "extensions_must_be_array";
      throw err;
    }
    const raw = this.readRawConfig();
    const nextList = [];
    for (const ext of list) {
      const id = String(ext.id || "").trim();
      if (!id) continue;
      if (ext.env && typeof ext.env === "object") {
        this.ingestExtensionSecrets(id, ext.env);
      }
      const envKeyNames = new Set();
      if (Array.isArray(ext.envKeyNames)) {
        for (const k of ext.envKeyNames) if (k) envKeyNames.add(String(k));
      }
      if (ext.env && typeof ext.env === "object") {
        for (const k of Object.keys(ext.env)) envKeyNames.add(k);
      }
      nextList.push(
        this.sanitizeExtension(
          {
            id,
            name: String(ext.name || id).trim(),
            catalogId: ext.catalogId ? String(ext.catalogId) : undefined,
            command: String(ext.command || "").trim(),
            args: Array.isArray(ext.args) ? ext.args.map(String) : [],
            cwd: ext.cwd ? String(ext.cwd) : undefined,
            note: ext.note ? String(ext.note) : undefined,
            params: ext.params && typeof ext.params === "object" ? ext.params : undefined,
            envKeyNames: [...envKeyNames],
          },
          this.secretStore
        )
      );
    }
    raw.capabilityExtensions = nextList;
    delete raw.apiKey;
    this.writeRawConfig(raw);
    return this.getPublicExtensions();
  }
}

/** Deep scan object tree for known secret strings (tests / IPC redaction checks). */
function deepContainsSecret(value, secrets, depth = 0) {
  if (depth > 12 || value == null) return null;
  if (typeof value === "string") {
    for (const s of secrets) {
      if (s && value.includes(s)) return s;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepContainsSecret(item, secrets, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = deepContainsSecret(v, secrets, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

module.exports = {
  ConfigSecretsService,
  MODEL_API_KEY_ID,
  MIGRATION_VERSION,
  BACKUP_NAME,
  extensionSecretId,
  defaultPublicConfig,
  looksLikeSecretEnvKey,
  deepContainsSecret,
  SecretStore,
};
