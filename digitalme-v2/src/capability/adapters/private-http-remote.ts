/**
 * PrivateHttpRemoteCapabilityAdapter — 仅工程对照,不进入产品 UI。
 * 调用同一参考 Agent 的 /private/v1/analyze,用于度量 A2A 相对私有 API 的接入成本。
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
  RemoteRecoverResult,
  RemoteStatusView,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import {
  applyAuthorizationProjectionToInput,
  assertProjectionUsable,
  type RemoteAuthorizationProjection,
} from '../remote-authorization';
import { nowIso } from '../../shared/ids';

export const PRIVATE_HTTP_REMOTE_CAPABILITY_ID = 'cap_private_http_research_analysis';
export const PRIVATE_HTTP_REMOTE_ADAPTER_ID = 'private-http-remote-capability';
export const PRIVATE_HTTP_REMOTE_ADAPTER_VERSION = 'private-http-remote/1';

export interface PrivateHttpRemoteOptions {
  endpoint: string;
  displayName?: string;
  timeoutMs?: number;
}

export function createPrivateHttpRemoteCapabilityAdapter(
  options: PrivateHttpRemoteOptions,
): CapabilityAdapter {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const registration: CapabilityRegistration = {
    id: PRIVATE_HTTP_REMOTE_CAPABILITY_ID,
    kind: 'service',
    displayName: options.displayName ?? '研究分析(私有对照)',
    description: '工程对照用私有 HTTP 路径,不进入产品导航',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: false,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: '对照' },
    latencyEstimate: '数秒',
    location: 'remote',
    availability: 'available',
    adapter: {
      type: 'remote-subject',
      adapterId: PRIVATE_HTTP_REMOTE_ADAPTER_ID,
    },
  };
  const outputs = new Map<string, CapabilityOutput>();
  const cancelled = new Set<string>();

  return {
    registration,
    describe(): AdapterDescribeResult {
      return {
        adapterId: PRIVATE_HTTP_REMOTE_ADAPTER_ID,
        adapterType: 'remote-subject',
        capabilityId: PRIVATE_HTTP_REMOTE_CAPABILITY_ID,
        displayName: registration.displayName,
        location: 'remote',
        outputArtifactTypes: ['document'],
        supportsAsyncRemote: false,
        version: PRIVATE_HTTP_REMOTE_ADAPTER_VERSION,
      };
    },
    async checkAvailability(): Promise<AvailabilityCheckResult> {
      try {
        const res = await fetch(`${endpoint}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(3_000),
        });
        return { available: res.ok };
      } catch (error) {
        return { available: false, detail: (error as Error).message };
      }
    },
    async prepareAuthorizedInput(input, auth): Promise<CapabilityInput> {
      assertProjectionUsable(auth, nowIso());
      return applyAuthorizationProjectionToInput(input, auth);
    },
    async execute(input, ctx): Promise<CapabilityOutput> {
      if (ctx.signal.aborted || cancelled.has(ctx.jobId)) {
        throw Object.assign(new Error('aborted'), { code: 'cancelled' });
      }
      const materials = [];
      for (const item of input.snapshot.items) {
        if (item.status !== 'ok' || !item.extractedTextRef) continue;
        const text = ctx.readExtractedText ? await ctx.readExtractedText(item.extractedTextRef) : '';
        materials.push({
          path: item.sourcePath,
          digest: item.contentDigest,
          excerpt: text.slice(0, 800),
        });
      }
      const executionId = `priv_${ctx.jobId}`;
      ctx.bindRemoteExecution?.({
        executionId,
        adapterId: PRIVATE_HTTP_REMOTE_ADAPTER_ID,
        endpoint,
        lastRemoteStatus: 'running',
      });
      const res = await fetch(`${endpoint}/private/v1/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: input.goal,
          materials,
        }),
        signal: AbortSignal.any
          ? AbortSignal.any([ctx.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)])
          : ctx.signal,
      });
      if (!res.ok) {
        throw new Error(`private http failed: ${res.status}`);
      }
      const json = (await res.json()) as {
        text?: string;
        title?: string;
        reachedModel?: boolean;
      };
      const text = String(json.text || '');
      if (!text) throw new Error('private http empty artifact');
      const digest = createHash('sha256').update(text, 'utf8').digest('hex');
      const output: CapabilityOutput = {
        artifact: {
          type: 'document',
          title: json.title || '项目风险摘要',
          payload: { kind: 'text', format: 'markdown', text },
        },
        candidateMeta: {
          provenance: `private-http:1:${endpoint}${json.reachedModel ? ':reachedModel=true' : ''}`,
          sourceBinding: executionId,
          contentDigest: digest,
          producedAt: nowIso(),
        },
      };
      outputs.set(executionId, output);
      ctx.updateRemoteExecution?.({ lastRemoteStatus: 'completed' });
      return output;
    },
    async getStatus(ref): Promise<RemoteStatusView> {
      if (outputs.has(ref.executionId)) return { status: 'completed' };
      return { status: 'running' };
    },
    async cancel(_ref, ctx): Promise<RemoteCancelResult> {
      cancelled.add(ctx.jobId);
      return { cancelled: true, remoteAck: false, message: 'private path has no async cancel' };
    },
    async recover(ref): Promise<RemoteRecoverResult> {
      const output = outputs.get(ref.executionId);
      if (output) return { status: 'completed', output };
      return { status: 'failed', message: 'private path does not persist remote tasks' };
    },
    async collectArtifact(ref): Promise<CapabilityOutput> {
      const output = outputs.get(ref.executionId);
      if (!output) throw new Error('private artifact not found');
      return output;
    },
  };
}
