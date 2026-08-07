/**
 * Codex CLI 外部执行 Adapter — 首个 ExternalExecutor 实现。
 * 合同字段不绑定 Codex 专有结构；进程调用细节仅限本文件。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type {
  AvailabilityCheckResult,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { newId, nowIso } from '../../shared/ids';
import { buildMinimalExecutorEnv, resolveNodeExecutable } from '../../execution/minimal-env';
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
  resolveExecutorQuestion,
  buildAutoContinueRevisionRequest,
} from '../../execution/question-resolver';
import {
  extractCodexErrorTexts,
  mapCodexFailure,
  sanitizeExecutorMessage,
  type CodexFailureKind,
} from '../../execution/codex-error-map';
import {
  CODE_CHANGE_ARTIFACT_TYPE,
  EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
  EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
  type ExecutorRunResult,
  type ExecutorTaskPackage,
} from '../../execution/external-executor-contract';

export {
  EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
} from '../../execution/external-executor-contract';

export interface ExternalExecutorCodexOptions {
  /** 覆盖执行组件入口路径（测试用）。 */
  codexJsPath?: string;
  defaultTimeoutMs?: number;
  /** 测试注入：跳过真实 spawn。 */
  executeHook?: (input: {
    pkg: ExecutorTaskPackage;
    prompt: string;
    workDir: string;
  }) => Promise<Partial<ExecutorRunResult> & { exitCode: number | null; summary: string }>;
  /**
   * 测试/验收注入统一可用性（不写入通用合同字段名）。
   * ready | needs_login | needs_setup | unavailable | unsupported
   */
  forceAvailability?:
    | 'ready'
    | 'needs_login'
    | 'needs_setup'
    | 'unavailable'
    | 'unsupported';
}

export function createExternalExecutorCodexAdapter(
  options: ExternalExecutorCodexOptions = {},
) {
  const registration: CapabilityRegistration = {
    id: EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
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
    availability: 'needs_setup',
    adapter: {
      type: 'external-executor-cli',
      adapterId: EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
    },
    codingExecution: {
      providerKind: 'local_coding_agent',
      invocationKind: 'cli',
      supportsAutomaticExecution: true,
      supportsProgress: true,
      supportsRevision: true,
      supportsResultCollection: true,
    },
    contextPolicy: {
      folderTraversal: 'recursive',
      excludeSensitivePaths: true,
      budget: {
        maxFiles: 80,
        maxTotalBytes: 1_024_000,
        maxFileBytes: 128_000,
        maxDepth: 8,
        maxScanMs: 30_000,
      },
    },
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'external-executor-codex/1',
    describe: () => ({
      adapterId: EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
      adapterType: 'external-executor-cli',
      capabilityId: EXTERNAL_EXECUTOR_CODEX_CAPABILITY_ID,
      displayName: registration.displayName,
      location: 'local',
      outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
      supportsAsyncRemote: false,
      version: 'external-executor-codex/1',
    }),
    checkAvailability: async (): Promise<AvailabilityCheckResult> => {
      return probeCodexAvailability(options.codexJsPath, options);
    },
    execute: async (input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> => {
      return runExternalExecutorCodex(input, ctx, options);
    },
  });
}

/** 探测后写入可用性（供 Runtime 启动时刷新 registration.availability）。 */
export async function probeCodexAvailability(
  codexJsPath?: string,
  options: Pick<ExternalExecutorCodexOptions, 'forceAvailability' | 'executeHook'> = {},
): Promise<AvailabilityCheckResult> {
  const forced =
    options.forceAvailability ||
    (process.env.DIGITALME_CODING_CAPABILITY_FORCE as
      | ExternalExecutorCodexOptions['forceAvailability']
      | undefined);
  if (forced === 'ready' || options.executeHook) {
    return { available: true, detail: 'ready' };
  }
  if (forced === 'needs_login') {
    return {
      available: false,
      reason: 'needs_login',
      detail: '代码执行能力需要连接后才能继续。',
    };
  }
  if (forced === 'unavailable') {
    return {
      available: false,
      reason: 'version_incompatible',
      detail: '当前代码执行能力版本过旧，请更新后重新检查。',
    };
  }
  if (forced === 'unsupported') {
    return {
      available: false,
      reason: 'unsupported',
      detail: '检测到该工具，但当前版本还不能自动调用它。',
    };
  }
  if (forced === 'needs_setup') {
    return {
      available: false,
      reason: 'needs_setup',
      detail: '尚未检测到可用的代码执行能力。',
    };
  }
  try {
    const envPath = process.env.DIGITALME_CODEX_JS_PATH;
    const js = codexJsPath || envPath || resolveCodexJs();
    await fs.access(js);
    const version = await runCodexVersion(js);
    if (/outdated|unsupported.*cli|incompatible/i.test(version || '')) {
      return {
        available: false,
        reason: 'version_incompatible',
        detail: '当前代码执行能力版本过旧，请更新后重新检查。',
      };
    }
    return { available: true, detail: version || js };
  } catch (error) {
    return {
      available: false,
      reason: 'needs_setup',
      detail: '尚未检测到可用的代码执行能力。',
    };
  }
}

export function resolveCodexJs(): string {
  const candidates = [
    path.join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
    path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.npm-global',
      'lib',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
    path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
  ];
  for (const candidate of candidates) {
    try {
      require('node:fs').accessSync(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  throw new Error('尚未检测到可用的代码执行能力。请先安装推荐能力后再在设置中检查连接。');
}

async function runExternalExecutorCodex(
  input: CapabilityInput,
  ctx: ExecutionContext,
  options: ExternalExecutorCodexOptions,
): Promise<CapabilityOutput> {
  if (ctx.signal.aborted) throw abortError();

  const auth = input.executionAuthorization;

  const workingDirectory =
    auth?.workingDirectory ||
    inferWorkingDirectory(input) ||
    '';
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

  const pkg = buildExecutorTaskPackage({
    taskId: String(input.snapshot.taskId || 'task'),
    jobId: ctx.jobId,
    goal: input.goal,
    workingDirectory,
    readScope: auth.readScope,
    writeScope: auth.writeScope,
    projectBrief: `本地项目：${workingDirectory}`,
    priorDecisions: decisionBriefs,
    snapshotId: input.snapshot.id,
    materialPaths: (input.snapshot.items || [])
      .map((i) => i.sourcePath)
      .filter(Boolean)
      .slice(0, 40),
    subjectDecisionBriefs: decisionBriefs,
    ...(input.revision
      ? {
          previousRun: {
            summary: input.revision.previousText.slice(0, 2000),
            changedFiles: [],
            revisionRequest: input.revision.request,
          },
        }
      : {}),
    timeoutMs: options.defaultTimeoutMs ?? 600_000,
    executorId: EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
    executorSelectionReason: '用户目标需要修改代码仓库文件；已连接 Codex CLI 代码执行能力',
  });

  await fs.writeFile(
    path.join(evidenceDir, 'task-package.json'),
    JSON.stringify(pkg, null, 2),
    'utf8',
  );

  ctx.reportProgress('正在读取项目');
  ctx.updateExternalExecution?.({
    lastExecutorStatus: 'running',
    executorRunId: newId('job'),
  });
  const baseline = await captureExecutionBaseline({
    workingDirectory: pkg.workingDirectory,
    writeScope: pkg.writeScope,
    readScope: pkg.readScope,
    jobEvidenceDir: evidenceDir,
  });
  const preRunDigest = baseline.scopeDigest;

  ctx.reportProgress('正在修改项目文件');
  const prompt = renderTaskPackagePrompt(pkg);
  await fs.writeFile(path.join(evidenceDir, 'prompt.txt'), prompt, 'utf8');

  const startedAt = nowIso();
  const executorRunId = newId('job');
  ctx.updateExternalExecution?.({ lastExecutorStatus: 'running', executorRunId });
  let agentPartial: Partial<ExecutorRunResult> & {
    exitCode: number | null;
    summary: string;
    failureKind?: CodexFailureKind;
    actionable?: string;
    stdoutLog?: string;
    stderrLog?: string;
  };

  try {
    if (options.executeHook) {
      agentPartial = await options.executeHook({ pkg, prompt, workDir: ctx.workDir });
    } else {
      agentPartial = await spawnCodexExec({
        pkg,
        prompt,
        evidenceDir,
        signal: ctx.signal,
        reportProgress: ctx.reportProgress,
        ...(options.codexJsPath ? { codexJsPath: options.codexJsPath } : {}),
      });
    }
  } catch (error) {
    const kind = ((error as { failureKind?: CodexFailureKind }).failureKind ||
      'spawn_failed') as CodexFailureKind;
    ctx.updateExternalExecution?.({ lastExecutorStatus: 'failed', executorRunId });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      stage: 'capability' as const,
      failureKind: kind,
      actionable:
        (error as { actionable?: string }).actionable ||
        mapCodexFailure({ texts: [String(error)], exitCode: null, spawnError: true }).actionable,
    });
  }

  if (ctx.signal.aborted) {
    ctx.updateExternalExecution?.({ lastExecutorStatus: 'cancelled', executorRunId });
    throw abortError();
  }

  ctx.reportProgress('正在整理结果');
  const midDigest = await computeScopeDigest(pkg.workingDirectory, pkg.writeScope);
  let collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidenceDir });
  collected = markConcurrentIfNeeded(collected, preRunDigest, midDigest);
  // 若 mid == after，无并发；若执行中第三方改动发生在 collect 之前且被纳入 after，难区分。
  // 额外：若 mid !== after 则并发。
  if (midDigest !== collected.afterScopeDigest) {
    collected = { ...collected, concurrentModificationSuspected: true };
  }

  const agentResult: ExecutorRunResult = {
    executorId: EXTERNAL_EXECUTOR_CODEX_ADAPTER_ID,
    executorRunId,
    startedAt,
    completedAt: nowIso(),
    status:
      agentPartial.exitCode === 0
        ? 'succeeded'
        : ctx.signal.aborted
          ? 'cancelled'
          : 'failed',
    summary: agentPartial.summary || '',
    claimedChangedFiles: agentPartial.claimedChangedFiles || [],
    diffRef: 'patch.diff',
    testCommands: agentPartial.testCommands || [],
    testResults: agentPartial.testResults || [],
    warnings: agentPartial.warnings || [],
    unresolvedItems: agentPartial.unresolvedItems || [],
    questions: agentPartial.questions || extractQuestions(agentPartial.summary || ''),
    exitCode: agentPartial.exitCode,
    workingDirectoryState:
      collected.outOfScopeChanges.length > 0 ? 'out_of_scope_changes' : 'clean_within_scope',
  };

  // 自动判答（记录依据）；是否续执行由 Runner 根据标记决定，Adapter 只写入问题解析
  const autoAnswers: Array<{ text: string; answer: string; rationale: string }> = [];
  const askUser: string[] = [];
  for (const q of agentResult.questions) {
    const res = resolveExecutorQuestion(q.text, pkg);
    if (res.kind === 'auto_answer') {
      q.answeredBy = 'digitalme';
      q.answer = res.answer;
      q.rationale = res.rationale;
      autoAnswers.push({ text: q.text, answer: res.answer, rationale: res.rationale });
    } else {
      askUser.push(res.reason);
    }
  }
  if (autoAnswers.length && !askUser.length) {
    agentResult.warnings.push('digitalme_auto_continue_available');
    const continueText = buildAutoContinueRevisionRequest(autoAnswers);
    await fs.writeFile(
      path.join(evidenceDir, 'auto-continue-revision.txt'),
      continueText,
      'utf8',
    );
    // 同一 Job 内最多自动续执行一次（不另建 Job、不循环）
    ctx.reportProgress('正在修改项目文件');
    const continuePkg: ExecutorTaskPackage = {
      ...pkg,
      previousRun: {
        summary: agentResult.summary.slice(0, 2000),
        changedFiles: collected.changedFiles,
        revisionRequest: continueText,
      },
    };
    const continuePrompt = renderTaskPackagePrompt(continuePkg);
    await fs.writeFile(path.join(evidenceDir, 'prompt-continue.txt'), continuePrompt, 'utf8');
    let continuePartial: Partial<ExecutorRunResult> & {
      exitCode: number | null;
      summary: string;
    };
    if (options.executeHook) {
      continuePartial = await options.executeHook({
        pkg: continuePkg,
        prompt: continuePrompt,
        workDir: ctx.workDir,
      });
    } else {
      continuePartial = await spawnCodexExec({
        pkg: continuePkg,
        prompt: continuePrompt,
        evidenceDir,
        signal: ctx.signal,
        reportProgress: ctx.reportProgress,
        ...(options.codexJsPath ? { codexJsPath: options.codexJsPath } : {}),
      });
    }
    // 续执行后重新采集与验证
    const mid2 = await computeScopeDigest(pkg.workingDirectory, pkg.writeScope);
    collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidenceDir });
    if (mid2 !== collected.afterScopeDigest) {
      collected = { ...collected, concurrentModificationSuspected: true };
    }
    agentResult.summary = [agentResult.summary, '', '--- 自动续执行 ---', continuePartial.summary]
      .join('\n')
      .slice(0, 12000);
    agentResult.exitCode = continuePartial.exitCode;
    agentResult.status = continuePartial.exitCode === 0 ? 'succeeded' : 'failed';
    agentResult.claimedChangedFiles = [
      ...new Set([
        ...agentResult.claimedChangedFiles,
        ...(continuePartial.claimedChangedFiles || []),
      ]),
    ];
    agentResult.completedAt = nowIso();
    agentResult.warnings = agentResult.warnings.filter((w) => w !== 'digitalme_auto_continue_available');
    agentResult.warnings.push('digitalme_auto_continued_once');
  } else if (askUser.length) {
    agentResult.warnings.push('needs_user_input');
    agentResult.unresolvedItems.push(
      ...agentResult.questions.filter((q) => !q.answeredBy).map((q) => q.text),
    );
  }

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
  });

  // 将任务包/基线等证据也拷到 bundle 旁供审计
  for (const name of [
    'task-package.json',
    'baseline.json',
    'collected-changes.json',
    'verification.json',
    'executor-run.json',
    'prompt.txt',
  ]) {
    try {
      await fs.copyFile(path.join(evidenceDir, name), path.join(bundle.bundleDir, name));
    } catch {
      /* optional */
    }
  }

  // 无实质变更或执行器失败 → 按 JSONL/摘要分类，不得统一成「未检测到变化」
  if (
    collected.changedFiles.length === 0 &&
    (verification.overall === 'unsatisfied' || agentResult.exitCode !== 0)
  ) {
    const texts = extractCodexErrorTexts({
      stdout: agentPartial.stdoutLog || agentResult.summary,
      stderr: agentPartial.stderrLog || '',
      lastMessage: agentResult.summary,
    });
    let mapped = mapCodexFailure({
      texts: texts.length
        ? texts
        : [agentResult.summary, agentPartial.actionable || ''].filter(Boolean),
      exitCode: agentResult.exitCode,
      changedFilesCount: 0,
      ...(agentPartial.failureKind === 'timeout' ? { timedOut: true } : {}),
      ...(agentPartial.failureKind === 'cancelled' ? { aborted: true } : {}),
      ...(agentPartial.failureKind === 'spawn_failed' ? { spawnError: true } : {}),
    });
    const forced = agentPartial.failureKind;
    if (
      forced &&
      (
        [
          'cli_outdated_or_model_incompatible',
          'auth_failed',
          'model_unavailable',
          'spawn_failed',
          'timeout',
          'cancelled',
        ] as CodexFailureKind[]
      ).includes(forced)
    ) {
      mapped = {
        kind: forced,
        actionable: agentPartial.actionable || mapped.actionable,
        summary:
          mapped.kind === 'no_substantive_change'
            ? agentPartial.actionable || mapped.summary
            : mapped.summary,
      };
    }
    agentResult.status = 'failed';
    agentResult.warnings = [
      ...(agentResult.warnings || []),
      `failureKind=${mapped.kind}`,
    ];
    await fs.writeFile(
      path.join(evidenceDir, 'executor-run.json'),
      JSON.stringify(
        {
          ...agentResult,
          failureKind: mapped.kind,
          actionable: mapped.actionable,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(evidenceDir, 'verification.json'),
      JSON.stringify(
        {
          ...verification,
          failureKind: mapped.kind,
          failureMessage: mapped.summary,
          actionable: mapped.actionable,
        },
        null,
        2,
      ),
      'utf8',
    );
    ctx.updateExternalExecution?.({
      lastExecutorStatus: 'failed',
      executorRunId,
      afterScopeDigest: collected.afterScopeDigest,
    });
    throw Object.assign(new Error(mapped.summary), {
      stage: 'capability' as const,
      failureKind: mapped.kind,
      actionable: mapped.actionable,
    });
  }

  ctx.updateExternalExecution?.({
    lastExecutorStatus: 'succeeded',
    executorRunId,
    afterScopeDigest: collected.afterScopeDigest,
  });

  // 验证未满足时仍产出 Artifact（便于用户查看/恢复），但用 candidateMeta 标记；
  // Runner 的 outcome check 会按 verification overall 决定是否 blocked。
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
      provenance: 'external-executor-codex',
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

function inferWorkingDirectory(input: CapabilityInput): string | null {
  for (const item of input.snapshot.items || []) {
    const p = String(item.sourcePath || '');
    if (!p) continue;
    if (item.kind === 'folder-entry') {
      // folder-entry 常为目录内文件；取上级目录作仓库根启发式
      const resolved = path.resolve(p);
      return path.extname(resolved) ? path.dirname(resolved) : resolved;
    }
  }
  for (const item of input.snapshot.items || []) {
    const p = String(item.sourcePath || '');
    if (!p) continue;
    const resolved = path.resolve(p);
    return path.extname(resolved) ? path.dirname(resolved) : resolved;
  }
  return null;
}

/** 供测试与证据审计：executable=node，args 不含 shell 字符串与 --full-auto。 */
export function buildCodexExecArgs(input: {
  codexJsPath: string;
  workingDirectory: string;
  lastMessagePath: string;
}): string[] {
  // 非交互：-c approval_policy=never 替代已废弃 --full-auto；不拼接 shell 命令字符串
  return [
    input.codexJsPath,
    'exec',
    '--cd',
    input.workingDirectory,
    '--sandbox',
    'workspace-write',
    '--json',
    '-c',
    'approval_policy="never"',
    '--output-last-message',
    input.lastMessagePath,
    '-',
  ];
}

async function spawnCodexExec(input: {
  pkg: ExecutorTaskPackage;
  prompt: string;
  evidenceDir: string;
  signal: AbortSignal;
  reportProgress: (n: string) => void;
  codexJsPath?: string;
}): Promise<{
  exitCode: number | null;
  summary: string;
  claimedChangedFiles: string[];
  failureKind?: CodexFailureKind;
  actionable?: string;
  stdoutLog?: string;
  stderrLog?: string;
}> {
  const codexJs = input.codexJsPath || resolveCodexJs();
  const lastMessagePath = path.join(input.evidenceDir, 'codex-last-message.txt');
  const stdoutPath = path.join(input.evidenceDir, 'codex-stdout.jsonl');
  const args = buildCodexExecArgs({
    codexJsPath: codexJs,
    workingDirectory: input.pkg.workingDirectory,
    lastMessagePath,
  });

  const nodeExecutable = resolveNodeExecutable(process.env);
  await fs.writeFile(
    path.join(input.evidenceDir, 'codex-argv.json'),
    JSON.stringify(
      {
        executable: nodeExecutable,
        args,
        shell: false,
        cwdNote: 'workingDirectory passed via --cd arg, not shell cwd string',
      },
      null,
      2,
    ),
    'utf8',
  );

  const env = buildMinimalExecutorEnv(process.env, {
    ...(process.versions.electron && nodeExecutable === process.execPath
      ? { ELECTRON_RUN_AS_NODE: '1' }
      : {}),
  });
  input.reportProgress('正在修改项目文件');

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(nodeExecutable, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, input.pkg.timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    input.signal.addEventListener('abort', onAbort);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin?.write(input.prompt);
    child.stdin?.end();

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
      const mapped = mapCodexFailure({
        texts: [err.message],
        exitCode: null,
        spawnError: true,
      });
      reject(
        Object.assign(new Error(mapped.summary), {
          stage: 'capability' as const,
          failureKind: mapped.kind,
          actionable: mapped.actionable,
        }),
      );
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
      try {
        await fs.writeFile(stdoutPath, `${stdout}\n${stderr}`, 'utf8');
      } catch {
        /* ignore */
      }
      let lastMessage = '';
      try {
        lastMessage = await fs.readFile(lastMessagePath, 'utf8');
      } catch {
        lastMessage = stdout.slice(-4000) || stderr.slice(-4000);
      }

      if (timedOut) {
        const mapped = mapCodexFailure({
          texts: [lastMessage, stderr],
          exitCode: code,
          timedOut: true,
        });
        reject(
          Object.assign(new Error(mapped.summary), {
            stage: 'capability' as const,
            failureKind: mapped.kind,
            actionable: mapped.actionable,
          }),
        );
        return;
      }
      if (input.signal.aborted) {
        const mapped = mapCodexFailure({
          texts: [lastMessage],
          exitCode: code,
          aborted: true,
        });
        reject(
          Object.assign(new Error(mapped.summary), {
            stage: 'capability' as const,
            failureKind: mapped.kind,
            actionable: mapped.actionable,
          }),
        );
        return;
      }

      const texts = extractCodexErrorTexts({
        stdout,
        stderr,
        lastMessage,
      });
      const mapped = mapCodexFailure({
        texts,
        exitCode: code,
      });
      const claimed = extractClaimedFiles(lastMessage || stdout);
      const summary =
        sanitizeExecutorMessage(lastMessage || mapped.summary || `codex exit=${code}`, 8000) ||
        mapped.summary;

      // 非零退出或 JSONL 已标明认证/模型类错误：带回 failureKind，供上层区分「无变更」
      if (
        code !== 0 ||
        mapped.kind === 'auth_failed' ||
        mapped.kind === 'cli_outdated_or_model_incompatible' ||
        mapped.kind === 'model_unavailable'
      ) {
        resolve({
          exitCode: code,
          summary,
          claimedChangedFiles: claimed,
          failureKind: mapped.kind,
          actionable: mapped.actionable,
          stdoutLog: stdout.slice(-100_000),
          stderrLog: stderr.slice(-20_000),
        });
        return;
      }

      resolve({
        exitCode: code,
        summary,
        claimedChangedFiles: claimed,
        stdoutLog: stdout.slice(-100_000),
        stderrLog: stderr.slice(-20_000),
      });
    });
  });
}

function extractClaimedFiles(text: string): string[] {
  const files = new Set<string>();
  const re = /(?:^|\s)([A-Za-z0-9_\-./\\]+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|css|html))\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] && !m[1].includes('node_modules')) files.add(m[1].replace(/\\/g, '/'));
  }
  return [...files].slice(0, 40);
}

function extractQuestions(summary: string): ExecutorRunResult['questions'] {
  const questions: ExecutorRunResult['questions'] = [];
  for (const line of summary.split(/\r?\n/)) {
    const t = line.trim();
    if (/[？?]\s*$/.test(t) && t.length > 8 && t.length < 400) {
      questions.push({ text: t });
    }
  }
  return questions.slice(0, 5);
}

async function runCodexVersion(codexJs: string): Promise<string> {
  return new Promise((resolve) => {
    const nodeExecutable = resolveNodeExecutable(process.env);
    const child = spawn(nodeExecutable, [codexJs, '--version'], {
      env: buildMinimalExecutorEnv(process.env, {
        ...(process.versions.electron && nodeExecutable === process.execPath
          ? { ELECTRON_RUN_AS_NODE: '1' }
          : {}),
      }),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('close', () => resolve(out.trim().slice(0, 200)));
    child.on('error', () => resolve(''));
  });
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
