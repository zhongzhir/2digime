/**
 * DIGITALME-RESULT-DELIVERY-FINAL-FALLBACK-01
 * 模型最终回复为空或内部 actualSuccess JSON 时，复用 execution 机械事实，禁止 EMPTY_REPLY。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { EMPTY_REPLY } from '../loop';
import { TALK_EXECUTION_DONE_NOTICE } from '../service';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-final-fb-${prefix}-`));
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

test('TEST A：普通聊天正常文字不受影响', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([async () => ({ text: '这是一段正常的分析结论。' })]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'A', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '帮我分析一下。' });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    const text = String(last?.text ?? '');
    assert.notEqual(text, EMPTY_REPLY);
    assert.equal(text, '这是一段正常的分析结论。');
  } finally {
    await runtime.stop();
  }
});

test('TEST B：file doing 正常 final text 不受影响', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'notes');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'a.txt', content: 'ok\n' }),
          },
        ],
      }),
      async () => ({ text: '文件已经整理好了，内容已写回 a.txt。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'B', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '整理文件', contextPaths: [project] });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.equal(last?.text, '文件已经整理好了，内容已写回 a.txt。');
    assert.equal(await fs.readFile(path.join(project, 'a.txt'), 'utf8'), 'ok\n');
  } finally {
    await runtime.stop();
  }
});

test('TEST C：specialist 成功 + final 空串 → execution fallback', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'math');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'd1',
            name: 'delegate',
            arguments: JSON.stringify({
              capabilityId: 'cap_test_specialist',
              instruction: 'fix add.js',
            }),
          },
        ],
      }),
      async () => ({ text: '' }),
    ]),
    talkProfessionals: [
      {
        id: 'cap_test_specialist',
        label: '测试 specialist',
        description: '测试能力',
        async run() {
          const target = path.join(project, 'add.js');
          await fs.writeFile(target, 'module.exports = { add(a,b){return a+b;} };\n', 'utf8');
          return {
            ok: true,
            summary: 'wrote add.js',
            producedOutputs: [target],
            outputPath: target,
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'C', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '修好加法', contextPaths: [project] });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.equal(last?.text === EMPTY_REPLY, false);
    assert.match(String(last?.text || ''), /已完成/);
    assert.match(String(last?.text || ''), /add\.js/);
    assert.equal(last?.result?.path, path.join(project, 'add.js'));
  } finally {
    await runtime.stop();
  }
});

test('TEST D：specialist 成功 + final 为内部 actualSuccess JSON → fallback', async () => {
  const root = await tempDir('d');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'out');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'd1',
            name: 'delegate',
            arguments: JSON.stringify({
              capabilityId: 'cap_test_specialist',
              instruction: 'produce',
            }),
          },
        ],
      }),
      async () => ({
        text: JSON.stringify({
          actualSuccess: true,
          ok: true,
          capabilityId: 'cap_test_specialist',
          summary: 'internal only',
          producedOutputs: [path.join(project, 'x.js')],
        }),
      }),
    ]),
    talkProfessionals: [
      {
        id: 'cap_test_specialist',
        label: '测试 specialist',
        description: '测试能力',
        async run() {
          const target = path.join(project, 'x.js');
          await fs.writeFile(target, 'export const x = 1;\n', 'utf8');
          return { ok: true, summary: 'wrote x.js', producedOutputs: [target], outputPath: target };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'D', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '生成产物', contextPaths: [project] });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.equal(last?.text === EMPTY_REPLY, false);
    assert.equal(/actualSuccess/.test(String(last?.text || '')), false);
    assert.match(String(last?.text || ''), /已完成/);
    assert.match(String(last?.text || ''), /x\.js/);
  } finally {
    await runtime.stop();
  }
});

test('TEST E：execution failed + empty final → 不得谎称成功', async () => {
  const root = await tempDir('e');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'd1',
            name: 'delegate',
            arguments: JSON.stringify({
              capabilityId: 'cap_fail',
              instruction: 'do it',
            }),
          },
        ],
      }),
      async () => ({ text: '' }),
    ]),
    talkProfessionals: [
      {
        id: 'cap_fail',
        label: '失败能力',
        description: '总会失败',
        async run() {
          return {
            ok: false,
            summary: '外部能力这次没有改动任何文件。',
            failureReason: '外部能力这次没有改动任何文件。',
            producedOutputs: [],
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'E', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '请执行' });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.equal(last?.text === EMPTY_REPLY, false);
    assert.equal(/已完成/.test(String(last?.text || '')), false);
    assert.match(String(last?.text || ''), /没有改动|没有/);
  } finally {
    await runtime.stop();
  }
});

test('TEST F：无 execution + empty reply → 普通聊天 EMPTY_REPLY', async () => {
  const root = await tempDir('f');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([async () => ({ text: '' })]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'F', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '你好' });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    const text = String(last?.text ?? '');
    assert.notEqual(text, TALK_EXECUTION_DONE_NOTICE);
    assert.equal(text, EMPTY_REPLY);
  } finally {
    await runtime.stop();
  }
});
