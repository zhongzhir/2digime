/**
 * D11-D 受控修订编排器。
 * 该模块只在 Job 已成功写入后被调用；它自身不改变 Job 成功语义。
 */
import {
  buildErrorSignature,
  countConsecutiveSameCause,
  decideControlledRevision,
  resolveAttribution,
  schemeFingerprint,
  type ControlledRevisionEvidence,
  type RevisionAttemptRecord,
  type TaskRevisionLoopMeta,
} from './controlled-revision';
import type { Task } from './task';

export interface ControlledRevisionRunnerDeps {
  getTask(taskId: string): Promise<Task | null>;
  updateRevisionLoop(
    taskId: string,
    patch:
      | Partial<TaskRevisionLoopMeta>
      | ((prev: TaskRevisionLoopMeta) => TaskRevisionLoopMeta),
  ): Promise<Task>;
  appendConversation(taskId: string, turn: { role: 'digital_me'; content: string }): Promise<unknown>;
  findActiveJob(taskId: string): Promise<{ id: string } | null>;
  getArtifactContent(artifactId: string): Promise<{
    versionId: string;
    acceptanceSummary?: unknown;
    codeChange?: unknown;
  }>;
  reviseArtifact(input: {
    taskId: string;
    artifactId: string;
    revisionRequest: string;
  }): Promise<{ jobId: string }>;
  /** 能力配置已知不可用时，不得创建自动修订 Job。 */
  modelAvailable?: boolean;
  chat?: (input: { messages: Array<{ role: 'system' | 'user'; content: string }> }) => Promise<{
    text: string;
  } | null>;
  nowIso(): string;
}

export async function maybeRunControlledRevisionAfterJob(
  deps: ControlledRevisionRunnerDeps,
  input: { taskId: string; jobId: string; artifactId: string },
): Promise<{ ok: boolean; action?: string; reason?: string; revisionJobId?: string }> {
  try {
    const task = await deps.getTask(input.taskId);
    if (!task) return { ok: false, reason: 'task_not_found' };
    const existingLoop = task.meta?.revisionLoop;
    const active = await deps.findActiveJob(input.taskId);
    if (existingLoop?.inFlightJobId && active) {
      return { ok: true, action: 'noop', reason: 'revision_in_flight' };
    }

    const artifact = await deps.getArtifactContent(input.artifactId);
    if (existingLoop?.lastHandledVersionId === artifact.versionId) {
      return { ok: true, action: 'noop', reason: 'version_already_handled' };
    }
    const evidence = evidenceFromArtifact(artifact);
    const plan = task.meta?.plan;
    let loop = existingLoop ?? { attempts: [], autoRoundCount: 0 };

    // 第二次同因失败时可请求模型提出另一种方案；模型输出仍需由纯规则验证。
    const provisionalAttribution = resolveAttribution(undefined, evidence);
    const provisionalSignature = buildErrorSignature(evidence);
    const sameCause = countConsecutiveSameCause(
      loop.attempts,
      provisionalAttribution,
      provisionalSignature,
    );
    if (sameCause === 1 && deps.chat && evidence.decision === 'needs_revision') {
      const previousPlan = loop.attempts[loop.attempts.length - 1]?.revisionPlanExcerpt ?? '';
      const suggested = await requestDifferentScheme(deps, previousPlan, evidence);
      if (suggested.revisedPlan) evidence.revisionPlan = suggested.revisedPlan;
      if (suggested.attribution) evidence.agentSummary = suggested.attribution;
    }

    const decision = decideControlledRevision({
      evidence,
      ...(plan?.status === 'confirmed' ? { confirmedPlanVersion: plan.version } : {}),
      hasConfirmedPlan: plan?.status === 'confirmed',
      hasActiveJob: !!active,
      loop,
      modelAvailable: deps.modelAvailable ?? true,
      pausedByUser: false,
      cancelled: false,
    });
    const outcome = outcomeFor(decision.action);
    const attempt: RevisionAttemptRecord = {
      jobId: input.jobId,
      artifactVersionId: artifact.versionId,
      at: deps.nowIso(),
      attribution: decision.attribution,
      errorSignature: decision.errorSignature,
      schemeFingerprint: decision.schemeFingerprint,
      revisionPlanExcerpt: String(evidence.revisionPlan ?? '').slice(0, 600),
      outcome,
      userFacingNote: decision.userFacingNote,
    };

    // 先登记审计结论；自动修订前另写已处理版本，避免重复事件重复创建 Job。
    await deps.updateRevisionLoop(input.taskId, (prev) => {
      const next: TaskRevisionLoopMeta = {
        ...prev,
        attempts: [...prev.attempts, attempt],
        autoRoundCount:
          decision.action === 'auto_revise' || decision.action === 'auto_revise_new_scheme'
            ? prev.autoRoundCount + 1
            : prev.autoRoundCount,
      };
      if (decision.action === 'stop_success') {
        delete next.pauseReason;
        delete next.inFlightJobId;
        next.paused = false;
      }
      if (decision.action === 'pause' || decision.action === 'await_user') {
        next.paused = true;
        next.pauseReason = decision.stopReason ?? decision.userFacingNote;
        delete next.inFlightJobId;
      }
      return next;
    });
    await deps.appendConversation(input.taskId, { role: 'digital_me', content: decision.userFacingNote });

    if (decision.action === 'auto_revise' || decision.action === 'auto_revise_new_scheme') {
      await deps.updateRevisionLoop(input.taskId, (prev) => ({
        ...prev,
        lastHandledVersionId: artifact.versionId,
        inFlightJobId: `pending:${input.jobId}`,
      }));
      try {
        const revised = await deps.reviseArtifact({
          taskId: input.taskId,
          artifactId: input.artifactId,
          revisionRequest: decision.revisionRequest!,
        });
        await deps.updateRevisionLoop(input.taskId, (prev) => ({
          ...prev,
          inFlightJobId: revised.jobId,
        }));
        return { ok: true, action: decision.action, revisionJobId: revised.jobId };
      } catch (error) {
        await deps.updateRevisionLoop(input.taskId, (prev) => {
          const next = { ...prev, paused: true, pauseReason: 'revise_failed' };
          delete next.inFlightJobId;
          return next;
        });
        return {
          ok: false,
          action: decision.action,
          reason: error instanceof Error ? error.message : 'revise_failed',
        };
      }
    }
    return {
      ok: true,
      action: decision.action,
      ...(decision.stopReason ? { reason: decision.stopReason } : {}),
    };
  } catch (error) {
    // 受控修订是成功 Job 的后续工作，不能反向破坏该 Job 的成功记录。
    return { ok: false, reason: error instanceof Error ? error.message : 'controlled_revision_failed' };
  }
}

function evidenceFromArtifact(content: {
  acceptanceSummary?: unknown;
  codeChange?: unknown;
  checks?: ControlledRevisionEvidence['checks'];
}): ControlledRevisionEvidence {
  const summary = (content.acceptanceSummary ?? {}) as {
    ctoReview?: Record<string, unknown>;
    revisionDirective?: string;
    primaryAction?: string;
    gaps?: string[];
    bullets?: string[];
    technicalBullets?: string[];
  };
  const codeChange = (content.codeChange ?? {}) as {
    acceptanceSummary?: typeof summary;
    checks?: ControlledRevisionEvidence['checks'];
  };
  const acc = summary.ctoReview ? summary : codeChange.acceptanceSummary ?? summary;
  const review = (acc.ctoReview ?? acc) as Record<string, unknown>;
  const decision = String(review.decision ?? 'insufficient_evidence');
  const revisionPlan =
    (typeof review.revisionDirective === 'string' && review.revisionDirective) ||
    (typeof acc.revisionDirective === 'string' && acc.revisionDirective) ||
    undefined;
  const gaps =
    (Array.isArray(review.findings) ? (review.findings as string[]) : undefined) ||
    (Array.isArray(acc.gaps) ? acc.gaps : undefined) ||
    (Array.isArray(acc.bullets) ? acc.bullets : undefined);
  const checks =
    content.checks ||
    codeChange.checks ||
    (Array.isArray(review.checks) ? (review.checks as ControlledRevisionEvidence['checks']) : undefined);
  return {
    decision,
    ...(revisionPlan ? { revisionPlan } : {}),
    ...(checks ? { checks } : {}),
    ...(gaps ? { gaps } : {}),
    ...(typeof acc.primaryAction === 'string'
      ? { primaryAction: acc.primaryAction }
      : typeof review.primaryAction === 'string'
        ? { primaryAction: String(review.primaryAction) }
        : {}),
  };
}

async function requestDifferentScheme(
  deps: ControlledRevisionRunnerDeps,
  previousPlan: string,
  evidence: ControlledRevisionEvidence,
): Promise<{ attribution?: string; revisedPlan?: string }> {
  try {
    const response = await deps.chat?.({
      messages: [
        {
          role: 'system',
          content: '只返回 JSON：{"attribution":"…","revisedPlan":"…"}。不要保存或输出推理过程。',
        },
        {
          role: 'user',
          content: `前次方案：${previousPlan}\n失败事实：${JSON.stringify(evidence)}`,
        },
      ],
    });
    if (!response?.text) return {};
    const match = response.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? '{}') as { attribution?: unknown; revisedPlan?: unknown };
    return {
      ...(typeof parsed.attribution === 'string' ? { attribution: parsed.attribution } : {}),
      ...(typeof parsed.revisedPlan === 'string' ? { revisedPlan: parsed.revisedPlan.trim() } : {}),
    };
  } catch {
    return {};
  }
}

function outcomeFor(action: string): RevisionAttemptRecord['outcome'] {
  if (action === 'auto_revise') return 'auto_revised';
  if (action === 'auto_revise_new_scheme') return 'scheme_changed';
  if (action === 'stop_success') return 'completed';
  if (action === 'await_user') return 'awaiting_user';
  return 'paused';
}
