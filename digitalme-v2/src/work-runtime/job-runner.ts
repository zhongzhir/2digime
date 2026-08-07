import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityRegistry } from '../capability/registry';
import type { SecretAccessor, RemoteLifecycleStatus, CapabilityOutput } from '../capability/adapter';
import { newId, nowIso } from '../shared/ids';
import type { ConfirmedExperienceView } from '../subject-core/derived-views';
import type { SubjectContextFreeze } from '../subject-core/subject-context-freeze';
import { buildSubjectContextFreeze } from '../subject-core/subject-context-freeze';
import type { CommandMap } from '../runtime/commands';
import type { AuthorizationGrant } from '../collaboration/schema';
import {
  applyRecoveryWrite,
  isTerminal,
  recoverJobOnStartup,
  transitionJob,
  type ExecutionJob,
  type FailureStage,
} from './execution-job';
import { TaskService } from './task-service';
import { JobStore } from './job-store';
import { ContextSnapshotBuilder, sanitizeMessage } from './snapshot-builder';
import { ArtifactCommitter } from './artifact-commit';
import { InMemoryEventBus } from './event-bus';
import { latestJob, userFacingLabelFromLatestJob } from './derive';
import {
  deriveTaskDisplayState,
  pickPrimaryArtifact,
  sortTasksByActivityTime,
} from './task-display-state';
import {
  buildJobAuthorizationProjection,
  prepareAndExecuteCapability,
  resumeRemoteIfPossible,
} from './remote-job-bridge';
import { buildTargetedRevisionRequest } from './ai-first-policy';
import {
  capabilityOutputText,
  dispatchOutcomeCheck,
} from './outcome-dispatch';
import { deriveWorkIntent, inspectSoftwareProject, isTaskIntentKind } from './work-intent';
import { CODE_ANALYSIS_ARTIFACT_TYPE } from '../capability/adapters/code-repo-analysis-contract';
import {
  CODE_CHANGE_ARTIFACT_TYPE,
  EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
  userFacingVerification,
  type CollectedExecutionChanges,
  type ExecutionBaseline,
} from '../execution/external-executor-contract';
import { buildExecutionConfirmPreview } from '../execution/task-package';
import { restoreExecutionBaseline } from '../execution/restore';
import { computeScopeDigest } from '../execution/baseline';
import {
  buildCodingOnboardingPayload,
  isAutomaticReady,
  userFacingNaturalExecutorName,
} from '../capability/coding-capability';
import { listCodingCapabilityStatuses } from '../capability/coding-capability-probe';
import { loadCodingCapabilityPrefs } from '../capability/coding-capability-draft';

export interface WorkRuntimeOptions {
  subjectId: string;
  taskService: TaskService;
  jobStore: JobStore;
  snapshotBuilder: ContextSnapshotBuilder;
  artifactCommitter: ArtifactCommitter;
  registry: CapabilityRegistry;
  eventBus: InMemoryEventBus;
  /** Adapter 工作目录根。 */
  workRoot: string;
  /** 主体经验注入;P1.2 默认空视图。可返回全量 confirmed,再经 selectSubjectContext 裁剪。 */
  loadSubjectContext?: () => Promise<ConfirmedExperienceView>;
  /**
   * 按当前任务裁剪并选择可注入主体切片(候选永不进入)。
   * 返回值须含与 Adapter 一致的 subjectContext,以及供 Snapshot 冻结的 freeze。
   */
  selectSubjectContext?: (input: {
    goal: string;
    requestedArtifactType: string;
    intentKind?: import('./work-intent').TaskIntentKind;
    confirmed: ConfirmedExperienceView;
    taskId?: string;
  }) =>
    | Promise<SubjectSelectionResult>
    | SubjectSelectionResult
    | Promise<ConfirmedExperienceView>
    | ConfirmedExperienceView;
  secrets?: SecretAccessor;
  /** 只读解析 Snapshot extractedTextRef;供模型 Adapter 组装材料。 */
  readExtractedText?: (ref: string) => Promise<string>;
  /** 可选:按 grantId 加载授权(远端投影用);不得引入第二协作状态机。 */
  loadAuthorizationGrant?: (grantId: string) => Promise<AuthorizationGrant | null>;
  /** 可选:未授权材料特征,供候选验证泄漏检测。 */
  resolveUnauthorizedMarkers?: (input: {
    taskId: string;
    allowedMaterialPaths: string[];
  }) => Promise<string[]> | string[];
  /** 可选：读取成果采用状态（派生自 GrowthEvent，非第二 Store）。 */
  getArtifactOwnerDecision?: (
    artifactId: string,
    artifactVersionId: string,
  ) => Promise<{ status: 'undecided' | 'accepted' | 'rejected' }>;
}

export interface SubjectSelectionResult {
  subjectContext: ConfirmedExperienceView;
  freeze: SubjectContextFreeze;
  /** 高风险外部行动暂停（任务其余部分可继续） */
  pauseExternalAction?: boolean;
  /** 用户面自然语言选择（内部用，不进 Adapter） */
  ownerChoicePrompt?: {
    question: string;
    labelA: string;
    labelB: string;
    eventIdA: string;
    eventIdB: string;
    highRisk: boolean;
  };
}

type SubmitInput = CommandMap['work.submitTask']['input'];
type GetTaskOutput = CommandMap['work.getTask']['output'];

/**
 * JobRunner / WorkRuntime — Work 主链唯一执行入口。
 * Job 状态只能由此修改;phase/progress 仅说明与展示。
 */
export class WorkRuntime {
  private readonly queue: string[] = [];
  private readonly abortByJob = new Map<string, AbortController>();
  private readonly taskLocks = new Map<string, Promise<unknown>>();
  private readonly jobWriteChains = new Map<string, Promise<void>>();
  private readonly liveProgress = new Map<string, string>();
  private pumping = false;
  private started = false;

  constructor(private readonly opts: WorkRuntimeOptions) {}

  /** 启动泵;调用 recoverOnStartup 之后由外部 start。 */
  start(): void {
    this.started = true;
    void this.pump();
  }

  /** 停止接新任务并等待当前泵排空。 */
  async stop(): Promise<void> {
    this.started = false;
    for (const controller of this.abortByJob.values()) {
      controller.abort();
    }
    const startedAt = Date.now();
    while (this.pumping && Date.now() - startedAt < 15_000) {
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  /**
   * 同步路径:校验 → 写 Task → 写 queued Job → 入队 → 返回。
   * 禁止扫描/解析/调模型/写 Artifact（意图派生仅轻量材料探测）。
   */
  async submitTask(
    input: SubmitInput,
  ): Promise<CommandMap['work.submitTask']['output']> {
    const derived = await deriveWorkIntent({
      goal: input.goal,
      contextRefs: input.contextRefs,
      ...(input.capabilityId ? { explicitCapabilityId: input.capabilityId } : {}),
    });
    const intent =
      input.intentKind && isTaskIntentKind(input.intentKind)
        ? {
            ...derived,
            intentKind: input.intentKind,
            expectedOutputFamily:
              input.requestedArtifactType ||
              (input.intentKind === 'analyze_code'
                ? CODE_ANALYSIS_ARTIFACT_TYPE
                : input.intentKind === 'modify_code'
                  ? CODE_CHANGE_ARTIFACT_TYPE
                  : derived.expectedOutputFamily),
            highConfidence: true,
            ...(input.intentKind === 'analyze_code'
              ? { userFacingNotice: '将分析你添加的代码并整理问题清单与依据。' }
              : {}),
            ...(input.intentKind === 'modify_code'
              ? {
                  requiresExecutionConfirm: true,
                  userFacingNotice:
                    '这项任务需要修改项目文件，将交给已连接的代码执行能力完成。开始前你可以查看它能够访问和修改的范围。',
                }
              : {}),
          }
        : derived;

    const expectedOutputFamily =
      String(input.requestedArtifactType || '').trim() || intent.expectedOutputFamily;

    const forceAnalyze =
      intent.intentKind === 'analyze_code' || expectedOutputFamily === CODE_ANALYSIS_ARTIFACT_TYPE;
    const forceModify =
      intent.intentKind === 'modify_code' || expectedOutputFamily === CODE_CHANGE_ARTIFACT_TYPE;

    // 代码修改：未确认授权时只返回确认卡，不创建 Task/Job
    if (forceModify && !input.executionAuthorization?.confirmed) {
      const folder = input.contextRefs.find((r) => r.kind === 'folder');
      if (!folder) {
        const msg =
          '这项任务需要一个项目位置。可由 Digital Me 创建新项目，或使用你已有的项目。';
        return {
          taskId: '',
          jobId: '',
          intentKind: 'modify_code',
          userFacingNotice: msg,
          needsProjectFolder: {
            message: msg,
            allowEmptyFolder: true,
            preferCreateNew: true,
          },
        };
      }
      const inspected = await inspectSoftwareProject(folder.path);
      const prefsFile = await loadCodingCapabilityPrefs(path.dirname(this.opts.workRoot));
      const prefs = prefsFile?.defaultCapabilityId
        ? { defaultCapabilityId: prefsFile.defaultCapabilityId }
        : undefined;
      const { statuses, preferred } = await listCodingCapabilityStatuses(this.opts.registry, {
        probe: true,
        ...(prefs ? { prefs } : {}),
      });
      if (!isAutomaticReady(preferred)) {
        const onboarding = buildCodingOnboardingPayload(statuses);
        return {
          taskId: '',
          jobId: '',
          intentKind: 'modify_code',
          userFacingNotice: onboarding.message,
          needsExecutorSetup: {
            message: onboarding.message,
            title: onboarding.title,
            description: onboarding.description,
            actions: onboarding.actions,
            capabilities: onboarding.capabilities,
            recommended: onboarding.recommended,
            ...(onboarding.settingsHint ? { settingsHint: onboarding.settingsHint } : {}),
          },
        };
      }
      const selectedCoding = preferred!;
      if (
        !this.opts.registry.get(selectedCoding.capabilityId) &&
        !this.opts.registry.get(EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID)
      ) {
        const onboarding = buildCodingOnboardingPayload(statuses);
        return {
          taskId: '',
          jobId: '',
          intentKind: 'modify_code',
          userFacingNotice: onboarding.message,
          needsExecutorSetup: {
            message: onboarding.message,
            title: onboarding.title,
            description: onboarding.description,
            actions: onboarding.actions,
            capabilities: onboarding.capabilities,
            recommended: onboarding.recommended,
            ...(onboarding.settingsHint ? { settingsHint: onboarding.settingsHint } : {}),
          },
        };
      }
      const isNewProject =
        !!inspected.isNewProjectCandidate ||
        (folder as { projectOrigin?: string }).projectOrigin === 'digitalme_created';
      const preview = buildExecutionConfirmPreview({
        goal: input.goal,
        workingDirectory: folder.path,
        projectName: inspected.projectName || path.basename(folder.path),
        ...(input.executionAuthorization?.readScope
          ? { readScope: input.executionAuthorization.readScope }
          : {}),
        ...(input.executionAuthorization?.writeScope
          ? { writeScope: input.executionAuthorization.writeScope }
          : {}),
        executorDisplayName: userFacingNaturalExecutorName(),
        ...(isNewProject ? { isNewProject: true } : {}),
      });
      return {
        taskId: '',
        jobId: '',
        intentKind: 'modify_code',
        userFacingNotice: preview.notice,
        needsExecutionConfirm: {
          ...preview,
          executorDisplayName: userFacingNaturalExecutorName(),
          selectedCapabilityId: selectedCoding.capabilityId,
          selectedCapabilityDisplayName: selectedCoding.displayName,
          ...(isNewProject || (folder as { projectOrigin?: string }).projectOrigin
            ? {
                projectOrigin:
                  (folder as { projectOrigin?: string }).projectOrigin === 'digitalme_created'
                    ? 'digitalme_created'
                    : isNewProject
                      ? 'digitalme_created'
                      : 'user_selected',
              }
            : {}),
        },
      };
    }

    const selected = this.opts.registry.selectForNeed({
      intentKind: intent.intentKind,
      expectedOutputFamily,
      materialKinds: intent.materialKinds,
      ...(input.capabilityId ? { explicitCapabilityId: input.capabilityId } : {}),
    });

    if (!selected.adapter) {
      const msg =
        selected.actionable ||
        (forceModify
          ? '当前无法修改项目文件：请先在设置中连接代码执行组件后再试。'
          : forceAnalyze
            ? '当前无法进行代码分析：请先连接模型并添加代码材料后再试。'
            : 'no available capability for requested artifact type');
      throw Object.assign(new Error(msg), { actionable: msg });
    }
    if (selected.adapter.registration.availability !== 'available') {
      const msg =
        selected.actionable || 'selected capability is not available';
      throw Object.assign(new Error(msg), { actionable: msg });
    }

    if (
      forceAnalyze &&
      !selected.adapter.registration.outputArtifactTypes.includes(CODE_ANALYSIS_ARTIFACT_TYPE)
    ) {
      const msg =
        '当前无法进行代码分析：没有可用的代码分析能力。不会改用普通写作冒充代码审查。';
      throw Object.assign(new Error(msg), { actionable: msg });
    }
    if (
      forceModify &&
      !selected.adapter.registration.outputArtifactTypes.includes(CODE_CHANGE_ARTIFACT_TYPE)
    ) {
      const msg =
        '当前无法修改项目文件：没有可用的代码执行能力。不会改用普通写作冒充代码修改。';
      throw Object.assign(new Error(msg), { actionable: msg });
    }

    const adapter = selected.adapter;
    const resolvedFamily = forceModify
      ? CODE_CHANGE_ARTIFACT_TYPE
      : forceAnalyze
        ? CODE_ANALYSIS_ARTIFACT_TYPE
        : expectedOutputFamily ||
          adapter.registration.outputArtifactTypes[0] ||
          'document';

    const taskInput: {
      subjectId: string;
      goal: string;
      contextRefs: SubmitInput['contextRefs'];
      requestedArtifactType: string;
      intentKind?: import('./work-intent').TaskIntentKind;
      capabilityId?: string;
      authorization?: SubmitInput['authorization'];
    } = {
      subjectId: this.opts.subjectId,
      goal: input.goal,
      contextRefs: input.contextRefs,
      requestedArtifactType: resolvedFamily,
      intentKind: intent.intentKind,
      capabilityId: adapter.registration.id,
    };
    if (input.capabilityId !== undefined) {
      taskInput.capabilityId = input.capabilityId;
    }
    if (input.authorization) {
      taskInput.authorization = input.authorization;
    }
    const task = await this.opts.taskService.create(taskInput);

    const extAuth = input.executionAuthorization;
    const job = await this.createQueuedJob(task.id, adapter.registration.id, undefined, extAuth
      ? {
          executorId: adapter.registration.adapter.adapterId,
          workingDirectory: path.resolve(extAuth.workingDirectory),
          readScope: extAuth.readScope?.length ? extAuth.readScope : ['.'],
          writeScope: extAuth.writeScope?.length ? extAuth.writeScope : ['.'],
          lastExecutorStatus: 'queued',
          ...(extAuth.projectOrigin ? { projectOrigin: extAuth.projectOrigin } : {}),
        }
      : undefined);
    this.enqueue(job.id);
    return {
      taskId: task.id,
      jobId: job.id,
      intentKind: intent.intentKind,
      ...(intent.userFacingNotice ? { userFacingNotice: intent.userFacingNotice } : {}),
    };
  }

  /**
   * 仅当无非终态 Job 时允许;新建 Job + 默认新建 Snapshot;
   * 并发双击经 task 锁串行,只能成功创建一个。
   * action=restore_baseline：恢复最近外部执行前状态，不新建 Job。
   */
  async retryTask(input: {
    taskId: string;
    action?: 'retry' | 'restore_baseline';
    jobId?: string;
  }): Promise<CommandMap['work.retryTask']['output']> {
    if (input.action === 'restore_baseline') {
      return this.restoreExternalExecutionBaseline(input.taskId, input.jobId);
    }
    return this.withTaskLock(input.taskId, async () => {
      const task = await this.opts.taskService.get(input.taskId);
      if (!task) throw new Error(`task not found: ${input.taskId}`);
      const active = await this.opts.jobStore.findActiveForTask(input.taskId);
      if (active) {
        throw new Error(`task already has an active job: ${active.id}`);
      }
      const capabilityId =
        task.capabilityId ??
        this.opts.registry.selectForNeed({
          ...(task.intentKind ? { intentKind: task.intentKind } : {}),
          expectedOutputFamily: task.requestedArtifactType,
        }).adapter?.registration.id;
      if (!capabilityId) {
        const msg =
          task.intentKind === 'modify_code'
            ? '当前无法重试代码修改：请先在设置中连接代码执行组件后再试。'
            : task.intentKind === 'analyze_code'
              ? '当前无法重试代码分析：请先连接模型后再试。'
              : 'no available capability for retry';
        throw Object.assign(new Error(msg), { actionable: msg });
      }
      const prevJobs = await this.opts.jobStore.listByTask(input.taskId);
      const prevExt = [...prevJobs]
        .reverse()
        .find((j) => j.externalExecution?.workingDirectory);
      const job = await this.createQueuedJob(
        task.id,
        capabilityId,
        undefined,
        prevExt?.externalExecution
          ? {
              executorId: prevExt.externalExecution.executorId,
              workingDirectory: prevExt.externalExecution.workingDirectory,
              readScope: prevExt.externalExecution.readScope,
              writeScope: prevExt.externalExecution.writeScope,
              lastExecutorStatus: 'queued',
              autoContinueCount: 0,
              ...(prevExt.externalExecution.projectOrigin
                ? { projectOrigin: prevExt.externalExecution.projectOrigin }
                : {}),
            }
          : undefined,
      );
      this.enqueue(job.id);
      return { jobId: job.id };
    });
  }

  /**
   * 修改成果:同 Task 新 Job;成功向同一 Artifact 追加 capability 版本。
   * 失败不写 Artifact → 当前 head 保留。
   */
  async reviseArtifact(input: {
    taskId: string;
    artifactId: string;
    revisionRequest: string;
    rejectionReason?: string;
    /** 截图等附件路径，并入 Task.contextRefs 后进入 Snapshot。 */
    attachmentPaths?: string[];
  }): Promise<{ jobId: string }> {
    const request = String(input.revisionRequest || '').trim();
    if (!request) throw new Error('请填写修改要求');
    const rejectionReason = String(input.rejectionReason || '').trim();
    const attachmentPaths = (input.attachmentPaths || [])
      .map((p) => String(p || '').trim())
      .filter(Boolean);

    return this.withTaskLock(input.taskId, async () => {
      let task = await this.opts.taskService.get(input.taskId);
      if (!task) throw new Error(`task not found: ${input.taskId}`);
      if (attachmentPaths.length) {
        task = await this.opts.taskService.appendContextRefs(
          input.taskId,
          attachmentPaths.map((p) => ({ kind: 'file' as const, path: p })),
        );
      }
      const artifact = await this.opts.artifactCommitter.get(input.artifactId);
      if (!artifact) throw new Error(`artifact not found: ${input.artifactId}`);
      if (artifact.taskId !== input.taskId) {
        throw new Error('artifact does not belong to this task');
      }
      const active = await this.opts.jobStore.findActiveForTask(input.taskId);
      if (active) {
        throw new Error(`task already has an active job: ${active.id}`);
      }
      const capabilityId =
        task.capabilityId ??
        this.opts.registry.selectForNeed({
          ...(task.intentKind ? { intentKind: task.intentKind } : {}),
          expectedOutputFamily: task.requestedArtifactType,
        }).adapter?.registration.id;
      if (!capabilityId) {
        const msg =
          task.intentKind === 'analyze_code'
            ? '当前无法按说明重新分析：请先连接模型后再试。'
            : 'no available capability for revise';
        throw Object.assign(new Error(msg), { actionable: msg });
      }
      const adapter = this.opts.registry.get(capabilityId);
      if (!adapter || adapter.registration.availability !== 'available') {
        const msg =
          task.intentKind === 'analyze_code'
            ? '当前无法进行代码分析：请先连接模型后再试。不会改用普通写作冒充代码审查。'
            : 'selected capability is not available';
        throw Object.assign(new Error(msg), { actionable: msg });
      }
      const prevJobs = await this.opts.jobStore.listByTask(task.id);
      const prevExt = [...prevJobs]
        .reverse()
        .find((j) => j.externalExecution?.workingDirectory);
      const revisionText =
        attachmentPaths.length > 0
          ? `${request}\n\n（用户附了 ${attachmentPaths.length} 张截图作为问题说明材料；请结合文字理解问题。若无法直接查看图片，以文字说明为准。）`
          : request;
      const job = await this.createQueuedJob(
        task.id,
        capabilityId,
        {
          targetArtifactId: artifact.id,
          revisionRequest: revisionText,
          ...(rejectionReason ? { rejectionReason } : {}),
        },
        prevExt?.externalExecution
          ? {
              executorId: prevExt.externalExecution.executorId,
              workingDirectory: prevExt.externalExecution.workingDirectory,
              readScope: prevExt.externalExecution.readScope,
              writeScope: prevExt.externalExecution.writeScope,
              lastExecutorStatus: 'queued',
              autoContinueCount: 0,
              ...(prevExt.externalExecution.projectOrigin
                ? { projectOrigin: prevExt.externalExecution.projectOrigin }
                : {}),
            }
          : undefined,
      );
      this.enqueue(job.id);
      return { jobId: job.id };
    });
  }

  async cancelJob(input: { jobId: string }): Promise<{ cancelled: boolean }> {
    const job = await this.opts.jobStore.get(input.jobId);
    if (!job) return { cancelled: false };
    if (isTerminal(job.status)) return { cancelled: false };

    if (job.status === 'queued') {
      const next = transitionJob(job, 'cancelled', nowIso());
      await this.persistJob(next, '取消排队中的任务');
      return { cancelled: true };
    }

    // running:先本地 abort / 标记,再尽力通知远端。禁止先阻塞在远端 HTTP 上,
    // 否则验收等待与远端超时同量级时会出现“取消中卡死直至 wait 超时”。
    const controller = this.abortByJob.get(job.id);
    controller?.abort();

    if (job.remoteExecution) {
      const marked: ExecutionJob = {
        ...job,
        remoteExecution: {
          ...job.remoteExecution,
          cancelRequested: true,
          lastRemoteStatus: 'cancelled',
        },
      };
      await this.persistJob(marked, '正在取消远端执行');
      const adapter = this.opts.registry.get(job.capabilityId);
      if (adapter) {
        try {
          await adapter.cancel(
            {
              executionId: job.remoteExecution.executionId,
              adapterId: job.remoteExecution.adapterId,
              ...(job.remoteExecution.endpoint
                ? { endpoint: job.remoteExecution.endpoint }
                : {}),
            },
            {
              jobId: job.id,
              reportProgress: () => undefined,
              signal: AbortSignal.abort(),
              secrets: this.opts.secrets ?? { get: async () => null },
              workDir: path.join(this.opts.workRoot, 'jobs', job.id),
            },
          );
        } catch {
          /* 取消请求失败仍保持本地取消 */
        }
      }
    }
    return { cancelled: true };
  }

  async getTask(input: { taskId: string }): Promise<GetTaskOutput> {
    const task = await this.opts.taskService.get(input.taskId);
    if (!task) throw new Error(`task not found: ${input.taskId}`);
    const jobs = await this.opts.jobStore.listByTask(task.id);
    const last = latestJob(jobs);
    const artifacts = await this.opts.artifactCommitter.listByTask(task.id);
    const revising = !!(last && last.revisionRequest && (last.status === 'queued' || last.status === 'running'));
    const { isExternalResearchCapabilityId, mapExternalCapabilityFailure } = await import(
      '../capability/external-capability-product'
    );
    const externalCapability = isExternalResearchCapabilityId(
      last?.capabilityId || task.capabilityId,
    );
    const hasArtifact = artifacts.length > 0;
    const primaryArtifact = pickPrimaryArtifact(artifacts, last);
    const softwareOutcome = await this.resolveSoftwareOutcomeHint(primaryArtifact, last);
    const display = deriveTaskDisplayState({
      task,
      jobsForTask: jobs,
      artifacts,
      ...(softwareOutcome ? { softwareOutcome } : {}),
      treatMissingProjectAsNeedsProject:
        task.intentKind === 'modify_code' ||
        task.requestedArtifactType === 'code-change' ||
        !!last?.externalExecution,
    });
    let userFacingLabel = display.label;
    if (!softwareOutcome && !last?.externalExecution) {
      userFacingLabel = userFacingLabelFromLatestJob(jobs, {
        revising,
        externalCapability,
        hasArtifact,
      });
    }
    const output: GetTaskOutput = {
      task,
      state: display.state,
      userFacingLabel,
      artifactIds: artifacts.map((a) => a.id),
      ...(display.projectDir ? { projectDir: display.projectDir } : {}),
      displayState: display.displayId,
      activityTime: display.activityTime,
    };
    if (last) {
      const latestJobOut: NonNullable<GetTaskOutput['latestJob']> = {
        jobId: last.id,
        status: last.status,
        createdAt: last.createdAt,
      };
      if (last.startedAt) latestJobOut.startedAt = last.startedAt;
      if (last.revisionRequest) latestJobOut.revisionRequest = last.revisionRequest;
      // 仅非终态可附带说明性进度;终态禁止拼接内部 phase 文案。
      if (
        (last.status === 'queued' || last.status === 'running') &&
        last.progress?.note !== undefined
      ) {
        latestJobOut.progressNote = last.progress.note;
      }
      if (last.status === 'failed' && last.failure?.actionable) {
        const mapped = externalCapability
          ? mapExternalCapabilityFailure({
              actionable: last.failure.actionable,
              message: last.failure.message,
            })
          : null;
        latestJobOut.actionable = mapped?.message || last.failure.actionable;
        latestJobOut.progressNote = latestJobOut.actionable;
      }
      if (last.status === 'cancelled' && externalCapability) {
        latestJobOut.actionable = mapExternalCapabilityFailure({ cancelled: true }).message;
      }
      if (last.externalExecution) {
        latestJobOut.externalExecution = {
          workingDirectory: last.externalExecution.workingDirectory,
          ...(last.externalExecution.lastExecutorStatus
            ? { lastExecutorStatus: last.externalExecution.lastExecutorStatus }
            : {}),
          ...(last.externalExecution.needsUserQuestion
            ? { needsUserQuestion: true }
            : {}),
          ...(last.externalExecution.afterScopeDigest
            ? { afterScopeDigest: last.externalExecution.afterScopeDigest }
            : {}),
        };
      }
      output.latestJob = latestJobOut;
    }
    return output;
  }

  async listTasks(input: { limit?: number } = {}): Promise<CommandMap['work.listTasks']['output']> {
    const { isExternalResearchCapabilityId } = await import(
      '../capability/external-capability-product'
    );
    const tasks = await this.opts.taskService.list(input.limit);
    const result: CommandMap['work.listTasks']['output']['tasks'] = [];
    for (const task of tasks) {
      const jobs = await this.opts.jobStore.listByTask(task.id);
      const last = latestJob(jobs);
      const revising = !!(
        last?.revisionRequest &&
        (last.status === 'queued' || last.status === 'running')
      );
      const artifacts = await this.opts.artifactCommitter.listByTask(task.id);
      const externalCapability = isExternalResearchCapabilityId(
        last?.capabilityId || task.capabilityId,
      );
      const primaryArtifact = pickPrimaryArtifact(artifacts, last);
      const softwareOutcome = await this.resolveSoftwareOutcomeHint(primaryArtifact, last);
      const display = deriveTaskDisplayState({
        task,
        jobsForTask: jobs,
        artifacts,
        ...(softwareOutcome ? { softwareOutcome } : {}),
        treatMissingProjectAsNeedsProject:
          task.intentKind === 'modify_code' ||
          task.requestedArtifactType === 'code-change' ||
          !!last?.externalExecution,
      });
      let userFacingLabel = display.label;
      if (externalCapability) {
        userFacingLabel = userFacingLabelFromLatestJob(jobs, {
          revising,
          externalCapability,
          hasArtifact: artifacts.length > 0,
          ...(softwareOutcome ? { softwareOutcome } : {}),
        });
      }
      result.push({
        taskId: task.id,
        goal: task.goal,
        state: display.state,
        userFacingLabel,
        displayState: display.displayId,
        activityTime: display.activityTime,
        ...(display.projectDir ? { projectDir: display.projectDir } : {}),
      });
    }
    const sorted = sortTasksByActivityTime(
      result.map((t) => ({
        ...t,
        activityTime: String(t.activityTime || ''),
      })),
    );
    return { tasks: sorted };
  }

  private async resolveSoftwareOutcomeHint(
    artifact: Awaited<ReturnType<ArtifactCommitter['get']>> | undefined,
    last: ExecutionJob | undefined,
  ): Promise<import('./derive').SoftwareOutcomeHint | undefined> {
    if (!artifact) {
      if (
        last?.status === 'succeeded' &&
        (last.capabilityId?.includes('codex') ||
          last.capabilityId?.includes('external') ||
          last.externalExecution)
      ) {
        return { isCodeChange: true };
      }
      return undefined;
    }
    const isCodeChange =
      artifact.type === CODE_CHANGE_ARTIFACT_TYPE ||
      artifact.type === 'code-change' ||
      !!last?.externalExecution;
    if (!isCodeChange) return undefined;
    const hint: import('./derive').SoftwareOutcomeHint = { isCodeChange: true };
    const head = artifact.versions.find((v) => v.versionId === artifact.headVersionId);
    if (head && this.opts.getArtifactOwnerDecision) {
      try {
        const decision = await this.opts.getArtifactOwnerDecision(
          artifact.id,
          head.versionId,
        );
        hint.ownerDecision = decision.status;
      } catch {
        /* ignore */
      }
    }
    if (head?.content.kind === 'bundle') {
      const manifest = head.content.entries.find((e) => e.role === 'manifest');
      if (manifest?.ref) {
        try {
          const text = await fs.readFile(
            path.isAbsolute(manifest.ref)
              ? manifest.ref
              : path.join(artifact.storageDir, manifest.ref),
            'utf8',
          );
          const parsed = JSON.parse(text) as {
            verificationOverall?: string;
            digitalMeVerified?: boolean;
            checks?: Array<{ id?: string; verdict?: string }>;
          };
          if (parsed.verificationOverall) {
            hint.verificationOverall = parsed.verificationOverall;
            hint.canAdoptSuggested =
              parsed.verificationOverall === 'satisfied' &&
              parsed.digitalMeVerified !== false;
          }
          const startup = (parsed.checks || []).find((c) => c.id === 'run_startup_check');
          if (startup?.verdict) {
            hint.startupCheckVerdict = startup.verdict;
            hint.canSuggestTryRun = startup.verdict === 'satisfied';
            if (startup.verdict === 'unsatisfied') {
              hint.canAdoptSuggested = false;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return hint;
  }

  /** 启动扫描:按封闭 RecoveryAction 落地,不临时扩展状态。 */
  async recoverOnStartup(): Promise<{
    actions: Array<{ jobId: string; action: string }>;
  }> {
    const actions: Array<{ jobId: string; action: string }> = [];
    const jobs = await this.opts.jobStore.list();
    for (const job of jobs) {
      let artifactExists = await this.opts.artifactCommitter.existsForJob(job.id);
      // 修订 Job 向既有 Artifact 追加版本：权威在 job.artifactId / targetArtifactId
      if (!artifactExists && job.artifactId) {
        artifactExists = !!(await this.opts.artifactCommitter.get(job.artifactId));
      }
      if (!artifactExists && job.targetArtifactId && job.status === 'succeeded') {
        artifactExists = !!(await this.opts.artifactCommitter.get(job.targetArtifactId));
      }

      // 远端映射恢复:running + remoteExecution → 重新入队以 re-associate,不另建状态机。
      if (
        job.status === 'running' &&
        job.remoteExecution?.executionId &&
        !artifactExists &&
        !job.remoteExecution.cancelRequested
      ) {
        this.enqueue(job.id);
        actions.push({ jobId: job.id, action: 'requeue_remote_resume' });
        continue;
      }

      const action = recoverJobOnStartup(job, artifactExists);
      if (action === 'none') continue;
      const at = nowIso();
      if (action === 'requeue') {
        if (job.status !== 'queued') {
          // 协议保证 queued 才 requeue;防御性保持原状并入队。
        }
        this.enqueue(job.id);
        actions.push({ jobId: job.id, action });
        continue;
      }
      if (action === 'commit_succeeded') {
        const next = applyRecoveryWrite(job, 'commit_succeeded', at);
        await this.persistJob(next, '恢复:补交成果');
        actions.push({ jobId: job.id, action });
        continue;
      }
      // mark_failed
      const stage: FailureStage =
        job.status === 'succeeded' ? 'artifact_write' : 'interrupted';
      const failure =
        stage === 'artifact_write'
          ? {
              stage,
              message: '成果记录缺失',
              actionable: '请重试该任务以重新生成成果',
            }
          : {
              stage,
              message: '应用重启中断',
              actionable: '可以重试该任务',
            };
      const next = applyRecoveryWrite(job, 'mark_failed', at, failure);
      await this.persistJob(next, failure.message);
      actions.push({ jobId: job.id, action });
    }

    return { actions };
  }

  async getJob(jobId: string): Promise<ExecutionJob | null> {
    return this.opts.jobStore.get(jobId);
  }

  async listSnapshotsForTask(taskId: string) {
    return this.opts.snapshotBuilder.listByTask(taskId);
  }

  async getSnapshot(snapshotId: string) {
    return this.opts.snapshotBuilder.get(snapshotId);
  }

  async getArtifact(artifactId: string) {
    return this.opts.artifactCommitter.get(artifactId);
  }

  get eventBus(): InMemoryEventBus {
    return this.opts.eventBus;
  }

  // --- internals ---

  private async createQueuedJob(
    taskId: string,
    capabilityId: string,
    meta?: {
      targetArtifactId?: string;
      revisionRequest?: string;
      rejectionReason?: string;
    },
    externalExecution?: ExecutionJob['externalExecution'],
  ): Promise<ExecutionJob> {
    const active = await this.opts.jobStore.findActiveForTask(taskId);
    if (active) {
      throw new Error(`task already has an active job: ${active.id}`);
    }
    const job: ExecutionJob = {
      id: newId('job'),
      taskId,
      capabilityId,
      createdAt: nowIso(),
      status: 'queued',
      ...(meta?.targetArtifactId ? { targetArtifactId: meta.targetArtifactId } : {}),
      ...(meta?.revisionRequest ? { revisionRequest: meta.revisionRequest } : {}),
      ...(meta?.rejectionReason ? { rejectionReason: meta.rejectionReason } : {}),
      ...(externalExecution ? { externalExecution } : {}),
    };
    await this.opts.jobStore.put(job);
    this.publishJob(job);
    return job;
  }

  private async restoreExternalExecutionBaseline(
    taskId: string,
    jobId?: string,
  ): Promise<CommandMap['work.retryTask']['output']> {
    const jobs = await this.opts.jobStore.listByTask(taskId);
    const target =
      (jobId ? jobs.find((j) => j.id === jobId) : undefined) ||
      [...jobs]
        .reverse()
        .find((j) => j.externalExecution?.workingDirectory && (j.status === 'succeeded' || j.status === 'failed'));
    if (!target?.externalExecution) {
      throw Object.assign(new Error('没有可恢复的执行记录'), {
        actionable: '仅在外部代码执行完成后才能恢复本次执行前状态',
      });
    }
    const evidenceDir = path.join(this.opts.workRoot, 'jobs', target.id, 'external-execution');
    let baseline: ExecutionBaseline;
    let collected: CollectedExecutionChanges;
    try {
      baseline = JSON.parse(await fs.readFile(path.join(evidenceDir, 'baseline.json'), 'utf8')) as ExecutionBaseline;
      collected = JSON.parse(
        await fs.readFile(path.join(evidenceDir, 'collected-changes.json'), 'utf8'),
      ) as CollectedExecutionChanges;
      // patch 不在 json 内时补空
      if (!collected.unifiedDiff) {
        try {
          collected.unifiedDiff = await fs.readFile(path.join(evidenceDir, 'patch.diff'), 'utf8');
        } catch {
          collected.unifiedDiff = '';
        }
      }
    } catch {
      throw Object.assign(new Error('找不到执行前快照'), {
        actionable: '无法恢复：执行证据不完整',
      });
    }
    const result = await restoreExecutionBaseline({
      baseline,
      collected,
      jobEvidenceDir: evidenceDir,
    });
    return {
      jobId: '',
      restored: result.ok,
      message: result.message,
      ...(result.conflicts.length ? { conflicts: result.conflicts } : {}),
    };
  }

  private enqueue(jobId: string): void {
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.started) return;
    this.pumping = true;
    try {
      while (this.started && this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) break;
        await this.runJob(jobId);
      }
    } finally {
      this.pumping = false;
      if (this.started && this.queue.length > 0) void this.pump();
    }
  }

  private async runJob(jobId: string): Promise<void> {
    let job = await this.opts.jobStore.get(jobId);
    if (!job) return;
    if (job.status === 'cancelled' || isTerminal(job.status)) return;

    const resumingRemote =
      job.status === 'running' &&
      !!job.remoteExecution?.executionId &&
      !job.remoteExecution.cancelRequested;

    if (job.status !== 'queued' && !resumingRemote) return;

    const task = await this.opts.taskService.get(job.taskId);
    if (!task) {
      await this.failJob(job, 'capability', '任务不存在', '请重新提交任务');
      return;
    }

    const controller = new AbortController();
    this.abortByJob.set(jobId, controller);

    try {
      if (!resumingRemote) {
        let accepted = false;
        await this.enqueueJobWrite(jobId, async () => {
          const current = await this.opts.jobStore.get(jobId);
          if (!current || current.status !== 'queued') return;
          job = transitionJob(current, 'running', nowIso());
          job = {
            ...job,
            phase: 'context',
            progress: { note: '正在准备材料', updatedAt: nowIso() },
          };
          await this.opts.jobStore.put(job);
          this.publishJob(job);
          accepted = true;
        });
        if (!accepted || !job) return;
      } else {
        job = await this.withProgress(job, 'capability', '正在恢复远端执行');
        await this.persistJob(job);
      }
      const active: ExecutionJob = job;

      // --- context ---
      // 先取已选能力的通用 contextPolicy,由 SnapshotBuilder 执行;Runner 不解释场景。
      const selectedAdapter = this.opts.registry.get(job.capabilityId);
      let snapshot;
      if (resumingRemote && job.snapshotId) {
        snapshot = await this.opts.snapshotBuilder.get(job.snapshotId);
        if (!snapshot) {
          await this.failJob(active, 'context', '快照缺失', '请重试该任务');
          return;
        }
      } else {
        try {
          snapshot = await this.opts.snapshotBuilder.build(
            task,
            selectedAdapter?.registration.contextPolicy,
          );
        } catch (error) {
          if (controller.signal.aborted) {
            await this.cancelRunning(active);
            return;
          }
          await this.failJob(
            active,
            'context',
            sanitizeMessage((error as Error).message || '材料准备失败'),
            '请检查材料路径后重试',
          );
          return;
        }
        job = { ...active, snapshotId: snapshot.id };
        job = await this.withProgress(job, 'capability', '正在调用能力');
        await this.persistJob(job);
      }

      if (controller.signal.aborted || job.remoteExecution?.cancelRequested) {
        await this.cancelRunning(job);
        return;
      }

      // --- capability ---
      const adapter = selectedAdapter;
      if (!adapter) {
        await this.failJob(job, 'capability', '能力不可用', '请选择其他能力或稍后重试');
        return;
      }

      const workDir = path.join(this.opts.workRoot, 'jobs', job.id);
      await fs.mkdir(workDir, { recursive: true });
      // AI-first：主体注入失败不得阻断主成果（学习/派生失败走空切片）
      let selection: SubjectSelectionResult;
      try {
        const fullContext =
          (await this.opts.loadSubjectContext?.()) ?? emptySubjectContext(this.opts.subjectId);
        const selectedRaw = this.opts.selectSubjectContext
          ? await this.opts.selectSubjectContext({
              goal: task.goal,
              requestedArtifactType: task.requestedArtifactType,
              ...(task.intentKind ? { intentKind: task.intentKind } : {}),
              confirmed: fullContext,
              taskId: task.id,
            })
          : fullContext;
        selection = normalizeSelection(this.opts.subjectId, selectedRaw, fullContext);
      } catch {
        selection = {
          subjectContext: emptySubjectContext(this.opts.subjectId),
          freeze: buildSubjectContextFreeze({
            subjectId: this.opts.subjectId,
            entries: [],
            selectionReasons: [],
            excludedEventIds: [],
          }),
        };
      }
      const subjectContext = selection.subjectContext;
      if (selection.pauseExternalAction) {
        job = await this.withProgress(
          job,
          'capability',
          '需你确认后才能继续对外或不可逆操作；其余可安全完成的部分继续整理。',
        );
        await this.persistJob(job);
      }
      if (!resumingRemote) {
        snapshot = await this.opts.snapshotBuilder.attachSubjectContext(
          snapshot.id,
          `${JSON.stringify(selection.freeze, null, 2)}\n`,
        );
      }
      const secrets = this.opts.secrets ?? { get: async () => null };
      const jobMeta = {
        taskId: job.taskId,
        capabilityId: job.capabilityId,
        createdAt: job.createdAt,
        revisionRequest: job.revisionRequest,
        rejectionReason: job.rejectionReason,
        targetArtifactId: job.targetArtifactId,
      };

      let revisionInput: {
        request: string;
        previousText: string;
        artifactId: string;
        rejectionReason?: string;
      } | undefined;
      if (jobMeta.targetArtifactId && jobMeta.revisionRequest) {
        const target = await this.opts.artifactCommitter.get(jobMeta.targetArtifactId);
        if (!target) {
          await this.failJob(job, 'capability', '成果不存在', '请重新打开任务后再试');
          return;
        }
        const head = target.versions.find((v) => v.versionId === target.headVersionId);
        if (!head) {
          await this.failJob(job, 'capability', '成果版本不存在', '请重试');
          return;
        }
        if (head.content.kind === 'file') {
          await this.failJob(
            job,
            'capability',
            '当前成果不支持按说明修改',
            '请使用重试重新生成，或采用/拒绝后另开任务',
          );
          return;
        }
        let previousText = '';
        if (head.content.kind === 'text') {
          if (!this.opts.readExtractedText) {
            await this.failJob(job, 'capability', '无法读取当前成果', '请重试');
            return;
          }
          previousText = await this.opts.readExtractedText(head.content.ref);
        } else if (head.content.kind === 'bundle') {
          const report = head.content.entries.find((e) => e.role === 'report');
          if (report && this.opts.readExtractedText) {
            try {
              previousText = await this.opts.readExtractedText(report.ref);
            } catch {
              previousText = '';
            }
          }
        }
        revisionInput = {
          request: jobMeta.revisionRequest,
          previousText,
          artifactId: target.id,
          ...(jobMeta.rejectionReason ? { rejectionReason: jobMeta.rejectionReason } : {}),
        };
        job = await this.withProgress(job, 'capability', '正在修改');
        await this.persistJob(job);
      }

      const isRemote =
        adapter.registration.location === 'remote' &&
        adapter.registration.adapter.type === 'remote-subject';

      if (isRemote && selection.pauseExternalAction) {
        await this.failJob(
          job,
          'capability',
          '对外行动已暂停',
          '请先确认冲突偏好后再发起对外或不可逆操作；本地整理可另开任务继续',
        );
        return;
      }

      const bindRemote = async (
        ref: {
          executionId: string;
          adapterId: string;
          endpoint?: string;
          lastRemoteStatus?: RemoteLifecycleStatus;
        },
      ) => {
        const current = await this.opts.jobStore.get(jobId);
        if (!current || isTerminal(current.status)) return;
        const next: ExecutionJob = {
          ...current,
          remoteExecution: {
            executionId: ref.executionId,
            adapterId: ref.adapterId,
            ...(ref.endpoint ? { endpoint: ref.endpoint } : {}),
            ...(ref.lastRemoteStatus ? { lastRemoteStatus: ref.lastRemoteStatus } : {}),
            ...(current.remoteExecution?.cancelRequested ? { cancelRequested: true } : {}),
            ...(current.remoteExecution?.retryCount !== undefined
              ? { retryCount: current.remoteExecution.retryCount }
              : {}),
          },
        };
        job = next;
        await this.persistJob(next, '已关联远端执行');
      };

      const updateRemote = async (patch: {
        lastRemoteStatus?: RemoteLifecycleStatus;
        executionId?: string;
      }) => {
        const current = await this.opts.jobStore.get(jobId);
        if (!current?.remoteExecution || isTerminal(current.status)) return;
        const next: ExecutionJob = {
          ...current,
          remoteExecution: {
            ...current.remoteExecution,
            ...(patch.executionId ? { executionId: patch.executionId } : {}),
            ...(patch.lastRemoteStatus ? { lastRemoteStatus: patch.lastRemoteStatus } : {}),
          },
        };
        job = next;
        await this.persistJob(next);
      };

      const execCtx = {
        jobId: job.id,
        reportProgress: (note: string) => {
          this.liveProgress.set(jobId, note);
          this.publishJob(
            {
              id: jobId,
              taskId: jobMeta.taskId,
              capabilityId: jobMeta.capabilityId,
              createdAt: jobMeta.createdAt,
              status: 'running' as const,
              ...(jobMeta.revisionRequest
                ? { revisionRequest: jobMeta.revisionRequest }
                : {}),
              ...(jobMeta.targetArtifactId
                ? { targetArtifactId: jobMeta.targetArtifactId }
                : {}),
              progress: { note, updatedAt: nowIso() },
            },
            note,
          );
        },
        signal: controller.signal,
        secrets,
        workDir,
        ...(this.opts.readExtractedText
          ? { readExtractedText: this.opts.readExtractedText }
          : {}),
        bindRemoteExecution: (ref: {
          executionId: string;
          adapterId: string;
          endpoint?: string;
          lastRemoteStatus?: RemoteLifecycleStatus;
        }) => {
          void bindRemote(ref);
        },
        updateRemoteExecution: (patch: {
          lastRemoteStatus?: RemoteLifecycleStatus;
          executionId?: string;
        }) => {
          void updateRemote(patch);
        },
        updateExternalExecution: (patch: {
          lastExecutorStatus?: NonNullable<ExecutionJob['externalExecution']>['lastExecutorStatus'];
          executorRunId?: string;
          afterScopeDigest?: string;
          needsUserQuestion?: boolean;
        }) => {
          void (async () => {
            const current = await this.opts.jobStore.get(jobId);
            if (!current?.externalExecution || isTerminal(current.status)) return;
            const next: ExecutionJob = {
              ...current,
              externalExecution: {
                ...current.externalExecution,
                ...(patch.lastExecutorStatus
                  ? { lastExecutorStatus: patch.lastExecutorStatus }
                  : {}),
                ...(patch.executorRunId ? { executorRunId: patch.executorRunId } : {}),
                ...(patch.afterScopeDigest
                  ? { afterScopeDigest: patch.afterScopeDigest }
                  : {}),
                ...(patch.needsUserQuestion !== undefined
                  ? { needsUserQuestion: patch.needsUserQuestion }
                  : {}),
              },
            };
            job = next;
            await this.persistJob(next);
          })();
        },
      };

      // 外部执行：进入能力阶段即标记 running（避免失败后仍停留 queued）
      if (job.externalExecution) {
        const marked: ExecutionJob = {
          ...job,
          externalExecution: {
            ...job.externalExecution,
            lastExecutorStatus: 'running',
          },
        };
        job = marked;
        await this.persistJob(marked);
      }

      let output;
      try {
        if (resumingRemote && job.remoteExecution) {
          const resumed = await resumeRemoteIfPossible({
            adapter,
            job,
            ctx: execCtx,
          });
          if (resumed.kind === 'cancelled') {
            await this.cancelRunning(job);
            return;
          }
          if (resumed.kind === 'failed') {
            await this.failJob(
              job,
              'capability',
              sanitizeMessage(resumed.message),
              '远端恢复失败,请重试',
            );
            return;
          }
          if (resumed.kind === 'still_running') {
            // 断线恢复:远端仍在跑 — 继续轮询 recover 直至终态(不新建第二状态机)
            const deadline = Date.now() + 30_000;
            let stillRunning = true;
            while (Date.now() < deadline) {
              if (controller.signal.aborted) {
                await this.cancelRunning(job);
                return;
              }
              await new Promise((r) => setTimeout(r, 50));
              const again = await resumeRemoteIfPossible({ adapter, job, ctx: execCtx });
              if (again.kind === 'output') {
                output = again.output;
                stillRunning = false;
                break;
              }
              if (again.kind === 'cancelled') {
                await this.cancelRunning(job);
                return;
              }
              if (again.kind === 'failed') {
                await this.failJob(
                  job,
                  'capability',
                  sanitizeMessage(again.message),
                  '远端恢复失败,请重试',
                );
                return;
              }
              stillRunning = again.kind === 'still_running';
            }
            if (!output) {
              await this.failJob(
                job,
                'interrupted',
                stillRunning ? '远端仍在处理且等待超时' : '远端恢复未得到成果',
                '请稍后重试该任务',
              );
              return;
            }
          } else if (resumed.kind === 'output') {
            output = resumed.output;
          }
          // none → fall through to normal execute
        }

        if (!output) {
          const grant =
            task.authorization?.grantId && this.opts.loadAuthorizationGrant
              ? await this.opts.loadAuthorizationGrant(task.authorization.grantId)
              : null;
          const rawInput = {
            goal: task.goal,
            snapshot,
            subjectContext,
            artifactType: task.requestedArtifactType,
            ...(revisionInput ? { revision: revisionInput } : {}),
            ...(job.externalExecution?.workingDirectory
              ? {
                  executionAuthorization: {
                    confirmed: true as const,
                    workingDirectory: job.externalExecution.workingDirectory,
                    readScope: job.externalExecution.readScope,
                    writeScope: job.externalExecution.writeScope,
                    ...(job.externalExecution.projectOrigin
                      ? { projectOrigin: job.externalExecution.projectOrigin }
                      : {}),
                  },
                }
              : {}),
          };
          const auth = buildJobAuthorizationProjection({
            task,
            capabilityInput: rawInput,
            grant,
            isRemote,
          });
          const markers = this.opts.resolveUnauthorizedMarkers
            ? await this.opts.resolveUnauthorizedMarkers({
                taskId: task.id,
                allowedMaterialPaths: [...auth.allowedMaterials],
              })
            : [];
          const preparedResult = await prepareAndExecuteCapability({
            adapter,
            rawInput,
            auth,
            ctx: execCtx,
            isRemote,
            unauthorizedMarkers: markers,
            job: (await this.opts.jobStore.get(jobId)) ?? job,
            task,
            subjectId: task.subjectId,
          });
          output = preparedResult.output;
        } else if (isRemote) {
          // 恢复得到的 output 仍须验证并附收据
          const grant =
            task.authorization?.grantId && this.opts.loadAuthorizationGrant
              ? await this.opts.loadAuthorizationGrant(task.authorization.grantId)
              : null;
          const rawInput = {
            goal: task.goal,
            snapshot,
            subjectContext,
            artifactType: task.requestedArtifactType,
          };
          const auth = buildJobAuthorizationProjection({
            task,
            capabilityInput: rawInput,
            grant,
            isRemote,
          });
          const markers = this.opts.resolveUnauthorizedMarkers
            ? await this.opts.resolveUnauthorizedMarkers({
                taskId: task.id,
                allowedMaterialPaths: [...auth.allowedMaterials],
              })
            : [];
          const expectedBinding =
            job.remoteExecution?.executionId || output.candidateMeta?.sourceBinding;
          const { verifyCandidateArtifact } = await import(
            '../capability/candidate-artifact-verify'
          );
          const { attachReceiptToOutput, buildActionReceipt } = await import(
            '../capability/action-receipt'
          );
          const verification = verifyCandidateArtifact({
            output,
            goal: task.goal,
            expectedArtifactType: task.requestedArtifactType,
            auth,
            unauthorizedMarkers: markers,
            ...(expectedBinding ? { expectedSourceBinding: expectedBinding } : {}),
            nowIso: nowIso(),
          });
          if (verification.verdict !== 'passed') {
            throw Object.assign(
              new Error(verification.issues.map((i) => i.message).join('; ')),
              {
                stage: 'capability' as const,
                actionable: '已收到结果，但未通过完整性检查，未加入你的成果。',
                code: 'verification_failed',
              },
            );
          }
          const describe = adapter.describe();
          const receipt = buildActionReceipt({
            receiptId: newId('capability'),
            subjectId: task.subjectId,
            taskId: task.id,
            jobId: job.id,
            capabilityId: adapter.registration.id,
            adapterId: describe.adapterId,
            adapterType: describe.adapterType,
            adapterVersion: describe.version,
            ...(job.remoteExecution?.executionId
              ? { remoteExecutionId: job.remoteExecution.executionId }
              : {}),
            sentFields: [...auth.allowedFields],
            materialRefs: [],
            verification,
            output,
            auth,
            startedAt: job.startedAt || job.createdAt,
            finishedAt: nowIso(),
          });
          output = await attachReceiptToOutput(output, workDir, receipt);
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error) || job.remoteExecution?.cancelRequested) {
          await this.cancelRunning(job);
          return;
        }
        const lateCollectReject = (error as { code?: string }).code === 'late_collect_rejected';
        if (lateCollectReject) {
          await this.cancelRunning(job);
          return;
        }
        const stage = inferFailureStage(error);
        const actionable =
          (error as { actionable?: string }).actionable ??
          '请重试;若持续失败请更换能力或简化材料';
        await this.failJob(
          job,
          stage,
          sanitizeMessage((error as Error).message || '能力执行失败'),
          sanitizeMessage(actionable),
        );
        return;
      }

      if (controller.signal.aborted || job.remoteExecution?.cancelRequested) {
        await this.cancelRunning(job);
        return;
      }

      // Outcome Check：按成果合同分派；无适用检查器显式不适用
      if (!isRemote && output) {
        const hardBoundaryTexts = subjectContext.entries
          .filter((e) => (e.kind || '') === 'boundary')
          .map((e) => `${e.title}\n${e.detail}\n${e.tags.join(' ')}`);

        let outcome = dispatchOutcomeCheck({
          goal: task.goal,
          output,
          isRemote: false,
          hardBoundaryTexts,
          requestedArtifactType: task.requestedArtifactType,
          ...(revisionInput
            ? {
                previousText: revisionInput.previousText,
                revisionRequest: revisionInput.request,
              }
            : {}),
        });

        if (outcome.checkKind === 'text' && outcome.verdict === 'targeted_revision_required') {
          const text = capabilityOutputText(output) || '';
          job = await this.withProgress(job, 'capability', '正在修改');
          await this.persistJob(job);
          try {
            // 定向修订仍须保留已匹配的偏好/纠正/经验；不得只留边界导致小循环断链
            const minimalContext: ConfirmedExperienceView = {
              subjectId: subjectContext.subjectId,
              derivedAt: subjectContext.derivedAt,
              entries: subjectContext.entries
                .filter((e) => {
                  const kind = e.kind || '';
                  if (kind === 'boundary') return true;
                  if (kind === 'preference') return true;
                  if (kind === 'experience' && !(e.tags || []).includes('reuse:weak_structure')) {
                    return true;
                  }
                  return false;
                })
                .slice(0, 4),
            };
            const grant =
              task.authorization?.grantId && this.opts.loadAuthorizationGrant
                ? await this.opts.loadAuthorizationGrant(task.authorization.grantId)
                : null;
            const reviseRaw = {
              goal: task.goal,
              snapshot,
              subjectContext: minimalContext,
              artifactType: task.requestedArtifactType,
              revision: {
                request: buildTargetedRevisionRequest(outcome.defects),
                previousText: text,
                artifactId: revisionInput?.artifactId || 'pending',
                ...(revisionInput?.rejectionReason
                  ? { rejectionReason: revisionInput.rejectionReason }
                  : {}),
              },
            };
            const auth = buildJobAuthorizationProjection({
              task,
              capabilityInput: reviseRaw,
              grant,
              isRemote: false,
            });
            const markers = this.opts.resolveUnauthorizedMarkers
              ? await this.opts.resolveUnauthorizedMarkers({
                  taskId: task.id,
                  allowedMaterialPaths: [...auth.allowedMaterials],
                })
              : [];
            const revised = await prepareAndExecuteCapability({
              adapter,
              rawInput: reviseRaw,
              auth,
              ctx: execCtx,
              isRemote: false,
              unauthorizedMarkers: markers,
              job: (await this.opts.jobStore.get(jobId)) ?? job,
              task,
              subjectId: task.subjectId,
            });
            output = revised.output;
            outcome = dispatchOutcomeCheck({
              goal: task.goal,
              output,
              isRemote: false,
              hardBoundaryTexts,
              requestedArtifactType: task.requestedArtifactType,
              // 自动补修后再检：仍按用户修订合同（若有），不得把系统补修说明当硬缺陷
              ...(revisionInput
                ? {
                    previousText: revisionInput.previousText,
                    revisionRequest: revisionInput.request,
                  }
                : {}),
            });
          } catch {
            // 自动补修失败：保留当前结果
          }
        }

        if (outcome.verdict === 'blocked') {
          if (outcome.checkKind === 'bundle' || outcome.checkKind === 'external') {
            await this.failJob(
              job,
              'capability',
              sanitizeMessage(outcome.defects[0] || '成果不完整'),
              outcome.checkKind === 'bundle'
                ? '请重试分析；若持续失败请缩小仓库范围'
                : '请按说明修改后重试',
            );
            return;
          }
          if (outcome.checkKind === 'text' && !(capabilityOutputText(output) || '').trim()) {
            await this.failJob(
              job,
              'capability',
              sanitizeMessage(outcome.defects[0] || '成果不完整'),
              '请补充任务说明后重试',
            );
            return;
          }
        }

        // 文本硬缺陷：主题偏离 / 修订无实质变化 / 「不少于」字数
        if (outcome.checkKind === 'text') {
          const hardDefect = outcome.defects.some((d) =>
            /主题未紧扣|几乎相同|修改说明未落实|不少于约/.test(d),
          );
          if (hardDefect) {
            await this.failJob(
              job,
              'capability',
              sanitizeMessage(outcome.defects[0] || '成果未达到任务要求'),
              '请调整任务说明或修改要求后重试',
            );
            return;
          }
        }
      }

      // --- artifact commit / append (先写 Artifact,再 succeeded) ---
      job = await this.withProgress(job, 'artifact_write', '正在保存成果');
      await this.persistJob(job);
      let artifact;
      try {
        if (job.targetArtifactId) {
          artifact = await this.opts.artifactCommitter.appendCapabilityVersion({
            artifactId: job.targetArtifactId,
            jobId: job.id,
            output,
            ...(job.revisionRequest ? { note: job.revisionRequest } : {}),
          });
        } else {
          artifact = await this.opts.artifactCommitter.commit({
            jobId: job.id,
            taskId: task.id,
            subjectId: task.subjectId,
            output,
          });
        }
      } catch (error) {
        // 远端已完成但本地写入失败:保留 remoteExecution 映射,供重启后 recover 再提交
        await this.failJob(
          job,
          'artifact_write',
          sanitizeMessage((error as Error).message || '成果保存失败'),
          '请重试该任务',
        );
        return;
      }

      // 幂等:重放同一 Job 不得生成第二个 Artifact(committer 已保证)
      const at = nowIso();
      let succeeded = transitionJob(job, 'succeeded', at);
      succeeded = {
        ...succeeded,
        artifactId: artifact.id,
        snapshotId: snapshot.id,
        ...(succeeded.externalExecution
          ? {
              externalExecution: {
                ...succeeded.externalExecution,
                lastExecutorStatus: 'succeeded' as const,
              },
            }
          : {}),
      };
      // 终态清除进行中进度,避免 UI 拼接「已完成 · 正在整理成果」
      delete succeeded.progress;
      delete succeeded.phase;
      const duration = durationMs(job.startedAt, at);
      if (output.costActual?.tokens !== undefined || duration !== undefined) {
        succeeded.costActual = {
          ...(output.costActual?.tokens !== undefined ? { tokens: output.costActual.tokens } : {}),
          ...(duration !== undefined ? { durationMs: duration } : {}),
        };
      }
      this.liveProgress.delete(jobId);
      await this.persistJob(succeeded);
      this.opts.eventBus.publish({
        kind: 'artifact.updated',
        artifactId: artifact.id,
        taskId: task.id,
        headVersionId: artifact.headVersionId,
      });
    } finally {
      this.abortByJob.delete(jobId);
      this.liveProgress.delete(jobId);
    }
  }

  private async cancelRunning(job: ExecutionJob): Promise<void> {
    const current = await this.opts.jobStore.get(job.id);
    if (!current || isTerminal(current.status)) return;
    if (current.status !== 'running') return;
    let next = transitionJob(current, 'cancelled', nowIso());
    // cancelled 不产生 Artifact
    delete next.artifactId;
    if (next.externalExecution) {
      next = {
        ...next,
        externalExecution: {
          ...next.externalExecution,
          lastExecutorStatus: 'cancelled',
        },
      };
    }
    await this.persistJob(next, '已取消');
  }

  private async failJob(
    job: ExecutionJob,
    stage: FailureStage,
    message: string,
    actionable: string,
  ): Promise<void> {
    const current = await this.opts.jobStore.get(job.id);
    if (!current || isTerminal(current.status)) return;
    if (current.status !== 'running' && current.status !== 'queued') return;
    let next = current.status === 'queued' ? transitionJob(current, 'running', nowIso()) : current;
    // queued 不能直接 failed;若仍 queued(极端),先转 running 再 failed。
    if (next.status === 'queued') next = transitionJob(next, 'running', nowIso());
    next = transitionJob(next, 'failed', nowIso());
    next = {
      ...next,
      failure: { stage, message, actionable },
      ...(next.externalExecution
        ? {
            externalExecution: {
              ...next.externalExecution,
              lastExecutorStatus: 'failed' as const,
            },
          }
        : {}),
    };
    await this.persistJob(next, actionable);
  }

  private async withProgress(
    job: ExecutionJob,
    phase: string,
    note: string,
  ): Promise<ExecutionJob> {
    return {
      ...job,
      phase,
      progress: { note, updatedAt: nowIso() },
    };
  }

  private async noteProgress(jobId: string, note: string): Promise<void> {
    this.liveProgress.set(jobId, note);
  }

  private async persistJob(job: ExecutionJob, progressNote?: string): Promise<void> {
    await this.enqueueJobWrite(job.id, async () => {
      const liveNote = this.liveProgress.get(job.id) ?? progressNote ?? job.progress?.note;
      const toWrite: ExecutionJob = liveNote
        ? { ...job, progress: { note: liveNote, updatedAt: nowIso() } }
        : job;
      await this.opts.jobStore.put(toWrite);
      this.publishJob(toWrite, progressNote ?? liveNote);
    });
  }

  private enqueueJobWrite(jobId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.jobWriteChains.get(jobId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.jobWriteChains.set(
      jobId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private publishJob(job: ExecutionJob, progressNote?: string): void {
    const event: {
      kind: 'job.updated';
      jobId: string;
      taskId: string;
      status: ExecutionJob['status'];
      phase?: string;
      progressNote?: string;
    } = {
      kind: 'job.updated',
      jobId: job.id,
      taskId: job.taskId,
      status: job.status,
    };
    if (job.phase !== undefined) event.phase = job.phase;
    const note = progressNote ?? job.progress?.note;
    if (note !== undefined) event.progressNote = note;
    this.opts.eventBus.publish(event);
  }

  private async withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.taskLocks.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(() => gate);
    this.taskLocks.set(taskId, next);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.taskLocks.get(taskId) === next) this.taskLocks.delete(taskId);
    }
  }
}

function emptySubjectContext(subjectId: string): ConfirmedExperienceView {
  return { subjectId, derivedAt: nowIso(), entries: [] };
}

function normalizeSelection(
  subjectId: string,
  selected: SubjectSelectionResult | ConfirmedExperienceView,
  fallback: ConfirmedExperienceView,
): SubjectSelectionResult {
  if (
    selected &&
    typeof selected === 'object' &&
    'subjectContext' in selected &&
    'freeze' in selected
  ) {
    return selected;
  }
  const view = selected && 'entries' in selected ? selected : fallback;
  const entries = view.entries.map((e) => ({
    eventId: e.eventId,
    kind: e.kind ?? ('experience' as const),
    title: e.title,
    detail: e.detail,
    tags: e.tags,
    occurredAt: e.occurredAt,
  }));
  return {
    subjectContext: view,
    freeze: buildSubjectContextFreeze({
      subjectId: view.subjectId || subjectId,
      entries,
      selectionReasons: entries.map((e) => ({
        eventId: e.eventId,
        reason: 'manual_none' as const,
      })),
      excludedEventIds: [],
    }),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && /abort/i.test(error.message))
  );
}

function inferFailureStage(error: unknown): FailureStage {
  const stage = (error as { stage?: string }).stage;
  if (
    stage === 'context' ||
    stage === 'capability' ||
    stage === 'model' ||
    stage === 'artifact_write' ||
    stage === 'interrupted'
  ) {
    return stage;
  }
  return 'capability';
}

function durationMs(startedAt: string | undefined, finishedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : undefined;
}

/** 测试辅助:等待 Job 进入终态。 */
export async function waitForJobTerminal(
  runtime: WorkRuntime,
  jobId: string,
  timeoutMs = 10_000,
): Promise<ExecutionJob> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const view = await runtime.getJob(jobId);
    if (view && isTerminal(view.status)) return view;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for job ${jobId}`);
}

export async function waitForTaskState(
  runtime: WorkRuntime,
  taskId: string,
  predicate: (state: GetTaskOutput) => boolean,
  timeoutMs = 10_000,
): Promise<GetTaskOutput> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const view = await runtime.getTask({ taskId });
    if (predicate(view)) return view;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for task ${taskId}`);
}
