/**
 * ExternalExecutor 最小合同 — 不绑定任何具体执行器专有字段。
 * Codex / Cursor / WorkBuddy 等均通过 Adapter 适配此合同。
 */

export const EXTERNAL_EXECUTOR_STATUSES = [
  'queued',
  'running',
  'waiting_for_input',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type ExternalExecutorStatus = (typeof EXTERNAL_EXECUTOR_STATUSES)[number];

export const CODE_CHANGE_ARTIFACT_TYPE = 'code-change';

export const EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID = 'cap_external_executor_codex';
export const EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID = 'external-executor-codex-cli';

export const CODE_CHANGE_BUNDLE_ROLES = [
  'execution-summary',
  'changed-files',
  'diff',
  'tests',
  'evidence',
  'unresolved-items',
  'manifest',
] as const;
export type CodeChangeBundleRole = (typeof CODE_CHANGE_BUNDLE_ROLES)[number];

export const VERIFICATION_VERDICTS = [
  'satisfied',
  'partially_satisfied',
  'unsatisfied',
  'unverifiable',
] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export const DEFAULT_FORBIDDEN_OPERATIONS = [
  'git_push',
  'git_commit',
  'create_remote_pr',
  'deploy',
  'publish',
  'payment',
  'modify_system_env',
  'delete_repository',
  'read_outside_working_directory',
] as const;

/** 执行输入 — 机器可读任务包（落盘可审计）。 */
export interface ExecutorTaskPackage {
  schemaVersion: 'executor-task-package/1';
  taskId: string;
  jobId: string;
  goal: string;
  acceptanceCriteria: string[];
  projectBrief: string;
  priorDecisions: string[];
  doNotDo: string[];
  workingDirectory: string;
  readScope: string[];
  writeScope: string[];
  forbiddenOperations: string[];
  /** ContextSnapshot 最小必要内容（摘要，非全文 SubjectPackage）。 */
  contextDigest: {
    snapshotId?: string;
    materialPaths: string[];
    subjectDecisionBriefs: string[];
  };
  previousRun?: {
    summary: string;
    changedFiles: string[];
    revisionRequest: string;
  };
  outputContract: {
    requiredParts: CodeChangeBundleRole[];
  };
  timeoutMs: number;
  /** 为何选择此执行器（审计）。 */
  executorSelectionReason: string;
  executorId: string;
  /** Digital Me 自建项目来源（用于受控 skip-git-repo-check）。 */
  projectOrigin?: 'digitalme_created' | 'user_selected' | 'unknown';
}

/** 执行输出 — Adapter 自报部分；权威判定由 Digital Me 独立采集+验证。 */
export interface ExecutorRunResult {
  executorId: string;
  executorRunId: string;
  startedAt: string;
  completedAt?: string;
  status: ExternalExecutorStatus;
  summary: string;
  claimedChangedFiles: string[];
  /** 指向 Digital Me 自采集的 patch 路径（相对 Job 工作目录）。 */
  diffRef?: string;
  testCommands: string[];
  testResults: Array<{
    command: string;
    exitCode: number | null;
    logRef: string;
    passed: boolean;
  }>;
  warnings: string[];
  unresolvedItems: string[];
  questions: Array<{
    text: string;
    answeredBy?: 'digitalme' | 'user';
    answer?: string;
    rationale?: string;
  }>;
  exitCode: number | null;
  workingDirectoryState:
    | 'clean_within_scope'
    | 'out_of_scope_changes'
    | 'unknown';
}

export interface ExecutionBaselineFile {
  relativePath: string;
  /** sha256 of content; null if missing/unreadable */
  digest: string | null;
  size: number;
  kind: 'tracked' | 'untracked' | 'outside_scope_sample';
  /** Job 内备份相对路径（仅授权范围内被改动前备份）。 */
  backupRelPath?: string;
}

export interface ExecutionBaseline {
  schemaVersion: 'execution-baseline/1';
  capturedAt: string;
  workingDirectory: string;
  writeScope: string[];
  readScope: string[];
  git?: {
    head: string | null;
    statusPorcelain: string;
    hasRepo: boolean;
  };
  /** 授权范围内文件摘要（跟踪+未跟踪）。 */
  scopedFiles: ExecutionBaselineFile[];
  /** 范围外抽样摘要（用于越界检测，不备份全文）。 */
  outsideSamples: ExecutionBaselineFile[];
  /** 授权范围树 digest（用于并发编辑检测）。 */
  scopeDigest: string;
}

export interface CollectedChange {
  relativePath: string;
  changeType: 'added' | 'modified' | 'deleted';
  beforeDigest: string | null;
  afterDigest: string | null;
  withinWriteScope: boolean;
}

export interface CollectedExecutionChanges {
  collectedAt: string;
  changes: CollectedChange[];
  changedFiles: string[];
  outOfScopeChanges: string[];
  /** 执行期间基线 scopeDigest 与采集前再算 digest 不一致时为 true。 */
  concurrentModificationSuspected: boolean;
  /** 执行后用户原有 HEAD 是否被移动（禁 commit 核验）。 */
  gitHeadMoved: boolean;
  newCommitsDetected: boolean;
  unifiedDiff: string;
  afterScopeDigest: string;
  untrackedCreated: string[];
  untrackedDeleted: string[];
}

export interface VerificationCheckResult {
  id: string;
  title: string;
  verdict: VerificationVerdict;
  detail: string;
}

export interface ExecutionVerificationReport {
  schemaVersion: 'execution-verification/1';
  generatedAt: string;
  overall: VerificationVerdict;
  checks: VerificationCheckResult[];
  /** 执行器自报仅作证据，不得单独决定 overall。 */
  agentClaimedSuccess: boolean;
  digitalMeVerified: boolean;
}

export function userFacingExecutorStatus(status: ExternalExecutorStatus): string {
  switch (status) {
    case 'queued':
      return '等待开始';
    case 'running':
      return '正在修改项目文件';
    case 'waiting_for_input':
      return '需要你确认后再继续';
    case 'succeeded':
      return '执行完成';
    case 'failed':
      return '执行未完成';
    case 'cancelled':
      return '已取消';
    case 'interrupted':
      return '执行被中断';
    default:
      return '处理中';
  }
}

export function userFacingVerification(verdict: VerificationVerdict): string {
  switch (verdict) {
    case 'satisfied':
      return '已满足验收要求';
    case 'partially_satisfied':
      return '部分满足验收要求';
    case 'unsatisfied':
      return '未满足验收要求';
    case 'unverifiable':
      return '暂时无法完整验证';
    default:
      return '验证结果待确认';
  }
}
