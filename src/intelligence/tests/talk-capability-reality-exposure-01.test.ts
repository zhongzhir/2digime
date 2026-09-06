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

function assertSemanticOnly(text: string): void {
  assert.equal(/cap_/.test(text), false);
  assert.equal(/adapter\.type|adapterType/.test(text), false);
  assert.equal(/needs_setup|unavailable|checkAvailability/.test(text), false);
  assert.equal(/\.exe\b|stderr|codexJsPath/.test(text), false);
}

test('compiler：Codex 已装未授权目录时可见但语义化；授权后变为可使用', async () => {
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
  const folder = await tempDir('ws');
  const hidden = await compileCapabilityReality({ registry });
  assert.match(hidden, /代码执行：已安装，但本轮尚未授权工作目录/);
  assert.match(hidden, /桌面应用操作：当前没有已连接的可执行能力/);
  assert.match(hidden, /联网搜索：当前尚未连接或配置/);
  assert.match(hidden, /本地文件读取：本轮尚未通过/);
  assert.equal(/不能操作电脑|不允许|此类任务不支持/.test(hidden), false);
  assert.equal(/请安装/.test(hidden), false);
  assertSemanticOnly(hidden);

  const ready = await compileCapabilityReality({ registry, contextPaths: [folder] });
  assert.match(ready, /代码执行：已连接，可在授权工作目录中使用/);
  assert.match(ready, new RegExp(folder.replace(/\\/g, '\\\\')));
  assertSemanticOnly(ready);
});

test('compiler：needs_setup 只报尚未连接或配置；MCP 仅在已注册时出现', async () => {
  const registry = new CapabilityRegistry();
  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_external_executor_codex',
        kind: 'agent',
        displayName: '代码执行能力',
        availability: 'needs_setup',
        outputArtifactTypes: ['code-change'],
        permissions: ['filesystem_read', 'filesystem_write'],
        adapter: { type: 'external-executor-cli', adapterId: 'external-executor-codex-cli' },
      }),
    ),
  );
  const none = await compileCapabilityReality({ registry });
  assert.match(none, /代码执行：当前尚未连接或配置/);
  assert.equal(/资料查询/.test(none), false);
  assert.equal(/请安装/.test(none), false);
  assertSemanticOnly(none);

  registry.register(
    stubAdapter(
      baseReg({
        id: 'cap_mcp_readonly',
        kind: 'tool',
        displayName: '资料查询能力',
        availability: 'needs_setup',
        outputArtifactTypes: ['document'],
        permissions: ['filesystem_read'],
        adapter: { type: 'mcp-stdio', adapterId: 'mcp-stdio-readonly' },
      }),
    ),
  );
  const withMcp = await compileCapabilityReality({ registry });
  assert.match(withMcp, /资料查询：当前尚未连接或配置/);
  assertSemanticOnly(withMcp);
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
        assert.match(sys, /代码执行：已安装，但本轮尚未授权工作目录/);
        assert.equal(/cap_external_executor_codex/.test(sys), false);
        assert.equal(/不能操作电脑|我没有代码能力/.test(sys), false);
        sawDelegate = Boolean(tools?.some((t) => t.function.name === 'delegate'));
        assert.equal(sawDelegate, false);
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
        assert.match(sys, /代码执行：已连接，可在授权工作目录中使用/);
        assert.match(sys, /当前可立即调用的外部能力/);
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
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
        assert.match(sys, /桌面应用操作：当前没有已连接的可执行能力/);
        assert.equal(/不能操作电脑|桌面控制不允许|此类任务不支持/.test(sys), false);
        assert.equal(tools?.some((t) => t.function.name === 'read_file'), true);
        assert.equal(tools?.some((t) => t.function.name === 'export_file'), true);
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
        assert.match(sys, /联网搜索：当前尚未连接或配置/);
        assert.equal(/cap_gemini_web_search|cap_baseline_web_search/.test(sys), false);
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
