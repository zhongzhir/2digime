/**
 * Collaboration Core schema(domain model §2.8、§3)。
 * 本阶段:schema + 接口边界 + 本地模拟;不实现开放网络、交易市场、支付。
 * 持久对象仅 AuthorizationGrant;其余为契约占位。
 * P0.1:AuthorizationGrant 泛化为能力授权与主体协作授权共用;
 * origin 内嵌请求快照,消除对非持久 InteractionRequest 的悬空引用。
 */
import type { JobStatus } from '../work-runtime/execution-job';
import type { CapabilityPermission } from '../capability/registration';

export interface SubjectIdentifier {
  subjectId: string;
  displayName: string;
  /** 本阶段为本地标识;开放网络形态后置。 */
  scheme: 'local';
}

export interface CapabilityProfile {
  subjectId: string;
  /** 从 CapabilityRegistration 派生的可分享投影。 */
  offerings: Array<{
    capabilityId: string;
    description: string;
    outputArtifactTypes: string[];
  }>;
}

export interface InteractionRequest {
  id: string;
  fromSubject: SubjectIdentifier;
  toSubject: SubjectIdentifier;
  requestedScope: AuthorizationScope;
  goal: string;
  createdAt: string;
  /** 本阶段恒为 local_simulation。 */
  mode: 'local_simulation';
}

export interface AuthorizationScope {
  /** 能力授权时为 CapabilityPermission;协作授权时为协作动作。 */
  actions: Array<CapabilityPermission | string>;
  resourceRefs?: string[];
}

/** 被授权方 — 能力与远端主体共用同一授权对象。 */
export type GranteeRef =
  | { kind: 'capability'; capabilityId: string }
  | { kind: 'remote_subject'; subjectId: string };

/** 授权来源 — 内嵌请求快照,不悬空引用非持久对象。 */
export type GrantOrigin =
  | { kind: 'owner_direct' }
  | {
      kind: 'interaction_request';
      requestId: string;
      /** 请求要点快照(请求本体非持久,快照随 Grant 落盘)。 */
      requestSummary: { fromDisplayName: string; goal: string };
    };

/** 本机协作允许的动作（首轮封闭）。 */
export const LOCAL_COLLAB_ACTIONS = [
  'read_authorized_context',
  'execute_subtask',
  'return_artifact',
] as const;

export type LocalCollabAction = (typeof LOCAL_COLLAB_ACTIONS)[number];

/** 用户面协作投影（派生，非独立权威状态机）。 */
export type CollabUserStatus =
  | 'requested'
  | 'authorized'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'revoked'
  | 'failed';

/** 最小权威对象 #8 — 持久化。 */
export interface AuthorizationGrant {
  id: string;
  grantorSubjectId: string;
  grantee: GranteeRef;
  scope: AuthorizationScope;
  origin: GrantOrigin;
  status: 'granted' | 'revoked' | 'expired';
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  /** 本机双包协作扩展（能力授权形态可缺省）。 */
  issuerTaskId?: string;
  subtaskGoal?: string;
  granteePackageDir?: string;
  granteeDisplayName?: string;
  /** 实际披露给 B 的材料与快照溯源（执行后写入）。 */
  disclosure?: {
    snapshotId?: string;
    jobId?: string;
    materialSummaries: Array<{ path: string; contentDigest?: string }>;
    sentAt: string;
    /** 是否实际到达模型 Adapter（非 Fake/模板）。 */
    reachedModel?: boolean;
    capabilityId?: string;
    modelTokens?: number;
    capabilityDurationMs?: number;
  };
  returnedArtifact?: {
    artifactId: string;
    subjectId: string;
    headVersionId: string;
    title?: string;
    textExcerpt?: string;
    reachedModel?: boolean;
  };
  lastFailure?: { at: string; message: string };
}

/** 复用 ExecutionJob 五态语义;未来经 remote-subject Adapter 落地。 */
export interface CollaborationJob {
  id: string;
  requestId: string;
  grantId: string;
  status: JobStatus;
  createdAt: string;
}

export interface VerificationResult {
  collaborationJobId: string;
  verdict: 'accepted' | 'rejected';
  note?: string;
  verifiedAt: string;
}

export interface SettlementRecord {
  collaborationJobId: string;
  /** 支付结算不在本阶段实现;占位契约。 */
  status: 'not_implemented';
}

export interface ReputationEvent {
  subjectId: string;
  collaborationJobId: string;
  kind: 'positive' | 'negative';
  occurredAt: string;
}
