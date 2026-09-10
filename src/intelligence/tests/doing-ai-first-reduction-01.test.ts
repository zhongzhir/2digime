/**
 * DIGITALME-DOING-AI-FIRST-REDUCTION-01
 * 做事主链：Owner 授权目录内 Talk 可直接写；delegate 只是可选工具；
 * acquired OpenCode 只收原话 + cwd + 机械边界。不为 HTML 写 special case。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { compileCapabilityReality } from '../capability-reality';
import { describeProfessionals } from '../professionals';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-aifirst-${prefix}-`));
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

function assertNoStrategyProse(text: string): void {
  assert.equal(/适合复杂代码改动/.test(text), false);
  assert.equal(/代码执行：已连接/.test(text), false);
  assert.equal(/此时应该使用/.test(text), false);
  assert.equal(/executor-task-package|外部代码执行器/.test(text), false);
}

const INDEX = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>试用页</title>
<style>body{background:#fff;color:#111}body.dark{background:#111;color:#eee}</style>
</head>
<body>
  <h1>试用页</h1>
  <button type="button" id="theme">切换主题</button>
  <script>document.getElementById('theme').onclick=function(){document.body.classList.toggle('dark');};</script>
</body>
</html>
`;

const README = `# 试用页

打开 index.html。点「切换主题」在明暗之间切换。
`;

test('SMOKE A：普通聊天不调用 Coding Agent', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ tools, messages }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), false);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), false);
        return { text: '我可以聊天，也可以在你用“+”授权文件夹后改文件。需要复杂仓库改动时，也可以调用已连接的代码执行能力。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'A', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '你好，你能帮我做什么？' });
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions?: Array<{ capabilityId: string }>;
  };
  assert.equal((rec.executions || []).some((e) => /codex|acquired_coding|external_executor/i.test(e.capabilityId)), false);
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /聊|文件|授权|能力/);
  await runtime.stop();
});

test('SMOKE B：授权目录内 Talk 直接 read/write/check，不经 Coding Agent', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'trial-project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><body><h1>试用页</h1></body></html>\n', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    acquiredCodingCapability: {
      runtimeRoot: path.join(root, 'runtimes'),
      executeHook: async () => {
        throw new Error('SMOKE B 不得调用 Coding Agent');
      },
    },
    talkChat: scriptedChat([
      async ({ tools, messages }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'read_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        return {
          text: '',
          toolCalls: [
            { id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) },
          ],
        };
      },
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'index.html', content: INDEX }),
          },
          {
            id: 'w2',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'README.md', content: README }),
          },
        ],
      }),
      async ({ messages }) => {
        const tools = messages.filter((m) => m.role === 'tool').map((m) => String(m.content || ''));
        assert.equal(tools.some((t) => /actualSuccess":true/.test(t) && /index\.html/.test(t)), true);
        assert.equal(tools.some((t) => /actualSuccess":true/.test(t) && /README\.md/.test(t)), true);
        return { text: '已经加上明暗主题切换，并写了 README。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'B', targetDir: pkgDir });
  await bus.invoke('talk', {
    text: '给这个网页增加明暗主题切换，并补 README。',
    contextPaths: [project],
  });
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), INDEX);
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), README);
  await assert.rejects(() => fs.stat(path.join(pkgDir, 'intelligence', 'outputs', 'index.html')));
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ capabilityId: string; ok: boolean }>;
  };
  assert.equal(rec.executions.some((e) => e.capabilityId === 'write_file' && e.ok), true);
  assert.equal(rec.executions.some((e) => /codex|acquired_coding/i.test(e.capabilityId)), false);
  await runtime.stop();
});

test('SMOKE C：模型可自主 delegate；OpenCode 只收原话 + cwd + 机械边界', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  const repo = path.join(root, 'tiny-math');
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'add.js'), 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n', 'utf8');
  await fs.writeFile(
    path.join(repo, 'add.test.js'),
    "const { add } = require('./add');\nif (add(2, 3) !== 5) throw new Error('add broken');\n",
    'utf8',
  );
  await fs.writeFile(path.join(repo, 'package.json'), '{"name":"tiny-math","version":"1.0.0"}\n', 'utf8');
  let captured: { instruction?: string; workingDirectory?: string; prompt?: string } = {};
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    acquiredCodingCapability: {
      runtimeRoot: path.join(root, 'runtimes'),
      executeHook: async ({ instruction, workingDirectory, prompt }) => {
        captured = { instruction, workingDirectory, prompt };
        await fs.writeFile(
          path.join(workingDirectory, 'add.js'),
          'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
          'utf8',
        );
        return { exitCode: 0, summary: 'fixed add.js', claimedChangedFiles: ['add.js'] };
      },
    },
    talkChat: scriptedChat([
      async ({ tools, messages }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.match(sys, /cap_acquired_coding_runtime/);
        assert.equal(/专业 runtime：可获得|专业 runtime：已准备好/.test(sys), true);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'd1',
              name: 'delegate',
              arguments: JSON.stringify({
                capabilityId: 'cap_acquired_coding_runtime',
                instruction: '加法实现和测试对不上，请分析跨文件问题、修好并跑测试。',
              }),
            },
          ],
        };
      },
      async () => ({ text: '已经在授权仓库里修好加法，并核对了测试。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'C', targetDir: pkgDir });
  const goal = '加法实现和测试对不上，请分析跨文件问题、修好并跑测试。';
  await bus.invoke('talk', { text: goal, contextPaths: [repo] });
  assert.equal(captured.workingDirectory, path.resolve(repo));
  assert.match(String(captured.instruction || ''), /加法实现和测试对不上/);
  const prompt = String(captured.prompt || '');
  assert.match(prompt, /加法实现和测试对不上/);
  assert.match(prompt, new RegExp(repo.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')));
  assert.equal(/executor-task-package/.test(prompt), false);
  assert.equal(/外部代码执行器/.test(prompt), false);
  assert.equal(/验收条件/.test(prompt), false);
  assert.equal(/不要做的事|deriveDoNotDo|网站任务/.test(prompt), false);
  assert.match(prompt, /机械边界/);
  assert.match(prompt, /只能操作授权工作目录/);
  assert.match(prompt, /不得读取或泄露/);
  assert.match(prompt, /不得 git push/);
  assert.match(await fs.readFile(path.join(repo, 'add.js'), 'utf8'), /a \+ b/);
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ capabilityId: string; ok: boolean }>;
  };
  assert.equal(rec.executions.some((e) => e.capabilityId === 'cap_acquired_coding_runtime' && e.ok), true);
  await runtime.stop();
});

test('Talk 不再注入能力槽位作文；未获取 runtime 不得写成已连接', async () => {
  assert.equal(await compileCapabilityReality(), '');
  const blob = describeProfessionals([
    {
      id: 'cap_acquired_coding_runtime',
      label: '代码执行能力',
      description: '在授权目录修改文件',
      authNeeded: '需要本次已授权工作目录',
      runtimeStatus: 'acquirable',
      async run() {
        return { ok: false, summary: 'no', producedOutputs: [] };
      },
    },
  ]);
  assert.match(blob, /id: cap_acquired_coding_runtime/);
  assert.match(blob, /专业 runtime：可获得（尚未准备好）/);
  assert.equal(/已连接/.test(blob), false);
  assert.equal(/适合复杂代码改动/.test(blob), false);
});

test('Talk 把剩余 deadline 交给模型，不再另套 120 秒 HTTP 预算', async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '8000';
  const root = await tempDir('deadline');
  const pkgDir = path.join(root, 'pkg');
  let seen: number | undefined;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: async ({ timeoutMs }) => {
      seen = timeoutMs;
      return { text: '你好。' };
    },
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'deadline', targetDir: pkgDir });
    await bus.invoke('talk', { text: '你好' });
    assert.equal(typeof seen, 'number');
    assert.equal(Number(seen) > 1000 && Number(seen) <= 8000, true);
    assert.equal(seen === 120_000, false);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});
