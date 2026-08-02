import type { SecretAccessor } from '../capability/adapter';
import { atomicWriteFile, readFileWithRecovery } from './fs-atomic';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * SecretStore(P1.1 §3):加密密钥存储,思路摘取重写自 Legacy secret-store,零代码复制。
 * - 加密经可替换 CipherAdapter;Electron safeStorage 适配后置到薄壳阶段;
 * - Node 测试可用 AES-256-GCM 适配器;
 * - 明文密钥永不落盘、永不进入错误消息、本模块无任何日志输出。
 */
export interface CipherAdapter {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

/** AES-256-GCM 适配器(iv(12) + authTag(16) + data)。 */
export function createAesGcmCipherAdapter(key: Buffer): CipherAdapter {
  if (key.length !== 32) {
    throw new Error('cipher key must be 32 bytes');
  }
  return {
    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt(ciphertext: Buffer): string {
      const iv = ciphertext.subarray(0, 12);
      const tag = ciphertext.subarray(12, 28);
      const data = ciphertext.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}

const KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** provider credential 命名约定(沿用 Legacy 格式,便于后续一次性导入)。 */
export function providerCredentialKey(providerId: string): string {
  if (!KEY_PATTERN.test(providerId)) {
    throw new Error('invalid provider id');
  }
  return `model.provider.${providerId}.apiKey`;
}

interface SecretFileShape {
  version: 2;
  secrets: Record<string, string>; // key → base64(ciphertext)
}

export class FileSecretStore {
  private readonly filePath: string;
  private readonly cipher: CipherAdapter;

  constructor(options: { filePath: string; cipher: CipherAdapter }) {
    this.filePath = options.filePath;
    this.cipher = options.cipher;
  }

  async put(key: string, value: string): Promise<void> {
    assertKey(key);
    const file = await this.load();
    file.secrets[key] = this.cipher.encrypt(value).toString('base64');
    await this.save(file);
  }

  async get(key: string): Promise<string | null> {
    assertKey(key);
    const file = await this.load();
    const encoded = file.secrets[key];
    if (encoded === undefined) return null;
    return this.cipher.decrypt(Buffer.from(encoded, 'base64'));
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const file = await this.load();
    if (key in file.secrets) {
      delete file.secrets[key];
      await this.save(file);
    }
  }

  /** 供 Capability Adapter 的只读访问器(capability/adapter.ts SecretAccessor 端口)。 */
  accessor(): SecretAccessor {
    return { get: (key: string) => this.get(key) };
  }

  private async load(): Promise<SecretFileShape> {
    const result = await readFileWithRecovery(this.filePath, isValidSecretFile);
    if (result.content === null) {
      return { version: 2, secrets: {} };
    }
    return JSON.parse(result.content) as SecretFileShape;
  }

  private async save(file: SecretFileShape): Promise<void> {
    await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    // 错误消息只含 key 形态信息,不含任何值。
    throw new Error('invalid secret key name');
  }
}

function isValidSecretFile(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as Partial<SecretFileShape>;
    return parsed.version === 2 && typeof parsed.secrets === 'object' && parsed.secrets !== null;
  } catch {
    return false;
  }
}
