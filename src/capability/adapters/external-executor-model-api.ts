/**
 * TRIAL-SURFACE-01B — 无专用代码执行器时，用已连接模型完成一次改文件的运输。
 *
 * 与 CLI/HTTP 共用 ExecutorTaskPackage / 授权目录 / 基线快照 / 改动采集 /
 * 独立验收 / code-change 成果包；不另起状态机，不做内部编码 Agent 内核。
 * 执行步骤锁死：读取 → 一次 chatComplete 取结构化改动 → 校验路径 →
 * 落盘 → 采集 diff → 独立验收。解析失败 / 越权 / 验收失败 → Job 失败，不得再开第二 Job。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type {
  AvailabilityCheckResult,
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { chatComplete, ModelHttpError } from '../../infrastructure/model-http';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { newId, nowIso } from '../../shared/ids';
import {
  buildExecutorTaskPackage,
  renderTaskPackagePrompt,
} from '../../execution/task-package';
import {
  captureExecutionBaseline,
  computeScopeDigest,
  isPathWithinScope,
} from '../../execution/baseline';
import {
  collectExecutionChanges,
  markConcurrentIfNeeded,
} from '../../execution/run-collector';
import { verifyExternalExecution } from '../../execution/execution-verifier';
import { writeCodeChangeBundle } from '../../execution/bundle-writer';
import {
  CODE_CHANGE_ARTIFACT_TYPE,
  EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
  type ExecutorRunResult,
  type ExecutorTaskPackage,
} from '../../execution/external-executor-contract';

export {
  EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
  EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
} from '../../execution/external-executor-contract';

export interface ExternalExecutorModelApiOptions {
  /** SecretAccessor 查找用的 providerId（默认 openai-compatible）。 */
  providerId?: string;
  /** OpenAI-compatible API 根（与文档模型同一配置源）。 */
  baseUrl?: string;
  /** 模型标识（与文档模型同一配置源）。 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 测试注入：覆盖 chatComplete（不真打付费 API）。 */
  chatCompleteHook?: typeof chatComplete;
  /** 测试注入：覆盖从模型文本解析结构化改动。 */
  parseEditsHook?: (text: string) => ParsedEdits;
  /** 测试注入：覆盖范围读取（避免依赖真实项目文件）。 */
  readScopeFilesHook?: (input: {
    pkg: ExecutorTaskPackage;
    evidenceDir: string;
  }) => Promise<Array<{ rel: string; content: string }>>;
}

export interface ParsedEdit {
  path: string;
  /** 完整文件内容；缺省或为 null 表示删除该文件。 */
  content?: string | null;
}

export interface ParsedEdits {
  edits: ParsedEdit[];
  summary?: string;
  testCommands?: string[];
  unresolvedItems?: string[];
}

const MAX_SCOPE_FILES = 40;
const MAX_SCOPE_BYTES = 1_000_000;
const MAX_SCOPE_FILE_BYTES = 128_000;

export function createExternalExecutorModelApiAdapter(
  options: ExternalExecutorModelApiOptions,
): CapabilityAdapter {
  const registration: CapabilityRegistration = {
    id: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
    kind: 'agent',
    displayName: '已连接的模型',
    description:
      '实验：没有专用代码执行器时，用已连接的同一套模型接口在你确认的项目目录内完成一次小改动，并运行本地测试。适合小改。',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
    permissions: ['filesystem_read', 'filesystem_write', 'network', 'secret_access'],
    cost: { estimate: '按已连接模型用量计费' },
    latencyEstimate: '数秒到数十秒',
    location: 'remote',
    availability: 'available',
    adapter: {
      type: 'external-executor-model-api',
      adapterId: EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
    },
    codingExecution: {
      providerKind: 'local_coding_agent',
      invocationKind: 'api',
      supportsAutomaticExecution: true,
      supportsProgress: true,
      supportsRevision: false,
      supportsResultCollection: true,
    },
    contextPolicy: {
      folderTraversal: 'recursive',
      excludeSensitivePaths: true,
      budget: {
        maxFiles: MAX_SCOPE_FILES,
        maxTotalBytes: MAX_SCOPE_BYTES,
        maxFileBytes: MAX_SCOPE_FILE_BYTES,
        maxDepth: 8,
        maxScanMs: 20_000,
      },
    },
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'external-executor-model-api/1',
    describe: () => ({
      adapterId: EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
      adapterType: 'external-executor-model-api',
      capabilityId: EXTERNAL_EXECUTOR_MODEL_API_CAPABILITY_ID,
      displayName: registration.displayName,
      location: 'remote',
      outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
      supportsAsyncRemote: false,
      version: 'external-executor-model-api/1',
    }),
    checkAvailability: async (): Promise<AvailabilityCheckResult> => {
      if (!String(options.baseUrl || '').trim() || !String(options.model || '').trim()) {
        return {
          available: false,
          reason: 'needs_setup',
          detail: '请先在设置中连接模型后再试。',
        };
      }
      return { available: true, detail: 'ready' };
    },
    execute: async (input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> => {
      return runExternalExecutorModelApi(input, ctx, options);
    },
  });
}

async function runExternalExecutorModelApi(
  input: CapabilityInput,
  ctx: ExecutionContext,
  options: ExternalExecutorModelApiOptions,
): Promise<CapabilityOutput> {
  if (ctx.signal.aborted) throw abortError();

  const auth = input.executionAuthorization;
  const workingDirectory =
    auth?.workingDirectory || inferWorkingDirectory(input) || '';
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

  let pkg = buildExecutorTaskPackage({
    taskId: String(input.snapshot.taskId || 'task'),
    jobId: ctx.jobId,
    goal: input.goal,
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
    ...(input.revision
      ? {
          previousRun: {
            summary: input.revision.previousText.slice(0, 2000),
            changedFiles: [],
            revisionRequest: input.revision.request,
          },
        }
      : {}),
    timeoutMs: options.timeoutMs ?? 600_000,
    executorId: EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
    executorSelectionReason: '已连接模型兜底：本机无专用代码执行器，使用同一套已配置模型接口完成本次修改',
    ...(auth.projectOrigin ? { projectOrigin: auth.projectOrigin } : {}),
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

  ctx.reportProgress('正在读取授权范围内文件');
  const scopedFiles = await readScopeFiles({
    pkg,
    evidenceDir,
    ...(options.readScopeFilesHook ? { hook: options.readScopeFilesHook } : {}),
  });
  await fs.writeFile(
    path.join(evidenceDir, 'scope-files.json'),
    JSON.stringify(
      scopedFiles.map((f) => ({ path: f.rel, chars: f.content.length })),
      null,
      2,
    ),
    'utf8',
  );

  // 结构化改动一次性请求（不开放 ReAct）
  const system = buildEditSystemPrompt();
  const userPrompt = [
    renderTaskPackagePrompt(pkg),
    '',
    '以下是授权范围内可读取的文件（相对路径 + 内容）：',
    ...(scopedFiles.length
      ? scopedFiles.map((f) => `\n--- ${f.rel} ---\n${f.content}`)
      : ['（授权范围内没有可读取的既有文件；可按目标新建文件）']),
    '',
    '请只输出一个 JSON 对象，不要输出任何额外说明。格式：',
    JSON.stringify(
      {
        summary: '一句话变更摘要',
        edits: [{ path: '相对路径', content: '修改后的完整文件内容' }],
        testCommands: ['可选：建议运行的本机测试命令'],
        unresolvedItems: ['可选：未完成事项'],
      },
      null,
      2,
    ),
    '',
    '规则：path 必须是工作目录内的相对路径（禁止 .. 与盘符）；content 为完整新内容；要删除某文件时 content 用 null。',
  ].join('\n');

  ctx.reportProgress('正在调用已连接模型');
  const parsed = await callForStructuredEdits({
    options,
    system,
    userPrompt,
    pkg,
    ctx,
    ...(options.chatCompleteHook ? { chatCompleteHook: options.chatCompleteHook } : {}),
    ...(options.parseEditsHook ? { parseEditsHook: options.parseEditsHook } : {}),
  });

  // 校验路径并在授权范围内落盘
  ctx.reportProgress('正在写入修改');
  const applied = await applyParsedEdits({
    pkg,
    parsed,
    workingDirectory,
    evidenceDir,
    ...(options.parseEditsHook ? { parseEditsHook: options.parseEditsHook } : {}),
  });

  const agentResult: ExecutorRunResult = {
    executorId: EXTERNAL_EXECUTOR_MODEL_API_ADAPTER_ID,
    executorRunId: newId('job'),
    startedAt: nowIso(),
    completedAt: nowIso(),
    status: 'succeeded',
    summary: parsed.summary || applied.summary || '已按已连接模型给出的改动完成写入。',
    claimedChangedFiles: applied.changedFiles,
    diffRef: 'patch.diff',
    testCommands: parsed.testCommands || [],
    testResults: [],
    warnings: [],
    unresolvedItems: parsed.unresolvedItems || [],
    questions: [],
    exitCode: 0,
    workingDirectoryState: 'clean_within_scope',
  };

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

  for (const name of [
    'task-package.json',
    'baseline.json',
    'collected-changes.json',
    'verification.json',
    'executor-run.json',
    'prompt.txt',
    'scope-files.json',
  ]) {
    try {
      await fs.copyFile(path.join(evidenceDir, name), path.join(bundle.bundleDir, name));
    } catch {
      /* optional */
    }
  }

  if (verification.overall === 'unsatisfied') {
    const message =
      '已连接模型未能通过 Digital Me 的独立验收，本次改动未成立。不会自动改用其他工具。';
    ctx.updateExternalExecution?.({
      lastExecutorStatus: 'failed',
      executorRunId: agentResult.executorRunId,
      afterScopeDigest: collected.afterScopeDigest,
    });
    throw Object.assign(new Error(message), {
      stage: 'capability' as const,
      actionable: message,
    });
  }

  ctx.updateExternalExecution?.({
    lastExecutorStatus: 'succeeded',
    executorRunId: agentResult.executorRunId,
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
      provenance: 'external-executor-model-api',
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

function buildEditSystemPrompt(): string {
  return [
    '你是 Digital Me 委派的代码改动助手（实验）。',
    '你只负责：读取授权范围内文件，输出结构化 JSON 改动。',
    '你不执行命令、不 commit、不 push、不部署、不支付。',
    '只修改授权 writeScope 内的文件；越权路径直接拒绝。',
    '只输出一个 JSON 对象，不输出 markdown、解释或其它文本。',
  ].join('\n');
}

async function callForStructuredEdits(input: {
  options: ExternalExecutorModelApiOptions;
  system: string;
  userPrompt: string;
  pkg: ExecutorTaskPackage;
  ctx: ExecutionContext;
  chatCompleteHook?: typeof chatComplete;
  parseEditsHook?: (text: string) => ParsedEdits;
}): Promise<ParsedEdits> {
  const options = input.options;
  const baseUrl = String(options.baseUrl || '').trim();
  const model = String(options.model || '').trim();
  if (!baseUrl || !model) {
    throw Object.assign(new Error('请先在设置中连接模型后再试。'), {
      stage: 'capability' as const,
      actionable: '打开设置，配置并测试模型连接后再试',
    });
  }
  const apiKey = await input.ctx.secrets.get(
    providerCredentialKey(options.providerId || 'openai-compatible'),
  );
  if (!apiKey) {
    throw Object.assign(new Error('请先在设置中连接模型后再试。'), {
      stage: 'capability' as const,
      actionable: '打开设置，配置并测试模型连接后再试',
    });
  }
  const call = async () => {
    const chat = input.chatCompleteHook ?? chatComplete;
    const result = await chat({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.userPrompt },
      ],
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens ?? 4096,
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: input.ctx.signal,
      responseFormat: { type: 'json_object' },
    });
    return result;
  };

  const attempts: string[] = [];
  let lastText = '';
  // 一次，必要时严格一次重试解析
  for (let i = 0; i < 2; i += 1) {
    if (input.ctx.signal.aborted) throw abortError();
    let result;
    try {
      result = await call();
    } catch (error) {
      if (error instanceof ModelHttpError) {
        throw mapModelError(error);
      }
      throw error;
    }
    lastText = result.text || '';
    try {
      const parsed = (input.parseEditsHook ? input.parseEditsHook(lastText) : parseEdits(lastText));
      attempts.push(lastText.slice(0, 400));
      return parsed;
    } catch (err) {
      attempts.push(lastText.slice(0, 400));
      if (i === 0) continue;
      throw Object.assign(
        new Error(`已连接模型返回的改动无法解析，本次未写入任何文件。${err instanceof Error ? err.message : ''}`),
        {
          stage: 'capability' as const,
          actionable: '请重试；若持续失败请更换模型或简化目标',
        },
      );
    }
  }
  // 不可达
  throw new Error('模型改动解析失败');
}

export function parseEdits(text: string): ParsedEdits {
  const jsonText = extractJson(text);
  if (!jsonText) {
    throw new Error('输出中未找到可解析的 JSON');
  }
  const raw = JSON.parse(jsonText) as {
    summary?: unknown;
    edits?: unknown;
    testCommands?: unknown;
    unresolvedItems?: unknown;
  };
  if (!raw || typeof raw !== 'object') throw new Error('JSON 不是对象');
  if (!Array.isArray(raw.edits)) throw new Error('缺少 edits 数组');
  const edits = raw.edits.map((e) => {
    if (!e || typeof e !== 'object') throw new Error('edit 项无效');
    const rec = e as { path?: unknown; content?: unknown };
    const p = String(rec.path || '').trim();
    if (!p) throw new Error('edit 缺少 path');
    return {
      path: p,
      ...(rec.content === undefined ? {} : { content: rec.content === null ? null : String(rec.content) }),
    } as ParsedEdit;
  });
  const out: ParsedEdits = { edits };
  if (typeof raw.summary === 'string' && raw.summary.trim()) out.summary = raw.summary.trim();
  if (Array.isArray(raw.testCommands)) {
    out.testCommands = raw.testCommands.map((s) => String(s || '').trim()).filter(Boolean);
  }
  if (Array.isArray(raw.unresolvedItems)) {
    out.unresolvedItems = raw.unresolvedItems.map((s) => String(s || '').trim()).filter(Boolean);
  }
  return out;
}

function extractJson(text: string): string | null {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t);
    return typeof parsed === 'object' ? t : null;
  } catch {
    /* fallthrough to fence/brace extraction */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) {
    const candidate = fence[1].trim();
    try {
      if (typeof JSON.parse(candidate) === 'object') return candidate;
    } catch {
      /* continue */
    }
  }
  // 从第一个 { 到最后一个 }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = t.slice(start, end + 1);
    try {
      if (typeof JSON.parse(candidate) === 'object') return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeWriteScope(workingDirectory: string, scopes: string[] | undefined): string[] {
  const root = path.resolve(workingDirectory);
  const list = Array.isArray(scopes) && scopes.length ? scopes : ['.'];
  return list.map((raw) => {
    const t = String(raw || '').trim();
    if (!t || t === '.' || t === './' || t === '*') return '.';
    if (path.isAbsolute(t)) {
      const abs = path.resolve(t);
      if (abs === root) return '.';
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) return t.replace(/\\/g, '/');
      return rel;
    }
    return t.replace(/\\/g, '/').replace(/^\.\//, '');
  });
}

function rejectOutOfScope(rel: string): never {
  throw Object.assign(new Error(`越权路径被拒绝：${rel}`), {
    stage: 'capability' as const,
    actionable: '已连接模型返回了授权范围外的路径，本次未写入任何文件。',
  });
}

function resolveSafeTargetPath(
  pkg: ExecutorTaskPackage,
  workingDirectory: string,
  rel: string,
): string {
  const normalized = String(rel || '').replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    rejectOutOfScope(rel);
  }
  const parts = normalized.split('/');
  if (parts.includes('..')) {
    rejectOutOfScope(rel);
  }
  const resolved = path.resolve(workingDirectory, normalized);
  const root = path.resolve(workingDirectory);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    rejectOutOfScope(rel);
  }
  const scopedRel = path.relative(root, resolved).replace(/\\/g, '/');
  const writeScope = normalizeWriteScope(workingDirectory, pkg.writeScope);
  if (!isPathWithinScope(root, scopedRel, writeScope)) {
    rejectOutOfScope(rel);
  }
  return resolved;
}

async function applyParsedEdits(input: {
  pkg: ExecutorTaskPackage;
  parsed: ParsedEdits;
  workingDirectory: string;
  evidenceDir: string;
  parseEditsHook?: (text: string) => ParsedEdits;
}): Promise<{ changedFiles: string[]; summary: string }> {
  const { pkg, parsed, workingDirectory, evidenceDir } = input;
  const planned = parsed.edits.map((edit) => {
    const target = resolveSafeTargetPath(pkg, workingDirectory, edit.path);
    const rel = path.relative(workingDirectory, target).replace(/\\/g, '/');
    return { edit, target, rel };
  });
  const changedFiles: string[] = [];
  for (const item of planned) {
    if (item.edit.content === null) {
      await fs.rm(item.target, { force: true });
      changedFiles.push(item.rel);
      continue;
    }
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    await fs.writeFile(item.target, String(item.edit.content), 'utf8');
    changedFiles.push(item.rel);
  }
  await fs.writeFile(
    path.join(evidenceDir, 'model-edits.json'),
    JSON.stringify({ edits: parsed.edits, summary: parsed.summary || '' }, null, 2),
    'utf8',
  );
  return { changedFiles, summary: parsed.summary || '' };
}

async function readScopeFiles(input: {
  pkg: ExecutorTaskPackage;
  evidenceDir: string;
  hook?: (i: { pkg: ExecutorTaskPackage; evidenceDir: string }) => Promise<Array<{ rel: string; content: string }>>;
}): Promise<Array<{ rel: string; content: string }>> {
  if (input.hook) return input.hook({ pkg: input.pkg, evidenceDir: input.evidenceDir });
  const pkg = input.pkg;
  const root = path.resolve(pkg.workingDirectory);
  const out: Array<{ rel: string; content: string }> = [];
  let totalBytes = 0;
  const candidates: string[] = [];
  try {
    await walkFiles(root, root, pkg.writeScope, candidates, MAX_SCOPE_FILES);
  } catch {
    /* 读取失败不阻断；能力不足时如实呈现 */
  }
  for (const file of candidates) {
    if (out.length >= MAX_SCOPE_FILES) break;
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_SCOPE_FILE_BYTES) continue;
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const content = await fs.readFile(file, 'utf8');
      if (totalBytes + content.length > MAX_SCOPE_BYTES) break;
      totalBytes += content.length;
      out.push({ rel, content });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

async function walkFiles(
  root: string,
  dir: string,
  writeScope: string[],
  acc: string[],
  limit: number,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const scopes = normalizeWriteScope(root, writeScope);
  for (const entry of entries) {
    if (acc.length >= limit) return;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (/^\.git$|node_modules|^dist$|^build$|^\.venv$|^venv$/i.test(entry.name)) continue;
      const mayContain =
        scopes.includes('.') ||
        scopes.some((s) => rel === s || rel.startsWith(`${s}/`) || s.startsWith(`${rel}/`));
      if (!mayContain) continue;
      await walkFiles(root, full, writeScope, acc, limit);
    } else if (entry.isFile()) {
      if (/^(package-lock\.json|\.env|\.env\..+|.*\.png|.*\.jpg|.*\.jpeg|.*\.gif|.*\.ico)$/i.test(entry.name)) {
        continue;
      }
      if (!isPathWithinScope(root, rel, scopes)) continue;
      acc.push(full);
    }
  }
}

function inferWorkingDirectory(input: CapabilityInput): string | null {
  for (const item of input.snapshot.items || []) {
    const p = String(item.sourcePath || '');
    if (!p) continue;
    if (item.kind === 'folder-entry') {
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

function mapModelError(error: ModelHttpError): Error {
  const message = scrubSecrets(error.message);
  const stage = error.kind === 'unauthorized' || error.kind === 'bad_request' ? 'capability' : 'model';
  return Object.assign(new Error(message), {
    stage: stage as 'capability' | 'model',
    actionable: actionableFor(error.kind),
    kind: error.kind,
    status: error.status,
  });
}

function actionableFor(kind: ModelHttpError['kind']): string {
  switch (kind) {
    case 'unauthorized':
      return '请检查模型凭证是否有效';
    case 'rate_limited':
      return '请求过于频繁，请稍后再试';
    case 'timeout':
      return '模型响应超时，请重试或简化目标';
    case 'server_error':
      return '模型服务暂时不可用，请稍后重试';
    case 'bad_response':
      return '模型返回无法解析，请重试';
    case 'network':
      return '网络连接失败，请检查网络后重试';
    default:
      return '请检查请求后重试';
  }
}

function scrubSecrets(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]')
    .slice(0, 400);
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
