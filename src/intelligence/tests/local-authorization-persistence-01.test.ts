/**
 * LOCAL-AUTHORIZATION-PERSISTENCE-01
 * Owner 目录授权跨回合、跨重启复用；兄弟目录重新询问；拒绝不写盘。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { resolveProposedAccessPath } from '../mechanical-tools';
import {
  folderCovers,
  isUncOrNetworkPath,
  canonicalizeFolderPath,
} from '../../authorization/filesystem-path';
import {
  listActiveFilesystemGrantFolders,
  revokeFilesystemGrant,
  listActiveFilesystemGrants,
} from '../../authorization/filesystem-grant';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-auth-persist-${prefix}-`));
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
}

test('canonical path：拒绝 UNC / ..，兄弟目录互不覆盖，子路径被覆盖', () => {
  assert.equal(isUncOrNetworkPath('\\\\server\\share\\docs'), true);
  assert.equal(isUncOrNetworkPath('desktop/TujimiCodingTest'), false);
  const home = path.resolve(os.tmpdir(), 'dm-auth-canon-home');
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  try {
    const ok = resolveProposedAccessPath('desktop/TujimiCodingTest');
    assert.equal(ok.ok, true);
    const escaped = resolveProposedAccessPath('desktop/TujimiCodingTest/../../Windows');
    assert.equal(escaped.ok, false);
    const unc = resolveProposedAccessPath('\\\\server\\share\\docs');
    assert.equal(unc.ok, false);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
  const granted = path.join(home, 'Desktop', 'TujimiCodingTest');
  const child = path.join(granted, 'src', 'app.js');
  const sibling = path.join(home, 'Desktop', 'AnotherFolder', 'x.txt');
  assert.equal(folderCovers(granted, child), true);
  assert.equal(folderCovers(granted, sibling), false);
  assert.equal(folderCovers(granted, canonicalizeFolderPath(granted)), true);
});

test('同目录第二回合与重启后不再询问；子路径可用', async () => {
  const home = await tempDir('reuse-home');
  const pkgDir = path.join(await tempDir('reuse-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  await withHome(home, async () => {
    const talkChat = scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'request_folder_access'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'a1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        };
      },
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'a.txt', content: 'one' }),
            },
          ],
        };
      },
      async () => ({ text: '已写 a.txt' }),
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'w2',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'b.txt', content: 'two' }),
            },
          ],
        };
      },
      async () => ({ text: '已写 b.txt' }),
    ]);
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async ({ path: folder }) => {
        asked.push(folder);
        return true;
      },
      talkChat,
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '授权持久', targetDir: pkgDir });
    await bus.invoke('talk', { text: '在 TujimiCodingTest 写 a.txt' });
    assert.equal(asked.length, 1);
    assert.equal(await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'a.txt'), 'utf8'), 'one');
    await bus.invoke('talk', { text: '再写 b.txt' });
    assert.equal(asked.length, 1, '同目录第二回合不得再弹授权');
    assert.equal(await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'b.txt'), 'utf8'), 'two');
    const granted = await listActiveFilesystemGrantFolders(pkgDir);
    assert.equal(granted.length, 1);
    await runtime.stop();

    const askedAfterRestart: string[] = [];
    const runtime2 = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async ({ path: folder }) => {
        askedAfterRestart.push(folder);
        return true;
      },
      talkChat: scriptedChat([
        async ({ tools }) => {
          assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
          return {
            text: '',
            toolCalls: [
              {
                id: 'w3',
                name: 'write_file',
                arguments: JSON.stringify({ relativePath: 'src/c.txt', content: 'three' }),
              },
            ],
          };
        },
        async () => ({ text: '已写子路径' }),
      ]),
      talkProfessionals: [],
    });
    const bus2 = createCommandBus(runtime2);
    await bus2.invoke('subject.openPackage', { dir: pkgDir });
    await bus2.invoke('talk', { text: '在同一目录子文件夹写 c.txt' });
    assert.equal(askedAfterRestart.length, 0, '重启后同目录不得再弹授权');
    assert.equal(
      await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'src', 'c.txt'), 'utf8'),
      'three',
    );
    await runtime2.stop();
  });
});

test('兄弟目录必须重新授权；拒绝后不写盘且同轮不再弹', async () => {
  const home = await tempDir('sib-home');
  const pkgDir = path.join(await tempDir('sib-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  await withHome(home, async () => {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async ({ path: folder }) => {
        asked.push(folder);
        return /TujimiCodingTest/i.test(folder);
      },
      talkChat: scriptedChat([
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'g1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'hello.txt', content: 'ok' }),
            },
          ],
        }),
        async () => ({ text: '已写 hello' }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'g2',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/AnotherFolder' }),
            },
          ],
        }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'g3',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/AnotherFolder' }),
            },
          ],
        }),
        async () => ({ text: '我暂时没能获得那个文件夹的访问。' }),
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '授权范围', targetDir: pkgDir });
    await bus.invoke('talk', { text: '写 hello.txt' });
    await bus.invoke('talk', { text: '在桌面 AnotherFolder 创建 x.txt' });
    assert.equal(asked.filter((item) => /AnotherFolder/i.test(item)).length, 1);
    assert.equal(await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'hello.txt'), 'utf8'), 'ok');
    assert.equal(
      await fs.access(path.join(home, 'Desktop', 'AnotherFolder', 'x.txt')).then(
        () => true,
        () => false,
      ),
      false,
    );
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions: Array<{ capabilityId: string; ok: boolean }>;
    };
    const lastFolder = [...rec.executions].reverse().find((item) => item.capabilityId === 'request_folder_access');
    assert.equal(lastFolder?.ok, false);
    await runtime.stop();
  });
});

test('撤销后同目录再次访问必须重新询问', async () => {
  const home = await tempDir('rev-home');
  const pkgDir = path.join(await tempDir('rev-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  await withHome(home, async () => {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async ({ path: folder }) => {
        asked.push(folder);
        return true;
      },
      talkChat: scriptedChat([
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'g1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'keep.txt', content: 'keep' }),
            },
          ],
        }),
        async () => ({ text: '已写' }),
        async ({ tools }) => {
          assert.equal(tools?.some((t) => t.function.name === 'write_file'), false);
          return {
            text: '',
            toolCalls: [
              {
                id: 'g2',
                name: 'request_folder_access',
                arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
              },
            ],
          };
        },
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'w2',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'again.txt', content: 'again' }),
            },
          ],
        }),
        async () => ({ text: '已再次授权并写入' }),
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '撤销授权', targetDir: pkgDir });
    await bus.invoke('talk', { text: '写 keep.txt' });
    assert.equal(asked.length, 1);
    const grants = await listActiveFilesystemGrants(pkgDir);
    assert.equal(grants.length, 1);
    const revoked = await revokeFilesystemGrant({
      packageRoot: pkgDir,
      grantId: grants[0]!.id,
      now: new Date().toISOString(),
    });
    assert.equal(revoked, true);
    assert.equal((await listActiveFilesystemGrants(pkgDir)).length, 0);
    await bus.invoke('talk', { text: '再写 again.txt' });
    assert.equal(asked.length, 2, '撤销后必须重新询问');
    assert.equal(
      await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'again.txt'), 'utf8'),
      'again',
    );
    await runtime.stop();
  });
});
