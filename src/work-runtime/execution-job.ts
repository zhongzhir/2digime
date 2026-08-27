import { artifactIdForJob } from './artifact';
import type { JobResearchEvidence } from './research-evidence';

export type { JobResearchEvidence };

/**
 * ExecutionJob — 一次执行的唯一权威状态载体(domain model §2.5)。
 * 五态封闭;状态只能由执行器写入。
 * P0.1:Job 1:1 Snapshot;snapshotId 在 context 阶段完成后写入(submitTask 同步路径
 * 只建 queued Job,材料抽取属于 Job 的第一个异步阶段)。
 */
/** Job 创建时冻结的确认规划；执行只读此结构。 */
export interface ConfirmedPlanSnapshot {
  version: number;
  content: string;
  /** Planner requirements frozen with this job; review must check these. */
  requirements?: string[];
  requiredCapabilities?: string[];
}

/** Validation/audit only: how current-task context was discovered, selected, and frozen. */
export interface JobContextContinuity {
  candidateIds: string[];
  selectedIds: string[];
  attachedRefs: string[];
  freezeEventIds: string[];
}

/** 能力实际纳入提示或读取的材料；与 Snapshot 获得清单区分。 */
export type MaterialReadCompleteness = 'full' | 'truncated' | 'unread';

export interface JobMaterialUseItem {
  path: string;
  completeness: MaterialReadCompleteness;
  sourceChars: number;
  usedChars: number;
}

export interface JobMaterialUse {
  usedPaths: string[];
  /** 进入提示的条数（含截断）。不得当成完整阅读数。 */
  includedCount: number;
  /** 进入提示但未读完的条数。 */
  truncatedCount?: number;
  /** 完整读入的条数。 */
  fullReadCount?: number;
  skippedWarningCount?: number;
  items?: JobMaterialUseItem[];
}

function parseMaterialUseItems(raw: unknown): JobMaterialUseItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: JobMaterialUseItem[] = [];
  for (const it of raw.slice(0, 80)) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const itemPath = String(rec.path || '').trim();
    const completeness = rec.completeness;
    if (!itemPath) continue;
    if (completeness !== 'full' && completeness !== 'truncated' && completeness !== 'unread') {
      continue;
    }
    const sourceChars = Number(rec.sourceChars);
    const usedChars = Number(rec.usedChars);
    out.push({
      path: itemPath,
      completeness,
      sourceChars: Number.isFinite(sourceChars) ? Math.max(0, Math.floor(sourceChars)) : 0,
      usedChars: Number.isFinite(usedChars) ? Math.max(0, Math.floor(usedChars)) : 0,
    });
  }
  return out.length ? out : undefined;
}

export function normalizeMaterialUse(raw: unknown): JobMaterialUse | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const items = parseMaterialUseItems(o.items);
  const usedPaths = Array.isArray(o.usedPaths)
    ? o.usedPaths.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 80)
    : items
      ? items.filter((i) => i.usedChars > 0).map((i) => i.path)
      : [];
  const includedCount =
    typeof o.includedCount === 'number' && Number.isFinite(o.includedCount)
      ? Math.max(0, Math.floor(o.includedCount))
      : usedPaths.length;
  const truncatedFromItems = items?.filter((i) => i.completeness === 'truncated').length;
  const fullFromItems = items?.filter((i) => i.completeness === 'full').length;
  const truncatedCount =
    truncatedFromItems != null
      ? truncatedFromItems
      : typeof o.truncatedCount === 'number' && Number.isFinite(o.truncatedCount)
        ? Math.max(0, Math.floor(o.truncatedCount))
        : undefined;
  const fullReadCount =
    fullFromItems != null
      ? fullFromItems
      : typeof o.fullReadCount === 'number' && Number.isFinite(o.fullReadCount)
        ? Math.max(0, Math.floor(o.fullReadCount))
        : undefined;
  const skippedWarningCount =
    typeof o.skippedWarningCount === 'number' && Number.isFinite(o.skippedWarningCount)
      ? Math.max(0, Math.floor(o.skippedWarningCount))
      : undefined;
  if (
    usedPaths.length === 0 &&
    includedCount === 0 &&
    truncatedCount == null &&
    fullReadCount == null &&
    skippedWarningCount == null &&
    !items
  ) {
    return { usedPaths: [], includedCount: 0 };
  }
  return {
    usedPaths,
    includedCount,
    ...(truncatedCount != null ? { truncatedCount } : {}),
    ...(fullReadCount != null ? { fullReadCount } : {}),
    ...(skippedWarningCount != null ? { skippedWarningCount } : {}),
    ...(items ? { items } : {}),
  };
}

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
  /** 用户不采用理由（可选；进入修订 prompt）。 */
  rejectionReason?: string;
  /**
   * 本 Job 创建时冻结的已确认规划（版本 + 正文）。
   * 仅证明并承载本次执行依据的方案；不回写 Task，不替代 Plan 权威链。
   */
  confirmedPlanSnapshot?: ConfirmedPlanSnapshot;
  /**
   * 任务上下文连续性审计（候选 → 选择 → 装配 → freeze）。
   * 仅 validation / 排障使用，不向普通用户展示。
   */
  contextContinuity?: JobContextContinuity;
  /**
   * 研究证据审计（查询 → 候选 → 筛选 → 是否充足）。
   * 仅 validation / 排障使用，不向普通用户展示。
   */
  researchEvidence?: JobResearchEvidence;
  /**
   * 能力实际读入执行/提示的材料路径（执行证据，非状态机）。
   * 与 Snapshot 中「获得/已抽取/未读取」区分；缺省不得把已抽取当成已通读。
   */
  materialUse?: JobMaterialUse;
  costActual?: { tokens?: number; durationMs?: number };
  /**
   * 远端执行映射(可选) — 不是第二状态机。
   * 用户面权威仍是本地 Job 五态;此处仅关联 remote executionId。
   */
  remoteExecution?: {
    executionId: string;
    adapterId: string;
    endpoint?: string;
    lastRemoteStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    /** 本地已请求取消后禁止迟到 collect 写入。 */
    cancelRequested?: boolean;
    /** 幂等重试计数(最多一次)。 */
    retryCount?: number;
  };
  /**
   * 外部执行器映射(可选) — 不是第二状态机 / 第二任务系统。
   * Job 五态仍是唯一权威；此处承载授权范围与执行器侧状态投影。
   */
  externalExecution?: {
    executorId: string;
    executorRunId?: string;
    workingDirectory: string;
    readScope: string[];
    writeScope: string[];
    projectOrigin?: 'digitalme_created' | 'user_selected' | 'unknown';
    lastExecutorStatus?:
      | 'queued'
      | 'running'
      | 'waiting_for_input'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | 'interrupted';
    /** 每个原始 Job 最多自动续执行一次。 */
    autoContinueCount?: number;
    afterScopeDigest?: string;
    needsUserQuestion?: boolean;
  };
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
      // 修订 Job 成果写在 targetArtifactId 上，不得改写成 art_${revisionJobId}
      artifactId: job.targetArtifactId || job.artifactId || artifactIdForJob(job.id),
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
