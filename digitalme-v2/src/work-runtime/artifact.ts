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
