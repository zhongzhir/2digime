/**
 * Artifact — 一等成果对象(domain model §2.6)。
 * 用户编辑追加 user 版本并移动 head;不存在"采用结果"概念。
 * P0.1:版本内容为 text/file/bundle 三形内容引用,支撑非文本成果类型
 * 而不改对象集;Artifact id 由 jobId 确定性派生,保障幂等提交。
 */
export type ArtifactContent =
  | { kind: 'text'; format: 'markdown' | 'plain'; ref: string }
  | { kind: 'file'; ref: string; mediaType: string }
  | { kind: 'bundle'; entries: Array<{ ref: string; mediaType: string; role?: string }> };

/** 协作交付物化溯源：复制完整内容但保留对方 artifact/version/digest 与约定绑定。 */
export interface ArtifactProvenance {
  kind: 'collaboration_delivery';
  recordId: string;
  sourceSubjectId: string;
  sourceArtifactId: string;
  sourceHeadVersionId: string;
  sourceContentDigest: string;
  agreementTermsDigest: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  jobId: string;
  subjectId: string;
  createdAt: string;
  /** 首切片仅 'document';随 Adapter 扩展。 */
  type: string;
  title: string;
  versions: ArtifactVersion[];
  headVersionId: string;
  /** 磁盘目录,支持"打开所在目录";content ref 相对此目录解析。 */
  storageDir: string;
  provenance?: ArtifactProvenance;
  /**
   * 当前 CTO 验收结论的唯一权威位置（按 head 版本绑定）。
   * 新写入只落这里；不得再把同一结论写入 codeChange.acceptanceSummary。
   */
  acceptance?: ArtifactAcceptance;
}

/** 与 OwnerAcceptanceSummary 同形，避免为文档任务复制评价类型。 */
export interface ArtifactAcceptanceSummary {
  title: string;
  headline?: string;
  executionStatusLabel?: string;
  goalLabel: string;
  goalVerdict?: string;
  recommendation: string;
  bullets: string[];
  technicalBullets?: string[];
  adoptWarnings?: string[];
  canAdoptSuggested: boolean;
  ctoReport?: string;
  primaryAction?: string;
  userFacingNextStep?: string;
  revisionDirective?: string;
  ctoReview?: unknown;
  ctoContractDegraded?: boolean;
}

export interface ArtifactAcceptance {
  artifactVersionId: string;
  jobId: string;
  status: 'ready' | 'failed';
  updatedAt: string;
  summary?: ArtifactAcceptanceSummary;
  failureMessage?: string;
}

export interface ArtifactVersion {
  versionId: string;
  createdAt: string;
  author: 'capability' | 'user';
  content: ArtifactContent;
  note?: string;
}

/**
 * 幂等提交锚点:一个 Job 至多一个 Artifact,id 由 jobId 确定性派生。
 * 重复提交/崩溃后补交写同一 id,不会产生第二个权威 Artifact。
 */
export function artifactIdForJob(jobId: string): string {
  return `art_${jobId.replace(/^job_/, '')}`;
}

export function headVersion(artifact: Artifact): ArtifactVersion {
  const head = artifact.versions.find((v) => v.versionId === artifact.headVersionId);
  if (!head) {
    throw new Error(`artifact ${artifact.id} head version ${artifact.headVersionId} missing`);
  }
  return head;
}
