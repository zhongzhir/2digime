/**
 * D11-D 受控修订编排器（并发安全 follow-up）。
 * 「检查并认领版本 → 创建下一 Job」须原子、幂等，且可被暂停/取消阻断。
 * 认领与建 Job 之间释放 Task 锁，便于用户暂停/取消插入；建 Job 前再次校验。
 */
import {
  DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS,
  DEFAULT_MAX_AUTO_REVISION_ROUNDS,
  DEFAULT_REVISION_CLAIM_STALE_MS,
  buildErrorSignature,
  countConsecutiveSameCause,
  decideControlledRevision,
  resolveAttribution,
  type ControlledRevisionDecision,
  type ControlledRevisionEvidence,
  type RevisionAttemptRecord,
  type TaskRevisionLoopMeta,
} from './controlled-revision';
import type { Task } from './task';

export interface ControlledRevisionRunnerDeps {
  getTask(taskId: string): Promise<Task | null>;
  /**
   * 同一 Task 的完整临界区。生产路径必须接到 JobRunner.runExclusiveForTask；
   * 测试可用进程内互斥模拟。不得只锁单次 meta 写入。
   */
  withTaskExclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T>;
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
    checks?: ControlledRevisionEvidence['checks'];
  }>;
  reviseArtifact(input: {
    taskId: string;
    artifactId: string;
    revisionRequest: string;
  }): Promise<{ jobId: string }>;
  /** 累计已成功 Job 的时长（毫秒），用于资源硬门；缺省按 0。 */
  sumSucceededJobDurationMs?(taskId: string): Promise<number>;
  modelAvailable?: boolean;
  chat?: (input: { messages: Array<{ role: 'system' | 'user'; content: string }> }) => Promise<{
    text: string;
  } | null>;
  nowIso(): string;
  /** 可注入时钟，便于测 claim 过期收敛。 */
  nowMs?(): number;
  /** 测试钩子：认领成功且已释放锁之后、决策之前。 */
  afterClaimForTest?(claim: Extract<ClaimRevisionResult, { ok: true }>): Promise<void> | void;
}

export type ClaimRevisionResult =
  | { ok: true; claimId: string; loop: TaskRevisionLoopMeta; task: Task }
  | { ok: false; reason: string; loop?: TaskRevisionLoopMeta };

/**
 * 在调用方已持有 withTaskExclusive 时执行：重新读取最新状态并原子认领 version。
 * pending:* 存在（无论有无 active Job）即拒绝；过期 pending 可安全收敛清理。
 */
export async function claimRevisionVersionExclusive(
  deps: ControlledRevisionRunnerDeps,
  input: {
    taskId: string;
    versionId: string;
    sourceJobId: string;
    nowIso: string;
    nowMs: number;
  },
): Promise<ClaimRevisionResult> {
  const task = await deps.getTask(input.taskId);
  if (!task) return { ok: false, reason: 'task_not_found' };
  const active = await deps.findActiveJob(input.taskId);
  let success: { claimId: string; loop: TaskRevisionLoopMeta } | null = null;
  let failReason = 'claim_rejected';
  let failLoop: TaskRevisionLoopMeta | undefined;
  const claimId = `pending:${input.sourceJobId}:${input.versionId}`;
  const box: { success: { claimId: string; loop: TaskRevisionLoopMeta } | null } = { success: null };

  const updated = await deps.updateRevisionLoop(input.taskId, (prev) => {
    let loop = normalizeLoop(prev);
    // 重启/崩溃收敛：过期 pending 且无 active Job → 清占位，保留 lastHandled 防重试旧 version
    if (isPendingClaim(loop.inFlightJobId) && !active && isClaimStale(loop, input.nowMs)) {
      delete loop.inFlightJobId;
      delete loop.claimStartedAt;
      delete loop.claimToken;
    }

    if (loop.paused || loop.pauseReason === 'user_cancelled' || loop.pauseReason === 'user_pause') {
      failReason = 'paused_or_cancelled';
      failLoop = loop;
      return loop;
    }
    if (loop.lastHandledVersionId === input.versionId) {
      failReason = 'version_already_handled';
      failLoop = loop;
      return loop;
    }
    if (loop.inFlightJobId) {
      failReason = 'revision_in_flight';
      failLoop = loop;
      return loop;
    }
    if (active) {
      failReason = 'active_job';
      failLoop = loop;
      return loop;
    }

    const next: TaskRevisionLoopMeta = {
      ...loop,
      lastHandledVersionId: input.versionId,
      inFlightJobId: claimId,
      claimToken: claimId,
      claimStartedAt: input.nowIso,
    };
    box.success = { claimId, loop: next };
    return next;
  });

  success = box.success;
  if (success) {
    return { ok: true, claimId: success.claimId, loop: success.loop, task: updated };
  }
  return { ok: false, reason: failReason, ...(failLoop ? { loop: failLoop } : {}) };
}

export async function maybeRunControlledRevisionAfterJob(
  deps: ControlledRevisionRunnerDeps,
  input: { taskId: string; jobId: string; artifactId: string },
): Promise<{ ok: boolean; action?: string; reason?: string; revisionJobId?: string }> {
  try {
    const artifact = await deps.getArtifactContent(input.artifactId);
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const now = deps.nowIso();

    // ① 临界区：仅做原子认领（含 paused/cancelled / lastHandled / pending / active 检查）
    const claim = await deps.withTaskExclusive(input.taskId, () =>
      claimRevisionVersionExclusive(deps, {
        taskId: input.taskId,
        versionId: artifact.versionId,
        sourceJobId: input.jobId,
        nowIso: now,
        nowMs,
      }),
    );
    if (!claim.ok) {
      return { ok: true, action: 'noop', reason: claim.reason };
    }

    // 锁已释放：允许暂停/取消写入；测试可在此插入
    await deps.afterClaimForTest?.(claim);

    // ② 锁外决策（可含模型调用）；不得信任锁外陈旧 Task 快照作为最终门控
    const task = (await deps.getTask(input.taskId)) ?? claim.task;
    const evidence = evidenceFromArtifact(artifact);
    const plan = task.meta?.plan;
    let loop = task.meta?.revisionLoop ?? claim.loop;
    const cumulativeDurationMs = deps.sumSucceededJobDurationMs
      ? await deps.sumSucceededJobDurationMs(input.taskId)
      : 0;

    if (isPausedOrCancelled(loop)) {
      await clearPendingKeepHandled(deps, input.taskId, loop.pauseReason);
      await deps.appendConversation(input.taskId, {
        role: 'digital_me',
        content:
          loop.pauseReason === 'user_cancelled'
            ? '任务已取消，不再自动修改。'
            : '自动修改已暂停。',
      });
      return {
        ok: true,
        action: 'noop',
        reason: loop.pauseReason === 'user_cancelled' ? 'cancelled' : 'paused',
      };
    }

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

    const fresh = await deps.getTask(input.taskId);
    const freshLoop = fresh?.meta?.revisionLoop ?? loop;
    let decision = decideControlledRevision({
      evidence,
      ...(plan?.status === 'confirmed' ? { confirmedPlanVersion: plan.version } : {}),
      hasConfirmedPlan: plan?.status === 'confirmed',
      hasActiveJob: !!(await deps.findActiveJob(input.taskId)),
      loop: freshLoop,
      maxAutoRounds: DEFAULT_MAX_AUTO_REVISION_ROUNDS,
      maxCumulativeDurationMs: DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS,
      cumulativeDurationMs,
      modelAvailable: deps.modelAvailable ?? true,
      pausedByUser: !!freshLoop.paused || freshLoop.pauseReason === 'user_pause',
      cancelled: freshLoop.pauseReason === 'user_cancelled',
    });
    decision = applyPauseCancelOverride(decision, freshLoop);

    // ③ 临界区：落盘 attempt、最终门控、创建 Job、pending→真实 jobId（对话写入在锁外）
    const locked = await deps.withTaskExclusive(input.taskId, async () => {
      const before = await deps.getTask(input.taskId);
      const gate = before?.meta?.revisionLoop;
      if (!gate || gate.inFlightJobId !== claim.claimId) {
        return { result: { ok: true as const, action: 'noop', reason: 'claim_lost' } };
      }
      if (isPausedOrCancelled(gate)) {
        await deps.updateRevisionLoop(input.taskId, (prev) => {
          const next = { ...prev };
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
          return next;
        });
        return {
          note:
            gate.pauseReason === 'user_cancelled'
              ? '任务已取消，不再自动修改。'
              : '自动修改已暂停。',
          result: {
            ok: true as const,
            action: 'noop',
            reason: gate.pauseReason === 'user_cancelled' ? 'cancelled' : 'paused',
          },
        };
      }

      decision = applyPauseCancelOverride(decision, gate);

      const outcome = outcomeFor(decision.action);
      const attempt: RevisionAttemptRecord = {
        jobId: input.jobId,
        artifactVersionId: artifact.versionId,
        at: now,
        attribution: decision.attribution,
        errorSignature: decision.errorSignature,
        schemeFingerprint: decision.schemeFingerprint,
        revisionPlanExcerpt: String(evidence.revisionPlan ?? '').slice(0, 600),
        outcome,
        userFacingNote: decision.userFacingNote,
      };

      await deps.updateRevisionLoop(input.taskId, (prev) => {
        const next: TaskRevisionLoopMeta = {
          ...prev,
          attempts: [...prev.attempts, attempt],
          autoRoundCount:
            decision.action === 'auto_revise' || decision.action === 'auto_revise_new_scheme'
              ? (prev.autoRoundCount ?? 0) + 1
              : prev.autoRoundCount ?? 0,
        };
        if (decision.action === 'stop_success') {
          next.paused = false;
          delete next.pauseReason;
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
        }
        if (decision.action === 'pause' || decision.action === 'await_user') {
          next.paused = true;
          next.pauseReason = decision.stopReason ?? decision.userFacingNote;
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
        }
        if (decision.action === 'noop') {
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
        }
        return next;
      });

      if (decision.action !== 'auto_revise' && decision.action !== 'auto_revise_new_scheme') {
        return {
          note: decision.userFacingNote,
          result: {
            ok: true as const,
            action: decision.action,
            ...(decision.stopReason ? { reason: decision.stopReason } : {}),
          },
        };
      }

      // 真正创建 Job 前最后一次读取暂停/取消（临界区内）
      const beforeCreate = await deps.getTask(input.taskId);
      const createGate = beforeCreate?.meta?.revisionLoop;
      if (
        !createGate ||
        isPausedOrCancelled(createGate) ||
        createGate.inFlightJobId !== claim.claimId
      ) {
        await deps.updateRevisionLoop(input.taskId, (prev) => {
          const next = { ...prev };
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
          return next;
        });
        return { result: { ok: true as const, action: 'noop', reason: 'blocked_before_create' } };
      }

      try {
        const revised = await deps.reviseArtifact({
          taskId: input.taskId,
          artifactId: input.artifactId,
          revisionRequest: decision.revisionRequest!,
        });
        await deps.updateRevisionLoop(input.taskId, (prev) => ({
          ...prev,
          inFlightJobId: revised.jobId,
          claimToken: revised.jobId,
        }));
        return {
          note: decision.userFacingNote,
          result: {
            ok: true as const,
            action: decision.action,
            revisionJobId: revised.jobId,
          },
        };
      } catch (error) {
        // 创建失败：清占位并暂停；保留 lastHandledVersionId，禁止同一旧 version 无限重试
        await deps.updateRevisionLoop(input.taskId, (prev) => {
          const next = {
            ...prev,
            paused: true,
            pauseReason: 'revise_failed',
          };
          delete next.inFlightJobId;
          delete next.claimStartedAt;
          delete next.claimToken;
          return next;
        });
        return {
          note: decision.userFacingNote,
          result: {
            ok: false as const,
            action: decision.action,
            reason: error instanceof Error ? error.message : 'revise_failed',
          },
        };
      }
    });

    if (locked.note) {
      await deps.appendConversation(input.taskId, {
        role: 'digital_me',
        content: locked.note,
      });
    }
    return locked.result;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'controlled_revision_failed' };
  }
}

function isPausedOrCancelled(loop: TaskRevisionLoopMeta | undefined): boolean {
  if (!loop) return false;
  return !!loop.paused || loop.pauseReason === 'user_pause' || loop.pauseReason === 'user_cancelled';
}

function applyPauseCancelOverride(
  decision: ControlledRevisionDecision,
  loop: TaskRevisionLoopMeta,
): ControlledRevisionDecision {
  if (loop.pauseReason === 'user_cancelled') {
    const { revisionRequest: _drop, ...rest } = decision;
    return {
      ...rest,
      action: 'noop',
      userFacingNote: '任务已取消，不再自动修改。',
      stopReason: 'cancelled',
    };
  }
  if (loop.paused || loop.pauseReason === 'user_pause') {
    const { revisionRequest: _drop, ...rest } = decision;
    return {
      ...rest,
      action: 'noop',
      userFacingNote: '自动修改已暂停。',
      stopReason: 'paused',
    };
  }
  return decision;
}

async function clearPendingKeepHandled(
  deps: ControlledRevisionRunnerDeps,
  taskId: string,
  pauseReason: string | undefined,
): Promise<void> {
  await deps.withTaskExclusive(taskId, async () => {
    await deps.updateRevisionLoop(taskId, (prev) => {
      const next = {
        ...prev,
        paused: true,
        pauseReason: prev.pauseReason || pauseReason || 'user_pause',
      };
      delete next.inFlightJobId;
      delete next.claimStartedAt;
      delete next.claimToken;
      return next;
    });
  });
}

function normalizeLoop(prev: TaskRevisionLoopMeta): TaskRevisionLoopMeta {
  return {
    attempts: prev.attempts ?? [],
    autoRoundCount: prev.autoRoundCount ?? 0,
    ...(prev.paused != null ? { paused: prev.paused } : {}),
    ...(prev.pauseReason ? { pauseReason: prev.pauseReason } : {}),
    ...(prev.lastHandledVersionId ? { lastHandledVersionId: prev.lastHandledVersionId } : {}),
    ...(prev.inFlightJobId ? { inFlightJobId: prev.inFlightJobId } : {}),
    ...(prev.claimStartedAt ? { claimStartedAt: prev.claimStartedAt } : {}),
    ...(prev.claimToken ? { claimToken: prev.claimToken } : {}),
  };
}

export function isPendingClaim(inFlightJobId: string | undefined): boolean {
  return !!inFlightJobId && inFlightJobId.startsWith('pending:');
}

export function isClaimStale(loop: TaskRevisionLoopMeta, nowMs: number): boolean {
  if (!isPendingClaim(loop.inFlightJobId)) return false;
  if (!loop.claimStartedAt) return true;
  const started = Date.parse(loop.claimStartedAt);
  if (Number.isNaN(started)) return true;
  return nowMs - started >= DEFAULT_REVISION_CLAIM_STALE_MS;
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
