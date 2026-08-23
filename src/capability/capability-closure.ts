/**
 * CAPABILITY-FALLBACK-CLOSURE-01 — 能力选择 / 降级运行态语义。
 *
 * 只表达"当前怎样才能最好地完成目标？"，不做 provider-name / brand routing。
 * 纯运行态：不新增 Store / schema / 状态机；能力发现复用既有
 * CapabilityRegistry（CapabilityRegistration 合同）、SearchConnector / SearchNeed、
 * coding 路由（routeCodingAgent）、模型网关与文档能力。
 *
 * 等级（简单语义，不建数字评分）：
 * - optimal    ：当前已有最适合的专业能力（默认静默执行）
 * - baseline   ：无最佳专业能力，但通用模型 + 基础工具足以完成任务（通常直接执行）
 * - limited    ：可完成部分目标，但存在重要质量/覆盖/实时性限制（不阻塞，自然说明）
 * - unavailable：当前能力无法可靠完成核心目标（诚实说明 + 给用户选择，不假装完成）
 *
 * 用户面文案永不暴露：provider id / HTTP status / quota / adapter / MCP / 内部能力图。
 */
import type { CapabilityRegistration } from './registration';
import type { WorkIntent } from '../work-runtime/work-intent';
import type { SearchNeed } from './search-contract';

export type CapabilityLevel = 'optimal' | 'baseline' | 'limited' | 'unavailable';

/** 任务能力域 — 由既有意图/SearchNeed 派生，不是第二套意图系统。 */
export type CapabilityDomain =
  | 'deep_research'
  | 'current_web'
  | 'coding'
  | 'document'
  | 'stable_knowledge';

export interface TaskCapabilityNeed {
  domain: CapabilityDomain;
  /** 是否要求最新时效（答案随时间变化）。 */
  freshnessRequired?: boolean;
  /** 是否需外部权威事实核验（本地知识可能过时）。 */
  externalVerificationRequired?: boolean;
  /** 研究复杂度 1-5（交叉验证需求）。 */
  researchComplexity?: number;
  /** 是否代码写权限任务。 */
  requiresWrite?: boolean;
  /** 是否已有材料输入（文档任务）。 */
  hasMaterials?: boolean;
}

export type CapabilityTier = 'professional' | 'baseline' | 'model' | 'tool';

/**
 * 运行态能力视图（发现结果，非持久 schema）。
 * providerOrigin 预留 2digime Managed Capability 接入（本任务不建设云服务）。
 */
export interface AvailableCapability {
  capabilityId: string;
  /** 用户面中性标签（不暴露内部名/供应商名）。 */
  kindLabel: string;
  tier: CapabilityTier;
  domains: CapabilityDomain[];
  usable: boolean;
  /** 是否可自动调用（无需用户手工交接）。 */
  automatic: boolean;
  /** 质量/覆盖是否明显低于专业能力（用于 LIMITED 提示的依据）。 */
  qualityGap?: boolean;
  providerOrigin?: 'third_party' | 'managed' | 'local';
}

export interface ExecutionPlan {
  planId: string;
  level: CapabilityLevel;
  /** 选中能力 id（审计用，不展示给普通用户）。 */
  capabilityId?: string;
  /** 用户面能力标签。 */
  kindLabel: string;
  /** 执行网络说明（内部审计；普通用户默认隐藏）。 */
  note?: string;
}

export interface FallbackOption {
  capabilityId: string;
  kindLabel: string;
  qualityNote?: string;
}

export type CapabilityUserChoice = 'continue_current' | 'use_stronger' | 'defer';

export interface CapabilityResolution {
  need: TaskCapabilityNeed;
  level: CapabilityLevel;
  plan: ExecutionPlan;
  fallbacks: FallbackOption[];
  /** 用户可选动作（LIMITED / UNAVAILABLE 时给出；OPTIMAL / BASELINE 默认静默）。 */
  userChoices: CapabilityUserChoice[];
  /**
   * 用户面自然语言状态（LIMITED / UNAVAILABLE 时提供；OPTIMAL / BASELINE 通常省略）。
   * 只含自然语言，不含技术细节。
   */
  userNotice?: string;
}

const KIND_LABELS: Record<CapabilityTier, string> = {
  professional: '专业能力',
  baseline: '基础能力',
  model: '通用模型',
  tool: '工具',
};

/** 既有 WorkIntent → 能力域。 */
export function domainFromWorkIntent(intent: WorkIntent): CapabilityDomain {
  switch (intent.intentKind) {
    case 'modify_code':
    case 'analyze_code':
      return 'coding';
    case 'create_document':
      return 'document';
    case 'external_research':
      return 'deep_research';
    default:
      return 'stable_knowledge';
  }
}

/** 既有 SearchNeed → 能力域。 */
export function domainFromSearchNeed(need: SearchNeed): CapabilityDomain {
  if (need.mode === 'deep_research') return 'deep_research';
  if (need.mode === 'web_search') return 'current_web';
  return 'stable_knowledge';
}

/** 由注册表条目派生运行态能力视图（不识别供应商；仅按能力合同归类）。 */
export function capabilityViewFromRegistration(
  reg: CapabilityRegistration,
): AvailableCapability | null {
  const usable = reg.availability === 'available';
  const type = reg.adapter.type;
  const base = {
    capabilityId: reg.id,
    usable,
    providerOrigin: 'third_party' as const,
  };
  if (type === 'openai-compatible-model') {
    return {
      ...base,
      kindLabel: KIND_LABELS.model,
      tier: 'model',
      domains: ['deep_research', 'current_web', 'coding', 'document', 'stable_knowledge'],
      automatic: true,
    };
  }
  if (type === 'external-executor-cli' || type === 'external-executor-http') {
    return {
      ...base,
      kindLabel: KIND_LABELS.professional,
      tier: 'professional',
      domains: ['coding'],
      automatic: true,
    };
  }
  if (type === 'external-executor-model-api') {
    return {
      ...base,
      kindLabel: '基础代码能力',
      tier: 'baseline',
      domains: ['coding'],
      automatic: true,
      qualityGap: true,
    };
  }
  if (type === 'remote-subject') {
    return {
      ...base,
      kindLabel: KIND_LABELS.professional,
      tier: 'professional',
      domains: ['deep_research', 'current_web'],
      automatic: true,
    };
  }
  // mcp-stdio / local-tool / 其它：不作为本组域的通用执行能力（只读工具走专用路径）。
  return null;
}

export function availableFromRegistrations(
  regs: readonly CapabilityRegistration[],
): AvailableCapability[] {
  const out: AvailableCapability[] = [];
  for (const reg of regs) {
    const view = capabilityViewFromRegistration(reg);
    if (view) out.push(view);
  }
  return out;
}

function serves(view: AvailableCapability, domain: CapabilityDomain): boolean {
  return view.domains.includes(domain);
}

function usableServing(
  available: readonly AvailableCapability[],
  domain: CapabilityDomain,
  tier?: CapabilityTier,
): AvailableCapability | undefined {
  return available.find(
    (v) => v.usable && v.automatic && serves(v, domain) && (tier === undefined || v.tier === tier),
  );
}

function plan(
  level: CapabilityLevel,
  capability: AvailableCapability | undefined,
  domain: CapabilityDomain,
  note?: string,
): ExecutionPlan {
  const p: ExecutionPlan = {
    planId: `${domain}:${level}`,
    level,
    kindLabel: capability?.kindLabel ?? '',
  };
  if (capability?.capabilityId) p.capabilityId = capability.capabilityId;
  if (note) p.note = note;
  return p;
}

/**
 * 统一能力选择：TaskCapabilityNeed + 当前可用能力 → 最佳执行方案（含等级）。
 * 纯函数；多次调用对同一可用能力集返回同一结果，因此更强能力一接入便自然升级。
 */
export function resolveCapability(
  need: TaskCapabilityNeed,
  available: readonly AvailableCapability[],
): CapabilityResolution {
  const domain = need.domain;
  const professional = usableServing(available, domain, 'professional');
  const baseline = usableServing(available, domain, 'baseline');
  const model = usableServing(available, domain, 'model');

  switch (domain) {
    case 'deep_research': {
      if (professional) {
        return resolution(need, 'optimal', plan('optimal', professional, domain), [], []);
      }
      if (baseline && model) {
        return resolution(need, 'baseline', plan('baseline', baseline, domain), [], []);
      }
      if (baseline || model) {
        return resolution(
          need,
          'limited',
          plan('limited', (baseline || model)!, domain),
          [],
          ['continue_current', 'use_stronger', 'defer'],
          buildCapabilityNotice('limited', need),
        );
      }
      return unavailableResolution(need);
    }
    case 'current_web': {
      if (professional) {
        return resolution(need, 'optimal', plan('optimal', professional, domain), [], []);
      }
      if (baseline && model) {
        return resolution(need, 'baseline', plan('baseline', baseline, domain), [], []);
      }
      if (baseline || model) {
        return resolution(
          need,
          'limited',
          plan('limited', (baseline || model)!, domain),
          [],
          ['continue_current', 'defer'],
          buildCapabilityNotice('limited', need),
        );
      }
      return unavailableResolution(need);
    }
    case 'coding': {
      if (professional) {
        return resolution(need, 'optimal', plan('optimal', professional, domain), [], []);
      }
      if (baseline) {
        const res = resolution(need, 'baseline', plan('baseline', baseline, domain), [], []);
        return res;
      }
      if (model) {
        return resolution(
          need,
          'limited',
          plan('limited', model, domain),
          [],
          ['continue_current', 'use_stronger', 'defer'],
          buildCapabilityNotice('limited', need),
        );
      }
      return unavailableResolution(need);
    }
    case 'document': {
      if (model || baseline) {
        const chosen = model || baseline!;
        const res = resolution(need, 'baseline', plan('baseline', chosen, domain), [], []);
        return res;
      }
      return unavailableResolution(need);
    }
    case 'stable_knowledge': {
      if (model) {
        const res = resolution(need, 'baseline', plan('baseline', model, domain), [], []);
        return res;
      }
      return unavailableResolution(need);
    }
  }
}

function resolution(
  need: TaskCapabilityNeed,
  level: CapabilityLevel,
  plan: ExecutionPlan,
  fallbacks: FallbackOption[],
  userChoices: CapabilityUserChoice[],
  userNotice?: string,
): CapabilityResolution {
  return { need, level, plan, fallbacks, userChoices, ...(userNotice ? { userNotice } : {}) };
}

function unavailableResolution(need: TaskCapabilityNeed): CapabilityResolution {
  return resolution(
    need,
    'unavailable',
    { planId: `${need.domain}:unavailable`, level: 'unavailable', kindLabel: '' },
    [],
    ['continue_current', 'use_stronger', 'defer'],
    buildCapabilityNotice('unavailable', need),
  );
}

/**
 * 用户面自然语言状态（LIMITED / UNAVAILABLE）。只含自然中文，
 * 不含 provider id / HTTP status / quota / adapter / MCP / 能力图。
 */
export function buildCapabilityNotice(
  level: CapabilityLevel,
  need: TaskCapabilityNeed,
): string | undefined {
  if (level === 'optimal' || level === 'baseline') return undefined;
  if (level === 'unavailable') {
    return '当前没有可靠可用的能力来完成这项任务。你可以选择：以当前能力继续，使用或连接更强能力，或者暂不执行。';
  }
  switch (need.domain) {
    case 'deep_research':
      return '可以继续完成，但当前只能使用基础研究能力，覆盖度可能低于专业深度研究。';
    case 'current_web':
      return '当前无法可靠确认最新信息。我可以先基于已有资料分析，或者联网能力恢复后继续查询。';
    case 'coding':
      return '当前没有可自动执行的代码能力。我可以先基于已有知识整理改动方案，但不会假装已在项目里执行；你也可以连接代码执行能力后再继续。';
    case 'document':
      return '可以继续完成，但当前只能使用基础能力生成文档，格式与质量可能低于专业文档能力。';
    case 'stable_knowledge':
      return '当前没有可靠可用的能力来完成这项任务。你可以选择：以当前能力继续，使用或连接更强能力，或者暂不执行。';
  }
}

/**
 * Search/Research 闭包分类（Deep Research / 当前信息）。
 * professionalSearchUsable / baselineSearchUsable / modelUsable 由调用方
 * 依据既有 SearchConnector 与模型配置的可用性传入；本函数不做供应商判断。
 */
export function classifySearchClosure(input: {
  need: SearchNeed;
  professionalSearchUsable: boolean;
  baselineSearchUsable: boolean;
  modelUsable: boolean;
}): CapabilityResolution {
  const domain = domainFromSearchNeed(input.need);
  const available: AvailableCapability[] = [];
  if (input.professionalSearchUsable) {
    available.push({
      capabilityId: 'professional_search',
      kindLabel: KIND_LABELS.professional,
      tier: 'professional',
      domains: ['deep_research', 'current_web'],
      usable: true,
      automatic: true,
    });
  }
  if (input.baselineSearchUsable) {
    available.push({
      capabilityId: 'baseline_search',
      kindLabel: '基础搜索能力',
      tier: 'baseline',
      domains: ['deep_research', 'current_web'],
      usable: true,
      automatic: true,
      qualityGap: true,
    });
  }
  if (input.modelUsable) {
    available.push({
      capabilityId: 'connected_model',
      kindLabel: KIND_LABELS.model,
      tier: 'model',
      domains: ['deep_research', 'current_web', 'coding', 'document', 'stable_knowledge'],
      usable: true,
      automatic: true,
    });
  }
  return resolveCapability({ domain }, available);
}

/** 从 registry 注册表解析任务执行方案（coding / document / stable_knowledge 等）。 */
export function resolveFromRegistry(
  need: TaskCapabilityNeed,
  registrations: readonly CapabilityRegistration[],
): CapabilityResolution {
  return resolveCapability(need, availableFromRegistrations(registrations));
}