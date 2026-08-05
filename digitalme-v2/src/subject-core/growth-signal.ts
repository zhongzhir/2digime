/**
 * 主体成长信号与采纳策略 — 扩展既有 GrowthEvent，不引入第二 Store。
 * 产品语义分类映射到现有事件类型；信号强度用 tags 表达。
 */
import type { GrowthEvent, GrowthEventType } from './growth-event';

/** 产品语义分类（不新增永久事件类型）。 */
export type GrowthProductCategory =
  | 'identity_fact'
  | 'goal'
  | 'boundary'
  | 'principle'
  | 'preference'
  | 'working_method'
  | 'capability_experience'
  | 'temporary_context'
  | 'external_claim';

export type GrowthSignalStrength = 'strong' | 'medium' | 'weak';

export type GrowthAdoptDecision = 'silent_adopt' | 'must_confirm' | 'keep_candidate' | 'discard';

const HIGH_RISK_RE =
  /融资|隐私|机密|敏感|身份证|银行卡|转账|支付|汇款|签署|公开发布|对外发布|法律意见|诉讼/;

const EXPLICIT_REMEMBER_RE = /以后这样|以后都|请记住|下次请|从今以后|固定为|一律/;

const TEMPORARY_RE = /仅本次|只这一次|临时|这次先|本周临时|一次性/;

export function mapEventTypeToCategory(type: GrowthEventType | string): GrowthProductCategory {
  switch (type) {
    case 'identity_clarified':
      return 'identity_fact';
    case 'goal_updated':
      return 'goal';
    case 'boundary_updated':
      return 'boundary';
    case 'principle_stated':
      return 'principle';
    case 'preference_observed':
      return 'preference';
    case 'experience_confirmed':
    case 'feedback_recorded':
      return 'capability_experience';
    case 'knowledge_gap_noted':
      return 'temporary_context';
    case 'asset_added':
      return 'external_claim';
    default:
      return 'temporary_context';
  }
}

export function classifySignalStrength(input: {
  sourceKind: string;
  text: string;
  type: string;
  tags?: readonly string[];
}): GrowthSignalStrength {
  const tags = input.tags || [];
  const text = input.text || '';
  if (tags.includes('signal:strong') || tags.includes('signal:medium') || tags.includes('signal:weak')) {
    if (tags.includes('signal:strong')) return 'strong';
    if (tags.includes('signal:medium')) return 'medium';
    return 'weak';
  }

  if (
    input.sourceKind === 'artifact_acceptance' ||
    input.sourceKind === 'artifact_rejection' ||
    input.sourceKind === 'explicit_boundary' ||
    input.sourceKind === 'repeated_correction' ||
    EXPLICIT_REMEMBER_RE.test(text) ||
    /纠正|不是|别再|不要再/.test(text)
  ) {
    return 'strong';
  }

  if (
    input.sourceKind === 'imported_material' ||
    input.sourceKind === 'artifact_edit' ||
    input.sourceKind === 'initial_self_description'
  ) {
    return 'medium';
  }

  if (
    input.type === 'knowledge_gap_noted' ||
    TEMPORARY_RE.test(text) ||
    tags.includes('category:external_claim') ||
    tags.includes('category:temporary_context')
  ) {
    return 'weak';
  }

  if (input.sourceKind === 'conversation' || input.sourceKind === 'task_requirement') {
    if (/偏好|习惯|风格|格式|结论先行|简洁/.test(text)) return 'medium';
    return 'weak';
  }

  return 'medium';
}

/**
 * 静默采纳：低风险 + 来源明确 + 无冲突 + 易纠正 + 非高风险外部行动。
 */
export function decideGrowthAdoption(input: {
  type: string;
  tags?: readonly string[];
  signal: GrowthSignalStrength;
  text?: string;
}): GrowthAdoptDecision {
  const tags = input.tags || [];
  const text = input.text || '';

  if (tags.includes('discard') || tags.includes('signal:discard')) return 'discard';
  if (input.signal === 'weak' && input.type === 'knowledge_gap_noted') return 'keep_candidate';
  if (tags.includes('category:external_claim')) return 'keep_candidate';
  if (tags.includes('category:temporary_context')) return 'keep_candidate';
  if (tags.includes('conflict') || tags.includes('needs_confirmation') || tags.includes('low_confidence')) {
    return 'must_confirm';
  }

  if (
    input.type === 'identity_clarified' ||
    input.type === 'goal_updated' ||
    input.type === 'boundary_updated' ||
    input.type === 'principle_stated'
  ) {
    return 'must_confirm';
  }

  if (HIGH_RISK_RE.test(text) || tags.some((t) => HIGH_RISK_RE.test(t))) {
    return 'must_confirm';
  }

  if (tags.includes('decision:accept') || tags.includes('decision:reject')) {
    return 'silent_adopt';
  }

  // 低风险偏好 / 工作方法：仅强信号可静默（中等须保留来源，不得自动成永久事实）
  if (
    (input.type === 'preference_observed' || tags.includes('category:working_method')) &&
    input.signal === 'strong'
  ) {
    return 'silent_adopt';
  }

  if (input.type === 'preference_observed' && input.signal === 'medium') {
    return 'keep_candidate';
  }

  if (input.type === 'feedback_recorded') {
    if (tags.includes('silent_ok') && input.signal !== 'weak') return 'silent_adopt';
    return 'must_confirm';
  }

  return 'keep_candidate';
}

/** 与既有权威条目的冲突检测（不静默覆盖）。 */
export function detectAuthorityConflict(input: {
  title: string;
  detail: string;
  type: string;
  authority: Array<{ title: string; detail: string; type?: string; tags?: string[] }>;
}): boolean {
  const text = `${input.title} ${input.detail}`.toLowerCase();
  for (const item of input.authority) {
    const prior = `${item.title} ${item.detail}`.toLowerCase();
    if (/本地优先/.test(prior) && /云端优先|全部上云|不要本地/.test(text)) return true;
    if (/结论先行/.test(prior) && /先铺垫|不要结论|禁止结论先行/.test(text)) return true;
    if (
      (/简洁|短句|少套话/.test(prior) && /完整分析|保留完整|详细展开|写长一点/.test(text)) ||
      (/完整分析|保留完整|详细展开/.test(prior) && /简洁|短句|少套话/.test(text))
    ) {
      return true;
    }
    if (/不要正式|别正式|反对正式/.test(text) && /正式/.test(prior)) return true;
    if (/不讨论.*融资|exclude:融资/.test(prior) && /可以讨论融资|公开融资细节/.test(text)) {
      return true;
    }
    if (
      input.type === 'goal_updated' &&
      item.type === 'goal_updated' &&
      shareBigram(prior, text) >= 2 &&
      /不再|取消|改成|反对/.test(text)
    ) {
      return true;
    }
  }
  return false;
}

function shareBigram(a: string, b: string): number {
  const grams = new Set<string>();
  for (let i = 0; i < a.length - 1; i += 1) grams.add(a.slice(i, i + 2));
  let n = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    if (grams.has(b.slice(i, i + 2))) n += 1;
  }
  return n;
}

export function categoryTag(category: GrowthProductCategory): string {
  return `category:${category}`;
}

export function signalTag(signal: GrowthSignalStrength): string {
  return `signal:${signal}`;
}

/** temporary_context 过期：tags 含 expiresAt:ISO */
export function isExpiredByTags(tags: readonly string[], now = new Date()): boolean {
  const hit = tags.find((t) => t.startsWith('expiresAt:'));
  if (!hit) return false;
  const iso = hit.slice('expiresAt:'.length);
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

export function enrichGrowthTags(input: {
  type: GrowthEventType | string;
  sourceKind: string;
  text: string;
  tags: string[];
  authority?: Array<{ title: string; detail: string; type?: string; tags?: string[] }>;
}): {
  tags: string[];
  signal: GrowthSignalStrength;
  adopt: GrowthAdoptDecision;
  category: GrowthProductCategory;
} {
  let category = mapEventTypeToCategory(input.type);
  const tags = [...input.tags];

  if (input.sourceKind === 'imported_material' && input.type !== 'boundary_updated') {
    // 仅「无结构项目事实」标 external_claim；身份/目标/原则仍按类型走确认
    if (
      input.type === 'asset_added' ||
      input.type === 'knowledge_gap_noted' ||
      input.type === 'preference_observed'
    ) {
      if (!tags.some((t) => t.startsWith('category:'))) {
        category = 'external_claim';
        tags.push(categoryTag('external_claim'));
      }
    }
  }

  if (TEMPORARY_RE.test(input.text) || tags.includes('temporary')) {
    category = 'temporary_context';
    if (!tags.includes(categoryTag('temporary_context'))) {
      tags.push(categoryTag('temporary_context'));
    }
    if (!tags.some((t) => t.startsWith('expiresAt:'))) {
      const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      tags.push(`expiresAt:${exp}`);
    }
  }

  if (
    /结论先行|先结论|结构偏好|格式偏好|工作方式/.test(input.text) &&
    input.type === 'preference_observed'
  ) {
    category = 'working_method';
    if (!tags.includes(categoryTag('working_method'))) tags.push(categoryTag('working_method'));
  }

  if (!tags.some((t) => t.startsWith('category:'))) {
    tags.push(categoryTag(category));
  }

  const signal = classifySignalStrength({
    sourceKind: input.sourceKind,
    text: input.text,
    type: input.type,
    tags,
  });
  if (!tags.some((t) => t.startsWith('signal:'))) tags.push(signalTag(signal));

  if (
    input.authority &&
    detectAuthorityConflict({
      title: input.text.slice(0, 80),
      detail: input.text,
      type: input.type,
      authority: input.authority,
    })
  ) {
    if (!tags.includes('conflict')) tags.push('conflict');
    if (!tags.includes('needs_confirmation')) tags.push('needs_confirmation');
  }

  const adopt = decideGrowthAdoption({
    type: input.type,
    tags,
    signal,
    text: input.text,
  });

  return { tags, signal, adopt, category };
}

/** 从已确认事件构造冲突检测用权威列表。 */
export function authorityFromEvents(events: readonly GrowthEvent[]): Array<{
  title: string;
  detail: string;
  type?: string;
  tags?: string[];
}> {
  return events
    .filter((e) => e.confidence === 'confirmed')
    .filter(
      (e) =>
        e.type === 'goal_updated' ||
        e.type === 'principle_stated' ||
        e.type === 'boundary_updated' ||
        e.type === 'identity_clarified' ||
        e.type === 'preference_observed',
    )
    .map((e) => {
      const row: { title: string; detail: string; type?: string; tags?: string[] } = {
        title: e.payload.title,
        detail: e.payload.detail,
        type: e.type,
      };
      if (e.payload.tags) row.tags = e.payload.tags;
      return row;
    });
}
