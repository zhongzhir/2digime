/**
 * 极薄能力获取：只负责拿到成熟 runtime 并校验可执行。
 * 不理解用户任务，不做语义判断，不绑定单一厂商。
 */
export type AcquireFailureKind =
  | 'ACQUISITION FAILURE'
  | 'RUNTIME FAILURE'
  | 'MODEL FAILURE'
  | 'AUTH FAILURE'
  | 'INTEGRATION FAILURE'
  | 'TASK QUALITY FAILURE';

export interface AcquireContext {
  runtimeRoot: string;
  signal?: AbortSignal;
}

export interface AcquireResult {
  status: 'ready' | 'failed';
  candidateId?: string;
  runtimePath?: string;
  version?: string;
  failureKind?: AcquireFailureKind;
  detail?: string;
}

export interface AcquireCandidate {
  id: string;
  acquire(ctx: AcquireContext): Promise<AcquireResult>;
}

export async function acquireCapability(
  candidates: readonly AcquireCandidate[],
  ctx: AcquireContext,
): Promise<AcquireResult> {
  if (!candidates.length) {
    return { status: 'failed', failureKind: 'ACQUISITION FAILURE', detail: 'no_candidate' };
  }
  for (const candidate of candidates) {
    if (ctx.signal?.aborted) {
      return { status: 'failed', failureKind: 'ACQUISITION FAILURE', detail: 'aborted' };
    }
    const result = await candidate.acquire(ctx);
    if (result.status === 'ready') {
      return { ...result, candidateId: result.candidateId || candidate.id };
    }
  }
  return {
    status: 'failed',
    failureKind: 'ACQUISITION FAILURE',
    detail: 'all_candidates_failed',
  };
}
