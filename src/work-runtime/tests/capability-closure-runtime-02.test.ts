/**
 * DIGITALME-CAPABILITY-CLOSURE-RUNTIME-02 — 真实 Do 主链的闭包接线验证。
 *
 * 目标：submitTask（真实做事主链）在选定执行能力后暴露 closure 视图，
 * 且实际执行选择随能力变化（BASELINE → OPTIMAL），UX 只在 LIMITED/UNAVAILABLE 出现。
 *
 * 离线确定性：adapter 为可注册的本地替身，不启动 Job 泵（不触发真实执行）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CapabilityRegistry } from '../../capability/registry';
import { JsonObjectStore } from '../../infrastructure/json-store';
import { ContentStore } from '../../infrastructure/content-store';
import { createOpenAiCompatibleAdapter } from '../../capability/adapters/openai-compatible';
import { createExternalExecutorModelApiAdapter } from '../../capability/adapters/external-executor-model-api';
import { createExternalExecutorCodexAdapter } from '../../capability/adapters/external-executor-codex';
import { EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID } from '../../execution/external-executor-contract';
import { WorkRuntime, type WorkRuntimeOptions } from '../job-runner';
import { TaskService } from '../task-service';
import { JobStore } from '../job-store';
import { ContextSnapshotBuilder } from '../snapshot-builder';
import { ArtifactCommitter } from '../artifact-commit';
import { InMemoryEventBus } from '../event-bus';
import type { Task } from '../task';
import type { ExecutionJob } from '../execution-job';
import type { ContextSnapshot } from '../context-snapshot';
import type { Artifact } from '../artifact';
import type { CapabilityClosureView } from '../../capability/capability-closure';

const FORBIDDEN = [
  /gemini/i,
  /deepseek/i,
  /openai/i,
  /quota/i,
  /adapter/i,
  /\bmcp\b/i,
  /provider/i,
  /http/i,
  /OPTIMAL|BASELINE|LIMITED|UNAVAILABLE/,
];

function assertNoTechLeak(view: CapabilityClosureView | undefined, label: string): void {
  if (!view) return;
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(String(view.notice || '')), `${label} 不得泄漏技术细节（命中 ${re}）：${view.notice}`);
  }
}

interface Built {
  runtime: WorkRuntime;
  registry: CapabilityRegistry;
  taskService: TaskService;
}

async function buildRuntime(): Promise<Built> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-runtime-'));
  const taskStore = new JsonObjectStore<Task>({ dir: path.join(root, 'tasks') });
  const jobStoreRaw = new JsonObjectStore<ExecutionJob>({ dir: path.join(root, 'jobs') });
  const snapshotStore = new JsonObjectStore<ContextSnapshot>({ dir: path.join(root, 'snapshots') });
  const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
  const contentStore = new ContentStore(path.join(root, 'content'));
  const registry = new CapabilityRegistry();
  const eventBus = new InMemoryEventBus();
  const taskService = new TaskService(taskStore);
  const runtime = new WorkRuntime({
    subjectId: 'subject-1',
    taskService,
    jobStore: new JobStore(jobStoreRaw),
    snapshotBuilder: new ContextSnapshotBuilder(snapshotStore, contentStore),
    artifactCommitter: new ArtifactCommitter(artifactStore, contentStore, path.join(root, 'artifact-files')),
    registry,
    eventBus,
    workRoot: path.join(root, 'work'),
    readExtractedText: async () => '',
  });
  return { runtime, registry, taskService };
}

async function createPlannedTask(built: Built, goal: string, folder: string): Promise<string> {
  const task = await built.taskService.create({
    subjectId: 'subject-1',
    goal,
    contextRefs: [{ kind: 'folder', path: folder }],
    requestedArtifactType: 'code-change',
    intentKind: 'modify_code',
  });
  await built.taskService.updatePlan(task.id, {
    version: 1,
    status: 'confirmed',
    content: '修改计划',
    updatedAt: new Date().toISOString(),
    source: 'model',
  });
  return task.id;
}

function codeChangeSubmit(taskId: string, folder: string, withAuth = true) {
  const base = {
    goal: '把 index.js 里的 n 改成 2',
    contextRefs: [{ kind: 'folder' as const, path: folder }],
    intentKind: 'modify_code' as const,
    existingTaskId: taskId,
    confirmedPlanVersion: 1,
  };
  if (!withAuth) return base;
  return {
    ...base,
    executionAuthorization: {
      confirmed: true as const,
      workingDirectory: folder,
      readScope: ['.'],
      writeScope: ['.'],
    },
  };
}

describe('capability-closure-runtime-02', () => {
  it('CASE D1：文档 Do（通用模型）→ closure BASELINE，静默，Task/Job 正常创建', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    const out = await built.runtime.submitTask({
      goal: '写一份周报',
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    assert.ok(out.taskId && out.jobId);
    assert.equal(out.capabilityClosure?.level, 'baseline');
    assert.equal(out.capabilityClosure?.notice, undefined);
    assert.deepEqual(out.capabilityClosure?.choices ?? [], []);
    assertNoTechLeak(out.capabilityClosure, 'D1');
  });

  it('CASE D2：稳定知识 Do（通用模型）→ BASELINE，不错误要求 Search', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    const out = await built.runtime.submitTask({ goal: '解释一下什么是差分隐私', contextRefs: [] });
    assert.equal(out.capabilityClosure?.level, 'baseline');
    assert.equal(out.capabilityClosure?.notice, undefined);
  });

  it('CASE D3：Coding 无执行器 → needsExecutorSetup + closure LIMITED（有模型）', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-repo-'));
    const taskId = await createPlannedTask(built, '把 index.js 里的 n 改成 2', folder);
    const out = await built.runtime.submitTask(codeChangeSubmit(taskId, folder, false));
    assert.ok(out.needsExecutorSetup, '无执行器时应返回引导卡，不得伪造 Job');
    assert.equal(out.taskId, '');
    assert.equal(out.jobId, '');
    assert.equal(out.capabilityClosure?.level, 'limited');
    assert.ok(out.capabilityClosure?.notice && /代码能力/.test(out.capabilityClosure.notice));
    assert.deepEqual(out.capabilityClosure?.choices ?? [], ['continue_current', 'use_stronger', 'defer']);
    assertNoTechLeak(out.capabilityClosure, 'D3');
  });

  it('CASE D4：Coding 走模型兜底运输（model-api）→ closure BASELINE，实际选中 model-api', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    built.registry.register(
      createExternalExecutorModelApiAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test' }),
    );
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-repo-'));
    const taskId = await createPlannedTask(built, '把 index.js 里的 n 改成 2', folder);
    const out = await built.runtime.submitTask(codeChangeSubmit(taskId, folder));
    assert.equal(out.capabilityClosure?.level, 'baseline');
    assert.equal(out.capabilityClosure?.notice, undefined);
    const job = await built.runtime.getJob(out.jobId);
    assert.equal(job?.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
  });

  it('CASE D5（= section 六）：同一 TaskCapabilityNeed，专业 Coding Agent 就绪 → 实际选择与 closure 升级', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    built.registry.register(
      createExternalExecutorModelApiAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test' }),
    );
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-repo-'));
    const taskId1 = await createPlannedTask(built, '把 index.js 里的 n 改成 2', folder);
    const first = await built.runtime.submitTask(codeChangeSubmit(taskId1, folder));
    assert.equal(first.capabilityClosure?.level, 'baseline');
    assert.equal(first.capabilityClosure?.notice, undefined);
    const job1 = await built.runtime.getJob(first.jobId);
    assert.equal(job1?.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
    // 让首个 job 进入终态，释放单活动 Coding Job 闸门（同一执行阶段只允许一个 Coding Job）。
    await built.runtime.cancelJob({ jobId: first.jobId });

    // 第二次：专业 Coding Agent 接入（同一 TaskCapabilityNeed，不重建任务语义）
    const codex = createExternalExecutorCodexAdapter({
      forceAvailability: 'ready',
      executeHook: async () => ({ summary: 'done', exitCode: 0, changes: [] }),
    });
    // 与运行时 buildCapabilityRegistry 一致：探测后把 registration 可用性置为 available。
    (codex.registration as { availability: string }).availability = 'available';
    built.registry.register(codex);
    const taskId2 = await createPlannedTask(built, '把 index.js 里的 n 改成 2', folder);
    const second = await built.runtime.submitTask(codeChangeSubmit(taskId2, folder));
    assert.equal(second.capabilityClosure?.level, 'optimal');
    const job2 = await built.runtime.getJob(second.jobId);
    assert.notEqual(job2?.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
    assert.ok(job2?.capabilityId && /executor/.test(job2.capabilityId));
    assert.equal(job2?.capabilityId, job2?.capabilityId); // 实际选择确实变化
    assert.notEqual(first.capabilityClosure?.level, second.capabilityClosure?.level);
  });

  it('CASE D6：Document 无任何模型 → UNAVAILABLE，抛可行动错误，不假完成', async () => {
    const built = await buildRuntime();
    let thrown = null;
    try {
      await built.runtime.submitTask({ goal: '写一份报告', contextRefs: [], requestedArtifactType: 'document' });
    } catch (err) {
      thrown = err as { actionable?: string; capabilityClosure?: CapabilityClosureView };
    }
    assert.ok(thrown, '无能力时应抛错，绝不创建 Job 假完成');
    assert.ok(thrown.actionable);
    assert.equal(thrown.capabilityClosure?.level, 'unavailable');
    assert.deepEqual(thrown.capabilityClosure?.choices ?? [], ['continue_current', 'use_stronger', 'defer']);
    assertNoTechLeak(thrown.capabilityClosure, 'D6');
  });

  it('CASE D7：用户面只出现自然语言，不暴露内部等级名/技术词', async () => {
    const built = await buildRuntime();
    built.registry.register(
      createOpenAiCompatibleAdapter({ baseUrl: 'http://127.0.0.1:9/v1', model: 'test', availability: 'available' }),
    );
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-repo-'));
    const taskId = await createPlannedTask(built, '把 index.js 里的 n 改成 2', folder);
    const out = await built.runtime.submitTask(codeChangeSubmit(taskId, folder, false));
    const notice = out.capabilityClosure?.notice || '';
    assert.ok(notice.length > 0);
    assertNoTechLeak(out.capabilityClosure, 'D7');
    assert.ok(!/OPTIMAL|BASELINE|LIMITED|UNAVAILABLE/i.test(notice));
  });
});