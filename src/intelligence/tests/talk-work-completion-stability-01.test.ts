/**
 * 2DIGIME-TALK-WORK-COMPLETION-STABILITY-01
 * 完成语义：只有用户已获得可用最终结果，本轮才算完成。
 * 不测关键词路由；测 tool → 同一 Thread 综合 → 验收门禁。
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
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-complete-${prefix}-`));
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

function searchAgent(): ProfessionalAgent {
  return {
    id: 'cap_baseline_web_search',
    label: '基础搜索',
    description: '检索公开网页并返回来源与摘录。',
    async run({ instruction }) {
      return {
        ok: true,
        evidenceOnly: true,
        summary: [
          `# 检索证据：${instruction}`,
          '以下为公开来源摘录，只供 2digime 综合，不是给用户的最终答案。',
          '- Example: new model name reported',
          '  来源：https://example.com/openai',
        ].join('\n'),
        producedOutputs: [],
        rawText: 'evidence',
      };
    },
  };
}

function fileAgent(): ProfessionalAgent {
  return {
    id: 'cap_test_doc',
    label: '文档能力',
    description: '按完整文字目标写下一份说明文档。',
    async run({ instruction, workDir }) {
      await fs.mkdir(workDir, { recursive: true });
      const outputPath = path.join(workDir, 'memo.md');
      await fs.writeFile(outputPath, `# 备忘\n\n${instruction}\n`, 'utf8');
      return {
        ok: true,
        summary: `已写下备忘：${instruction}`,
        outputPath,
        producedOutputs: [outputPath],
        rawText: instruction,
      };
    },
  };
}

async function listResultMd(pkgDir: string): Promise<string[]> {
  const runs = path.join(pkgDir, 'intelligence', 'runs');
  const out: string[] = [];
  let execs: string[] = [];
  try {
    execs = await fs.readdir(runs);
  } catch {
    return out;
  }
  for (const id of execs) {
    const file = path.join(runs, id, 'result.md');
    try {
      await fs.access(file);
      out.push(file);
    } catch {
      /* none */
    }
  }
  return out;
}

test('A 简单常识问答：不搜索、不产生无意义 artifact', async () => {
  const root = await tempDir('a');
  let delegated = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.ok(tools?.some((t) => t.function.name === 'delegate'));
        return { text: '在标准大气压下，纯水大约在 100°C 沸腾。' };
      },
    ]),
    talkProfessionals: [
      {
        ...searchAgent(),
        async run(input) {
          delegated += 1;
          return searchAgent().run(input);
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  const pkgDir = path.join(root, 'pkg');
  await bus.invoke('subject.createPackage', { displayName: '完成语义', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '水在标准大气压下大约多少度沸腾？' });
  const assistant = talked.view.turns.find((t) => t.role === 'assistant');
  assert.match(String(assistant?.text || ''), /100/);
  assert.equal(assistant?.result, undefined);
  assert.equal(delegated, 0);
  assert.equal((await listResultMd(pkgDir)).length, 0);
  assert.equal(runtime.isWorkRuntimeAttached(), false);
  await runtime.stop();
});

test('B 最新信息：搜索只作证据，同一对话给出最终结论，不把来源清单当答案', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 's1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: 'OpenAI 今天发布的新模型叫什么名字？' }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = messages.filter((m) => m.role === 'tool').pop();
        const body = String(tool?.content || '');
        assert.match(body, /"role":"evidence"|evidenceOnly/);
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        assert.equal(/后续分析为准/.test(body), false);
        return { text: '根据刚检索到的公开信息，新模型叫 GPT-5.4。' };
      },
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /验收/);
        return {
          text: JSON.stringify({
            deliver: true,
            userReply: '上次给出的结论不完整，会重新整理后再回答。',
            askUser: '',
            openGoal: '',
            revision: '',
          }),
        };
      },
    ]),
    talkProfessionals: [searchAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '完成语义', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: 'openai今天发布的新模型叫什么名字？' });
  const assistant = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(assistant?.text || ''), /GPT-5\.4/);
  assert.equal(/重新整理后再回答|后续分析为准/.test(String(assistant?.text || '')), false);
  assert.equal(assistant?.result, undefined);
  assert.equal((await listResultMd(pkgDir)).length, 0);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ ok: boolean; producedOutputs?: string[] }>;
  };
  assert.equal(rec.executions.length, 1);
  assert.equal(rec.executions[0]?.ok, true);
  assert.equal(rec.executions[0]?.producedOutputs?.length || 0, 0);
  assert.equal(runtime.isWorkRuntimeAttached(), false);
  await runtime.stop();
});

test('C 做事任务：可以生成文件，同一对话必须说明做了什么、在哪里、是否完成', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
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
            arguments: JSON.stringify({ instruction: '写明天三件待办备忘' }),
          },
        ],
      }),
      async ({ messages }) => {
        assert.equal(messages.some((m) => m.role === 'tool'), true);
        return { text: '备忘已经写好，三件待办都在 memo.md 里。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '已经写好明天三件待办，文件在 memo.md，这一轮完成。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
    ]),
    talkProfessionals: [fileAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '完成语义', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '帮我写一份明天上午要做的三件事备忘，保存成文件' });
  const assistant = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(assistant?.text || ''), /memo\.md|备忘|完成/);
  assert.equal(assistant?.result?.title, 'memo.md');
  assert.ok(assistant?.result?.path);
  const written = await fs.readFile(assistant!.result!.path!, 'utf8');
  assert.match(written, /备忘/);
  await runtime.stop();
});

test('D 工具失败：明确失败，不伪装成功，不生成看起来完成的 result.md', async () => {
  const root = await tempDir('d');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'd1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '检索并写成报告' }),
          },
        ],
      }),
      async ({ messages }) => {
        const body = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(body, /actualSuccess":false|"ok":false/);
        return { text: '已经完成报告。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '已经完成报告，result.md 已写好。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
    ]),
    talkProfessionals: [
      {
        id: 'cap_failing_search',
        label: '基础搜索',
        description: '检索公开网页',
        async run() {
          return {
            ok: false,
            failureReason: 'search returned no usable evidence',
            summary: 'search returned no usable evidence',
            producedOutputs: [],
            evidenceOnly: true,
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '完成语义', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '帮我查一下并写成报告' });
  const blob = talked.view.turns.map((t) => t.text).join('\n');
  assert.match(blob, /还没有做成|没能/);
  assert.equal(/已经完成报告/.test(blob), false);
  const assistant = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.equal(assistant?.result, undefined);
  assert.equal((await listResultMd(pkgDir)).length, 0);
  await runtime.stop();
});

test('验收占位句不得盖过已有综合草稿', async () => {
  const root = await tempDir('placeholder');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 's1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: 'OpenAI 新模型名字' }),
          },
        ],
      }),
      async () => ({ text: '根据检索，目前公开信息里没有确认今天发布了新模型。' }),
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '已经看过结果。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
    ]),
    talkProfessionals: [searchAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '完成语义',
    targetDir: path.join(root, 'pkg'),
  });
  const talked = await bus.invoke('talk', { text: 'openai今天发布的新模型叫什么名字？' });
  const assistant = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(assistant?.text || ''), /检索|公开信息|新模型/);
  assert.equal(String(assistant?.text || '').includes('已经看过结果'), false);
  await runtime.stop();
});

test('E 连续多轮：上下文保留，上一轮工具不污染下一轮', async () => {
  const root = await tempDir('e');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 's1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: 'OpenAI 新模型名字' }),
          },
        ],
      }),
      async () => ({ text: '新模型叫 GPT-5.4。' }),
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '新模型叫 GPT-5.4。来源已核过。',
          askUser: '',
          openGoal: '',
          revision: '',
        }),
      }),
      async ({ messages, tools }) => {
        const blob = messages.map((m) => `${m.role}:${m.content}`).join('\n');
        assert.match(blob, /GPT-5\.4/);
        assert.match(blob, /和刚才那个有什么区别/);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        return { text: '刚才说的 GPT-5.4 是检索后的结论。和上一代相比，公开报道强调更长上下文。' };
      },
    ]),
    talkProfessionals: [searchAgent()],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '完成语义', targetDir: pkgDir });
  const first = await bus.invoke('talk', { text: 'openai今天发布的新模型叫什么名字？' });
  assert.match(first.view.turns.map((t) => t.text).join('\n'), /GPT-5\.4/);
  const second = await bus.invoke('talk', { text: '和刚才那个有什么区别？' });
  const last = [...second.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /GPT-5\.4|刚才/);
  assert.equal(last?.result, undefined);
  assert.equal(second.view.turns.filter((t) => t.role === 'user').length, 2);
  await runtime.stop();
});
