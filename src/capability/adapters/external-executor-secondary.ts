/**
 * MULTI-AGENT-ROUTE-01 — 第二成熟 Agent 执行适配器（备用代码执行能力）。
 *
 * 与主代码执行能力共享 ExecutorTaskPackage / ExecutorRunResult / Job。
 * CLI hook 路径保留给单测；真实第二 Agent 走 HTTP connector（connector 层）。
 * 默认不注册；仅测试 / gate / 显式 secondaryExecutorCapability options 才注册。
 */
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import { formatCapabilityTaskAndPlan } from '../adapter';
import type { AdapterType, CapabilityRegistration } from '../registration';
import { newId, nowIso } from '../../shared/ids';
import {
  CODE_CHANGE_ARTIFACT_TYPE,
  type ExecutorRunResult,
  type ExecutorTaskPackage,
} from '../../execution/external-executor-contract';
import {
  buildExecutorTaskPackage,
  renderTaskPackagePrompt,
} from '../../execution/task-package';
import { captureExecutionBaseline, computeScopeDigest } from '../../execution/baseline';
import {
  collectExecutionChanges,
  markConcurrentIfNeeded,
} from '../../execution/run-collector';
import { verifyExternalExecution } from '../../execution/execution-verifier';
import { writeCodeChangeBundle } from '../../execution/bundle-writer';
import {
  EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_SECONDARY_ADAPTER_ID,
  EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID,
} from '../coding-agent-route';
import {
  probeOpenCodeHttpHealth,
  runOpenCodeHttpCoding,
  type OpenCodeHttpConnectorOptions,
} from '../connectors/opencode-http';

export interface SecondaryExecutorRunResult {
  exitCode: number | null;
  summary: string;
  claimedChangedFiles?: string[];
}

export interface SecondaryHttpConnectorOptions {
  baseUrl: string;
  username?: string;
  password: string;
  /** 仅内部运行配置，不得进入 Agent identity / 用户面 */
  internalModel: string;
  timeoutMs?: number;
}

export interface SecondaryExecutorOptions {
  /** 默认探测的第二厂商命令（可选；本块仅预留）。 */
  command?: string[];
  /** 测试注入：跳过真实 spawn。 */
  executeHook?: (input: {
    goal: string;
    workingDirectory: string;
    prompt: string;
  }) => Promise<SecondaryExecutorRunResult>;
  /** 真实 HTTP 运输。不得用 CLI `run` 包装。 */
  http?: SecondaryHttpConnectorOptions;
  /** 测试注入统一可用性。 */
  forceAvailability?: 'available' | 'unavailable' | 'needs_setup';
}

function usesHttp(options: SecondaryExecutorOptions): boolean {
  return Boolean(options.http?.baseUrl && options.http.password && options.http.internalModel);
}

function adapterTypeOf(options: SecondaryExecutorOptions): AdapterType {
  return usesHttp(options) && !options.executeHook ? 'external-executor-http' : 'external-executor-cli';
}

function adapterIdOf(options: SecondaryExecutorOptions): string {
  return adapterTypeOf(options) === 'external-executor-http'
    ? EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID
    : EXTERNAL_EXECUTOR_SECONDARY_ADAPTER_ID;
}

export function createExternalExecutorSecondaryAdapter(
  options: SecondaryExecutorOptions = {},
): CapabilityAdapter {
  const availability: CapabilityRegistration['availability'] =
    options.forceAvailability === 'available'
      ? 'available'
      : options.forceAvailability === 'unavailable'
        ? 'unavailable'
        : 'needs_setup';
  const type = adapterTypeOf(options);
  const adapterId = adapterIdOf(options);
  const registration: CapabilityRegistration = {
    id: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
    kind: 'agent',
    displayName: '备用代码执行能力',
    description: '已连接的备用代码执行能力，可在常用代码执行能力暂不可用时按需使用。',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
    permissions: ['filesystem_read', 'filesystem_write'],
    cost: { estimate: '视任务而定' },
    latencyEstimate: '数分钟',
    location: 'local',
    availability,
    adapter: {
      type,
      adapterId,
    },
    codingExecution: {
      providerKind: 'local_coding_agent',
      invocationKind: type === 'external-executor-http' ? 'api' : 'cli',
      supportsAutomaticExecution: true,
      supportsProgress: true,
      supportsRevision: true,
      supportsResultCollection: true,
    },
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'external-executor-secondary/1',
    describe: () => ({
      adapterId,
      adapterType: type,
      capabilityId: EXTERNAL_EXECUTOR_SECONDARY_CAPABILITY_ID,
      displayName: registration.displayName,
      location: 'local',
      outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
      supportsAsyncRemote: false,
      version: 'external-executor-secondary/1',
    }),
    checkAvailability: async () => {
      if (options.forceAvailability === 'available' || options.executeHook) {
        return { available: true, detail: 'ready' };
      }
      if (options.forceAvailability === 'unavailable') {
        return { available: false, reason: 'unreachable', detail: '备用代码执行能力当前不可用。' };
      }
      if (options.http) {
        try {
          const health = await probeOpenCodeHttpHealth(toHttpOptions(options.http));
          if (health.healthy) return { available: true, detail: 'ready' };
        } catch {
          /* fall through */
        }
        return { available: false, reason: 'unreachable', detail: '备用代码执行能力当前不可用。' };
      }
      if (options.command && options.command.length > 0) {
        return { available: false, reason: 'needs_setup', detail: '尚未连接可用的备用代码执行能力。' };
      }
      return { available: false, reason: 'needs_setup', detail: '尚未连接可用的备用代码执行能力。' };
    },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) throw abortError();
      if (options.http && !options.executeHook) {
        return executeViaHttp(input, ctx, options.http);
      }
      if (!options.executeHook) {
        throw Object.assign(
          new Error('备用代码执行能力尚未连接，当前不能由 Digital Me 自动调用。'),
          {
            stage: 'capability' as const,
            actionable: '备用代码执行能力尚未连接，任务未完成。',
          },
        );
      }
      const auth = input.executionAuthorization;
      const folderItem = input.snapshot.items.find(
        (i) => i.kind === 'folder-entry' || i.kind === 'file',
      );
      const workingDirectory =
        auth?.workingDirectory ||
        (folderItem ? path.dirname(folderItem.sourcePath) : '') ||
        '';
      ctx.reportProgress('正在修改项目文件');
      const result = await options.executeHook({
        goal: input.goal,
        workingDirectory,
        prompt: String(input.goal || ''),
      });
      const summary = String(result.summary || '');
      const summaryPath = path.join(ctx.workDir, 'summary.md');
      await fs.mkdir(ctx.workDir, { recursive: true });
      await fs.writeFile(
        summaryPath,
        [
          '# 代码修改摘要（备用执行能力）',
          '',
          `目标：${String(input.goal || '').slice(0, 400)}`,
          '',
          `摘要：${summary.slice(0, 4000)}`,
          '',
          `变更文件：${(result.claimedChangedFiles || []).join('、') || '（无）'}`,
        ].join('\n'),
        'utf8',
      );
      return {
        artifact: {
          type: CODE_CHANGE_ARTIFACT_TYPE,
          title: '代码修改（备用执行能力）',
          payload: {
            kind: 'bundle',
            entries: [
              {
                sourcePath: summaryPath,
                mediaType: 'text/markdown',
                role: 'execution-summary',
              },
            ],
          },
        },
        candidateMeta: {
          provenance: 'external-executor-secondary',
          contentIntegrity: {
            modelGeneratedContent: summary.slice(0, 500),
            modelContentDigest: '',
            deterministicFormatting: ['digitalme_secondary_hook'],
            reachedModel: result.exitCode === 0,
          },
        },
        materialUse: {
          usedPaths: [],
          includedCount: 0,
        },
      };
    },
  });
}

function toHttpOptions(http: SecondaryHttpConnectorOptions): OpenCodeHttpConnectorOptions {
  return {
    baseUrl: http.baseUrl,
    password: http.password,
    internalModel: http.internalModel,
    ...(http.username ? { username: http.username } : {}),
    ...(http.timeoutMs ? { timeoutMs: http.timeoutMs } : {}),
  };
}

async function executeViaHttp(
  input: CapabilityInput,
  ctx: ExecutionContext,
  http: SecondaryHttpConnectorOptions,
): Promise<CapabilityOutput> {
  const auth = input.executionAuthorization;
  const workingDirectory = auth?.workingDirectory || '';
  if (!workingDirectory) {
    throw Object.assign(new Error('未指定可修改的项目目录'), {
      stage: 'capability' as const,
      actionable: '请添加项目文件夹并确认可修改范围后再开始',
    });
  }
  if (!auth?.confirmed) {
    throw Object.assign(new Error('尚未确认文件修改授权'), {
      stage: 'capability' as const,
      actionable: '开始前请确认可访问和修改的范围',
    });
  }

  const evidenceDir = path.join(ctx.workDir, 'external-execution');
  await fs.mkdir(evidenceDir, { recursive: true });

  const decisionBriefs = (input.subjectContext?.entries || [])
    .slice(0, 8)
    .map((it) => `${it.title}: ${it.detail}`.trim())
    .filter(Boolean);

  let pkg: ExecutorTaskPackage = buildExecutorTaskPackage({
    taskId: String(input.snapshot.taskId || 'task'),
    jobId: ctx.jobId,
    goal: formatCapabilityTaskAndPlan(input),
    workingDirectory,
    readScope: auth.readScope,
    writeScope: auth.writeScope,
    projectBrief: `本地项目：${path.basename(workingDirectory) || '项目'}`,
    priorDecisions: decisionBriefs,
    snapshotId: input.snapshot.id,
    materialPaths: (input.snapshot.items || [])
      .map((i) => i.sourcePath)
      .filter(Boolean)
      .slice(0, 40),
    subjectDecisionBriefs: decisionBriefs,
    timeoutMs: http.timeoutMs ?? 600_000,
    executorId: EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID,
    executorSelectionReason: '用户目标需要修改代码仓库文件；已显式选择备用代码执行能力',
    ...(auth.projectOrigin ? { projectOrigin: auth.projectOrigin } : {}),
  });

  ctx.reportProgress('正在读取项目');
  const executorRunId = newId('job');
  ctx.updateExternalExecution?.({ lastExecutorStatus: 'running', executorRunId });
  const baseline = await captureExecutionBaseline({
    workingDirectory: pkg.workingDirectory,
    writeScope: pkg.writeScope,
    readScope: pkg.readScope,
    jobEvidenceDir: evidenceDir,
  });
  const preRunDigest = baseline.scopeDigest;

  ctx.reportProgress('正在理解项目');
  const { buildSoftwareTaskUnderstanding, formatUnderstandingForBrief } = await import(
    '../../execution/software-task-understanding'
  );
  const understanding = await buildSoftwareTaskUnderstanding({
    goal: formatCapabilityTaskAndPlan(input),
    workingDirectory: pkg.workingDirectory,
    subjectDecisionBriefs: decisionBriefs,
  });
  await fs.writeFile(
    path.join(evidenceDir, 'understanding.json'),
    JSON.stringify(understanding, null, 2),
    'utf8',
  );
  const briefParts = [
    formatUnderstandingForBrief(understanding),
    decisionBriefs.length
      ? `已确认偏好与边界：\n${decisionBriefs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : '',
  ].filter(Boolean);
  pkg = {
    ...pkg,
    projectBrief: briefParts.join('\n\n').slice(0, 3500),
    priorDecisions: decisionBriefs.length
      ? decisionBriefs
      : understanding.subjectConstraints.slice(0, 12),
  };
  await fs.writeFile(
    path.join(evidenceDir, 'task-package.json'),
    JSON.stringify(pkg, null, 2),
    'utf8',
  );

  const prompt = renderTaskPackagePrompt(pkg, { understanding });
  await fs.writeFile(path.join(evidenceDir, 'prompt.txt'), prompt, 'utf8');

  const startedAt = nowIso();
  const httpResult = await runOpenCodeHttpCoding(
    {
      pkg,
      prompt,
      evidenceDir,
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    },
    toHttpOptions(http),
  );

  if (ctx.signal.aborted) {
    ctx.updateExternalExecution?.({ lastExecutorStatus: 'cancelled', executorRunId });
    throw abortError();
  }

  ctx.reportProgress('正在整理结果');
  const midDigest = await computeScopeDigest(pkg.workingDirectory, pkg.writeScope);
  let collected = await collectExecutionChanges({
    baseline,
    jobEvidenceDir: evidenceDir,
    includeDirtyVersusHeadWhenUnchanged: true,
  });
  collected = markConcurrentIfNeeded(collected, preRunDigest, midDigest);
  if (midDigest !== collected.afterScopeDigest) {
    collected = { ...collected, concurrentModificationSuspected: true };
  }

  const agentResult: ExecutorRunResult = {
    executorId: EXTERNAL_EXECUTOR_SECONDARY_HTTP_ADAPTER_ID,
    executorRunId,
    startedAt,
    completedAt: nowIso(),
    status: httpResult.exitCode === 0 ? 'succeeded' : 'failed',
    summary: httpResult.summary || '',
    claimedChangedFiles: collected.changedFiles.slice(),
    diffRef: 'patch.diff',
    testCommands: [],
    testResults: [],
    warnings: [],
    unresolvedItems: [],
    questions: [],
    exitCode: httpResult.exitCode,
    workingDirectoryState:
      collected.outOfScopeChanges.length > 0 ? 'out_of_scope_changes' : 'clean_within_scope',
  };

  await fs.writeFile(
    path.join(evidenceDir, 'executor-run.json'),
    JSON.stringify(agentResult, null, 2),
    'utf8',
  );

  ctx.reportProgress('正在运行测试');
  const verification = await verifyExternalExecution({
    taskPackage: pkg,
    agentResult,
    collected,
    jobEvidenceDir: evidenceDir,
  });

  const bundle = await writeCodeChangeBundle({
    outDir: evidenceDir,
    taskPackage: pkg,
    agentResult,
    collected,
    verification,
    understanding,
  });

  if (verification.overall === 'unsatisfied') {
    ctx.updateExternalExecution?.({
      lastExecutorStatus: 'failed',
      executorRunId,
      afterScopeDigest: collected.afterScopeDigest,
    });
    throw Object.assign(new Error('这次修改没有通过检查，不会自动再试。'), {
      stage: 'capability' as const,
      actionable: '这次修改没有通过检查，不会自动再试。',
    });
  }

  ctx.updateExternalExecution?.({
    lastExecutorStatus: 'succeeded',
    executorRunId,
    afterScopeDigest: collected.afterScopeDigest,
  });

  return {
    artifact: {
      type: CODE_CHANGE_ARTIFACT_TYPE,
      title: bundle.title,
      payload: {
        kind: 'bundle',
        entries: bundle.entries,
      },
    },
    candidateMeta: {
      provenance: 'external-executor-secondary',
      contentDigest: collected.afterScopeDigest,
      producedAt: nowIso(),
      contentIntegrity: {
        modelGeneratedContent: agentResult.summary.slice(0, 500),
        modelContentDigest: collected.afterScopeDigest,
        deterministicFormatting: ['digitalme_collect', 'digitalme_verify'],
        reachedModel: true,
      },
    },
  };
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
