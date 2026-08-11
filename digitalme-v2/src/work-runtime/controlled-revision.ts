/**
 * D11-D 受控修订闭环的纯决策逻辑。
 * 不读写存储、不保存提示词或模型思维链；仅保存可审计的结论与摘要。
 */

export const REVISION_ATTRIBUTIONS = [
  'tool_unavailable',
  'invalid_project_or_path',
  'permission_or_scope',
  'dependency_or_environment',
  'implementation_defect',
  'test_or_build_failure',
  'runtime_failure',
  'insufficient_evidence',
  'goal_ambiguity',
  'other',
] as const;

export type RevisionAttribution = (typeof REVISION_ATTRIBUTIONS)[number];
export type RevisionOutcome =
  | 'auto_revised'
  | 'scheme_changed'
  | 'paused'
  | 'awaiting_user'
  | 'completed';

export interface RevisionAttemptRecord {
  jobId: string;
  artifactVersionId?: string;
  at: string;
  attribution: RevisionAttribution;
  errorSignature: string;
  schemeFingerprint: string;
  revisionPlanExcerpt: string;
  outcome: RevisionOutcome;
  userFacingNote?: string;
}

export interface TaskRevisionLoopMeta {
  paused?: boolean;
  pauseReason?: string;
  lastHandledVersionId?: string;
  /** 真实 jobId，或 `pending:…` 占位（本身即可阻止并发认领）。 */
  inFlightJobId?: string;
  /** 与 inFlightJobId 对应的认领令牌；创建 Job 后替换为真实 id。 */
  claimToken?: string;
  /** 认领开始时间；用于重启后过期 pending 收敛。 */
  claimStartedAt?: string;
  attempts: RevisionAttemptRecord[];
  autoRoundCount: number;
}

/** 单任务自动修订轮次上限（须足以完成 2/3 刹车）。 */
export const DEFAULT_MAX_AUTO_REVISION_ROUNDS = 6;
/** 累计自动修订时长上限（毫秒）。 */
export const DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS = 45 * 60 * 1000;
/**
 * 单轮执行超时由 Coding Agent / external-executor 硬门承担（默认 600_000ms）。
 * 见 capability/adapters/external-executor-codex.ts defaultTimeoutMs。
 */
export const EXTERNAL_EXECUTOR_DEFAULT_TIMEOUT_MS = 600_000;
/** pending 认领过期阈值：超时且无 active Job 时可安全收敛。 */
export const DEFAULT_REVISION_CLAIM_STALE_MS = 2 * 60 * 1000;

export interface ControlledRevisionEvidence {
  decision: 'meets_plan' | 'needs_revision' | 'blocked' | 'insufficient_evidence' | string;
  revisionPlan?: string;
  checks?: Array<{ id?: string; verdict?: string; detail?: string }>;
  failureMessage?: string;
  failureStage?: string;
  changedFileCount?: number;
  agentSummary?: string;
  gaps?: string[];
  /** CTO 复核的下一步提示；need_decision 不得绕过用户确认。 */
  primaryAction?: string;
}

export type ControlledRevisionAction =
  | 'auto_revise'
  | 'auto_revise_new_scheme'
  | 'pause'
  | 'await_user'
  | 'stop_success'
  | 'noop';

export interface ControlledRevisionDecision {
  action: ControlledRevisionAction;
  attribution: RevisionAttribution;
  errorSignature: string;
  schemeFingerprint: string;
  consecutiveSameCause: number;
  userFacingNote: string;
  revisionRequest?: string;
  requireUserDecision?: boolean;
  stopReason?: string;
}

export interface ControlledRevisionInput {
  evidence: ControlledRevisionEvidence;
  confirmedPlanVersion?: number;
  hasConfirmedPlan: boolean;
  hasActiveJob: boolean;
  loop?: TaskRevisionLoopMeta;
  maxAutoRounds?: number;
  /** 累计已用时长（毫秒）；超出则暂停。 */
  cumulativeDurationMs?: number;
  maxCumulativeDurationMs?: number;
  modelAvailable: boolean;
  pausedByUser: boolean;
  cancelled: boolean;
}

/** 基于可复现失败事实构造稳定签名，不纳入时间、对象 ID 等易变数据。 */
export function buildErrorSignature(evidence: ControlledRevisionEvidence): string {
  const checkFacts = (evidence.checks ?? [])
    .map((check) =>
      [
        normalizeText(check.id),
        normalizeText(check.verdict),
        normalizeDetail(check.detail),
      ].join(':'),
    )
    .filter(Boolean)
    .sort()
    .join('|');
  const source = `${checkFacts}|${normalizeDetail(evidence.failureMessage)}|${normalizeText(
    evidence.failureStage,
  )}`;
  const normalized = source || normalizeText(evidence.decision);
  // 摘要词随 hash 一起保存，供连续原因判断检查“内容重叠”，而非只比 sig 标签。
  return `sig_${fnv1a(normalized)}:${significantTokens(normalized).slice(0, 12).join('.')}`;
}

/**
 * 规则优先归因：模型提示只能补充，不能把明确的检查/失败事实改成无关类别。
 */
export function resolveAttribution(
  aiHint: string | undefined,
  evidence: ControlledRevisionEvidence,
): RevisionAttribution {
  const text = [
    aiHint,
    evidence.failureMessage,
    evidence.failureStage,
    evidence.agentSummary,
    ...(evidence.gaps ?? []),
    ...(evidence.checks ?? []).flatMap((c) => [c.id, c.verdict, c.detail]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (evidence.decision === 'insufficient_evidence' || /证据不足|insufficient evidence|缺少.*证据/.test(text)) {
    return 'insufficient_evidence';
  }
  if (/权限|permission|scope|授权|access denied|forbidden/.test(text)) return 'permission_or_scope';
  if (/路径|path|目录不存在|project.*(?:invalid|missing)|invalid project|not a project/.test(text)) {
    return 'invalid_project_or_path';
  }
  if (/依赖|dependency|environment|环境|node_modules|package.*not found|docker/.test(text)) {
    return 'dependency_or_environment';
  }
  if (/工具|tool|模型不可用|model unavailable|capability.*unavailable|not available/.test(text)) {
    return 'tool_unavailable';
  }
  if (/test|测试|build|构建|compile|编译|lint/.test(text)) return 'test_or_build_failure';
  if (/runtime|运行时|启动失败|crash|exception|timeout/.test(text)) return 'runtime_failure';
  if (/目标|需求|歧义|ambigu|clarif|范围不明确/.test(text)) return 'goal_ambiguity';
  if (/缺陷|defect|bug|实现|implementation|未实现/.test(text)) return 'implementation_defect';

  const normalizedHint = normalizeText(aiHint).replace(/\s/g, '_') as RevisionAttribution;
  return (REVISION_ATTRIBUTIONS as readonly string[]).includes(normalizedHint)
    ? normalizedHint
    : 'other';
}

/** 用显著词生成可比较的修订方案指纹。 */
export function schemeFingerprint(plan: string): string {
  return significantTokens(plan).sort().join(' ');
}

export function schemesSubstantiallyDifferent(prev: string, next: string): boolean {
  const prevTokens = significantTokens(prev);
  const nextTokens = significantTokens(next);
  if (!prevTokens.length || !nextTokens.length) return false;
  const previous = new Set(prevTokens);
  const following = new Set(nextTokens);
  const shared = [...previous].filter((token) => following.has(token)).length;
  const union = new Set([...previous, ...following]).size;
  if (shared / union < 0.55) return true;
  return primaryCheckFocus(prev) !== primaryCheckFocus(next);
}

/**
 * 从最近尝试向前数同一原因；签名必须共享内容词，不能仅因 sig_ 标签相同而累加。
 */
export function countConsecutiveSameCause(
  attempts: RevisionAttemptRecord[],
  attribution: RevisionAttribution,
  signature: string,
): number {
  let count = 0;
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i]!;
    if (
      attempt.attribution !== attribution ||
      !signaturesOverlap(attempt.errorSignature, signature, attempt.revisionPlanExcerpt)
    ) {
      break;
    }
    count += 1;
  }
  return count;
}

export function decideControlledRevision(input: ControlledRevisionInput): ControlledRevisionDecision {
  const loop = input.loop ?? { attempts: [], autoRoundCount: 0 };
  const plan = String(input.evidence.revisionPlan ?? '').trim();
  const attribution = resolveAttribution(undefined, input.evidence);
  const errorSignature = buildErrorSignature(input.evidence);
  const fingerprint = schemeFingerprint(plan);
  const consecutiveSameCause = countConsecutiveSameCause(
    loop.attempts ?? [],
    attribution,
    errorSignature,
  );
  const base = { attribution, errorSignature, schemeFingerprint: fingerprint, consecutiveSameCause };
  const pause = (reason: string): ControlledRevisionDecision => ({
    ...base,
    action: 'pause',
    userFacingNote: reason,
    stopReason: reason,
  });

  if (input.evidence.decision === 'meets_plan') {
    return {
      ...base,
      consecutiveSameCause: 0,
      action: 'stop_success',
      userFacingNote: '成果已达到当前计划，无需继续修改。',
      stopReason: 'meets_plan',
    };
  }
  if (input.cancelled) return { ...base, action: 'noop', userFacingNote: '任务已取消，不再自动修改。', stopReason: 'cancelled' };
  if (input.hasActiveJob) return { ...base, action: 'noop', userFacingNote: '当前已有执行正在进行。', stopReason: 'active_job' };
  if (input.pausedByUser || loop.paused) return { ...base, action: 'noop', userFacingNote: '自动修改已暂停。', stopReason: 'paused' };
  if (!input.modelAvailable) return pause('当前无法使用所需能力，已暂停自动修改。');
  if (!input.hasConfirmedPlan || input.confirmedPlanVersion == null) {
    return {
      ...base,
      action: 'await_user',
      userFacingNote: '请先确认当前计划后再继续修改。',
      requireUserDecision: true,
      stopReason: 'plan_unconfirmed',
    };
  }
  if (input.evidence.primaryAction === 'need_decision') {
    return {
      ...base,
      action: 'await_user',
      userFacingNote: '当前结果需要你决定下一步，已暂停自动修改。',
      requireUserDecision: true,
      stopReason: 'review_needs_decision',
    };
  }
  if (input.evidence.decision === 'blocked' || input.evidence.decision === 'insufficient_evidence') {
    return pause('现有证据不足或存在阻断，已暂停自动修改。');
  }
  if (input.evidence.decision !== 'needs_revision') return { ...base, action: 'noop', userFacingNote: '当前不需要创建修订任务。', stopReason: 'not_revision' };
  if (!plan) return pause('缺少可执行的修改方案，已暂停自动修改。');
  if ((loop.autoRoundCount ?? 0) >= (input.maxAutoRounds ?? DEFAULT_MAX_AUTO_REVISION_ROUNDS)) {
    return pause('已达到本轮自动修改上限，请确认下一步。');
  }
  const maxCum = input.maxCumulativeDurationMs ?? DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS;
  if ((input.cumulativeDurationMs ?? 0) >= maxCum) {
    return pause('已达到累计处理时长上限，请确认下一步。');
  }
  if (hasHighRiskMarker(plan) || hasGoalChangeMarker(plan)) {
    return {
      ...base,
      action: 'await_user',
      userFacingNote: hasHighRiskMarker(plan)
        ? '该修改涉及高风险操作，请你确认后再继续。'
        : '修改方案可能改变原任务目标，请你确认后再继续。',
      requireUserDecision: true,
      stopReason: hasHighRiskMarker(plan) ? 'high_risk' : 'goal_change',
    };
  }
  if (consecutiveSameCause >= 2) {
    return pause(
      '这个原因已连续出现三次，我已暂停，避免继续无效尝试。你可以调整目标、补充约束，或说明希望换一种处理方式。',
    );
  }
  if (consecutiveSameCause === 1) {
    const previous = loop.attempts[loop.attempts.length - 1]?.revisionPlanExcerpt ?? '';
    if (!schemesSubstantiallyDifferent(previous, plan)) {
      return pause(
        '相同原因再次出现，但尚未形成与原方案实质不同的处理方式。请补充约束，或确认换一种方向后再继续。',
      );
    }
    return {
      ...base,
      action: 'auto_revise_new_scheme',
      userFacingNote: '相同原因再次出现，原方案无效，我正在换一种方式处理。',
      revisionRequest: plan,
    };
  }
  return {
    ...base,
    action: 'auto_revise',
    userFacingNote: '第一轮未达到规划，我已找到问题并开始修订。',
    revisionRequest: plan,
  };
}

function hasHighRiskMarker(plan: string): boolean {
  return /删除整个|扩大权限|系统目录|sudo|覆盖全部/i.test(plan);
}

function hasGoalChangeMarker(plan: string): boolean {
  return /改变(?:任务)?目标|修改(?:任务)?目标|重新定义需求|更换目标|超出原(?:任务)?范围/i.test(plan);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDetail(value: unknown): string {
  return normalizeText(value)
    .replace(/\b(?:job|task|artifact|version|request)[-_:\s]*[a-z0-9-]+\b/g, '$1')
    .replace(/\b\d{4}-\d\d-\d\d[^\s]*\b/g, '')
    .slice(0, 240);
}

function significantTokens(value: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', '修改', '修复', '需要', '检查', '方案', '当前', '进行']);
  return Array.from(
    new Set(
      normalizeText(value)
        // 中文没有稳定空格分词；按字保留能识别同义改写中的核心操作词。
        .match(/[\p{Script=Han}]|[a-z][a-z0-9_-]{2,}/gu)
        ?.filter((token) => !stop.has(token)) ?? [],
    ),
  );
}

function primaryCheckFocus(value: string): string {
  // 仅接受显式 check:foo 标识，避免中文句子中的“检查 X”误把操作词当检查 ID。
  const match = normalizeText(value).match(/(?:check|检查|test)[:：]\s*([a-z0-9_-]+)/);
  return match?.[1] ?? '';
}

function signaturesOverlap(previous: string, next: string, fallback: string): boolean {
  if (previous === next) return true;
  const a = new Set(significantTokens(`${previous.replace(/^sig_[^:]+:/, '')} ${fallback}`));
  const b = significantTokens(next);
  return b.some((token) => a.has(token));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
