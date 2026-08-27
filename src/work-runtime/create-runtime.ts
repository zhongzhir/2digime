import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import { ContentStore } from '../infrastructure/content-store';
import { CapabilityRegistry } from '../capability/registry';
import { createFakeDocumentAdapter, type FakeDocumentAdapterOptions } from '../capability/adapters/fake-document';
import { createOpenAiCompatibleAdapterStub } from '../capability/adapters/openai-compatible';
import { createDeterministicCodeAnalysisAdapter } from '../capability/adapters/deterministic-code-analysis';
import type { Task } from './task';
import type { ExecutionJob } from './execution-job';
import type { ContextSnapshot } from './context-snapshot';
import type { Artifact } from './artifact';
import { TaskService } from './task-service';
import { JobStore } from './job-store';
import { ContextSnapshotBuilder } from './snapshot-builder';
import { ArtifactCommitter } from './artifact-commit';
import { InMemoryEventBus } from './event-bus';
import { WorkRuntime, type WorkRuntimeOptions } from './job-runner';

export interface CreateWorkRuntimeOptions {
  rootDir: string;
  subjectId: string;
  fakeAdapter?: FakeDocumentAdapterOptions;
  /** 默认注册 Fake + openai stub。 */
  registerOpenAiStub?: boolean;
  /** 默认注册 P2.1 确定性代码分析 Adapter(工程验证)。 */
  registerDeterministicCodeAnalysis?: boolean;
  loadSubjectContext?: WorkRuntimeOptions['loadSubjectContext'];
  selectSubjectContext?: WorkRuntimeOptions['selectSubjectContext'];
  loadSubjectPreferenceCandidates?: WorkRuntimeOptions['loadSubjectPreferenceCandidates'];
  resolveContextRelevance?: WorkRuntimeOptions['resolveContextRelevance'];
  secrets?: WorkRuntimeOptions['secrets'];
}

/**
 * 装配首切片 Work Runtime(纯 Node,无 Electron)。
 */
export function createWorkRuntime(options: CreateWorkRuntimeOptions): WorkRuntime {
  const root = options.rootDir;
  const taskStore = new JsonObjectStore<Task>({ dir: path.join(root, 'tasks') });
  const jobStoreRaw = new JsonObjectStore<ExecutionJob>({ dir: path.join(root, 'jobs') });
  const snapshotStore = new JsonObjectStore<ContextSnapshot>({
    dir: path.join(root, 'snapshots'),
  });
  const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
  const contentStore = new ContentStore(path.join(root, 'content'));

  const registry = new CapabilityRegistry();
  registry.register(createFakeDocumentAdapter(options.fakeAdapter));
  if (options.registerOpenAiStub !== false) {
    registry.register(createOpenAiCompatibleAdapterStub());
  }
  if (options.registerDeterministicCodeAnalysis !== false) {
    registry.register(createDeterministicCodeAnalysisAdapter());
  }

  const eventBus = new InMemoryEventBus();
  const runtime = new WorkRuntime({
    subjectId: options.subjectId,
    taskService: new TaskService(taskStore),
    jobStore: new JobStore(jobStoreRaw),
    snapshotBuilder: new ContextSnapshotBuilder(snapshotStore, contentStore),
    artifactCommitter: new ArtifactCommitter(
      artifactStore,
      contentStore,
      path.join(root, 'artifact-files'),
    ),
    registry,
    eventBus,
    workRoot: path.join(root, 'work'),
    readExtractedText: async (ref: string) => {
      const bytes = await contentStore.readBytes(ref);
      return bytes.toString('utf8');
    },
    ...(options.loadSubjectContext ? { loadSubjectContext: options.loadSubjectContext } : {}),
    ...(options.selectSubjectContext ? { selectSubjectContext: options.selectSubjectContext } : {}),
    ...(options.loadSubjectPreferenceCandidates
      ? { loadSubjectPreferenceCandidates: options.loadSubjectPreferenceCandidates }
      : {}),
    ...(options.resolveContextRelevance
      ? { resolveContextRelevance: options.resolveContextRelevance }
      : {}),
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });
  return runtime;
}
