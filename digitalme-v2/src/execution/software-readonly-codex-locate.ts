/**
 * Codex 只读定位 — 在修改前用 read-only sandbox 分析相关文件。
 * 不得写入目标仓；失败时安全降级为 null（由本地扫描接手）。
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  buildCodexExecArgs,
  resolveCodexJs,
} from '../capability/adapters/external-executor-codex';
import { buildMinimalExecutorEnv, resolveNodeExecutable } from './minimal-env';
import {
  extractGoalHints,
  type BuildSoftwareTaskUnderstandingInput,
  type ReadOnlyLocateHint,
} from './software-task-understanding';

/** 大仓语义定位默认超时（确认卡 / 改码前共用）。 */
export const READONLY_CODEX_LOCATE_TIMEOUT_MS = 180_000;

/** 大仓语义定位常需 1–3 分钟；过短会在确认卡阶段误报「尚未定位」。 */
const DEFAULT_TIMEOUT_MS = READONLY_CODEX_LOCATE_TIMEOUT_MS;

const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.rb',
  '.php',
  '.swift',
  '.vue',
  '.svelte',
]);

export type LocateWithReadonlyCodexInput = {
  goal: string;
  workingDirectory: string;
  root?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  codexJsPath?: string;
  /** 测试注入 */
  execHook?: (args: {
    prompt: string;
    argv: string[];
    workingDirectory: string;
  }) => Promise<string>;
  reportProgress?: (msg: string) => void;
};

export type ValidateLocatePathResult =
  | { ok: true; path: string; reason: string }
  | { ok: false; reason: string };

function isTestPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    /(^|\/)(?:tests?|__tests__|spec)(\/|$)/.test(lower) || /\.(?:test|spec)\.[^.]+$/.test(lower)
  );
}

function isSourceOrTest(rel: string): boolean {
  const ext = path.posix.extname(rel).toLowerCase();
  return SOURCE_EXT.has(ext) || isTestPath(rel);
}

function isConfigNoiseBasename(rel: string): boolean {
  const base = path.posix.basename(rel).toLowerCase();
  return (
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'pnpm-lock.yaml' ||
    base === 'yarn.lock' ||
    base === 'readme.md' ||
    base === 'readme' ||
    base === 'tsconfig.json' ||
    base === 'jsconfig.json' ||
    base === 'cargo.toml' ||
    base === 'go.mod' ||
    base === 'pyproject.toml' ||
    base === 'changelog.md' ||
    base === 'license' ||
    base === 'license.md'
  );
}

function goalMentionsConfig(goal: string): boolean {
  const hints = extractGoalHints(goal);
  return (
    hints.basenames.some((b) => isConfigNoiseBasename(b)) ||
    hints.terms.some((t) =>
      /package\.json|readme|依赖|脚本|配置|tsconfig|cargo|go\.mod/i.test(t),
    ) ||
    /package\.json|readme|依赖|脚本|tsconfig|配置/i.test(goal)
  );
}

function resolveInsideRoot(root: string, rel: string): string | null {
  const normalized = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
  if (!normalized || path.isAbsolute(normalized) || normalized.includes('..')) {
    return null;
  }
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, ...normalized.split('/'));
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (abs !== rootResolved && !abs.startsWith(prefix)) return null;
  return abs;
}

/** 本地校验相对路径：防越界、须为文件、与目标相关或模糊目标下的源码/测试。 */
export async function validateLocatePath(
  root: string,
  rel: string,
  goal: string,
  reasonHint?: string,
): Promise<ValidateLocatePathResult> {
  const normalized = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
  if (!normalized) return { ok: false, reason: 'empty_path' };
  if (path.isAbsolute(normalized) || normalized.includes('..')) {
    return { ok: false, reason: 'path_escape' };
  }
  const abs = resolveInsideRoot(root, normalized);
  if (!abs) return { ok: false, reason: 'path_escape' };

  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not_file' };

  const posixRel = path.relative(path.resolve(root), abs).split(path.sep).join('/');
  if (!posixRel || posixRel.startsWith('..')) {
    return { ok: false, reason: 'path_escape' };
  }

  if (isConfigNoiseBasename(posixRel) && !goalMentionsConfig(goal)) {
    return { ok: false, reason: 'config_noise' };
  }

  const hints = extractGoalHints(goal);
  const reason = String(reasonHint || '').trim();
  let content = '';
  try {
    const buf = await fs.readFile(abs, 'utf8');
    content = buf.length > 64_000 ? buf.slice(0, 64_000) : buf;
  } catch {
    content = '';
  }

  const lowerRel = posixRel.toLowerCase();
  const lowerContent = content.toLowerCase();
  let hit = false;
  for (const sym of hints.symbols) {
    if (content.includes(sym) || lowerRel.includes(sym.toLowerCase())) {
      hit = true;
      break;
    }
  }
  if (!hit) {
    for (const term of hints.terms) {
      const t = term.toLowerCase();
      if (t.length >= 2 && (lowerRel.includes(t) || lowerContent.includes(t))) {
        hit = true;
        break;
      }
    }
  }
  for (const b of hints.basenames) {
    if (path.posix.basename(posixRel).toLowerCase() === b.toLowerCase()) {
      hit = true;
      break;
    }
  }
  for (const p of hints.paths) {
    const pp = p.replace(/\\/g, '/').toLowerCase();
    if (lowerRel === pp || lowerRel.endsWith('/' + pp) || lowerRel.endsWith(pp)) {
      hit = true;
      break;
    }
  }

  // 模糊目标：无路径/符号命中时，允许 reason 非空且为源码/测试
  if (!hit) {
    if (reason && isSourceOrTest(posixRel)) {
      hit = true;
    }
  }

  if (!hit) return { ok: false, reason: 'unrelated' };
  return {
    ok: true,
    path: posixRel,
    reason: reason || '只读分析提示',
  };
}

function gitPorcelain(cwd: string): string | null {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 15_000,
    });
    if (r.status !== 0) return null;
    return String(r.stdout || '');
  } catch {
    return null;
  }
}

function hasNewDirty(before: string | null, after: string | null): boolean {
  if (before == null || after == null) return false;
  const beforeSet = new Set(
    before
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean),
  );
  for (const line of after.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)) {
    if (!beforeSet.has(line)) return true;
  }
  return false;
}

function buildReadonlyLocatePrompt(goal: string): string {
  return [
    '你是只读代码定位助手。严格遵守：',
    '1. 只读分析当前工作目录中的代码；禁止修改任何文件。',
    '2. 禁止运行 git、禁止写入、禁止创建/删除文件。',
    '3. 输出必须且仅能为一个 JSON 对象（不要 Markdown 代码围栏，不要其它说明文字），格式如下：',
    '{"files":[{"path":"相对路径","reason":"...","symbols":["..."]}],"symbols":[],"proposedTests":[],"rationale":"...","plan":["..."]}',
    '4. files[].path 必须是工作目录内已存在的相对路径；不确定则少报或不报。',
    '',
    `用户目标：${String(goal || '').slice(0, 800)}`,
  ].join('\n');
}

function tryParseJsonObject(text: string): unknown | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates: string[] = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  // JSONL：从后往前找可解析对象
  const lines = raw.split(/\r?\n/).reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const obj = JSON.parse(t) as { type?: string; message?: string; last_agent_message?: string };
      if (typeof obj.message === 'string' && obj.message.includes('{')) {
        const nested = tryParseJsonObject(obj.message);
        if (nested) return nested;
      }
      if (typeof obj.last_agent_message === 'string') {
        const nested = tryParseJsonObject(obj.last_agent_message);
        if (nested) return nested;
      }
      if (Array.isArray((obj as { files?: unknown }).files)) return obj;
    } catch {
      /* continue */
    }
  }
  return null;
}

function asLocateHint(parsed: unknown): ReadOnlyLocateHint | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as {
    files?: Array<{ path?: string; reason?: string; symbols?: string[] }>;
    symbols?: string[];
    proposedTests?: string[];
    rationale?: string;
    plan?: string[];
  };
  if (!Array.isArray(o.files)) return null;
  const files = o.files
    .map((f) => ({
      path: String(f?.path || '').replace(/\\/g, '/'),
      reason: String(f?.reason || '').slice(0, 120),
      ...(Array.isArray(f?.symbols)
        ? { symbols: f!.symbols!.map(String).slice(0, 12) }
        : {}),
    }))
    .filter((f) => !!f.path);
  const symbols = [
    ...(Array.isArray(o.symbols) ? o.symbols.map(String) : []),
    ...files.flatMap((f) => ('symbols' in f && Array.isArray((f as { symbols?: string[] }).symbols)
      ? (f as { symbols: string[] }).symbols
      : [])),
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 24);
  return {
    files: files.map((f) => ({ path: f.path, reason: f.reason })),
    ...(symbols.length ? { symbols } : {}),
    ...(Array.isArray(o.proposedTests)
      ? { proposedTests: o.proposedTests.map(String).slice(0, 6) }
      : {}),
    ...(o.rationale ? { rationale: String(o.rationale).slice(0, 240) } : {}),
  };
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function spawnReadonlyCodex(input: {
  prompt: string;
  workingDirectory: string;
  evidenceDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
  codexJsPath?: string;
  reportProgress?: (msg: string) => void;
}): Promise<{ exitCode: number | null; text: string; argv: string[] }> {
  let codexJs: string;
  try {
    codexJs = input.codexJsPath || resolveCodexJs();
    await fs.access(codexJs);
  } catch {
    throw Object.assign(new Error('codex_unavailable'), { failureKind: 'spawn_failed' });
  }

  const lastMessagePath = path.join(input.evidenceDir, 'codex-last-message.txt');
  const argv = buildCodexExecArgs({
    codexJsPath: codexJs,
    workingDirectory: input.workingDirectory,
    lastMessagePath,
    sandbox: 'read-only',
  });
  const nodeExecutable = resolveNodeExecutable(process.env);
  const env = buildMinimalExecutorEnv(process.env, {
    ...(process.versions.electron && nodeExecutable === process.execPath
      ? { ELECTRON_RUN_AS_NODE: '1' }
      : {}),
  });

  input.reportProgress?.('正在理解项目');

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(nodeExecutable, argv, {
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
    }, input.timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    input.signal?.addEventListener('abort', onAbort);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000);
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
      input.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      let lastMessage = '';
      try {
        lastMessage = await fs.readFile(lastMessagePath, 'utf8');
      } catch {
        lastMessage = '';
      }
      const text = lastMessage || stdout || stderr;
      if (timedOut) {
        reject(Object.assign(new Error('timeout'), { failureKind: 'timeout' }));
        return;
      }
      if (input.signal?.aborted) {
        reject(Object.assign(new Error('aborted'), { failureKind: 'cancelled' }));
        return;
      }
      resolve({ exitCode: code, text, argv });
    });
  });
}

/** 单测默认不拉起真实 Codex；显式 DIGITALME_READONLY_CODEX_LOCATE=1 可放开。 */
function shouldSkipRealCodexSpawn(): boolean {
  if (process.env.DIGITALME_READONLY_CODEX_LOCATE === '1') return false;
  if (process.env.DIGITALME_READONLY_CODEX_LOCATE === '0') return true;
  // node:test 设置 NODE_TEST_CONTEXT，避免确认卡/闭环单测误跑真实模型
  return !!process.env.NODE_TEST_CONTEXT;
}

export async function locateWithReadonlyCodex(
  input: LocateWithReadonlyCodexInput,
): Promise<ReadOnlyLocateHint | null> {
  const workingDirectory = path.resolve(input.workingDirectory || input.root || '');
  if (!workingDirectory) return null;
  const goal = String(input.goal || '').trim();
  if (!goal) return null;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (input.signal?.aborted) return null;

  const beforeDirty = gitPorcelain(workingDirectory);
  const evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ro-locate-'));
  const prompt = buildReadonlyLocatePrompt(goal);

  try {
    let rawText = '';
    let exitCode: number | null = 0;
    const placeholderArgv = buildCodexExecArgs({
      codexJsPath: input.codexJsPath || 'codex.js',
      workingDirectory,
      lastMessagePath: path.join(evidenceDir, 'codex-last-message.txt'),
      sandbox: 'read-only',
    });

    if (input.execHook) {
      input.reportProgress?.('正在理解项目');
      const hookPromise = input.execHook({
        prompt,
        argv: placeholderArgv,
        workingDirectory,
      });
      const raced = await Promise.race([
        hookPromise.then((text) => ({ kind: 'ok' as const, text })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          const t = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
          input.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            resolve({ kind: 'timeout' });
          });
        }),
      ]);
      if (raced.kind === 'timeout') return null;
      rawText = raced.text;
      exitCode = 0;
    } else if (shouldSkipRealCodexSpawn()) {
      return null;
    } else {
      try {
        const spawned = await spawnReadonlyCodex({
          prompt,
          workingDirectory,
          evidenceDir,
          timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.codexJsPath ? { codexJsPath: input.codexJsPath } : {}),
          ...(input.reportProgress ? { reportProgress: input.reportProgress } : {}),
        });
        rawText = spawned.text;
        exitCode = spawned.exitCode;
      } catch {
        return null;
      }
    }

    if (exitCode !== 0) return null;

    const parsed = tryParseJsonObject(rawText);
    const hint = asLocateHint(parsed);
    if (!hint?.files?.length) return null;

    const validated: Array<{ path: string; reason: string }> = [];
    const symbols = new Set<string>(hint.symbols || []);
    for (const f of hint.files) {
      const v = await validateLocatePath(workingDirectory, f.path, goal, f.reason);
      if (!v.ok) continue;
      validated.push({ path: v.path, reason: v.reason });
    }
    if (!validated.length) return null;

    // 只读隔离：相对调用前若出现新 dirty，判定失败
    const afterDirty = gitPorcelain(workingDirectory);
    if (hasNewDirty(beforeDirty, afterDirty)) {
      return null;
    }

    return {
      files: validated.slice(0, 12),
      ...(symbols.size ? { symbols: [...symbols].slice(0, 24) } : {}),
      ...(hint.proposedTests?.length ? { proposedTests: hint.proposedTests } : {}),
      ...(hint.rationale ? { rationale: hint.rationale } : {}),
    };
  } catch {
    return null;
  } finally {
    await cleanupDir(evidenceDir);
  }
}

export type AsReadOnlyLocateHookOptions = {
  timeoutMs?: number;
  codexJsPath?: string;
  execHook?: LocateWithReadonlyCodexInput['execHook'];
  reportProgress?: (msg: string) => void;
};

export function asReadOnlyLocateHook(
  opts: AsReadOnlyLocateHookOptions = {},
): NonNullable<BuildSoftwareTaskUnderstandingInput['readOnlyLocate']> {
  return async (input) => {
    return locateWithReadonlyCodex({
      goal: input.goal,
      workingDirectory: input.workingDirectory,
      root: input.root,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(opts.codexJsPath ? { codexJsPath: opts.codexJsPath } : {}),
      ...(opts.execHook ? { execHook: opts.execHook } : {}),
      ...(opts.reportProgress ? { reportProgress: opts.reportProgress } : {}),
    });
  };
}
