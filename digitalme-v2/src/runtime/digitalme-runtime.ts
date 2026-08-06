import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import { ContentStore } from '../infrastructure/content-store';
import { CapabilityRegistry } from '../capability/registry';
import {
  createFakeDocumentAdapter,
  type FakeDocumentAdapterOptions,
} from '../capability/adapters/fake-document';
import {
  createOpenAiCompatibleAdapter,
  createOpenAiCompatibleAdapterStub,
  type OpenAiCompatibleAdapterConfig,
} from '../capability/adapters/openai-compatible';
import { createDeterministicCodeAnalysisAdapter } from '../capability/adapters/deterministic-code-analysis';
import {
  createCodeRepoAnalysisAdapter,
  createCodeRepoAnalysisAdapterStub,
} from '../capability/adapters/code-repo-analysis';
import {
  createControlledRemoteCapabilityAdapter,
  type ControlledRemoteOptions,
} from '../capability/adapters/controlled-remote';
import type { A2ARemoteAdapterOptions } from '../capability/adapters/a2a-remote';
import type { SecretAccessor } from '../capability/adapter';
import type { Task } from '../work-runtime/task';
import type { ExecutionJob } from '../work-runtime/execution-job';
import type { ContextSnapshot } from '../work-runtime/context-snapshot';
import type { Artifact } from '../work-runtime/artifact';
import { TaskService } from '../work-runtime/task-service';
import { JobStore } from '../work-runtime/job-store';
import { ContextSnapshotBuilder } from '../work-runtime/snapshot-builder';
import { ArtifactCommitter } from '../work-runtime/artifact-commit';
import { InMemoryEventBus } from '../work-runtime/event-bus';
import { WorkRuntime } from '../work-runtime/job-runner';
import type { SubjectSelectionResult } from '../work-runtime/job-runner';
import { SubjectService } from '../subject-core/subject-service';
import { selectSubjectInjection } from '../subject-core/experience-selector';
import { createSubjectDistillModelRuntime } from '../subject-core/distill-model-runtime';
import type { SubjectContextFreeze } from '../subject-core/subject-context-freeze';
import { buildAppliedUnderstanding } from '../subject-core/user-facing-overview';
import { buildMaterialSummary } from '../work-runtime/material-summary';
import { ArtifactWorkspace } from '../artifact-workspace/workspace';
import type { CommandMap } from '../runtime/commands';
import type { GrowthEvent } from '../subject-core/growth-event';
import { simulateInteraction } from '../collaboration/local-simulation';
import { LocalCollaborationHost } from '../collaboration/local-collaboration';
import { GrantStore } from '../collaboration/grant-store';
import { nowIso, newId } from '../shared/ids';
import { chooseExecutionProfile } from '../work-runtime/ai-first-policy';
import {
  appendConversationRow,
  conversationFilePath,
  filterTurnsForUi,
  listReplayableUserTurns,
  outcomeToCaptureStatus,
  readConversationRows,
  type GrowthCaptureStatusRecord,
} from '../subject-core/conversation-transcript';
import { captureOutcomeUserHint, type CaptureOutcome } from '../subject-core/capture-outcome';
import { extractEditEvidence } from '../subject-core/diff-evidence';
import { headVersion } from '../work-runtime/artifact';

export interface DigitalMeRuntimeOptions {
  /**
   * 执行策略：ai_first（默认）精简注入；legacy 保留旧式弱相关 scrub 与核心身份注入（对照验收）。
   */
  executionPolicy?: 'ai_first' | 'legacy';
  fakeAdapter?: FakeDocumentAdapterOptions;
  /** 兼容旧选项:是否注册 needs_setup 的 stub。默认 true(当未启用真实模型时)。 */
  registerOpenAiStub?: boolean;
  /**
   * 文档能力来源:
   * - none:不注册任何文档能力(App Shell 未配置真实模型时;禁止静默 Fake)
   * - fake:仅 Fake(仅单元/集成测试)
   * - openai-compatible:真实模型 Adapter(需 secrets + 配置)
   * - both:真实优先注册,Fake 作为后备(仅测试)
   *
   * App Shell(dev/packaged)不得传入 fake/both。
   */
  documentCapability?: 'none' | 'fake' | 'openai-compatible' | 'both';
  openaiCompatible?: OpenAiCompatibleAdapterConfig;
  secrets?: SecretAccessor;
  /**
   * P2.1/P2.2 代码分析能力:
   * - none:不注册
   * - needs_setup:注册占位(无凭证,不提供本地替代)
   * - deterministic:P2.1 工程验证 Adapter(不进 production)
   * - openai-compatible:P2.2 真实模型分析
   */
  codeAnalysisCapability?: 'none' | 'needs_setup' | 'deterministic' | 'openai-compatible';
  /**
   * 受控远端能力(产品准备验收/测试):
   * - false/undefined:不注册(App 默认)
   * - true:需同时提供 controlledRemote 配置
   * - ControlledRemoteOptions:注册 ControlledRemoteCapabilityAdapter
   */
  remoteCapability?: boolean | ControlledRemoteOptions;
  controlledRemote?: ControlledRemoteOptions;
  /**
   * A2A 远端专业能力(白名单端点):
   * - false/undefined:不注册(App 默认)
   * - A2ARemoteAdapterOptions:注册 A2ARemoteCapabilityAdapter
   */
  a2aRemoteCapability?: false | A2ARemoteAdapterOptions;
}

/**
 * DigitalMeRuntime — Subject + Work + Artifact Workspace 装配。
 * 单实例挂载一个 SubjectPackage;Work 数据落在 package/runtime/ 下随包迁移。
 */
export class DigitalMeRuntime {
  readonly eventBus = new InMemoryEventBus();
  readonly subject = new SubjectService(this.eventBus);
  private work: WorkRuntime | null = null;
  private workspace: ArtifactWorkspace | null = null;
  private contentStore: ContentStore | null = null;
  private readonly registry: CapabilityRegistry;
  private readonly options: DigitalMeRuntimeOptions;
  private unsubGrowthJobHook: (() => void) | null = null;

  constructor(options: DigitalMeRuntimeOptions = {}) {
    this.options = options;
    this.registry = this.buildCapabilityRegistry();
    const distillRt = createSubjectDistillModelRuntime({
      ...(options.documentCapability !== undefined
        ? { documentCapability: options.documentCapability }
        : {}),
      ...(options.openaiCompatible ? { openaiCompatible: options.openaiCompatible } : {}),
      ...(options.secrets ? { secrets: options.secrets } : {}),
    });
    this.subject.setDistillModelRuntime(distillRt);
  }

  /**
   * 为同机协作方创建能力配置一致的独立 Runtime（不共享 SubjectPackage / Store）。
   */
  createSiblingRuntime(): DigitalMeRuntime {
    return createDigitalMeRuntime({ ...this.options });
  }

  /** 当前文档能力模式（供协作验收区分 Fake / 真实模型）。 */
  get documentCapabilityMode(): DigitalMeRuntimeOptions['documentCapability'] {
    return this.options.documentCapability ?? 'fake';
  }

  async createPackage(input: CommandMap['subject.createPackage']['input']) {
    const result = await this.subject.createPackage(input);
    await this.attachWorkRuntime();
    this.work?.start();
    return result;
  }

  async openPackage(input: CommandMap['subject.openPackage']['input']) {
    const result = await this.subject.openPackage(input);
    await this.attachWorkRuntime();
    await this.work?.recoverOnStartup();
    this.work?.start();
    // 打开包时恢复未完成的成长捕获（非定时轮询）
    void this.recoverPendingGrowthCaptures();
    return result;
  }

  getOverview(input: CommandMap['subject.getOverview']['input'] = {}) {
    return this.subject.getOverview(input);
  }

  confirmExperience(input: CommandMap['subject.confirmExperience']['input']) {
    return this.subject.confirmCandidates(input);
  }

  respondToLearning(input: CommandMap['subject.respondToLearning']['input']) {
    return this.subject.respondToLearning(input);
  }

  captureSubjectInput(input: CommandMap['subject.captureInput']['input']) {
    return this.enrichAndCapture(input);
  }

  private async enrichAndCapture(
    input: CommandMap['subject.captureInput']['input'],
  ): Promise<CommandMap['subject.captureInput']['output']> {
    const enriched = { ...input };
    const isDecision =
      input.sourceKind === 'artifact_acceptance' || input.sourceKind === 'artifact_rejection';
    if (
      isDecision &&
      input.taskId &&
      input.artifactId &&
      !input.revisionRequest &&
      !input.editSummary
    ) {
      try {
        const meta = await this.listRecentRevisionMeta(input.taskId, input.artifactId);
        if (meta) {
          if (meta.revisionRequest && !enriched.revisionRequest) {
            enriched.revisionRequest = meta.revisionRequest;
          }
          if (meta.rejectionReason && !enriched.rejectionReason) {
            enriched.rejectionReason = meta.rejectionReason;
          }
          if (meta.editSummary && !enriched.editSummary) {
            enriched.editSummary = meta.editSummary;
          }
        }
      } catch {
        /* 增强可选 */
      }
    }
    return this.subject.captureInput(enriched);
  }

  private async listRecentRevisionMeta(
    taskId: string,
    artifactId: string,
  ): Promise<{
    revisionRequest?: string;
    rejectionReason?: string;
    editSummary?: string;
  } | null> {
    let revisionRequest: string | undefined;
    let rejectionReason: string | undefined;
    const detail = await this.requireWork().getTask({ taskId });
    const jobId = detail.latestJob?.jobId;
    if (jobId) {
      const job = await this.requireWork().getJob(jobId);
      if (job?.revisionRequest) revisionRequest = job.revisionRequest;
      if (job?.rejectionReason) rejectionReason = job.rejectionReason;
    }
    let editSummary: string | undefined;
    try {
      const artifact = await this.requireWork().getArtifact(artifactId);
      if (artifact && artifact.versions.length >= 2 && this.contentStore) {
        const head = headVersion(artifact);
        const prev = [...artifact.versions]
          .reverse()
          .find((v) => v.versionId !== head.versionId && v.content.kind === 'text');
        if (prev && prev.content.kind === 'text' && head.content.kind === 'text') {
          const before = (await this.contentStore.readBytes(prev.content.ref)).toString('utf8');
          const after = (await this.contentStore.readBytes(head.content.ref)).toString('utf8');
          const evidence = extractEditEvidence(before, after);
          if (evidence.detail || evidence.title) {
            editSummary = evidence.detail || evidence.title;
          }
        }
      }
    } catch {
      /* optional */
    }
    if (!revisionRequest && !rejectionReason && !editSummary) return null;
    return {
      ...(revisionRequest ? { revisionRequest } : {}),
      ...(rejectionReason ? { rejectionReason } : {}),
      ...(editSummary ? { editSummary } : {}),
    };
  }

  getArtifactOwnerDecision(artifactId: string, artifactVersionId: string) {
    return this.subject.getArtifactOwnerDecision(artifactId, artifactVersionId);
  }

  importSubjectMaterial(input: CommandMap['subject.importMaterial']['input']) {
    return this.subject.importSubjectMaterial(input);
  }

  removeSubjectMaterial(input: CommandMap['subject.removeMaterial']['input']) {
    return this.subject.removeSubjectMaterial(input);
  }

  submitTask(input: CommandMap['work.submitTask']['input']) {
    const run = async () => {
      if (input.jitChoice) {
        await this.subject.resolveJitChoice({
          action: input.jitChoice.action,
          eventIdA: input.jitChoice.eventIdA,
          eventIdB: input.jitChoice.eventIdB,
        });
      }
      const created = await this.requireWork().submitTask(input);
      if (input.jitChoice) {
        await this.subject.resolveJitChoice({
          action: input.jitChoice.action,
          eventIdA: input.jitChoice.eventIdA,
          eventIdB: input.jitChoice.eventIdB,
          taskId: created.taskId,
        });
      }
      // Task + 初始 Job 已持久化即可调度目标捕获（不依赖执行成功）
      this.scheduleTaskRequirementCapture({
        taskId: created.taskId,
        goal: input.goal,
      });
      return created;
    };
    return run();
  }

  retryTask(input: CommandMap['work.retryTask']['input']) {
    return this.requireWork().retryTask(input);
  }

  reviseArtifact(input: CommandMap['work.reviseArtifact']['input']) {
    return this.requireWork().reviseArtifact(input);
  }

  cancelJob(input: CommandMap['work.cancelJob']['input']) {
    return this.requireWork().cancelJob(input);
  }

  async getTask(input: CommandMap['work.getTask']['input']) {
    const result = await this.requireWork().getTask(input);
    const jobId = result.latestJob?.jobId;
    if (jobId) {
      try {
        const job = await this.getJob(jobId);
        if (job?.snapshotId) {
          const snapshot = await this.getSnapshot(job.snapshotId);
          if (snapshot?.items?.length) {
            const summary = buildMaterialSummary(snapshot.items);
            if (summary) {
              result.materialSummary = {
                readCount: summary.readCount,
                skippedCount: summary.skippedCount,
                summaryLine: summary.summaryLine,
                included: summary.included.map((e) => ({
                  path: e.path,
                  displayName: e.displayName,
                })),
                skipped: summary.skipped.map((e) => ({
                  path: e.path,
                  displayName: e.displayName,
                  reason: e.reason || '未能纳入',
                })),
              };
            }
          }
          if (result.latestJob?.status === 'succeeded') {
            const freeze = await this.readSubjectContextFreeze(job.snapshotId);
            const applied = buildAppliedUnderstanding(freeze);
            if (applied) result.appliedUnderstanding = applied;
          }
        }
      } catch {
        /* 冻结/快照缺失不阻断任务查询 */
      }
    }
    const jit = this.subject.peekJitPrompt(input.taskId);
    if (jit) {
      result.ownerChoicePrompt = {
        question: jit.question,
        labelA: jit.labelA,
        labelB: jit.labelB,
        eventIdA: jit.eventIdA,
        eventIdB: jit.eventIdB,
        highRisk: jit.highRisk,
      };
    }
    return result;
  }

  listTasks(input: CommandMap['work.listTasks']['input'] = {}) {
    return this.requireWork().listTasks(input);
  }

  getJob(jobId: string) {
    return this.requireWork().getJob(jobId);
  }

  getSnapshot(snapshotId: string) {
    return this.requireWork().getSnapshot(snapshotId);
  }

  async readSubjectContextFreeze(
    snapshotId: string,
  ): Promise<SubjectContextFreeze | null> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot?.subjectContextRef) return null;
    if (!this.contentStore) throw new Error('content store not attached');
    const bytes = await this.contentStore.readBytes(snapshot.subjectContextRef);
    return JSON.parse(bytes.toString('utf8')) as SubjectContextFreeze;
  }

  getArtifact(artifactId: string) {
    return this.requireWork().getArtifact(artifactId);
  }

  getContent(input: CommandMap['artifact.getContent']['input']) {
    return this.requireWorkspace().getContent(input.artifactId, input.versionId);
  }

  saveEdit(input: CommandMap['artifact.saveEdit']['input']) {
    return this.requireWorkspace().saveEdit(input.artifactId, input.text).then((r) => ({
      versionId: r.version.versionId,
    }));
  }

  exportArtifact(input: CommandMap['artifact.export']['input']) {
    return this.requireWorkspace().export(input.artifactId, input.format, input.targetPath);
  }

  async revealInFolder(
    input: CommandMap['artifact.revealInFolder']['input'],
  ): Promise<CommandMap['artifact.revealInFolder']['output']> {
    await this.requireWorkspace().revealInFolder(input.artifactId);
    return { opened: true };
  }

  /** 供 App Shell 打开系统文件夹(不进入命令返回面)。 */
  async getArtifactStorageDir(artifactId: string): Promise<string> {
    const artifact = await this.requireWork().getArtifact(artifactId);
    if (!artifact) throw new Error(`artifact not found: ${artifactId}`);
    return artifact.storageDir;
  }

  async listCapabilities(
    input: CommandMap['capability.list']['input'] = {},
  ): Promise<CommandMap['capability.list']['output']> {
    const capabilities = this.registry.list();
    const out: CommandMap['capability.list']['output'] = { capabilities };

    const {
      previewExternalAuthorization,
      buildExternalCapabilityCard,
      materialDisplayNames,
      A2A_ID,
    } = await (async () => {
      const product = await import('../capability/external-capability-product');
      return {
        previewExternalAuthorization: product.previewExternalAuthorization,
        buildExternalCapabilityCard: product.buildExternalCapabilityCard,
        materialDisplayNames: product.materialDisplayNames,
        A2A_ID: 'cap_a2a_research_analysis',
      };
    })();

    const targetId =
      input.previewAuthorization?.capabilityId ||
      capabilities.find((c) => c.id === A2A_ID)?.id ||
      capabilities.find((c) => /研究分析/.test(c.displayName))?.id;

    const target = targetId ? this.registry.get(targetId) : undefined;

    if (input.previewAuthorization) {
      const preview = previewExternalAuthorization({
        goal: input.previewAuthorization.goal,
        allowedMaterialPaths: input.previewAuthorization.allowedMaterialPaths ?? [],
        ...(target?.registration.displayName
          ? { capabilityDisplayName: target.registration.displayName }
          : { capabilityDisplayName: '研究分析能力' }),
        ...(input.previewAuthorization.extraNote
          ? { extraNote: input.previewAuthorization.extraNote }
          : {}),
      });
      out.authorizationPreview = {
        confirmPoints: preview.confirmPoints,
        projection: {
          purpose: preview.projection.purpose,
          allowedMaterials: [...preview.projection.allowedMaterials],
          allowRemotePersist: preview.projection.allowRemotePersist,
          allowRedelegate: preview.projection.allowRedelegate,
          maxRuntimeMs: preview.projection.maxRuntimeMs,
        },
        capabilityDisplayName: preview.capabilityDisplayName,
      };
    }

    if (input.includeAvailability || input.previewAuthorization) {
      let available = false;
      let availabilityReason: string | undefined = 'unreachable';
      if (!target) {
        available = false;
        availabilityReason = 'credential';
      } else {
        try {
          const check = await target.checkAvailability({});
          available = !!check.available;
          if (!available) {
            const detail = String(check.detail || check.reason || '');
            availabilityReason = /credential|secret|token|凭证/i.test(detail)
              ? 'credential'
              : 'unreachable';
          }
        } catch (err) {
          available = false;
          const msg = err instanceof Error ? err.message : String(err);
          availabilityReason = /credential|secret|token|凭证/i.test(msg)
            ? 'credential'
            : 'unreachable';
        }
      }
      const mats = input.previewAuthorization?.allowedMaterialPaths ?? [];
      out.externalCapabilityCard = buildExternalCapabilityCard({
        capabilityId: target?.registration.id || A2A_ID,
        available,
        ...(target?.registration.displayName
          ? { displayName: target.registration.displayName }
          : {}),
        ...(target?.registration.description
          ? { description: target.registration.description }
          : {}),
        ...(target?.registration.latencyEstimate
          ? { latencyEstimate: target.registration.latencyEstimate }
          : {}),
        ...(availabilityReason ? { availabilityReason } : {}),
        selectedMaterialNames: materialDisplayNames(mats),
      });
    }

    return out;
  }

  async simulateCollab(
    input: CommandMap['collab.simulateInteraction']['input'],
  ): Promise<CommandMap['collab.simulateInteraction']['output']> {
    const action = input.action;
    if (!action) {
      // 兼容旧冒烟：内存模拟（不落盘）
      const pkg = this.subject.requireActive();
      if (!input.granteeName || !input.scope || !input.goal) {
        throw new Error('legacy collab.simulateInteraction requires granteeName, scope, goal');
      }
      const { request, grant } = simulateInteraction({
        grantor: {
          subjectId: pkg.id,
          displayName: pkg.identity.displayName,
          scheme: 'local',
        },
        granteeName: input.granteeName,
        scope: input.scope,
        goal: input.goal,
      });
      return { requestId: request.id, grantId: grant.id, status: 'authorized' };
    }

    const host = new LocalCollaborationHost(this);
    if (action === 'issue') {
      if (!input.granteePackageDir || !input.subtaskGoal) {
        throw new Error('issue requires granteePackageDir, subtaskGoal');
      }
      return host.issue({
        granteePackageDir: input.granteePackageDir,
        ...(input.issuerTaskId ? { issuerTaskId: input.issuerTaskId } : {}),
        subtaskGoal: input.subtaskGoal,
        allowedMaterialPaths: input.allowedMaterialPaths ?? [],
      });
    }
    if (action === 'resolvePeer') {
      if (!input.granteePackageDir) throw new Error('resolvePeer requires granteePackageDir');
      return host.resolvePeer(input.granteePackageDir);
    }
    if (action === 'revoke') {
      if (!input.grantId) throw new Error('revoke requires grantId');
      return host.revoke(input.grantId);
    }
    if (action === 'execute') {
      if (!input.grantId) throw new Error('execute requires grantId');
      return host.execute(
        input.grantId,
        input.extraMaterialPaths ? { extraMaterialPaths: input.extraMaterialPaths } : {},
      );
    }
    if (action === 'list') {
      return host.list();
    }
    if (action === 'status') {
      if (!input.grantId) throw new Error('status requires grantId');
      const got = await host.getStatus(input.grantId);
      return {
        grantId: got.grantId,
        status: got.status,
        ...(got.ownerDecision ? { ownerDecision: got.ownerDecision } : {}),
        grant: {
          id: got.grant.id,
          status: got.grant.status,
          ...(got.grant.subtaskGoal ? { subtaskGoal: got.grant.subtaskGoal } : {}),
          ...(got.grant.granteeDisplayName
            ? { granteeDisplayName: got.grant.granteeDisplayName }
            : {}),
          ...(got.grant.returnedArtifact?.textExcerpt
            ? { returnedExcerpt: got.grant.returnedArtifact.textExcerpt }
            : {}),
          ...(got.grant.returnedArtifact?.reachedModel !== undefined
            ? { reachedModel: got.grant.returnedArtifact.reachedModel }
            : {}),
          allowedMaterials: (got.grant.scope.resourceRefs ?? []).map((p) => path.resolve(p)),
          ...(got.grant.issuerTaskId ? { issuerTaskId: got.grant.issuerTaskId } : {}),
          ...(got.grant.lastFailure?.message
            ? { failureMessage: got.grant.lastFailure.message }
            : {}),
          ...(got.ownerDecision ? { ownerDecision: got.ownerDecision } : {}),
        },
        ...(got.grant.disclosure?.reachedModel !== undefined
          ? { reachedModel: got.grant.disclosure.reachedModel }
          : {}),
        ...(got.grant.disclosure?.capabilityId
          ? { capabilityId: got.grant.disclosure.capabilityId }
          : {}),
        ...(got.grant.returnedArtifact
          ? {
              artifactId: got.grant.returnedArtifact.artifactId,
              artifactText: got.grant.returnedArtifact.textExcerpt,
            }
          : {}),
      };
    }
    if (action === 'acceptReturn') {
      if (!input.grantId || !input.decision) {
        throw new Error('acceptReturn requires grantId and decision');
      }
      return host.acceptReturn({
        grantId: input.grantId,
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      });
    }
    if (action === 'assertMaterialAccess') {
      if (!input.grantId || !input.attemptMaterialPath) {
        throw new Error('assertMaterialAccess requires grantId and attemptMaterialPath');
      }
      const access = await host.assertMaterialAccess(input.grantId, input.attemptMaterialPath);
      return {
        grantId: input.grantId,
        allowed: access.allowed,
        denied: !access.allowed,
        ...(access.reason ? { reason: access.reason } : {}),
      };
    }
    throw new Error(`unknown collab action: ${String(action)}`);
  }

  async appendOwnerEvent(
    partial: Omit<GrowthEvent, 'id' | 'subjectId' | 'occurredAt' | 'source'> & {
      source?: GrowthEvent['source'];
    },
  ): Promise<GrowthEvent> {
    const pkg = this.subject.requireActive();
    const event: GrowthEvent = {
      id: newId('growthEvent'),
      subjectId: pkg.id,
      occurredAt: nowIso(),
      source: partial.source ?? { kind: 'owner_direct' },
      type: partial.type,
      payload: partial.payload,
      confidence: partial.confidence,
    };
    if (partial.confirms !== undefined) event.confirms = partial.confirms;
    await this.subject.appendGrowthEvent(event);
    return event;
  }

  async stop(): Promise<void> {
    if (this.unsubGrowthJobHook) {
      this.unsubGrowthJobHook();
      this.unsubGrowthJobHook = null;
    }
    if (this.work) await this.work.stop();
  }

  get workRuntime(): WorkRuntime {
    return this.requireWork();
  }

  get artifactWorkspace(): ArtifactWorkspace {
    return this.requireWorkspace();
  }

  private async attachWorkRuntime(): Promise<void> {
    const pkg = this.subject.requireActive();
    const root = path.join(pkg.rootDir, 'runtime');
    await fs.mkdir(root, { recursive: true });

    if (this.work) await this.work.stop();

    const taskStore = new JsonObjectStore<Task>({ dir: path.join(root, 'tasks') });
    const jobStoreRaw = new JsonObjectStore<ExecutionJob>({ dir: path.join(root, 'jobs') });
    const snapshotStore = new JsonObjectStore<ContextSnapshot>({
      dir: path.join(root, 'snapshots'),
    });
    const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
    const contentStore = new ContentStore(path.join(root, 'content'));
    this.contentStore = contentStore;

    const registry = this.registry;

    const subjectService = this.subject;
    const grantStorePromise = GrantStore.open(pkg.rootDir);
    this.work = new WorkRuntime({
      subjectId: pkg.id,
      taskService: new TaskService(taskStore),
      jobStore: new JobStore(jobStoreRaw),
      snapshotBuilder: new ContextSnapshotBuilder(snapshotStore, contentStore),
      artifactCommitter: new ArtifactCommitter(
        artifactStore,
        contentStore,
        path.join(root, 'artifact-files'),
      ),
      registry,
      eventBus: this.eventBus,
      workRoot: path.join(root, 'work'),
      ...(this.options.secrets ? { secrets: this.options.secrets } : {}),
      readExtractedText: async (ref: string) => {
        const bytes = await contentStore.readBytes(ref);
        return bytes.toString('utf8');
      },
      loadSubjectContext: async () => {
        const derived = await subjectService.getDerived();
        return derived.confirmed;
      },
      selectSubjectContext: async ({ goal, requestedArtifactType, intentKind, taskId }) => {
        const derived = await subjectService.getDerived();
        const policy = this.options.executionPolicy ?? 'ai_first';
        const profile = chooseExecutionProfile({ goal, requestedArtifactType });
        let excludeEventIds: string[] = [];
        let includeEventIds: string[] = [];
        let pauseExternalAction = false;
        let ownerChoicePrompt: SubjectSelectionResult['ownerChoicePrompt'];
        if (taskId) {
          const jit = await subjectService.prepareJitForTask({ taskId, goal });
          excludeEventIds = jit.excludeEventIds;
          includeEventIds = jit.includeEventIds;
          pauseExternalAction = jit.pauseExternalAction;
          if (jit.prompt) {
            ownerChoicePrompt = {
              question: jit.prompt.question,
              labelA: jit.prompt.labelA,
              labelB: jit.prompt.labelB,
              eventIdA: jit.prompt.eventIdA,
              eventIdB: jit.prompt.eventIdB,
              highRisk: jit.prompt.highRisk,
            };
          }
        }
        const selected = selectSubjectInjection({
          goal,
          requestedArtifactType,
          ...(intentKind ? { intentKind } : {}),
          derived,
          policy,
          includeCoreMatching:
            policy === 'legacy' || profile === 'careful' || profile === 'high_risk',
          excludeEventIds,
          forceIncludeEventIds: includeEventIds,
        });
        return {
          ...selected,
          ...(pauseExternalAction ? { pauseExternalAction: true } : {}),
          ...(ownerChoicePrompt ? { ownerChoicePrompt } : {}),
        };
      },
      loadAuthorizationGrant: async (grantId: string) => {
        const store = await grantStorePromise;
        return store.get(grantId);
      },
      resolveUnauthorizedMarkers: async ({ allowedMaterialPaths }) => {
        // 启发式:允许路径之外的常见敏感标记由验证层拦截(验收用)
        const allowed = new Set(
          allowedMaterialPaths.map((p) => path.resolve(p).toLowerCase()),
        );
        const markers: string[] = ['SECRET_UNAUTHORIZED_PAYLOAD_XYZ'];
        if (allowed.size > 0) {
          markers.push('未授权融资细节');
        }
        return markers;
      },
    });

    this.workspace = new ArtifactWorkspace({
      artifactStore,
      contentStore,
      subjectService: this.subject,
      eventBus: this.eventBus,
      resolveTaskTopics: async (taskId) => {
        const task = await this.work?.getTask({ taskId }).then((t) => t.task).catch(() => null);
        if (!task) return [];
        return tokenizeTopics(`${task.goal} ${task.requestedArtifactType}`);
      },
    });

    // 修订 Job 成功后记录修改要求来源（不阻塞主链）
    if (this.unsubGrowthJobHook) this.unsubGrowthJobHook();
    this.unsubGrowthJobHook = this.eventBus.subscribe((event) => {
      if (event.kind !== 'job.updated' || event.status !== 'succeeded') return;
      void this.onJobSucceededForGrowth(event.jobId);
    });
  }

  /**
   * 主进程对话捕获入口：基于已持久化 user turn，异步调度，不阻塞回复。
   */
  scheduleConversationGrowthCapture(input: {
    turnId: string;
    userText: string;
    assistantText?: string;
  }): void {
    let pkg;
    try {
      pkg = this.subject.requireActive();
    } catch {
      return;
    }
    const file = conversationFilePath(pkg.rootDir);
    const captureKey = `conversation:${input.turnId}`;
    const pending: GrowthCaptureStatusRecord = {
      kind: 'growth_capture_status',
      turnId: input.turnId,
      status: 'pending',
      attempts: 0,
      updatedAt: nowIso(),
    };
    void appendConversationRow(file, pending).catch(() => undefined);

    this.subject.captureInputAsync(
      {
        text: input.userText,
        sourceKind: 'conversation',
        captureKey,
        ...(input.assistantText
          ? { assistantContext: input.assistantText.slice(0, 400) }
          : {}),
      },
      (result) => {
        const outcome: CaptureOutcome = result.captureOutcome || (result.ok ? 'learned' : 'distill_failed');
        const statusRow: GrowthCaptureStatusRecord = {
          kind: 'growth_capture_status',
          turnId: input.turnId,
          status: outcomeToCaptureStatus(outcome),
          attempts: result.attempts,
          updatedAt: nowIso(),
        };
        void appendConversationRow(file, statusRow).catch(() => undefined);
        if (!result.ok || outcome === 'distill_failed') {
          this.eventBus.publish({
            kind: 'subject.updated',
            subjectId: pkg.id,
            summary: 'growth_capture_retry_exhausted',
          });
        }
      },
    );
  }

  /** 列出对话轮次（忽略内部成长状态行）。供 App Shell 使用。 */
  async listConversationTurns(): Promise<{ turns: Array<{ id: string; role: string; text: string; at: string }> }> {
    const pkg = this.subject.requireActive();
    const rows = await readConversationRows(conversationFilePath(pkg.rootDir));
    return { turns: filterTurnsForUi(rows) };
  }

  /**
   * 打开包 / 相关操作完成后的恢复点：重放未完成对话捕获与缺失的任务目标捕获。
   * 禁止定时全量轮询。
   */
  async recoverPendingGrowthCaptures(): Promise<{ replayed: number }> {
    let replayed = 0;
    let pkg;
    try {
      pkg = this.subject.requireActive();
    } catch {
      return { replayed: 0 };
    }

    const file = conversationFilePath(pkg.rootDir);
    const rows = await readConversationRows(file);
    for (const item of listReplayableUserTurns(rows)) {
      this.scheduleConversationGrowthCapture({
        turnId: item.turn.id,
        userText: item.turn.text,
      });
      replayed += 1;
    }

    if (this.work) {
      const listed = await this.work.listTasks({ limit: 50 });
      for (const row of listed.tasks) {
        const taskId = row.taskId;
        const detail = await this.work.getTask({ taskId }).catch(() => null);
        if (!detail?.task?.goal) continue;
        const events = await this.subject.listGrowthEvents();
        const key = `captureKey:task_requirement:${taskId}`;
        if (events.some((e) => (e.payload.tags ?? []).includes(key))) continue;
        this.scheduleTaskRequirementCapture({
          taskId,
          goal: detail.task.goal,
        });
        replayed += 1;
      }
    }

    return { replayed };
  }

  /** 最近一次对话捕获是否需在聊天气泡旁提示（派生，非 Store）。 */
  async conversationGrowthHint(turnId: string): Promise<{ message: string } | null> {
    const pkg = this.subject.requireActive();
    const rows = await readConversationRows(conversationFilePath(pkg.rootDir));
    const statuses = new Map<string, GrowthCaptureStatusRecord>();
    for (const row of rows) {
      if (row && typeof row === 'object' && (row as GrowthCaptureStatusRecord).kind === 'growth_capture_status') {
        const s = row as GrowthCaptureStatusRecord;
        statuses.set(s.turnId, s);
      }
    }
    const st = statuses.get(turnId);
    if (!st || st.status !== 'failed') return null;
    const message = captureOutcomeUserHint('distill_failed');
    return message ? { message } : null;
  }

  private scheduleTaskRequirementCapture(input: { taskId: string; goal: string }): void {
    const goal = String(input.goal || '').trim();
    if (!goal) return;
    this.subject.captureInputAsync(
      {
        text: goal,
        sourceKind: 'task_requirement',
        taskId: input.taskId,
        captureKey: `task_requirement:${input.taskId}`,
      },
      () => {
        /* 结果经 GrowthEvent / captureKey 可重放；不阻塞提交 */
      },
    );
  }

  private async onJobSucceededForGrowth(jobId: string): Promise<void> {
    if (!this.work) return;
    const job = await this.work.getJob(jobId);
    if (!job || job.status !== 'succeeded') return;
    const revisionRequest = String(job.revisionRequest || '').trim();
    if (!revisionRequest) return;
    const rejectionReason = String(job.rejectionReason || '').trim();
    const artifactId = job.artifactId || job.targetArtifactId;
    let editSummary = '';
    if (artifactId && job.targetArtifactId) {
      try {
        const artifact = await this.work.getArtifact(artifactId);
        if (artifact && artifact.versions.length >= 2) {
          const head = headVersion(artifact);
          const prev = [...artifact.versions]
            .reverse()
            .find((v) => v.versionId !== head.versionId && v.content.kind === 'text');
          if (prev && prev.content.kind === 'text' && head.content.kind === 'text' && this.contentStore) {
            const before = (await this.contentStore.readBytes(prev.content.ref)).toString('utf8');
            const after = (await this.contentStore.readBytes(head.content.ref)).toString('utf8');
            const evidence = extractEditEvidence(before, after);
            editSummary = evidence.detail || evidence.title;
          }
        }
      } catch {
        /* 差异可选 */
      }
    }
    this.subject.captureInputAsync({
      text: `修改要求：${revisionRequest}`,
      sourceKind: 'repeated_correction',
      taskId: job.taskId,
      ...(artifactId ? { artifactId } : {}),
      captureKey: `revision:${jobId}`,
      revisionRequest,
      ...(rejectionReason ? { rejectionReason } : {}),
      ...(editSummary ? { editSummary } : {}),
    });
  }

  private buildCapabilityRegistry(): CapabilityRegistry {
    const registry = new CapabilityRegistry();
    const mode = this.options.documentCapability ?? 'fake';
    if (mode === 'none') {
      if (this.options.registerOpenAiStub) {
        registry.register(createOpenAiCompatibleAdapterStub());
      }
    } else if (mode === 'openai-compatible' || mode === 'both') {
      if (!this.options.openaiCompatible) {
        throw new Error('openaiCompatible config is required when documentCapability uses real model');
      }
      registry.register(createOpenAiCompatibleAdapter(this.options.openaiCompatible));
      if (mode === 'both') {
        registry.register(createFakeDocumentAdapter(this.options.fakeAdapter));
      }
    } else if (mode === 'fake') {
      registry.register(createFakeDocumentAdapter(this.options.fakeAdapter));
      if (this.options.registerOpenAiStub !== false) {
        registry.register(createOpenAiCompatibleAdapterStub());
      }
    }

    if (this.options.codeAnalysisCapability === 'openai-compatible') {
      if (!this.options.openaiCompatible) {
        throw new Error('openaiCompatible config is required for real code analysis');
      }
      registry.register(createCodeRepoAnalysisAdapter(this.options.openaiCompatible));
    } else if (this.options.codeAnalysisCapability === 'deterministic') {
      registry.register(createDeterministicCodeAnalysisAdapter());
    } else if (this.options.codeAnalysisCapability === 'needs_setup') {
      registry.register(createCodeRepoAnalysisAdapterStub());
    }

    const remoteOpt = this.options.remoteCapability;
    if (remoteOpt) {
      const cfg =
        typeof remoteOpt === 'object' ? remoteOpt : this.options.controlledRemote;
      if (!cfg?.endpoint) {
        throw new Error('controlledRemote.endpoint is required when remoteCapability is enabled');
      }
      registry.register(createControlledRemoteCapabilityAdapter(cfg));
    }
    if (this.options.a2aRemoteCapability) {
      // 惰性加载:避免 Electron 主进程默认路径静态拉入 @a2a-js/sdk → jose ESM。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createA2ARemoteCapabilityAdapter } = require('../capability/adapters/a2a-remote') as typeof import('../capability/adapters/a2a-remote');
      registry.register(createA2ARemoteCapabilityAdapter(this.options.a2aRemoteCapability));
    }
    return registry;
  }

  private requireWork(): WorkRuntime {
    if (!this.work) throw new Error('work runtime not attached; open or create a package first');
    return this.work;
  }

  private requireWorkspace(): ArtifactWorkspace {
    if (!this.workspace) {
      throw new Error('artifact workspace not attached; open or create a package first');
    }
    return this.workspace;
  }
}

function tokenizeTopics(text: string): string[] {
  const result = new Set<string>();
  const lower = text.toLowerCase();
  for (const part of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (part.length >= 2) result.add(part);
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i < part.length - 1; i += 1) {
        result.add(part.slice(i, i + 2));
      }
    }
  }
  return [...result].slice(0, 24);
}

export function createDigitalMeRuntime(options?: DigitalMeRuntimeOptions): DigitalMeRuntime {
  return new DigitalMeRuntime(options);
}
