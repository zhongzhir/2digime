import type {
  AdapterDescribeResult,
  AvailabilityCheckResult,
  AvailabilityProbeContext,
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
  LocalCapabilityAdapterCore,
  RemoteCancelResult,
  RemoteExecutionRef,
  RemoteRecoverResult,
  RemoteStatusView,
} from './adapter';
import type { RemoteAuthorizationProjection } from './remote-authorization';
import { applyAuthorizationProjectionToInput } from './remote-authorization';

export const LOCAL_ADAPTER_CONTRACT_VERSION = 'capability-adapter/1';

/**
 * 为本地同步 Adapter 补齐统一生命周期默认实现。
 * - execute 即完成
 * - getStatus / cancel / recover / collectArtifact 跟随本地语义与 AbortSignal
 * - 不改变原有 execute 行为
 */
export function asLocalCapabilityAdapter(core: LocalCapabilityAdapterCore): CapabilityAdapter {
  const lastByJob = new Map<string, CapabilityOutput>();

  const describe =
    core.describe ??
    ((): AdapterDescribeResult => ({
      adapterId: core.registration.adapter.adapterId,
      adapterType: core.registration.adapter.type,
      capabilityId: core.registration.id,
      displayName: core.registration.displayName,
      location: core.registration.location,
      outputArtifactTypes: [...core.registration.outputArtifactTypes],
      supportsAsyncRemote: false,
      version: core.adapterContractVersion ?? LOCAL_ADAPTER_CONTRACT_VERSION,
    }));

  const checkAvailability =
    core.checkAvailability ??
    (async (_ctx?: AvailabilityProbeContext): Promise<AvailabilityCheckResult> => {
      if (core.registration.availability === 'available') {
        return { available: true };
      }
      if (core.registration.availability === 'needs_setup') {
        return { available: false, reason: 'needs_setup', detail: '能力尚需配置后可用' };
      }
      return { available: false, reason: 'unavailable', detail: '能力当前不可用' };
    });

  const prepareAuthorizedInput =
    core.prepareAuthorizedInput ??
    (async (
      input: CapabilityInput,
      auth: RemoteAuthorizationProjection,
      _ctx: ExecutionContext,
    ): Promise<CapabilityInput> => applyAuthorizationProjectionToInput(input, auth));

  return {
    registration: core.registration,
    describe,
    checkAvailability,
    prepareAuthorizedInput,
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) throw abortError();
      const output = await core.execute(input, ctx);
      lastByJob.set(ctx.jobId, output);
      return output;
    },
    getStatus:
      core.getStatus ??
      (async (ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteStatusView> => {
        if (ctx.signal.aborted) return { status: 'cancelled', message: '本地执行已取消' };
        if (lastByJob.has(ctx.jobId) || lastByJob.has(ref.executionId)) {
          return { status: 'completed' };
        }
        return { status: 'running', message: '本地执行中' };
      }),
    cancel:
      core.cancel ??
      (async (_ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteCancelResult> => {
        // 本地取消由 Runner AbortSignal 驱动;此处仅确认语义。
        return {
          cancelled: ctx.signal.aborted || true,
          remoteAck: true,
          message: '本地能力跟随取消信号',
        };
      }),
    recover:
      core.recover ??
      (async (ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteRecoverResult> => {
        const cached = lastByJob.get(ctx.jobId) ?? lastByJob.get(ref.executionId);
        if (cached) return { status: 'completed', output: cached };
        if (ctx.signal.aborted) return { status: 'cancelled', message: '本地执行已取消' };
        return { status: 'failed', message: '本地同步能力无远端可恢复句柄' };
      }),
    collectArtifact:
      core.collectArtifact ??
      (async (ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<CapabilityOutput> => {
        const cached = lastByJob.get(ctx.jobId) ?? lastByJob.get(ref.executionId);
        if (!cached) {
          throw Object.assign(new Error('no local artifact to collect'), {
            stage: 'capability' as const,
            actionable: '请重新执行该任务',
          });
        }
        if (ctx.signal.aborted) throw abortError();
        return cached;
      }),
  };
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
