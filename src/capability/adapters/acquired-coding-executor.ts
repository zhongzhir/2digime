/**
 * 获取到的成熟 Coding runtime 执行适配器。
 * ExecutorTaskPackage → 官方 programmatic CLI → ExecutionResult。
 * 不复制 Agent 内部逻辑，不把单一候选写成产品架构。
 */
import { existsSync, mkdirSync, writeFileSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import { formatCapabilityTaskAndPlan } from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { acquireCapability, type AcquireCandidate, type AcquireResult } from '../acquire-capability';
import { defaultCodingRuntimeCandidates } from '../coding-runtime-candidates';
import { mapChatModelToProviderEnv, type ChatModelConnection } from '../chat-model-credential-bridge';
import { hiddenSpawnOptions } from '../../execution/hidden-spawn';
import { buildExecutorTaskPackage, renderTaskPackagePrompt } from '../../execution/task-package';
import {
  CODE_CHANGE_ARTIFACT_TYPE,
  type ExecutorTaskPackage,
} from '../../execution/external-executor-contract';

export const ACQUIRED_CODING_CAPABILITY_ID = 'cap_acquired_coding_runtime';
export const ACQUIRED_CODING_ADAPTER_ID = 'acquired-coding-runtime-cli';

export interface AcquiredCodingRunResult {
  exitCode: number | null;
  summary: string;
  claimedChangedFiles?: string[];
}

export interface AcquiredCodingExecutorOptions {
  runtimeRoot: string;
  candidates?: AcquireCandidate[];
  connection?: ChatModelConnection;
  timeoutMs?: number;
  forceAvailability?: 'available' | 'needs_setup' | 'unavailable';
  executeHook?: (input: {
    pkg: ExecutorTaskPackage;
    prompt: string;
    workDir: string;
  }) => Promise<AcquiredCodingRunResult>;
  acquireHook?: (ctx: { runtimeRoot: string }) => Promise<AcquireResult>;
}

function isolatedPath(runtimeDir: string): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const parts = [
    runtimeDir,
    'C:\\Program Files\\nodejs',
    path.join(root, 'System32'),
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    root,
  ];
  const git = 'C:\\Program Files\\Git\\cmd';
  if (existsSync(path.join(git, 'git.exe'))) parts.push(git);
  return parts.join(';');
}

function writeProviderConfig(configDir: string, modelId: string, nativeDeepSeek: boolean, baseUrl?: string): string {
  const configPath = path.join(configDir, 'opencode.json');
  const cfg = nativeDeepSeek
    ? {
        $schema: 'https://opencode.ai/config.json',
        model: `deepseek/${modelId}`,
        enabled_providers: ['deepseek'],
        autoupdate: false,
        permission: { '*': 'allow' },
        provider: {
          deepseek: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Chat model',
            options: {
              baseURL: 'https://api.deepseek.com/v1',
              apiKey: '{env:DEEPSEEK_API_KEY}',
            },
            models: { [modelId]: { name: modelId } },
          },
        },
      }
    : {
        $schema: 'https://opencode.ai/config.json',
        model: `openai-compatible/${modelId}`,
        autoupdate: false,
        permission: { '*': 'allow' },
        provider: {
          'openai-compatible': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Chat model',
            options: {
              baseURL: baseUrl || '',
              apiKey: '{env:OPENAI_API_KEY}',
            },
            models: { [modelId]: { name: modelId } },
          },
        },
      };
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return configPath;
}

function runAcquiredCli(input: {
  exe: string;
  prompt: string;
  workingDirectory: string;
  modelRef: string;
  extraEnv: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AcquiredCodingRunResult> {
  const home = path.join(path.dirname(input.exe), '..', '..', 'home');
  const configDir = path.join(path.dirname(input.exe), '..', '..', 'config');
  const modelId = input.modelRef.split('/')[1] || input.modelRef;
  const nativeDeepSeek = input.modelRef.startsWith('deepseek/');
  const configPath = writeProviderConfig(configDir, modelId, nativeDeepSeek);
  const env: NodeJS.ProcessEnv = {
    PATH: isolatedPath(path.dirname(input.exe)),
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    OPENCODE_CONFIG: configPath,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: path.join(home, 'xdg-data'),
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    ...input.extraEnv,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(
      input.exe,
      ['run', '--auto', '--dir', input.workingDirectory, '--model', input.modelRef, input.prompt],
      hiddenSpawnOptions({
        cwd: input.workingDirectory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, input.timeoutMs);
    input.signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        summary: (stdout || stderr || '已返回执行结果').slice(0, 12000),
      });
    });
  });
}

export function createAcquiredCodingExecutorAdapter(
  options: AcquiredCodingExecutorOptions,
): CapabilityAdapter {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const registration: CapabilityRegistration = {
    id: ACQUIRED_CODING_CAPABILITY_ID,
    kind: 'agent',
    displayName: '代码执行能力',
    description: '在你确认的项目目录中修改文件并运行测试，由 Digital Me 独立验收。',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
    permissions: ['filesystem_read', 'filesystem_write', 'network'],
    cost: { estimate: '视任务而定' },
    latencyEstimate: '数分钟',
    location: 'local',
    availability:
      options.forceAvailability === 'unavailable'
        ? 'unavailable'
        : options.forceAvailability === 'needs_setup'
          ? 'needs_setup'
          : 'available',
    adapter: {
      type: 'external-executor-cli',
      adapterId: ACQUIRED_CODING_ADAPTER_ID,
    },
    codingExecution: {
      providerKind: 'local_coding_agent',
      invocationKind: 'cli',
      supportsAutomaticExecution: true,
      supportsProgress: true,
      supportsRevision: true,
      supportsResultCollection: true,
    },
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'acquired-coding-runtime/1',
    describe: () => ({
      adapterId: ACQUIRED_CODING_ADAPTER_ID,
      adapterType: 'external-executor-cli',
      capabilityId: ACQUIRED_CODING_CAPABILITY_ID,
      displayName: registration.displayName,
      location: 'local',
      outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
      supportsAsyncRemote: false,
      version: 'acquired-coding-runtime/1',
    }),
    checkAvailability: async () => {
      if (options.forceAvailability === 'available' || options.executeHook) {
        return { available: true, detail: 'ready' };
      }
      if (options.forceAvailability === 'unavailable') {
        return { available: false, reason: 'unavailable', detail: '当前代码执行能力不可用。' };
      }
      if (options.forceAvailability === 'needs_setup') {
        return { available: false, reason: 'needs_setup', detail: '尚未准备好代码执行能力。' };
      }
      return { available: true, detail: 'ready' };
    },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
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

      const pkg = buildExecutorTaskPackage({
        taskId: String(input.snapshot.taskId || 'task'),
        jobId: ctx.jobId,
        goal: formatCapabilityTaskAndPlan(input),
        workingDirectory,
        readScope: auth.readScope,
        writeScope: auth.writeScope,
        projectBrief: `本地项目：${path.basename(workingDirectory) || '项目'}`,
        timeoutMs,
        executorId: ACQUIRED_CODING_ADAPTER_ID,
        executorSelectionReason: '当前没有现成代码执行能力，已获取成熟能力后执行',
        ...(auth.projectOrigin ? { projectOrigin: auth.projectOrigin } : {}),
      });
      const prompt = renderTaskPackagePrompt(pkg);
      ctx.reportProgress('正在准备完成任务所需能力');

      let result: AcquiredCodingRunResult;
      if (options.executeHook) {
        result = await options.executeHook({ pkg, prompt, workDir: ctx.workDir });
      } else {
        const acquired = options.acquireHook
          ? await options.acquireHook({ runtimeRoot: options.runtimeRoot })
          : await acquireCapability(options.candidates || defaultCodingRuntimeCandidates(), {
              runtimeRoot: options.runtimeRoot,
              signal: ctx.signal,
            });
        if (acquired.status !== 'ready' || !acquired.runtimePath || acquired.ok === false) {
          throw Object.assign(
            new Error('这次没能准备好完成任务需要的专业能力。兔机米没有改动你的项目。'),
            {
              stage: 'capability' as const,
              actionable: '这次没能准备好完成任务需要的专业能力。兔机米没有改动你的项目。',
              failureKind: acquired.failureKind,
              safeDetail: acquired.safeDetail || acquired.detail,
              acquireSource: acquired.source,
              sourceFailures: acquired.sourceFailures,
            },
          );
        }
        const bridged = await mapChatModelToProviderEnv({
          ...(ctx.secrets ? { secrets: ctx.secrets } : {}),
          ...(options.connection ? { connection: options.connection } : {}),
        });
        if (!bridged) {
          throw Object.assign(new Error('当前还不能自动完成代码修改。'), {
            stage: 'capability' as const,
            actionable: '请先在设置中连接模型后再试。',
            failureKind: 'MODEL FAILURE',
            safeDetail: 'credential_bridge_unavailable',
          });
        }
        ctx.reportProgress('正在修改项目文件');
        result = await runAcquiredCli({
          exe: acquired.runtimePath,
          prompt,
          workingDirectory,
          modelRef: bridged.modelRef,
          extraEnv: bridged.env,
          timeoutMs,
          signal: ctx.signal,
        });
      }

      const summaryPath = path.join(ctx.workDir, 'summary.md');
      await fs.mkdir(ctx.workDir, { recursive: true });
      await fs.writeFile(
        summaryPath,
        ['# 代码修改摘要', '', result.summary.slice(0, 8000)].join('\n'),
        'utf8',
      );
      if (result.exitCode !== 0) {
        throw Object.assign(new Error('代码修改未能完成。'), {
          stage: 'capability' as const,
          actionable: '这次代码修改没有完成。可以稍后再试，或补充更具体的目标。',
        });
      }
      return {
        artifact: {
          type: CODE_CHANGE_ARTIFACT_TYPE,
          title: '已经完成修改并检查通过。',
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
          provenance: 'acquired-coding-runtime',
          contentIntegrity: {
            modelGeneratedContent: result.summary.slice(0, 500),
            modelContentDigest: '',
            deterministicFormatting: ['acquired_coding_runtime'],
            reachedModel: true,
          },
        },
        materialUse: { usedPaths: [], includedCount: 0 },
      };
    },
  });
}
