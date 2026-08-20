import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ContentStore } from '../content-store';
import { makeTempDir } from './helpers';

test('text 载荷落盘与读取,digest 寻址幂等', async () => {
  const root = await makeTempDir('content-text');
  const store = new ContentStore(root);
  const first = await store.putText('# 报告\n\n正文内容', 'markdown');
  assert.equal(first.content.kind, 'text');
  const second = await store.putText('# 报告\n\n正文内容', 'markdown');
  assert.deepEqual(second.content, first.content); // 同内容同 ref
  assert.equal(await store.getText(first.content), '# 报告\n\n正文内容');
});

test('file 载荷复制进管理目录', async () => {
  const root = await makeTempDir('content-file');
  const store = new ContentStore(root);
  const sourceDir = await makeTempDir('content-file-src');
  const sourcePath = path.join(sourceDir, 'photo.png');
  await fs.writeFile(sourcePath, Buffer.from([1, 2, 3, 4]));
  const content = await store.putFile(sourcePath, 'image/png');
  assert.equal(content.kind, 'file');
  if (content.kind === 'file') {
    assert.deepEqual(await store.readBytes(content.ref), Buffer.from([1, 2, 3, 4]));
    assert.ok(store.resolvePath(content.ref).startsWith(path.resolve(root)));
  }
});

test('bundle 载荷多条目', async () => {
  const root = await makeTempDir('content-bundle');
  const store = new ContentStore(root);
  const sourceDir = await makeTempDir('content-bundle-src');
  await fs.writeFile(path.join(sourceDir, 'a.bin'), Buffer.from([1]));
  await fs.writeFile(path.join(sourceDir, 'b.bin'), Buffer.from([2]));
  const content = await store.putBundle([
    { sourcePath: path.join(sourceDir, 'a.bin'), mediaType: 'application/octet-stream', role: 'main' },
    { sourcePath: path.join(sourceDir, 'b.bin'), mediaType: 'application/octet-stream' },
  ]);
  assert.equal(content.kind, 'bundle');
  if (content.kind === 'bundle') {
    assert.equal(content.entries.length, 2);
    assert.equal(content.entries[0]?.role, 'main');
    assert.deepEqual(await store.readBytes(content.entries[1]?.ref as string), Buffer.from([2]));
  }
});

test('越界 ref 拒绝(路径围栏)', async () => {
  const root = await makeTempDir('content-fence');
  const store = new ContentStore(root);
  assert.throws(() => store.resolvePath('../outside.txt'), /dot segments|escapes/);
  assert.throws(() => store.resolvePath('text/../../outside.txt'), /dot segments|escapes/);
  assert.throws(() => store.resolvePath('C:/Windows/system32/config'), /must be relative/);
  assert.throws(() => store.resolvePath('/etc/passwd'), /must be relative/);
  assert.throws(() => store.resolvePath('..\\outside.txt'), /dot segments|escapes/);
});
