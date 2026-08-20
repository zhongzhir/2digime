/**
 * MARKET-P95-CANDIDATE-GATE-01 — 把「市场 95 分位」做成可执行、可复现、fail-closed 的候选门。
 *
 * 本模块只是候选门，不是一次跑分，更不是达标声明。
 * 允许的终态只有封闭枚举；verdict 禁止出现 p95_met / mvp_ready / closed_alpha_ready。
 * 默认（本机无预算、无盲评人、无真实 Agent）必须落到 blocked 或 protocol_ready，不得假绿达标。
 */
import { createHash } from 'node:crypto';
import {
  computeArmPairGain,
  type BenchmarkArmPair,
} from './external-connector-contract';

/** 允许的终态（封闭枚举）。 */
export const P95_CANDIDATE_VERDICTS = [
  'protocol_ready',
  'scoring_blocked_missing_budget',
  'scoring_blocked_missing_blind_review',
  'scoring_blocked_agents_unavailable',
  'candidate_scored_not_claimed',
] as const;
export type P95CandidateVerdict = (typeof P95_CANDIDATE_VERDICTS)[number];

/** 禁止出现在 verdict 的达标类词汇。 */
export const P95_FORBIDDEN_VERDICTS = ['p95_met', 'mvp_ready', 'closed_alpha_ready'] as const;

/** 等预算定义（冻结）：同一 taskId 的两臂 budget 必须相等。 */
export function assertEqualBudget(pair: BenchmarkArmPair): void {
  const { direct, orchestrated } = pair;
  if (direct.budget !== orchestrated.budget) {
    throw new Error(
      `equal-budget violation: ${pair.taskId} direct=${direct.budget} orchestrated=${orchestrated.budget}`,
    );
  }
}

/**
 * 等预算一致性检查（对所有 pair）：返回违规列表（空=全部等预算）。
 * 冻结：同一 taskId 的两臂 budget 必须相等。
 */
export function checkEqualBudget(pairs: readonly BenchmarkArmPair[]): string[] {
  const violations: string[] = [];
  for (const pair of pairs) {
    const { direct, orchestrated } = pair;
    if (direct.budget !== orchestrated.budget) {
      violations.push(`budget-mismatch:${pair.taskId}`);
    }
  }
  return violations;
}

/**
 * 盲评包（冻结）：目标、材料、产出摘录、预注册验证。
 * 不得含 arm / adapterId / direct / orchestrated / 厂商名。
 */
export interface BlindReviewPacket {
  schemaVersion: 'p95-blind-review-packet/1';
  packetId: string;
  taskId: string;
  goal: string;
  materialExcerpts: string[];
  outputExcerpt: string;
  preRegisteredVerification: string[];
  /** 评分字段预留（评者填写）。 */
  ratings: {
    substantiveCompletion: boolean | null;
    falseCompletion: boolean | null;
    honestFailure: boolean | null;
    wouldAdopt: boolean | null;
  };
}

export interface BlindReviewPacketInput {
  taskId: string;
  goal: string;
  allowedMaterials: string[];
  outputExcerpt: string;
  preRegisteredVerification: string[];
}

const BLIND_FORBIDDEN = ['direct', 'orchestrated', 'adapterId', 'arm'];

/** 生成盲评包并去臂标签。 */
export function buildBlindReviewPacket(input: BlindReviewPacketInput): BlindReviewPacket {
  const packet: BlindReviewPacket = {
    schemaVersion: 'p95-blind-review-packet/1',
    packetId: `pkt_${sha256(JSON.stringify([input.taskId, input.goal]))}`,
    taskId: input.taskId,
    goal: input.goal,
    materialExcerpts: input.allowedMaterials.slice(0, 20),
    outputExcerpt: String(input.outputExcerpt || '').slice(0, 4000),
    preRegisteredVerification: [...input.preRegisteredVerification],
    ratings: {
      substantiveCompletion: null,
      falseCompletion: null,
      honestFailure: null,
      wouldAdopt: null,
    },
  };
  return packet;
}

/** 盲评包不得泄漏臂标签 / adapterId / 厂商名。 */
export function assertBlindReviewPacketClean(packet: BlindReviewPacket): void {
  const blob = JSON.stringify(packet).toLowerCase();
  for (const bad of BLIND_FORBIDDEN) {
    if (blob.includes(bad)) {
      throw new Error(`blind review packet leaks forbidden marker: ${bad}`);
    }
  }
  for (const vendor of ['claude', 'cursor', 'codex', 'gemini', 'openai', 'anthropic']) {
    if (new RegExp(`\\b${vendor}\\b`).test(blob)) {
      throw new Error(`blind review packet leaks vendor name: ${vendor}`);
    }
  }
}

export interface BlindRatingInput {
  substantiveCompletion: boolean;
  falseCompletion: boolean;
  honestFailure: boolean;
  wouldAdopt: boolean;
}

export interface UnblindedReview {
  packetId: string;
  taskId: string;
  arm: 'direct' | 'orchestrated';
  adapterId: string;
  ratings: BlindRatingInput;
  reviewedAt: string;
}

/**
 * 拆封：仅由服务端在评卷完成后把评卷记录与对应臂/适配器绑定。
 * 禁止在评卷前让评者看到臂标签。
 */
export function unblindAfterReview(input: {
  packetId: string;
  taskId: string;
  arm: 'direct' | 'orchestrated';
  adapterId: string;
  ratings: BlindRatingInput;
  reviewedAt?: string;
}): UnblindedReview {
  return {
    packetId: input.packetId,
    taskId: input.taskId,
    arm: input.arm,
    adapterId: input.adapterId,
    ratings: { ...input.ratings },
    reviewedAt: input.reviewedAt || new Date().toISOString(),
  };
}

export interface P95CandidateVerdictInput {
  /** 是否有等预算授权（真实预算批准）。 */
  hasBudgetAuthorization: boolean;
  /** 是否有盲评记录（真实评卷，非合成）。 */
  hasBlindReviews: boolean;
  /** 对照 Agent（主/备）是否真实可用。 */
  agentsAvailable: boolean;
  /** 是否只是协议/公式自检（hook / 合成）。 */
  protocolCheckOnly?: boolean;
}

/**
 * 候选门判定（fail-closed）。
 * - 缺预算授权 → scoring_blocked_missing_budget
 * - 缺盲评 → scoring_blocked_missing_blind_review
 * - 对照 Agent 不可用 → scoring_blocked_agents_unavailable
 * - 仅协议自检 → protocol_ready
 * - 全部真实发生 → candidate_scored_not_claimed（不得宣称 95 分位）
 */
export function decideP95CandidateVerdict(
  input: P95CandidateVerdictInput,
): P95CandidateVerdict {
  if (!input.hasBudgetAuthorization) {
    return 'scoring_blocked_missing_budget';
  }
  if (!input.hasBlindReviews) {
    return 'scoring_blocked_missing_blind_review';
  }
  if (!input.agentsAvailable) {
    return 'scoring_blocked_agents_unavailable';
  }
  if (input.protocolCheckOnly) {
    return 'protocol_ready';
  }
  return 'candidate_scored_not_claimed';
}

/** 可复现性（冻结）：同 fixture + 同 seed + 同合成记录 → 指标与 verdict 完全一致。 */
export function reproducibleHash(input: {
  taskId: string;
  seed: string;
  metrics: ReturnType<typeof computeArmPairGain>;
  verdict: P95CandidateVerdict;
}): string {
  return sha256(JSON.stringify([input.taskId, input.seed, input.metrics, input.verdict]));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
