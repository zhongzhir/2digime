/**
 * 询问不得被收成写文件；同一目录授权不重复弹窗；附上的材料正文进入本轮上下文。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { resolveProposedAccessPath } from '../mechanical-tools';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-usability-${prefix}-`));
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

test('询问写法时材料进入上下文，且只声明验收标准不会改写成写文件', async () => {
  const home = await tempDir('ask-home');
  const pkgDir = path.join(await tempDir('ask-pkg'), 'pkg');
  const manuscript = path.join(home, 'manuscript.md');
  await fs.writeFile(manuscript, '语气用短句，少用感叹号。', 'utf8');
  let calls = 0;
  let seen = '';
  await withHome(home, async () => {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      requestFolderAccess: async () => {
        throw new Error('询问不应申请目录');
      },
      talkChat: scriptedChat([
        async ({ messages, tools }) => {
          calls += 1;
          seen = messages.map((item) => String(item.content || '')).join('\n');
          assert.equal(tools?.some((tool) => tool.function.name === 'set_expected_effects'), true);
          return {
            text: '',
            toolCalls: [
              {
                id: 'e1',
                name: 'set_expected_effects',
                arguments: JSON.stringify({ effects: [{ effect: 'file_created', target: 'out.md' }] }),
              },
            ],
          };
        },
        async () => {
          calls += 1;
          return { text: '会。我读到书稿里要求短句、少用感叹号。这次只是在回答，没有另存文件。' };
        },
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '询问', targetDir: pkgDir });
    const talked = await bus.invoke('talk', {
      text: '上传了书稿，是否会按照我的习惯和语气写作',
      contextPaths: [manuscript],
    });
    assert.match(seen, /短句/);
    assert.match(seen, /先分清这次是询问/);
    assert.equal(seen.includes('直接做'), false);
    assert.equal(calls, 2);
    const reply = talked.view.turns.map((turn) => turn.text).join('\n');
    assert.match(reply, /没有另存文件/);
    assert.equal(reply.includes('不能收工'), false);
    await assert.rejects(fs.stat(path.join(home, 'out.md')));
    await runtime.stop();
  });
});

test('同一目录的第二种写法不再弹出授权', async () => {
  const home = await tempDir('grant-home');
  const pkgDir = path.join(await tempDir('grant-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  await withHome(home, async () => {
    const proposed = resolveProposedAccessPath('desktop/SameFolder');
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
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
              id: 'a1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/SameFolder' }),
            },
            {
              id: 'a2',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: proposed.abs }),
            },
          ],
        }),
        async () => ({ text: '已有这个目录的授权。' }),
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '授权', targetDir: pkgDir });
    await bus.invoke('talk', { text: '请在 SameFolder 里放一个说明文件' });
    assert.equal(asked.length, 1);
    await runtime.stop();
  });
});
