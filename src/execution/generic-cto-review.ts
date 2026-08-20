/**
 * 通用 AI CTO 成果评价入口。
 * 文档、研究、代码及任意产生 Artifact 的成功 Job 走同一套评价；
 * 代码 diff / 测试只是可选增强，不是启动验收的前提。
 */
import type { ExecutionJob } from '../work-runtime/execution-job';
import type { Task } from '../work-runtime/task';
import type { Artifact } from '../work-runtime/artifact';
import type { ContextSnapshot } from '../work-runtime/context-snapshot';
import {
  buildMaterialEvidence,
  type MaterialEvidence,
} from '../work-runtime/material-summary';
import type { OwnerAcceptanceSummary } from './acceptance-summary';
import { buildOwnerAcceptanceSummaryAsync } from './acceptance-summary';
import {
  buildAiCtoEvidencePack,
  type AiCtoEvidencePack,
  type CtoReviewChat,
} from './ai-cto-review';
import type { CtoReviewInput } from './cto-review';
import {
  ACCEPTANCE_REVIEW_FAILED_MESSAGE,
  isSuccessfulCtoSummary,
} from '../work-runtime/artifact-acceptance';
import { excerptsFromGenericDiff } from './generic-cto-excerpts';

export interface GenericCtoEvidence {
  taskGoal: string;
  confirmedPlan?: { version: number; content: string };
  artifactId: string;
  artifactVersionId: string;
  jobId: string;
  artifactBody?: string;
  jobExecutionReport?: string;
  originalTaskGoal?: string;
  revisionRequest?: string;
  testResults?: Array<{ command: string; passed: boolean; summary?: string }>;
  changedFiles?: string[];
  changedFileCount?: number;
  unifiedDiff?: string;
  changedFileExcerpts?: Array<{ path: string; excerpt: string }>;
  verification?: CtoReviewInput['verification'];
  directoryChangedSinceResult?: boolean;
  unresolvedItems?: string[];
  agentSummaryExcerpt?: string;
  materials?: MaterialEvidence;
}

export interface GenericCtoReviewResult {
  status: 'ready' | 'failed';
  summary?: OwnerAcceptanceSummary;
  failureMessage?: string;
  evidencePack: AiCtoEvidencePack;
}

const EMPTY_VERIFICATION: CtoReviewInput['verification'] = {
  overall: 'unverifiable',
  checks: [],
  digitalMeVerified: false,
  agentClaimedSuccess: false,
};

export function formatJobExecutionReport(job: ExecutionJob): string {
  const parts: string[] = [];
  if (job.status === 'succeeded') parts.push('本轮处理已经完成。');
  const ms = job.costActual?.durationMs;
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
    const sec = Math.max(1, Math.round(ms / 1000));
    parts.push(sec >= 60 ? `用时约 ${Math.max(1, Math.round(sec / 60))} 分钟。` : `用时约 ${sec} 秒。`);
  }
  return parts.join('');
}

export function collectGenericCtoEvidence(input: {
  task: Task;
  job: ExecutionJob;
  artifact: Artifact;
  artifactVersionId: string;
  artifactBody?: string;
  codeChange?: {
    summary?: string;
    testResults?: Array<{ command: string; passed?: boolean; summary?: string }>;
    changedFiles?: string[];
    changes?: Array<{ path: string }>;
    unifiedDiff?: string;
    verificationOverall?: string;
    checks?: Array<{
      id: string;
      title: string;
      verdict: 'satisfied' | 'partially_satisfied' | 'unsatisfied' | 'unverifiable';
      detail?: string;
    }>;
    directoryChangedSinceResult?: boolean;
    digitalMeVerified?: boolean;
    agentClaimedSuccess?: boolean;
    unresolvedItems?: string[];
    revisionRequest?: string;
  };
  snapshot?: ContextSnapshot | null;
}): GenericCtoEvidence {
  const { task, job, artifact, codeChange } = input;
  const changedFiles =
    codeChange?.changedFiles ||
    (codeChange?.changes || []).map((c) => c.path).filter(Boolean);
  const testResults = (codeChange?.testResults || [])
    .filter((t) => t.command)
    .map((t) => ({
      command: String(t.command),
      passed: !!t.passed,
      ...(t.summary ? { summary: String(t.summary) } : {}),
    }));
  const excerpts =
    codeChange?.unifiedDiff && changedFiles.length
      ? excerptsFromGenericDiff(codeChange.unifiedDiff, changedFiles)
      : undefined;
  const verification = codeChange?.verificationOverall
    ? {
        overall: codeChange.verificationOverall as CtoReviewInput['verification']['overall'],
        checks: (codeChange.checks || []).map((c) => ({
          id: c.id,
          title: c.title,
          verdict: c.verdict,
          detail: String(c.detail || ''),
        })),
        digitalMeVerified: !!codeChange.digitalMeVerified,
        agentClaimedSuccess: !!codeChange.agentClaimedSuccess,
      }
    : undefined;
  return {
    taskGoal: String(task.goal || '').trim(),
    originalTaskGoal: String(task.goal || '').trim(),
    ...(job.confirmedPlanSnapshot
      ? {
          confirmedPlan: {
            version: job.confirmedPlanSnapshot.version,
            content: String(job.confirmedPlanSnapshot.content || ''),
          },
        }
      : {}),
    artifactId: artifact.id,
    artifactVersionId: input.artifactVersionId,
    jobId: job.id,
    ...(input.artifactBody ? { artifactBody: input.artifactBody } : {}),
    jobExecutionReport: formatJobExecutionReport(job),
    ...(job.revisionRequest || codeChange?.revisionRequest
      ? { revisionRequest: String(job.revisionRequest || codeChange?.revisionRequest || '') }
      : {}),
    ...(testResults.length ? { testResults } : {}),
    ...(changedFiles.length ? { changedFiles, changedFileCount: changedFiles.length } : {}),
    ...(codeChange?.unifiedDiff ? { unifiedDiff: codeChange.unifiedDiff } : {}),
    ...(excerpts?.length ? { changedFileExcerpts: excerpts } : {}),
    ...(verification ? { verification } : {}),
    ...(codeChange?.directoryChangedSinceResult != null
      ? { directoryChangedSinceResult: codeChange.directoryChangedSinceResult }
      : {}),
    ...(codeChange?.unresolvedItems?.length ? { unresolvedItems: codeChange.unresolvedItems } : {}),
    ...(codeChange?.summary ? { agentSummaryExcerpt: codeChange.summary } : {}),
    materials: buildMaterialEvidence({
      ...(input.snapshot?.items ? { snapshotItems: input.snapshot.items } : {}),
      ...(task.contextRefs?.length ? { contextRefs: task.contextRefs } : {}),
      ...(job.materialUse ? { materialUse: job.materialUse } : {}),
    }),
  };
}

export function toCtoReviewInput(evidence: GenericCtoEvidence): CtoReviewInput {
  const planSteps = String(evidence.confirmedPlan?.content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  const changedFileCount = evidence.changedFileCount ?? evidence.changedFiles?.length ?? 0;
  return {
    userGoal: evidence.taskGoal,
    ...(evidence.originalTaskGoal ? { originalTaskGoal: evidence.originalTaskGoal } : {}),
    ...(evidence.revisionRequest ? { revisionRequest: evidence.revisionRequest } : {}),
    currentRoundAuthority: evidence.revisionRequest ? 'owner_revision' : 'initial_task',
    ...(planSteps.length ? { planSteps } : {}),
    ...(evidence.confirmedPlan ? { confirmedPlan: evidence.confirmedPlan } : {}),
    ...(evidence.artifactBody ? { artifactBody: evidence.artifactBody } : {}),
    ...(evidence.jobExecutionReport ? { jobExecutionReport: evidence.jobExecutionReport } : {}),
    verification: evidence.verification || EMPTY_VERIFICATION,
    changedFileCount,
    ...(evidence.changedFiles?.length ? { changedFiles: evidence.changedFiles } : {}),
    ...(evidence.directoryChangedSinceResult != null
      ? { directoryChangedSinceResult: evidence.directoryChangedSinceResult }
      : {}),
    ...(evidence.unresolvedItems?.length ? { unresolvedItems: evidence.unresolvedItems } : {}),
    ...(evidence.agentSummaryExcerpt ? { agentSummaryExcerpt: evidence.agentSummaryExcerpt } : {}),
    ...(evidence.materials ? { materials: evidence.materials } : {}),
    artifactVersionId: evidence.artifactVersionId,
    jobId: evidence.jobId,
    ...(evidence.testResults?.length ? { testResults: evidence.testResults } : {}),
    ...(evidence.changedFileExcerpts?.length
      ? { changedFileExcerpts: evidence.changedFileExcerpts }
      : {}),
  };
}

export async function runGenericArtifactCtoReview(
  evidence: GenericCtoEvidence,
  chat: CtoReviewChat | null | undefined,
): Promise<GenericCtoReviewResult> {
  const input = toCtoReviewInput(evidence);
  const evidencePack = buildAiCtoEvidencePack(input);
  try {
    const summary = await buildOwnerAcceptanceSummaryAsync(
      {
        verification: input.verification,
        changedFileCount: input.changedFileCount,
        ...(input.directoryChangedSinceResult != null
          ? { directoryChangedSinceResult: input.directoryChangedSinceResult }
          : {}),
        ...(input.unresolvedItems ? { unresolvedItems: input.unresolvedItems } : {}),
        ...(input.agentSummaryExcerpt ? { summaryExcerpt: input.agentSummaryExcerpt } : {}),
        ...(input.changedFiles
          ? {
              evidence: {
                changedFiles: input.changedFiles,
                ...(evidence.unifiedDiff ? { unifiedDiff: evidence.unifiedDiff } : {}),
              },
            }
          : {}),
        userGoal: input.userGoal,
        ...(input.originalTaskGoal ? { originalTaskGoal: input.originalTaskGoal } : {}),
        ...(input.revisionRequest ? { revisionRequest: input.revisionRequest } : {}),
        ...(input.currentRoundAuthority
          ? { currentRoundAuthority: input.currentRoundAuthority }
          : {}),
        ...(input.planSteps ? { planSteps: input.planSteps } : {}),
        ...(input.confirmedPlan ? { confirmedPlan: input.confirmedPlan } : {}),
        ...(input.artifactBody ? { artifactBody: input.artifactBody } : {}),
        ...(input.jobExecutionReport ? { jobExecutionReport: input.jobExecutionReport } : {}),
        ...(input.materials ? { materials: input.materials } : {}),
        ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.testResults?.length ? { testResults: input.testResults } : {}),
        ...(input.changedFileExcerpts?.length
          ? { changedFileExcerpts: input.changedFileExcerpts }
          : {}),
      },
      chat,
    );
    if (!isSuccessfulCtoSummary(summary)) {
      return {
        status: 'failed',
        failureMessage: ACCEPTANCE_REVIEW_FAILED_MESSAGE,
        evidencePack,
      };
    }
    return { status: 'ready', summary, evidencePack };
  } catch {
    return {
      status: 'failed',
      failureMessage: ACCEPTANCE_REVIEW_FAILED_MESSAGE,
      evidencePack,
    };
  }
}
