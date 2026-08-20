/**
 * TRIAL-SURFACE-01B — 无专用代码执行器时用已连接模型完成改文件（定向单测，hook 不真打付费 API）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createExternalExecutorModelApiAdapter } from '../../capability/adapters/external-executor-model-api';
import { EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID } from '../../execution/external-executor-contract';
import { isCodingJob } from '../../work-runtime/job-runner';
import { selectPreferredCodingCapability, type CodingCapabilityStatus } from '../../capability/coding-capability';
import { EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID } from '../../execution/external-executor-contract';

function status(partial: Partial<CodingCapabilityStatus> & Pick<CodingCapabilityStatus, 'capabilityId' | 'displayName' | 'availability' | 'invocationKind'>): CodingCapabilityStatus {
  return {
    providerKind: 'local_coding_agent',
    connectionStatus: partial.availability,
    supportsAutomaticExecution: true,
    supportsProgress: true,
    supportsRevision: true,
    supportsResultCollection: true,
    actionableMessage: '',
    canDo: '改代码',
    executionModeLabel: '自动执行',
    ...partial,
  };
}

describe('trial-surface-01b-model-api', () => {
  it('专用执行器 ready 时选专用，不选模型运输', () => {
    const codex = status({
      capabilityId: 'cap_external_executor_codex',
      displayName: '代码执行能力',
      availability: 'ready',
      invocationKind: 'cli',
    });
    const modelApi = status({
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
      displayName: '已连接的模型',
      availability: 'ready',
      invocationKind: 'api',
    });
    const preferred = selectPreferredCodingCapability([modelApi, codex]);
    assert.equal(preferred?.capabilityId, codex.capabilityId);
  });

  it('无专用执行器但有模型 → 选模型运输', () => {
    const modelApi = status({
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
      displayName: '已连接的模型',
      availability: 'ready',
      invocationKind: 'api',
    });
    const preferred = selectPreferredCodingCapability([modelApi]);
    assert.equal(preferred?.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
  });

  it('都无 → 无 ready 候选', () => {
    const unavail = status({
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
      displayName: '已连接的模型',
      availability: 'needs_setup',
      invocationKind: 'api',
    });
    assert.equal(selectPreferredCodingCapability([unavail]), null);
  });

  it('adapter.execute：写授权范围内文件并产出 code-change（非 document），越权路径失败', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-write-'));
    await fs.writeFile(path.join(dir, 'index.js'), 'export const n = 1;\n', 'utf8');

    const adapter = createExternalExecutorModelApiAdapter({
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test',
      chatCompleteHook: async () => ({ text: JSON.stringify({ summary: 'ok', edits: [{ path: 'index.js', content: 'export const n = 2;\n' }] }) }),
      readScopeFilesHook: async () => [{ rel: 'index.js', content: 'export const n = 1;\n' }],
    });

    const workDir = path.join(dir, 'job-evidence');
    await fs.mkdir(workDir, { recursive: true });
    const input: any = {
      goal: '将 index.js 中 n 改为 2',
      snapshot: {
        id: 'snap-1',
        taskId: 'task-1',
        createdAt: new Date().toISOString(),
        items: [{ sourcePath: path.join(dir, 'index.js'), kind: 'folder-entry' }],
      },
      subjectContext: { entries: [] },
      artifactType: 'code-change',
      executionAuthorization: {
        confirmed: true,
        workingDirectory: dir,
        readScope: ['.'],
        writeScope: ['.'],
      },
    };
    const controller = new AbortController();
    const ctx: any = {
      jobId: 'job-1',
      reportProgress: () => {},
      signal: controller.signal,
      secrets: { get: async () => 'test-key' },
      workDir,
      readExtractedText: async () => '',
      updateExternalExecution: () => {},
    };

    const out = await adapter.execute(input, ctx);
    assert.equal(out.artifact.type, 'code-change');
    const written = await fs.readFile(path.join(dir, 'index.js'), 'utf8');
    assert.match(written, /n = 2/);

    // 越权路径 → 失败，不写授权外文件
    const evilAdapter = createExternalExecutorModelApiAdapter({
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test',
      chatCompleteHook: async () => ({ text: JSON.stringify({ summary: 'x', edits: [{ path: '../evil.js', content: 'x' }] }) }),
      readScopeFilesHook: async () => [],
    });
    const evilOutDir = path.join(dir, 'evil-evidence');
    await fs.mkdir(evilOutDir, { recursive: true });
    await assert.rejects(
      evilAdapter.execute(input, { ...ctx, workDir: evilOutDir }),
      /越权路径被拒绝/,
    );
    const evilTarget = path.resolve(dir, '..', 'evil.js');
    assert.equal(
      await fs.access(evilTarget).then(() => true).catch(() => false),
      false,
      '授权目录外文件不得被写入',
    );
  });

  it('adapter.execute：writeScope 外路径先全部拒绝，不写入范围内文件', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-scope-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'ok.js'), 'export const a = 1;\n', 'utf8');
    await fs.writeFile(path.join(dir, 'outside.js'), 'export const b = 1;\n', 'utf8');

    const adapter = createExternalExecutorModelApiAdapter({
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test',
      chatCompleteHook: async () => ({
        text: JSON.stringify({
          summary: 'x',
          edits: [
            { path: 'src/ok.js', content: 'export const a = 2;\n' },
            { path: 'outside.js', content: 'export const b = 2;\n' },
          ],
        }),
      }),
      readScopeFilesHook: async () => [{ rel: 'src/ok.js', content: 'export const a = 1;\n' }],
    });
    const workDir = path.join(dir, 'job-evidence');
    await fs.mkdir(workDir, { recursive: true });
    await assert.rejects(
      adapter.execute(
        {
          goal: '改 src',
          snapshot: {
            id: 'snap-scope',
            taskId: 'task-scope',
            createdAt: new Date().toISOString(),
            items: [{ sourcePath: dir, kind: 'folder-entry' }],
          },
          subjectContext: { entries: [] },
          artifactType: 'code-change',
          executionAuthorization: {
            confirmed: true,
            workingDirectory: dir,
            readScope: ['src'],
            writeScope: ['src'],
          },
        } as any,
        {
          jobId: 'job-scope',
          reportProgress: () => {},
          signal: new AbortController().signal,
          secrets: { get: async () => 'test-key' },
          workDir,
          readExtractedText: async () => '',
          updateExternalExecution: () => {},
        } as any,
      ),
      /越权路径被拒绝/,
    );
    assert.equal(await fs.readFile(path.join(dir, 'src', 'ok.js'), 'utf8'), 'export const a = 1;\n');
    assert.equal(await fs.readFile(path.join(dir, 'outside.js'), 'utf8'), 'export const b = 1;\n');
  });

  it('runtime：无专用 + 有模型 → 恰好 1 个 coding Job，产出 code-change', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-runtime-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x","private":true}\n', 'utf8');
    await fs.writeFile(path.join(dir, 'index.js'), 'export const n = 1;\n', 'utf8');
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-pkg-'));

    const rt = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'none',
      externalExecutorCapability: false,
      secrets: { get: async () => 'test-key' },
      converseChat: async () => ({
        text: JSON.stringify({
          intent: 'add_goal_info',
          confidence: 0.95,
          reply: '已整理规划，确认后开始。',
          planUpdate:
            '目标：将 index.js 中 n 改为 2\n交付：修改 n 的值为 2\n路径：用户选定的项目目录\n准备：项目文件夹\n边界：不推送、不修改范围外文件',
        }),
      }),
      modelApiCapability: {
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'test',
        chatCompleteHook: async () => ({
          text: JSON.stringify({ summary: 'ok', edits: [{ path: 'index.js', content: 'export const n = 2;\n' }] }),
        }),
        readScopeFilesHook: async () => [{ rel: 'index.js', content: 'export const n = 1;\n' }],
      },
    });
    await rt.createPackage({ displayName: 'modelapi', targetDir: pkgDir });

    const planned = await rt.converse({
      text: '将 index.js 中 n 改为 2',
      contextRefs: [{ kind: 'folder' as const, path: dir }],
    });
    assert.ok(planned.taskId);
    assert.ok(planned.plan && planned.plan.version != null);

    const submitBase = {
      goal: '将 index.js 中 n 改为 2',
      contextRefs: [{ kind: 'folder' as const, path: dir }],
      existingTaskId: planned.taskId,
      confirmedPlanVersion: planned.plan!.version,
      intentKind: 'modify_code' as const,
      requestedArtifactType: 'code-change',
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
    };
    const preview = await rt.submitTask(submitBase);
    assert.ok(preview.needsExecutionConfirm, '应进入确认卡');

    const started = await rt.submitTask({
      ...submitBase,
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm!.workingDirectory,
        readScope: preview.needsExecutionConfirm!.readScope,
        writeScope: preview.needsExecutionConfirm!.writeScope,
      },
    });
    assert.ok(started.jobId, '应创建 Job');
    const jobs = await rt.workRuntime.listJobsForTask(planned.taskId);
    const codingJobs = jobs.filter((j) => isCodingJob({ capabilityId: j.capabilityId, externalExecution: j.externalExecution }));
    assert.equal(codingJobs.length, 1, '恰好 1 个 coding Job');
    assert.equal(codingJobs[0]?.capabilityId, EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID);
    await rt.stop();
  });

  it('runtime：都无 → needsExecutorSetup，文案指向连接模型，不建成功 Job', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-none-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-modelapi-none-pkg-'));

    const rt = createDigitalMeRuntime({
      documentCapability: 'none',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'none',
      externalExecutorCapability: false,
      converseChat: async () => ({
        text: JSON.stringify({
          intent: 'add_goal_info',
          confidence: 0.95,
          reply: '已整理规划，确认后开始。',
          planUpdate: '目标：修改 formatLabel\n交付：按目标修改\n路径：用户选定的项目目录\n边界：不推送、不修改范围外文件',
        }),
      }),
    });
    await rt.createPackage({ displayName: 'none', targetDir: pkgDir });
    const planned = await rt.converse({
      text: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder' as const, path: dir }],
    });
    assert.ok(planned.taskId);
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder' as const, path: dir }],
      existingTaskId: planned.taskId,
      confirmedPlanVersion: planned.plan!.version,
      intentKind: 'modify_code',
    });
    assert.ok(result.needsExecutorSetup, '应进入 needsExecutorSetup');
    assert.match(String(result.needsExecutorSetup!.message), /连接模型/);
    assert.equal(result.taskId, '');
    const jobs = await rt.workRuntime.listJobsForTask(planned.taskId);
    assert.equal(jobs.length, 0, '不得创建任何 Job');
    await rt.stop();
  });

  it('探测：只装 CLI 类专用执行器即 ready，不依赖「必须先有 Codex」', () => {
    // 专用执行器只用 CLI 运输（非 Codex 专属 id）时即为 ready 候选，且高于模型兜底。
    const cli = status({
      capabilityId: 'cap_external_executor_secondary',
      displayName: '备用执行器',
      availability: 'ready',
      invocationKind: 'cli',
    });
    const modelApi = status({
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
      displayName: '已连接的模型',
      availability: 'ready',
      invocationKind: 'api',
    });
    const preferred = selectPreferredCodingCapability([modelApi, cli]);
    assert.equal(preferred?.capabilityId, cli.capabilityId);
  });

  it('isCodingJob 识别模型兜底运输', () => {
    assert.equal(isCodingJob({ capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID }), true);
    assert.equal(
      isCodingJob({
        externalExecution: {
          executorId: EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
          workingDirectory: '',
          readScope: [],
          writeScope: [],
        },
      }),
      true,
    );
    assert.equal(isCodingJob({ capabilityId: 'cap_fake_document' }), false);
  });
});
