"use strict";

/**
 * Electron safeStorage adapter for SecretStore.
 * Ciphertext is stored as Base64 of the encrypted buffer (encoding only, not encryption).
 */

function createElectronSafeStorageAdapter(safeStorage) {
  if (!safeStorage) {
    throw new Error("safeStorage module required");
  }
  return {
    isAvailable() {
      try {
        return typeof safeStorage.isEncryptionAvailable === "function"
          ? !!safeStorage.isEncryptionAvailable()
          : false;
      } catch {
        return false;
      }
    },
    encryptString(plain) {
      const buf = safeStorage.encryptString(String(plain));
      if (!Buffer.isBuffer(buf) || !buf.length) {
        throw new Error("safeStorage_encrypt_empty");
      }
      return buf.toString("base64");
    },
    decryptString(cipherB64) {
      const buf = Buffer.from(String(cipherB64), "base64");
      return safeStorage.decryptString(buf);
    },
  };
}

module.exports = { createElectronSafeStorageAdapter };
