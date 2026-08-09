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
import {
  createExternalExecutorCodexAdapter,
} from '../capability/adapters/external-executor-codex';
import {
  createUnsupportedDesktopCodingAdapter,
  type UnsupportedDesktopCodingOptions,
} from '../capability/adapters/unsupported-desktop-coding';
import {
  EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
} from '../execution/external-executor-contract';
import {
  recommendedCodingCapability,
} from '../capability/coding-capability';
import { listCodingCapabilityStatuses } from '../capability/coding-capability-probe';
import {
  clearPendingSoftwareTask,
  loadCodingCapabilityPrefs,
  loadPendingSoftwareTask,
  saveCodingCapabilityPrefs,
  savePendingSoftwareTask,
} from '../capability/coding-capability-draft';
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
  /**
   * 外部代码执行能力（Codex CLI）:
   * - auto/undefined:探测本机 Codex，可用则注册 available，否则 needs_setup
   * - false:不注册
   * - options 对象:强制注册（测试可注入 executeHook）
   */
  externalExecutorCapability?:
    | false
    | 'auto'
    | import('../capability/adapters/external-executor-codex').ExternalExecutorCodexOptions;
  /**
   * 测试注入：不支持自动调用的桌面 Coding Agent 描述。
   * false/undefined：不注册。
   */
  unsupportedDesktopCodingCapability?: false | UnsupportedDesktopCodingOptions;
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
  private artifactCommitter: ArtifactCommitter | null = null;
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
      if (created.needsExecutorSetup) {
        try {
          await savePendingSoftwareTask(this.requireRuntimeDir(), {
            goal: input.goal,
            contextRefs: (input.contextRefs || []).filter(
              (r): r is { kind: 'file' | 'folder'; path: string } =>
                !!r && (r.kind === 'file' || r.kind === 'folder') && !!r.path,
            ),
            userFacingNotice: '连接代码执行能力后可继续',
          });
        } catch {
          /* 草稿可选 */
        }
      }
      if (created.taskId) {
        await clearPendingSoftwareTask(this.requireRuntimeDir()).catch(() => undefined);
        this.scheduleTaskRequirementCapture({
          taskId: created.taskId,
          goal: input.goal,
        });
      }
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
    return this.requireWorkspace().getContent(
      input.artifactId,
      input.versionId,
      input.expectedTaskId,
    );
  }

  /**
   * 协作交付物化：完整成果进入本方 Artifact Store，并保留对方来源与约定 digest。
   */
  async materializePeerArtifact(input: {
    title: string;
    text: string;
    recordId: string;
    provenance: import('../work-runtime/artifact').ArtifactProvenance;
    existingArtifactId?: string;
  }): Promise<{ artifactId: string; headVersionId: string; contentDigest: string }> {
    if (!this.artifactCommitter) {
      throw new Error('artifact committer not attached; open or create a package first');
    }
    const pkg = this.subject.requireActive();
    const { artifact, contentDigest } = await this.artifactCommitter.materializePeerText({
      subjectId: pkg.id,
      recordId: input.recordId,
      title: input.title,
      text: input.text,
      provenance: input.provenance,
      ...(input.existingArtifactId ? { existingArtifactId: input.existingArtifactId } : {}),
    });
    return {
      artifactId: artifact.id,
      headVersionId: artifact.headVersionId,
      contentDigest,
    };
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

    const prefsRaw = this.tryRuntimeDir();
    const prefs = prefsRaw ? await loadCodingCapabilityPrefs(prefsRaw).catch(() => null) : null;
    const codingPrefs = prefs?.defaultCapabilityId
      ? { defaultCapabilityId: prefs.defaultCapabilityId }
      : undefined;

    if (input.codingAction) {
      const runtimeDir = this.tryRuntimeDir();
      if (input.codingAction.type === 'set_default' && runtimeDir) {
        await saveCodingCapabilityPrefs(runtimeDir, {
          defaultCapabilityId: input.codingAction.capabilityId,
        });
      } else if (input.codingAction.type === 'save_pending' && runtimeDir) {
        await savePendingSoftwareTask(runtimeDir, {
          goal: input.codingAction.goal,
          contextRefs: input.codingAction.contextRefs,
          ...(input.codingAction.acceptanceNotes
            ? { acceptanceNotes: input.codingAction.acceptanceNotes }
            : {}),
        });
      } else if (input.codingAction.type === 'clear_pending' && runtimeDir) {
        await clearPendingSoftwareTask(runtimeDir);
      }
    }

    const { statuses, preferred } = await listCodingCapabilityStatuses(this.registry, {
      probe: !!input.includeAvailability,
      ...(codingPrefs
        ? {
            prefs: {
              ...(input.codingAction && input.codingAction.type === 'set_default'
                ? { defaultCapabilityId: input.codingAction.capabilityId }
                : codingPrefs),
            },
          }
        : input.codingAction && input.codingAction.type === 'set_default'
          ? { prefs: { defaultCapabilityId: input.codingAction.capabilityId } }
          : {}),
    });
    out.codingCapabilities = statuses;
    out.codingRecommendation = recommendedCodingCapability();
    if (preferred) out.preferredCodingCapabilityId = preferred.capabilityId;

    const pending = this.tryRuntimeDir()
      ? await loadPendingSoftwareTask(this.tryRuntimeDir()!)
      : null;
    out.pendingSoftwareTask = pending
      ? {
          goal: pending.goal,
          contextRefs: pending.contextRefs,
          ...(pending.acceptanceNotes ? { acceptanceNotes: pending.acceptanceNotes } : {}),
          status: pending.status,
          userFacingNotice: pending.userFacingNotice,
          savedAt: pending.savedAt,
        }
      : null;

    const primary =
      preferred ||
      statuses.find((s) => s.supportsAutomaticExecution) ||
      statuses[0];
    if (primary) {
      out.executorCapabilityCard = {
        capabilityId: primary.capabilityId,
        displayName: primary.displayName,
        shortDescription: primary.canDo,
        canDo: primary.canDo,
        allowedScope: '仅限你确认的项目文件夹；不会自动提交、推送或发布。',
        available: primary.availability === 'ready' && primary.supportsAutomaticExecution,
        availabilityLabel: primary.connectionStatus,
        connectionStatus: primary.connectionStatus,
        executionModeLabel: primary.executionModeLabel,
        supportsAutomaticExecution: primary.supportsAutomaticExecution,
        detail: primary.actionableMessage,
      };
    }

    return out;
  }

  async interactCollab(
    input: CommandMap['collab.interact']['input'],
  ): Promise<CommandMap['collab.interact']['output']> {
    let action = input.action;
    if (!action) {
      throw new Error('collab.interact requires action（内存模拟已移出命令面，请直接使用测试替身）');
    }
    if (action === 'issue') action = 'propose';
    if (action === 'execute') action = 'fulfill';
    if (action === 'acceptReturn') action = 'decideResult';

    const { getCollaborationTransport, resolveCommCipher } = await import(
      '../subject-comm/transport-factory'
    );
    const collabTransport = await getCollaborationTransport(this, resolveCommCipher());
    const host = new LocalCollaborationHost(this, collabTransport);
    const id = input.recordId || input.grantId;

    if (action === 'propose') {
      const intent = (input.intent || input.subtaskGoal || '').trim();
      if (!input.granteePackageDir || !intent) {
        throw new Error('propose requires granteePackageDir and intent/subtaskGoal');
      }
      const materials = (input.allowedMaterialPaths ?? []).map((p) => ({ path: p }));
      const criteria =
        input.acceptanceCriteria && input.acceptanceCriteria.length > 0
          ? input.acceptanceCriteria
          : ['提供可核对的完整成果，并说明依据'];
      const result = await host.propose({
        responderPackageDir: input.granteePackageDir,
        proposal: {
          intent,
          expectedOutcome: (input.expectedOutcome || intent).trim(),
          offeredMaterials: materials,
          acceptanceCriteria: criteria,
          ...(input.deadline ? { deadline: input.deadline } : {}),
          ...(input.costTerms ? { costTerms: input.costTerms } : {}),
        },
        ...(input.issuerTaskId ? { issuerTaskId: input.issuerTaskId } : {}),
        ...(input.skipAutoEvaluate ? { skipAutoEvaluate: true } : {}),
      });
      return {
        recordId: result.recordId,
        status: result.status,
        ...(result.grantId ? { grantId: result.grantId } : {}),
        ...(result.evaluationBasis ? { evaluationBasis: result.evaluationBasis } : {}),
        ...(result.requiresOwnerConfirmation ? { requiresOwnerConfirmation: true } : {}),
      };
    }
    if (action === 'evaluate') {
      if (!id) throw new Error('evaluate requires recordId');
      return host.autoEvaluateAndMaybeAgree(id);
    }
    if (action === 'respond') {
      if (!id || !input.decision) throw new Error('respond requires recordId and decision');
      const decision = input.decision;
      if (
        decision !== 'accept' &&
        decision !== 'reject' &&
        decision !== 'counter_propose' &&
        decision !== 'request_clarification'
      ) {
        throw new Error('respond decision must be accept|reject|counter_propose|request_clarification');
      }
      return host.respond({
        recordId: id,
        decision,
        ...(input.terms ? { terms: input.terms } : {}),
        ...(input.note ? { note: input.note } : {}),
      });
    }
    if (action === 'resolvePeer') {
      if (!input.granteePackageDir) throw new Error('resolvePeer requires granteePackageDir');
      return host.resolvePeer(input.granteePackageDir);
    }
    if (action === 'revoke') {
      if (!id) throw new Error('revoke requires recordId or grantId');
      return host.revoke(id);
    }
    if (action === 'fulfill') {
      if (!id) throw new Error('fulfill requires recordId');
      return host.fulfill(id);
    }
    if (action === 'requestRevision') {
      if (!id || !input.note) throw new Error('requestRevision requires recordId and note');
      return host.requestRevision({ recordId: id, note: input.note });
    }
    if (action === 'list') {
      return host.list();
    }
    if (action === 'reconcile') {
      if (!id) throw new Error('reconcile requires recordId');
      const record = await host.reconcile(id);
      return { recordId: record.recordId, status: 'ok' };
    }
    if (action === 'status') {
      if (!id) throw new Error('status requires recordId or grantId');
      const got = await host.getStatus(id);
      return {
        recordId: got.recordId,
        ...(got.grantId ? { grantId: got.grantId } : {}),
        status: got.status,
        ...(got.role ? { role: got.role } : {}),
        ...(got.peerDisplayName ? { peerDisplayName: got.peerDisplayName } : {}),
        ...(got.ownerDecision ? { ownerDecision: got.ownerDecision } : {}),
        ...(got.grant ? { grant: got.grant } : {}),
        ...(got.artifactId ? { artifactId: got.artifactId } : {}),
        ...(got.artifactText ? { artifactText: got.artifactText } : {}),
        ...(got.grant?.termsDigest ? { termsDigest: got.grant.termsDigest } : {}),
        ...(got.grant?.evaluationBasis ? { evaluationBasis: got.grant.evaluationBasis } : {}),
      };
    }
    if (action === 'decideResult') {
      if (!id || !input.decision) {
        throw new Error('decideResult requires recordId and decision');
      }
      if (input.decision !== 'accept' && input.decision !== 'reject') {
        throw new Error('decideResult decision must be accept or reject');
      }
      return host.decideResult({
        recordId: id,
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      });
    }
    if (action === 'assertMaterialAccess') {
      if (!id || !input.attemptMaterialPath) {
        throw new Error('assertMaterialAccess requires recordId/grantId and attemptMaterialPath');
      }
      const access = await host.assertMaterialAccess(id, input.attemptMaterialPath);
      return {
        recordId: id,
        grantId: id,
        allowed: access.allowed,
        denied: !access.allowed,
        ...(access.reason ? { reason: access.reason } : {}),
      };
    }
    throw new Error(`unknown collab action: ${String(action)}`);
  }

  async subjectCommunicate(
    input: CommandMap['subject.communicate']['input'],
  ): Promise<CommandMap['subject.communicate']['output']> {
    const { SignalOpportunityHost } = await import('../subject-comm/signal-host');
    const { openRelayIfConfigured, getCollaborationTransport, resolveCommCipher } =
      await import('../subject-comm/transport-factory');
    const { processTransportInbox } = await import('../subject-comm/process-inbox');
    const { isRemoteEndpointRef } = await import('../subject-comm/endpoint');
    const cipher = resolveCommCipher();
    const relay = await openRelayIfConfigured(this, cipher);
    const collabTransport = await getCollaborationTransport(this, cipher);
    const transport = collabTransport.asSubjectTransport();
    const host = new SignalOpportunityHost(this, transport, relay);
    const action = input.action;
    if (!action) throw new Error('subject.communicate requires action');

    const mapOpp = (c: {
      id: string;
      peerDisplayName: string;
      stage: string;
      seekingSummary: string;
      offeringSummary: string;
      whyWorthKnowing: string;
      privacyNote: string;
      peerBrief?: string;
      localBrief?: string;
      collaborationRecordId?: string;
    }) => ({
      id: c.id,
      peerDisplayName: c.peerDisplayName,
      stage: c.stage,
      seekingSummary: c.seekingSummary,
      offeringSummary: c.offeringSummary,
      whyWorthKnowing: c.whyWorthKnowing,
      privacyNote: c.privacyNote,
      ...(c.peerBrief ? { peerBrief: c.peerBrief } : {}),
      ...(c.localBrief ? { localBrief: c.localBrief } : {}),
      ...(c.collaborationRecordId ? { collaborationRecordId: c.collaborationRecordId } : {}),
    });

    if (action === 'configureRelay') {
      if (!input.relayUrl) throw new Error('configureRelay requires relayUrl');
      const { CommIdentityStore } = await import('../subject-comm/identity-store');
      const pkg = this.subject.requireActive();
      const store = new CommIdentityStore(pkg.rootDir, cipher);
      const { profile } = await store.ensureLocalEndpoint({
        subjectId: pkg.id,
        displayName: pkg.identity.displayName,
        relayUrl: input.relayUrl,
      });
      const { RelayClient } = await import('../subject-comm/relay-client');
      const health = await new RelayClient(profile.relayUrl).health();
      return {
        ok: true,
        mode: 'remote',
        reachable: health.reachable && health.ok,
        connectionLabel: health.reachable && health.ok ? '已连接' : '无法连接',
      };
    }
    if (action === 'createInvite') {
      const { CommIdentityStore } = await import('../subject-comm/identity-store');
      const { createInvite } = await import('../subject-comm/invite');
      const pkg = this.subject.requireActive();
      const store = new CommIdentityStore(pkg.rootDir, cipher);
      const self = await store.getLocalProfile();
      if (!self) throw new Error('请先连接 Relay');
      const invite = createInvite(self, new Date().toISOString());
      return { ok: true, inviteJson: JSON.stringify(invite) };
    }
    if (action === 'acceptInvite') {
      if (!input.inviteJson) throw new Error('acceptInvite requires inviteJson');
      const { CommIdentityStore } = await import('../subject-comm/identity-store');
      const { acceptInvite } = await import('../subject-comm/invite');
      const pkg = this.subject.requireActive();
      const store = new CommIdentityStore(pkg.rootDir, cipher);
      if (!(await store.getLocalProfile())) {
        throw new Error('请先连接 Relay');
      }
      const parsed = JSON.parse(input.inviteJson) as unknown;
      const { peer, replyInvite } = await acceptInvite(store, parsed);
      return {
        ok: true,
        peerDisplayName: peer.displayName,
        inviteJson: JSON.stringify(replyInvite),
        connectionLabel: '已连接',
      };
    }
    if (action === 'listPeers') {
      const { CommIdentityStore } = await import('../subject-comm/identity-store');
      const { remoteEndpointRef } = await import('../subject-comm/endpoint');
      const pkg = this.subject.requireActive();
      const store = new CommIdentityStore(pkg.rootDir, cipher);
      const peers = await store.listPeers();
      const self = await store.getLocalProfile();
      const h = await transport.health();
      const paired = peers.length > 0;
      return {
        peers: peers.map((p) => ({
          displayName: p.displayName,
          endpointRef: remoteEndpointRef(p.endpointId),
          statusLabel: paired ? (h.reachable ? '已连接' : '已建立联系') : '',
        })),
        ...(self?.relayUrl ? { relayUrl: self.relayUrl } : {}),
        connectionLabel: !self
          ? '尚未配置'
          : h.reachable
            ? paired
              ? '已连接'
              : '中继已连接'
            : paired
              ? '已建立联系，暂时无法连接中继'
              : '暂时无法连接中继',
      };
    }
    if (action === 'retryOutbox') {
      if (!relay) return { submitted: 0, failed: 0, remaining: 0 };
      const r = await relay.retryOutbox();
      return {
        submitted: r.submitted,
        failed: r.failed,
        remaining: r.remaining,
        ok: true,
      };
    }
    if (action === 'pullRemote') {
      if (!relay) return { fetched: 0, rejected: 0 };
      const r = await relay.pullFromRelay();
      await processTransportInbox(this, transport);
      return { fetched: r.fetched, rejected: r.rejected, ok: true };
    }

    if (action === 'health') {
      const h = await transport.health();
      return {
        mode: h.mode,
        reachable: h.reachable,
        capabilities: h.capabilities,
        connectionLabel: h.reachable
          ? h.mode === 'remote'
            ? '已连接'
            : '已连接'
          : '无法连接',
      };
    }
    if (action === 'processInbox') {
      const r = await processTransportInbox(this, transport);
      return { processed: r.processed, collabSynced: r.collabSynced };
    }
    if (action === 'listInbox') {
      const items = await transport.listInbox({});
      return {
        inbox: items.map((e) => ({
          envelopeId: e.envelopeId,
          kind: e.kind,
          fromDisplayName: e.from.displayName,
          acked: !!e.ackedAt,
          createdAt: e.createdAt,
        })),
      };
    }
    if (action === 'acknowledge') {
      if (!input.envelopeId) throw new Error('acknowledge requires envelopeId');
      const r = await transport.acknowledge(input.envelopeId);
      return { ok: r.ok };
    }
    if (action === 'sendSignal') {
      if (!input.signal) throw new Error('sendSignal requires signal');
      if (!input.peerPackageDir && !input.peerEndpointRef) {
        throw new Error('sendSignal requires peerPackageDir or peerEndpointRef');
      }
      const sent = await host.sendSignal({
        ...(input.peerPackageDir ? { peerPackageDir: input.peerPackageDir } : {}),
        ...(input.peerEndpointRef ? { peerEndpointRef: input.peerEndpointRef } : {}),
        signal: {
          intent: input.signal.intent,
          seeking: input.signal.seeking || [],
          offering: input.signal.offering || [],
          disclosureLevel: input.signal.disclosureLevel || 'minimal',
          ...(input.signal.constraints ? { constraints: input.signal.constraints } : {}),
          ...(input.signal.expiresAt ? { expiresAt: input.signal.expiresAt } : {}),
        },
      });
      // 仅本地路径：打开对端处理。远程由对方 pullRemote / processInbox。
      if (input.peerPackageDir && !input.peerEndpointRef) {
        const peerRt = this.createSiblingRuntime();
        try {
          await peerRt.openPackage({ dir: input.peerPackageDir });
          const peerHost = new SignalOpportunityHost(peerRt);
          await peerHost.processInbox();
        } finally {
          await peerRt.stop();
        }
        await host.processInbox();
      }
      return {
        envelopeId: sent.envelopeId,
        opportunityId: sent.opportunityId,
        delivered: sent.delivered,
      };
    }
    if (action === 'listOpportunities') {
      if (relay) await relay.pullFromRelay().catch(() => undefined);
      await processTransportInbox(this, transport);
      const listed = await host.listOpportunities();
      return { items: listed.items.map(mapOpp) };
    }
    if (action === 'continueInterest') {
      if (!input.opportunityId) throw new Error('continueInterest requires opportunityId');
      const r = await host.continueInterest(input.opportunityId);
      const card = r.item;
      if (!isRemoteEndpointRef(card.peerEndpointRef)) {
        const dir = await collabTransport.lookupPackageDir(card.peerEndpointRef);
        if (dir) {
          const peerRt = this.createSiblingRuntime();
          try {
            await peerRt.openPackage({ dir });
            await new SignalOpportunityHost(peerRt).processInbox();
          } finally {
            await peerRt.stop();
          }
          await host.processInbox();
        }
      }
      const listed = await host.listOpportunities();
      const updated = listed.items.find((i) => i.id === input.opportunityId) || r.item;
      return { item: mapOpp(updated) };
    }
    if (action === 'decline') {
      if (!input.opportunityId) throw new Error('decline requires opportunityId');
      return host.decline(input.opportunityId);
    }
    if (action === 'discloseBrief') {
      if (!input.opportunityId) throw new Error('discloseBrief requires opportunityId');
      const r = await host.discloseBrief(input.opportunityId);
      if (!isRemoteEndpointRef(r.item.peerEndpointRef)) {
        const dir = await collabTransport.lookupPackageDir(r.item.peerEndpointRef);
        if (dir) {
          const peerRt = this.createSiblingRuntime();
          try {
            await peerRt.openPackage({ dir });
            await new SignalOpportunityHost(peerRt).discloseBrief(input.opportunityId).catch(() => undefined);
            await new SignalOpportunityHost(peerRt).processInbox();
          } finally {
            await peerRt.stop();
          }
          await host.processInbox();
        }
      }
      const listed = await host.listOpportunities();
      const updated = listed.items.find((i) => i.id === input.opportunityId) || r.item;
      return { item: mapOpp(updated) };
    }
    if (action === 'startCollaboration') {
      if (!input.opportunityId) throw new Error('startCollaboration requires opportunityId');
      const r = await host.startCollaboration({
        opportunityId: input.opportunityId,
        ...(input.intent ? { intent: input.intent } : {}),
      });
      return { recordId: r.recordId, ...(r.status ? { status: r.status } : {}) };
    }
    throw new Error(`unknown subject.communicate action: ${String(action)}`);
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
    this.work = null;
    this.workspace = null;
  }

  get workRuntime(): WorkRuntime {
    return this.requireWork();
  }

  get artifactWorkspace(): ArtifactWorkspace {
    return this.requireWorkspace();
  }

  /** 是否已挂载工作运行时（默认包已 open/create）。 */
  isPackageAttached(): boolean {
    return !!this.work;
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
    const artifactCommitter = new ArtifactCommitter(
      artifactStore,
      contentStore,
      path.join(root, 'artifact-files'),
    );
    this.artifactCommitter = artifactCommitter;
    this.work = new WorkRuntime({
      subjectId: pkg.id,
      taskService: new TaskService(taskStore),
      jobStore: new JobStore(jobStoreRaw),
      snapshotBuilder: new ContextSnapshotBuilder(snapshotStore, contentStore),
      artifactCommitter,
      registry,
      eventBus: this.eventBus,
      workRoot: path.join(root, 'work'),
      getArtifactOwnerDecision: (artifactId, artifactVersionId) =>
        subjectService.getArtifactOwnerDecision(artifactId, artifactVersionId),
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
        const scopeHints = [goal];
        try {
          const detail =
            taskId && this.work
              ? await this.work.getTask({ taskId }).catch(() => null)
              : null;
          // 仅当前任务材料路径参与项目范围，不得用主体库全部资料污染无关任务
          for (const ref of detail?.task?.contextRefs || []) {
            if (ref.path) scopeHints.push(String(ref.path));
          }
        } catch {
          // ignore
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
          scopeHints,
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
        const work = this.work;
        if (!work) break;
        const taskId = row.taskId;
        const detail = await work.getTask({ taskId }).catch(() => null);
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

    if (this.options.externalExecutorCapability !== false) {
      const opt =
        typeof this.options.externalExecutorCapability === 'object'
          ? this.options.externalExecutorCapability
          : {};
      const adapter = createExternalExecutorCodexAdapter(opt);
      // 同步探测：构造期尽量反映真实可用性（异步细节由 checkAvailability 再确认）
      try {
        if (opt.forceAvailability === 'ready' || opt.executeHook) {
          (adapter.registration as { availability: string }).availability = 'available';
        } else if (
          opt.forceAvailability === 'needs_setup' ||
          opt.forceAvailability === 'needs_login' ||
          opt.forceAvailability === 'unavailable' ||
          opt.forceAvailability === 'unsupported'
        ) {
          (adapter.registration as { availability: string }).availability = 'needs_setup';
        } else {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fsSync = require('node:fs') as typeof import('node:fs');
          const { resolveCodexJs } = require('../capability/adapters/external-executor-codex') as typeof import('../capability/adapters/external-executor-codex');
          const js = opt.codexJsPath || resolveCodexJs();
          fsSync.accessSync(js);
          (adapter.registration as { availability: string }).availability = 'available';
        }
      } catch {
        (adapter.registration as { availability: string }).availability = 'needs_setup';
      }
      registry.register(adapter);
    }
    if (this.options.unsupportedDesktopCodingCapability) {
      registry.register(
        createUnsupportedDesktopCodingAdapter(
          typeof this.options.unsupportedDesktopCodingCapability === 'object'
            ? this.options.unsupportedDesktopCodingCapability
            : {},
        ),
      );
    }
    return registry;
  }

  private tryRuntimeDir(): string | null {
    try {
      const pkg = this.subject.requireActive();
      return path.join(pkg.rootDir, 'runtime');
    } catch {
      return null;
    }
  }

  private requireRuntimeDir(): string {
    const dir = this.tryRuntimeDir();
    if (!dir) throw new Error('work runtime not attached; open or create a package first');
    return dir;
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
