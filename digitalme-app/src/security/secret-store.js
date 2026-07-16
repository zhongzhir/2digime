"use strict";

/**
 * OS-protected SecretStore (main process only).
 * Encryption is delegated to an injected adapter (Electron safeStorage in production;
 * fake adapter in unit tests). Never logs secret values.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_VERSION = 1;
const DEFAULT_FILE = "secrets.v1.json";

function assertId(id) {
  if (typeof id !== "string" || !id.trim()) {
    const err = new Error("invalid_secret_id");
    err.code = "invalid_secret_id";
    throw err;
  }
  return id.trim();
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    const e = new Error("secret_store_write_failed");
    e.code = "secret_store_write_failed";
    e.cause = err;
    throw e;
  }
}

class SecretStore {
  /**
   * @param {object} opts
   * @param {string} opts.userDataPath
   * @param {{ isAvailable: Function, encryptString: Function, decryptString: Function }} opts.encryptAdapter
   * @param {string} [opts.fileName]
   */
  constructor(opts) {
    if (!opts || !opts.userDataPath) {
      const err = new Error("secret_store_missing_user_data");
      err.code = "secret_store_missing_user_data";
      throw err;
    }
    if (!opts.encryptAdapter) {
      const err = new Error("secret_store_missing_adapter");
      err.code = "secret_store_missing_adapter";
      throw err;
    }
    this.userDataPath = opts.userDataPath;
    this.encryptAdapter = opts.encryptAdapter;
    this.filePath = path.join(opts.userDataPath, opts.fileName || DEFAULT_FILE);
  }

  isEncryptionAvailable() {
    try {
      return !!this.encryptAdapter.isAvailable();
    } catch {
      return false;
    }
  }

  _readDisk() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return { version: STORE_VERSION, secrets: {} };
      if (!data.secrets || typeof data.secrets !== "object") data.secrets = {};
      return data;
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return { version: STORE_VERSION, secrets: {} };
      }
      const e = new Error("secret_store_read_failed");
      e.code = "secret_store_read_failed";
      e.cause = err;
      throw e;
    }
  }

  _writeDisk(data) {
    data.version = STORE_VERSION;
    data.updatedAt = new Date().toISOString();
    atomicWriteJson(this.filePath, data);
  }

  has(id) {
    const sid = assertId(id);
    const data = this._readDisk();
    const entry = data.secrets[sid];
    return !!(entry && typeof entry.ciphertext === "string" && entry.ciphertext.length);
  }

  listConfigured() {
    const data = this._readDisk();
    return Object.keys(data.secrets || {})
      .filter((id) => {
        const entry = data.secrets[id];
        return entry && typeof entry.ciphertext === "string" && entry.ciphertext.length;
      })
      .sort();
  }

  get(id) {
    const sid = assertId(id);
    if (!this.isEncryptionAvailable()) {
      const err = new Error("secret_encryption_unavailable");
      err.code = "secret_encryption_unavailable";
      err.secretId = sid;
      throw err;
    }
    const data = this._readDisk();
    const entry = data.secrets[sid];
    if (!entry || !entry.ciphertext) return null;
    try {
      return this.encryptAdapter.decryptString(entry.ciphertext);
    } catch (err) {
      const e = new Error("secret_decrypt_failed");
      e.code = "secret_decrypt_failed";
      e.secretId = sid;
      e.cause = err;
      throw e;
    }
  }

  set(id, value) {
    const sid = assertId(id);
    if (typeof value !== "string" || !value.length) {
      const err = new Error("secret_empty_value");
      err.code = "secret_empty_value";
      err.secretId = sid;
      throw err;
    }
    if (!this.isEncryptionAvailable()) {
      const err = new Error("secret_encryption_unavailable");
      err.code = "secret_encryption_unavailable";
      err.secretId = sid;
      throw err;
    }
    let ciphertext;
    try {
      ciphertext = this.encryptAdapter.encryptString(value);
    } catch (err) {
      const e = new Error("secret_encrypt_failed");
      e.code = "secret_encrypt_failed";
      e.secretId = sid;
      e.cause = err;
      throw e;
    }
    if (typeof ciphertext !== "string" || !ciphertext.length) {
      const e = new Error("secret_encrypt_failed");
      e.code = "secret_encrypt_failed";
      e.secretId = sid;
      throw e;
    }
    // Refuse identity ciphertext and Base64-only "encryption" of plaintext.
    if (ciphertext === value) {
      const e = new Error("secret_encrypt_noop");
      e.code = "secret_encrypt_noop";
      e.secretId = sid;
      throw e;
    }
    try {
      const asUtf8 = Buffer.from(String(ciphertext), "base64").toString("utf8");
      if (asUtf8 === value) {
        const e = new Error("secret_encrypt_noop");
        e.code = "secret_encrypt_noop";
        e.secretId = sid;
        throw e;
      }
    } catch (err) {
      if (err && err.code === "secret_encrypt_noop") throw err;
      // Non-utf8 ciphertext is fine (real OS encryption).
    }
    const data = this._readDisk();
    data.secrets[sid] = {
      ciphertext,
      updatedAt: new Date().toISOString(),
    };
    this._writeDisk(data);
  }

  delete(id) {
    const sid = assertId(id);
    const data = this._readDisk();
    if (!data.secrets[sid]) return false;
    delete data.secrets[sid];
    this._writeDisk(data);
    return true;
  }

  /** Verify ciphertext round-trip without exposing value to callers beyond boolean. */
  verify(id, expectedPlain) {
    const got = this.get(id);
    return got === expectedPlain;
  }
}

function createFakeEncryptAdapter(opts = {}) {
  const available = opts.available !== false;
  const failEncrypt = !!opts.failEncrypt;
  const failDecrypt = !!opts.failDecrypt;
  // Deliberate non-secret transform for tests only — not used in production.
  const prefix = "enc:";
  return {
    isAvailable() {
      return available;
    },
    encryptString(plain) {
      if (failEncrypt) throw new Error("fake_encrypt_failed");
      return Buffer.from(prefix + plain, "utf8").toString("base64");
    },
    decryptString(cipher) {
      if (failDecrypt) throw new Error("fake_decrypt_failed");
      const raw = Buffer.from(String(cipher), "base64").toString("utf8");
      if (!raw.startsWith(prefix)) throw new Error("fake_bad_cipher");
      return raw.slice(prefix.length);
    },
  };
}

module.exports = {
  SecretStore,
  STORE_VERSION,
  DEFAULT_FILE,
  createFakeEncryptAdapter,
  atomicWriteJson,
};
