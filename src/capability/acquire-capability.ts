/**
 * 极薄能力获取：只负责拿到成熟 runtime 并校验可执行。
 * 不理解用户任务，不做语义判断，不绑定单一厂商或 Coding。
 *
 * L2 最小基础：任意 capability 可提供自己的 AcquireCandidate[]（acquire()），
 * Talk 不需要为该能力增加下载/安装代码。OpenCode 是第一个真实实例，不是唯一合同。
 */
export type AcquireFailureKind =
  | 'ACQUISITION FAILURE'
  | 'RUNTIME FAILURE'
  | 'MODEL FAILURE'
  | 'AUTH FAILURE'
  | 'INTEGRATION FAILURE'
  | 'TASK QUALITY FAILURE'
  | 'http_status'
  | 'timeout'
  | 'integrity'
  | 'response'
  | 'asset_missing'
  | 'extract'
  | 'version';

export interface AcquireContext {
  runtimeRoot: string;
  signal?: AbortSignal;
}

export interface AcquireSourceFailure {
  source: string;
  failureKind?: AcquireFailureKind;
  safeDetail?: string;
}

export interface AcquireResult {
  status: 'ready' | 'failed';
  ok: boolean;
  candidateId?: string;
  runtimePath?: string;
  version?: string;
  failureKind?: AcquireFailureKind;
  /** 内部审计用，不含密钥。 */
  safeDetail?: string;
  /** 兼容旧字段；与 safeDetail 同值。 */
  detail?: string;
  source?: string;
  sourceFailures?: AcquireSourceFailure[];
}

export interface AcquireCandidate {
  id: string;
  acquire(ctx: AcquireContext): Promise<AcquireResult>;
}

export function readyAcquire(partial: {
  candidateId?: string;
  runtimePath: string;
  version?: string;
  source?: string;
  sourceFailures?: AcquireSourceFailure[];
}): AcquireResult {
  return {
    status: 'ready',
    ok: true,
    runtimePath: partial.runtimePath,
    ...(partial.candidateId ? { candidateId: partial.candidateId } : {}),
    ...(partial.version ? { version: partial.version } : {}),
    ...(partial.source ? { source: partial.source } : {}),
    ...(partial.sourceFailures?.length ? { sourceFailures: partial.sourceFailures } : {}),
  };
}

export function failedAcquire(partial: {
  candidateId?: string;
  failureKind: AcquireFailureKind;
  safeDetail: string;
  source?: string;
  sourceFailures?: AcquireSourceFailure[];
}): AcquireResult {
  return {
    status: 'failed',
    ok: false,
    failureKind: partial.failureKind,
    safeDetail: partial.safeDetail,
    detail: partial.safeDetail,
    ...(partial.candidateId ? { candidateId: partial.candidateId } : {}),
    ...(partial.source ? { source: partial.source } : {}),
    ...(partial.sourceFailures ? { sourceFailures: partial.sourceFailures } : {}),
  };
}

export async function acquireCapability(
  candidates: readonly AcquireCandidate[],
  ctx: AcquireContext,
): Promise<AcquireResult> {
  if (!candidates.length) {
    return failedAcquire({ failureKind: 'ACQUISITION FAILURE', safeDetail: 'no_candidate' });
  }
  const sourceFailures: AcquireSourceFailure[] = [];
  let last: AcquireResult | undefined;
  for (const candidate of candidates) {
    if (ctx.signal?.aborted) {
      return failedAcquire({ failureKind: 'timeout', safeDetail: 'aborted' });
    }
    const result = await candidate.acquire(ctx);
    if (result.status === 'ready') {
      return { ...result, ok: true, candidateId: result.candidateId || candidate.id };
    }
    last = result;
    if (result.sourceFailures?.length) sourceFailures.push(...result.sourceFailures);
    else {
      sourceFailures.push({
        source: result.source || candidate.id,
        ...(result.failureKind ? { failureKind: result.failureKind } : {}),
        ...(result.safeDetail || result.detail
          ? { safeDetail: result.safeDetail || result.detail }
          : {}),
      });
    }
  }
  return failedAcquire({
    failureKind: last?.failureKind || 'ACQUISITION FAILURE',
    safeDetail: last?.safeDetail || last?.detail || 'all_candidates_failed',
    sourceFailures,
  });
}
