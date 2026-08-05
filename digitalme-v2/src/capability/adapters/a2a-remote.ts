/**
 * A2ARemoteCapabilityAdapter — 正式、可替换的远端 CapabilityAdapter。
 * A2A Task 仅作外部映射;本地 Job 仍是用户面唯一权威。
 */
import { createHash } from 'node:crypto';
import type {
  AdapterDescribeResult,
  AvailabilityCheckResult,
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
  RemoteCancelResult,
  RemoteExecutionRef,
  RemoteLifecycleStatus,
  RemoteRecoverResult,
  RemoteStatusView,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import {
  applyAuthorizationProjectionToInput,
  assertProjectionUsable,
  type RemoteAuthorizationProjection,
} from '../remote-authorization';
import { RemoteSecurityGate } from '../remote-security';
import {
  assertEndpointPolicyShape,
  buildResearchEndpointPolicy,
  fingerprintEndpointPolicy,
  type RemoteEndpointPolicy,
} from '../remote-endpoint-policy';
import {
  A2A_ADAPTER_PROTOCOL,
  A2A_ADAPTER_PROTOCOL_VERSION,
  buildCancelTaskRequest,
  buildGetTaskRequest,
  buildSendMessageRequest,
  buildUserMessage,
  createA2AClientForPolicy,
  extractTaskTextArtifact,
  fetchAndValidateAgentCard,
  isTaskResult,
  mapA2AStateToLocal,
  type A2AAuthorizedPayload,
} from '../a2a-wire';
import { nowIso } from '../../shared/ids';
import type { Client } from '@a2a-js/sdk/client';
import type { Task } from '@a2a-js/sdk';

export const A2A_REMOTE_CAPABILITY_ID = 'cap_a2a_research_analysis';
export const A2A_REMOTE_ADAPTER_ID = 'a2a-remote-capability';
export const A2A_REMOTE_ADAPTER_VERSION = 'a2a-remote/1';

export interface A2ARemoteAdapterOptions {
  endpoint: RemoteEndpointPolicy;
  displayName?: string;
  pollIntervalMs?: number;
  /** 测试故障注入:写入 A2A message metadata.fault */
  defaultFault?: string;
}

export function buildA2ARemoteRegistration(
  options: Pick<A2ARemoteAdapterOptions, 'displayName' | 'endpoint'> ,
): CapabilityRegistration {
  return {
    id: A2A_REMOTE_CAPABILITY_ID,
    kind: 'service',
    displayName: options.displayName ?? options.endpoint.displayName ?? '研究分析能力',
    description: '已连接的专业能力：研究分析',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: false,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: '受控预算内' },
    latencyEstimate: '数秒到两分钟',
    location: 'remote',
    availability: 'available',
    adapter: {
      type: 'remote-subject',
      adapterId: A2A_REMOTE_ADAPTER_ID,
    },
  };
}

export function createA2ARemoteCapabilityAdapter(
  options: A2ARemoteAdapterOptions,
): CapabilityAdapter {
  const endpoint = options.endpoint;
  assertEndpointPolicyShape(endpoint);
  const registration = buildA2ARemoteRegistration(options);
  const gate = new RemoteSecurityGate({
    allowedEndpoints: [endpoint.baseUrl, endpoint.expectedAgentCardUrl],
    maxCallsPerTask: endpoint.maxCallsPerTask,
    timeoutMs: endpoint.maxTaskDuration,
    maxConcurrent: 2,
    maxRetries: 1,
    maxInputBytes: endpoint.maxInputBytes,
    maxOutputBytes: endpoint.maxOutputBytes,
    killSwitch: !endpoint.enabled,
    tokenBudget: { maxTokens: endpoint.modelPolicy.maxTokens ?? 1400, maxCostUnits: 0 },
  });
  const pollIntervalMs = options.pollIntervalMs ?? 120;
  const localCancelled = new Set<string>();
  const outputs = new Map<string, CapabilityOutput>();
  const clients = new Map<string, Client>();
  const endpointFp = fingerprintEndpointPolicy(endpoint);
  let lastCardIdentity = '';

  if (
    endpoint.credentialSecretKey &&
    /model\.provider\..*\.apiKey|openai-compatible\.apiKey/i.test(endpoint.credentialSecretKey)
  ) {
    throw Object.assign(new Error('endpoint credential must not reuse primary model secret key'), {
      stage: 'capability' as const,
      actionable: '外部专业能力尚未连接。',
      code: 'credential_reuse_forbidden',
    });
  }

  async function getClient(): Promise<Client> {
    // 每次使用前重新校验 Agent Card，避免静默继承旧信任
    const { client, validation } = await createA2AClientForPolicy(endpoint);
    const identity = `${validation.endpointFingerprint}:${validation.matchedSkillIds.join(',')}:${validation.protocolVersion || ''}`;
    if (lastCardIdentity && lastCardIdentity !== identity) {
      clients.delete(endpoint.endpointId);
    }
    lastCardIdentity = identity;
    clients.set(endpoint.endpointId, client);
    return client;
  }

  function invalidateClient(): void {
    clients.delete(endpoint.endpointId);
  }

  return {
    registration,
    describe(): AdapterDescribeResult {
      return {
        adapterId: A2A_REMOTE_ADAPTER_ID,
        adapterType: 'remote-subject',
        capabilityId: A2A_REMOTE_CAPABILITY_ID,
        displayName: registration.displayName,
        location: 'remote',
        outputArtifactTypes: [...registration.outputArtifactTypes],
        supportsAsyncRemote: true,
        version: A2A_REMOTE_ADAPTER_VERSION,
      };
    },
    async checkAvailability(ctx): Promise<AvailabilityCheckResult> {
      if (!endpoint.enabled || gate.current.killSwitch) {
        return { available: false, reason: 'disabled', detail: '外部能力未启用' };
      }
      try {
        await fetchAndValidateAgentCard(endpoint);
        return { available: true, detail: `endpoint=${endpoint.endpointId}` };
      } catch (error) {
        return {
          available: false,
          reason: 'agent_card',
          detail: (error as Error).message,
        };
      } finally {
        void ctx;
      }
    },
    async prepareAuthorizedInput(
      input: CapabilityInput,
      auth: RemoteAuthorizationProjection,
      _ctx: ExecutionContext,
    ): Promise<CapabilityInput> {
      assertProjectionUsable(auth, nowIso());
      if (auth.allowRemotePersist) {
        throw Object.assign(new Error('remote persist is not allowed'), {
          stage: 'capability' as const,
          actionable: '所选材料无法按当前授权发送，请重新选择。',
        });
      }
      if (auth.allowRedelegate) {
        throw Object.assign(new Error('redelegate is not allowed'), {
          stage: 'capability' as const,
          actionable: '所选材料无法按当前授权发送，请重新选择。',
        });
      }
      return applyAuthorizationProjectionToInput(input, auth);
    },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      const taskId = input.snapshot.taskId || ctx.jobId;
      gate.assertEndpointAllowed(endpoint.baseUrl);
      gate.beginCall(taskId);
      try {
        ctx.reportProgress('正在校验已连接的外部能力');
        const client = await getClient();
        if (ctx.signal.aborted || localCancelled.has(ctx.jobId)) throw abortError();

        const payload = await buildPayload(input, ctx, options.defaultFault);
        const bodyBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        gate.assertInputSize(bodyBytes);
        gate.assertTokenBudget({ tokens: Math.ceil(payload.goal.length / 4) });

        ctx.reportProgress('正在提交外部专业任务');
        const message = buildUserMessage(payload);
        let started;
        try {
          started = await client.sendMessage(buildSendMessageRequest(message), {
            signal: ctx.signal,
          });
        } catch (error) {
          invalidateClient();
          throw error;
        }

        if (!isTaskResult(started)) {
          throw Object.assign(new Error('external capability did not return a task handle'), {
            stage: 'capability' as const,
            actionable: '外部能力未返回可跟踪任务',
          });
        }

        const executionId = started.id;
        const ref: RemoteExecutionRef = {
          executionId,
          adapterId: A2A_REMOTE_ADAPTER_ID,
          endpoint: endpoint.baseUrl,
        };
        ctx.bindRemoteExecution?.({ ...ref, lastRemoteStatus: mapA2AStateToLocal(started.status?.state) });
        ctx.reportProgress('正在处理');

        const terminal = await pollUntilTerminal(client, ref, ctx);
        if (terminal.status === 'cancelled' || localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
          throw abortError();
        }
        if (terminal.status === 'failed') {
          const isTimeout = /timed out|超时/i.test(terminal.message || '');
          throw Object.assign(new Error(terminal.message || 'external capability failed'), {
            stage: 'capability' as const,
            actionable: isTimeout
              ? '对方未在限定时间内完成，本次任务已停止。'
              : '研究分析能力目前无法使用，请稍后重试或改用本地能力。',
          });
        }
        if (!terminal.task) {
          throw Object.assign(new Error('external capability completed without task payload'), {
            stage: 'capability' as const,
            actionable: '研究分析能力目前无法使用，请稍后重试或改用本地能力。',
          });
        }

        ctx.reportProgress('正在检查成果');
        const output = await collectFromTask(terminal.task, ref, payload);
        outputs.set(executionId, output);
        ctx.updateRemoteExecution?.({ lastRemoteStatus: 'completed' });
        return output;
      } finally {
        gate.endCall();
      }
    },
    async getStatus(ref, ctx): Promise<RemoteStatusView> {
      if (localCancelled.has(ctx.jobId)) {
        return { status: 'cancelled', remoteAck: true };
      }
      try {
        const client = await getClient();
        const task = await client.getTask(buildGetTaskRequest(ref.executionId), {
          signal: ctx.signal,
        });
        const status = mapA2AStateToLocal(task.status?.state);
        ctx.updateRemoteExecution?.({ lastRemoteStatus: status });
        const message = statusMessage(task);
        return message ? { status, message } : { status };
      } catch (error) {
        return {
          status: 'failed',
          message: (error as Error).message,
          remoteAck: false,
        };
      }
    },
    async cancel(ref, ctx): Promise<RemoteCancelResult> {
      localCancelled.add(ctx.jobId);
      ctx.updateRemoteExecution?.({ lastRemoteStatus: 'cancelled' });
      let remoteAck = false;
      let message: string | undefined;
      try {
        const client = await getClient();
        const cancelSignal =
          typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
            ? AbortSignal.timeout(2_000)
            : undefined;
        await client.cancelTask(buildCancelTaskRequest(ref.executionId), {
          ...(cancelSignal ? { signal: cancelSignal } : {}),
        });
        remoteAck = true;
      } catch (error) {
        message = (error as Error).message;
        remoteAck = false;
      }
      return { cancelled: true, remoteAck, ...(message ? { message } : {}) };
    },
    async recover(ref, ctx): Promise<RemoteRecoverResult> {
      if (localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
        return { status: 'cancelled', message: 'local cancel already requested' };
      }
      try {
        const client = await getClient();
        const task = await client.getTask(buildGetTaskRequest(ref.executionId), {
          signal: ctx.signal,
        });
        const status = mapA2AStateToLocal(task.status?.state);
        ctx.updateRemoteExecution?.({ lastRemoteStatus: status, executionId: ref.executionId });
        if (status === 'completed') {
          const cached = outputs.get(ref.executionId);
          if (cached) return { status, output: cached };
          const output = await collectFromTask(task, ref);
          outputs.set(ref.executionId, output);
          return { status, output };
        }
        if (status === 'failed' || status === 'cancelled') {
          const message = statusMessage(task);
          return message ? { status, message } : { status };
        }
        const terminal = await pollUntilTerminal(client, ref, ctx);
        if (terminal.status === 'completed' && terminal.task) {
          const output = await collectFromTask(terminal.task, ref);
          outputs.set(ref.executionId, output);
          return { status: 'completed', output };
        }
        return terminal.message
          ? { status: terminal.status, message: terminal.message }
          : { status: terminal.status };
      } catch (error) {
        invalidateClient();
        return { status: 'failed', message: (error as Error).message };
      }
    },
    async collectArtifact(ref, ctx): Promise<CapabilityOutput> {
      if (localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
        throw abortError();
      }
      const cached = outputs.get(ref.executionId);
      if (cached) return cached;
      const client = await getClient();
      const task = await client.getTask(buildGetTaskRequest(ref.executionId), {
        signal: ctx.signal,
      });
      if (localCancelled.has(ctx.jobId) || ctx.signal.aborted) {
        throw abortError();
      }
      const output = await collectFromTask(task, ref);
      outputs.set(ref.executionId, output);
      return output;
    },
  };

  async function pollUntilTerminal(
    client: Client,
    ref: RemoteExecutionRef,
    ctx: ExecutionContext,
  ): Promise<{ status: RemoteLifecycleStatus; task?: Task; message?: string }> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < endpoint.maxTaskDuration) {
      if (ctx.signal.aborted || localCancelled.has(ctx.jobId)) {
        return { status: 'cancelled' };
      }
      let task: Task;
      try {
        task = await client.getTask(buildGetTaskRequest(ref.executionId), {
          signal: ctx.signal,
        });
      } catch {
        await sleep(pollIntervalMs);
        continue;
      }
      const status = mapA2AStateToLocal(task.status?.state);
      ctx.updateRemoteExecution?.({ lastRemoteStatus: status });
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        const message = statusMessage(task);
        return message ? { status, task, message } : { status, task };
      }
      ctx.reportProgress('正在处理');
      await sleep(pollIntervalMs);
    }
    return { status: 'failed', message: 'external capability timed out' };
  }

  async function collectFromTask(
    task: Task,
    ref: RemoteExecutionRef,
    payload?: A2AAuthorizedPayload,
  ): Promise<CapabilityOutput> {
    const extracted = extractTaskTextArtifact(task);
    if (!extracted.text.trim()) {
      throw Object.assign(new Error('external artifact missing or empty'), {
        stage: 'capability' as const,
        actionable: '已收到结果，但未通过完整性检查，未加入你的成果。',
        code: 'malformed_artifact',
      });
    }
    gate.assertOutputSize(Buffer.byteLength(extracted.text, 'utf8'));
    const digest = createHash('sha256').update(extracted.text, 'utf8').digest('hex');
    const sourceBinding = ref.executionId;
    const reached = extracted.reachedModel === true;
    if (extracted.contentIntegrity?.insufficientLength) {
      throw Object.assign(new Error('model content insufficient after revision'), {
        stage: 'capability' as const,
        actionable: '已收到结果，但未通过完整性检查，未加入你的成果。',
        code: 'length_insufficient',
      });
    }
    return {
      artifact: {
        type: 'document',
        title: extracted.name || '项目风险摘要',
        payload: { kind: 'text', format: 'markdown', text: extracted.text },
      },
      candidateMeta: {
        provenance: [
          A2A_ADAPTER_PROTOCOL,
          A2A_ADAPTER_PROTOCOL_VERSION,
          endpoint.endpointId,
          endpointFp,
          reached ? 'reachedModel=true' : 'reachedModel=false',
          payload?.grantId ? `grant=${payload.grantId}` : '',
        ]
          .filter(Boolean)
          .join(':'),
        sourceBinding,
        contentDigest: digest,
        producedAt: nowIso(),
        ...(extracted.contentIntegrity
          ? { contentIntegrity: extracted.contentIntegrity }
          : {}),
      },
      ...(reached ? { costActual: { tokens: Math.ceil(extracted.text.length / 4) } } : {}),
    };
  }
}

export function createResearchA2AAdapterFromBaseUrl(
  baseUrl: string,
  overrides: Partial<A2ARemoteAdapterOptions> = {},
): CapabilityAdapter {
  const endpoint = buildResearchEndpointPolicy({ baseUrl });
  return createA2ARemoteCapabilityAdapter({
    endpoint,
    ...overrides,
  });
}

async function buildPayload(
  input: CapabilityInput,
  ctx: ExecutionContext,
  defaultFault?: string,
): Promise<A2AAuthorizedPayload> {
  const materials: A2AAuthorizedPayload['materials'] = [];
  for (const item of input.snapshot.items) {
    if (item.status !== 'ok' || !item.extractedTextRef) continue;
    const text = ctx.readExtractedText ? await ctx.readExtractedText(item.extractedTextRef) : '';
    materials.push({
      path: item.sourcePath,
      ...(item.contentDigest ? { digest: item.contentDigest } : {}),
      excerpt: text.slice(0, 800),
    });
  }
  const fault =
    defaultFault ||
    (typeof (input as { fault?: string }).fault === 'string'
      ? (input as { fault?: string }).fault
      : undefined);
  return {
    goal: input.goal,
    purpose: input.authorized?.purpose || input.goal,
    materials,
    ...(input.authorized?.grantId ? { grantId: input.authorized.grantId } : {}),
    jobId: ctx.jobId,
    ...(fault ? { fault } : {}),
  };
}

function statusMessage(task: Task): string | undefined {
  const parts = task.status?.message?.parts;
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    const c = part.content;
    if (c && typeof c === 'object' && '$case' in c && c.$case === 'text') {
      return String(c.value || '');
    }
  }
  return undefined;
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), {
    stage: 'capability' as const,
    actionable: '已停止本次外部处理。',
    code: 'cancelled',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
