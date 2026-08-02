/**
 * ExecutionJob — 一次执行的唯一权威状态载体(domain model §2.5)。
 * 五态封闭;状态只能由执行器写入。
 * P0.1:Job 1:1 Snapshot;snapshotId 在 context 阶段完成后写入(submitTask 同步路径
 * 只建 queued Job,材料抽取属于 Job 的第一个异步阶段)。
 */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type TerminalJobStatus = 'succeeded' | 'failed' | 'cancelled';

export type FailureStage = 'context' | 'capability' | 'model' | 'artifact_write';

export interface ExecutionJob {
  id: string;
  taskId: string;
  capabilityId: string;
  /** context 阶段完成后写入;成功的 Job 恰好关联一个 Snapshot。 */
  snapshotId?: string;
  createdAt: string;
  status: JobStatus;
  /** 说明性进度字段,非状态机;禁止据其做分支判断。 */
  phase?: string;
  progress?: { note: string; updatedAt: string };
  startedAt?: string;
  finishedAt?: string;
  failure?: {
    stage: FailureStage;
    message: string;
    /** 面向用户的可行动信息。 */
    actionable: string;
  };
  /** succeeded 时恰好一个。 */
  artifactId?: string;
  costActual?: { tokens?: number; durationMs?: number };
}

/** 合法状态迁移(contracts §3;终态不可再迁移)。 */
const LEGAL_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function isTerminal(status: JobStatus): status is TerminalJobStatus {
  return LEGAL_TRANSITIONS[status].length === 0;
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** 执行器唯一合法的状态写入口;非法迁移直接抛错(编程错误,不静默)。 */
export function transitionJob(job: ExecutionJob, to: JobStatus, at: string): ExecutionJob {
  if (!canTransition(job.status, to)) {
    throw new Error(`illegal job transition: ${job.status} -> ${to} (job ${job.id})`);
  }
  const next: ExecutionJob = { ...job, status: to };
  if (to === 'running') next.startedAt = at;
  if (isTerminal(to)) next.finishedAt = at;
  return next;
}

/**
 * 崩溃恢复协议(contracts §3.4)。启动时对每个非终态 Job 执行:
 * - 已存在该 Job 的 Artifact → 补交 succeeded(幂等提交的后半段);
 * - queued → 重新入队(尚未产生副作用);
 * - running → 落 failed(阶段保留,提示可重试)。
 */
export type RecoveryAction = 'none' | 'commit_succeeded' | 'requeue' | 'mark_failed';

export function recoverJobOnStartup(job: ExecutionJob, artifactExistsForJob: boolean): RecoveryAction {
  if (isTerminal(job.status)) return 'none';
  if (artifactExistsForJob) return 'commit_succeeded';
  if (job.status === 'queued') return 'requeue';
  return 'mark_failed';
}
