"use strict";

/**
 * PublicConfig vs RuntimeConfig separation and legacy secret migration.
 * Main-process only. Never returns secret plaintext to renderer-facing serializers.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { SecretStore, atomicWriteJson } = require("./secret-store");

const MODEL_API_KEY_ID = "model.apiKey";
const MIGRATION_VERSION = 1;
/** Legacy permanent backup name from earlier P1-01 revision; must be removed after success. */
const LEGACY_BACKUP_NAME = "config.json.pre-secret-migration.bak";
const PLAINTEXT_BACKUP_CLEANUP_FAILED = "plaintext_backup_cleanup_failed";

function cleanupFailureWarning() {
  return "检测到明文配置备份未能安全删除，已中止迁移并保留原配置。请重启应用重试；在备份清除前不会标记迁移完成。";
}

function residualBackupWarning() {
  return "检测到旧的明文配置备份仍存在且未能安全删除。请检查文件权限或磁盘空间后重启应用。";
}

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

function classifyReadError(err) {
  if (!err) return "config_read_failed";
  if (err instanceof SyntaxError) return "config_json_corrupt";
  if (err.code === "EACCES" || err.code === "EPERM") return "config_permission_denied";
  if (err.code === "EISDIR") return "config_not_a_file";
  return "config_read_failed";
}

class ConfigSecretsService {
  /**
   * @param {object} opts
   * @param {string} opts.userDataPath
   * @param {string} [opts.configPath]
   * @param {import('./secret-store').SecretStore} opts.secretStore
   * @param {string} [opts.defaultPackageDir]
   * @param {{ beforeCommitCleanedConfig?: Function, beforeWriteConfig?: Function, beforeDeletePlaintextBackup?: Function, beforeEnumeratePlaintextBackups?: Function }} [opts.hooks]
   */
  constructor(opts) {
    this.userDataPath = opts.userDataPath;
    this.configPath = opts.configPath || path.join(opts.userDataPath, "config.json");
    this.secretStore = opts.secretStore;
    this.defaultPackageDir = opts.defaultPackageDir || "";
    this.hooks = opts.hooks || {};
    this.lastMigration = null;
    this._activeTempBackupPath = null;
  }

  legacyBackupPath() {
    return path.join(this.userDataPath, LEGACY_BACKUP_NAME);
  }

  /** @deprecated use legacyBackupPath / temp backups; kept for tests expecting method name */
  backupPath() {
    return this.legacyBackupPath();
  }

  loadRawConfig() {
    if (!fs.existsSync(this.configPath)) {
      return {
        status: "missing",
        config: defaultPublicConfig(this.defaultPackageDir),
      };
    }
    let text;
    try {
      text = fs.readFileSync(this.configPath, "utf8");
    } catch (err) {
      return {
        status: "error",
        code: classifyReadError(err),
        message: "配置文件无法读取，已停止密钥迁移并保留原始数据。",
        error: err,
      };
    }
    try {
      const config = JSON.parse(text);
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return {
          status: "error",
          code: "config_json_corrupt",
          message: "配置文件不是有效的 JSON 对象，已停止密钥迁移并保留原始数据。",
        };
      }
      return { status: "ok", config };
    } catch (err) {
      return {
        status: "error",
        code: classifyReadError(err),
        message: "配置文件已损坏或无法解析，已停止密钥迁移并保留原始数据。",
        error: err,
      };
    }
  }

  /**
   * Returns config object. Defaults only when file is missing.
   * Throws on corrupt / permission / read failures (never silently overwrites).
   */
  readRawConfig() {
    const loaded = this.loadRawConfig();
    if (loaded.status === "ok" || loaded.status === "missing") {
      return loaded.config;
    }
    const err = new Error(loaded.message || "config_unreadable");
    err.code = loaded.code || "config_read_failed";
    throw err;
  }

  writeRawConfig(cfg) {
    if (typeof this.hooks.beforeWriteConfig === "function") {
      this.hooks.beforeWriteConfig(cfg);
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    atomicWriteJson(this.configPath, cfg);
  }

  _makeTempBackupPath() {
    const stamp = `${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
    return path.join(this.userDataPath, `config.json.migrate-tmp.${stamp}.bak`);
  }

  _enumeratePlaintextBackupPaths(extraPaths = [], { strict = false } = {}) {
    const paths = [];
    const seen = new Set();
    const add = (p) => {
      if (!p || seen.has(p)) return;
      seen.add(p);
      paths.push(p);
    };
    for (const p of extraPaths) add(p);
    add(this.legacyBackupPath());
    if (typeof this.hooks.beforeEnumeratePlaintextBackups === "function") {
      try {
        this.hooks.beforeEnumeratePlaintextBackups(this.userDataPath);
      } catch (err) {
        if (strict) {
          const e = new Error("enumerate_hook_failed");
          e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
          e.cause = err;
          throw e;
        }
      }
    }
    if (!fs.existsSync(this.userDataPath)) return paths;
    let names;
    try {
      names = fs.readdirSync(this.userDataPath);
    } catch (err) {
      if (strict) {
        const e = new Error("enumerate_backups_failed");
        e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
        e.cause = err;
        throw e;
      }
      return paths;
    }
    for (const name of names) {
      if (name.startsWith("config.json.migrate-tmp.") && name.endsWith(".bak")) {
        add(path.join(this.userDataPath, name));
      }
    }
    return paths;
  }

  _strictUnlink(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    if (typeof this.hooks.beforeDeletePlaintextBackup === "function") {
      try {
        this.hooks.beforeDeletePlaintextBackup(filePath);
      } catch (err) {
        const e = new Error("unlink_hook_failed");
        e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
        e.path = filePath;
        e.cause = err;
        throw e;
      }
    }
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      const e = new Error("unlink_failed");
      e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
      e.path = filePath;
      e.cause = err;
      throw e;
    }
    if (fs.existsSync(filePath)) {
      const e = new Error("unlink_residual");
      e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
      e.path = filePath;
      throw e;
    }
  }

  _verifyNoPlaintextBackupsRemain(extraPaths = []) {
    const remaining = [];
    for (const p of extraPaths) {
      if (p && fs.existsSync(p)) remaining.push(p);
    }
    if (fs.existsSync(this.legacyBackupPath())) {
      remaining.push(this.legacyBackupPath());
    }
    if (fs.existsSync(this.userDataPath)) {
      let names;
      try {
        names = fs.readdirSync(this.userDataPath);
      } catch (err) {
        const e = new Error("verify_enumerate_failed");
        e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
        e.cause = err;
        throw e;
      }
      for (const name of names) {
        if (name.startsWith("config.json.migrate-tmp.") && name.endsWith(".bak")) {
          remaining.push(path.join(this.userDataPath, name));
        }
      }
    }
    if (remaining.length) {
      const e = new Error("backups_remain");
      e.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
      e.remaining = remaining;
      throw e;
    }
  }

  /** Success-path barrier: delete all plaintext backups and verify none remain. */
  _strictCleanupPlaintextBackups(extraPaths = []) {
    const targets = this._enumeratePlaintextBackupPaths(extraPaths, { strict: true });
    for (const p of targets) {
      this._strictUnlink(p);
    }
    this._verifyNoPlaintextBackupsRemain(extraPaths);
  }

  /** Failure-path best effort; returns final safety state (never swallows residual risk). */
  _bestEffortCleanupPlaintextBackups(extraPaths = []) {
    let lastError = null;
    const targets = this._enumeratePlaintextBackupPaths(extraPaths, { strict: false });
    for (const p of targets) {
      try {
        this._strictUnlink(p);
      } catch (err) {
        lastError = err;
      }
    }
    try {
      this._verifyNoPlaintextBackupsRemain(extraPaths);
      return { ok: true, remaining: [], error: lastError };
    } catch (err) {
      return {
        ok: false,
        remaining: err.remaining || [],
        error: err,
        lastError: lastError || err,
      };
    }
  }

  _migrationBlockedByCleanup(err, raw, legacy, tempBackupPath) {
    const cleanup = this._bestEffortCleanupPlaintextBackups(
      [tempBackupPath, this._activeTempBackupPath].filter(Boolean)
    );
    this._activeTempBackupPath = null;
    const code = err.code || PLAINTEXT_BACKUP_CLEANUP_FAILED;
    const warning = cleanup.ok ? cleanupFailureWarning() : residualBackupWarning();
    // Before redacted commit: never mutate config.json; preserve original plaintext bytes.
    return {
      status: "failed",
      warning,
      code,
      cleanupOk: cleanup.ok,
      remainingBackups: cleanup.remaining,
    };
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

  toPublicConfig(raw, secretStore, extra = {}) {
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
      configUnreadable: !!extra.configUnreadable,
    };
  }

  readPublicConfig() {
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      return {
        ...this.toPublicConfig(defaultPublicConfig(this.defaultPackageDir), this.secretStore, {
          configUnreadable: true,
        }),
        secretStoreWarning: {
          code: loaded.code,
          message: loaded.message,
          at: new Date().toISOString(),
        },
        apiKeyConfigured: false,
        capabilityExtensions: [],
      };
    }
    return this.toPublicConfig(loaded.config, this.secretStore);
  }

  /** Main-process runtime config: public fields + resolved model apiKey. */
  getRuntimeConfig() {
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      return {
        provider: "openai-compatible",
        baseURL: "",
        model: "",
        packageDir: this.defaultPackageDir,
        apiKey: "",
        capabilityExtensions: [],
        configUnreadable: true,
      };
    }
    const publicCfg = this.toPublicConfig(loaded.config, this.secretStore);
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
      capabilityExtensions: Array.isArray(loaded.config.capabilityExtensions)
        ? loaded.config.capabilityExtensions
        : [],
    };
  }

  /**
   * Persist public fields. apiKey behavior:
   * - undefined / "" => keep existing secret
   * - non-empty string => replace secret
   * Does not accept renderer-supplied apiKeyConfigured as truth.
   * Refuses to write when existing config is unreadable/corrupt.
   */
  setConfigFromRenderer(input) {
    if (!input || typeof input !== "object") {
      const err = new Error("invalid_config_payload");
      err.code = "invalid_config_payload";
      throw err;
    }
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      const err = new Error(loaded.message || "config_unreadable");
      err.code = loaded.code || "config_unreadable";
      throw err;
    }
    const raw = loaded.config;
    const next = {
      ...raw,
      provider: "openai-compatible",
      baseURL: typeof input.baseURL === "string" ? input.baseURL.trim() : raw.baseURL || "",
      model: typeof input.model === "string" ? input.model.trim() : raw.model || "",
      packageDir:
        typeof input.packageDir === "string" ? input.packageDir.trim() : raw.packageDir || this.defaultPackageDir,
    };
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
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      return this.readPublicConfig();
    }
    const raw = loaded.config;
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
        // Migrate every non-empty env value (including short values like LOG_LEVEL=info).
        if (!isNonEmptyString(value)) continue;
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

  _buildCleanedConfig(raw, migratedCount) {
    const cleaned = { ...raw };
    delete cleaned.apiKey;
    delete cleaned.secretStoreWarning;
    if (Array.isArray(cleaned.capabilityExtensions)) {
      cleaned.capabilityExtensions = cleaned.capabilityExtensions.map((ext) => {
        const envKeyNames = new Set();
        if (ext.env && typeof ext.env === "object") {
          for (const [k, v] of Object.entries(ext.env)) {
            if (isNonEmptyString(v)) envKeyNames.add(k);
          }
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
      migratedCount,
    };
    return cleaned;
  }

  /**
   * Idempotent migration.
   * Success path: keep original config until secrets verified → remove temp plaintext backup →
   * atomic write of redacted config. Never leaves permanent plaintext backups.
   * Any failure: original config preserved; status is never "completed".
   */
  migrateLegacySecrets() {
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      this.lastMigration = {
        status: "blocked",
        warning: loaded.message,
        code: loaded.code,
        preserveOriginal: true,
      };
      return this.lastMigration;
    }

    const raw = loaded.config;
    const legacy = this.collectLegacySecrets(raw);
    const already =
      raw.secretsMigration &&
      raw.secretsMigration.version === MIGRATION_VERSION &&
      raw.secretsMigration.status === "completed";

    if (!legacy.length) {
      if (!already) {
        const cleaned = this._buildCleanedConfig(raw, 0);
        cleaned.secretsMigration.note = "no_plaintext_secrets";
        try {
          this._strictCleanupPlaintextBackups();
          this.writeRawConfig(cleaned);
          this._strictCleanupPlaintextBackups();
        } catch (err) {
          this.lastMigration = {
            status: "failed",
            warning:
              err.code === PLAINTEXT_BACKUP_CLEANUP_FAILED
                ? cleanupFailureWarning()
                : "无法写入脱敏配置，已保留原配置。",
            code: err.code || "config_write_failed",
          };
          return this.lastMigration;
        }
      } else {
        try {
          this._strictCleanupPlaintextBackups();
        } catch (err) {
          this.lastMigration = {
            status: "failed",
            warning: residualBackupWarning(),
            code: err.code || PLAINTEXT_BACKUP_CLEANUP_FAILED,
            residualRisk: true,
          };
          return this.lastMigration;
        }
      }
      this.lastMigration = { status: "completed", migratedCount: 0 };
      return this.lastMigration;
    }

    if (!this.secretStore.isEncryptionAvailable()) {
      const warning =
        "本机安全存储不可用，连接密钥仍留在普通配置中。请检查系统登录与凭据保护后重启应用；在修复前不会清除旧配置。";
      // Metadata-only update; plaintext retained. Do not create permanent plaintext backup.
      try {
        const marked = {
          ...raw,
          secretStoreWarning: {
            code: "secret_encryption_unavailable",
            message: warning,
            at: new Date().toISOString(),
          },
          secretsMigration: {
            version: MIGRATION_VERSION,
            status: "blocked",
            reason: "secret_encryption_unavailable",
            at: new Date().toISOString(),
            pendingCount: legacy.length,
          },
        };
        this.writeRawConfig(marked);
      } catch {
        /* still report blocked even if warning persist failed */
      }
      this.lastMigration = { status: "blocked", warning, pendingCount: legacy.length };
      return this.lastMigration;
    }

    // Transaction: original config.json remains source of truth until final atomic replace.
    let tempBackupPath = null;
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true });
      tempBackupPath = this._makeTempBackupPath();
      this._activeTempBackupPath = tempBackupPath;
      fs.copyFileSync(this.configPath, tempBackupPath);
    } catch (err) {
      this._tryUnlinkQuiet(tempBackupPath);
      this._activeTempBackupPath = null;
      this.lastMigration = {
        status: "failed",
        warning: "无法创建迁移临时备份，已中止密钥迁移；旧配置未改动。",
        code: "backup_failed",
      };
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
      const cleanup = this._bestEffortCleanupPlaintextBackups([tempBackupPath]);
      this._activeTempBackupPath = null;
      const warning =
        "密钥未能安全写入或校验失败，已保留旧配置明文。请重启应用重试；在成功前不会删除旧密钥。";
      try {
        const marked = {
          ...raw,
          secretStoreWarning: {
            code: err.code || "migrate_write_failed",
            message: warning,
            at: new Date().toISOString(),
            secretId: err.secretId || undefined,
          },
          secretsMigration: {
            version: MIGRATION_VERSION,
            status: "failed",
            reason: err.code || "migrate_write_failed",
            at: new Date().toISOString(),
            pendingCount: legacy.length,
          },
        };
        this.writeRawConfig(marked);
      } catch {
        /* original file still present if this write fails */
      }
      const result = { status: "failed", warning, code: err.code || "migrate_write_failed" };
      if (!cleanup.ok) {
        result.code = PLAINTEXT_BACKUP_CLEANUP_FAILED;
        result.warning = residualBackupWarning();
        result.remainingBackups = cleanup.remaining;
      }
      this.lastMigration = result;
      return this.lastMigration;
    }

    const cleaned = this._buildCleanedConfig(raw, legacy.length);

    try {
      this._strictCleanupPlaintextBackups([tempBackupPath]);
      this._activeTempBackupPath = null;
    } catch (err) {
      this.lastMigration = this._migrationBlockedByCleanup(err, raw, legacy, tempBackupPath);
      return this.lastMigration;
    }

    try {
      if (typeof this.hooks.beforeCommitCleanedConfig === "function") {
        this.hooks.beforeCommitCleanedConfig(cleaned);
      }
      this.writeRawConfig(cleaned);
    } catch (err) {
      const cleanup = this._bestEffortCleanupPlaintextBackups([tempBackupPath]);
      this.lastMigration = {
        status: "failed",
        warning: cleanup.ok
          ? "脱敏配置写入失败，已保留旧配置明文，未标记迁移完成。"
          : residualBackupWarning(),
        code: cleanup.ok ? err.code || "config_write_failed" : PLAINTEXT_BACKUP_CLEANUP_FAILED,
        remainingBackups: cleanup.ok ? undefined : cleanup.remaining,
      };
      return this.lastMigration;
    }

    try {
      this._strictCleanupPlaintextBackups();
    } catch (err) {
      try {
        const fix = {
          ...cleaned,
          secretStoreWarning: {
            code: PLAINTEXT_BACKUP_CLEANUP_FAILED,
            message: residualBackupWarning(),
            at: new Date().toISOString(),
          },
          secretsMigration: {
            version: MIGRATION_VERSION,
            status: "failed",
            reason: PLAINTEXT_BACKUP_CLEANUP_FAILED,
            at: new Date().toISOString(),
            pendingCount: legacy.length,
          },
        };
        this.writeRawConfig(fix);
      } catch {
        /* cleaned config may still show completed on disk */
      }
      this.lastMigration = {
        status: "failed",
        warning: residualBackupWarning(),
        code: PLAINTEXT_BACKUP_CLEANUP_FAILED,
        residualRisk: true,
      };
      return this.lastMigration;
    }

    this.lastMigration = { status: "completed", migratedCount: legacy.length };
    return this.lastMigration;
  }

  _tryUnlinkQuiet(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* best-effort only */
    }
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
    const loaded = this.loadRawConfig();
    if (loaded.status === "error") {
      const err = new Error(loaded.message || "config_unreadable");
      err.code = loaded.code || "config_unreadable";
      throw err;
    }
    const raw = loaded.config;
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

/** Recursively scan files under dir for plaintext secrets. */
function scanDirForPlaintextSecrets(rootDir, secrets) {
  const hits = [];
  if (!fs.existsSync(rootDir)) return hits;
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let text;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      for (const s of secrets) {
        if (s && text.includes(s)) {
          hits.push({ file: path.relative(rootDir, full).split(path.sep).join("/"), secret: s });
        }
      }
    }
  }
  return hits;
}

module.exports = {
  ConfigSecretsService,
  MODEL_API_KEY_ID,
  MIGRATION_VERSION,
  LEGACY_BACKUP_NAME,
  PLAINTEXT_BACKUP_CLEANUP_FAILED,
  BACKUP_NAME: LEGACY_BACKUP_NAME,
  extensionSecretId,
  defaultPublicConfig,
  looksLikeSecretEnvKey,
  deepContainsSecret,
  scanDirForPlaintextSecrets,
  SecretStore,
};
