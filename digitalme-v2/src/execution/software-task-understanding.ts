/**
 * 软件任务理解 — modify 前有界只读扫描，产出可审计的目标/方案/风险摘要。
 * 禁止绝对路径写入对外文案；不调用模型、不写目标仓。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type SoftwareTaskUnderstanding = {
  schemaVersion: 'software-task-understanding/1';
  goal: string;
  keyFiles: Array<{ path: string; reason: string }>;
  symbols: string[];
  proposedTests: string[];
  planSteps: string[];
  risks: string[];
  subjectConstraints: string[];
};

const MAX_DEPTH = 4;
const MAX_FILES_SCANNED = 120;
const MAX_FILE_BYTES = 48_000;
const MAX_KEY_FILES = 12;
const MAX_SYMBOLS = 24;
const MAX_PLAN_STEPS = 7;
const MAX_RISKS = 8;
const MAX_CONSTRAINTS = 8;

const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
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

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

function looksImportant(rel: string): { score: number; reason: string } {
  const lower = rel.toLowerCase();
  const base = path.posix.basename(lower);
  if (base === 'package.json') return { score: 100, reason: '项目依赖与脚本配置' };
  if (base === 'readme.md' || base === 'readme') return { score: 90, reason: '项目说明' };
  if (base === 'tsconfig.json' || base === 'jsconfig.json') return { score: 85, reason: '编译配置' };
  if (base === 'cargo.toml' || base === 'go.mod' || base === 'pyproject.toml') {
    return { score: 85, reason: '语言项目配置' };
  }
  if (/^src\/(index|main|app)\./.test(lower) || /^(index|main|app)\./.test(base)) {
    return { score: 80, reason: '可能的入口文件' };
  }
  if (/test|spec|__tests__/.test(lower)) return { score: 55, reason: '测试相关文件' };
  if (SOURCE_EXT.has(path.posix.extname(lower))) return { score: 40, reason: '源代码文件' };
  return { score: 10, reason: '相关文件' };
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
  // 去掉可能泄漏的绝对路径
  const cleaned = t
    .replace(/[A-Za-z]:\\[^\s]+/g, '[项目内路径]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, '[项目内路径]')
    .slice(0, 200);
  if (!cleaned) return null;
  return cleaned;
}

function buildPlanSteps(input: {
  goal: string;
  keyFiles: Array<{ path: string; reason: string }>;
  proposedTests: string[];
  subjectConstraints: string[];
  revisionRequest?: string;
}): string[] {
  const steps: string[] = [];
  steps.push(`明确目标：${input.goal.slice(0, 160)}`);
  if (input.keyFiles.length) {
    steps.push(
      `阅读关键文件：${input.keyFiles
        .slice(0, 5)
        .map((f) => f.path)
        .join('、')}`,
    );
  } else {
    steps.push('阅读项目说明与主要入口，确认改动位置');
  }
  if (input.subjectConstraints.length) {
    steps.push(`遵守已确认偏好与边界：${input.subjectConstraints.slice(0, 2).join('；')}`);
  }
  if (input.revisionRequest) {
    steps.push(`按本次修订要求调整：${input.revisionRequest.slice(0, 120)}`);
  } else {
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
  keyFiles: Array<{ path: string; reason: string }>;
  proposedTests: string[];
  hasPackageJson: boolean;
  scannedTruncated: boolean;
}): string[] {
  const risks: string[] = [];
  if (!input.hasPackageJson) {
    risks.push('未发现 package.json，测试与构建命令可能需要按项目类型另行确认');
  }
  if (!input.proposedTests.length) {
    risks.push('暂未识别到明确的测试脚本，改动后可能缺少自动验证');
  }
  if (input.scannedTruncated) {
    risks.push('项目文件较多，理解基于有界扫描，可能未覆盖全部模块');
  }
  if (input.keyFiles.some((f) => /package\.json|lock/i.test(f.path))) {
    risks.push('涉及依赖或脚本配置时需避免无关升级');
  }
  if (!risks.length) {
    risks.push('改动可能影响现有行为，采用前请核对关键路径与测试结果');
  }
  return risks.slice(0, MAX_RISKS);
}

export async function buildSoftwareTaskUnderstanding(input: {
  goal: string;
  workingDirectory: string;
  subjectDecisionBriefs?: string[];
  revisionRequest?: string;
}): Promise<SoftwareTaskUnderstanding> {
  const goal = String(input.goal || '').trim().slice(0, 800);
  const root = path.resolve(input.workingDirectory);
  const subjectConstraints = (input.subjectDecisionBriefs || [])
    .map(normalizeConstraint)
    .filter((x): x is string => !!x)
    .slice(0, MAX_CONSTRAINTS);

  const absFiles: string[] = [];
  try {
    await walkBounded(root, root, 0, absFiles);
  } catch {
    /* empty project ok */
  }
  const scannedTruncated = absFiles.length >= MAX_FILES_SCANNED;

  const scored: Array<{ path: string; reason: string; score: number; abs: string }> = [];
  let packageJsonRaw = '';
  const symbols: string[] = [];
  const symbolSeen = new Set<string>();

  for (const abs of absFiles) {
    const rel = toPosixRel(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    const { score, reason } = looksImportant(rel);
    if (score < 35 && scored.length > 40) continue;
    scored.push({ path: rel, reason, score, abs });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const keyFiles: Array<{ path: string; reason: string }> = [];
  for (const item of scored) {
    if (keyFiles.length >= MAX_KEY_FILES) break;
    keyFiles.push({ path: item.path, reason: item.reason });
    if (item.path === 'package.json' || item.path.endsWith('/package.json')) {
      try {
        const st = await fs.stat(item.abs);
        if (st.size <= MAX_FILE_BYTES) {
          packageJsonRaw = await fs.readFile(item.abs, 'utf8');
        }
      } catch {
        /* ignore */
      }
    } else if (SOURCE_EXT.has(path.posix.extname(item.path)) && symbols.length < MAX_SYMBOLS) {
      try {
        const st = await fs.stat(item.abs);
        if (st.size > MAX_FILE_BYTES) continue;
        const text = await fs.readFile(item.abs, 'utf8');
        for (const s of extractSymbols(text)) {
          if (symbolSeen.has(s)) continue;
          symbolSeen.add(s);
          symbols.push(s);
          if (symbols.length >= MAX_SYMBOLS) break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const proposedTests = packageJsonRaw
    ? scriptsFromPackageJson(packageJsonRaw)
    : ['若存在测试命令则运行并报告结果'];

  const planSteps = buildPlanSteps({
    goal,
    keyFiles,
    proposedTests,
    subjectConstraints,
    ...(input.revisionRequest ? { revisionRequest: String(input.revisionRequest).slice(0, 400) } : {}),
  });

  const risks = buildRisks({
    keyFiles,
    proposedTests: packageJsonRaw ? scriptsFromPackageJson(packageJsonRaw) : [],
    hasPackageJson: !!packageJsonRaw,
    scannedTruncated,
  });

  return {
    schemaVersion: 'software-task-understanding/1',
    goal,
    keyFiles,
    symbols: symbols.slice(0, MAX_SYMBOLS),
    proposedTests: proposedTests.slice(0, 6),
    planSteps,
    risks,
    subjectConstraints,
  };
}

/** 将理解结果拼入执行器项目背景（相对路径，无绝对路径）。 */
export function formatUnderstandingForBrief(u: SoftwareTaskUnderstanding): string {
  const lines = [
    `目标：${u.goal}`,
    u.keyFiles.length
      ? `关键文件：${u.keyFiles.map((f) => `${f.path}（${f.reason}）`).join('；')}`
      : '关键文件：尚未识别到明确入口',
    u.symbols.length ? `相关符号：${u.symbols.slice(0, 12).join(', ')}` : '',
    u.proposedTests.length ? `建议检查：${u.proposedTests.join('；')}` : '',
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

/** 确认卡轻量摘要行（用户面）。 */
export function formatUnderstandingSummaryLines(u: SoftwareTaskUnderstanding): string[] {
  const lines: string[] = [];
  if (u.keyFiles.length) {
    lines.push(`将重点查看：${u.keyFiles.slice(0, 5).map((f) => f.path).join('、')}`);
  }
  if (u.proposedTests.length) {
    lines.push(`可能运行：${u.proposedTests.slice(0, 3).join('；')}`);
  }
  if (u.planSteps.length) {
    lines.push(`方案：${u.planSteps.slice(0, 3).join(' → ')}`);
  }
  return lines.slice(0, 6);
}
