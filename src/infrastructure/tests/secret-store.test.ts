import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { FileSecretStore, createAesGcmCipherAdapter, providerCredentialKey } from '../secret-store';
import { makeTempDir } from './helpers';

const SECRET_VALUE = 'sk-test-PLAINTEXT-1234567890';

test('provider credential put/get/delete 往返', async () => {
  const dir = await makeTempDir('secrets');
  const store = new FileSecretStore({
    filePath: path.join(dir, 'secrets.v2.json'),
    cipher: createAesGcmCipherAdapter(randomBytes(32)),
  });
  const key = providerCredentialKey('openai-compatible');
  await store.put(key, SECRET_VALUE);
  assert.equal(await store.get(key), SECRET_VALUE);
  await store.delete(key);
  assert.equal(await store.get(key), null);
});

test('密钥不以明文落盘', async () => {
  const dir = await makeTempDir('secrets-cipher');
  const filePath = path.join(dir, 'secrets.v2.json');
  const store = new FileSecretStore({
    filePath,
    cipher: createAesGcmCipherAdapter(randomBytes(32)),
  });
  await store.put(providerCredentialKey('p1'), SECRET_VALUE);
  const raw = await fs.readFile(filePath, 'utf8');
  assert.ok(!raw.includes(SECRET_VALUE), 'store file must not contain plaintext secret');
  assert.ok(!raw.includes(Buffer.from(SECRET_VALUE, 'utf8').toString('base64')));
});

test('错误消息不包含密钥值', async () => {
  const dir = await makeTempDir('secrets-err');
  const store = new FileSecretStore({
    filePath: path.join(dir, 'secrets.v2.json'),
    cipher: createAesGcmCipherAdapter(randomBytes(32)),
  });
  try {
    await store.put('bad key with spaces', SECRET_VALUE);
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(!(error as Error).message.includes(SECRET_VALUE));
  }
});

test('适配器可替换(SecretAccessor 端口)', async () => {
  const dir = await makeTempDir('secrets-accessor');
  const identityCipher = {
    encrypt: (plain: string) => Buffer.from(plain.split('').reverse().join(''), 'utf8'),
    decrypt: (cipher: Buffer) => cipher.toString('utf8').split('').reverse().join(''),
  };
  const store = new FileSecretStore({
    filePath: path.join(dir, 'secrets.v2.json'),
    cipher: identityCipher,
  });
  await store.put('model.provider.x.apiKey', SECRET_VALUE);
  const accessor = store.accessor();
  assert.equal(await accessor.get('model.provider.x.apiKey'), SECRET_VALUE);
});
