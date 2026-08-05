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
  processing: '正在处理',
  completed: '已完成',
  attention: '需要处理',
};

export const REVISING_LABEL = '正在修改';

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

/**
 * 按最新 Job 状态给出用户面文案（失败/取消与「需要处理」区分）。
 * Task 派生态仍用 deriveTaskState；展示优先走本函数。
 */
export function userFacingLabelFromLatestJob(
  jobsForTask: readonly ExecutionJob[],
  opts?: { revising?: boolean; externalCapability?: boolean; hasArtifact?: boolean },
): string {
  const last = latestJob(jobsForTask);
    if (opts?.externalCapability) {
    // 延迟导入避免 derive ↔ product 循环；外部标签封闭表在 product 模块。
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
    case 'succeeded':
      return last.artifactId ? USER_FACING_LABELS.completed : USER_FACING_LABELS.attention;
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
  }
}
