/**
 * 远端能力安全与预算 — 全部本地确定性执行。
 * 本轮不实现真实付款;Token/费用为占位接口。
 */

export interface TokenBudgetPlaceholder {
  /** 预估上限(占位,非计费)。 */
  maxTokens?: number;
  /** 预估费用上限(占位货币单位)。 */
  maxCostUnits?: number;
  /** 已用(占位)。 */
  usedTokens?: number;
  usedCostUnits?: number;
}

export interface RemoteSecurityBudget {
  allowedEndpoints: readonly string[];
  maxCallsPerTask: number;
  timeoutMs: number;
  maxConcurrent: number;
  /** 网络幂等重试最多一次(另计首次)。 */
  maxRetries: 0 | 1;
  maxInputBytes: number;
  maxOutputBytes: number;
  tokenBudget: TokenBudgetPlaceholder;
  /** Kill switch:开启后拒绝一切新的远端调用。 */
  killSwitch: boolean;
}

export const DEFAULT_REMOTE_SECURITY_BUDGET: RemoteSecurityBudget = {
  allowedEndpoints: [],
  maxCallsPerTask: 1,
  timeoutMs: 30_000,
  maxConcurrent: 2,
  maxRetries: 1,
  maxInputBytes: 256_000,
  maxOutputBytes: 512_000,
  tokenBudget: { maxTokens: 8_000, maxCostUnits: 0 },
  killSwitch: false,
};

export class RemoteSecurityGate {
  private readonly callsByTask = new Map<string, number>();
  private inflight = 0;
  private budget: RemoteSecurityBudget;

  constructor(budget: Partial<RemoteSecurityBudget> = {}) {
    this.budget = {
      ...DEFAULT_REMOTE_SECURITY_BUDGET,
      ...budget,
      tokenBudget: {
        ...DEFAULT_REMOTE_SECURITY_BUDGET.tokenBudget,
        ...(budget.tokenBudget ?? {}),
      },
      allowedEndpoints: budget.allowedEndpoints ?? DEFAULT_REMOTE_SECURITY_BUDGET.allowedEndpoints,
      maxRetries: (budget.maxRetries ?? 1) === 0 ? 0 : 1,
    };
  }

  get current(): RemoteSecurityBudget {
    return this.budget;
  }

  setKillSwitch(on: boolean): void {
    this.budget = { ...this.budget, killSwitch: on };
  }

  assertEndpointAllowed(endpoint: string): void {
    const normalized = normalizeEndpoint(endpoint);
    const ok = this.budget.allowedEndpoints.some((e) => normalizeEndpoint(e) === normalized);
    if (!ok) {
      throw Object.assign(new Error(`endpoint not allowlisted: ${endpoint}`), {
        stage: 'capability' as const,
        actionable: '远端地址未在白名单中',
      });
    }
  }

  assertCanStart(taskId: string): void {
    if (this.budget.killSwitch) {
      throw Object.assign(new Error('remote capability kill switch is on'), {
        stage: 'capability' as const,
        actionable: '远端能力已紧急关闭',
      });
    }
    const used = this.callsByTask.get(taskId) ?? 0;
    if (used >= this.budget.maxCallsPerTask) {
      throw Object.assign(new Error('remote call budget exceeded for task'), {
        stage: 'capability' as const,
        actionable: '本任务远端调用次数已达上限',
      });
    }
    if (this.inflight >= this.budget.maxConcurrent) {
      throw Object.assign(new Error('remote concurrency limit reached'), {
        stage: 'capability' as const,
        actionable: '远端并发已满,请稍后重试',
      });
    }
  }

  beginCall(taskId: string): void {
    this.assertCanStart(taskId);
    this.callsByTask.set(taskId, (this.callsByTask.get(taskId) ?? 0) + 1);
    this.inflight += 1;
  }

  endCall(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  assertInputSize(bytes: number): void {
    if (bytes > this.budget.maxInputBytes) {
      throw Object.assign(new Error(`remote input too large: ${bytes}`), {
        stage: 'capability' as const,
        actionable: '授权输入超过大小限制,请减少材料',
      });
    }
  }

  assertOutputSize(bytes: number): void {
    if (bytes > this.budget.maxOutputBytes) {
      throw Object.assign(new Error(`remote output too large: ${bytes}`), {
        stage: 'capability' as const,
        actionable: '远端返回超过大小限制',
      });
    }
  }

  /** 占位:检查 Token/费用预算(不产生真实付款)。 */
  assertTokenBudget(estimate: { tokens?: number; costUnits?: number }): void {
    const maxT = this.budget.tokenBudget.maxTokens;
    const maxC = this.budget.tokenBudget.maxCostUnits;
    if (maxT !== undefined && estimate.tokens !== undefined && estimate.tokens > maxT) {
      throw Object.assign(new Error('token budget exceeded (placeholder)'), {
        stage: 'capability' as const,
        actionable: '超出占位 Token 预算',
      });
    }
    if (maxC !== undefined && estimate.costUnits !== undefined && estimate.costUnits > maxC) {
      throw Object.assign(new Error('cost budget exceeded (placeholder)'), {
        stage: 'capability' as const,
        actionable: '超出占位费用预算',
      });
    }
  }
}

export function normalizeEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    const path = u.pathname.replace(/\/+$/, '') || '';
    return `${u.protocol}//${u.host}${path}`.toLowerCase();
  } catch {
    return String(endpoint || '')
      .trim()
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}
