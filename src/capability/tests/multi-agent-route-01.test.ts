/**
 * MULTI-AGENT-ROUTE-01 / TRIAL-SURFACE-01B 单测。
 * 覆盖：专用执行器 ready→按评分选最高（不按厂商名）、无专用且有模型→model_api 兜底、
 *       都不可用→none、unsupported 桌面工具不得选为执行器、显式指定→explicit、
 *       isCodingJob 对专用与模型兜底为 true、默认 runtime 不注册备用（无空壳）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeCodingAgent,
  isCodingAgentAdapter,
  EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_SECONDARY_ADAPTER_ID,
  EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID,
} from '../coding-agent-route';
import { createExternalExecutorSecondaryAdapter } from '../adapters/external-executor-secondary';
import { createExternalExecutorModelApiAdapter } from '../adapters/external-executor-model-api';
import { createUnsupportedDesktopCodingAdapter } from '../adapters/unsupported-desktop-coding';
import { CapabilityRegistry } from '../registry';
import { EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID } from '../../execution/external-executor-contract';
import { isCodingJob } from '../../work-runtime/job-runner';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import type { CapabilityAdapter, CapabilityInput, CapabilityOutput, ExecutionContext } from '../adapter';

function codexAdapter(available: boolean): CapabilityAdapter {
  return {
    registration: {
      id: EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
      kind: 'agent',
      displayName: '代码执行能力',
      description: 'd',
      inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
      outputArtifactTypes: ['code-change'],
      permissions: ['filesystem_read', 'filesystem_write'],
      cost: { estimate: 'x' },
      latencyEstimate: 'x',
      location: 'local',
      availability: available ? 'available' : 'needs_setup',
      adapter: { type: 'external-executor-cli', adapterId: 'external-executor-codex-cli' },
      codingExecution: {
        providerKind: 'local_coding_agent',
        invocationKind: 'cli',
        supportsAutomaticExecution: true,
        supportsProgress: true,
        supportsRevision: true,
        supportsResultCollection: true,
      },
    },
    describe: () => ({
      adapterId: 'external-executor-codex-cli',
      adapterType: 'external-executor-cli',
      capabilityId: EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
      displayName: '代码执行能力',
      location: 'local',
      outputArtifactTypes: ['code-change'],
      supportsAsyncRemote: false,
      version: 'v1',
    }),
    checkAvailability: async () => ({ available }),
    prepareAuthorizedInput: async (i) => i,
    execute: async (i: CapabilityInput, c: ExecutionContext): Promise<CapabilityOutput> => ({
      artifact: { type: 'code-change', title: 't', payload: { kind: 'text', format: 'markdown', text: 'x' } },
    }),
    getStatus: async () => ({ status: 'completed' }),
    cancel: async () => ({ cancelled: true, remoteAck: true }),
    recover: async () => ({ status: 'failed', message: 'no remote' }),
    collectArtifact: async () => {
      throw new Error('no artifact');
    },
  };
}

function secondary(available: boolean): CapabilityAdapter {
  return createExternalExecutorSecondaryAdapter({
    forceAvailability: available ? 'available' : 'needs_setup',
    executeHook: async () => ({ exitCode: 0, summary: 'ok', claimedChangedFiles: [] }),
  });
}

describe('multi-agent-route-01', () => {
  it('primary available => selects primary, not secondary', () => {
    const r = routeCodingAgent({ adapters: [codexAdapter(true), secondary(true)] });
    assert.equal(r.reason, 'primary');
    assert.equal(r.capabilityId, EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID);
    assert.equal(r.adapter?.registration.id, EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID);
  });

  it('primary unavailable, secondary available => dedicated (scored) selects secondary as primary', () => {
    const r = routeCodingAgent({ adapters: [codexAdapter(false), secondary(true)] });
    assert.equal(r.reason, 'primary');
    assert.equal(r.capabilityId, EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID);
    assert.equal(r.adapter?.registration.id, EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID);
  });

  it('both unavailable => none with neutral actionable, no vendor name', () => {
    const r = routeCodingAgent({ adapters: [codexAdapter(false), secondary(false)] });
    assert.equal(r.reason, 'none');
    assert.equal(r.adapter, undefined);
    assert.ok(r.actionable);
    for (const bad of ['Claude', 'Cursor', 'Codex', 'MCP', 'CLI', 'tool_calls']) {
      assert.equal(new RegExp(bad, 'i').test(String(r.actionable)), false, `actionable must not contain ${bad}`);
    }
    assert.match(String(r.actionable), /不会改用普通写作冒充代码修改/);
  });

  it('unsupported desktop tool present => not selected as executor', () => {
    const unsupported = createUnsupportedDesktopCodingAdapter({ detected: true });
    const r = routeCodingAgent({ adapters: [codexAdapter(false), secondary(false), unsupported] });
    assert.equal(r.reason, 'none');
    assert.equal(r.adapter, undefined);
    assert.equal(isCodingAgentAdapter(unsupported), false);
  });

  it('explicit secondary => explicit', () => {
    const r = routeCodingAgent({
      adapters: [codexAdapter(true), secondary(true)],
      explicitCapabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
    });
    assert.equal(r.reason, 'explicit');
    assert.equal(r.capabilityId, EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID);
  });

  it('explicit unavailable => none', () => {
    const r = routeCodingAgent({
      adapters: [codexAdapter(true), secondary(false)],
      explicitCapabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
    });
    assert.equal(r.reason, 'none');
  });

  it('isCodingJob recognizes primary and secondary, not unsupported/mcp/writer', () => {
    assert.equal(isCodingJob({ capabilityId: EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID }), true);
    assert.equal(isCodingJob({ capabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID }), true);
    assert.equal(
      isCodingJob({
        externalExecution: {
          executorId: EXTERNAL_EXECUTOR_SECONDARY_ADAPTER_ID,
          workingDirectory: '',
          readScope: [],
          writeScope: [],
        },
      }),
      true,
    );
    assert.equal(isCodingJob({ capabilityId: 'cap_mcp_readonly' }), false);
    assert.equal(isCodingJob({ capabilityId: 'cap_desktop_coding_unsupported' }), false);
  });

  it('HTTP secondary is a usable coding executor; explicit does not fall back to primary', () => {
    const httpSecondary = createExternalExecutorSecondaryAdapter({
      forceAvailability: 'available',
      http: {
        baseUrl: 'http://127.0.0.1:9',
        password: 'test-only',
        internalModel: 'opencode-go/kimi-k2.7-code',
      },
    });
    assert.equal(httpSecondary.registration.adapter.type, 'external-executor-http');
    assert.equal(httpSecondary.registration.adapter.adapterId, EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID);
    assert.equal(httpSecondary.registration.codingExecution?.invocationKind, 'api');
    assert.equal(isCodingAgentAdapter(httpSecondary), true);
    const explicit = routeCodingAgent({
      adapters: [codexAdapter(true), httpSecondary],
      explicitCapabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
    });
    assert.equal(explicit.reason, 'explicit');
    assert.equal(explicit.capabilityId, EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID);
    assert.equal(
      isCodingJob({
        externalExecution: {
          executorId: EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID,
          workingDirectory: '',
          readScope: [],
          writeScope: [],
        },
      }),
      true,
    );
    const failedExplicit = routeCodingAgent({
      adapters: [codexAdapter(true), createExternalExecutorSecondaryAdapter({ forceAvailability: 'unavailable' })],
      explicitCapabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
    });
    assert.equal(failedExplicit.reason, 'none');
    assert.notEqual(failedExplicit.capabilityId, EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID);
  });

  it('model-api transport is only chosen when no dedicated executor is ready', () => {
    const modelApi = createExternalExecutorModelApiAdapter({
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test-model',
      chatCompleteHook: async () => ({ text: '{}' }),
    });
    // 无专用执行器 → 模型兜底
    const onlyModel = routeCodingAgent({ adapters: [modelApi] });
    assert.equal(onlyModel.reason, 'model_api');
    assert.equal(onlyModel.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
    // 专用执行器 ready → 不选模型兜底（§2.4）
    const withDedicated = routeCodingAgent({ adapters: [codexAdapter(true), modelApi] });
    assert.equal(withDedicated.reason, 'primary');
    assert.equal(withDedicated.capabilityId, EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID);
    assert.equal(isCodingAgentAdapter(modelApi), true);
    assert.equal(isCodingJob({ capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID }), true);
  });

  it('registry selectForNeed routes modify_code via route (dedicated primary)', () => {
    const registry = new CapabilityRegistry();
    registry.register(codexAdapter(false));
    registry.register(secondary(true));
    const result = registry.selectForNeed({
      intentKind: 'modify_code',
      expectedOutputFamily: 'code-change',
      materialKinds: ['code_repo'],
    });
    assert.equal(result.reason, 'primary');
    assert.equal(result.adapter?.registration.id, EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID);
    assert.ok(result.codingAgentRoute);
    assert.equal(result.codingAgentRoute?.reason, 'primary');
  });

  it('default runtime does not register secondary (no empty shell)', async () => {
    const rt = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
    const listed = await rt.listCapabilities({});
    assert.ok(
      !listed.capabilities.some((c) => c.id === EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID),
      'secondary must not be auto-registered',
    );
    // explicit options registers it
    const rt2 = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      secondaryExecutorCapability: {
        forceAvailability: 'available',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    const listed2 = await rt2.listCapabilities({});
    assert.ok(
      listed2.capabilities.some((c) => c.id === EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID),
      'explicit options must register secondary',
    );
  });
});