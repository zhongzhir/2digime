/**
 * ZERO-START-LOCAL-EXECUTION-FIX-01
 * clean machine 无预授权文件夹时，模型申请一次桌面/文件夹访问，
 * 确认后用现有 write_file 落盘；不把 PowerShell 交给主人。
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
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-local-exec-${prefix}-`));
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

test('resolveProposedAccessPath 只允许桌面/文档/下载围栏', async () => {
  const home = await tempDir('home');
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  try {
    await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
    const desktop = resolveProposedAccessPath('desktop/TujimiCodingTest');
    assert.equal(desktop.ok, true);
    if (desktop.ok) {
      assert.equal(desktop.abs, path.resolve(home, 'Desktop', 'TujimiCodingTest'));
    }
    const blocked = resolveProposedAccessPath(path.join(home, '..', 'escape'));
    assert.equal(blocked.ok, false);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
});

test('无授权文件夹时模型可申请桌面访问，确认后 write_file 写入 hello.txt', async () => {
  const home = await tempDir('grant-home');
  const root = await tempDir('grant-pkg');
  const pkgDir = path.join(root, 'pkg');
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async ({ path: folder }) => {
        asked.push(folder);
        return true;
      },
      talkChat: scriptedChat([
        async ({ tools }) => {
          assert.equal(tools?.some((t) => t.function.name === 'request_folder_access'), true);
          assert.equal(tools?.some((t) => t.function.name === 'write_file'), false);
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
                arguments: JSON.stringify({
                  relativePath: 'hello.txt',
                  content: 'hello world',
                }),
              },
            ],
          };
        },
        async ({ messages }) => {
          const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
          assert.match(tool, /actualSuccess":true/);
          return { text: '已经在桌面 TujimiCodingTest 里写好 hello.txt。' };
        },
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '本地执行', targetDir: pkgDir });
    const talked = await bus.invoke('talk', {
      text: '在桌面新建一个文件夹 TujimiCodingTest，在里面创建 hello.txt，内容写 hello world',
    });
    const hello = path.join(home, 'Desktop', 'TujimiCodingTest', 'hello.txt');
    const body = await fs.readFile(hello, 'utf8');
    assert.equal(body, 'hello world');
    assert.equal(asked.length, 1);
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions: Array<{ capabilityId: string; ok: boolean }>;
    };
    assert.deepEqual(
      rec.executions.map((e) => `${e.capabilityId}:${e.ok}`),
      ['request_folder_access:true', 'write_file:true'],
    );
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.equal(/PowerShell|请你自己|打开终端/.test(String(last?.text || '')), false);
    await runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
});

test('主人拒绝文件夹访问时不得写盘，也不得改口让用户跑命令', async () => {
  const home = await tempDir('deny-home');
  const root = await tempDir('deny-pkg');
  const pkgDir = path.join(root, 'pkg');
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async () => false,
      talkChat: scriptedChat([
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'a1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        }),
        async ({ messages }) => {
          const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
          assert.match(tool, /actualSuccess":false/);
          return { text: '我暂时没能获得修改本机文件的能力。' };
        },
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '拒绝', targetDir: pkgDir });
    await bus.invoke('talk', { text: '在桌面新建 TujimiCodingTest 并写 hello.txt' });
    await assert.rejects(() =>
      fs.stat(path.join(home, 'Desktop', 'TujimiCodingTest', 'hello.txt')),
    );
    await runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
});
