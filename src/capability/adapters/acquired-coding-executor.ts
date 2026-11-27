/**
 * 获取到的成熟 Coding runtime 执行适配器。
 * 把 Owner/模型给出的任务说明和授权目录交给官方 CLI。
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
import type { CapabilityRegistration } from '../registration';
import { acquireCapability, type AcquireCandidate, type AcquireResult } from '../acquire-capability';
import {
  defaultCodingRuntimeCandidates,
  probeCachedCodexRuntime,
} from '../coding-runtime-candidates';
import {
  CODEX_ASSET_SHA256,
  CODEX_CANDIDATE_ID,
  CODEX_PINNED_VERSION,
  defaultCodexSources,
} from '../coding-runtime-manifest';
import { mapChatModelToProviderEnv, type ChatModelConnection } from '../chat-model-credential-bridge';
import { startLocalChatModelBridge } from '../chat-model-http-bridge';
import type { ChatCompleteFn } from '../../subject-core/structured-distill';
import { hiddenSpawnOptions } from '../../execution/hidden-spawn';
import { CODE_CHANGE_ARTIFACT_TYPE } from '../../execution/external-executor-contract';

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
    instruction: string;
    workingDirectory: string;
    prompt: string;
    workDir: string;
  }) => Promise<AcquiredCodingRunResult>;
  acquireHook?: (ctx: { runtimeRoot: string }) => Promise<AcquireResult>;
}

export interface AcquiredCodingPreview {
  displayName: string;
  version: string;
  sources: string[];
  expectedSha256: string;
  costNotice: string;
}

function renderAcquiredCodingPrompt(instruction: string, workingDirectory: string): string {
  return [
    instruction,
    '',
    `工作目录：${workingDirectory}`,
    '',
    '机械边界：',
    '- 只能操作授权工作目录内的文件',
    '- 不得读取或泄露 API Key、模型凭证或其它密钥',
    '- 未经用户明确要求不得 git push、发布、部署或其它对外不可逆操作',
  ].join('\n');
}

export function acquiredCodingRuntimeStatus(options: AcquiredCodingExecutorOptions): 'ready' | 'acquirable' {
  if (options.executeHook || options.forceAvailability === 'available') return 'ready';
  if (options.forceAvailability === 'unavailable' || options.forceAvailability === 'needs_setup') {
    return 'acquirable';
  }
  return probeCachedCodexRuntime(options.runtimeRoot) ? 'ready' : 'acquirable';
}

export function acquiredCodingRuntimePreview(
  options: AcquiredCodingExecutorOptions,
): AcquiredCodingPreview | undefined {
  if (acquiredCodingRuntimeStatus(options) !== 'acquirable') return undefined;
  return {
    displayName: '成熟代码执行能力（Windows 工作区保护）',
    version: CODEX_PINNED_VERSION,
    sources: defaultCodexSources().map((source) => source.url),
    expectedSha256: CODEX_ASSET_SHA256,
    costNotice: '运行包下载本身不收费；模型调用沿用兔机米当前已经连接的模型与既有额度。',
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function writeAcquiredCodexProviderConfig(
  codexHome: string,
  modelId: string,
  baseUrl: string,
): string {
  const configPath = path.join(codexHome, 'config.toml');
  const lines = [
    `model = ${tomlString(modelId)}`,
    'model_provider = "2digime"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    '',
    '[model_providers.2digime]',
    'name = "2digime managed model"',
    `base_url = ${tomlString(baseUrl.replace(/\/+$/, ''))}`,
    'env_key = "DIGITALME_MODEL_TOKEN"',
    'wire_api = "responses"',
    'request_max_retries = 1',
    'stream_max_retries = 1',
    'stream_idle_timeout_ms = 180000',
    '',
    '[windows]',
    'sandbox = "unelevated"',
    '',
  ];
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(configPath, lines.join('\n'), 'utf8');
  return configPath;
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

export function writeAcquiredCodingProviderConfig(
  configDir: string,
  modelId: string,
  nativeDeepSeek: boolean,
  baseUrl?: string,
): string {
  const configPath = path.join(configDir, 'opencode.json');
  const executionBoundary = {
    // OpenCode 1.18.x uses the V1 permission object. Deny rules remain in force in --auto mode.
    permission: {
      '*': 'allow',
      external_directory: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      task: 'deny',
    },
  };
  const cfg = nativeDeepSeek
    ? {
        $schema: 'https://opencode.ai/config.json',
        model: `deepseek/${modelId}`,
        enabled_providers: ['deepseek'],
        autoupdate: false,
        ...executionBoundary,
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
        ...executionBoundary,
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

async function runAcquiredCli(input: {
  exe: string;
  prompt: string;
  workingDirectory: string;
  modelRef: string;
  providerBaseUrl: string;
  chatComplete?: ChatCompleteFn;
  extraEnv: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AcquiredCodingRunResult> {
  const bridge = input.chatComplete
    ? await startLocalChatModelBridge({
        complete: input.chatComplete,
        model: input.modelRef.split('/')[1] || input.modelRef,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : undefined;
  const home = path.join(path.dirname(input.exe), '..', '..', 'home');
  const configDir = path.join(path.dirname(input.exe), '..', '..', 'config');
  const modelId = input.modelRef.split('/')[1] || input.modelRef;
  const nativeDeepSeek = input.modelRef.startsWith('deepseek/');
  const configPath = writeAcquiredCodingProviderConfig(
    configDir,
    modelId,
    nativeDeepSeek,
    bridge?.baseUrl || input.providerBaseUrl,
  );
  const env: NodeJS.ProcessEnv = {
    PATH: isolatedPath(path.dirname(input.exe)),
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    OPENCODE_CONFIG: configPath,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: path.join(home, 'xdg-data'),
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    ...input.extraEnv,
    ...(bridge ? { OPENAI_API_KEY: bridge.apiKey } : {}),
  };
  try {
    return await new Promise((resolve, reject) => {
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
  } finally {
    await bridge?.close().catch(() => undefined);
  }
}

async function runAcquiredCodexCli(input: {
  exe: string;
  prompt: string;
  workingDirectory: string;
  modelId: string;
  chatComplete: ChatCompleteFn;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AcquiredCodingRunResult> {
  const bridge = await startLocalChatModelBridge({
    complete: input.chatComplete,
    model: input.modelId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const runtimeBase = path.resolve(path.dirname(input.exe), '..', '..');
  const codexHome = path.join(runtimeBase, 'codex-home');
  const lastMessagePath = path.join(codexHome, 'last-message.txt');
  writeAcquiredCodexProviderConfig(codexHome, input.modelId, bridge.baseUrl);
  const env: NodeJS.ProcessEnv = {
    PATH: isolatedPath(path.dirname(input.exe)),
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.USERPROFILE,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CODEX_HOME: codexHome,
    DIGITALME_MODEL_TOKEN: bridge.apiKey,
  };
  const args = [
    '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    '--cd', input.workingDirectory,
    '-c', 'windows.sandbox="unelevated"',
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--json',
    '--output-last-message', lastMessagePath,
    input.prompt,
  ];
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(input.exe, args, hiddenSpawnOptions({
        cwd: input.workingDirectory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('timeout'));
      }, input.timeoutMs);
      input.signal?.addEventListener('abort', () => child.kill(), { once: true });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        const finalMessage = await fs.readFile(lastMessagePath, 'utf8').catch(() => '');
        resolve({
          exitCode: code,
          summary: ((code === 0 ? finalMessage || stdout || stderr : stderr || stdout || finalMessage) || '已返回执行结果').slice(0, 12000),
        });
      });
    });
  } finally {
    await bridge.close().catch(() => undefined);
  }
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

  return Object.assign(asLocalCapabilityAdapter({
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
      if (options.forceAvailability === 'unavailable') {
        return { available: false, reason: 'unavailable', detail: 'acquirable' };
      }
      if (options.forceAvailability === 'needs_setup') {
        return { available: false, reason: 'needs_setup', detail: 'acquirable' };
      }
      const status = acquiredCodingRuntimeStatus(options);
      return { available: true, detail: status };
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

      const instruction = String(input.goal || '').trim();
      const prompt = renderAcquiredCodingPrompt(instruction, workingDirectory);
      ctx.reportProgress('正在准备完成任务所需能力');

      let result: AcquiredCodingRunResult;
      if (options.executeHook) {
        result = await options.executeHook({
          instruction,
          workingDirectory,
          prompt,
          workDir: ctx.workDir,
        });
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
        if (acquired.candidateId === CODEX_CANDIDATE_ID) {
          if (!bridged.complete) {
            throw Object.assign(new Error('当前模型连接还不能用于受保护的代码执行。'), {
              stage: 'capability' as const,
              actionable: '请使用兔机米当前托管的聊天模型后再试。',
              failureKind: 'MODEL FAILURE',
              safeDetail: 'responses_bridge_unavailable',
            });
          }
          result = await runAcquiredCodexCli({
            exe: acquired.runtimePath,
            prompt,
            workingDirectory,
            modelId: bridged.modelRef.split('/')[1] || bridged.modelRef,
            chatComplete: bridged.complete,
            timeoutMs,
            signal: ctx.signal,
          });
        } else {
          result = await runAcquiredCli({
            exe: acquired.runtimePath,
            prompt,
            workingDirectory,
            modelRef: bridged.modelRef,
            providerBaseUrl: bridged.baseUrl,
            ...(bridged.complete ? { chatComplete: bridged.complete } : {}),
            extraEnv: bridged.env,
            timeoutMs,
            signal: ctx.signal,
          });
        }
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
          safeDetail: result.summary.slice(0, 2000),
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
  }), {
    mechanicalRuntimeStatus: () => acquiredCodingRuntimeStatus(options),
    mechanicalAcquisitionPreview: () => acquiredCodingRuntimePreview(options),
  });
}
