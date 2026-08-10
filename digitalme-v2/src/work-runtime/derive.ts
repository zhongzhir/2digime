import type { ExecutionJob } from './execution-job';

/**
 * 状态派生契约(runtime contracts §4)。
 * Task 无自有状态且不持有 Job 指针;这里从 Job 集合(按 taskId 查询所得)
 * 派生任务状态,是 Job → Task 状态的唯一翻译层。
 */
export const TASK_STATES = ['waiting', 'processing', 'completed', 'attention'] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** 用户面文案 — 封闭表;「正在修改」由修订中的 processing 派生,非独立持久态。 */
export const USER_FACING_LABELS: Record<TaskState, string> = {
  waiting: '等待开始',
  processing: '处理中',
  completed: '需要你确认',
  attention: '需要处理',
};

export const REVISING_LABEL = '正在修改';
export const ADOPTED_LABEL = '已采用';
export const NEEDS_REVISION_LABEL = '建议继续修改';
export const AWAITING_CONFIRM_LABEL = '需要你确认';

/** 同一 Task 下最新 Job:按 createdAt 排序,同刻以 id 决胜(全序,无并列)。 */
export function latestJob(jobsForTask: readonly ExecutionJob[]): ExecutionJob | undefined {
  let latest: ExecutionJob | undefined;
  for (const job of jobsForTask) {
    if (
      !latest ||
      job.createdAt > latest.createdAt ||
      (job.createdAt === latest.createdAt && job.id > latest.id)
    ) {
      latest = job;
    }
  }
  return latest;
}

export function deriveTaskState(jobsForTask: readonly ExecutionJob[]): TaskState {
  const last = latestJob(jobsForTask);
  if (!last) return 'waiting';
  switch (last.status) {
    case 'queued':
      return 'waiting';
    case 'running':
      return 'processing';
    case 'succeeded':
      return last.artifactId ? 'completed' : 'attention';
    case 'failed':
    case 'cancelled':
      return 'attention';
  }
}

export function toUserFacingLabel(
  state: TaskState,
  opts?: { revising?: boolean },
): string {
  if (opts?.revising && state === 'processing') return REVISING_LABEL;
  return USER_FACING_LABELS[state];
}

export type SoftwareOutcomeHint = {
  ownerDecision?: 'undecided' | 'accepted' | 'rejected';
  verificationOverall?: string;
  canAdoptSuggested?: boolean;
  isCodeChange?: boolean;
  /** Digital Me 启动检查 verdict（来自 manifest.checks）。 */
  startupCheckVerdict?: string;
  /** 启动检查通过时可试用。 */
  canSuggestTryRun?: boolean;
  /**
   * 成果质量分级（如 code-analysis manifest.quality.grade）。
   * degraded_scan_only / needs_attention 时不得显示「需要你确认」。
   */
  qualityGrade?: string;
};

/** 质量降级：不得标成「需要你确认」伪完成。 */
export function isDegradedQualityGrade(grade: string | undefined | null): boolean {
  return grade === 'degraded_scan_only' || grade === 'needs_attention';
}

/**
 * 按最新 Job 状态给出用户面文案（失败/取消与「需要处理」区分）。
 * 软件成果：执行结束 ≠ 验收通过 ≠ 已采用。
 */
export function userFacingLabelFromLatestJob(
  jobsForTask: readonly ExecutionJob[],
  opts?: {
    revising?: boolean;
    externalCapability?: boolean;
    hasArtifact?: boolean;
    softwareOutcome?: SoftwareOutcomeHint;
  },
): string {
  const last = latestJob(jobsForTask);
  if (opts?.externalCapability) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { externalCapabilityUserFacingLabel } = require('../capability/external-capability-product') as typeof import('../capability/external-capability-product');
    return externalCapabilityUserFacingLabel(
      last,
      opts.hasArtifact !== undefined ? { hasArtifact: opts.hasArtifact } : {},
    );
  }
  if (!last) return USER_FACING_LABELS.waiting;
  switch (last.status) {
    case 'queued':
      return USER_FACING_LABELS.waiting;
    case 'running':
      return opts?.revising || last.revisionRequest ? REVISING_LABEL : USER_FACING_LABELS.processing;
    case 'succeeded': {
      if (!last.artifactId) return USER_FACING_LABELS.attention;
      const soft = opts?.softwareOutcome;
      if (
        soft?.isCodeChange ||
        soft?.verificationOverall ||
        soft?.ownerDecision ||
        soft?.canSuggestTryRun != null ||
        soft?.startupCheckVerdict
      ) {
        // 采用 × 运行 两维组合（与 task-display-state 一致；采用不覆盖运行事实）
        const startup = soft.startupCheckVerdict;
        let run: 'can_try' | 'needs_fix' | 'unverified' = 'unverified';
        if (startup === 'unsatisfied') run = 'needs_fix';
        else if (
          soft.canAdoptSuggested === false ||
          (soft.verificationOverall && soft.verificationOverall !== 'satisfied')
        ) {
          run = 'needs_fix';
        } else if (startup === 'satisfied' || soft.canSuggestTryRun === true) {
          run = 'can_try';
        }
        if (soft.ownerDecision === 'accepted') {
          if (run === 'can_try') return '已采用 · 可以试用';
          if (run === 'needs_fix') return '已采用 · 仍需修复';
          return '已采用 · 尚未验证';
        }
        if (run === 'can_try') return '可以试用';
        if (run === 'needs_fix') return NEEDS_REVISION_LABEL;
        if (isDegradedQualityGrade(soft.qualityGrade)) return USER_FACING_LABELS.attention;
        return AWAITING_CONFIRM_LABEL;
      }
      if (isDegradedQualityGrade(soft?.qualityGrade)) return USER_FACING_LABELS.attention;
      return USER_FACING_LABELS.completed;
    }
    case 'failed':
      return '执行失败';
    case 'cancelled':
      return '已取消';
  }
}
