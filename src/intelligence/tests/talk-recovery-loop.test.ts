/**
 * 失败后回到同一 Talk loop：模型看到执行事实，可另选已连接能力。
 * revision 不得锁死 lastCapability。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import type { ProfessionalAgent, TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-recover-${prefix}-`));
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

function failingWrite(): ProfessionalAgent {
  return {
    id: 'cap_fail_write',
    label: '失败写能力',
    description: '声明会写文件但实际不落盘',
    async run() {
      return {
        ok: false,
        failureReason: '外部执行没有在授权目录留下真实的用户文件或修改。',
        summary: '外部执行没有在授权目录留下真实的用户文件或修改。',
        producedOutputs: [],
      };
    },
  };
}

function succeedingWrite(): ProfessionalAgent {
  return {
    id: 'cap_ok_write',
    label: '成功写能力',
    description: '在授权目录写文件',
    async run({ instruction, workDir }) {
      await fs.mkdir(workDir, { recursive: true });
      const outputPath = path.join(workDir, 'hello.txt');
      await fs.writeFile(outputPath, instruction, 'utf8');
      return {
        ok: true,
        summary: `已写下 ${outputPath}`,
        outputPath,
        producedOutputs: [outputPath],
      };
    },
  };
}

test('第一次能力失败后，同一轮模型可另选已连接能力', async () => {
  const root = await tempDir('switch');
  const pkgDir = path.join(root, 'pkg');
  let failRuns = 0;
  let okRuns = 0;
  const fail = {
    ...failingWrite(),
    async run(input: { instruction: string; workDir: string; signal: AbortSignal }) {
      failRuns += 1;
      return failingWrite().run(input);
    },
  };
  const ok = {
    ...succeedingWrite(),
    async run(input: { instruction: string; workDir: string; signal: AbortSignal }) {
      okRuns += 1;
      return succeedingWrite().run(input);
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '写 hello.txt', capabilityId: 'cap_fail_write' }),
          },
        ],
      }),
      async ({ messages, tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        assert.match(tool, /cap_fail_write/);
        return {
          text: '',
          toolCalls: [
            {
              id: 't2',
              name: 'delegate',
              arguments: JSON.stringify({ instruction: '写 hello.txt', capabilityId: 'cap_ok_write' }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        return { text: '已经写好 hello.txt。' };
      },
    ]),
    talkProfessionals: [fail, ok],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '恢复', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '请写一个 hello.txt，内容随便' });
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ ok: boolean; capabilityId: string }>;
  };
  assert.equal(failRuns, 1);
  assert.equal(okRuns, 1);
  assert.deepEqual(
    rec.executions.map((e) => `${e.capabilityId}:${e.ok}`),
    ['cap_fail_write:false', 'cap_ok_write:true'],
  );
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /hello\.txt/);
  assert.equal(last?.result?.title, 'hello.txt');
  await runtime.stop();
});

test('revision 不得锁死 lastCapability；由模型再选', async () => {
  const root = await tempDir('rev');
  const pkgDir = path.join(root, 'pkg');
  let failRuns = 0;
  let okRuns = 0;
  const fail = {
    ...failingWrite(),
    async run(input: { instruction: string; workDir: string; signal: AbortSignal }) {
      failRuns += 1;
      return failingWrite().run(input);
    },
  };
  const ok = {
    ...succeedingWrite(),
    async run(input: { instruction: string; workDir: string; signal: AbortSignal }) {
      okRuns += 1;
      return succeedingWrite().run(input);
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '写 hello.txt', capabilityId: 'cap_fail_write' }),
          },
        ],
      }),
      async ({ tools, messages }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        const blob = JSON.stringify(messages);
        assert.equal(blob.includes('revision_delegate'), false);
        return {
          text: '',
          toolCalls: [
            {
              id: 't2',
              name: 'delegate',
              arguments: JSON.stringify({ instruction: '写 hello.txt', capabilityId: 'cap_ok_write' }),
            },
          ],
        };
      },
      async () => ({ text: '已经写好 hello.txt。' }),
    ]),
    talkProfessionals: [fail, ok],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '恢复', targetDir: pkgDir });
  await bus.invoke('talk', { text: '请写一个 hello.txt' });
  assert.equal(failRuns, 1);
  assert.equal(okRuns, 1);
  await runtime.stop();
});

test('多个已连接能力时未指定 capabilityId 不得默默落到 agents[0]', async () => {
  const root = await tempDir('noid');
  const pkgDir = path.join(root, 'pkg');
  let failRuns = 0;
  const fail = {
    ...failingWrite(),
    async run(input: { instruction: string; workDir: string; signal: AbortSignal }) {
      failRuns += 1;
      return failingWrite().run(input);
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '写 hello.txt' }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /未指定 capabilityId/);
        assert.equal(failRuns, 0);
        return { text: '需要先选定一个已连接能力。' };
      },
    ]),
    talkProfessionals: [fail, succeedingWrite()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '恢复', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '请写一个 hello.txt' });
  assert.equal(failRuns, 0);
  assert.equal(/已经写好/.test(talked.view.turns.map((t) => t.text).join('\n')), false);
  await runtime.stop();
});
