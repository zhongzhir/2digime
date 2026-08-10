/**
 * 软件任务理解 — modify 前有界只读扫描。
 * 关键文件按「用户目标相关性」排序，禁止仅凭 package.json/README 固定分冒充理解。
 * 无法可靠定位时显式标记 unreliable，不得用通用文件列表伪装成功。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type SoftwareTaskUnderstandingReliability = 'reliable' | 'unreliable';

export type SoftwareTaskUnderstanding = {
  schemaVersion: 'software-task-understanding/1';
  goal: string;
  keyFiles: Array<{ path: string; reason: string }>;
  symbols: string[];
  proposedTests: string[];
  planSteps: string[];
  risks: string[];
  subjectConstraints: string[];
  /** 是否定位到与目标语义相关的实现位置 */
  reliability: SoftwareTaskUnderstandingReliability;
  /** 不可靠时的用户面说明（中性、无内部字段名） */
  reliabilityMessage?: string;
};

/** 可选：只读模型/Codex 定位提示（不得写目标仓）。 */
export type ReadOnlyLocateHint = {
  files?: Array<{ path: string; reason?: string }>;
  symbols?: string[];
  proposedTests?: string[];
  rationale?: string;
};

export type BuildSoftwareTaskUnderstandingInput = {
  goal: string;
  workingDirectory: string;
  subjectDecisionBriefs?: string[];
  revisionRequest?: string;
  /** 复用真实模型/Codex 只读分析的可选注入；失败则回退本地目标相关扫描 */
  readOnlyLocate?: (
    input: BuildSoftwareTaskUnderstandingInput & { root: string },
  ) => Promise<ReadOnlyLocateHint | null | undefined>;
};

const MAX_DEPTH = 8;
const MAX_FILES_SCANNED = 220;
const MAX_FILE_BYTES = 64_000;
const MAX_KEY_FILES = 12;
const MAX_SYMBOLS = 24;
const MAX_PLAN_STEPS = 7;
const MAX_RISKS = 8;
const MAX_CONSTRAINTS = 8;
/** 达到该分才视为「与目标相关」的实现命中 */
const RELIABLE_SCORE = 220;

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

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.cache',
  'vendor',
  '__pycache__',
  '.turbo',
  '.venv',
  'venv',
]);

const SYMBOL_RE =
  /(?:export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+|^(?:async\s+)?(?:function|class)\s+|def\s+|^\s*(?:pub\s+)?(?:fn|struct|enum|impl)\s+)([A-Za-z_][\w]*)/gm;

const STOP_TERMS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'when',
  'then',
  'else',
  'function',
  'string',
  'number',
  'return',
  'export',
  'import',
  'const',
  'class',
  'async',
  'await',
  'true',
  'false',
  'null',
  'undefined',
  '请',
  '把',
  '将',
  '一个',
  '以及',
  '或者',
  '进行',
  '需要',
  '可以',
  '不要',
  '不能',
  '实现',
  '添加',
  '增加',
  '修改',
  '更新',
  '创建',
  '项目',
  '文件',
  '代码',
  '功能',
]);

export type GoalHints = {
  paths: string[];
  basenames: string[];
  symbols: string[];
  terms: string[];
};

export function extractGoalHints(goal: string): GoalHints {
  const raw = String(goal || '');
  const paths = new Set<string>();
  const basenames = new Set<string>();
  const symbols = new Set<string>();
  const terms = new Set<string>();

  for (const m of raw.matchAll(
    /(?:^|[\s"'`(（【[])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?=$|[\s"'`)）\]】,;:：])/g,
  )) {
    const p = m[1]!.replace(/\\/g, '/');
    paths.add(p);
    basenames.add(path.posix.basename(p));
  }
  for (const m of raw.matchAll(
    /(?:^|[\s"'`(（【[])([\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|md|json))(?=$|[\s"'`)）\]】,;:：])/g,
  )) {
    basenames.add(m[1]!);
  }
  for (const m of raw.matchAll(/\b([A-Za-z_][A-Za-z0-9]*)\s*\(/g)) {
    if (m[1]!.length >= 2) symbols.add(m[1]!);
  }
  for (const m of raw.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[a-z]+(?:[A-Z][a-z0-9]+)+)\b/g)) {
    if (m[1]!.length >= 3) symbols.add(m[1]!);
  }
  // 中文/英文功能词（去掉停用）
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
    const t = m[0]!;
    const lower = t.toLowerCase();
    if (STOP_TERMS.has(lower) || STOP_TERMS.has(t)) continue;
    if (/^(src|dist|test|tests|spec|lib|app|main|index)$/i.test(t)) continue;
    terms.add(t.length > 24 ? t.slice(0, 24) : t);
  }

  return {
    paths: [...paths].slice(0, 12),
    basenames: [...basenames].slice(0, 16),
    symbols: [...symbols].slice(0, 24),
    terms: [...terms].slice(0, 40),
  };
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** 有界 walk 可能截断；目标点名路径必须单独解析进候选集（只读）。 */
async function ensureHintedPathsOnDisk(
  root: string,
  hints: GoalHints,
  relToAbs: Map<string, string>,
): Promise<void> {
  const candidates = new Set<string>();
  for (const p of hints.paths) {
    candidates.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  for (const b of hints.basenames) {
    if (b.includes('/')) candidates.add(b.replace(/\\/g, '/'));
  }
  for (const rel of candidates) {
    if (!rel || path.isAbsolute(rel) || rel.includes('..')) continue;
    if (relToAbs.has(rel)) continue;
    const abs = path.resolve(root, ...rel.split('/'));
    const rootResolved = path.resolve(root);
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
    if (abs !== rootResolved && !abs.startsWith(prefix)) continue;
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) relToAbs.set(rel, abs);
    } catch {
      /* missing ok */
    }
  }
}

function isConfigNoise(rel: string, hints: GoalHints): boolean {
  const base = path.posix.basename(rel).toLowerCase();
  const goalMentionsConfig =
    hints.basenames.some((b) => b.toLowerCase() === base) ||
    hints.terms.some((t) =>
      /package\.json|readme|依赖|脚本|配置|tsconfig|cargo|go\.mod/i.test(t),
    ) ||
    /package\.json|readme|依赖|脚本|tsconfig/i.test(hints.paths.join(' '));
  if (goalMentionsConfig) return false;
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

function isTestPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  return /(^|\/)(?:tests?|__tests__|spec)(\/|$)/.test(lower) || /\.(?:test|spec)\.[^.]+$/.test(lower);
}

async function walkBounded(
  root: string,
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES_SCANNED) return;
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as typeof entries;
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (out.length >= MAX_FILES_SCANNED) return;
    const name = ent.name;
    if (name.startsWith('.') && name !== '.env.example') {
      if (ent.isDirectory() && name !== '.github') continue;
    }
    const abs = path.join(dir, name);
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(name)) continue;
      await walkBounded(root, abs, depth + 1, out);
    } else if (ent.isFile()) {
      out.push(abs);
    }
  }
}

function extractSymbols(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  SYMBOL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SYMBOL_RE.exec(text)) !== null) {
    const name = m[1]!;
    if (seen.has(name) || name.length < 2) continue;
    seen.add(name);
    found.push(name);
    if (found.length >= MAX_SYMBOLS) break;
  }
  return found;
}

function scriptsFromPackageJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts || {};
    const preferred = ['test', 'test:unit', 'lint', 'typecheck', 'build', 'check'];
    const out: string[] = [];
    for (const key of preferred) {
      if (scripts[key]) out.push(`npm run ${key}`);
    }
    for (const key of Object.keys(scripts)) {
      if (out.length >= 6) break;
      if (preferred.includes(key)) continue;
      if (/test|lint|check|build|verify/i.test(key)) out.push(`npm run ${key}`);
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeConstraint(brief: string): string | null {
  const t = String(brief || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const cleaned = t
    .replace(/[A-Za-z]:\\[^\s]+/g, '[项目内路径]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, '[项目内路径]')
    .slice(0, 200);
  if (!cleaned) return null;
  return cleaned;
}

function scoreFileAgainstGoal(input: {
  rel: string;
  content: string;
  hints: GoalHints;
}): { score: number; reasons: string[]; symbolHits: string[] } {
  const { rel, content, hints } = input;
  const lowerRel = rel.toLowerCase();
  const base = path.posix.basename(rel);
  const baseLower = base.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const symbolHits: string[] = [];

  for (const p of hints.paths) {
    const pp = p.replace(/\\/g, '/').toLowerCase();
    if (lowerRel === pp || lowerRel.endsWith('/' + pp) || lowerRel.endsWith(pp)) {
      score += 1000;
      reasons.push(`目标点名路径 ${p}`);
    } else if (pp.endsWith('/' + lowerRel) || pp.endsWith(baseLower)) {
      score += 700;
      reasons.push(`目标路径指向 ${base}`);
    }
  }

  for (const b of hints.basenames) {
    if (baseLower === b.toLowerCase()) {
      score += 520;
      reasons.push(`目标点名文件 ${b}`);
    }
  }

  for (const sym of hints.symbols) {
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const defRe = new RegExp(
      `(?:export\\s+(?:async\\s+)?(?:function|const|class|type|interface)\\s+|\\bfunction\\s+)${escaped}\\b`,
    );
    if (defRe.test(content)) {
      score += 420;
      symbolHits.push(sym);
      reasons.push(`内容含目标符号 ${sym}`);
    } else if (content.includes(sym)) {
      // 仅提及（脚本/文档/测试夹具）不得单独冒充可靠实现定位
      score += 160;
      symbolHits.push(sym);
      reasons.push(`内容提及符号 ${sym}`);
    }
  }

  let termHits = 0;
  let termBonus = 0;
  for (const term of hints.terms) {
    const t = term.toLowerCase();
    if (t.length < 2) continue;
    if (lowerRel.includes(t) || content.toLowerCase().includes(t)) {
      termHits += 1;
      termBonus += 28;
    }
  }
  score += Math.min(140, termBonus);
  if (termHits >= 2) reasons.push('路径或内容命中多个目标关键词');

  if (isTestPath(rel)) {
    // 测试文件：若 basename/符号/路径与目标相关则额外加分，否则不因「是测试」本身抬高
    if (score >= 200) {
      score += 160;
      reasons.push('相关测试文件');
    }
  }

  // 配置噪声：无目标提及则大幅降权（可为负）
  if (isConfigNoise(rel, hints)) {
    score -= 800;
  }

  // 去重 reason
  const uniqReasons = [...new Set(reasons)].slice(0, 4);
  return { score, reasons: uniqReasons, symbolHits: [...new Set(symbolHits)] };
}

function relatedTestBoost(
  rel: string,
  implHits: Set<string>,
): { score: number; reason?: string } {
  if (!isTestPath(rel) || implHits.size === 0) return { score: 0 };
  const base = path.posix.basename(rel).toLowerCase().replace(/\.(test|spec)\.[^.]+$/, '');
  const stem = base.replace(/\.[^.]+$/, '');
  for (const impl of implHits) {
    const implBase = path.posix.basename(impl).toLowerCase().replace(/\.[^.]+$/, '');
    if (stem.includes(implBase) || implBase.includes(stem) || rel.includes(implBase)) {
      return { score: 240, reason: `与实现 ${impl} 对应的测试` };
    }
    // ids.ts ↔ ids-clamp-string.test.ts
    const implStem = implBase.split(/[-_.]/)[0] || implBase;
    if (implStem.length >= 2 && stem.includes(implStem)) {
      return { score: 220, reason: `与实现 ${impl} 相关的测试` };
    }
  }
  return { score: 0 };
}

function buildPlanSteps(input: {
  goal: string;
  keyFiles: Array<{ path: string; reason: string }>;
  proposedTests: string[];
  subjectConstraints: string[];
  revisionRequest?: string;
  reliable: boolean;
}): string[] {
  const steps: string[] = [];
  steps.push(`明确目标：${input.goal.slice(0, 160)}`);
  if (!input.reliable) {
    steps.push('尚未定位到可靠改动位置；先只读核对仓库后再决定是否改动');
  } else {
    steps.push(
      `阅读相关实现：${input.keyFiles
        .filter((f) => !isTestPath(f.path))
        .slice(0, 4)
        .map((f) => f.path)
        .join('、') || input.keyFiles.slice(0, 4).map((f) => f.path).join('、')}`,
    );
    const tests = input.keyFiles.filter((f) => isTestPath(f.path)).slice(0, 3);
    if (tests.length) {
      steps.push(`核对相关测试：${tests.map((f) => f.path).join('、')}`);
    }
  }
  if (input.subjectConstraints.length) {
    steps.push(`遵守已确认偏好与边界：${input.subjectConstraints.slice(0, 2).join('；')}`);
  }
  if (input.revisionRequest) {
    steps.push(`按本次修订要求调整：${input.revisionRequest.slice(0, 120)}`);
  } else if (input.reliable) {
    steps.push('在授权范围内实施最小必要改动');
  }
  if (input.proposedTests.length) {
    steps.push(`运行检查：${input.proposedTests.slice(0, 3).join('；')}`);
  } else {
    steps.push('按项目现有方式运行可用测试或构建检查');
  }
  steps.push('整理变更摘要、风险与未完成事项，供你确认');
  return steps.slice(0, MAX_PLAN_STEPS);
}

function buildRisks(input: {
  reliable: boolean;
  proposedTests: string[];
  hasPackageJson: boolean;
  scannedTruncated: boolean;
  subjectConstraints: string[];
}): string[] {
  const risks: string[] = [];
  if (!input.reliable) {
    risks.push('尚未定位到可靠改动位置，若继续执行将主要依赖执行器自行探索，结果不确定性更高');
  }
  if (!input.hasPackageJson) {
    risks.push('未发现 package.json，测试与构建命令可能需要按项目类型另行确认');
  }
  if (!input.proposedTests.length) {
    risks.push('暂未识别到明确的测试脚本，改动后可能缺少自动验证');
  }
  if (input.scannedTruncated) {
    risks.push('项目文件较多，理解基于有界扫描，可能未覆盖全部模块');
  }
  if (input.subjectConstraints.length) {
    risks.push('须遵守已确认偏好与边界，避免越权改动');
  }
  if (!risks.length) {
    risks.push('改动可能影响现有行为，采用前请核对相关路径与测试结果');
  }
  return risks.slice(0, MAX_RISKS);
}

function mergeLocateHints(
  base: Array<{ path: string; reason: string; score: number }>,
  hint: ReadOnlyLocateHint | null | undefined,
  allRels: Set<string>,
): Array<{ path: string; reason: string; score: number }> {
  if (!hint?.files?.length) return base;
  const byPath = new Map(base.map((b) => [b.path, b]));
  for (const f of hint.files) {
    const p = String(f.path || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
    if (!p || path.isAbsolute(p) || p.includes('..')) continue;
    if (!allRels.has(p) && ![...allRels].some((r) => r.endsWith('/' + p) || r === p)) {
      // 未登记到候选集（通常因有界 walk 截断）；调用方应先 ensureLocateHintPathsOnDisk
      continue;
    }
    const resolved =
      allRels.has(p) ? p : [...allRels].find((r) => r.endsWith('/' + p) || r === p) || p;
    const reason = String(f.reason || '只读分析提示').slice(0, 80);
    const prev = byPath.get(resolved);
    if (prev) {
      // 只读定位命中优先于本地弱相关噪声
      prev.score = Math.max(prev.score + 600, 1200);
      prev.reason = `${reason}；${prev.reason}`.slice(0, 120);
    } else {
      byPath.set(resolved, { path: resolved, reason, score: 1200 });
    }
  }
  return [...byPath.values()];
}

/** 将只读定位返回的相对路径在磁盘上验证后并入候选（弥补有界 walk 截断）。 */
async function ensureLocateHintPathsOnDisk(
  root: string,
  hint: ReadOnlyLocateHint | null | undefined,
  relToAbs: Map<string, string>,
): Promise<void> {
  if (!hint?.files?.length) return;
  const rootResolved = path.resolve(root);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  for (const f of hint.files) {
    const rel = String(f.path || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .trim();
    if (!rel || path.isAbsolute(rel) || rel.includes('..')) continue;
    if (relToAbs.has(rel)) continue;
    const abs = path.resolve(rootResolved, ...rel.split('/'));
    if (abs !== rootResolved && !abs.startsWith(prefix)) continue;
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) relToAbs.set(rel, abs);
    } catch {
      /* missing / hallucinated */
    }
  }
}

export async function buildSoftwareTaskUnderstanding(
  input: BuildSoftwareTaskUnderstandingInput,
): Promise<SoftwareTaskUnderstanding> {
  const goal = String(input.goal || '').trim().slice(0, 800);
  const root = path.resolve(input.workingDirectory);
  const hints = extractGoalHints(goal);
  const subjectConstraints = (input.subjectDecisionBriefs || [])
    .map(normalizeConstraint)
    .filter((x): x is string => !!x)
    .slice(0, MAX_CONSTRAINTS);

  const absFiles: string[] = [];
  try {
    await walkBounded(root, root, 0, absFiles);
  } catch {
    /* empty ok */
  }
  const scannedTruncated = absFiles.length >= MAX_FILES_SCANNED;
  const relToAbs = new Map<string, string>();
  for (const abs of absFiles) {
    const rel = toPosixRel(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    relToAbs.set(rel, abs);
  }
  await ensureHintedPathsOnDisk(root, hints, relToAbs);
  let allRels = new Set(relToAbs.keys());

  let packageJsonRaw = '';
  const pkgAbs = relToAbs.get('package.json');
  if (pkgAbs) {
    try {
      const st = await fs.stat(pkgAbs);
      if (st.size <= MAX_FILE_BYTES) packageJsonRaw = await fs.readFile(pkgAbs, 'utf8');
    } catch {
      /* ignore */
    }
  }

  type Scored = {
    path: string;
    reason: string;
    score: number;
    symbolHits: string[];
  };
  const scored: Scored[] = [];
  const contentCache = new Map<string, string>();

  async function readContent(rel: string): Promise<string> {
    if (contentCache.has(rel)) return contentCache.get(rel)!;
    const abs = relToAbs.get(rel);
    if (!abs) return '';
    try {
      const st = await fs.stat(abs);
      if (st.size > MAX_FILE_BYTES) return '';
      const text = await fs.readFile(abs, 'utf8');
      contentCache.set(rel, text);
      return text;
    } catch {
      return '';
    }
  }

  // 先对可能相关的源码/测试读内容并打分；配置文件默认不进候选
  for (const rel of allRels) {
    const ext = path.posix.extname(rel).toLowerCase();
    const maybeSource = SOURCE_EXT.has(ext) || isTestPath(rel);
    const pathHinted =
      hints.paths.some((p) => rel.toLowerCase().includes(p.toLowerCase())) ||
      hints.basenames.some((b) => path.posix.basename(rel).toLowerCase() === b.toLowerCase());
    if (!maybeSource && !pathHinted) continue;
    if (isConfigNoise(rel, hints) && !pathHinted) continue;

    const content = maybeSource || pathHinted ? await readContent(rel) : '';
    const { score, reasons, symbolHits } = scoreFileAgainstGoal({ rel, content, hints });
    if (score < 80 && !pathHinted) continue;
    scored.push({
      path: rel,
      reason: reasons[0] || '与目标相关',
      score,
      symbolHits,
    });
  }

  // 可选只读模型/Codex 定位（不得写仓）
  let locateHint: ReadOnlyLocateHint | null | undefined;
  if (input.readOnlyLocate) {
    try {
      locateHint = await input.readOnlyLocate({ ...input, root });
    } catch {
      locateHint = null;
    }
  }

  // Codex 命中文件可能因有界 walk 未进入候选：磁盘验证后并入
  await ensureLocateHintPathsOnDisk(root, locateHint, relToAbs);
  allRels = new Set(relToAbs.keys());

  let merged = mergeLocateHints(
    scored.map((s) => ({ path: s.path, reason: s.reason, score: s.score })),
    locateHint,
    allRels,
  );

  // 实现命中后再抬相关测试
  const implHits = new Set(
    merged.filter((m) => m.score >= RELIABLE_SCORE && !isTestPath(m.path)).map((m) => m.path),
  );
  for (const rel of allRels) {
    if (!isTestPath(rel)) continue;
    const boost = relatedTestBoost(rel, implHits);
    if (!boost.score) continue;
    const existing = merged.find((m) => m.path === rel);
    if (existing) {
      existing.score += boost.score;
      if (boost.reason) existing.reason = boost.reason;
    } else {
      merged.push({
        path: rel,
        reason: boost.reason || '相关测试',
        score: boost.score + 80,
      });
    }
  }

  if (locateHint?.symbols?.length) {
    for (const s of locateHint.symbols) {
      for (const m of merged) {
        const content = contentCache.get(m.path) || '';
        if (content.includes(s)) m.score += 50;
      }
    }
  }

  merged.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const reliableHit = merged.find(
    (m) => m.score >= RELIABLE_SCORE && !isConfigNoise(m.path, hints),
  );
  const reliable = !!reliableHit;

  const keyFiles: Array<{ path: string; reason: string }> = [];
  if (reliable) {
    for (const item of merged) {
      if (keyFiles.length >= MAX_KEY_FILES) break;
      if (item.score < 120) continue;
      if (isConfigNoise(item.path, hints) && item.score < RELIABLE_SCORE) continue;
      keyFiles.push({ path: item.path, reason: item.reason });
    }
  }

  const symbols: string[] = [];
  const symbolSeen = new Set<string>();
  for (const sym of hints.symbols) {
    if (symbolSeen.has(sym)) continue;
    symbolSeen.add(sym);
    symbols.push(sym);
  }
  for (const f of keyFiles.slice(0, 8)) {
    const text = contentCache.get(f.path) || (await readContent(f.path));
    for (const s of extractSymbols(text)) {
      if (symbolSeen.has(s)) continue;
      symbolSeen.add(s);
      symbols.push(s);
      if (symbols.length >= MAX_SYMBOLS) break;
    }
    if (symbols.length >= MAX_SYMBOLS) break;
  }
  if (locateHint?.symbols) {
    for (const s of locateHint.symbols) {
      if (symbolSeen.has(s)) continue;
      symbolSeen.add(s);
      symbols.push(s);
    }
  }

  const proposedTests = [
    ...(locateHint?.proposedTests || []),
    ...(packageJsonRaw ? scriptsFromPackageJson(packageJsonRaw) : []),
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 6);
  if (!proposedTests.length) {
    proposedTests.push('若存在测试命令则运行并报告结果');
  }

  const planSteps = buildPlanSteps({
    goal,
    keyFiles,
    proposedTests,
    subjectConstraints,
    reliable,
    ...(input.revisionRequest
      ? { revisionRequest: String(input.revisionRequest).slice(0, 400) }
      : {}),
  });

  const risks = buildRisks({
    reliable,
    proposedTests: packageJsonRaw ? scriptsFromPackageJson(packageJsonRaw) : [],
    hasPackageJson: !!packageJsonRaw,
    scannedTruncated,
    subjectConstraints,
  });
  if (locateHint?.rationale && reliable) {
    risks.push(`只读分析补充：${String(locateHint.rationale).slice(0, 120)}`);
  }

  return {
    schemaVersion: 'software-task-understanding/1',
    goal,
    keyFiles: reliable ? keyFiles : [],
    symbols: symbols.slice(0, MAX_SYMBOLS),
    proposedTests,
    planSteps,
    risks: risks.slice(0, MAX_RISKS),
    subjectConstraints,
    reliability: reliable ? 'reliable' : 'unreliable',
    ...(reliable
      ? {}
      : { reliabilityMessage: '尚未定位到可靠改动位置' }),
  };
}

/** 将理解结果拼入执行器项目背景（相对路径，无绝对路径）。 */
export function formatUnderstandingForBrief(u: SoftwareTaskUnderstanding): string {
  if (u.reliability === 'unreliable') {
    const lines = [
      `目标：${u.goal}`,
      '理解结论：尚未定位到可靠改动位置（不得把通用配置文件当作改动依据）。',
      u.subjectConstraints.length
        ? `主体约束：${u.subjectConstraints.join('；')}`
        : '',
      '方案步骤：',
      ...u.planSteps.map((s, i) => `${i + 1}. ${s}`),
      '已知风险：',
      ...u.risks.map((r) => `- ${r}`),
    ].filter(Boolean);
    return lines.join('\n').slice(0, 3500);
  }
  const lines = [
    `目标：${u.goal}`,
    u.keyFiles.length
      ? `相关文件：${u.keyFiles.map((f) => `${f.path}（${f.reason}）`).join('；')}`
      : '相关文件：尚未识别',
    u.symbols.length ? `相关符号：${u.symbols.slice(0, 12).join(', ')}` : '',
    u.proposedTests.length ? `建议检查：${u.proposedTests.join('；')}` : '',
    u.subjectConstraints.length ? `主体约束：${u.subjectConstraints.join('；')}` : '',
    '方案步骤：',
    ...u.planSteps.map((s, i) => `${i + 1}. ${s}`),
    '已知风险：',
    ...u.risks.map((r) => `- ${r}`),
  ].filter(Boolean);
  return lines.join('\n').slice(0, 3500);
}

/** 确认卡轻量摘要行（用户面）。不可靠时不得列出通用文件冒充理解。 */
export function formatUnderstandingSummaryLines(u: SoftwareTaskUnderstanding): string[] {
  if (u.reliability === 'unreliable') {
    return [
      '尚未定位到可靠改动位置',
      '不会把 package.json、README 等通用文件当作本次改动的核心依据',
      ...(u.subjectConstraints.length
        ? [`已记录偏好与边界：${u.subjectConstraints.slice(0, 2).join('；')}`]
        : []),
    ].slice(0, 6);
  }
  const lines: string[] = [];
  const impl = u.keyFiles.filter((f) => !isTestPath(f.path)).slice(0, 5);
  const tests = u.keyFiles.filter((f) => isTestPath(f.path)).slice(0, 3);
  if (impl.length) {
    lines.push(`将重点查看：${impl.map((f) => f.path).join('、')}`);
  }
  if (tests.length) {
    lines.push(`相关测试：${tests.map((f) => f.path).join('、')}`);
  }
  if (u.proposedTests.length) {
    lines.push(`可能运行：${u.proposedTests.slice(0, 3).join('；')}`);
  }
  if (u.subjectConstraints.length) {
    lines.push(`须遵守：${u.subjectConstraints.slice(0, 2).join('；')}`);
  }
  if (u.planSteps.length) {
    lines.push(`方案：${u.planSteps.slice(0, 3).join(' → ')}`);
  }
  return lines.slice(0, 6);
}

export function isUnderstandingReliable(u: SoftwareTaskUnderstanding): boolean {
  return u.reliability === 'reliable' && u.keyFiles.length > 0;
}
