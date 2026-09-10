/**
 * 能力现实暴露：模型看见已安装/缺授权/未连接，系统不替它规划或安装。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import { CapabilityRegistry } from '../../capability/registry';
import type { CapabilityInput, CapabilityOutput } from '../../capability/adapter';
import type { CapabilityRegistration } from '../../capability/registration';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { compileCapabilityReality } from '../capability-reality';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-reality-${prefix}-`));
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

function stubAdapter(
  reg: CapabilityRegistration,
  execute?: (input: CapabilityInput) => Promise<CapabilityOutput>,
) {
  return asLocalCapabilityAdapter({
    registration: reg,
    execute: async (input) => {
      if (execute) return execute(input);
      return {
        artifact: {
          type: reg.outputArtifactTypes[0] || 'document',
          title: 'ok',
          payload: { kind: 'text', format: 'plain', text: 'ok' },
        },
      };
    },
  });
}

function baseReg(
  patch: Partial<CapabilityRegistration> &
    Pick<CapabilityRegistration, 'id' | 'kind' | 'displayName' | 'adapter' | 'outputArtifactTypes' | 'permissions'>,
): CapabilityRegistration {
  return {
    description: 'desc',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    cost: { estimate: 'x' },
    latencyEstimate: 'x',
    location: 'local',
    availability: 'available',
    ...patch,
  };
}

function assertNoStrategyProse(text: string): void {
  assert.equal(/适合复杂代码改动/.test(text), false);
  assert.equal(/代码执行：已连接/.test(text), false);
  assert.equal(/代码执行：已安装，但本轮尚未授权/.test(text), false);
  assert.equal(/应该选哪个|应该先做|fallback/.test(text), false);
}

test('compiler：Talk 不再注入能力槽位作文', async () => {
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_external_executor_codex',
        kind: 'agent',
        displayName: '代码执行能力',
        outputArtifactTypes: ['code-change'],
        permissions: ['filesystem_read', 'filesystem_write', 'network'],
        adapter: { type: 'external-executor-cli', adapterId: 'external-executor-codex-cli' },
        codingExecution: {
          providerKind: 'local_coding_agent',
          invocationKind: 'cli',
          supportsAutomaticExecution: true,
          supportsProgress: true,
          supportsRevision: true,
          supportsResultCollection: true,
        },
      }),
    ),
  );
  const hidden = await compileCapabilityReality({ registry });
  assert.equal(hidden, '');
  assertNoStrategyProse(hidden);
});

test('compiler：不再输出尚未连接或配置的槽位作文', async () => {
  const none = await compileCapabilityReality({ registry: new CapabilityRegistry() });
  assert.equal(none, '');
  assert.equal(/资料查询/.test(none), false);
  assertNoStrategyProse(none);
});

test('A Codex 已装未授权：模型看见缺口；delegate 不可调用', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  let sawDelegate = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: { forceAvailability: 'ready', executeHook: async () => ({ exitCode: 0, summary: 'no' }) },
    talkChat: scriptedChat([
      async ({ messages, tools }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.equal(/“\+”附加项目文件夹作为本次工作目录/.test(sys), false);
        sawDelegate = Boolean(tools?.some((t) => t.function.name === 'delegate'));
        assert.equal(sawDelegate, false);
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), false);
        return { text: '把项目文件夹用 + 加进来，我就可以继续改并跑测试。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '现实', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '帮我修改这个项目并跑测试。' });
  const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
  assert.match(String(last?.text || ''), /\+|文件夹|授权/);
  await runtime.stop();
});

test('B 同一线程授权目录后 Codex 成为 callable，cwd 为授权 repo', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'README.md'), 'before\n', 'utf8');
  let cwd: string | undefined;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: {
      forceAvailability: 'ready',
      executeHook: async ({ pkg }) => {
        cwd = pkg.workingDirectory;
        await fs.writeFile(path.join(pkg.workingDirectory, 'note.txt'), 'ok\n', 'utf8');
        return {
          exitCode: 0,
          summary: '已写入 note.txt',
          claimedChangedFiles: ['note.txt'],
        };
      },
    },
    talkChat: scriptedChat([
      async ({ messages, tools }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.match(sys, /cap_external_executor_codex/);
        assert.match(sys, /当前可调用的外部能力/);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'd1',
              name: 'delegate',
              arguments: JSON.stringify({
                instruction: '改这个项目并跑测试',
                capabilityId: 'cap_external_executor_codex',
              }),
            },
          ],
        };
      },
      async () => ({ text: '已经在你授权的项目里改好了。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '现实', targetDir: pkgDir });
  await bus.invoke('talk', { text: '就改这个。', contextPaths: [repo] });
  assert.equal(cwd, repo);
  assert.equal(await fs.readFile(path.join(repo, 'note.txt'), 'utf8'), 'ok\n');
  const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ capabilityId?: string; ok?: boolean }>;
  };
  assert.equal(
    rec.executions.some((e) => e.capabilityId === 'cap_external_executor_codex' && e.ok),
    true,
  );
  await runtime.stop();
});

test('C 无桌面控制：只陈述当前没有已连接桌面能力；不判死任务', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  const pptx = path.join(root, 'deck.pptx');
  await fs.writeFile(pptx, 'not-a-real-pptx', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ messages, tools }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.equal(/桌面应用操作：当前没有已连接的可执行能力/.test(sys), false);
        assert.equal(tools?.some((t) => t.function.name === 'read_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'export_file'), false);
        return { text: '我现在不能直接点正在打开的窗口。你可以先用 + 把文件给我，我先改一版 pptx；若要操作窗口，需要先连接桌面操作能力。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '现实', targetDir: pkgDir });
  await bus.invoke('talk', {
    text: '帮我操作正在打开的 PowerPoint 调一下这几页。',
    contextPaths: [pptx],
  });
  await runtime.stop();
});

test('D Gemini 未配置：只陈述尚未连接；不规定固定回复', async () => {
  const root = await tempDir('d');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ messages, tools }) => {
        const sys = String(messages[0]?.content || '');
        assertNoStrategyProse(sys);
        assert.equal(/联网搜索：当前尚未连接或配置/.test(sys), false);
        assert.equal(/设置 → 联网搜索/.test(sys), false);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), false);
        return { text: '我这边还没连接实时检索。按已有公开知识，大致是这样；要核验今天的消息需要先在设置里接上联网能力。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '现实', targetDir: pkgDir });
  await bus.invoke('talk', { text: '今天有什么重要新闻？' });
  await runtime.stop();
});
