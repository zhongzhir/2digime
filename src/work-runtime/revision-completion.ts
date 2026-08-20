import type { Artifact, ArtifactVersion } from './artifact';
import type { ExecutionJob } from './execution-job';

/** code-change 包用 execution-summary；通用分析包用 report。 */
export const REVISION_BUNDLE_TEXT_ROLES = ['execution-summary', 'report'] as const;

export type ArtifactRevisionSnapshot = {
  id: string;
  jobId?: string;
  headVersionId?: string;
  versionCount: number;
  versionIds: string[];
  headCreatedAt?: string;
  headNote?: string;
};

export function snapshotArtifactRevision(artifact: Artifact | null | undefined): ArtifactRevisionSnapshot | null {
  if (!artifact) return null;
  const head = artifact.versions.find((v) => v.versionId === artifact.headVersionId);
  return {
    id: artifact.id,
    jobId: artifact.jobId,
    headVersionId: artifact.headVersionId,
    versionCount: artifact.versions.length,
    versionIds: artifact.versions.map((v) => v.versionId),
    ...(head?.createdAt ? { headCreatedAt: head.createdAt } : {}),
    ...(head?.note ? { headNote: head.note } : {}),
  };
}

/**
 * 修订收口：新 Artifact ID，或同一 Artifact 的 headVersionId 变化且 versions 数严格增加。
 * 旧成果「本来就有 headVersionId」不得算通过。
 */
export function revisionArtifactAdvanced(
  before: ArtifactRevisionSnapshot | null | undefined,
  after: ArtifactRevisionSnapshot | null | undefined,
): boolean {
  if (!after) return false;
  if (!before) return after.versionCount >= 1 && Boolean(after.headVersionId);
  if (after.id !== before.id) return Boolean(after.headVersionId) && after.versionCount >= 1;
  const headChanged =
    Boolean(after.headVersionId) &&
    Boolean(before.headVersionId) &&
    after.headVersionId !== before.headVersionId;
  const versionsGrew = after.versionCount > before.versionCount;
  return headChanged && versionsGrew;
}

export function pickBundleTextEntry(
  entries: Array<{ role?: string; ref?: string }>,
  preferredRoles: readonly string[] = REVISION_BUNDLE_TEXT_ROLES,
): { role?: string; ref: string } | undefined {
  for (const role of preferredRoles) {
    const hit = entries.find((e) => String(e.role || '') === role && e.ref);
    if (hit?.ref) {
      return hit.role ? { role: hit.role, ref: hit.ref } : { ref: hit.ref };
    }
  }
  return undefined;
}

export function ctoFieldsFingerprint(fields: Record<string, string | undefined> | null | undefined): string {
  if (!fields) return '';
  return ['canUse', 'goalAttained', 'needChange', 'risks', 'nextStep']
    .map((k) => String(fields[k] || '').trim())
    .join('\n---\n');
}

export function ctoFieldsDiffer(
  first: Record<string, string | undefined> | null | undefined,
  second: Record<string, string | undefined> | null | undefined,
): boolean {
  const a = ctoFieldsFingerprint(first);
  const b = ctoFieldsFingerprint(second);
  return Boolean(a) && Boolean(b) && a !== b;
}

/** 降级模板 / 合同失败结论不得当作 Owner 闸门通过。 */
export function ctoConclusionLooksDegraded(text: string): boolean {
  return /验收合同失败|暂时性判断|还不是完整的 AI CTO|暂时无法完成独立验收|尚未形成可核对的独立验收结论|本次验收结论未能形成/.test(
    String(text || ''),
  );
}

export function ownerGateRejectsDegradedCto(input: {
  ctoText?: string;
  ctoContractDegraded?: boolean;
  canAdoptSuggested?: boolean;
}): { pass: boolean; reason?: string } {
  if (input.ctoContractDegraded) return { pass: false, reason: 'cto_contract_degraded' };
  if (ctoConclusionLooksDegraded(String(input.ctoText || ''))) {
    return { pass: false, reason: 'degraded_template' };
  }
  return { pass: true };
}

/**
 * 修订 Job 的成果权威在 targetArtifactId / job.artifactId，而不是 art_${revisionJobId}。
 * 若目标 Artifact.jobId 已指向本 Job，说明版本已写入，启动恢复应补交 succeeded。
 */
export function revisionJobHasCommittedArtifact(input: {
  job: Pick<ExecutionJob, 'id' | 'status' | 'artifactId' | 'targetArtifactId'>;
  existsForDerivedId: boolean;
  artifactByIdExists: boolean;
  targetArtifactJobId?: string;
}): boolean {
  if (input.existsForDerivedId) return true;
  if (input.job.artifactId && input.artifactByIdExists) return true;
  if (!input.job.targetArtifactId) return false;
  if (input.job.status === 'succeeded') return input.artifactByIdExists || Boolean(input.targetArtifactJobId);
  return input.targetArtifactJobId === input.job.id;
}

export function recoverySucceededArtifactId(job: Pick<ExecutionJob, 'id' | 'artifactId' | 'targetArtifactId'>): string {
  return job.targetArtifactId || job.artifactId || `art_${job.id.replace(/^job_/, '')}`;
}

export function headVersionBoundToJob(
  artifact: Artifact | null | undefined,
  jobId: string,
): { ok: boolean; headVersionId?: string; note?: string; artifactJobId?: string } {
  if (!artifact) return { ok: false };
  const head: ArtifactVersion | undefined = artifact.versions.find(
    (v) => v.versionId === artifact.headVersionId,
  );
  const artifactJobMatches = artifact.jobId === jobId;
  const noteMentionsJob = Boolean(head?.note && head.note.includes(jobId));
  return {
    ok: artifactJobMatches || noteMentionsJob,
    headVersionId: artifact.headVersionId,
    ...(head?.note ? { note: head.note } : {}),
    artifactJobId: artifact.jobId,
  };
}
