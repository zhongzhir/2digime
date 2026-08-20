/**
 * Artifact 验收事实：当前 CTO 结论的唯一权威位置。
 * 新写入只落 Artifact.acceptance；codeChange.acceptanceSummary 仅作历史只读兼容。
 * 不新增评价类型或状态机。
 */
import type { Artifact, ArtifactAcceptance } from './artifact';
import type { OwnerAcceptanceSummary } from '../execution/acceptance-summary';
import { CTO_CONTRACT_DEGRADED_MARKER } from '../execution/ai-cto-review';

export const ACCEPTANCE_REVIEW_FAILED_MESSAGE =
  '成果已生成，但验收说明暂未完成，可重试。';

export type AcceptanceResolveSource = 'artifact' | 'legacy_code_change';

export interface ResolvedAcceptance {
  source: AcceptanceResolveSource;
  artifactVersionId: string;
  jobId?: string;
  status: 'ready' | 'failed';
  updatedAt?: string;
  summary?: OwnerAcceptanceSummary;
  failureMessage?: string;
}

export function isSuccessfulCtoSummary(
  summary: OwnerAcceptanceSummary | undefined | null,
): boolean {
  if (!summary) return false;
  const report = String(summary.ctoReport || '').trim();
  if (!report) return false;
  if (summary.ctoContractDegraded) return false;
  const review = summary.ctoReview as { ctoContractDegraded?: boolean } | undefined;
  if (review?.ctoContractDegraded) return false;
  if (report.includes(CTO_CONTRACT_DEGRADED_MARKER)) return false;
  return true;
}

/**
 * 当前 head 版本的唯一 CTO 结论。
 * 优先 Artifact.acceptance；仅当通用位置缺失时只读旧 codeChange 摘要。
 */
export function resolveCurrentAcceptance(
  artifact: Artifact,
  headVersionId: string,
  legacySummary?: OwnerAcceptanceSummary | null,
): ResolvedAcceptance | null {
  const current = artifact.acceptance;
  if (current && current.artifactVersionId === headVersionId) {
    if (current.status === 'failed') {
      return {
        source: 'artifact',
        artifactVersionId: current.artifactVersionId,
        jobId: current.jobId,
        status: 'failed',
        updatedAt: current.updatedAt,
        failureMessage: current.failureMessage || ACCEPTANCE_REVIEW_FAILED_MESSAGE,
      };
    }
    const summary = current.summary as OwnerAcceptanceSummary | undefined;
    if (current.status === 'ready' && isSuccessfulCtoSummary(summary)) {
      return {
        source: 'artifact',
        artifactVersionId: current.artifactVersionId,
        jobId: current.jobId,
        status: 'ready',
        updatedAt: current.updatedAt,
        ...(summary ? { summary } : {}),
      };
    }
    if (current.status === 'ready' && !isSuccessfulCtoSummary(summary)) {
      return {
        source: 'artifact',
        artifactVersionId: current.artifactVersionId,
        jobId: current.jobId,
        status: 'failed',
        updatedAt: current.updatedAt,
        failureMessage: ACCEPTANCE_REVIEW_FAILED_MESSAGE,
      };
    }
  }
  if (isSuccessfulCtoSummary(legacySummary)) {
    return {
      source: 'legacy_code_change',
      artifactVersionId: headVersionId,
      status: 'ready',
      summary: legacySummary as OwnerAcceptanceSummary,
    };
  }
  return null;
}

export function asArtifactAcceptance(input: {
  artifactVersionId: string;
  jobId: string;
  status: 'ready' | 'failed';
  summary?: OwnerAcceptanceSummary;
  failureMessage?: string;
  updatedAt: string;
}): ArtifactAcceptance {
  return {
    artifactVersionId: input.artifactVersionId,
    jobId: input.jobId,
    status: input.status,
    updatedAt: input.updatedAt,
    ...(input.status === 'ready' && input.summary ? { summary: input.summary } : {}),
    ...(input.status === 'failed'
      ? { failureMessage: input.failureMessage || ACCEPTANCE_REVIEW_FAILED_MESSAGE }
      : {}),
  };
}
