/**
 * 数字之我结构化维度 — 静态规则配置，不是用户事实源。
 * 事实仍从 Package / GrowthEvent / materials / 确认与反馈派生。
 */
export const GUIDE_CHOICE_PREFIX = 'growth:guide_choice:';

export type GrowthDimensionKey =
  | 'identity'
  | 'background'
  | 'current_state'
  | 'goals'
  | 'preferences'
  | 'values'
  | 'communication'
  | 'methods'
  | 'relations'
  | 'boundaries';

export type GrowthDimensionSensitivity = 'low' | 'medium' | 'high';

export type GrowthDimensionStatus = 'known' | 'partial' | 'unknown';

/** 当前引导控制。skip/decline 仅用于读取历史 noop 事件。 */
export type GrowthGuideChoice = 'switch' | 'later' | 'nolearn';
export type GrowthGuideChoiceStored = GrowthGuideChoice | 'skip' | 'decline';

export interface GrowthDimensionDefinition {
  key: GrowthDimensionKey;
  name: string;
  meaning: string;
  sensitivity: GrowthDimensionSensitivity;
  question: string;
  askPriority: number;
}

export const GROWTH_DIMENSIONS: readonly GrowthDimensionDefinition[] = [
  {
    key: 'identity',
    name: '基本身份',
    meaning: '你希望数字之我如何认识你，包括称呼与角色。',
    sensitivity: 'low',
    question: '方便的话，可以怎么称呼你，或者你希望我怎样认识你？',
    askPriority: 10,
  },
  {
    key: 'current_state',
    name: '当前状态',
    meaning: '你最近在做什么、处在什么情境。',
    sensitivity: 'low',
    question: '你最近这段时间主要在忙什么？',
    askPriority: 20,
  },
  {
    key: 'goals',
    name: '目标与意图',
    meaning: '你当前最希望完成或推进的事。',
    sensitivity: 'low',
    question: '你最近最希望我帮你记住或一起推进的事是什么？',
    askPriority: 30,
  },
  {
    key: 'background',
    name: '经历与背景',
    meaning: '与你相关的经历、项目或背景资料。',
    sensitivity: 'low',
    question: '有没有一段经历或一份资料，能帮助我更准确地理解你的背景？',
    askPriority: 40,
  },
  {
    key: 'preferences',
    name: '兴趣与偏好',
    meaning: '你习惯的取舍、兴趣和日常偏好。',
    sensitivity: 'low',
    question: '处理事情时，你有没有特别希望我记住的习惯或偏好？',
    askPriority: 50,
  },
  {
    key: 'communication',
    name: '表达与沟通方式',
    meaning: '你希望数字之我如何说话、如何组织内容。',
    sensitivity: 'low',
    question: '你希望我在表达时注意什么，例如先说结论，还是把依据写清楚？',
    askPriority: 60,
  },
  {
    key: 'methods',
    name: '能力与做事方法',
    meaning: '你做事时看重的方法和判断。',
    sensitivity: 'low',
    question: '你做一类任务时，通常最看重哪一步或哪种做法？',
    askPriority: 70,
  },
  {
    key: 'values',
    name: '价值观与判断原则',
    meaning: '对你重要的原则和取舍标准。',
    sensitivity: 'medium',
    question: '有没有一条你希望我始终遵守的原则？不想说也可以跳过。',
    askPriority: 80,
  },
  {
    key: 'boundaries',
    name: '授权、隐私和使用边界',
    meaning: '哪些事需要你本人决定，哪些信息不要自动使用。',
    sensitivity: 'medium',
    question: '有没有哪些信息或动作，你希望我必须先问过你再处理？',
    askPriority: 90,
  },
  {
    key: 'relations',
    name: '重要关系与组织',
    meaning: '对你工作或协作有影响的人或组织。',
    sensitivity: 'high',
    question: '有没有经常一起工作的人或团队，是你希望我了解的？不想说也可以跳过。',
    askPriority: 100,
  },
] as const;

export const GROWTH_STAGE_GUIDE: Array<{ level: 0 | 1 | 2 | 3; name: string; meaning: string }> = [
  { level: 0, name: '未开始', meaning: '数字之我还缺少来源明确的本人信息。' },
  { level: 1, name: '基础建立', meaning: '已有若干来源明确的本人信息，可以开始按你的情况工作。' },
  { level: 2, name: '基本成形', meaning: '已覆盖多个核心方面，相关事情不必反复从头介绍。' },
  { level: 3, name: '持续完善', meaning: '已有较完整的了解，之后主要是按你的使用继续校准。' },
];

export function dimensionByKey(key: string): GrowthDimensionDefinition | undefined {
  return GROWTH_DIMENSIONS.find((item) => item.key === key);
}

export function guideChoiceCaptureKey(
  dimension: GrowthDimensionKey,
  action: GrowthGuideChoiceStored,
): string {
  return `${GUIDE_CHOICE_PREFIX}${dimension}:${action}`;
}

function normalizeGuideChoice(action: string): GrowthGuideChoice | null {
  if (action === 'skip' || action === 'switch') return 'switch';
  if (action === 'decline' || action === 'later') return 'later';
  if (action === 'nolearn') return 'nolearn';
  return null;
}

export function parseGuideChoiceCaptureKey(
  captureKey: string,
): { dimension: GrowthDimensionKey; action: GrowthGuideChoice } | null {
  if (!captureKey.startsWith(GUIDE_CHOICE_PREFIX)) return null;
  const rest = captureKey.slice(GUIDE_CHOICE_PREFIX.length);
  const idx = rest.lastIndexOf(':');
  if (idx <= 0) return null;
  const dimension = rest.slice(0, idx);
  const action = normalizeGuideChoice(rest.slice(idx + 1));
  if (!GROWTH_DIMENSIONS.some((item) => item.key === dimension) || !action) return null;
  return { dimension: dimension as GrowthDimensionKey, action };
}

export function isInternalGrowthPhrase(text: string): boolean {
  const value = String(text || '');
  return /本次成果未采用|本次成果已采用|尚未决定|修补采用内容|建议采用|建议继续修改|可试用|开发中|\bcapture\b|\bfreeze\b|\bevent\b|GrowthEvent|Package|Artifact/i.test(
    value,
  );
}

/** 用户在这句话里明确表示本次不要进入长期了解。只认清楚的当场意图，不新增设置项。 */
export function isEphemeralConversationIntent(text: string): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  return /不要记住这段|别记住这段|别记这段|不要记住这个|不要把这段记下来|这件事不要长期记录|不要长期记录|不要长期了解|这次不要记住|不要记录这段|这次先不记录/.test(
    value,
  );
}
