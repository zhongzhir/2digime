/**
 * TaskDisplayState — 从 Task + Jobs + Artifacts 派生的稳定用户态。
 * 「是否采用」与「是否可运行」为两个维度，不得互相覆盖。
 */
import type { ExecutionJob } from './execution-job';
import type { Artifact } from './artifact';
import type { Task } from './task';
import {
  AWAITING_CONFIRM_LABEL,
  NEEDS_REVISION_LABEL,
  REJECTED_LABEL,
  REVISING_LABEL,
  SUGGEST_ADOPT_LABEL,
  USER_FACING_LABELS,
  isDegradedQualityGrade,
  latestJob,
  type SoftwareOutcomeHint,
  type TaskState,
  deriveTaskState,
} from './derive';
import { workUnitRecoveryExhausted } from './work-unit-ownership';

export const TRY_RUN_LABEL = '可以试用';
export const EXEC_FAILED_LABEL = '执行失败';
export const NEEDS_PROJECT_LABEL = '需要选择项目位置';
export const CANCELLED_LABEL = '已取消';

export const ADOPTED_CAN_TRY_LABEL = '已采用 · 可以试用';
export const ADOPTED_NEEDS_FIX_LABEL = '已采用 · 仍需修复';
export const ADOPTED_UNVERIFIED_LABEL = '已采用 · 尚未验证';

export type TaskDisplayStateId =
  | 'waiting'
  | 'processing'
  | 'awaiting_confirm'
  | 'needs_revision'
  | 'can_try_run'
  | 'adopted_can_try'
  | 'adopted_needs_fix'
  | 'adopted_unverified'
  | 'failed'
  | 'cancelled'
  | 'needs_project'
  | 'rejected'
  | 'suggest_adopt';

export type TaskDisplayState = {
  taskId: string;
  state: TaskState;
  displayId: TaskDisplayStateId;
  label: string;
  /** 最近活动时间（ISO），仅用于排序；查看不写入。 */
  activityTime: string;
  projectDir: string | null;
  latestJobId: string | null;
  latestArtifactId: string | null;
};

function maxIso(times: Array<string | undefined | null>): string {
  let best = '';
  for (const t of times) {
    const s = String(t || '').trim();
    if (s && s > best) best = s;
  }
  return best;
}

/** 解析有效项目目录：优先 Job.externalExecution，其次 Task.contextRefs 文件夹。 */
export function resolveTaskProjectDir(
  task: Pick<Task, 'contextRefs'>,
  jobsForTask: readonly ExecutionJob[],
): string | null {
  const last = latestJob(jobsForTask);
  const fromJob = last?.externalExecution?.workingDirectory;
  if (fromJob && String(fromJob).trim()) return pathNormalize(String(fromJob));
  for (const ref of task.contextRefs || []) {
    if (ref && ref.kind === 'folder' && ref.path && String(ref.path).trim()) {
      return pathNormalize(String(ref.path));
    }
  }
  return null;
}

function pathNormalize(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

export function computeTaskActivityTime(input: {
  task: Pick<Task, 'createdAt'>;
  jobsForTask: readonly ExecutionJob[];
  artifacts: readonly Artifact[];
  decisionDecidedAt?: string | null;
}): string {
  const times: Array<string | undefined | null> = [input.task.createdAt, input.decisionDecidedAt];
  for (const job of input.jobsForTask) {
    times.push(job.createdAt, job.startedAt);
  }
  for (const art of input.artifacts) {
    times.push(art.createdAt);
    for (const v of art.versions || []) {
      times.push(v.createdAt);
    }
  }
  return maxIso(times) || input.task.createdAt;
}

export function pickPrimaryArtifact(
  artifacts: readonly Artifact[],
  last: ExecutionJob | undefined,
): Artifact | undefined {
  if (!artifacts.length) return undefined;
  if (last?.artifactId) {
    const matched = artifacts.find((a) => a.id === last.artifactId);
    if (matched) return matched;
  }
  if (last?.targetArtifactId) {
    const matched = artifacts.find((a) => a.id === last.targetArtifactId);
    if (matched) return matched;
  }
  let best: Artifact = artifacts[0]!;
  for (const a of artifacts) {
    const aHead = a.versions.find((v) => v.versionId === a.headVersionId)?.createdAt || a.createdAt;
    const bHead =
      best.versions.find((v) => v.versionId === best.headVersionId)?.createdAt || best.createdAt;
    if (aHead > bHead || (aHead === bHead && a.id > best.id)) best = a;
  }
  return best;
}

/** 运行可用性：只看当前 head 的 startup / acceptance，不读旧版本。 */
export type RunAvailability = 'can_try' | 'needs_fix' | 'unverified' | 'none';

export function deriveRunAvailability(soft?: SoftwareOutcomeHint): RunAvailability {
  if (
    !soft ||
    (!soft.isCodeChange &&
      !soft.verificationOverall &&
      soft.canSuggestTryRun == null &&
      !soft.startupCheckVerdict)
  ) {
    return 'none';
  }
  const startup = soft.startupCheckVerdict;
  if (startup === 'unsatisfied') return 'needs_fix';
  // 验收未完整通过 → 与成果区「还不能正常运行 / 还有问题」对齐为仍需修复
  if (
    soft.canAdoptSuggested === false ||
    (soft.verificationOverall && soft.verificationOverall !== 'satisfied')
  ) {
    return 'needs_fix';
  }
  if (startup === 'satisfied' || soft.canSuggestTryRun === true) return 'can_try';
  return 'unverified';
}

function combineAdopted(run: RunAvailability): Pick<TaskDisplayState, 'displayId' | 'label'> {
  switch (run) {
    case 'can_try':
      return { displayId: 'adopted_can_try', label: ADOPTED_CAN_TRY_LABEL };
    case 'needs_fix':
      return { displayId: 'adopted_needs_fix', label: ADOPTED_NEEDS_FIX_LABEL };
    case 'unverified':
    case 'none':
    default:
      return { displayId: 'adopted_unverified', label: ADOPTED_UNVERIFIED_LABEL };
  }
}

/**
 * 稳定派生规则：
 * 1. 排队/运行中 → 处理中 / 正在修改
 * 2. 失败 → 执行失败；取消 → 已取消
 * 3. 成功后：采用维度 × 运行维度组合（采用不覆盖运行事实）
 * 4. 未采用：可试用 / 建议采用 / 建议继续修改 / 尚未决定 / 未采用
 * 5. 无有效 projectDir（且像软件任务）→ 需要选择项目位置
 */
export function deriveTaskDisplayState(input: {
  task: Task;
  jobsForTask: readonly ExecutionJob[];
  artifacts: readonly Artifact[];
  softwareOutcome?: SoftwareOutcomeHint;
  decisionDecidedAt?: string | null;
  /** 仅当确实无 projectDir 且像软件意图时使用 needs_project */
  treatMissingProjectAsNeedsProject?: boolean;
}): TaskDisplayState {
  const { task, jobsForTask, artifacts } = input;
  const soft = input.softwareOutcome;
  const last = latestJob(jobsForTask);
  const recoveryExhausted = workUnitRecoveryExhausted(task);
  const state = deriveTaskState(jobsForTask, {
    workUnitRecoveryExhausted: recoveryExhausted,
  });
  const projectDir = resolveTaskProjectDir(task, jobsForTask);
  const primary = pickPrimaryArtifact(artifacts, last);
  const activityTime = computeTaskActivityTime({
    task,
    jobsForTask,
    artifacts,
    ...(input.decisionDecidedAt != null
      ? { decisionDecidedAt: input.decisionDecidedAt }
      : {}),
  });

  const base = {
    taskId: task.id,
    state,
    activityTime,
    projectDir,
    latestJobId: last?.id ?? null,
    latestArtifactId: primary?.id ?? null,
  };

  const revising = !!(
    last?.revisionRequest &&
    (last.status === 'queued' || last.status === 'running')
  );

  if (!last) {
    if (recoveryExhausted) {
      return {
        ...base,
        displayId: 'failed',
        label: USER_FACING_LABELS.attention,
      };
    }
    if (input.treatMissingProjectAsNeedsProject && !projectDir) {
      return { ...base, displayId: 'needs_project', label: NEEDS_PROJECT_LABEL };
    }
    return { ...base, displayId: 'waiting', label: USER_FACING_LABELS.waiting };
  }

  switch (last.status) {
    case 'queued':
      return {
        ...base,
        displayId: 'processing',
        label: revising ? REVISING_LABEL : USER_FACING_LABELS.waiting,
      };
    case 'running':
      return {
        ...base,
        displayId: 'processing',
        label: revising ? REVISING_LABEL : USER_FACING_LABELS.processing,
      };
    case 'failed':
      return { ...base, displayId: 'failed', label: EXEC_FAILED_LABEL };
    case 'cancelled':
      return { ...base, displayId: 'cancelled', label: CANCELLED_LABEL };
    case 'succeeded': {
      if (!last.artifactId && !primary) {
        return { ...base, displayId: 'failed', label: EXEC_FAILED_LABEL };
      }
      const run = deriveRunAvailability(soft);
      const adopted = soft?.ownerDecision === 'accepted';
      if (adopted) {
        return { ...base, ...combineAdopted(run) };
      }
      if (soft?.ownerDecision === 'rejected') {
        return { ...base, displayId: 'rejected', label: REJECTED_LABEL };
      }
      if (isDegradedQualityGrade(soft?.qualityGrade)) {
        return {
          ...base,
          state: 'attention',
          displayId: 'needs_revision',
          label: USER_FACING_LABELS.attention,
        };
      }
      if (
        soft?.isCodeChange ||
        soft?.verificationOverall ||
        soft?.canSuggestTryRun != null ||
        soft?.startupCheckVerdict
      ) {
        if (soft?.canAdoptSuggested === true) {
          return { ...base, displayId: 'suggest_adopt', label: SUGGEST_ADOPT_LABEL };
        }
        if (run === 'can_try') {
          return { ...base, displayId: 'can_try_run', label: TRY_RUN_LABEL };
        }
        if (run === 'needs_fix') {
          return { ...base, displayId: 'needs_revision', label: NEEDS_REVISION_LABEL };
        }
        return { ...base, displayId: 'awaiting_confirm', label: AWAITING_CONFIRM_LABEL };
      }
      return { ...base, displayId: 'awaiting_confirm', label: USER_FACING_LABELS.completed };
    }
    default:
      return { ...base, displayId: 'waiting', label: USER_FACING_LABELS.waiting };
  }
}

export function sortTasksByActivityTime<T extends { activityTime: string; taskId: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.activityTime !== b.activityTime) {
      return a.activityTime < b.activityTime ? 1 : -1;
    }
    return a.taskId < b.taskId ? 1 : a.taskId > b.taskId ? -1 : 0;
  });
}
