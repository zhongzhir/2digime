/**
 * DIGITALME-SUBJECT-GROUNDED-WORK-01 — 窄的运行态 Subject Context Package。
 *
 * 针对当前任务，从既有派生视图（SubjectDerivedBundle）选择「真正相关」的主体信息，
 * 按职责分层：
 *   mandatory（A）— 必须遵守：明确边界、授权限制、用户明确要求；
 *   applied  （B）— 应用于结果：相关已确认目标 / 定位 / 原则 / 偏好 / 项目上下文；
 *   reference（C）— 可参考经验：同类任务采用/纠正形成的已确认经验；
 *   excluded （D）— 不相关 / 候选 / 失效 / 外部主张 / 知识缺口：不得进入当前执行。
 *
 * 纯运行态：不新增 Store / 第二主体真值 / 新 profile DB；provenance 回答
 * 「为什么这条被注入、为什么那条没有」，默认不展示给普通用户。
 * 复用既有 selectSubjectInjection 的选择结果（同一来源，不建第二套选择）。
 */
import type { SubjectDerivedBundle } from './derive-all';
import type { SubjectEntryKind } from './derived-views';
import {
  selectSubjectInjection,
  type SubjectInjectionSelectInput,
  type ExperienceSelectOptions,
} from './experience-selector';

export type SubjectContextTier = 'mandatory' | 'applied' | 'reference';

export interface SubjectPackageEntry {
  eventId: string;
  kind: SubjectEntryKind;
  tier: SubjectContextTier;
  title: string;
  detail: string;
  tags: string[];
  occurredAt: string;
}

export interface SubjectPackageProvenance {
  eventId: string;
  tier: SubjectContextTier;
  reason: string;
}

export interface SubjectContextPackage {
  subjectId: string;
  derivedAt: string;
  /** A：必须遵守（边界/授权/明确约束）。 */
  mandatory: SubjectPackageEntry[];
  /** B：应用于成果（相关目标 / 定位 / 原则 / 偏好 / 项目上下文）。 */
  applied: SubjectPackageEntry[];
  /** C：可参考经验（同类任务确认经验）。 */
  reference: SubjectPackageEntry[];
  /** D：排除（不相关 / 候选 / 失效 / 外部主张 / 知识缺口）。 */
  excludedEventIds: string[];
  /** 每次选择的原因（审计；默认不展示给普通用户）。 */
  provenance: SubjectPackageProvenance[];
}

/** 层级映射：boundary → mandatory；experience → reference；其余核/偏好 → applied。 */
export function tierForEntryKind(kind: SubjectEntryKind | undefined): SubjectContextTier {
  switch (kind) {
    case 'boundary':
      return 'mandatory';
    case 'experience':
      return 'reference';
    default:
      return 'applied';
  }
}

/**
 * 针对当前任务构建窄主体上下文包（复用 selectSubjectInjection 的选择结果）。
 * 仅运行态；调用方可选择注入 mandatory / applied / reference，而把 excluded 留在外面。
 */
export function buildSubjectContextPackage(
  input: SubjectInjectionSelectInput,
  options: ExperienceSelectOptions = {},
): SubjectContextPackage {
  const { subjectContext, freeze } = selectSubjectInjection(input, options);
  const mandatory: SubjectPackageEntry[] = [];
  const applied: SubjectPackageEntry[] = [];
  const reference: SubjectPackageEntry[] = [];
  const byEventId = new Map<string, SubjectPackageEntry>();

  for (const e of subjectContext.entries) {
    const tier = tierForEntryKind(e.kind);
    const entry: SubjectPackageEntry = {
      eventId: e.eventId,
      kind: e.kind ?? 'experience',
      tier,
      title: e.title,
      detail: e.detail,
      tags: [...e.tags],
      occurredAt: e.occurredAt,
    };
    byEventId.set(e.eventId, entry);
    if (tier === 'mandatory') mandatory.push(entry);
    else if (tier === 'applied') applied.push(entry);
    else reference.push(entry);
  }

  const provenance: SubjectPackageProvenance[] = (freeze.selectionReasons || []).map((r) => {
    const entry = byEventId.get(r.eventId);
    return {
      eventId: r.eventId,
      tier: entry ? entry.tier : tierForEntryKind(undefined),
      reason: r.reason,
    };
  });

  return {
    subjectId: subjectContext.subjectId,
    derivedAt: subjectContext.derivedAt,
    mandatory,
    applied,
    reference,
    excludedEventIds: [...freeze.excludedEventIds],
    provenance,
  };
}

/** 将包平铺回 ConfirmedExperienceView（供既有 Adapter / Prompt 消费，不新建第二结构）。 */
export function packageToConfirmedView(
  pkg: SubjectContextPackage,
): {
  subjectId: string;
  derivedAt: string;
  entries: Array<{
    eventId: string;
    title: string;
    detail: string;
    tags: string[];
    occurredAt: string;
    kind?: SubjectEntryKind;
  }>;
} {
  const all = [...pkg.mandatory, ...pkg.applied, ...pkg.reference];
  return {
    subjectId: pkg.subjectId,
    derivedAt: pkg.derivedAt,
    entries: all.map((e) => ({
      eventId: e.eventId,
      title: e.title,
      detail: e.detail,
      tags: e.tags,
      occurredAt: e.occurredAt,
      kind: e.kind,
    })),
  };
}