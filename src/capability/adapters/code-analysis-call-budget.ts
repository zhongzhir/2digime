/**
 * P2.3 code-analysis 模型调用硬预算。
 * 仅 Adapter 内部计量;不写入 Job/Task 领域字段。
 */
export const CODE_ANALYSIS_MAX_MODEL_CALLS = 4;
export const CODE_ANALYSIS_CALL_TIMEOUT_MS = 90_000;
export const CODE_ANALYSIS_OVERALL_SOFT_TIMEOUT_MS = 180_000;
export const CODE_ANALYSIS_PHASE_MAIN_CALLS = 1;
export const CODE_ANALYSIS_PHASE_STRUCT_RETRIES = 1;

export type CodeAnalysisCallPhase = 'findings' | 'sections';

export interface CodeAnalysisRetryRecord {
  phase: CodeAnalysisCallPhase;
  reason: string;
  atIso: string;
}

export interface CodeAnalysisCallBudgetReport {
  modelCalls: number;
  maxCalls: number;
  retries: CodeAnalysisRetryRecord[];
  callTimeoutMs: number;
  overallTimeoutMs: number;
  exhaustedReason?: string;
}

export class CodeAnalysisCallBudget {
  private calls = 0;
  private readonly retries: CodeAnalysisRetryRecord[] = [];
  private exhaustedReason: string | undefined;
  readonly callTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly maxCalls: number;

  constructor(options?: {
    maxCalls?: number;
    callTimeoutMs?: number;
    overallTimeoutMs?: number;
  }) {
    this.maxCalls = options?.maxCalls ?? CODE_ANALYSIS_MAX_MODEL_CALLS;
    this.callTimeoutMs = options?.callTimeoutMs ?? CODE_ANALYSIS_CALL_TIMEOUT_MS;
    this.overallTimeoutMs = options?.overallTimeoutMs ?? CODE_ANALYSIS_OVERALL_SOFT_TIMEOUT_MS;
  }

  get modelCalls(): number {
    return this.calls;
  }

  recordRetry(phase: CodeAnalysisCallPhase, reason: string): void {
    this.retries.push({ phase, reason, atIso: new Date().toISOString() });
  }

  /** 在发起模型调用前占用一次配额;超限则失败。 */
  consume(phase: CodeAnalysisCallPhase): void {
    if (this.calls >= this.maxCalls) {
      this.exhaustedReason = `model call budget exceeded (${this.maxCalls}) during ${phase}`;
      throw Object.assign(new Error(this.exhaustedReason), {
        stage: 'capability' as const,
        actionable: '请缩小分析范围后重试',
        kind: 'budget_exceeded',
      });
    }
    this.calls += 1;
  }

  report(): CodeAnalysisCallBudgetReport {
    const out: CodeAnalysisCallBudgetReport = {
      modelCalls: this.calls,
      maxCalls: this.maxCalls,
      retries: [...this.retries],
      callTimeoutMs: this.callTimeoutMs,
      overallTimeoutMs: this.overallTimeoutMs,
    };
    if (this.exhaustedReason) out.exhaustedReason = this.exhaustedReason;
    return out;
  }
}

/** 组合外部取消与整体软超时。 */
export function createDeadlineSignal(
  parent: AbortSignal,
  overallTimeoutMs: number,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const local = new AbortController();
  let timedOut = false;
  const onParent = () => local.abort();
  if (parent.aborted) {
    local.abort();
  } else {
    parent.addEventListener('abort', onParent, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, overallTimeoutMs);
  return {
    signal: local.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParent);
    },
  };
}
