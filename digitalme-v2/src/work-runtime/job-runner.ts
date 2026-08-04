import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CapabilityRegistry } from '../capability/registry';
import type { SecretAccessor } from '../capability/adapter';
import { newId, nowIso } from '../shared/ids';
import type { ConfirmedExperienceView } from '../subject-core/derived-views';
import type { SubjectContextFreeze } from '../subject-core/subject-context-freeze';
import { buildSubjectContextFreeze } from '../subject-core/subject-context-freeze';
import type { CommandMap } from '../runtime/commands';
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
import { deriveTaskState, toUserFacingLabel } from './derive';
import { latestJob } from './derive';

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

    // running:传播 AbortSignal;若不响应,Runner 在 await 返回后最终落 cancelled。
    const controller = this.abortByJob.get(job.id);
    controller?.abort();
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
      userFacingLabel: toUserFacingLabel(state, { revising: revising && state === 'processing' }),
      artifactIds: artifacts.map((a) => a.id),
    };
    if (last) {
      const latestJobOut: NonNullable<GetTaskOutput['latestJob']> = {
        jobId: last.id,
        status: last.status,
      };
      // 仅非终态可附带说明性进度;终态禁止拼接内部 phase 文案。
      if (
        (last.status === 'queued' || last.status === 'running') &&
        last.progress?.note !== undefined
      ) {
        latestJobOut.progressNote = last.progress.note;
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
      result.push({
        taskId: task.id,
        goal: task.goal,
        state: deriveTaskState(jobs),
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

    // 孤儿 Artifact:Job 不存在 → 隔离目录,不改写权威状态机。
    // (Artifact Store 内对象保留;标记隔离说明文件。)
    // 本轮仅扫描与 Job 绑定的幂等 id,额外孤儿由后续运维处理。

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
    if (job.status !== 'queued') return;

    const task = await this.opts.taskService.get(job.taskId);
    if (!task) {
      await this.failJob(job, 'capability', '任务不存在', '请重新提交任务');
      return;
    }

    const controller = new AbortController();
    this.abortByJob.set(jobId, controller);

    try {
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
      const active: ExecutionJob = job;

      // --- context ---
      // 先取已选能力的通用 contextPolicy,由 SnapshotBuilder 执行;Runner 不解释场景。
      const selectedAdapter = this.opts.registry.get(job.capabilityId);
      let snapshot;
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

      if (controller.signal.aborted) {
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
      snapshot = await this.opts.snapshotBuilder.attachSubjectContext(
        snapshot.id,
        `${JSON.stringify(selection.freeze, null, 2)}\n`,
      );
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

      let output;
      try {
        output = await adapter.execute(
          {
            goal: task.goal,
            snapshot,
            subjectContext,
            artifactType: task.requestedArtifactType,
            ...(revisionInput ? { revision: revisionInput } : {}),
          },
          {
            jobId: job.id,
            reportProgress: (note) => {
              this.liveProgress.set(jobId, note);
              this.publishJob(
                {
                  id: jobId,
                  taskId: jobMeta.taskId,
                  capabilityId: jobMeta.capabilityId,
                  createdAt: jobMeta.createdAt,
                  status: 'running',
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
          },
        );
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
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

      if (controller.signal.aborted) {
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
    await this.persistJob(next, message);
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
