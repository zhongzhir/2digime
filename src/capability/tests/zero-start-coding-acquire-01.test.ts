/**
 * DIGITALME-ZERO-START-CODING-01 — acquire 语义与最小接线。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { acquireCapability, type AcquireCandidate } from '../acquire-capability';
import { mapChatModelToProviderEnv } from '../chat-model-credential-bridge';
import { defaultCodingRuntimeCandidates } from '../coding-runtime-candidates';
import { startLocalChatModelBridge } from '../chat-model-http-bridge';
import {
  createAcquiredCodingExecutorAdapter,
  writeAcquiredCodexProviderConfig,
  writeAcquiredCodingProviderConfig,
} from '../adapters/acquired-coding-executor';
import { createExternalExecutorCodexAdapter } from '../adapters/external-executor-codex';
import { recommendedCodingCapability } from '../coding-capability';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { agentsFromRegistry } from '../../intelligence/professionals';
import { CapabilityRegistry } from '../registry';
import { routeCodingAgent } from '../coding-agent-route';

describe('zero-start-coding-acquire-01', () => {
  it('首选候选是可自动获取且具备工作区沙箱的 Codex runtime', () => {
    const candidates = defaultCodingRuntimeCandidates();
    assert.equal(candidates[0]?.id, 'codex-windows-cli');
    assert.equal(candidates.length, 1, '同一次明确授权不得静默换成未展示的候选');
  });

  it('Codex 隔离配置只连接本次回环 Responses 桥并启用 workspace-write', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-codex-config-'));
    const configPath = writeAcquiredCodexProviderConfig(root, 'managed-ai', 'http://127.0.0.1:3210/v1');
    const config = await fs.readFile(configPath, 'utf8');
    assert.match(config, /model_provider = "2digime"/);
    assert.match(config, /wire_api = "responses"/);
    assert.match(config, /supports_websockets = false/);
    assert.match(config, /\[features\][\s\S]*plugins = false[\s\S]*apps = false/);
    assert.match(config, /sandbox_mode = "workspace-write"/);
    assert.equal(/network_proxy|network\.enabled/.test(config), false);
    assert.match(config, /sandbox = "unelevated"/);
    assert.equal(/sk-|api[_-]?key/i.test(config), false);
  });

  it('回环桥把 Responses 函数工具映射到现有聊天模型合同', async () => {
    let sawTool = false;
    const bridge = await startLocalChatModelBridge({
      model: 'managed-ai',
      complete: async (options) => {
        sawTool = options.tools?.[0]?.function.name === 'shell';
        assert.equal(options.messages.some((message) => message.content.includes('修改文件')), true);
        return {
          text: '',
          toolCalls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'shell', arguments: '{"command":"echo ok"}' },
          }],
        };
      },
    });
    try {
      const response = await fetch(`${bridge.baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'managed-ai',
          stream: true,
          instructions: '只在工作区内操作。',
          input: [{ role: 'user', content: [{ type: 'input_text', text: '修改文件' }] }],
          tools: [{ type: 'function', name: 'shell', description: 'run', parameters: { type: 'object' } }],
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(sawTool, true);
      assert.match(body, /response\.completed/);
      assert.match(body, /function_call/);
      assert.match(body, /call_1/);
    } finally {
      await bridge.close();
    }
  });

  it('回环桥把 Responses custom tool 双向映射为既有函数工具合同', async () => {
    let sawCustomTool = false;
    const bridge = await startLocalChatModelBridge({
      model: 'managed-ai',
      complete: async (options) => {
        const required = options.tools?.[0]?.function.parameters.required;
        sawCustomTool = options.tools?.[0]?.function.name === 'apply_patch'
          && Array.isArray(required)
          && required[0] === 'input';
        return {
          text: '',
          toolCalls: [{
            id: 'call_patch',
            type: 'function',
            function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch\\n*** End Patch"}' },
          }],
        };
      },
    });
    try {
      const response = await fetch(`${bridge.baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'managed-ai',
          stream: true,
          input: [{ role: 'user', content: [{ type: 'input_text', text: '修复文件' }] }],
          tools: [{ type: 'custom', name: 'apply_patch', description: 'apply a patch' }],
        }),
      });
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.equal(sawCustomTool, true);
      assert.match(body, /custom_tool_call/);
      assert.match(body, /\*\*\* Begin Patch/);
      assert.doesNotMatch(body, /\\\"input\\\"/);
    } finally {
      await bridge.close();
    }
  });

  it('回环桥把 Responses 并行调用合并为一个 assistant 工具消息', async () => {
    const bridge = await startLocalChatModelBridge({
      model: 'managed-ai',
      complete: async (options) => {
        const assistantMessages = options.messages.filter((message) => message.role === 'assistant');
        const toolMessages = options.messages.filter((message) => message.role === 'tool');
        assert.equal(assistantMessages.length, 1);
        assert.equal(assistantMessages[0]?.tool_calls?.length, 2);
        assert.deepEqual(toolMessages.map((message) => message.tool_call_id), ['call_a', 'call_b']);
        return { text: '继续完成。' };
      },
    });
    try {
      const response = await fetch(`${bridge.baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'managed-ai',
          input: [
            { type: 'function_call', call_id: 'call_a', name: 'exec_command', arguments: '{"cmd":"one"}' },
            { type: 'function_call', call_id: 'call_b', name: 'exec_command', arguments: '{"cmd":"two"}' },
            { type: 'function_call_output', call_id: 'call_a', output: 'first' },
            { type: 'function_call_output', call_id: 'call_b', output: 'second' },
          ],
        }),
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /继续完成/);
    } finally {
      await bridge.close();
    }
  });

  it('获取后的 runtime 配置拒绝授权项目外目录和内置联网工具', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-acquired-config-'));
    const configPath = writeAcquiredCodingProviderConfig(
      root,
      'managed-ai',
      false,
      'http://127.0.0.1:1234/v1',
    );
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      permissions?: unknown;
      policies?: unknown;
      permission?: Record<string, string>;
    };
    assert.equal(config.permissions, undefined);
    assert.equal(config.policies, undefined);
    assert.equal(config.permission?.external_directory, 'deny');
    assert.equal(config.permission?.webfetch, 'deny');
    assert.equal(config.permission?.websearch, 'deny');
    assert.equal(config.permission?.task, 'deny');
  });

  it('acquireCapability 按候选顺序获取，不理解用户任务', async () => {
    const seen: string[] = [];
    const failing: AcquireCandidate = {
      id: 'first',
      acquire: async () => {
        seen.push('first');
        return { status: 'failed', ok: false, failureKind: 'ACQUISITION FAILURE' };
      },
    };
    const ready: AcquireCandidate = {
      id: 'second',
      acquire: async (ctx) => {
        seen.push(`second:${path.basename(ctx.runtimeRoot)}`);
        return { status: 'ready', ok: true, runtimePath: '/tmp/runtime', version: '1.0' };
      },
    };
    const result = await acquireCapability([failing, ready], { runtimeRoot: '/tmp/runtimes' });
    assert.deepEqual(seen, ['first', 'second:runtimes']);
    assert.equal(result.status, 'ready');
    assert.equal(result.ok, true);
    assert.equal(result.candidateId, 'second');
  });

  it('默认候选是列表而不是单一硬编码架构', () => {
    const candidates = defaultCodingRuntimeCandidates();
    assert.ok(Array.isArray(candidates));
    assert.ok(candidates.length >= 1);
    assert.equal(typeof candidates[0]?.acquire, 'function');
  });

  it('凭证桥接复用聊天连接，不落盘密钥', async () => {
    const secrets = {
      async get(key: string) {
        if (key === providerCredentialKey('openai-compatible')) return 'secret-key-value';
        return null;
      },
    };
    const bridged = await mapChatModelToProviderEnv({
      secrets,
      connection: {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
      },
    });
    assert.ok(bridged);
    assert.equal(bridged.nativeDeepSeek, true);
    assert.equal(bridged.modelRef, 'deepseek/deepseek-v4-flash');
    assert.equal(bridged.env.DEEPSEEK_API_KEY, 'secret-key-value');
    assert.equal(bridged.baseUrl, 'https://api.deepseek.com/v1');
    assert.equal(bridged.host, 'api.deepseek.com');
  });

  it('无现成 provider 时获取后走既有执行合同；用户面不出现厂商词', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-zs-proj-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-zs-pkg-'));
    let sawPackage = false;
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
      acquiredCodingCapability: {
        runtimeRoot: path.join(pkg, 'runtimes'),
        executeHook: async ({ workingDirectory, prompt }) => {
          sawPackage = /executor-task-package/.test(prompt);
          assert.equal(workingDirectory, path.resolve(dir));
          assert.match(prompt, /帮我修改这个程序，补上减法/);
          assert.match(prompt, /Windows 环境不要调用 apply_patch、补丁管道、反引号或 here-string/);
          assert.match(prompt, /git diff 确认真实修改/);
          assert.equal(/外部代码执行器/.test(prompt), false);
          assert.equal(/验收条件/.test(prompt), false);
          return { exitCode: 0, summary: 'done' };
        },
      },
    });
    await runtime.createPackage({ displayName: 'zs', targetDir: pkg });
    const listed = await runtime.listCapabilities({ includeAvailability: true });
    assert.equal(listed.preferredCodingCapabilityId, 'cap_acquired_coding_runtime');
    assert.equal(/OpenCode|Codex|CLI|API_KEY|npm|PATH/i.test(JSON.stringify(listed.codingRecommendation)), false);
    assert.equal(/OpenCode|opencode/i.test(JSON.stringify(listed.codingCapabilities || [])), false);

    const adapter = createAcquiredCodingExecutorAdapter({
      runtimeRoot: path.join(pkg, 'runtimes'),
      executeHook: async ({ workingDirectory, prompt }) => {
        sawPackage = /executor-task-package/.test(prompt);
        assert.equal(workingDirectory, path.resolve(dir));
        return { exitCode: 0, summary: 'done' };
      },
    });
    const output = await adapter.execute(
      {
        goal: '帮我修改这个程序，补上减法',
        artifactType: 'code-change',
        snapshot: {
          id: 'snap',
          taskId: 'talk',
          createdAt: new Date().toISOString(),
          items: [{ sourcePath: dir, kind: 'folder-entry', status: 'ok' }],
        },
        subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
        executionAuthorization: {
          confirmed: true,
          workingDirectory: dir,
          readScope: ['.'],
          writeScope: ['.'],
        },
      },
      {
        jobId: 'job1',
        reportProgress: () => undefined,
        signal: new AbortController().signal,
        secrets: { get: async () => null },
        workDir: path.join(pkg, 'work'),
      },
    );
    assert.equal(sawPackage, false);
    assert.equal(output.artifact.type, 'code-change');
    assert.equal(/OpenCode|CLI|API_KEY/i.test(JSON.stringify(output.artifact)), false);
  });

  it('Talk 可在无预装 Coding Agent 时选择代码执行能力', () => {
    const registry = new CapabilityRegistry();
    registry.register(createExternalExecutorCodexAdapter({ forceAvailability: 'needs_setup' }));
    registry.register(
      createAcquiredCodingExecutorAdapter({
        runtimeRoot: os.tmpdir(),
        forceAvailability: 'available',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      }),
    );
    const folder = path.join(os.tmpdir(), 'dm-zs-auth');
    const agents = agentsFromRegistry(registry, {
      subjectId: 's1',
      authorizedWorkingDirectory: folder,
    });
    const coding = agents.find((a) => a.label === '代码执行能力' && a.id === 'cap_acquired_coding_runtime');
    assert.ok(coding);
    assert.equal(/OpenCode|opencode/i.test(JSON.stringify(coding)), false);
    const listed = registry.list().map((reg) => registry.get(reg.id)!);
    const routed = routeCodingAgent({ adapters: listed });
    assert.equal(routed.reason, 'primary');
    assert.equal(routed.capabilityId, 'cap_acquired_coding_runtime');
  });

  it('推荐文案不要求用户安装开发工具，也不把单一厂商写成产品', () => {
    const rec = recommendedCodingCapability();
    assert.match(rec.installProvider, /2digime 获取成熟代码执行能力/);
    assert.equal(rec.installGuideUrl, undefined);
    assert.equal(/OpenCode|Codex|npm/i.test(JSON.stringify(rec)), false);
  });
});
