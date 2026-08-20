/**
 * 数字之我成长派生视图 — 由现有 Package / GrowthEvent / materials / 确认与反馈计算。
 * 静态维度定义不是事实源；不持久化第二套完成表或阶段布尔表。
 */
import type { GrowthEvent } from './growth-event';
import { isExpiredByTags } from './growth-signal';
import type { SubjectDerivedBundle } from './derive-all';
import { buildUserVisibleFacts } from './user-facing-overview';
import {
  GROWTH_DIMENSIONS,
  GROWTH_STAGE_GUIDE,
  GUIDE_CHOICE_PREFIX,
  dimensionByKey,
  isInternalGrowthPhrase,
  parseGuideChoiceCaptureKey,
  type GrowthDimensionKey,
  type GrowthDimensionStatus,
  type GrowthGuideChoice,
} from './growth-dimensions';

export {
  GROWTH_DIMENSIONS,
  GROWTH_STAGE_GUIDE,
  GUIDE_CHOICE_PREFIX,
  dimensionByKey,
  guideChoiceCaptureKey,
  isEphemeralConversationIntent,
  isInternalGrowthPhrase,
  parseGuideChoiceCaptureKey,
} from './growth-dimensions';
export type {
  GrowthDimensionKey,
  GrowthDimensionSensitivity,
  GrowthDimensionStatus,
  GrowthGuideChoice,
  GrowthGuideChoiceStored,
} from './growth-dimensions';

export type GrowthStageLevel = 0 | 1 | 2 | 3;

export type GrowthTrackKey = 'represent' | 'work' | 'collab';

export type GrowthTrackStatus = 'pending' | 'started' | 'stable';

export type GrowthTaskKey =
  | 'continue_conversation'
  | 'add_representative_material'
  | 'answer_short_form'
  | 'optional_learn_from_work'
  | 'resolve_important_conflict';

export const GROWTH_COPY = {
  blockTitle: '数字之我',
  currentStage: '当前阶段',
  laterStages: '之后会按你的使用继续完善，不必一次补完。',
  nextSteps: '当前最值得补充',
  whyThisStep: '为什么建议这一步',
  needsCalibration: '需要校准',
  viewSituation: '查看完整情况',
  otherWays: '其他完善方式',
  continueLearn: '继续了解我',
  knownGroup: '已有所了解',
  partialGroup: '可以继续补充',
  unknownGroup: '暂未了解',
  optionalWorkNote: '这不是必经步骤，只是让我从真实工作中了解你的一种方式。',
  switchQuestion: '换一个问题',
  laterTopic: '稍后再聊这个',
  nolearnOnce: '本次回答不用于长期了解',
  cockpitKnown: '已经了解',
  cockpitGaps: '还可以了解',
  cockpitMaterials: '已有资料',
  viewAllMaterials: '查看全部',
  represent: '代表我',
  work: '做事',
  collab: '协作',
  trackPending: '待完善',
  trackStarted: '已开始',
  trackStable: '基础稳定',
  placeholderIdentityName: '我的数字之我',
  stage0Name: '未开始',
  stage0Explanation: '数字之我还缺少来源明确的本人信息。可以从对话开始，让我逐步了解你。',
  stage1Name: '基础建立',
  stage1Explanation: '已有来源明确的本人信息。可以继续通过对话补充最有价值的一点。',
  stage2Name: '基本成形',
  stage2Explanation: '已覆盖多个方面，相关事情不必反复从头介绍。',
  stage3Name: '持续完善',
  stage3Explanation: '已有较完整的了解，之后主要是按你的使用继续校准。',
  firstMaterialLead: '如果你愿意，可以提供一组能说明背景或表达方式的资料。',
  boundaryOutbound: '内容不会未经确认自动对外发送',
  boundaryDecisions: '重要决定和高风险动作由本人最终确认',
  boundaryLearning: '未被采用且不满足学习条件的内容不自动成为长期个人经验',
} as const;

export const GROWTH_FORBIDDEN_TERMS = [
  '修炼',
  '境界',
  '功法',
  '历练',
  '突破',
  '灵力',
  '飞升',
  '渡劫',
  '养成',
  '升级打怪',
  '经验值',
  '连续打卡',
  '徽章',
  '排行榜',
  '未启动',
  '完成第一件真实任务',
] as const;

const TASK_COPY: Record<GrowthTaskKey, { title: string; purpose: string; actionLabel: string }> = {
  continue_conversation: {
    title: '通过对话补充当前最需要的信息',
    purpose: '用你自己的话说明近况、偏好或判断，不必先完成一件任务。',
    actionLabel: '继续了解我',
  },
  add_representative_material: {
    title: '提供资料',
    purpose: '用你自己的材料补充背景，这是自愿的。',
    actionLabel: '添加资料',
  },
  answer_short_form: {
    title: '回答简短问题或表单',
    purpose: '用一两句话写下你愿意补充的内容。',
    actionLabel: '写下补充',
  },
  optional_learn_from_work: {
    title: '通过实际经历或任务让我了解你',
    purpose: '这不是必经步骤，只是让我从真实工作中了解你的一种方式。',
    actionLabel: '去做事',
  },
  resolve_important_conflict: {
    title: '确认一项需要你判断的信息',
    purpose: '有一条信息存在冲突或不够确定，需要你本人判断。',
    actionLabel: '去确认',
  },
};

export interface GrowthWorkItem {
  taskId: string;
  goal: string;
  createdAt?: string;
  contextRefCount: number;
  snapshotItemCount: number;
  injectedEventIds: string[];
  accepted: boolean;
  acceptedAt?: string;
  qualityPassed?: boolean;
}

export interface GrowthCollabItem {
  hasGrant: boolean;
  hasDivision: boolean;
  hasReturnedResult: boolean;
}

export interface GrowthEvidence {
  identityDisplayName: string;
  identityDescription?: string;
  derived: SubjectDerivedBundle;
  events: GrowthEvent[];
  materials: Array<{ materialRef: string; fileName: string; addedAt?: string }>;
  workItems: GrowthWorkItem[];
  collabItems: GrowthCollabItem[];
  now?: string;
}

export interface GrowthGateFlags {
  hasIdentity: boolean;
  hasGoal: boolean;
  hasBoundaries: boolean;
  hasDefaultBoundaries: boolean;
  hasSourcedSelfKnowledge: boolean;
  hasValidGrowthRecord: boolean;
  hasAcceptedResult: boolean;
  usedPersonalContext: boolean;
  hasAuthoritativePersonalMaterial: boolean;
  hasCallableSourcedFact: boolean;
  blockingConflict: boolean;
  hasBehaviorCalibratedPreference: boolean;
  preferenceReusedAndAccepted: boolean;
  hasControlledCollab: boolean;
}

export interface DimensionCoverageItem {
  key: GrowthDimensionKey;
  name: string;
  meaning: string;
  status: GrowthDimensionStatus;
  summary: string;
  sensitivity: 'low' | 'medium' | 'high';
}

export interface UserFacingGrowthTask {
  key: GrowthTaskKey;
  title: string;
  purpose: string;
  actionLabel: string;
  primary: boolean;
  optional?: boolean;
}

export interface UserFacingGrowthSnapshot {
  stageLevel: GrowthStageLevel;
  stageName: string;
  stageExplanation: string;
  needsCalibration: boolean;
  laterStagesNote: string;
  tracks: Record<GrowthTrackKey, { name: string; status: string; statusKey: GrowthTrackStatus }>;
  latestGrowth: { text: string } | null;
  nextTasks: UserFacingGrowthTask[];
  primaryTask: UserFacingGrowthTask | null;
  otherTasks: UserFacingGrowthTask[];
  otherWays: UserFacingGrowthTask[];
  conversationExamples: string[];
  nextGap: { title: string; purpose: string } | null;
  guidedQuestion: { dimensionKey: GrowthDimensionKey; text: string } | null;
  cockpit: GrowthCockpitView;
  dimensionGroups: {
    known: Array<{ key: string; name: string; summary: string }>;
    partial: Array<{ key: string; name: string; summary: string }>;
    unknown: Array<{ key: string; name: string; summary: string }>;
  };
  detail: {
    why: string;
    capabilities: string[];
    unverified: string[];
    nextStageNeed: string;
  };
  basis: { items: string[] };
  showFirstStart: boolean;
  continueTasks: Array<{ taskId: string; goal: string }>;
  actionHints: {
    latestAcceptedTaskId?: string;
    latestAcceptedGoal?: string;
  };
}

export interface GrowthCockpitView {
  knownCount: number;
  knownPreview: Array<{ key: string; name: string; summary: string }>;
  knownHasMore: boolean;
  gaps: Array<{ dimensionKey: GrowthDimensionKey; name: string; question: string }>;
  materials: {
    total: number;
    byKind: Array<{ label: string; count: number }>;
    recent: Array<{ fileName: string }>;
  };
}

const STAGE_REACHED_PREFIX = 'captureKey:growth:stage_reached:';
const CURRENT_GOAL_KEY = 'captureKey:growth:current_goal';
const BASIC_BOUNDARIES_KEY = 'captureKey:growth:basic_boundaries';
const FOUNDATION_CORE: GrowthDimensionKey[] = ['identity', 'background', 'current_state', 'goals'];

export function isStageReachedTag(tag: string): boolean {
  return tag.startsWith(STAGE_REACHED_PREFIX);
}

export function stageReachedCaptureKey(level: 1 | 2 | 3): string {
  return `growth:stage_reached:${level}`;
}

function hasTag(event: GrowthEvent, tag: string): boolean {
  return (event.payload.tags ?? []).includes(tag);
}

function isDecisionAccept(event: GrowthEvent): boolean {
  return hasTag(event, 'decision:accept');
}

function isStageAudit(event: GrowthEvent): boolean {
  return (event.payload.tags ?? []).some((t) => isStageReachedTag(t));
}

function isNoop(event: GrowthEvent): boolean {
  return hasTag(event, 'capture:noop') || isStageAudit(event);
}

function inactiveSet(derived: SubjectDerivedBundle): Set<string> {
  return new Set(derived.inactiveEventIds);
}

function isTrustedGrowthSource(event: GrowthEvent): boolean {
  if (isNoop(event)) return false;
  const tags = event.payload.tags ?? [];
  if (tags.includes('model_guess') || tags.includes('unverified_guess')) return false;
  const kind = event.source.kind;
  if (kind === 'owner_direct' || kind === 'artifact_edit' || kind === 'task_feedback') return true;
  if (event.payload.relation?.materialRef) return true;
  return tags.some(
    (tag) =>
      tag === 'from_material' ||
      tag === 'owner_adopt' ||
      tag === 'decision:accept' ||
      tag === 'from_revision' ||
      tag === CURRENT_GOAL_KEY ||
      tag === BASIC_BOUNDARIES_KEY,
  );
}

function isSourcedSelfKnowledgeEvent(event: GrowthEvent, inactive: Set<string>): boolean {
  if (inactive.has(event.id)) return false;
  if (!isTrustedGrowthSource(event)) return false;
  const knowledgeType =
    event.type === 'identity_clarified' ||
    event.type === 'goal_updated' ||
    event.type === 'preference_observed' ||
    event.type === 'principle_stated' ||
    event.type === 'experience_confirmed' ||
    event.type === 'asset_added' ||
    event.type === 'boundary_updated';
  if (!knowledgeType) return false;
  if (event.confidence === 'confirmed') return true;
  return event.source.kind === 'owner_direct' || event.source.kind === 'task_feedback';
}

function hasNonPlaceholderIdentity(evidence: GrowthEvidence): boolean {
  const name = evidence.identityDisplayName.trim();
  if (name && name !== GROWTH_COPY.placeholderIdentityName) return true;
  return !!(evidence.identityDescription && evidence.identityDescription.trim());
}

function sanitizeSummary(text: string, fallback: string): string {
  const value = String(text || '').trim();
  if (!value || isInternalGrowthPhrase(value)) return fallback;
  return value.slice(0, 80);
}

function dimensionFromEvent(event: GrowthEvent): GrowthDimensionKey | null {
  if (isNoop(event) || event.type === 'knowledge_gap_noted' || event.type === 'subject_corrected') {
    return null;
  }
  const tagged = (event.payload.tags ?? [])
    .map((tag) => (tag.startsWith('growth:dimension:') ? tag.slice('growth:dimension:'.length) : ''))
    .find((key) => dimensionByKey(key));
  if (tagged) return tagged as GrowthDimensionKey;
  const blob = `${event.payload.title || ''} ${event.payload.detail || ''} ${(event.payload.tags || []).join(' ')}`.toLowerCase();
  if (event.type === 'identity_clarified') return 'identity';
  if (event.type === 'goal_updated') return 'goals';
  if (event.type === 'boundary_updated') return 'boundaries';
  if (event.type === 'principle_stated') return 'values';
  if (event.type === 'asset_added') return 'background';
  if (event.type === 'preference_observed') {
    if (/表达|语气|结论先行|先写结论|沟通/.test(blob)) return 'communication';
    return 'preferences';
  }
  if (event.type === 'experience_confirmed' || event.type === 'feedback_recorded') {
    if (hasTag(event, 'decision:accept') || hasTag(event, 'decision:reject') || hasTag(event, 'from_revision')) {
      return 'methods';
    }
    if (/原则|判断/.test(blob)) return 'values';
    return null;
  }
  return null;
}

export function inspectGrowthGates(evidence: GrowthEvidence): GrowthGateFlags {
  const { derived, events, materials, workItems, collabItems } = evidence;
  const inactive = inactiveSet(derived);

  const hasIdentity = hasNonPlaceholderIdentity(evidence) || derived.identity.entries.length > 0;

  const hasGoal =
    derived.goals.entries.length > 0 ||
    events.some(
      (e) =>
        e.type === 'goal_updated' &&
        e.confidence === 'confirmed' &&
        !inactive.has(e.id) &&
        isTrustedGrowthSource(e),
    );

  const acceptedWork = workItems.filter((w) => w.accepted || w.qualityPassed);
  const acceptedFromEvents = events.filter(
    (e) => e.confidence === 'confirmed' && isDecisionAccept(e) && !inactive.has(e.id),
  );
  const hasAcceptedResult = acceptedWork.length > 0 || acceptedFromEvents.length > 0;

  const hasDefaultBoundaries = true;
  const hasBoundaries =
    hasDefaultBoundaries ||
    derived.boundaries.entries.length > 0 ||
    events.some(
      (e) =>
        e.type === 'boundary_updated' &&
        e.confidence === 'confirmed' &&
        !inactive.has(e.id),
    ) ||
    events.some((e) => (e.payload.tags ?? []).includes(BASIC_BOUNDARIES_KEY) && !inactive.has(e.id));

  const personalizedAccepted = acceptedWork.filter(
    (w) => w.contextRefCount > 0 || w.snapshotItemCount > 0 || w.injectedEventIds.length > 0,
  );
  const usedPersonalContext = personalizedAccepted.length > 0;

  const hasAuthoritativePersonalMaterial = materials.length > 0;
  const sourcedFromEvents = events.some(
    (e) =>
      e.confidence === 'confirmed' &&
      !inactive.has(e.id) &&
      (e.type === 'asset_added' || !!e.payload.relation?.materialRef) &&
      !isNoop(e),
  );
  const hasCallableSourcedFact =
    hasAuthoritativePersonalMaterial &&
    (sourcedFromEvents ||
      derived.activeItems.some(
        (item) => item.kind === 'identity' || item.kind === 'preference' || item.kind === 'experience',
      ) ||
      derived.identity.entries.length > 0 ||
      derived.confirmed.entries.length > 0);

  const blockingConflict =
    derived.activeItems.some((item) => item.tags.includes('conflict')) ||
    derived.candidates.entries.some((e) => e.tags.includes('conflict'));

  const calibratedPrefs = events.filter((e) => isBehaviorCalibratedPreference(e, inactive));
  const hasBehaviorCalibratedPreference = calibratedPrefs.length > 0;

  const preferenceReusedAndAccepted = calibratedPrefs.some((pref) => {
    const later = workItems.filter((w) => {
      if (!w.injectedEventIds.includes(pref.id)) return false;
      if (!(w.accepted || w.qualityPassed)) return false;
      if (!pref.occurredAt || !w.createdAt) return true;
      return w.createdAt > pref.occurredAt;
    });
    return later.length > 0;
  });

  const hasControlledCollab = collabItems.some(
    (c) => c.hasGrant && c.hasDivision && c.hasReturnedResult,
  );

  const hasSourcedSelfKnowledge =
    hasNonPlaceholderIdentity(evidence) ||
    events.some((e) => isSourcedSelfKnowledgeEvent(e, inactive));
  const hasValidGrowthRecord = events.some(
    (e) => e.confidence === 'confirmed' && !inactive.has(e.id) && isTrustedGrowthSource(e) && !isNoop(e),
  );

  return {
    hasIdentity,
    hasGoal,
    hasBoundaries,
    hasDefaultBoundaries,
    hasSourcedSelfKnowledge,
    hasValidGrowthRecord,
    hasAcceptedResult,
    usedPersonalContext,
    hasAuthoritativePersonalMaterial,
    hasCallableSourcedFact,
    blockingConflict,
    hasBehaviorCalibratedPreference,
    preferenceReusedAndAccepted,
    hasControlledCollab,
  };
}

function isBehaviorCalibratedPreference(event: GrowthEvent, inactive: Set<string>): boolean {
  if (inactive.has(event.id)) return false;
  if (event.confidence !== 'confirmed') return false;
  if (isNoop(event)) return false;
  const tags = event.payload.tags ?? [];
  if (tags.includes('model_guess') || tags.includes('unverified_guess')) return false;
  const fromBehavior =
    event.source.kind === 'artifact_edit' ||
    event.source.kind === 'task_feedback' ||
    tags.includes('decision:accept') ||
    tags.includes('decision:reject') ||
    tags.includes('correction') ||
    tags.includes('from_revision') ||
    tags.includes('owner_adopt');
  if (!fromBehavior) return false;
  return (
    event.type === 'preference_observed' ||
    event.type === 'experience_confirmed' ||
    event.type === 'principle_stated' ||
    event.type === 'boundary_updated' ||
    event.type === 'feedback_recorded'
  );
}

function guideChoicesOf(events: GrowthEvent[]): Array<{
  dimension: GrowthDimensionKey;
  action: GrowthGuideChoice;
  occurredAt: string;
}> {
  const out: Array<{ dimension: GrowthDimensionKey; action: GrowthGuideChoice; occurredAt: string }> = [];
  for (const event of events) {
    const keyTag = (event.payload.tags ?? []).find((tag) => tag.startsWith(`captureKey:${GUIDE_CHOICE_PREFIX}`));
    const parsed = keyTag ? parseGuideChoiceCaptureKey(keyTag.slice('captureKey:'.length)) : null;
    if (!parsed) continue;
    out.push({ ...parsed, occurredAt: event.occurredAt });
  }
  return out.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function inspectDimensionCoverage(evidence: GrowthEvidence): DimensionCoverageItem[] {
  const gates = inspectGrowthGates(evidence);
  const inactive = inactiveSet(evidence.derived);
  const hits = new Map<GrowthDimensionKey, { known: boolean; partial: boolean; summary: string }>();
  const mark = (key: GrowthDimensionKey, known: boolean, summary: string) => {
    const prev = hits.get(key) || { known: false, partial: false, summary: '' };
    hits.set(key, {
      known: prev.known || known,
      partial: prev.partial || !known,
      summary: prev.summary || summary,
    });
  };

  if (hasNonPlaceholderIdentity(evidence) || evidence.derived.identity.entries.length > 0) {
    const entry = evidence.derived.identity.entries[0];
    mark(
      'identity',
      true,
      sanitizeSummary(entry?.title || evidence.identityDisplayName, '已有基本身份信息'),
    );
  }
  if (gates.hasGoal || evidence.derived.goals.entries.length > 0) {
    const entry = evidence.derived.goals.entries[0];
    mark('goals', true, sanitizeSummary(entry?.title || entry?.detail || '', '已有当前目标'));
  }
  if (evidence.derived.boundaries.entries.length > 0) {
    mark('boundaries', true, '已明确基本使用边界');
  }
  if (evidence.materials.length > 0 || evidence.derived.assets.entries.length > 0) {
    mark('background', true, '已有可继续使用的资料或背景');
  }
  if (evidence.collabItems.some((c) => c.hasGrant)) {
    mark('relations', true, '已有受你授权的协作关系');
  }

  for (const event of evidence.events) {
    if (inactive.has(event.id) || isNoop(event)) continue;
    const dim = dimensionFromEvent(event);
    if (!dim) continue;
    if (!isSourcedSelfKnowledgeEvent(event, inactive) && event.confidence !== 'confirmed') {
      if (isTrustedGrowthSource(event)) {
        mark(dim, false, sanitizeSummary(event.payload.title, dimensionByKey(dim)?.meaning || ''));
      }
      continue;
    }
    mark(dim, event.confidence === 'confirmed' || isSourcedSelfKnowledgeEvent(event, inactive), sanitizeSummary(event.payload.title, dimensionByKey(dim)?.meaning || ''));
  }

  return GROWTH_DIMENSIONS.map((def) => {
    const hit = hits.get(def.key);
    let status: GrowthDimensionStatus = 'unknown';
    if (hit?.known) status = 'known';
    else if (hit?.partial) status = 'partial';
    return {
      key: def.key,
      name: def.name,
      meaning: def.meaning,
      status,
      summary: status === 'unknown' ? '暂未了解' : hit?.summary || def.meaning,
      sensitivity: def.sensitivity,
    };
  });
}

export function deriveGrowthStageFromCoverage(
  coverage: DimensionCoverageItem[],
  gates: GrowthGateFlags,
): GrowthStageLevel {
  const known = coverage.filter((item) => item.status === 'known').map((item) => item.key);
  const unique = new Set(known);
  const started =
    unique.size > 0 ||
    gates.hasSourcedSelfKnowledge ||
    gates.hasValidGrowthRecord;
  if (!started) return 0;

  const coreKnown = known.filter((key) => FOUNDATION_CORE.includes(key));
  const formed =
    unique.size >= 3 &&
    coreKnown.length >= 1 &&
    !gates.blockingConflict;
  const ongoing =
    formed &&
    unique.size >= 5 &&
    (gates.hasBehaviorCalibratedPreference || coverage.some((item) => item.key === 'values' && item.status === 'known'));
  if (ongoing) return 3;
  if (formed) return 2;
  return 1;
}

/** 无覆盖明细时的保守下限：有来源信息即至少「基础建立」，不因做过任务而抬级。 */
export function deriveGrowthStage(gates: GrowthGateFlags): GrowthStageLevel {
  if (!gates.hasSourcedSelfKnowledge && !gates.hasValidGrowthRecord && !gates.hasIdentity) return 0;
  return 1;
}

function lastSourcedKnowledgeAt(events: GrowthEvent[]): string | undefined {
  return [...events]
    .filter((e) => !isNoop(e) && isTrustedGrowthSource(e) && e.type !== 'feedback_recorded')
    .map((e) => e.occurredAt)
    .sort()
    .at(-1);
}

/** 换题或不用于长期了解：自上次真实学习后，当前会话内不马上再问。 */
function immediateBlockedDimensions(events: GrowthEvent[]): Set<GrowthDimensionKey> {
  const lastSourcedAt = lastSourcedKnowledgeAt(events);
  const blocked = new Set<GrowthDimensionKey>();
  for (const choice of guideChoicesOf(events)) {
    if (choice.action !== 'switch' && choice.action !== 'nolearn') continue;
    if (lastSourcedAt && lastSourcedAt > choice.occurredAt) continue;
    blocked.add(choice.dimension);
  }
  return blocked;
}

/** 稍后再聊：只要还有其他可问缺口，近期引导（含重启）都不主动再问。 */
function laterOpenDimensions(events: GrowthEvent[]): Set<GrowthDimensionKey> {
  const latest = new Map<GrowthDimensionKey, GrowthGuideChoice>();
  for (const choice of guideChoicesOf(events)) {
    latest.set(choice.dimension, choice.action);
  }
  const later = new Set<GrowthDimensionKey>();
  for (const [dimension, action] of latest) {
    if (action === 'later') later.add(dimension);
  }
  return later;
}

function materialKindLabel(fileName: string): string {
  const ext = String(fileName || '')
    .toLowerCase()
    .replace(/^.*(\.[a-z0-9]+)$/i, '$1');
  if (['.md', '.txt', '.pdf', '.doc', '.docx', '.rtf'].includes(ext)) return '文档';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return '表格';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return '图片';
  if (['.ppt', '.pptx'].includes(ext)) return '演示文稿';
  return '其他';
}

function rankedUnknownDimensions(coverage: DimensionCoverageItem[]): typeof GROWTH_DIMENSIONS[number][] {
  const knownCount = coverage.filter((item) => item.status === 'known').length;
  return [...GROWTH_DIMENSIONS]
    .sort((a, b) => a.askPriority - b.askPriority)
    .filter((def) => {
      const item = coverage.find((row) => row.key === def.key);
      if (!item || item.status === 'known') return false;
      if (def.sensitivity === 'high' && knownCount < 4) return false;
      if (def.sensitivity === 'medium' && knownCount < 2) return false;
      return true;
    });
}

export function deriveGrowthCockpit(
  coverage: DimensionCoverageItem[],
  events: GrowthEvent[],
  materials: GrowthEvidence['materials'],
  derived: SubjectDerivedBundle,
): GrowthCockpitView {
  // 01B：cockpit「已经了解」= 唯一的用户可见事实投影（具体事实及其具体值），
  // 与页面「已经了解」、对话模型上下文逐项相等。维度覆盖仅用于缺口排序/门控，不上 known 展示。
  const known = buildUserVisibleFacts(derived).map((f) => ({
    key: f.kind,
    name: f.title,
    summary: f.detail,
  }));
  const laterOpen = laterOpenDimensions(events);
  const switched = immediateBlockedDimensions(events);
  const gaps = rankedUnknownDimensions(coverage)
    .filter((def) => !laterOpen.has(def.key) && !switched.has(def.key))
    .slice(0, 4)
    .map((def) => ({ dimensionKey: def.key, name: def.name, question: def.question }));
  const kindCounts = new Map<string, number>();
  for (const material of materials) {
    const label = materialKindLabel(material.fileName);
    kindCounts.set(label, (kindCounts.get(label) || 0) + 1);
  }
  const recent = [...materials]
    .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
    .slice(0, 4)
    .map((item) => ({ fileName: item.fileName }));
  return {
    knownCount: known.length,
    knownPreview: known.slice(0, 4),
    knownHasMore: known.length > 4,
    gaps,
    materials: {
      total: materials.length,
      byKind: [...kindCounts.entries()].map(([label, count]) => ({ label, count })),
      recent,
    },
  };
}

export function selectGuidedQuestion(
  coverage: DimensionCoverageItem[],
  events: GrowthEvent[],
  options?: { preferDimension?: GrowthDimensionKey },
): { dimensionKey: GrowthDimensionKey; text: string } | null {
  const preferred = options?.preferDimension ? dimensionByKey(options.preferDimension) : undefined;
  if (preferred) {
    const item = coverage.find((row) => row.key === preferred.key);
    if (item && item.status !== 'known') {
      return { dimensionKey: preferred.key, text: preferred.question };
    }
  }

  const choices = guideChoicesOf(events);
  const lastChoice = choices[choices.length - 1];
  const switched = immediateBlockedDimensions(events);
  const laterOpen = laterOpenDimensions(events);
  const lastWasSensitive = lastChoice
    ? dimensionByKey(lastChoice.dimension)?.sensitivity !== 'low'
    : false;

  const eligible = rankedUnknownDimensions(coverage).filter((def) => {
    if (lastWasSensitive && def.sensitivity !== 'low') return false;
    if (switched.has(def.key)) return false;
    return true;
  });
  const nonLater = eligible.filter((def) => !laterOpen.has(def.key));
  const pick = nonLater[0] || eligible.find((def) => def.sensitivity === 'low') || eligible[0];
  if (pick) return { dimensionKey: pick.key, text: pick.question };

  const fallback = [...GROWTH_DIMENSIONS]
    .sort((a, b) => a.askPriority - b.askPriority)
    .find((def) => coverage.find((row) => row.key === def.key)?.status !== 'known' && def.sensitivity === 'low');
  return fallback ? { dimensionKey: fallback.key, text: fallback.question } : null;
}

function trackStatus(pending: boolean, started: boolean, stable: boolean): GrowthTrackStatus {
  if (stable) return 'stable';
  if (started) return 'started';
  if (pending) return 'pending';
  return 'pending';
}

function trackLabel(status: GrowthTrackStatus): string {
  if (status === 'stable') return GROWTH_COPY.trackStable;
  if (status === 'started') return GROWTH_COPY.trackStarted;
  return GROWTH_COPY.trackPending;
}

function stageMeta(level: GrowthStageLevel): { name: string; explanation: string } {
  if (level === 3) return { name: GROWTH_COPY.stage3Name, explanation: GROWTH_COPY.stage3Explanation };
  if (level === 2) return { name: GROWTH_COPY.stage2Name, explanation: GROWTH_COPY.stage2Explanation };
  if (level === 1) return { name: GROWTH_COPY.stage1Name, explanation: GROWTH_COPY.stage1Explanation };
  return { name: GROWTH_COPY.stage0Name, explanation: GROWTH_COPY.stage0Explanation };
}

export function recommendGrowthTasks(
  stage: GrowthStageLevel,
  gates: GrowthGateFlags,
): GrowthTaskKey[] {
  const keys: GrowthTaskKey[] = ['continue_conversation'];
  if (gates.blockingConflict) keys.unshift('resolve_important_conflict');
  if (stage < 0) return keys;
  return keys.slice(0, 1);
}

function needsCalibration(evidence: GrowthEvidence, gates: GrowthGateFlags): boolean {
  if (gates.blockingConflict) return true;
  const now = evidence.now ? new Date(evidence.now) : new Date();
  const expiredActive = evidence.events.some(
    (e) =>
      e.confidence === 'confirmed' &&
      isExpiredByTags(e.payload.tags ?? [], now) &&
      (e.type === 'identity_clarified' ||
        e.type === 'preference_observed' ||
        e.type === 'goal_updated' ||
        e.type === 'experience_confirmed'),
  );
  return expiredActive || evidence.derived.activeItems.some((item) => item.tags.includes('conflict'));
}

function buildDetail(
  stage: GrowthStageLevel,
  coverage: DimensionCoverageItem[],
): UserFacingGrowthSnapshot['detail'] {
  const known = coverage.filter((item) => item.status === 'known');
  const unknown = coverage.filter((item) => item.status === 'unknown');
  const capabilities = known.slice(0, 6).map((item) => item.name);
  const unverified = unknown.slice(0, 6).map((item) => item.name);
  let why: string = GROWTH_COPY.stage0Explanation;
  let nextStageNeed = '通过对话留下至少一项来源明确的本人信息。';
  if (stage === 1) {
    why = GROWTH_COPY.stage1Explanation;
    nextStageNeed = '再补充两三个方面，例如背景、目标或偏好。';
  } else if (stage === 2) {
    why = GROWTH_COPY.stage2Explanation;
    nextStageNeed = '继续按你愿意分享的内容校准表达方式和判断原则。';
  } else if (stage === 3) {
    why = GROWTH_COPY.stage3Explanation;
    nextStageNeed = '之后按你的使用继续完善即可，不必一次补完。';
  }
  return { why, capabilities, unverified, nextStageNeed };
}

function toTask(key: GrowthTaskKey, primary: boolean, optional = false): UserFacingGrowthTask {
  const copy = TASK_COPY[key];
  return {
    key,
    title: copy.title,
    purpose: copy.purpose,
    actionLabel: copy.actionLabel,
    primary,
    ...(optional ? { optional: true } : {}),
  };
}

export function deriveGrowthProfile(evidence: GrowthEvidence): UserFacingGrowthSnapshot {
  const gates = inspectGrowthGates(evidence);
  const coverage = inspectDimensionCoverage(evidence);
  const stage = deriveGrowthStageFromCoverage(coverage, gates);
  const meta = stageMeta(stage);
  const represent = trackStatus(
    !gates.hasSourcedSelfKnowledge && !gates.hasIdentity,
    gates.hasSourcedSelfKnowledge || gates.hasIdentity,
    gates.hasAuthoritativePersonalMaterial && gates.hasBehaviorCalibratedPreference,
  );
  const work = trackStatus(
    !gates.hasAcceptedResult,
    gates.hasAcceptedResult,
    gates.preferenceReusedAndAccepted || (gates.hasAcceptedResult && gates.usedPersonalContext && stage >= 2),
  );
  const collabStatus: GrowthTrackStatus = gates.hasControlledCollab ? 'started' : 'pending';
  const primaryTask = toTask(gates.blockingConflict ? 'resolve_important_conflict' : 'continue_conversation', true);
  const otherWays = [
    toTask('add_representative_material', false),
    toTask('answer_short_form', false),
    toTask('optional_learn_from_work', false, true),
  ];
  const guidedQuestion = selectGuidedQuestion(coverage, evidence.events);
  const cockpit = deriveGrowthCockpit(coverage, evidence.events, evidence.materials, evidence.derived);
  const nextGap = guidedQuestion
    ? {
        title: dimensionByKey(guidedQuestion.dimensionKey)?.name || GROWTH_COPY.nextSteps,
        purpose: guidedQuestion.text,
      }
    : {
        title: GROWTH_COPY.nextSteps,
        purpose: '如果你愿意，可以继续告诉我任何你希望被了解的事。',
      };

  const continueTasks = evidence.workItems
    .filter((w) => !w.accepted && w.goal.trim())
    .slice(0, 5)
    .map((w) => ({ taskId: w.taskId, goal: w.goal }));
  const latestAccepted = [...evidence.workItems]
    .filter((w) => w.accepted && w.goal.trim())
    .sort((a, b) =>
      String(b.acceptedAt || b.createdAt || '').localeCompare(String(a.acceptedAt || a.createdAt || '')),
    )[0];

  const groups = {
    known: coverage
      .filter((item) => item.status === 'known')
      .map((item) => ({ key: item.key, name: item.name, summary: item.summary })),
    partial: coverage
      .filter((item) => item.status === 'partial')
      .map((item) => ({ key: item.key, name: item.name, summary: item.summary })),
    unknown: coverage
      .filter((item) => item.status === 'unknown')
      .map((item) => ({ key: item.key, name: item.name, summary: item.meaning })),
  };

  return {
    stageLevel: stage,
    stageName: meta.name,
    stageExplanation: meta.explanation,
    needsCalibration: needsCalibration(evidence, gates),
    laterStagesNote: GROWTH_COPY.laterStages,
    tracks: {
      represent: { name: GROWTH_COPY.represent, status: trackLabel(represent), statusKey: represent },
      work: { name: GROWTH_COPY.work, status: trackLabel(work), statusKey: work },
      collab: { name: GROWTH_COPY.collab, status: trackLabel(collabStatus), statusKey: collabStatus },
    },
    latestGrowth: null,
    nextTasks: [primaryTask],
    primaryTask,
    otherTasks: otherWays,
    otherWays,
    conversationExamples: [],
    nextGap,
    guidedQuestion,
    cockpit,
    dimensionGroups: groups,
    detail: buildDetail(stage, coverage),
    basis: { items: [] },
    showFirstStart: false,
    continueTasks,
    actionHints: {
      ...(latestAccepted?.taskId ? { latestAcceptedTaskId: latestAccepted.taskId } : {}),
      ...(latestAccepted?.goal ? { latestAcceptedGoal: latestAccepted.goal } : {}),
    },
  };
}

export function collectGrowthCopyValues(): string[] {
  const values: string[] = [...Object.values(GROWTH_COPY)];
  for (const item of Object.values(TASK_COPY)) {
    values.push(item.title, item.purpose, item.actionLabel);
  }
  for (const stage of GROWTH_STAGE_GUIDE) {
    values.push(stage.name, stage.meaning);
  }
  for (const dim of GROWTH_DIMENSIONS) {
    values.push(dim.name, dim.meaning, dim.question);
  }
  return values;
}
