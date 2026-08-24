/**
 * DIGITALME-... — AI-native delegated execution（第一次真实协作闭环）。
 *
 * 组合：SubjectContextPackage（最小上下文）+ Capability Closure（能力判断）+
 * remote-subject / A2A（外部 Agent / 另一个 Digital Me）+ 现有 Agent adapters。
 *
 * 纯运行态：不新增 Store / 第二协作真值 / 复杂工作流状态机。
 * 职责：判断「本地不足 → 外部更合适 → 委托」；在外部失败时自动回退本地 baseline。
 *
 * 委托出去的是执行，不是主体控制权：远端只收到 goal + 授权材料，主体上下文默认不发。
 */
import type { CapabilityRegistration } from '../capability/registration';
import type { TaskCapabilityNeed, CapabilityLevel } from '../capability/capability-closure';

export type DelegationMode = 'local' | 'delegate';

/** 委托决策（运行态，不落盘）。 */
export interface DelegationDecision {
  mode: DelegationMode;
  domain: TaskCapabilityNeed['domain'];
  level: CapabilityLevel;
  /** 专业外部能力（remote research / 专业 Coding Agent）。 */
  primaryCapabilityId?: string;
  primaryKindLabel?: string;
  /** 失败时的本地 fallback 能力列表（有序）。 */
  fallbackCapabilityIds: string[];
  /** 用户面说明（LIMITED/UNAVAILABLE 时）。 */
  notice?: string;
}

/** 委托执行审计（返回给调用方；不含协议/HTTP/Agent 内部细节）。 */
export interface DelegationAudit {
  mode: DelegationMode;
  level: CapabilityLevel;
  primaryCapabilityId?: string;
  /** 是否在首个能力失败后自动启用了 fallback。 */
  fallbackUsed: boolean;
  /** 最终实际执行的能力 id。 */
  finalCapabilityId?: string;
  /** 全部候选均失败时为 true。 */
  failed?: boolean;
}

const REMOTE_RESEARCH_TYPES = ['remote-subject'];
const CODING_AGENT_TYPES = ['external-executor-cli', 'external-executor-http'];
const BASELINE_CODING_TYPES = ['external-executor-model-api'];

/** 研究型目标信号（Do 链把研究报告类目标归为 document；据目标词判定是否研究性质）。 */
const RESEARCH_GOAL_RE =
  /深入研究|深度调研|调研|研究报告|研究一下|趋势分析|行业分析|行业研究|尽调|白皮书|research\b/i;

function usableOf(
  regs: readonly CapabilityRegistration[],
  types: readonly string[],
): CapabilityRegistration[] {
  return regs.filter((r) => types.includes(r.adapter.type) && r.availability === 'available');
}

/** 本地文档型 fallback（fake 或真实通用模型；排除远端能力本身）。 */
function localDocumentFallbacks(
  regs: readonly CapabilityRegistration[],
): CapabilityRegistration[] {
  return regs.filter(
    (r) =>
      r.availability === 'available' &&
      r.outputArtifactTypes.includes('document') &&
      r.adapter.type !== 'remote-subject',
  );
}

/**
 * 委托决策：由 TaskCapabilityNeed + 当前可用能力决定
 * 「本地执行 / 委托外部专业能力（+ 本地 fallback）」。
 * 无品牌判断；专业 = capability contract（remote-subject / 专业 coding agent）。
 */
export function decideDelegation(input: {
  need: TaskCapabilityNeed;
  goal: string;
  registrations: readonly CapabilityRegistration[];
}): DelegationDecision {
  const regs = input.registrations;
  const domain = input.need.domain;
  const goal = input.goal;

  const isResearch =
    domain === 'deep_research' ||
    domain === 'current_web' ||
    ((domain === 'document' || domain === 'stable_knowledge') && RESEARCH_GOAL_RE.test(goal));
  if (isResearch) {
    const remoteResearch = usableOf(regs, REMOTE_RESEARCH_TYPES);
    if (remoteResearch.length > 0) {
      const primary = remoteResearch[0]!;
      return {
        mode: 'delegate',
        domain,
        level: 'optimal',
        primaryCapabilityId: primary.id,
        primaryKindLabel: primary.displayName,
        fallbackCapabilityIds: localDocumentFallbacks(regs).map((r) => r.id),
      };
    }
    const local = localDocumentFallbacks(regs);
    return {
      mode: 'local',
      domain,
      level: local.length > 0 ? 'baseline' : 'unavailable',
      fallbackCapabilityIds: [],
    };
  }

  if (domain === 'coding') {
    const agents = usableOf(regs, CODING_AGENT_TYPES);
    const modelApi = usableOf(regs, BASELINE_CODING_TYPES);
    const model = usableOf(regs, ['openai-compatible-model']);
    if (agents.length > 0) {
      const primary = agents[0]!;
      return {
        mode: 'delegate',
        domain,
        level: 'optimal',
        primaryCapabilityId: primary.id,
        primaryKindLabel: primary.displayName,
        fallbackCapabilityIds: modelApi.map((r) => r.id),
      };
    }
    return {
      mode: 'local',
      domain,
      level: modelApi.length > 0 ? 'baseline' : model.length > 0 ? 'limited' : 'unavailable',
      fallbackCapabilityIds: [],
    };
  }

  // document / stable_knowledge：本地执行（通用模型即可完成，无需外部协作）。
  const local = localDocumentFallbacks(regs);
  return {
    mode: 'local',
    domain,
    level: local.length > 0 ? 'baseline' : 'unavailable',
    fallbackCapabilityIds: [],
  };
}

/** 候选执行路径（有序）：primary + fallbacks。 */
export function delegationCandidates(decision: DelegationDecision): string[] {
  const out: string[] = [];
  if (decision.primaryCapabilityId) out.push(decision.primaryCapabilityId);
  for (const id of decision.fallbackCapabilityIds) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}