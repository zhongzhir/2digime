/**
 * 候选合同归一 — 将模型近义字段映射到既有正式合同。
 * 未知分类不得直接进入成长链；不按模型新建专属分类体系。
 */
import type { GrowthEventType } from './growth-event';
import type { GrowthProductCategory } from './growth-signal';
import type { DistilledCandidateProposal } from './candidate-quality-gate';

export interface RawModelCandidate {
  title?: unknown;
  text?: unknown;
  detail?: unknown;
  category?: unknown;
  eventType?: unknown;
  type?: unknown;
  scope?: unknown;
  temporary?: unknown;
  risk?: unknown;
  maybeConflict?: unknown;
  needs_confirmation?: unknown;
  needsConfirmation?: unknown;
  modelConfidenceSummary?: unknown;
  confidenceSummary?: unknown;
  [key: string]: unknown;
}

export interface NormalizeCandidateResult {
  ok: boolean;
  reason?: string;
  proposal?: DistilledCandidateProposal;
  /** 归一前原始快照（验收追溯，不上用户面） */
  rawSnapshot: Record<string, unknown>;
  /** 归一后关键字段 */
  normalized?: {
    category: GrowthProductCategory;
    eventType: DistilledCandidateProposal['eventType'];
    mappedFrom: string;
  };
}

const CATEGORY_ALIASES: Record<string, GrowthProductCategory> = {
  preference: 'preference',
  user_preference: 'preference',
  userpreference: 'preference',
  work_style: 'working_method',
  workstyle: 'working_method',
  working_method: 'working_method',
  workingmethod: 'working_method',
  personal_rule: 'principle',
  personalrule: 'principle',
  principle: 'principle',
  boundary: 'boundary',
  goal: 'goal',
  identity_fact: 'identity_fact',
  identity: 'identity_fact',
  identityfact: 'identity_fact',
  temporary_context: 'temporary_context',
  temporary: 'temporary_context',
  temporarycontext: 'temporary_context',
  external_claim: 'external_claim',
  project_fact: 'external_claim',
  projectfact: 'external_claim',
  capability_experience: 'capability_experience',
  experience: 'capability_experience',
  // 结构化字段中文标签（schema repair，不是用户自然语言分类器）
  偏好: 'preference',
  个人偏好: 'preference',
  工作方法: 'working_method',
  工作习惯: 'working_method',
  做事方式: 'working_method',
  原则: 'principle',
  个人原则: 'principle',
  边界: 'boundary',
  目标: 'goal',
  身份: 'identity_fact',
  身份事实: 'identity_fact',
  临时: 'temporary_context',
  临时上下文: 'temporary_context',
  外部主张: 'external_claim',
  外部事实: 'external_claim',
};

const EVENT_ALIASES: Record<string, DistilledCandidateProposal['eventType']> = {
  preference_observed: 'preference_observed',
  user_preference: 'preference_observed',
  preference: 'preference_observed',
  working_method: 'preference_observed',
  workingmethod: 'preference_observed',
  principle_stated: 'principle_stated',
  personal_rule: 'principle_stated',
  principle: 'principle_stated',
  goal_updated: 'goal_updated',
  goal: 'goal_updated',
  boundary_updated: 'boundary_updated',
  boundary: 'boundary_updated',
  identity_clarified: 'identity_clarified',
  identity: 'identity_clarified',
  feedback_recorded: 'feedback_recorded',
  asset_added: 'asset_added',
  project_fact: 'asset_added',
  external_claim: 'asset_added',
  knowledge_gap_noted: 'knowledge_gap_noted',
  temporary_context: 'knowledge_gap_noted',
  偏好: 'preference_observed',
  工作方法: 'preference_observed',
  原则: 'principle_stated',
  边界: 'boundary_updated',
  目标: 'goal_updated',
  身份: 'identity_clarified',
};

function canon(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function mapCategoryAlias(raw: unknown): GrowthProductCategory | null {
  const key = canon(raw);
  return CATEGORY_ALIASES[key] || null;
}

export function mapEventTypeAlias(raw: unknown): DistilledCandidateProposal['eventType'] | null {
  const key = canon(raw);
  return EVENT_ALIASES[key] || null;
}

function categoryToEventType(category: GrowthProductCategory): DistilledCandidateProposal['eventType'] {
  switch (category) {
    case 'preference':
    case 'working_method':
      return 'preference_observed';
    case 'principle':
      return 'principle_stated';
    case 'boundary':
      return 'boundary_updated';
    case 'goal':
      return 'goal_updated';
    case 'identity_fact':
      return 'identity_clarified';
    case 'capability_experience':
      return 'feedback_recorded';
    case 'external_claim':
      return 'asset_added';
    case 'temporary_context':
    default:
      return 'knowledge_gap_noted';
  }
}

/**
 * 将单条模型原始候选归一为正式提案。
 * 模型 needs_confirmation / maybeConflict 仅作线索，不直接决定产品确认。
 */
export function normalizeModelCandidate(
  raw: RawModelCandidate,
  sourceKind: string,
): NormalizeCandidateResult {
  const rawSnapshot: Record<string, unknown> = {
    title: raw.title,
    text: raw.text ?? raw.detail,
    category: raw.category,
    eventType: raw.eventType ?? raw.type,
    scope: raw.scope,
    temporary: raw.temporary,
    risk: raw.risk,
    maybeConflict: raw.maybeConflict,
    needs_confirmation: raw.needs_confirmation ?? raw.needsConfirmation,
    modelConfidenceSummary: raw.modelConfidenceSummary ?? raw.confidenceSummary,
  };

  const title = String(raw.title || '').trim();
  const text = String(raw.text ?? raw.detail ?? '').trim();
  if (!title || !text) {
    return { ok: false, reason: 'empty_content', rawSnapshot };
  }

  const mappedFrom = canon(raw.category || raw.eventType || raw.type || 'unknown') || 'unknown';
  let category = mapCategoryAlias(raw.category);
  let eventType = mapEventTypeAlias(raw.eventType ?? raw.type);

  if (!category && eventType) {
    // 仅有 eventType 别名时反推 category
    if (eventType === 'preference_observed') category = 'preference';
    else if (eventType === 'principle_stated') category = 'principle';
    else if (eventType === 'boundary_updated') category = 'boundary';
    else if (eventType === 'goal_updated') category = 'goal';
    else if (eventType === 'identity_clarified') category = 'identity_fact';
    else if (eventType === 'asset_added') category = 'external_claim';
    else if (eventType === 'feedback_recorded') category = 'capability_experience';
    else category = 'temporary_context';
  }
  if (!eventType && category) {
    eventType = categoryToEventType(category);
  }

  if (!category || !eventType) {
    // 未知分类：有明确长期偏好措辞时可降级为 preference，否则丢弃
    const blob = `${title} ${text}`;
    if (/以后这样|以后都|请记住|从今以后/.test(blob) && /结论|简洁|简短|篇幅|决策/.test(blob)) {
      category = 'working_method';
      eventType = 'preference_observed';
    } else if (sourceKind === 'imported_material') {
      category = 'external_claim';
      eventType = 'asset_added';
    } else {
      return { ok: false, reason: 'unknown_category', rawSnapshot };
    }
  }

  // 资料来源强制 external_claim，不得写成用户偏好
  if (sourceKind === 'imported_material' && category === 'preference') {
    category = 'external_claim';
    eventType = 'asset_added';
  }

  const temporary = Boolean(raw.temporary) || /仅本次|只这一次|这次先|临时/.test(`${title} ${text}`);
  const scopeRaw = String(raw.scope || (temporary ? 'temporary' : 'general')).toLowerCase();
  const scope: DistilledCandidateProposal['scope'] =
    scopeRaw === 'task' || scopeRaw === 'artifact_type' || scopeRaw === 'temporary'
      ? scopeRaw
      : temporary
        ? 'temporary'
        : 'general';

  const riskRaw = String(raw.risk || 'low').toLowerCase();
  let risk: DistilledCandidateProposal['risk'] =
    riskRaw === 'high' || riskRaw === 'medium' ? (riskRaw as DistilledCandidateProposal['risk']) : 'low';
  // 偏好/工作方法默认低风险；身份/边界/目标保持更高
  if (category === 'preference' || category === 'working_method') {
    if (!/融资|隐私|支付|签署|公开发布|授权/.test(`${title} ${text}`)) risk = 'low';
  }
  if (
    category === 'identity_fact' ||
    category === 'boundary' ||
    category === 'goal' ||
    category === 'principle'
  ) {
    risk = risk === 'low' ? 'medium' : risk;
  }

  const proposal: DistilledCandidateProposal = {
    title: title.slice(0, 80),
    text: text.slice(0, 400),
    category,
    sourceKind,
    scope,
    temporary,
    ...(temporary
      ? { expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }
      : {}),
    risk,
    // 模型冲突/确认仅为线索，最终由本地权威冲突检测写入
    maybeConflict: false,
    modelConfidenceSummary: String(
      raw.modelConfidenceSummary ?? raw.confidenceSummary ?? 'model',
    ).slice(0, 120),
    eventType,
    tags: [
      `raw_category:${mappedFrom}`,
      `norm_category:${category}`,
      `norm_event:${eventType}`,
    ],
  };

  // 保留模型建议痕迹（不上用户面）
  if (raw.maybeConflict === true || raw.needs_confirmation === true || raw.needsConfirmation === true) {
    proposal.tags = [...(proposal.tags || []), 'model_suggests_confirm'];
  }

  return {
    ok: true,
    proposal,
    rawSnapshot,
    normalized: { category, eventType, mappedFrom },
  };
}

export function isFormalGrowthEventType(type: string): type is GrowthEventType {
  return (
    type === 'preference_observed' ||
    type === 'experience_confirmed' ||
    type === 'asset_added' ||
    type === 'boundary_updated' ||
    type === 'goal_updated' ||
    type === 'feedback_recorded' ||
    type === 'identity_clarified' ||
    type === 'principle_stated' ||
    type === 'knowledge_gap_noted' ||
    type === 'subject_corrected'
  );
}
