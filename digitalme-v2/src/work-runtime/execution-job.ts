import { artifactIdForJob } from './artifact';

/**
 * ExecutionJob — 一次执行的唯一权威状态载体(domain model §2.5)。
 * 五态封闭;状态只能由执行器写入。
 * P0.1:Job 1:1 Snapshot;snapshotId 在 context 阶段完成后写入(submitTask 同步路径
 * 只建 queued Job,材料抽取属于 Job 的第一个异步阶段)。
 */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type TerminalJobStatus = 'succeeded' | 'failed' | 'cancelled';

/** 封闭失败阶段;interrupted 仅用于崩溃恢复落点,不参与正常执行分支。 */
export type FailureStage =
  | 'context'
  | 'capability'
  | 'model'
  | 'artifact_write'
  | 'interrupted';

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
  /**
   * 修改成果:指向既有 Artifact,成功时追加版本而非新建。
   * 说明性执行元数据,非新的领域对象类型。
   */
  targetArtifactId?: string;
  /** 用户本次修改要求(与 targetArtifactId 成对出现)。 */
  revisionRequest?: string;
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
 * 崩溃恢复协议(contracts §3.4 + P1.2)。启动扫描封闭动作集:
 * - Artifact 已写且 Job 非终态 → 补交 succeeded;
 * - Job succeeded 但 Artifact 缺失 → mark_failed(stage=artifact_write);
 * - queued → 重新入队;
 * - running → mark_failed(stage=interrupted);
 * - 其余终态 → 不动作。
 * 不扩展 JobStatus;succeeded→failed 仅经 applyRecoveryWrite 落地。
 */
export type RecoveryAction = 'none' | 'commit_succeeded' | 'requeue' | 'mark_failed';

export function recoverJobOnStartup(job: ExecutionJob, artifactExistsForJob: boolean): RecoveryAction {
  if (artifactExistsForJob && !isTerminal(job.status)) return 'commit_succeeded';
  if (job.status === 'succeeded' && !artifactExistsForJob) return 'mark_failed';
  if (isTerminal(job.status)) return 'none';
  if (job.status === 'queued') return 'requeue';
  return 'mark_failed';
}

/**
 * 恢复写入口:可越过正常转移表(仅启动恢复使用)。
 * 正常执行路径必须走 transitionJob。
 */
export function applyRecoveryWrite(
  job: ExecutionJob,
  action: Exclude<RecoveryAction, 'none' | 'requeue'>,
  at: string,
  failure?: ExecutionJob['failure'],
): ExecutionJob {
  if (action === 'commit_succeeded') {
    const next: ExecutionJob = {
      ...job,
      status: 'succeeded',
      finishedAt: at,
      artifactId: artifactIdForJob(job.id),
    };
    delete next.failure;
    return next;
  }
  const next: ExecutionJob = {
    ...job,
    status: 'failed',
    finishedAt: at,
  };
  if (failure) next.failure = failure;
  delete next.artifactId;
  return next;
}
