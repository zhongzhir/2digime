/**
 * Collaboration Core schema — 主体协作合同。
 * CollaborationRecord 承载提议/协商/约定/交付事件；AuthorizationGrant 仅表达单方授权。
 * 部署位置不进入 Record；方案与身份不绑定 scheme:'local'。
 */
import type { JobStatus } from '../work-runtime/execution-job';
import type { CapabilityPermission } from '../capability/registration';

/** 稳定主体引用（无部署位置、无 scheme 长期合同）。 */
export interface SubjectRef {
  subjectId: string;
  displayName: string;
  /** 可解析端点引用；具体路径仅由 Transport 解析。 */
  endpointRef: string;
}

/** @deprecated 仅测试替身保留；生产路径使用 SubjectRef。 */
export interface SubjectIdentifier {
  subjectId: string;
  displayName: string;
  scheme?: string;
}

export interface CapabilityProfile {
  subjectId: string;
  offerings: Array<{
    capabilityId: string;
    description: string;
    outputArtifactTypes: string[];
  }>;
}

/** @deprecated 由 CollaborationRecord.proposal 取代。 */
export interface InteractionRequest {
  id: string;
  fromSubject: SubjectIdentifier;
  toSubject: SubjectIdentifier;
  requestedScope: AuthorizationScope;
  goal: string;
  createdAt: string;
  mode: 'local_simulation';
}

export interface AuthorizationScope {
  actions: Array<CapabilityPermission | string>;
  resourceRefs?: string[];
}

export type GranteeRef =
  | { kind: 'capability'; capabilityId: string }
  | { kind: 'remote_subject'; subjectId: string };

export type GrantOrigin =
  | { kind: 'owner_direct' }
  | {
      kind: 'interaction_request';
      requestId: string;
      requestSummary: { fromDisplayName: string; goal: string };
    }
  | {
      kind: 'collaboration_agreement';
      recordId: string;
      agreementEventId: string;
      termsDigest: string;
    };

export const LOCAL_COLLAB_ACTIONS = [
  'read_authorized_context',
  'execute_subtask',
  'return_artifact',
] as const;

export type LocalCollabAction = (typeof LOCAL_COLLAB_ACTIONS)[number];

export type CollabUserStatus =
  | 'proposed'
  | 'awaiting_clarification'
  | 'counter_proposed'
  | 'awaiting_owner'
  | 'agreed'
  | 'authorized'
  | 'running'
  | 'delivered'
  | 'completed'
  | 'rejected'
  | 'revoked'
  | 'failed'
  | 'withdrawn';

/** 纯授权对象 — 不得承载协作状态/摘录/包路径。 */
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
  /**
   * 兼容旧 Grant 只读字段（不再写入新协作路径）。
   * @deprecated
   */
  issuerTaskId?: string;
  /** @deprecated */
  subtaskGoal?: string;
  /** @deprecated */
  granteePackageDir?: string;
  /** @deprecated */
  granteeDisplayName?: string;
  /** @deprecated */
  disclosure?: {
    snapshotId?: string;
    jobId?: string;
    materialSummaries: Array<{ path: string; contentDigest?: string }>;
    sentAt: string;
    reachedModel?: boolean;
    capabilityId?: string;
    modelTokens?: number;
    capabilityDurationMs?: number;
  };
  /** @deprecated */
  returnedArtifact?: {
    artifactId: string;
    subjectId: string;
    headVersionId: string;
    title?: string;
    textExcerpt?: string;
    reachedModel?: boolean;
  };
  /** @deprecated */
  lastFailure?: { at: string; message: string };
}

export interface CollaborationProposalTerms {
  intent: string;
  expectedOutcome: string;
  offeredMaterials: Array<{ path: string; summary?: string }>;
  deadline?: string;
  costTerms?: string;
  acceptanceCriteria: string[];
}

export type CollaborationEventKind =
  | 'proposed'
  | 'clarification_requested'
  | 'clarified'
  | 'counter_proposed'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'agreement_formed'
  | 'grant_issued'
  | 'fulfillment_started'
  | 'delivered'
  | 'revision_requested'
  | 'revoked'
  | 'result_decided'
  | 'owner_confirmation_required';

export interface CollaborationEvent {
  eventId: string;
  kind: CollaborationEventKind;
  authorSubjectId: string;
  at: string;
  /** 接受/还价/成约时必须绑定同一条款 digest。 */
  termsDigest?: string;
  terms?: CollaborationProposalTerms;
  note?: string;
  grantId?: string;
  taskId?: string;
  jobId?: string;
  delivery?: CollaborationDeliveryRef;
  selfCheck?: {
    passed: boolean;
    notes: string[];
  };
  verification?: {
    /** 仅 A 侧最终判断写入。 */
    satisfied?: boolean;
    notes: string[];
  };
  decision?: 'accept' | 'revise' | 'reject';
  artifactDecisionRef?: string;
  localArtifactId?: string;
  localHeadVersionId?: string;
  requiresOwnerConfirmation?: boolean;
  evaluationBasis?: string[];
  /**
   * 跨主体交付内容（仅 `delivered` 事件、远端路径承载）。
   * 供发起方在不打开对端本地包的情况下物化成果；不发完整 SubjectPackage。
   * 属于运行态传输字段，不构成新的持久业务 schema。
   */
  artifactText?: string;
  /**
   * 签发授权的完整副本（仅 `grant_issued` 事件、远端路径承载）。
   * 供发起方在不打开对端本地包的情况下重建授权；非持久业务 schema。
   */
  grant?: AuthorizationGrant;
}

export interface CollaborationDeliveryRef {
  sourceSubjectId: string;
  sourceArtifactId: string;
  sourceHeadVersionId: string;
  contentDigest: string;
  agreementEventId: string;
  termsDigest: string;
}

/**
 * 协作记录 — 权威 = append-only 事件流。
 * 双方各持已接收事件副本；不得修改已有事件。
 */
export interface CollaborationRecord {
  id: string;
  recordId: string;
  initiator: SubjectRef;
  responder: SubjectRef;
  /** 初始提议快照（条款变更以事件为准）。 */
  proposal: CollaborationProposalTerms;
  events: CollaborationEvent[];
  createdAt: string;
  updatedAt: string;
  /** 关联发起方侧任务（可选）。 */
  issuerTaskId?: string;
}

/** @deprecated 由 CollaborationRecord 事件吸收。 */
export interface CollaborationJob {
  id: string;
  requestId: string;
  grantId: string;
  status: JobStatus;
  createdAt: string;
}

/** @deprecated */
export interface VerificationResult {
  collaborationJobId: string;
  verdict: 'accepted' | 'rejected';
  note?: string;
  verifiedAt: string;
}

/** @deprecated */
export interface SettlementRecord {
  collaborationJobId: string;
  status: 'not_implemented';
}

/** @deprecated */
export interface ReputationEvent {
  subjectId: string;
  collaborationJobId: string;
  kind: 'positive' | 'negative';
  occurredAt: string;
}
