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
import { createAcquiredCodingExecutorAdapter } from '../adapters/acquired-coding-executor';
import { createExternalExecutorCodexAdapter } from '../adapters/external-executor-codex';
import { recommendedCodingCapability } from '../coding-capability';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { agentsFromRegistry } from '../../intelligence/professionals';
import { CapabilityRegistry } from '../registry';
import { routeCodingAgent } from '../coding-agent-route';

describe('zero-start-coding-acquire-01', () => {
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
