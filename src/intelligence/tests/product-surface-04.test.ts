import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { composeTalkUserText } from '../service';
import type { ProfessionalAgent, TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-surface-${prefix}-`));
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

function fileAgent(): ProfessionalAgent {
  return {
    id: 'cap_test_doc',
    label: '文档能力',
    description: '写下说明文档。',
    async run({ instruction, workDir }) {
      await fs.mkdir(workDir, { recursive: true });
      const outputPath = path.join(workDir, 'README.md');
      await fs.writeFile(outputPath, `# 完成\n\n${instruction}\n`, 'utf8');
      return { ok: true, summary: '已写下 README.md', outputPath, rawText: instruction };
    },
  };
}

test('附件路径只进入这次交流上下文，不创建任务', () => {
  const text = composeTalkUserText('看一下这份说明', ['C:/tmp/notes/a.md']);
  assert.match(text, /看一下这份说明/);
  assert.match(text, /notes/);
  assert.match(text, /这次交流的上下文，不是新任务/);
  assert.equal(/taskId|Job|workspace/i.test(text), false);
});

test('产生文件时结果卡标题是文件名', async () => {
  const root = await tempDir('card');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [{ id: 'c1', name: 'delegate', arguments: '{"instruction":"写 README"}' }],
      }),
      async ({ messages }) => {
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        return { text: 'README 已经写好。' };
      },
    ]),
    talkProfessionals: [fileAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '表面',
    targetDir: path.join(root, 'pkg'),
  });
  const talked = await bus.invoke('talk', {
    text: '请写 README',
    contextPaths: [path.join(root, 'notes.md')],
  });
  const assistant = [...talked.view.turns].reverse().find((turn) => turn.role === 'assistant');
  assert.equal(assistant?.result?.title, 'README.md');
  assert.equal(talked.view.turns.some((turn) => turn.text.includes('notes.md')), true);
  assert.equal(talked.view.turns.some((turn) => /Job|taskId/.test(turn.text)), false);
  await runtime.stop();
});

test('正式路径 createPackage / talk 不初始化旧 Work Runtime', async () => {
  const root = await tempDir('no-work');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({ text: '你好。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  const pkgDir = path.join(root, 'pkg');
  await bus.invoke('subject.createPackage', {
    displayName: '表面',
    targetDir: pkgDir,
  });
  assert.equal(runtime.isPackageAttached(), true);
  assert.equal(runtime.isWorkRuntimeAttached(), false);
  await bus.invoke('talk', { text: '你好' });
  assert.equal(runtime.isWorkRuntimeAttached(), false);
  await fs.access(path.join(pkgDir, 'runtime', 'tasks')).then(
    () => {
      throw new Error('talk 不应创建旧 tasks 目录');
    },
    () => undefined,
  );
  await bus.invoke('work.listTasks', {});
  assert.equal(runtime.isWorkRuntimeAttached(), true);
  await runtime.stop();
});
