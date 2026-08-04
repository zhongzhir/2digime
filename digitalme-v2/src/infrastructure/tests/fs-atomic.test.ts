import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile, readFileWithRecovery, replaceFile } from '../fs-atomic';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-atomic-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('atomicWriteFile writes flushed content and keeps bak', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'state.json');
    await atomicWriteFile(file, '{"v":1}\n');
    await atomicWriteFile(file, '{"v":2}\n');
    const main = await fs.readFile(file, 'utf8');
    const bak = await fs.readFile(`${file}.bak`, 'utf8');
    assert.equal(main, '{"v":2}\n');
    assert.equal(bak, '{"v":1}\n');
  });
});

test('replaceFile retries transient EPERM then succeeds', async () => {
  await withTempDir(async (dir) => {
    const from = path.join(dir, 'a.tmp');
    const to = path.join(dir, 'a.json');
    await fs.writeFile(from, 'ok', 'utf8');
    let calls = 0;
    await replaceFile(from, to, {
      renameRetries: 4,
      initialBackoffMs: 1,
      sleepImpl: async () => undefined,
      renameImpl: async (f, t) => {
        calls += 1;
        if (calls < 3) {
          const err = Object.assign(new Error('injected EPERM'), { code: 'EPERM' });
          throw err;
        }
        await fs.rename(f, t);
      },
    });
    assert.equal(await fs.readFile(to, 'utf8'), 'ok');
    assert.ok(calls >= 3);
  });
});

test('replaceFile surfaces permanent permission errors after retries', async () => {
  await withTempDir(async (dir) => {
    const from = path.join(dir, 'b.tmp');
    const to = path.join(dir, 'b.json');
    await fs.writeFile(from, 'x', 'utf8');
    await assert.rejects(
      () =>
        replaceFile(from, to, {
          renameRetries: 3,
          initialBackoffMs: 1,
          sleepImpl: async () => undefined,
          renameImpl: async () => {
            throw Object.assign(new Error('permanent'), { code: 'EPERM' });
          },
        }),
      (err: NodeJS.ErrnoException & { atomicKind?: string }) => {
        assert.equal(err.code, 'EPERM');
        assert.equal(err.atomicKind, 'permission_or_lock');
        return true;
      },
    );
  });
});

test('replaceFile classifies missing path', async () => {
  await withTempDir(async (dir) => {
    const from = path.join(dir, 'missing.tmp');
    const to = path.join(dir, 'out.json');
    await assert.rejects(
      () =>
        replaceFile(from, to, {
          renameRetries: 1,
          renameImpl: async () => {
            throw Object.assign(new Error('noent'), { code: 'ENOENT' });
          },
        }),
      (err: NodeJS.ErrnoException & { atomicKind?: string }) => {
        assert.equal(err.code, 'ENOENT');
        assert.equal(err.atomicKind, 'path_missing');
        return true;
      },
    );
  });
});

test('readFileWithRecovery restores from bak after corruption', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'derived.json');
    await atomicWriteFile(file, '{"ok":true}\n');
    await atomicWriteFile(file, '{"ok":true,"n":2}\n');
    await fs.writeFile(file, '{broken', 'utf8');
    const recovered = await readFileWithRecovery(file, (c) => {
      try {
        JSON.parse(c);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(recovered.recoveredFromBackup, true);
    assert.ok(recovered.content && recovered.content.includes('"ok":true'));
    const main = await fs.readFile(file, 'utf8');
    assert.ok(main.includes('"ok":true'));
  });
});
