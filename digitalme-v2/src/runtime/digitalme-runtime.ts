import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import { ContentStore } from '../infrastructure/content-store';
import { CapabilityRegistry } from '../capability/registry';
import {
  createFakeDocumentAdapter,
  type FakeDocumentAdapterOptions,
} from '../capability/adapters/fake-document';
import { createOpenAiCompatibleAdapterStub } from '../capability/adapters/openai-compatible';
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
import { SubjectService } from '../subject-core/subject-service';
import { selectConfirmedExperiences } from '../subject-core/experience-selector';
import { ArtifactWorkspace } from '../artifact-workspace/workspace';
import type { CommandMap } from '../runtime/commands';
import type { GrowthEvent } from '../subject-core/growth-event';
import { nowIso, newId } from '../shared/ids';

export interface DigitalMeRuntimeOptions {
  fakeAdapter?: FakeDocumentAdapterOptions;
  registerOpenAiStub?: boolean;
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
  private readonly options: DigitalMeRuntimeOptions;

  constructor(options: DigitalMeRuntimeOptions = {}) {
    this.options = options;
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
    return result;
  }

  getOverview(input: CommandMap['subject.getOverview']['input'] = {}) {
    return this.subject.getOverview(input);
  }

  confirmExperience(input: CommandMap['subject.confirmExperience']['input']) {
    return this.subject.confirmExperience(input);
  }

  submitTask(input: CommandMap['work.submitTask']['input']) {
    return this.requireWork().submitTask(input);
  }

  retryTask(input: CommandMap['work.retryTask']['input']) {
    return this.requireWork().retryTask(input);
  }

  cancelJob(input: CommandMap['work.cancelJob']['input']) {
    return this.requireWork().cancelJob(input);
  }

  getTask(input: CommandMap['work.getTask']['input']) {
    return this.requireWork().getTask(input);
  }

  listTasks(input: CommandMap['work.listTasks']['input'] = {}) {
    return this.requireWork().listTasks(input);
  }

  getJob(jobId: string) {
    return this.requireWork().getJob(jobId);
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

  /** 测试/运维:直接追加边界等事件(仍走 GrowthEvent,不手改视图)。 */
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

    const registry = new CapabilityRegistry();
    registry.register(createFakeDocumentAdapter(this.options.fakeAdapter));
    if (this.options.registerOpenAiStub !== false) {
      registry.register(createOpenAiCompatibleAdapterStub());
    }

    const subjectService = this.subject;
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
      loadSubjectContext: async () => {
        const derived = await subjectService.getDerived();
        return derived.confirmed;
      },
      selectSubjectContext: async ({ goal, requestedArtifactType, confirmed }) => {
        const derived = await subjectService.getDerived();
        return selectConfirmedExperiences({
          goal,
          requestedArtifactType,
          confirmed,
          boundaries: derived.boundaries,
        });
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
