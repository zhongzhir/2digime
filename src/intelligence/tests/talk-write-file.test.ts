/**
 * 最薄 write_file：模型生成完整内容，runtime 只写盘并返回机械事实。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-write-${prefix}-`));
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

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>加法小游戏</title></head>
<body>
  <p>3 + 4 = ?</p>
  <button type="button" onclick="alert(7)">看答案</button>
</body>
</html>
`;

test('write_file 把模型生成的 HTML 写入授权目录，不调用 Codex', async () => {
  const root = await tempDir('html');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), false);
        return {
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({
                relativePath: 'math-game.html',
                content: HTML,
              }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /math-game\.html/);
        return { text: '小游戏已经写好，双击 math-game.html 就能玩。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '写入', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '帮我做一个双击就能玩的简单网页小游戏。',
  });
  const abs = path.join(pkgDir, 'intelligence', 'outputs', 'math-game.html');
  assert.equal(await fs.readFile(abs, 'utf8'), HTML);
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.equal(last?.result?.title, 'math-game.html');
  assert.equal(last?.result?.path, abs);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ capabilityId: string; ok: boolean }>;
    openGoal?: string;
  };
  assert.deepEqual(
    rec.executions.map((e) => `${e.capabilityId}:${e.ok}`),
    ['write_file:true'],
  );
  assert.equal(rec.openGoal, undefined);
  await runtime.stop();
});

test('write_file 越权路径不得写盘', async () => {
  const root = await tempDir('fence');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({
              relativePath: '../escape.txt',
              content: 'no',
            }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        return { text: '这次没有写入成功。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '围栏', targetDir: pkgDir });
  await bus.invoke('talk', { text: '写入一个文件' });
  const escaped = path.join(root, 'escape.txt');
  await assert.rejects(() => fs.stat(escaped));
  await runtime.stop();
});
