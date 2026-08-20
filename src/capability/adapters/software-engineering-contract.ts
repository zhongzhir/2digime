/**
 * P2B 软件工程可编译契约。
 * 见 docs/design/digitalme_v2_software_engineering_architecture.md 等。
 *
 * 本切片已实现边界（P2B.1）：
 * - isolated workspace / replaceable coding-agent route / change proposal /
 *   independent verification / agent 不得写原仓库。
 *
 * 明确尚未实现：
 * - controlled apply（repository_apply）
 * - git commit action
 * - push / deploy
 *
 * 硬纪律：
 * - 不新增永久 Store；成果类型为 Artifact 字符串；
 * - Coding Agent 默认权限 ⊆ L1；
 * - 验证判定三分，不得与 Job 五态混用；
 * - coding-agent-codex 为编排适配器，不写入 ADAPTER_TYPES 生产白名单（仅 PROPOSED_*）。
 */
import type { CapabilityPermission } from '../registration';

/** P2B 提议的成果类型（扩展现有 document | code-analysis）。 */
export const ENGINEERING_ARTIFACT_TYPES = [
  'engineering-plan',
  'code-change',
  'verification',
  'deployment',
] as const;
export type EngineeringArtifactType = (typeof ENGINEERING_ARTIFACT_TYPES)[number];

/** 与 P2A 并存的任务显式类型封闭表（规格视图；生产 REQUESTED_ARTIFACT_TYPES 实现时再合并）。 */
export const P2B_REQUESTED_ARTIFACT_TYPES = [
  'document',
  'code-analysis',
  ...ENGINEERING_ARTIFACT_TYPES,
] as const;
export type P2BRequestedArtifactType = (typeof P2B_REQUESTED_ARTIFACT_TYPES)[number];

/** 权限层级。 */
export const ENGINEERING_PERMISSION_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type EngineeringPermissionLevel = (typeof ENGINEERING_PERMISSION_LEVELS)[number];

/**
 * Grant scope.actions 提议扩展（相对现有 CapabilityPermission）。
 * 实现阶段再并入 registration / collaboration schema。
 */
export const ENGINEERING_GRANT_ACTIONS = [
  'filesystem_read',
  'workspace_write',
  'command_execute',
  'network',
  'secret_access',
  'repository_apply',
  'git_commit',
  'git_push',
  'deployment',
  'credential_use',
] as const;
export type EngineeringGrantAction = (typeof ENGINEERING_GRANT_ACTIONS)[number];

export const L0_ACTIONS = ['filesystem_read'] as const satisfies readonly EngineeringGrantAction[];
export const L1_ACTIONS = ['workspace_write', 'command_execute'] as const satisfies readonly EngineeringGrantAction[];
/** L2/L3 为权限封闭表占位；P2B.1 未实现 apply / commit / push / deploy。 */
export const L2_ACTIONS = ['repository_apply', 'git_commit'] as const satisfies readonly EngineeringGrantAction[];
export const L3_ACTIONS = ['git_push', 'deployment', 'credential_use'] as const satisfies readonly EngineeringGrantAction[];

export function maxPermissionLevel(actions: readonly string[]): EngineeringPermissionLevel {
  const set = new Set(actions);
  if ([...L3_ACTIONS].some((a) => set.has(a))) return 'L3';
  if ([...L2_ACTIONS].some((a) => set.has(a))) return 'L2';
  if ([...L1_ACTIONS].some((a) => set.has(a))) return 'L1';
  return 'L0';
}

/** Coding Agent 默认允许的 actions — 必须 ⊆ L1。 */
export const CODING_AGENT_DEFAULT_ACTIONS: readonly EngineeringGrantAction[] = [...L1_ACTIONS];

export function isCodingAgentDefaultWithinL1(): boolean {
  return maxPermissionLevel(CODING_AGENT_DEFAULT_ACTIONS) === 'L1';
}

export function codingAgentMayHold(actions: readonly string[]): boolean {
  return maxPermissionLevel(actions) === 'L0' || maxPermissionLevel(actions) === 'L1';
}

/** 提议 Adapter 类型（未写入生产 ADAPTER_TYPES）。 */
export const PROPOSED_ADAPTER_TYPES = [
  'coding-agent-cli',
] as const;

export const CTO_ENGINEERING_CAPABILITY_ID = 'cap_cto_engineering';
export const CTO_ENGINEERING_ADAPTER_ID = 'cto-engineering';

export const ENGINEERING_PLAN_SCHEMA_VERSION = 'engineering-plan/1';
export const CODE_CHANGE_SCHEMA_VERSION = 'code-change/1';
export const VERIFICATION_SCHEMA_VERSION = 'verification/1';
export const DEPLOYMENT_SCHEMA_VERSION = 'deployment/1';

export const ENGINEERING_PLAN_ROLES = ['plan', 'manifest'] as const;
export const CODE_CHANGE_ROLES = [
  'summary',
  'patch',
  'changed-files',
  'manifest',
  'risks',
  'verification-plan',
] as const;
export const VERIFICATION_ROLES = ['summary', 'checks', 'manifest', 'logs', 'screenshots'] as const;

/** 验证判定来源 — 与 Job 五态正交。 */
export const VERDICT_SOURCES = ['agent_claimed', 'digitalme_verified', 'owner_accepted'] as const;
export type VerdictSource = (typeof VERDICT_SOURCES)[number];

export const CHANGE_VERIFICATION_STATUSES = [
  'pending',
  'agent_claimed',
  'digitalme_verified',
  'failed',
  'owner_accepted',
] as const;
export type ChangeVerificationStatus = (typeof CHANGE_VERIFICATION_STATUSES)[number];

/** Artifact / manifest 质量档 — 不新增 Job 状态。 */
export const ARTIFACT_QUALITY_GRADES = ['usable', 'needs_attention', 'degraded_scan_only'] as const;
export type ArtifactQualityGrade = (typeof ARTIFACT_QUALITY_GRADES)[number];

export interface ArtifactQualityMeta {
  grade: ArtifactQualityGrade;
  reasons: string[];
}

export interface EngineeringPlanManifest {
  schemaVersion: typeof ENGINEERING_PLAN_SCHEMA_VERSION;
  generatedAt: string;
  goalDigest: string;
  snapshotId: string;
  stages: Array<{
    id: string;
    title: string;
    acceptanceCriteria: string[];
    requiredPermissionLevel: EngineeringPermissionLevel;
    ownerDecisionRequired: boolean;
  }>;
  requiredPermissionLevel: EngineeringPermissionLevel;
  ownerDecisionRequired: boolean;
  generatedBy: { capabilityId: string; adapterId: string };
}

export interface CodeChangeManifest {
  schemaVersion: typeof CODE_CHANGE_SCHEMA_VERSION;
  generatedAt: string;
  baseRevision: string | null;
  baseDigest: string;
  workspaceId: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
  generatedBy: { capabilityId: string; adapterId: string };
  authorizationGrantId: string;
  verificationStatus: ChangeVerificationStatus;
  unresolvedIssues: string[];
  quality?: ArtifactQualityMeta;
}

export interface VerificationCheck {
  name: string;
  commandOrActionSummary: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  evidenceRef?: string;
  failureSummary?: string;
  reproducible: boolean;
  verdictSource: VerdictSource;
}

export interface VerificationManifest {
  schemaVersion: typeof VERIFICATION_SCHEMA_VERSION;
  generatedAt: string;
  workspaceId?: string;
  changeArtifactId?: string;
  checks: VerificationCheck[];
  overall: 'passed' | 'failed' | 'mixed';
  /** 关闭「可应用」门时至少需要 digitalme_verified。 */
  digitalMeVerified: boolean;
}

/** UI 派生进度 — 禁止落盘为第二事实状态。 */
export const ENGINEERING_UI_PHASES = [
  'planning',
  'implementing',
  'verifying',
  'awaiting_decision',
  'delivered',
] as const;
export type EngineeringUiPhase = (typeof ENGINEERING_UI_PHASES)[number];

export const GROWTH_ENGINEERING_TAGS = [
  'architecture_decision',
  'engineering_failure',
  'verified_workflow',
  'tool_performance',
] as const;

/** 现有 CapabilityPermission 与工程 Grant 的交集（兼容检查用）。 */
export const LEGACY_CAPABILITY_PERMISSIONS = [
  'network',
  'filesystem_read',
  'filesystem_write',
  'secret_access',
] as const satisfies readonly CapabilityPermission[];

/**
 * 质量门：仅 agent_claimed 不足以视为可交付验证通过。
 */
export function isDeliverableVerification(status: ChangeVerificationStatus): boolean {
  return status === 'digitalme_verified' || status === 'owner_accepted';
}

/**
 * Change proposal 最低完备性（规格守卫）。
 */
export function assertChangeProposalComplete(input: {
  hasPatch: boolean;
  baseDigest: string;
  changedFiles: string[];
  wroteUserRepo: boolean;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.hasPatch) reasons.push('missing_patch');
  if (!input.baseDigest) reasons.push('missing_base_digest');
  if (!input.changedFiles.length) reasons.push('missing_changed_files');
  if (input.wroteUserRepo) reasons.push('agent_wrote_user_repo');
  return { ok: reasons.length === 0, reasons };
}
