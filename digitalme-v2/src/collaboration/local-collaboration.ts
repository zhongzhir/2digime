/**
 * 同机双 SubjectPackage 协作编排。
 * - Grant 持久在 issuer 包内（对象 #8）
 * - B 执行复用既有 WorkRuntime / ExecutionJob
 * - 不新建 Collaboration Store / 第二套 Job 状态机
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { newId, nowIso } from '../shared/ids';
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../work-runtime/job-runner';
import type { ContextRef } from '../work-runtime/task';
import { OPENAI_COMPATIBLE_CAPABILITY_ID } from '../capability/adapters/openai-compatible';
import { GrantStore } from './grant-store';
import {
  LOCAL_COLLAB_ACTIONS,
  type AuthorizationGrant,
  type CollabUserStatus,
  type InteractionRequest,
} from './schema';

export interface CollabIssueInput {
  granteePackageDir: string;
  /** 可选：做事页发起时关联的 A 侧任务；协作页新建可不传（身份由 Grant 承载）。 */
  issuerTaskId?: string;
  subtaskGoal: string;
  allowedMaterialPaths: string[];
}

export interface CollabPeerPreview {
  displayName: string;
  packageDir: string;
  brief?: string;
  subjectId?: string;
}

export interface CollabExecuteResult {
  grantId: string;
  status: CollabUserStatus;
  artifactId?: string;
  artifactText?: string;
  jobId?: string;
  granteeEventId?: string;
  denied?: boolean;
  reason?: string;
  reachedModel?: boolean;
  capabilityId?: string;
}

/** 产品面投影（派生自 Grant + GrowthEvent，非第二权威 Store）。 */
export interface CollabListItem {
  grantId: string;
  status: CollabUserStatus;
  ownerDecision?: 'accept' | 'reject';
  subtaskGoal?: string;
  granteeDisplayName?: string;
  allowedMaterials: string[];
  returnedExcerpt?: string;
  issuerTaskId?: string;
  failureMessage?: string;
  reachedModel?: boolean;
}

function normPath(p: string): string {
  return path.resolve(p);
}

function deriveUserStatus(grant: AuthorizationGrant): CollabUserStatus {
  if (grant.status === 'revoked') return 'revoked';
  if (grant.status === 'expired') return 'revoked';
  if (grant.lastFailure && !grant.returnedArtifact) return 'failed';
  if (grant.returnedArtifact) return 'completed';
  if (grant.disclosure?.jobId) return 'running';
  return 'authorized';
}

function assertGrantUsable(grant: AuthorizationGrant): void {
  if (grant.status === 'revoked') {
    throw new Error('authorization grant has been revoked');
  }
  if (grant.status === 'expired') {
    throw new Error('authorization grant has expired');
  }
  if (grant.expiresAt && Date.parse(grant.expiresAt) < Date.now()) {
    throw new Error('authorization grant has expired');
  }
  const actions = new Set(grant.scope.actions.map(String));
  for (const required of LOCAL_COLLAB_ACTIONS) {
    if (!actions.has(required)) {
      throw new Error(`grant missing required action: ${required}`);
    }
  }
}

function isPathAllowed(grant: AuthorizationGrant, materialPath: string): boolean {
  const target = normPath(materialPath);
  const allowed = (grant.scope.resourceRefs ?? []).map(normPath);
  return allowed.includes(target);
}

export class LocalCollaborationHost {
  constructor(private readonly issuer: DigitalMeRuntime) {}

  private async grantStore(): Promise<GrantStore> {
    const pkg = this.issuer.subject.requireActive();
    return GrantStore.open(pkg.rootDir);
  }

  async issue(input: CollabIssueInput): Promise<{
    requestId: string;
    grantId: string;
    status: CollabUserStatus;
  }> {
    const issuerPkg = this.issuer.subject.requireActive();
    const goal = input.subtaskGoal.trim();
    if (!goal) throw new Error('subtask goal required');
    const granteeDir = path.resolve(input.granteePackageDir);
    const granteeRt = this.issuer.createSiblingRuntime();
    try {
      const opened = await granteeRt.openPackage({ dir: granteeDir });
      const allowed = [...new Set(input.allowedMaterialPaths.map(normPath))];
      for (const p of allowed) {
        await fs.access(p);
      }
      const at = nowIso();
      const requestId = newId('interactionRequest');
      const grant: AuthorizationGrant = {
        id: newId('grant'),
        grantorSubjectId: issuerPkg.id,
        grantee: { kind: 'remote_subject', subjectId: opened.subjectId },
        scope: {
          actions: [...LOCAL_COLLAB_ACTIONS],
          resourceRefs: allowed,
        },
        origin: {
          kind: 'interaction_request',
          requestId,
          requestSummary: {
            fromDisplayName: opened.displayName,
            goal,
          },
        },
        status: 'granted',
        grantedAt: at,
        ...(input.issuerTaskId ? { issuerTaskId: input.issuerTaskId } : {}),
        subtaskGoal: goal,
        granteePackageDir: granteeDir,
        granteeDisplayName: opened.displayName,
      };
      const store = await this.grantStore();
      await store.put(grant);
      return { requestId, grantId: grant.id, status: 'authorized' };
    } finally {
      await granteeRt.stop();
    }
  }

  /**
   * 预览本机协作对象身份（不切换当前活动包、不落盘）。
   */
  async resolvePeer(granteePackageDir: string): Promise<CollabPeerPreview> {
    const granteeDir = path.resolve(granteePackageDir);
    const granteeRt = this.issuer.createSiblingRuntime();
    try {
      const opened = await granteeRt.openPackage({ dir: granteeDir });
      let brief: string | undefined;
      try {
        const overview = await granteeRt.getOverview({});
        const line =
          (overview.activeUnderstandings &&
            overview.activeUnderstandings[0] &&
            overview.activeUnderstandings[0].text) ||
          overview.summaryLine ||
          '';
        if (line && String(line).trim()) brief = String(line).trim().slice(0, 120);
      } catch {
        /* overview 可选 */
      }
      return {
        displayName: opened.displayName,
        packageDir: granteeDir,
        subjectId: opened.subjectId,
        ...(brief ? { brief } : {}),
      };
    } finally {
      await granteeRt.stop();
    }
  }

  async revoke(grantId: string): Promise<{ grantId: string; status: CollabUserStatus }> {
    const store = await this.grantStore();
    const grant = await store.get(grantId);
    if (!grant) throw new Error(`grant not found: ${grantId}`);
    if (grant.status !== 'revoked') {
      grant.status = 'revoked';
      grant.revokedAt = nowIso();
      await store.put(grant);
    }
    return { grantId, status: 'revoked' };
  }

  async getStatus(grantId: string): Promise<{
    grantId: string;
    status: CollabUserStatus;
    grant: AuthorizationGrant;
    ownerDecision?: 'accept' | 'reject';
  }> {
    const store = await this.grantStore();
    const grant = await store.get(grantId);
    if (!grant) throw new Error(`grant not found: ${grantId}`);
    const ownerDecision = await this.resolveOwnerDecision(grantId);
    return {
      grantId,
      status: deriveUserStatus(grant),
      grant,
      ...(ownerDecision ? { ownerDecision } : {}),
    };
  }

  /**
   * 列出本主体发出的协作授权（读 GrantStore，不另建协作 Store）。
   */
  async list(): Promise<{ items: CollabListItem[] }> {
    const store = await this.grantStore();
    const grants = await store.list();
    const items: CollabListItem[] = [];
    for (const grant of grants) {
      if (!grant.subtaskGoal && !grant.granteePackageDir) continue;
      const ownerDecision = await this.resolveOwnerDecision(grant.id);
      const status = deriveUserStatus(grant);
      items.push({
        grantId: grant.id,
        status,
        ...(ownerDecision ? { ownerDecision } : {}),
        ...(grant.subtaskGoal ? { subtaskGoal: grant.subtaskGoal } : {}),
        ...(grant.granteeDisplayName
          ? { granteeDisplayName: grant.granteeDisplayName }
          : {}),
        allowedMaterials: (grant.scope.resourceRefs ?? []).map(normPath),
        ...(grant.returnedArtifact?.textExcerpt
          ? { returnedExcerpt: grant.returnedArtifact.textExcerpt }
          : {}),
        ...(grant.issuerTaskId ? { issuerTaskId: grant.issuerTaskId } : {}),
        ...(grant.lastFailure?.message
          ? { failureMessage: grant.lastFailure.message }
          : {}),
        ...(grant.disclosure?.reachedModel !== undefined
          ? { reachedModel: grant.disclosure.reachedModel }
          : grant.returnedArtifact?.reachedModel !== undefined
            ? { reachedModel: grant.returnedArtifact.reachedModel }
            : {}),
      });
    }
    items.sort((a, b) => b.grantId.localeCompare(a.grantId));
    return { items };
  }

  private async resolveOwnerDecision(
    grantId: string,
  ): Promise<'accept' | 'reject' | undefined> {
    const events = await this.issuer.subject.listGrowthEvents();
    const needle = `grant ${grantId}`;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (!e) continue;
      const detail = e.payload.detail || '';
      if (!detail.includes(needle)) continue;
      const tags = e.payload.tags ?? [];
      if (tags.includes('collab:external_accept')) return 'accept';
      if (tags.includes('collab:external_reject')) return 'reject';
    }
    return undefined;
  }

  async assertMaterialAccess(
    grantId: string,
    materialPath: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const store = await this.grantStore();
    const grant = await store.get(grantId);
    if (!grant) return { allowed: false, reason: 'grant not found' };
    try {
      assertGrantUsable(grant);
    } catch (err) {
      return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (!isPathAllowed(grant, materialPath)) {
      return { allowed: false, reason: 'material not in authorization scope' };
    }
    return { allowed: true };
  }

  /**
   * 以 B 身份执行子任务。材料越权或已撤销时在领域层拒绝。
   */
  async execute(
    grantId: string,
    opts?: { extraMaterialPaths?: string[] },
  ): Promise<CollabExecuteResult> {
    const store = await this.grantStore();
    const grant = await store.get(grantId);
    if (!grant) {
      return { grantId, status: 'failed', denied: true, reason: 'grant not found' };
    }
    try {
      assertGrantUsable(grant);
    } catch (err) {
      return {
        grantId,
        status: 'revoked',
        denied: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (!grant.granteePackageDir || !grant.subtaskGoal) {
      return {
        grantId,
        status: 'failed',
        denied: true,
        reason: 'grant is not a local collaboration grant',
      };
    }

    const allowed = (grant.scope.resourceRefs ?? []).map(normPath);
    const extras = (opts?.extraMaterialPaths ?? []).map(normPath);
    for (const extra of extras) {
      if (!allowed.includes(extra)) {
        return {
          grantId,
          status: deriveUserStatus(grant),
          denied: true,
          reason: 'material not in authorization scope',
        };
      }
    }

    const contextRefs: ContextRef[] = allowed.map((p) => ({ kind: 'file', path: p }));
    const granteeRt = this.issuer.createSiblingRuntime();

    try {
      await granteeRt.openPackage({ dir: grant.granteePackageDir });
      const beforeEvents = await granteeRt.subject.listGrowthEvents();
      const beforeFulfilled = beforeEvents.filter((e) =>
        (e.payload.tags ?? []).includes('collab:fulfilled'),
      ).length;

      let submitted: { taskId: string; jobId: string };
      try {
        submitted = await granteeRt.submitTask({
          goal: grant.subtaskGoal,
          contextRefs,
          requestedArtifactType: 'document',
          authorization: {
            grantId: grant.id,
            issuerSubjectId: grant.grantorSubjectId,
            granteeSubjectId: granteeRt.subject.requireActive().id,
          },
        });
      } catch (err) {
        const failMessage = err instanceof Error ? err.message : String(err);
        grant.lastFailure = { at: nowIso(), message: failMessage };
        await store.put(grant);
        const afterFail = await granteeRt.subject.listGrowthEvents();
        const afterFulfilled = afterFail.filter((e) =>
          (e.payload.tags ?? []).includes('collab:fulfilled'),
        ).length;
        if (afterFulfilled !== beforeFulfilled) {
          throw new Error('invariant violated: collab:fulfilled written on failed job');
        }
        return { grantId, status: 'failed', reason: failMessage };
      }

      const job = await waitForJobTerminal(granteeRt.workRuntime, submitted.jobId, 180_000);
      if (job.status !== 'succeeded' || !job.artifactId) {
        const failMessage = job.progress?.note?.trim() || String(job.status);
        grant.lastFailure = {
          at: nowIso(),
          message: failMessage,
        };
        await store.put(grant);
        const afterFail = await granteeRt.subject.listGrowthEvents();
        const afterFulfilled = afterFail.filter((e) =>
          (e.payload.tags ?? []).includes('collab:fulfilled'),
        ).length;
        if (afterFulfilled !== beforeFulfilled) {
          throw new Error('invariant violated: collab:fulfilled written on failed job');
        }
        return {
          grantId,
          status: 'failed',
          jobId: job.id,
          reason: failMessage,
          reachedModel: job.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID,
          ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
        };
      }

      const content = await granteeRt.getContent({ artifactId: job.artifactId });
      const headVersionId = content.artifact.headVersionId;
      const artifactText = content.text ?? '';
      if (artifactText.trim().length < 40) {
        const failMessage =
          'artifact too short or empty; not treating as collaboration success';
        grant.lastFailure = {
          at: nowIso(),
          message: failMessage,
        };
        await store.put(grant);
        return {
          grantId,
          status: 'failed',
          jobId: job.id,
          reason: failMessage,
        };
      }

      const snapshot = job.snapshotId
        ? await granteeRt.getSnapshot(job.snapshotId)
        : null;
      const materialSummaries =
        snapshot?.items.map((item) => ({
          path: item.sourcePath,
          ...(item.contentDigest ? { contentDigest: item.contentDigest } : {}),
        })) ??
        allowed.map((p) => ({
          path: p,
          contentDigest: createHash('sha256').update(p).digest('hex').slice(0, 16),
        }));

      const reachedModel =
        job.capabilityId === OPENAI_COMPATIBLE_CAPABILITY_ID &&
        (this.issuer.documentCapabilityMode === 'openai-compatible' ||
          this.issuer.documentCapabilityMode === 'both');

      grant.disclosure = {
        ...(job.snapshotId ? { snapshotId: job.snapshotId } : {}),
        jobId: job.id,
        materialSummaries,
        sentAt: nowIso(),
        reachedModel,
        ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
        ...(job.costActual?.tokens !== undefined ? { modelTokens: job.costActual.tokens } : {}),
        ...(job.costActual?.durationMs !== undefined
          ? { capabilityDurationMs: job.costActual.durationMs }
          : {}),
      };
      grant.returnedArtifact = {
        artifactId: job.artifactId,
        subjectId: granteeRt.subject.requireActive().id,
        headVersionId,
        title: grant.subtaskGoal.slice(0, 80),
        textExcerpt: artifactText.slice(0, 800),
        reachedModel,
      };
      delete grant.lastFailure;
      // 先落盘 Artifact 溯源，再写成长事件（失败不得 fulfilled）
      await store.put(grant);

      const granteeEvent = await granteeRt.appendOwnerEvent({
        type: 'experience_confirmed',
        confidence: 'confirmed',
        source: {
          kind: 'task_feedback',
          taskId: submitted.taskId,
          artifactId: job.artifactId,
        },
        payload: {
          title: '完成协作子任务',
          detail: `已完成：${grant.subtaskGoal}`.slice(0, 400),
          tags: ['collab:fulfilled', 'document'],
          evidence: {
            artifactId: job.artifactId,
            toVersionId: headVersionId,
          },
        },
      });

      return {
        grantId,
        status: 'completed',
        artifactId: job.artifactId,
        artifactText,
        jobId: job.id,
        granteeEventId: granteeEvent.id,
        reachedModel,
        ...(job.capabilityId ? { capabilityId: job.capabilityId } : {}),
      };
    } finally {
      await granteeRt.stop();
    }
  }

  async acceptReturn(input: {
    grantId: string;
    decision: 'accept' | 'reject';
    note?: string;
  }): Promise<{
    grantId: string;
    status: CollabUserStatus;
    issuerEventId: string;
    granteeEventId?: string;
    integratedIntoArtifactId?: string;
  }> {
    const store = await this.grantStore();
    const grant = await store.get(input.grantId);
    if (!grant) throw new Error(`grant not found: ${input.grantId}`);
    if (!grant.returnedArtifact) {
      throw new Error('no returned artifact to accept or reject');
    }

    const note = (input.note || '').trim();
    const detailBase =
      input.decision === 'accept'
        ? `采用外部协作成果：${grant.subtaskGoal || ''}`
        : `未采用外部协作成果：${grant.subtaskGoal || ''}`;
    const peerId =
      grant.grantee.kind === 'remote_subject' ? grant.grantee.subjectId : '';
    const detail = `${detailBase}${note ? `\n${note}` : ''}\ngrant ${grant.id}; peer ${peerId}`.slice(
      0,
      400,
    );

    const issuerEvent = await this.issuer.appendOwnerEvent({
      type: 'experience_confirmed',
      confidence: 'confirmed',
      source: {
        kind: 'task_feedback',
        ...(grant.issuerTaskId ? { taskId: grant.issuerTaskId } : {}),
      },
      payload: {
        title: input.decision === 'accept' ? '采用了协作成果' : '未采用协作成果',
        detail,
        tags: [
          input.decision === 'accept' ? 'collab:external_accept' : 'collab:external_reject',
          input.decision === 'accept' ? 'decision:accept' : 'decision:reject',
          'document',
        ],
      },
    });

    let integratedIntoArtifactId: string | undefined;
    // 采用后：受控副本 + 引用进主成果（不整篇覆盖）。
    if (input.decision === 'accept' && grant.returnedArtifact.textExcerpt) {
      const body = grant.returnedArtifact.textExcerpt;
      const tmp = path.join(
        this.issuer.subject.requireActive().rootDir,
        'materials',
        `collab_${grant.id.slice(0, 12)}.md`,
      );
      await fs.mkdir(path.dirname(tmp), { recursive: true });
      await fs.writeFile(tmp, `# 协作成果\n\n${body}\n`, 'utf8');
      await this.issuer.importSubjectMaterial({
        sourcePath: tmp,
        distillCandidates: false,
      });

      if (grant.issuerTaskId) {
        const taskView = await this.issuer.getTask({ taskId: grant.issuerTaskId });
        const mainArtifactId = taskView.artifactIds[0];
        if (mainArtifactId) {
          const main = await this.issuer.getContent({ artifactId: mainArtifactId });
          const base = main.text ?? '';
          const marker = `<!-- collab-ref:${grant.id} -->`;
          if (!base.includes(marker)) {
            const integrated = `${base.trim()}\n\n## 协作摘要（已采用）\n\n${marker}\n\n${body}\n`;
            await this.issuer.saveEdit({ artifactId: mainArtifactId, text: integrated });
            integratedIntoArtifactId = mainArtifactId;
          } else {
            integratedIntoArtifactId = mainArtifactId;
          }
        }
      }
    }

    return {
      grantId: grant.id,
      status: input.decision === 'accept' ? 'completed' : 'rejected',
      issuerEventId: issuerEvent.id,
      ...(integratedIntoArtifactId ? { integratedIntoArtifactId } : {}),
    };
  }
}

/** 兼容旧本地模拟工厂：仅内存，不落盘。 */
export function buildLegacySimulationRequest(input: {
  grantorSubjectId: string;
  grantorDisplayName: string;
  granteeName: string;
  goal: string;
}): { request: InteractionRequest; grant: AuthorizationGrant } {
  const at = nowIso();
  const granteeSubjectId = newId('subject');
  const request: InteractionRequest = {
    id: newId('interactionRequest'),
    fromSubject: {
      subjectId: granteeSubjectId,
      displayName: input.granteeName,
      scheme: 'local',
    },
    toSubject: {
      subjectId: input.grantorSubjectId,
      displayName: input.grantorDisplayName,
      scheme: 'local',
    },
    requestedScope: { actions: [...LOCAL_COLLAB_ACTIONS] },
    goal: input.goal,
    createdAt: at,
    mode: 'local_simulation',
  };
  const grant: AuthorizationGrant = {
    id: newId('grant'),
    grantorSubjectId: input.grantorSubjectId,
    grantee: { kind: 'remote_subject', subjectId: granteeSubjectId },
    scope: { actions: [...LOCAL_COLLAB_ACTIONS] },
    origin: {
      kind: 'interaction_request',
      requestId: request.id,
      requestSummary: { fromDisplayName: input.granteeName, goal: input.goal },
    },
    status: 'granted',
    grantedAt: at,
  };
  return { request, grant };
}
