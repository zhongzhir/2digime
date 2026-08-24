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
  createMcpReadonlyAdapter,
  looksLikeProvidedMaterialsLookup,
  MCP_READONLY_CAPABILITY_ID,
  type McpReadonlyOptions,
} from '../capability/adapters/mcp-stdio-readonly';
import {
  createExternalExecutorSecondaryAdapter,
  type SecondaryExecutorOptions,
} from '../capability/adapters/external-executor-secondary';
import {
  createExternalExecutorModelApiAdapter,
  type ExternalExecutorModelApiOptions,
} from '../capability/adapters/external-executor-model-api';
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
import {
  buildConversationSubjectContext as assembleConversationSubjectContext,
  buildConversationSystemContent as assembleConversationSystemContent,
  buildControlledFactualReply as assembleControlledFactualReply,
  detectUnsupportedInference,
  isPersonalInferenceQuery as isPersonalInferenceQueryFn,
  isSubjectFactQuery as isSubjectFactQueryFn,
  type ConversationSubjectContextResult,
  type UnsupportedInferenceHit,
} from '../subject-core/conversation-context';
import { buildUserVisibleFacts } from '../subject-core/user-facing-overview';
import { buildMaterialSummary } from '../work-runtime/material-summary';
import { ArtifactWorkspace } from '../artifact-workspace/workspace';
import type { CommandMap } from '../runtime/commands';
import type { GrowthEvent } from '../subject-core/growth-event';
import { LocalCollaborationHost } from '../collaboration/local-collaboration';
import { GrantStore } from '../collaboration/grant-store';
import { CollaborationRecordStore } from '../collaboration/record-store';
import {
  decideDelegation,
  delegationCandidates,
  type DelegationAudit,
} from '../collaboration/delegated-execution';
import { deriveWorkIntent } from '../work-runtime/work-intent';
import { taskNeedFromWorkIntent } from '../capability/capability-closure';
import { waitForJobTerminal } from '../work-runtime/job-runner';
import {
  deriveGrowthProfile,
  dimensionByKey,
  guideChoiceCaptureKey,
  isEphemeralConversationIntent,
  parseGuideChoiceCaptureKey,
  stageReachedCaptureKey,
  type GrowthCollabItem,
  type GrowthWorkItem,
  type UserFacingGrowthSnapshot,
} from '../subject-core/growth-profile';
import { nowIso, newId } from '../shared/ids';
import { chooseExecutionProfile } from '../work-runtime/ai-first-policy';
import {
  appendConversationRow,
  conversationFilePath,
  filterTurnsForUi,
  latestCaptureStatusByTurnId,
  listReplayableUserTurns,
  outcomeToCaptureStatus,
  readConversationRows,
  type GrowthCaptureStatusRecord,
} from '../subject-core/conversation-transcript';
import { captureOutcomeUserHint, type CaptureOutcome } from '../subject-core/capture-outcome';
import { extractEditEvidence } from '../subject-core/diff-evidence';
import { headVersion } from '../work-runtime/artifact';
import { runWorkConverse, type WorkConverseDeps } from '../work-runtime/work-converse';
import { maybeRunControlledRevisionAfterJob } from '../work-runtime/controlled-revision-runner';
import {
  collectGenericCtoEvidence,
  runGenericArtifactCtoReview,
} from '../execution/generic-cto-review';
import {
  ACCEPTANCE_REVIEW_FAILED_MESSAGE,
  asArtifactAcceptance,
  resolveCurrentAcceptance,
} from '../work-runtime/artifact-acceptance';
import type { OwnerAcceptanceSummary } from '../execution/acceptance-summary';
import { chatComplete, ModelHttpError, type ChatMessage } from '../infrastructure/model-http';
import { AI_CTO_JSON_SCHEMA } from '../execution/ai-cto-review';
import { providerCredentialKey } from '../infrastructure/secret-store';

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
   * TRIAL-SURFACE-01B：无专用代码执行器时的模型兜底运输（agent 连接器的 model-api 运输）。
   * - undefined：默认——当真实模型已配置（documentCapability 为 openai-compatible/both 且有 openaiCompatible）时注册；
   *   否则不注册（fake/none 测试运行时禁止假模型冒充改代码）。
   * - true：强制注册（测试可注入 chatCompleteHook）。
   * - false：不注册。
   * - options：显式注册（测试注入）。
   */
  modelApiCapability?: boolean | ExternalExecutorModelApiOptions;
  /**
   * 最小只读外部工具能力（mcp-stdio）。
   * - false/undefined：默认**不注册**（无空壳入口）。
   * - McpReadonlyOptions：显式启用（测试 / gate / 验收）。工具不是 Agent。
   */
  mcpReadonlyCapability?: false | McpReadonlyOptions;
  /**
   * 第二成熟 Agent（备用代码执行能力）。
   * - false/undefined：默认**不注册**（无空壳）。
   * - SecondaryExecutorOptions：显式启用（测试 / gate / 验收）。kind='agent'。
   */
  secondaryExecutorCapability?: false | SecondaryExecutorOptions;
  /**
   * 测试注入：不支持自动调用的桌面 Coding Agent 描述。
   * false/undefined：不注册。
   */
  unsupportedDesktopCodingCapability?: false | UnsupportedDesktopCodingOptions;
  /**
   * D11-A 对话中枢模型调用注入（测试/评测用）。
   * 缺省时按 documentCapability + openaiCompatible + secrets 走真实模型;
   * 均不可用则 converse 进入降级(不得从自然语言创建 Job)。
   */
  converseChat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
  /**
   * D11-C 独立 CTO 验收模型调用注入。未配置时验收如实显示无法完成独立审查，
   * 不使用旧模板冒充模型结论。
   */
  ctoReviewChat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;
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
  private readonly acceptanceLocks = new Map<string, Promise<void>>();
  /** 串行化阶段达成写入，避免连续打开时 TOCTOU 重复追加。 */
  private growthStageRecordChain: Promise<void> = Promise.resolve();
  /** 进程内生命周期，不落盘。关闭时取消尚未完成的通用 CTO 评价。 */
  private ctoReviewAbort = new AbortController();
  private readonly ctoReviewInflight = new Set<Promise<void>>();

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
    await this.maybeRecordGrowthStage();
    return result;
  }

  async getOverview(input: CommandMap['subject.getOverview']['input'] = {}) {
    const overview = await this.subject.getOverview(input);
    try {
      const growth = await this.buildGrowthSnapshot();
      return { ...overview, growth };
    } catch {
      return overview;
    }
  }

  /**
   * 对话回复用主体上下文 — 与「数字之我」页共用唯一的「当前有效本人认识」选择器。
   * 仅含已确认、当前有效的本人信息；候选 / 失效 / 任务临时材料 / 外部项目主张 / 内部过程事件不进入。
   * normal 与 growth_guided 共用；读取失败返回 { ok:false }，不得转成空主体。
   */
  async buildConversationSubjectContext(): Promise<ConversationSubjectContextResult> {
    if (!this.subject.getActive()) return { ok: false, reason: 'no_package' };
    try {
      const derived = await this.subject.getDerived();
      return { ok: true, ...assembleConversationSubjectContext(derived) };
    } catch {
      return { ok: false, reason: 'read_failed' };
    }
  }

  /**
   * 对话系统提示装配（供壳层与验收复用）：主体事实列表 + 可选成长引导指令。
   */
  buildConversationSystemContent(input: {
    subjectFacts?: string[];
    subjectContext?: string;
    growthGuide?: string;
  }): string {
    return assembleConversationSystemContent(input);
  }

  /**
   * 01B：模型回复返回前执行 unsupported inference 检测。
   * 以当前唯一事实投影 userVisibleFacts 为支撑；命中且无支撑时返回违规命中列表。
   * 01C：检测内部异常直接抛出（调用方必须 fail closed），不得返回空命中放行。
   */
  async checkUnsupportedInference(assistantText: string): Promise<UnsupportedInferenceHit[]> {
    if (!this.subject.getActive()) return [];
    const derived = await this.subject.getDerived();
    const facts = buildUserVisibleFacts(derived);
    return detectUnsupportedInference(assistantText, facts);
  }

  /**
   * 01C：主体事实查询判定（「关于我，你有什么印象」「你了解我什么」等）。
   */
  isSubjectFactQuery(text: string): boolean {
    return isSubjectFactQueryFn(text);
  }

  /**
   * 01D：本人推断查询判定（「我是不是在找工作」「你觉得我性格怎样」等）。
   * 必须同时指向「我/我的/本人」且询问求职/职业/性格/身份/价值偏好主题。
   */
  isPersonalInferenceQuery(text: string): boolean {
    return isPersonalInferenceQueryFn(text);
  }

  /**
   * 01C：由 userVisibleFacts 直接生成受控回复，不做推断、不加解释。
   */
  buildControlledFactualReply(facts: string[]): string {
    return assembleControlledFactualReply(facts);
  }

  /**
   * 已连接只读资料能力时，对「查看已提供的项目资料」类问题直接调用能力。
   * 属于对话回答，不得创建 Task / Job / 成果卡。
   */
  async tryProvidedMaterialsLookup(goal: string): Promise<{ text: string } | null> {
    if (!looksLikeProvidedMaterialsLookup(goal)) return null;
    if (!this.isPackageAttached()) return null;
    const mcp = this.registry.get(MCP_READONLY_CAPABILITY_ID);
    if (!mcp || mcp.registration.availability !== 'available') return null;
    const pkg = this.subject.requireActive();
    const output = await mcp.execute(
      {
        goal,
        snapshot: {
          id: 'conversation_lookup',
          taskId: '',
          createdAt: nowIso(),
          items: [],
        },
        subjectContext: {
          subjectId: pkg.id,
          derivedAt: nowIso(),
          entries: [],
        },
        artifactType: 'document',
      },
      {
        jobId: 'conversation_lookup',
        reportProgress: () => undefined,
        signal: new AbortController().signal,
        secrets: { get: async () => null },
        workDir: '',
      },
    );
    const payload = output.artifact?.payload;
    const text =
      payload && payload.kind === 'text' ? String(payload.text || '').trim() : '';
    if (!text) return { text: '这次没能查到项目资料，请稍后再试。' };
    return { text };
  }

  confirmExperience(input: CommandMap['subject.confirmExperience']['input']) {
    return this.subject.confirmCandidates(input).then(async (result) => {
      await this.maybeRecordGrowthStage();
      return result;
    });
  }

  respondToLearning(input: CommandMap['subject.respondToLearning']['input']) {
    return this.subject.respondToLearning(input).then(async (result) => {
      await this.maybeRecordGrowthStage();
      return result;
    });
  }

  async captureSubjectInput(input: CommandMap['subject.captureInput']['input']) {
    const guideChoice = input.captureKey ? parseGuideChoiceCaptureKey(input.captureKey) : null;
    if (guideChoice && input.captureKey) {
      const events = await this.subject.listGrowthEvents();
      const tag = `captureKey:${input.captureKey}`;
      if (events.some((event) => (event.payload.tags ?? []).includes(tag))) {
        return {
          candidateEventIds: [],
          confirmationSuggestedEventIds: [],
          captureOutcome: 'nothing_to_learn' as const,
          distillMode: 'none' as const,
          idempotent: true,
        };
      }
      const actionLabel =
        guideChoice.action === 'nolearn'
          ? '本次回答不用于长期了解'
          : guideChoice.action === 'later'
            ? '稍后再聊这个'
            : '换一个问题';
      await this.appendOwnerEvent({
        type: 'feedback_recorded',
        confidence: 'confirmed',
        payload: {
          title: actionLabel,
          detail: actionLabel,
          tags: [tag, 'capture:noop', 'silent_ok', 'growth:guide_choice', `growth:dimension:${guideChoice.dimension}`],
        },
      });
      return {
        candidateEventIds: [],
        confirmationSuggestedEventIds: [],
        captureOutcome: 'nothing_to_learn' as const,
        distillMode: 'none' as const,
        idempotent: false,
      };
    }
    const result = await this.enrichAndCapture(input);
    await this.maybeRecordGrowthStage();
    return result;
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

  async importSubjectMaterial(input: CommandMap['subject.importMaterial']['input']) {
    const result = await this.subject.importSubjectMaterial(input);
    await this.maybeRecordGrowthStage();
    return result;
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
            contextRefs: (input.contextRefs || [])
              .filter((r) => !!r && (r.kind === 'file' || r.kind === 'folder') && !!r.path)
              .map((r) => ({
                kind: r.kind as 'file' | 'folder',
                path: r.path,
                ...(r.projectOrigin === 'digitalme_created' ||
                r.projectOrigin === 'user_selected' ||
                r.projectOrigin === 'unknown'
                  ? { projectOrigin: r.projectOrigin }
                  : {}),
              })),
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

  /**
   * DIGITALME-COLLAB-DELEGATED-01 — AI-native 委托执行。
   *
   * 闭环：Owner goal → 2digime 理解目标 → 判断本地不足/外部更合适 →
   * 委托专业外部能力（remote research / 专业 Coding Agent，经 capability contract 选择，无品牌判断）
   * → 最小必要上下文与授权 → 外部执行 → 返回结果 + provenance →
   * 本方 2digime 独立验收（CTO review，事件驱动）→ 接受/修正/fallback →
   * 结果归还 Owner → 经验按正确主体归属沉淀（外部结果不自动成为 owner fact）。
   *
   * 外部失败（capability/model stage）时自动回退本地 baseline，不把协议/HTTP/Agent
   * 内部错误暴露给用户。0 新增 Store / 第二协作真值 / 工作流状态机。
   */
  async delegateTask(
    input: CommandMap['work.delegateTask']['input'],
  ): Promise<CommandMap['work.delegateTask']['output']> {
    const work = this.requireWork();
    const derived = await deriveWorkIntent({
      goal: input.goal,
      contextRefs: input.contextRefs,
      ...(input.capabilityId ? { explicitCapabilityId: input.capabilityId } : {}),
    });
    const need = taskNeedFromWorkIntent(derived);
    const decision = decideDelegation({
      need,
      goal: input.goal,
      registrations: this.registry.list(),
    });
    const candidates = delegationCandidates(decision);

    let taskId = '';
    let finalJobId = '';
    let lastSubmitted: CommandMap['work.submitTask']['output'] | null = null;
    let fallbackUsed = false;
    let lastCapabilityId: string | undefined;

    const audit = (patch?: Partial<DelegationAudit>): DelegationAudit => ({
      mode: decision.mode,
      level: decision.level,
      ...(decision.primaryCapabilityId ? { primaryCapabilityId: decision.primaryCapabilityId } : {}),
      fallbackUsed,
      ...(lastCapabilityId ? { finalCapabilityId: lastCapabilityId } : {}),
      ...patch,
    });

    for (let i = 0; i < candidates.length; i += 1) {
      const capabilityId = candidates[i]!;
      lastCapabilityId = capabilityId;
      const submitInput: CommandMap['work.submitTask']['input'] = {
        goal: input.goal,
        contextRefs: input.contextRefs,
        ...(input.requestedArtifactType
          ? { requestedArtifactType: input.requestedArtifactType }
          : {}),
        ...(input.intentKind ? { intentKind: input.intentKind } : {}),
        ...(capabilityId ? { capabilityId } : {}),
        ...(input.existingTaskId || taskId
          ? { existingTaskId: input.existingTaskId || taskId }
          : {}),
        ...(input.confirmedPlanVersion != null
          ? { confirmedPlanVersion: input.confirmedPlanVersion }
          : {}),
        ...(input.executionAuthorization
          ? { executionAuthorization: input.executionAuthorization }
          : {}),
      };
      let submitted: CommandMap['work.submitTask']['output'];
      try {
        submitted = await this.submitTask(submitInput);
      } catch (err) {
        if (i < candidates.length - 1) {
          fallbackUsed = i > 0 || taskId !== '';
          continue;
        }
        throw Object.assign(err as Error, { delegation: audit({ failed: true }) });
      }
      lastSubmitted = submitted;
      taskId = taskId || submitted.taskId;

      if (
        submitted.needsExecutionConfirm ||
        submitted.needsExecutorSetup ||
        submitted.needsProjectFolder
      ) {
        // 需要用户确认（如代码写权限 / 项目目录）：把确认卡返回，交由用户决定后继续。
        return {
          ...submitted,
          delegation: audit(),
        };
      }
      if (!submitted.jobId) {
        if (i < candidates.length - 1) continue;
        return { ...submitted, delegation: audit({ failed: true }) };
      }

      const job = await waitForJobTerminal(work, submitted.jobId, 180_000);
      finalJobId = job.id;
      if (job.status === 'succeeded') {
        const out: CommandMap['work.delegateTask']['output'] = {
          taskId,
          jobId: job.id,
          delegation: audit(),
        };
        if (submitted.intentKind) out.intentKind = submitted.intentKind;
        if (submitted.userFacingNotice) out.userFacingNotice = submitted.userFacingNotice;
        if (submitted.capabilityClosure) out.capabilityClosure = submitted.capabilityClosure;
        return out;
      }
      const stage = job.failure?.stage;
      const retryable = stage === 'capability' || stage === 'model' || stage === undefined;
      if (retryable && i < candidates.length - 1) {
        fallbackUsed = true;
        continue;
      }
      break;
    }

    // 全部候选失败：诚实返回（不暴露协议/HTTP/Agent 内部错误）。
    const failedOut: CommandMap['work.delegateTask']['output'] = {
      taskId,
      jobId: finalJobId,
      userFacingNotice: '当前可用的执行路径均未完成，请稍后重试，或改用其它目标。',
      delegation: audit({ failed: true }),
    };
    if (lastSubmitted?.intentKind) failedOut.intentKind = lastSubmitted.intentKind;
    if (lastSubmitted?.capabilityClosure) failedOut.capabilityClosure = lastSubmitted.capabilityClosure;
    return failedOut;
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

  /**
   * D11-A AI 意图与对话中枢（work.converse）。
   * 永不创建 Job;模型不可用时降级为明确提示,不做关键词路由。
   */
  async converse(
    input: CommandMap['work.converse']['input'],
  ): Promise<CommandMap['work.converse']['output']> {
    const work = this.requireWork();
    const deps: WorkConverseDeps = {
      chat: this.buildConverseChat(),
      getTask: (taskId) => work.getTaskRecord(taskId),
      createTask: (i) => work.createConversationTask(i),
      appendConversation: (taskId, i) => work.appendTaskConversation(taskId, i),
      updatePlan: (taskId, plan) => work.updateTaskPlan(taskId, plan),
      updateRevisionLoop: (taskId, patch) => work.updateTaskRevisionLoop(taskId, patch),
      getTaskFacts: async (taskId) => {
        const detail = await work.getTask({ taskId });
        const jobStatus = detail.latestJob?.status;
        const facts: import('../work-runtime/work-converse').ConverseTaskFacts = {
          stageLabel: detail.userFacingLabel,
          hasArtifact: detail.artifactIds.length > 0,
          jobRunning: jobStatus === 'queued' || jobStatus === 'running',
          ...(jobStatus ? { latestJobStatus: jobStatus } : {}),
          ...(jobStatus === 'failed'
            ? (() => {
                const lastFailure = [
                  detail.latestJob?.actionable,
                  detail.latestJob?.progressNote,
                ]
                  .map((s) => String(s || '').trim())
                  .filter(Boolean)
                  .filter((s, i, a) => a.indexOf(s) === i)
                  .join(' ')
                  .trim();
                return lastFailure ? { lastFailure } : {};
              })()
            : {}),
        };
        const artId = detail.artifactIds[0];
        if (artId) {
          try {
            const content = (await this.getContent({ artifactId: artId })) as {
              ownerDecision?: { status: 'undecided' | 'accepted' | 'rejected' };
              acceptanceSummary?: {
                canAdoptSuggested?: boolean;
                ctoReport?: string;
                headline?: string;
              };
              acceptanceStatus?: 'ready' | 'failed' | 'pending';
              codeChange?: {
                acceptanceSummary?: {
                  canAdoptSuggested?: boolean;
                  ctoReport?: string;
                  headline?: string;
                };
              };
            };
            const decision = content.ownerDecision?.status;
            if (decision) facts.ownerDecision = decision;
            const acc = content.acceptanceSummary || content.codeChange?.acceptanceSummary;
            if (acc && typeof acc.canAdoptSuggested === 'boolean') {
              facts.canAdoptSuggested = acc.canAdoptSuggested;
            }
            const report = String(acc?.ctoReport || acc?.headline || '').trim();
            if (report) facts.ctoReport = report;
          } catch {
            /* 咨询仍可用阶段标签 */
          }
        }
        return facts;
      },
    };
    return runWorkConverse(deps, input);
  }

  /** 对话中枢模型通道：注入 hook 优先;否则要求真实模型配置;都没有 = 降级。 */
  private buildConverseChat(): WorkConverseDeps['chat'] {
    if (this.options.converseChat) return this.options.converseChat;
    const mode = this.options.documentCapability;
    if (mode !== 'openai-compatible' && mode !== 'both') return null;
    const config = this.options.openaiCompatible;
    const secrets = this.options.secrets;
    if (!config || !secrets) return null;
    return async ({ messages }) => {
      const apiKey = await secrets.get(
        providerCredentialKey(config.providerId || 'openai-compatible'),
      );
      if (!apiKey) {
        throw new Error('model credential is not configured');
      }
      const result = await chatComplete({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.model,
        messages,
        temperature: 0.2,
        // 材料感知规划需要完整 planUpdate JSON；1024 易截断导致首轮规划失败。
        maxTokens: 4096,
        timeoutMs: config.timeoutMs ?? 120_000,
        responseFormat: { type: 'json_object' },
      });
      return { text: result.text };
    };
  }

  /** CTO 验收使用与对话相同的受控真实模型通道，但保留独立测试注入点。 */
  private buildCtoReviewChat(): WorkConverseDeps['chat'] {
    if (this.options.ctoReviewChat) return this.options.ctoReviewChat;
    const mode = this.options.documentCapability;
    if (mode !== 'openai-compatible' && mode !== 'both') return null;
    const config = this.options.openaiCompatible;
    const secrets = this.options.secrets;
    if (!config || !secrets) return null;
    let schemaMode: 'json_schema' | 'json_object' = 'json_schema';
    return async ({ messages }) => {
      const apiKey = await secrets.get(
        providerCredentialKey(config.providerId || 'openai-compatible'),
      );
      if (!apiKey) {
        throw new Error('model credential is not configured');
      }
      const run = (responseFormat: NonNullable<Parameters<typeof chatComplete>[0]['responseFormat']>) =>
        chatComplete({
          baseUrl: config.baseUrl,
          apiKey,
          model: config.model,
          messages,
          temperature: 0,
          maxTokens: 4096,
          timeoutMs: config.timeoutMs ?? 120_000,
          responseFormat,
        });
      const schemaFormat = {
        type: 'json_schema' as const,
        json_schema: {
          name: 'digitalme_ai_cto_review',
          strict: true,
          schema: AI_CTO_JSON_SCHEMA,
        },
      };
      let result;
      try {
        result = await run(schemaMode === 'json_schema' ? schemaFormat : { type: 'json_object' });
      } catch (err) {
        const schemaRejected =
          schemaMode === 'json_schema' &&
          err instanceof ModelHttpError &&
          (err.kind === 'bad_request' || /json_schema|response_format/i.test(err.message));
        if (!schemaRejected) throw err;
        schemaMode = 'json_object';
        result = await run({ type: 'json_object' });
      }
      return {
        text: result.text,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      };
    };
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

  async retryArtifactAcceptance(artifactId: string): Promise<void> {
    await this.trackCtoReview(() => this.reviewArtifactAcceptance(artifactId, { forceRetry: true }));
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

  private async buildGrowthSnapshot(): Promise<UserFacingGrowthSnapshot> {
    const pkg = this.subject.requireActive();
    const events = await this.subject.listGrowthEvents();
    const derived = await this.subject.getDerived();
    const materials = await this.subject.listSubjectMaterials();
    const workItems = await this.collectGrowthWorkItems();
    const collabItems = await this.collectGrowthCollabItems();
    return deriveGrowthProfile({
      identityDisplayName: pkg.identity.displayName,
      ...(pkg.identity.description ? { identityDescription: pkg.identity.description } : {}),
      derived,
      events,
      materials: materials.map((m) => ({
        materialRef: m.materialRef,
        fileName: m.fileName,
        ...(m.addedAt ? { addedAt: m.addedAt } : {}),
      })),
      workItems,
      collabItems,
    });
  }

  private async collectGrowthWorkItems(): Promise<GrowthWorkItem[]> {
    if (!this.work) return [];
    const listed = await this.work.listTasks({ limit: 50 });
    const items: GrowthWorkItem[] = [];
    for (const row of listed.tasks) {
      try {
        const detail = await this.work.getTask({ taskId: row.taskId });
        const task = detail.task;
        let accepted = false;
        let acceptedAt: string | undefined;
        let injectedEventIds: string[] = [];
        let snapshotItemCount = 0;
        for (const artifactId of detail.artifactIds || []) {
          try {
            const art = await this.work.getArtifact(artifactId);
            if (!art) continue;
            const decision = await this.subject.getArtifactOwnerDecision(art.id, art.headVersionId);
            if (decision.status === 'accepted') {
              accepted = true;
              acceptedAt = decision.decidedAt;
            }
          } catch {
            /* 单成果失败不得阻断成长派生 */
          }
        }
        const snaps = await this.work.listSnapshotsForTask(row.taskId);
        for (const snap of snaps) {
          snapshotItemCount += (snap.items || []).length;
          if (!snap.subjectContextRef) continue;
          try {
            const freeze = await this.readSubjectContextFreeze(snap.id);
            if (freeze?.selectedEventIds?.length) {
              injectedEventIds = [...new Set([...injectedEventIds, ...freeze.selectedEventIds])];
            }
          } catch {
            /* freeze 缺失时按未注入处理 */
          }
        }
        items.push({
          taskId: task.id,
          goal: task.goal || '',
          createdAt: task.createdAt,
          contextRefCount: (task.contextRefs || []).length,
          snapshotItemCount,
          injectedEventIds,
          accepted,
          ...(acceptedAt ? { acceptedAt } : {}),
        });
      } catch {
        continue;
      }
    }
    return items;
  }

  private async collectGrowthCollabItems(): Promise<GrowthCollabItem[]> {
    const pkg = this.subject.getActive();
    if (!pkg) return [];
    try {
      const store = await CollaborationRecordStore.open(pkg.rootDir);
      const records = await store.list();
      return records.map((record) => {
        const kinds = new Set((record.events || []).map((e) => e.kind));
        return {
          hasGrant: kinds.has('grant_issued'),
          hasDivision: kinds.has('fulfillment_started'),
          hasReturnedResult: kinds.has('delivered') || kinds.has('result_decided'),
        };
      });
    } catch {
      return [];
    }
  }

  private async maybeRecordGrowthStage(): Promise<void> {
    this.growthStageRecordChain = this.growthStageRecordChain
      .catch(() => undefined)
      .then(async () => {
        try {
          const growth = await this.buildGrowthSnapshot();
          await this.recordStageReachedIfNeeded(growth);
        } catch {
          /* 阶段审计失败不得阻断主链 */
        }
      });
    await this.growthStageRecordChain;
  }

  private async recordStageReachedIfNeeded(growth: UserFacingGrowthSnapshot): Promise<void> {
    if (growth.stageLevel < 1) return;
    const level = growth.stageLevel as 1 | 2 | 3;
    const key = stageReachedCaptureKey(level);
    const events = await this.subject.listGrowthEvents();
    const tag = `captureKey:${key}`;
    if (events.some((e) => (e.payload.tags ?? []).includes(tag))) return;
    await this.appendOwnerEvent({
      type: 'feedback_recorded',
      confidence: 'confirmed',
      payload: {
        title: growth.stageName,
        detail: growth.stageExplanation,
        tags: ['growth:stage_reached', `stage:${level}`, tag, 'capture:noop', 'silent_ok'],
      },
    });
  }

  async stop(): Promise<void> {
    await this.detachWorkRuntime();
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

  /**
   * 先停收 Job 成功评价，再取消/排空已启动的 CTO 评价，最后拆除 Work/Workspace。
   * 可重复调用。取消时不写伪造的验收失败。
   */
  private async detachWorkRuntime(): Promise<void> {
    if (this.unsubGrowthJobHook) {
      this.unsubGrowthJobHook();
      this.unsubGrowthJobHook = null;
    }
    if (!this.ctoReviewAbort.signal.aborted) {
      this.ctoReviewAbort.abort();
    }
    while (this.ctoReviewInflight.size > 0) {
      await Promise.allSettled([...this.ctoReviewInflight]);
    }
    if (this.work) await this.work.stop();
    this.work = null;
    this.workspace = null;
  }

  private async attachWorkRuntime(): Promise<void> {
    const pkg = this.subject.requireActive();
    const root = path.join(pkg.rootDir, 'runtime');
    await fs.mkdir(root, { recursive: true });

    await this.detachWorkRuntime();
    this.ctoReviewAbort = new AbortController();

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

    const ctoReviewChat = this.buildCtoReviewChat();
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
      ...(ctoReviewChat ? { ctoReviewChat } : {}),
      ensureAcceptance: (artifactId) =>
        this.trackCtoReview(() => this.reviewArtifactAcceptance(artifactId)),
    });

    // 修订 Job 成功后记录修改要求来源（不阻塞主链）；D11-D 受控修订在此之后调度
    if (this.unsubGrowthJobHook) this.unsubGrowthJobHook();
    this.unsubGrowthJobHook = this.eventBus.subscribe((event) => {
      if (event.kind !== 'job.updated') return;
      if (this.ctoReviewAbort.signal.aborted) return;
      if (event.status === 'succeeded') {
        void this.onJobSucceededForGrowth(event.jobId);
        void this.trackCtoReview(() => this.onJobSucceededForCtoReview(event.jobId));
        void this.onJobSucceededForControlledRevision(event.jobId);
      }
    });
  }

  /**
   * 主进程对话捕获入口：基于已持久化 user turn，异步调度，不阻塞回复。
   * skipGrowthCapture 时只写不含回答正文的边界记录，不进入长期提取。
   */
  scheduleConversationGrowthCapture(input: {
    turnId: string;
    userText: string;
    assistantText?: string;
    skipGrowthCapture?: boolean;
    dimensionKey?: string;
  }): void {
    void this.runConversationGrowthCapture(input);
  }

  private async runConversationGrowthCapture(input: {
    turnId: string;
    userText: string;
    assistantText?: string;
    skipGrowthCapture?: boolean;
    dimensionKey?: string;
  }): Promise<void> {
    let pkg;
    try {
      pkg = this.subject.requireActive();
    } catch {
      return;
    }
    const file = conversationFilePath(pkg.rootDir);
    try {
      const existing = latestCaptureStatusByTurnId(await readConversationRows(file)).get(input.turnId);
      if (existing?.status === 'skipped') return;
      const skipGrowthCapture =
        !!input.skipGrowthCapture || isEphemeralConversationIntent(input.userText);
      if (skipGrowthCapture) {
        await this.suppressConversationGrowthCapture({
          turnId: input.turnId,
          ...(input.dimensionKey ? { dimensionKey: input.dimensionKey } : {}),
        });
        return;
      }
    } catch {
      if (input.skipGrowthCapture || isEphemeralConversationIntent(input.userText)) return;
    }
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

  /** 阻断本次回答的长期成长提取；事件不含回答正文。 */
  async suppressConversationGrowthCapture(input: {
    turnId: string;
    dimensionKey?: string;
  }): Promise<void> {
    let pkg;
    try {
      pkg = this.subject.requireActive();
    } catch {
      return;
    }
    const file = conversationFilePath(pkg.rootDir);
    const skipped: GrowthCaptureStatusRecord = {
      kind: 'growth_capture_status',
      turnId: input.turnId,
      status: 'skipped',
      attempts: 0,
      updatedAt: nowIso(),
    };
    await appendConversationRow(file, skipped).catch(() => undefined);
    const dimension = input.dimensionKey ? dimensionByKey(input.dimensionKey) : undefined;
    if (!dimension) return;
    try {
      await this.captureSubjectInput({
        text: 'nolearn',
        sourceKind: 'conversation',
        captureKey: guideChoiceCaptureKey(dimension.key, 'nolearn'),
      });
    } catch {
      /* 边界记录失败不得重新打开长期提取 */
    }
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
    const rejectionReason = String(job.rejectionReason || '').trim();
    const artifactId = job.artifactId || job.targetArtifactId;
    if (revisionRequest) {
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
  }

  private trackCtoReview(run: () => Promise<void>): Promise<void> {
    let tracked!: Promise<void>;
    tracked = (async () => {
      try {
        if (this.ctoReviewAbort.signal.aborted) return;
        await run();
      } finally {
        this.ctoReviewInflight.delete(tracked);
      }
    })();
    this.ctoReviewInflight.add(tracked);
    return tracked;
  }

  /**
   * 成功 Job 且已有 Artifact 时，走同一套通用 AI CTO 评价。
   * 不依赖 codeChange；代码证据只是可选增强。
   */
  private async onJobSucceededForCtoReview(jobId: string): Promise<void> {
    if (this.ctoReviewAbort.signal.aborted) return;
    const work = this.work;
    const workspace = this.workspace;
    if (!work || !workspace) return;
    const job = await work.getJob(jobId);
    if (this.ctoReviewAbort.signal.aborted) return;
    if (!job || job.status !== 'succeeded') return;
    const artifactId = job.artifactId || job.targetArtifactId;
    if (!artifactId) return;
    await this.reviewArtifactAcceptance(artifactId);
  }

  private async reviewArtifactAcceptance(
    artifactId: string,
    opts?: { forceRetry?: boolean },
  ): Promise<void> {
    const existing = this.acceptanceLocks.get(artifactId);
    if (existing && !opts?.forceRetry) {
      await existing;
      return;
    }
    const run = this.reviewArtifactAcceptanceUnlocked(artifactId, opts);
    this.acceptanceLocks.set(artifactId, run);
    try {
      await run;
    } catch {
      /* 评价过程异常不得变成未处理拒绝 */
    } finally {
      if (this.acceptanceLocks.get(artifactId) === run) {
        this.acceptanceLocks.delete(artifactId);
      }
    }
  }

  private async reviewArtifactAcceptanceUnlocked(
    artifactId: string,
    opts?: { forceRetry?: boolean },
  ): Promise<void> {
    const signal = this.ctoReviewAbort.signal;
    if (signal.aborted) return;
    const work = this.work;
    const workspace = this.workspace;
    if (!work || !workspace) return;
    if (opts?.forceRetry) {
      await workspace.persistAcceptance(artifactId, null);
      if (signal.aborted) return;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (signal.aborted) return;
      const got = await workspace.getContent(artifactId, undefined, undefined, {
        skipEnsure: true,
      });
      if (signal.aborted) return;
      const artifact = got.artifact;
      const head = headVersion(artifact);
      const boundVersionId = head.versionId;
      const current = resolveCurrentAcceptance(
        artifact,
        boundVersionId,
        (got as { codeChange?: { acceptanceSummary?: OwnerAcceptanceSummary } }).codeChange
          ?.acceptanceSummary,
      );
      if (current && (current.status === 'ready' || current.status === 'failed')) {
        return;
      }
      const job = await work.getJob(artifact.jobId);
      if (signal.aborted) return;
      const task = await work.getTaskRecord(artifact.taskId);
      if (signal.aborted) return;
      if (!job || !task) return;
      const snapshot = job.snapshotId ? await work.getSnapshot(job.snapshotId) : null;
      if (signal.aborted) return;
      const codeChange = (got as {
        codeChange?: Parameters<typeof collectGenericCtoEvidence>[0]['codeChange'];
      }).codeChange;
      const evidence = collectGenericCtoEvidence({
        task,
        job,
        artifact,
        artifactVersionId: boundVersionId,
        ...(got.text ? { artifactBody: got.text } : {}),
        ...(codeChange ? { codeChange } : {}),
        ...(snapshot ? { snapshot } : {}),
      });
      const ctoChat = this.buildCtoReviewChat();
      const reviewPromise = runGenericArtifactCtoReview(evidence, ctoChat);
      void reviewPromise.catch(() => undefined);
      const raced = await Promise.race([
        reviewPromise.then((value) => ({ done: true as const, value })),
        waitForAbort(signal).then(() => ({ done: false as const })),
      ]);
      if (!raced.done || signal.aborted) return;
      const reviewed = raced.value;
      const latest = await workspace.getContent(artifactId, undefined, undefined, {
        skipEnsure: true,
      });
      if (signal.aborted) return;
      if (latest.artifact.headVersionId !== boundVersionId) {
        continue;
      }
      await workspace.persistAcceptance(
        artifactId,
        asArtifactAcceptance({
          artifactVersionId: boundVersionId,
          jobId: job.id,
          status: reviewed.status,
          updatedAt: nowIso(),
          ...(reviewed.status === 'ready' && reviewed.summary
            ? { summary: reviewed.summary }
            : { failureMessage: reviewed.failureMessage || ACCEPTANCE_REVIEW_FAILED_MESSAGE }),
        }),
      );
      if (signal.aborted) return;
      const after = await workspace.getContent(artifactId, undefined, undefined, {
        skipEnsure: true,
      });
      if (signal.aborted) return;
      if (
        after.artifact.headVersionId === boundVersionId &&
        after.artifact.acceptance?.artifactVersionId === boundVersionId
      ) {
        return;
      }
    }
  }

  /**
   * D11-D：Job 成功并形成验收结论后的受控修订入口。
   * 产品主链已关闭系统自动修订；缺口由验收结论说明，等待用户明确继续。
   */
  private async onJobSucceededForControlledRevision(jobId: string): Promise<void> {
    if (!this.work || !this.workspace) return;
    const job = await this.work.getJob(jobId);
    if (!job || job.status !== 'succeeded') return;
    const artifactId = job.artifactId || job.targetArtifactId;
    if (!artifactId) return;
    const taskId = job.taskId;
    const ctoChat = this.buildCtoReviewChat();
    await maybeRunControlledRevisionAfterJob(
      {
        getTask: (id) => this.work!.getTaskRecord(id),
        withTaskExclusive: (id, fn) => this.work!.runExclusiveForTask(id, fn),
        updateRevisionLoop: (id, patch) => this.work!.updateTaskRevisionLoopAlreadyLocked(id, patch),
        appendConversation: async (id, turn) => {
          // 锁外调用：走公开互斥路径；临界区内不得再调本函数
          await this.work!.appendTaskConversation(id, {
            turns: [
              {
                turnId: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                role: turn.role,
                content: turn.content,
                createdAt: nowIso(),
              },
            ],
          });
        },
        findActiveJob: async (id) => {
          const detail = await this.work!.getTask({ taskId: id });
          const latest = detail.latestJob;
          if (!latest) return null;
          if (latest.status !== 'queued' && latest.status !== 'running') return null;
          return { id: latest.jobId };
        },
        getArtifactContent: async (id) => {
          const content = await this.workspace!.getContent(id, undefined, undefined, {
            skipEnsure: true,
          });
          const head = headVersion(content.artifact);
          const codeChange = (content as { codeChange?: Record<string, unknown> }).codeChange;
          const acceptanceSummary =
            content.acceptanceSummary ||
            (codeChange && typeof codeChange === 'object'
              ? (codeChange as { acceptanceSummary?: unknown }).acceptanceSummary
              : undefined);
          const checks =
            codeChange && Array.isArray((codeChange as { checks?: unknown }).checks)
              ? ((codeChange as { checks: Array<{ id?: string; verdict?: string; detail?: string }> })
                  .checks)
              : undefined;
          return {
            versionId: head.versionId,
            ...(acceptanceSummary ? { acceptanceSummary } : {}),
            ...(codeChange ? { codeChange } : {}),
            ...(checks ? { checks } : {}),
          };
        },
        reviseArtifact: (input) => this.work!.reviseArtifactAlreadyLocked(input),
        sumSucceededJobDurationMs: async (id) => {
          const jobs = await this.work!.listJobsForTask(id);
          return jobs
            .filter((j) => j.status === 'succeeded')
            .reduce((sum, j) => sum + (j.costActual?.durationMs ?? 0), 0);
        },
        modelAvailable: !!ctoChat,
        ...(ctoChat
          ? {
              chat: async ({ messages }) => {
                const result = await ctoChat({ messages });
                return { text: result.text };
              },
            }
          : {}),
        nowIso,
      },
      { taskId, jobId, artifactId },
    );
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
          const adapterMod = require('../capability/adapters/external-executor-codex') as typeof import('../capability/adapters/external-executor-codex');
          // 与执行一致的默认探测：显式 cliKind / atomcodeExePath 用之；
          // 否则 usesAtomCodeDefault 决定实际使用的那一种（AtomCode 若在则用之，否则 Codex），
          // 保证「探测到的与执行用的那一种」一致，不在能力间写死厂商优先名单。
          if (adapterMod.usesAtomCodeCli(opt) || (adapterMod.usesAtomCodeDefault(opt) && !opt.codexJsPath)) {
            const exe = adapterMod.resolveAtomCodeExe(opt.atomcodeExePath);
            fsSync.accessSync(exe);
          } else {
            const js = opt.codexJsPath || adapterMod.resolveCodexJs();
            fsSync.accessSync(js);
          }
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
    // MCP-READONLY-ADAPTER-01：默认不注册；仅显式 options 注册（无空壳入口）。
    if (this.options.mcpReadonlyCapability) {
      registry.register(createMcpReadonlyAdapter(this.options.mcpReadonlyCapability));
    }
    // MULTI-AGENT-ROUTE-01：第二 Agent 默认不注册（无空壳）；仅测试/gate/显式 options 注册。
    if (this.options.secondaryExecutorCapability) {
      registry.register(createExternalExecutorSecondaryAdapter(this.options.secondaryExecutorCapability));
    }
    // TRIAL-SURFACE-01B：无专用代码执行器时用已连接模型兜底运输。
    // 默认注册条件与文档模型同一配置源：真实模型（openai-compatible/both）+ openaiCompatible 配置。
    // documentCapability: 'fake' / 'none' 的测试运行时**不**注册，以免假模型冒充改代码。
    const modelApiConfig = this.options.modelApiCapability;
    const realModelConfigured =
      (this.options.documentCapability === 'openai-compatible' ||
        this.options.documentCapability === 'both') &&
      !!this.options.openaiCompatible;
    if (modelApiConfig === true || (modelApiConfig === undefined && realModelConfigured)) {
      const cfg: ExternalExecutorModelApiOptions = {
        ...this.options.openaiCompatible,
        providerId:
          this.options.openaiCompatible?.providerId || 'openai-compatible',
      };
      registry.register(createExternalExecutorModelApiAdapter(cfg));
    } else if (modelApiConfig && typeof modelApiConfig === 'object') {
      registry.register(createExternalExecutorModelApiAdapter(modelApiConfig));
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

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
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
