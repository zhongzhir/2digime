import test from 'node:test';
import assert from 'node:assert/strict';
import { createElectronSafeStorageCipherAdapter } from '../electron-safe-storage-cipher';
import { FileSecretStore, providerCredentialKey } from '../secret-store';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('Electron safeStorage CipherAdapter 往返且不落明文', async () => {
  const fake = {
    encryptString(plain: string): Buffer {
      return Buffer.from(`enc:${plain}`, 'utf8');
    },
    decryptString(cipher: Buffer): string {
      const s = cipher.toString('utf8');
      assert.ok(s.startsWith('enc:'));
      return s.slice(4);
    },
    isEncryptionAvailable: () => true,
  };
  const cipher = createElectronSafeStorageCipherAdapter(fake);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-safe-'));
  const store = new FileSecretStore({
    filePath: path.join(dir, 'secrets.v2.json'),
    cipher,
  });
  const key = providerCredentialKey('openai-compatible');
  await store.put(key, 'sk-test-value');
  assert.equal(await store.get(key), 'sk-test-value');
  const raw = await fs.readFile(path.join(dir, 'secrets.v2.json'), 'utf8');
  assert.ok(!raw.includes('sk-test-value'));
  const parsed = JSON.parse(raw) as { secrets: Record<string, string> };
  const stored = parsed.secrets[key];
  assert.ok(typeof stored === 'string' && stored.length > 0);
  assert.notEqual(Buffer.from(stored, 'base64').toString('utf8'), 'sk-test-value');
});
