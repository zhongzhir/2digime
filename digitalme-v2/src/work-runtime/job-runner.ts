import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityRegistry } from '../capability/registry';
import type { SecretAccessor, RemoteLifecycleStatus } from '../capability/adapter';
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
import { deriveTaskState, latestJob, userFacingLabelFromLatestJob } from './derive';
import {
  buildJobAuthorizationProjection,
  prepareAndExecuteCapability,
  resumeRemoteIfPossible,
} from './remote-job-bridge';

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
    confirmed: ConfirmedExperienceView;
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
}

export interface SubjectSelectionResult {
  subjectContext: ConfirmedExperienceView;
  freeze: SubjectContextFreeze;
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
   * 禁止扫描/解析/调模型/写 Artifact。
   */
  async submitTask(input: SubmitInput): Promise<{ taskId: string; jobId: string }> {
    const adapter = this.opts.registry.selectFor(
      input.requestedArtifactType,
      input.capabilityId,
    );
    if (!adapter) {
      throw new Error('no available capability for requested artifact type');
    }
    if (adapter.registration.availability !== 'available') {
      throw new Error('selected capability is not available');
    }

    const taskInput: {
      subjectId: string;
      goal: string;
      contextRefs: SubmitInput['contextRefs'];
      requestedArtifactType: string;
      capabilityId?: string;
      authorization?: SubmitInput['authorization'];
    } = {
      subjectId: this.opts.subjectId,
      goal: input.goal,
      contextRefs: input.contextRefs,
      requestedArtifactType: input.requestedArtifactType,
      capabilityId: adapter.registration.id,
    };
    if (input.capabilityId !== undefined) {
      taskInput.capabilityId = input.capabilityId;
    }
    if (input.authorization) {
      taskInput.authorization = input.authorization;
    }
    const task = await this.opts.taskService.create(taskInput);

    const job = await this.createQueuedJob(task.id, adapter.registration.id);
    this.enqueue(job.id);
    return { taskId: task.id, jobId: job.id };
  }

  /**
   * 仅当无非终态 Job 时允许;新建 Job + 默认新建 Snapshot;
   * 并发双击经 task 锁串行,只能成功创建一个。
   */
  async retryTask(input: { taskId: string }): Promise<{ jobId: string }> {
    return this.withTaskLock(input.taskId, async () => {
      const task = await this.opts.taskService.get(input.taskId);
      if (!task) throw new Error(`task not found: ${input.taskId}`);
      const active = await this.opts.jobStore.findActiveForTask(input.taskId);
      if (active) {
        throw new Error(`task already has an active job: ${active.id}`);
      }
      const capabilityId =
        task.capabilityId ??
        this.opts.registry.selectFor(task.requestedArtifactType)?.registration.id;
      if (!capabilityId) {
        throw new Error('no available capability for retry');
      }
      const job = await this.createQueuedJob(task.id, capabilityId);
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
  }): Promise<{ jobId: string }> {
    const request = String(input.revisionRequest || '').trim();
    if (!request) throw new Error('请填写修改要求');

    return this.withTaskLock(input.taskId, async () => {
      const task = await this.opts.taskService.get(input.taskId);
      if (!task) throw new Error(`task not found: ${input.taskId}`);
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
        this.opts.registry.selectFor(task.requestedArtifactType)?.registration.id;
      if (!capabilityId) {
        throw new Error('no available capability for revise');
      }
      const adapter = this.opts.registry.get(capabilityId);
      if (!adapter || adapter.registration.availability !== 'available') {
        throw new Error('selected capability is not available');
      }
      const job = await this.createQueuedJob(task.id, capabilityId, {
        targetArtifactId: artifact.id,
        revisionRequest: request,
      });
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
    const state = deriveTaskState(jobs);
    const last = latestJob(jobs);
    const artifacts = await this.opts.artifactCommitter.listByTask(task.id);
    const revising = !!(last && last.revisionRequest && (last.status === 'queued' || last.status === 'running'));
    const output: GetTaskOutput = {
      task,
      state,
      userFacingLabel: userFacingLabelFromLatestJob(jobs, { revising }),
      artifactIds: artifacts.map((a) => a.id),
    };
    if (last) {
      const latestJobOut: NonNullable<GetTaskOutput['latestJob']> = {
        jobId: last.id,
        status: last.status,
        createdAt: last.createdAt,
      };
      if (last.startedAt) latestJobOut.startedAt = last.startedAt;
      // 仅非终态可附带说明性进度;终态禁止拼接内部 phase 文案。
      if (
        (last.status === 'queued' || last.status === 'running') &&
        last.progress?.note !== undefined
      ) {
        latestJobOut.progressNote = last.progress.note;
      }
      if (last.status === 'failed' && last.failure?.actionable) {
        latestJobOut.actionable = last.failure.actionable;
        latestJobOut.progressNote = last.failure.actionable;
      }
      output.latestJob = latestJobOut;
    }
    return output;
  }

  async listTasks(input: { limit?: number } = {}): Promise<CommandMap['work.listTasks']['output']> {
    const tasks = await this.opts.taskService.list(input.limit);
    const result = [];
    for (const task of tasks) {
      const jobs = await this.opts.jobStore.listByTask(task.id);
      const last = latestJob(jobs);
      const revising = !!(
        last?.revisionRequest &&
        (last.status === 'queued' || last.status === 'running')
      );
      result.push({
        taskId: task.id,
        goal: task.goal,
        state: deriveTaskState(jobs),
        userFacingLabel: userFacingLabelFromLatestJob(jobs, { revising }),
      });
    }
    return { tasks: result };
  }

  /** 启动扫描:按封闭 RecoveryAction 落地,不临时扩展状态。 */
  async recoverOnStartup(): Promise<{
    actions: Array<{ jobId: string; action: string }>;
  }> {
    const actions: Array<{ jobId: string; action: string }> = [];
    const jobs = await this.opts.jobStore.list();
    for (const job of jobs) {
      const artifactExists = await this.opts.artifactCommitter.existsForJob(job.id);

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
    meta?: { targetArtifactId?: string; revisionRequest?: string },
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
    };
    await this.opts.jobStore.put(job);
    this.publishJob(job);
    return job;
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
      const fullContext =
        (await this.opts.loadSubjectContext?.()) ?? emptySubjectContext(this.opts.subjectId);
      const selectedRaw = this.opts.selectSubjectContext
        ? await this.opts.selectSubjectContext({
            goal: task.goal,
            requestedArtifactType: task.requestedArtifactType,
            confirmed: fullContext,
          })
        : fullContext;
      const selection = normalizeSelection(this.opts.subjectId, selectedRaw, fullContext);
      const subjectContext = selection.subjectContext;
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
        targetArtifactId: job.targetArtifactId,
      };

      let revisionInput: {
        request: string;
        previousText: string;
        artifactId: string;
      } | undefined;
      if (jobMeta.targetArtifactId && jobMeta.revisionRequest) {
        const target = await this.opts.artifactCommitter.get(jobMeta.targetArtifactId);
        if (!target) {
          await this.failJob(job, 'capability', '成果不存在', '请重新打开任务后再试');
          return;
        }
        const head = target.versions.find((v) => v.versionId === target.headVersionId);
        if (!head || head.content.kind !== 'text') {
          await this.failJob(job, 'capability', '当前成果无法修改', '仅支持文本成果修改');
          return;
        }
        if (!this.opts.readExtractedText) {
          await this.failJob(job, 'capability', '无法读取当前成果', '请重试');
          return;
        }
        const previousText = await this.opts.readExtractedText(head.content.ref);
        revisionInput = {
          request: jobMeta.revisionRequest,
          previousText,
          artifactId: target.id,
        };
        job = await this.withProgress(job, 'capability', '正在修改');
        await this.persistJob(job);
      }

      const isRemote =
        adapter.registration.location === 'remote' &&
        adapter.registration.adapter.type === 'remote-subject';

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
      };

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
                actionable: '远端成果未通过验证,未写入正式成果',
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
    const next = transitionJob(current, 'cancelled', nowIso());
    // cancelled 不产生 Artifact
    delete next.artifactId;
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
