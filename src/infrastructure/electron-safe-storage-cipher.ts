/**
 * Electron safeStorage → CipherAdapter(P1.6)。
 * 仅基础设施适配;不改变 SecretAccessor / FileSecretStore 领域契约。
 */
import type { CipherAdapter } from './secret-store';

export interface ElectronSafeStorageLike {
  isEncryptionAvailable?: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (cipher: Buffer) => string;
}

export function createElectronSafeStorageCipherAdapter(
  safeStorage: ElectronSafeStorageLike,
): CipherAdapter {
  if (
    typeof safeStorage.encryptString !== 'function' ||
    typeof safeStorage.decryptString !== 'function'
  ) {
    throw new Error('safeStorage adapter requires encryptString/decryptString');
  }
  return {
    encrypt(plaintext: string): Buffer {
      const buf = safeStorage.encryptString(plaintext);
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        throw new Error('safeStorage encrypt returned empty buffer');
      }
      return buf;
    },
    decrypt(ciphertext: Buffer): string {
      return safeStorage.decryptString(ciphertext);
    },
  };
}

export function isElectronSafeStorageAvailable(safeStorage: ElectronSafeStorageLike): boolean {
  try {
    if (typeof safeStorage.isEncryptionAvailable === 'function') {
      return !!safeStorage.isEncryptionAvailable();
    }
    return typeof safeStorage.encryptString === 'function';
  } catch {
    return false;
  }
}
