import type { ExecutionJob } from './execution-job';

/**
 * 状态派生契约(runtime contracts §4)。
 * Task 无自有状态且不持有 Job 指针;这里从 Job 集合(按 taskId 查询所得)
 * 派生任务状态,是 Job → Task 状态的唯一翻译层。
 */
export const TASK_STATES = ['waiting', 'processing', 'completed', 'attention'] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** 用户面四态文案 — 封闭表,禁止扩展为后台词汇。 */
export const USER_FACING_LABELS: Record<TaskState, string> = {
  waiting: '等待开始',
  processing: '正在处理',
  completed: '已完成',
  attention: '需要处理',
};

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

export function toUserFacingLabel(state: TaskState): string {
  return USER_FACING_LABELS[state];
}
