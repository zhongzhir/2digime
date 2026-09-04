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
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-talk-${prefix}-`));
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
    description: '按完整文字目标写下一份说明文档。',
    async run({ instruction, workDir }) {
      await fs.mkdir(workDir, { recursive: true });
      const outputPath = path.join(workDir, 'result.md');
      await fs.writeFile(outputPath, `# 完成\n\n${instruction}\n`, 'utf8');
      return { ok: true, summary: `已写下说明：${instruction}`, outputPath, rawText: instruction };
    },
  };
}

test('A 普通交流不调用专业能力，并使用 Digital Self', async () => {
  const root = await tempDir('a');
  let delegated = 0;
  const agent = fileAgent();
  const wrapped: ProfessionalAgent = {
    ...agent,
    async run(input) {
      delegated += 1;
      return agent.run(input);
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    digitalSelfChat: async ({ messages }) => {
      const user = messages.filter((m) => m.role === 'user').pop();
      const prompt = String(user?.content || '');
      const start = prompt.indexOf('===DIGITAL_SELF_INPUT===');
      const input = start >= 0 ? prompt.slice(start + '===DIGITAL_SELF_INPUT==='.length).trim() : '';
      if (!input.includes('早起')) {
        return { text: JSON.stringify({ understandings: [] }) };
      }
      return {
        text: JSON.stringify({
          understandings: [
            {
              text: '用户喜欢早起处理事情',
              facet: 'preferences',
              aboutUser: true,
              origin: 'user_statement',
            },
          ],
        }),
      };
    },
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /喜欢早起处理事情/);
        assert.match(sys, /你是用户的兔机米，负责理解、编排与验收/);
        assert.equal(sys.includes('GrowthEvent'), false);
        assert.equal(/WorkIntent|outputFamily/.test(sys), false);
        return { text: '你喜欢早起处理事情。这是我现在对你的理解。' };
      },
    ]),
    talkProfessionals: [wrapped],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '交流主体',
    targetDir: path.join(root, 'pkg'),
  });
  await bus.invoke('digitalSelf', { action: 'tell', text: '我喜欢早起处理事情' });
  const talked = await bus.invoke('talk', { text: '你现在了解我什么？' });
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /早起/);
  assert.equal(delegated, 0);
  await runtime.stop();
});

test('B 需要行动时模型调用专业能力，2digime 验收后再交付', async () => {
  const root = await tempDir('b');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '写一份明天上午三件待办的备忘' }),
          },
        ],
      }),
      async ({ messages }) => {
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        const tool = messages.filter((m) => m.role === 'tool').pop();
        assert.match(String(tool?.content || ''), /actualSuccess|已写下说明/);
        return { text: '备忘已经写好，三件待办都在里面。' };
      },
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /独立验收|验收/);
        assert.match(sys, /写一份明天上午/);
        return {
          text: JSON.stringify({
            deliver: true,
            userReply: '备忘已经写好，三件待办都在里面。',
            askUser: '',
            openGoal: '',
            revision: '',
          }),
        };
      },
    ]),
    talkProfessionals: [fileAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '交流主体',
    targetDir: path.join(root, 'pkg'),
  });
  const talked = await bus.invoke('talk', { text: '帮我写一份明天上午要做的三件事备忘' });
  const blob = talked.view.turns.map((t) => t.text).join('\n');
  assert.match(blob, /备忘已经写好/);
  assert.equal(blob.includes('cap_test_doc'), false);
  assert.equal(blob.includes('Job'), false);
  const assistant = talked.view.turns.find((t) => t.role === 'assistant');
  assert.ok(assistant?.result?.path);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(path.join(root, 'pkg')), 'utf8')) as {
    executions: Array<{ capabilityId: string }>;
  };
  assert.equal(rec.executions.length, 1);
  await runtime.stop();
});

test('C 换一种说法仍由模型决定调用，不增加路由', async () => {
  const root = await tempDir('c');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '生成一份简短备忘录，写明天上午三件待办' }),
          },
        ],
      }),
      async ({ messages }) => {
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        return { text: '备忘录已经写好。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '备忘录已经写好。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
    ]),
    talkProfessionals: [fileAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '交流主体',
    targetDir: path.join(root, 'pkg'),
  });
  const talked = await bus.invoke('talk', {
    text: '请生成一份简短备忘录，里面写明天上午的三件待办',
  });
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /备忘录已经写好/);
  await runtime.stop();
});

test('D 缺信息时问用户，回答后继续同一件事', async () => {
  const root = await tempDir('d');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '可以发，但我没有对方邮箱。请告诉我邮箱，我继续原来这件事。',
      }),
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        const blob = messages.map((m) => m.content).join('\n');
        assert.match(blob, /发给李明|邮箱/);
        assert.match(blob, /ming@example.com/);
        assert.equal(sys.includes('intent'), false);
        return { text: '好，我用这个邮箱继续原来要把说明发给李明这件事。' };
      },
    ]),
    talkProfessionals: [fileAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '交流主体',
    targetDir: path.join(root, 'pkg'),
  });
  const first = await bus.invoke('talk', { text: '把这份说明发给我同事李明，用他的邮箱' });
  assert.match(first.view.turns.map((t) => t.text).join('\n'), /邮箱/);
  const second = await bus.invoke('talk', { text: '他的邮箱是 ming@example.com' });
  assert.match(second.view.turns.map((t) => t.text).join('\n'), /李明/);
  assert.equal(second.view.turns.filter((t) => t.role === 'user').length, 2);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(path.join(root, 'pkg')), 'utf8')) as {
    turns: unknown[];
  };
  assert.equal(rec.turns.length, 4);
  await runtime.stop();
});

test('执行失败时 review 不能把结果改写成成功', async () => {
  const root = await tempDir('fail');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '创建 README.md' }),
          },
        ],
      }),
      async ({ messages }) => {
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        return { text: '已在工作区创建 README.md，并写入了项目简短说明。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '已在工作区创建 README.md，并写入了项目简短说明。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
    ]),
    talkProfessionals: [
      {
        id: 'cap_failing',
        label: '代码执行能力',
        description: '会改文件',
        async run() {
          return {
            ok: false,
            failureReason: 'CodingPlan 未领取或已失效（HTTP 403）。',
            summary: 'CodingPlan 未领取或已失效（HTTP 403）。',
            producedOutputs: [],
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '交流主体',
    targetDir: path.join(root, 'pkg'),
  });
  const talked = await bus.invoke('talk', { text: '请在这个工作区创建 README.md，写一段简短项目说明。' });
  const blob = talked.view.turns.map((t) => t.text).join('\n');
  assert.match(blob, /还没有做成|403/);
  assert.equal(/已在工作区创建 README/.test(blob), false);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(path.join(root, 'pkg')), 'utf8')) as {
    executions: Array<{ ok: boolean }>;
  };
  assert.equal(rec.executions[0]?.ok, false);
  await runtime.stop();
});
