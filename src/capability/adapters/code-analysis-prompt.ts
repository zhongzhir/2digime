/**
 * 代码分析 Prompt 组装(P2.2)。
 * 只消费冻结 Snapshot 文本;按优先级选文件;总/单文件预算;全部 scrub。
 * 不访问 sourcePath,不读用户仓库。
 */
import { formatCapabilityTaskAndPlan, type CapabilityInput } from '../adapter';
import type { SnapshotItem } from '../../work-runtime/context-snapshot';
import type { ChatMessage } from '../../infrastructure/model-http';

export const CODE_PROMPT_TOTAL_CHARS = 28_000;
export const CODE_PROMPT_FILE_MAX_CHARS = 2_400;
export const CODE_PROMPT_INDEX_MAX_ENTRIES = 200;
export const CODE_PROMPT_EXPERIENCE_MAX_CHARS = 2_000;

export interface CodeFileSelection {
  relativePath: string;
  contentDigest: string;
  priority: number;
  charsUsed: number;
  truncated: boolean;
  text: string;
}

export interface AssembledCodeAnalysisPrompt {
  messages: ChatMessage[];
  selectedFiles: CodeFileSelection[];
  indexedFileCount: number;
  snapshotFileCount: number;
  truncatedFileCount: number;
  skippedWarningCount: number;
  coverageNote: string;
  /** 仅报告用,不进领域对象。 */
  promptChars: number;
}

const CONFIG_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'jsconfig.json',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'dockerfile',
  'electron-builder.yml',
  'electron-builder.yaml',
  'electron-builder.json',
  'composer.json',
  'gemfile',
]);

const ENTRY_BASENAMES = new Set([
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'main.cjs',
  'app.ts',
  'app.js',
  'server.ts',
  'server.js',
  'mod.rs',
  'lib.rs',
  'program.cs',
]);

const CORE_PATH_HINTS = [
  'subject-core',
  'work-runtime',
  'capability',
  'artifact',
  'collaboration',
  'runtime',
  'electron',
  'domain',
  'core',
];

/** 关键服务与适配器(优先级介于核心领域与测试之间)。 */
const SERVICE_ADAPTER_HINTS = [
  'adapter',
  'adapters',
  'service',
  'services',
  'provider',
  'gateway',
  'controller',
  'handlers',
];

export async function assembleCodeAnalysisPrompt(
  input: CapabilityInput,
  readExtractedText: (ref: string) => Promise<string>,
): Promise<AssembledCodeAnalysisPrompt> {
  const okItems = input.snapshot.items.filter(
    (i) => i.status === 'ok' && i.extractedTextRef && i.contentDigest,
  );
  const warningItems = input.snapshot.items.filter((i) => i.status === 'warning');
  const ingestion = input.snapshot.ingestion;

  const scored = okItems
    .map((item) => ({
      item,
      relativePath: normalizeRel(item),
      priority: scoreFile(normalizeRel(item), input.goal),
    }))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.relativePath.localeCompare(b.relativePath),
    );

  const indexLines = scored
    .slice(0, CODE_PROMPT_INDEX_MAX_ENTRIES)
    .map(
      (row) =>
        `- ${row.relativePath} · digest=${row.item.contentDigest} · priority=${row.priority}` +
        (row.item.bytes !== undefined ? ` · bytes=${row.item.bytes}` : ''),
    );
  if (scored.length > CODE_PROMPT_INDEX_MAX_ENTRIES) {
    indexLines.push(`- …另有 ${scored.length - CODE_PROMPT_INDEX_MAX_ENTRIES} 个文件未列入索引`);
  }

  const selected: CodeFileSelection[] = [];
  let used = 0;
  let truncatedFileCount = 0;
  for (const row of scored) {
    if (used >= CODE_PROMPT_TOTAL_CHARS) break;
    const raw = await readExtractedText(row.item.extractedTextRef!);
    const scrubbed = scrubText(raw);
    const room = CODE_PROMPT_TOTAL_CHARS - used;
    const cap = Math.min(CODE_PROMPT_FILE_MAX_CHARS, room);
    const truncated = scrubbed.length > cap;
    if (truncated) truncatedFileCount += 1;
    const text = truncated ? scrubbed.slice(0, cap) : scrubbed;
    if (text.length === 0) continue;
    selected.push({
      relativePath: row.relativePath,
      contentDigest: row.item.contentDigest!,
      priority: row.priority,
      charsUsed: text.length,
      truncated,
      text,
    });
    used += text.length;
  }

  const coverageNote = [
    `快照文件(ok)=${okItems.length}`,
    `送模文件=${selected.length}`,
    `送模字符≈${used}`,
    `单文件截断=${truncatedFileCount}`,
    ingestion?.truncated ? '快照已截断' : '快照未截断',
    `敏感跳过=${ingestion?.skippedSensitiveCount ?? 0}`,
    `预算跳过=${ingestion?.skippedBudgetCount ?? 0}`,
  ].join('；');

  const warningLines = [
    ...(ingestion?.truncated ? ['扫描结果为部分快照（已截断）'] : []),
    ...(ingestion?.skippedSensitiveCount
      ? [`已跳过 ${ingestion.skippedSensitiveCount} 个敏感或凭证类文件`]
      : []),
    ...(ingestion?.skippedBudgetCount
      ? [`因预算限制跳过 ${ingestion.skippedBudgetCount} 个文件`]
      : []),
    ...warningItems
      .slice(0, 20)
      .map((w) => scrubText(w.warning || '条目警告'))
      .filter(Boolean),
  ];

  const experience = formatExperiences(input.subjectContext.entries);

  const system = [
    '你是数字主体的代码项目分析能力。只依据冻结材料快照与已确认经验作答。',
    '禁止编造快照中不存在的文件路径或 digest。禁止输出绝对路径。禁止复述密钥。',
    '你必须只输出一个 JSON 对象。优先使用 sections 对象(避免长字符串转义问题),也可直接给 reportMarkdown。',
    '推荐字段:',
    'sections: { overview, stack, modules, execution, risks, complexity, recommendations, coverage }',
    'findings: array',
    'coverage: { confirmed, inferred, uncovered }',
    'findings 每项: claimId, title, importance, confidence, summary, evidence。',
    'evidence: path, contentDigest, span?, excerpt?。',
    'importance: high|medium|low; confidence: confirmed|inferred|uncovered。',
    '规则:',
    '- sections/report 必须覆盖:项目概览、技术栈与运行方式、目录和模块边界、关键执行链、架构风险、复杂度与维护风险、建议、覆盖范围。',
    '- importance=high 必须带可校验 evidence,且 confidence=confirmed。',
    '- 证据不足则标 inferred/uncovered。',
    '- evidence.path 必须来自文件索引; excerpt≤240 且无密钥。',
    '- findings 至少 5 条(high/medium 合计≥5)。',
  ].join('\n');

  const fileBlocks = selected
    .map((f) => {
      const mark = f.truncated ? '（已截断）' : '';
      return `### ${f.relativePath}${mark}\ndigest: ${f.contentDigest}\n\`\`\`\n${f.text}\n\`\`\``;
    })
    .join('\n\n');

  const userParts = [
    `# 用户目标\n${scrubText(formatCapabilityTaskAndPlan(input)).slice(0, 4_000)}`,
    `# 分析覆盖说明\n${coverageNote}`,
    `# 扫描警告\n${warningLines.length ? warningLines.map((w) => `- ${w}`).join('\n') : '- 无'}`,
    experience.text
      ? `# 已确认经验(必须尊重;适用时在结论中写 APPLIED_EXPERIENCE:<eventId>)\n${experience.text}`
      : '',
    `# 冻结文件索引(相对路径 + digest)\n${indexLines.join('\n')}`,
    `# 送模文件内容(已按优先级与预算选取)\n${fileBlocks || '(无可用正文;仅依据索引与目标分析,不足处标为 uncovered)'}`,
  ].filter(Boolean);

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  return {
    messages,
    selectedFiles: selected,
    indexedFileCount: Math.min(scored.length, CODE_PROMPT_INDEX_MAX_ENTRIES),
    snapshotFileCount: okItems.length,
    truncatedFileCount,
    skippedWarningCount: warningItems.length,
    coverageNote,
    promptChars: messages.reduce((n, m) => n + m.content.length, 0),
  };
}

export function scoreFile(relativePath: string, goal: string): number {
  const rel = relativePath.replace(/\\/g, '/');
  const base = rel.split('/').pop()?.toLowerCase() || '';
  let score = 20;
  if (CONFIG_BASENAMES.has(base)) score = Math.max(score, 100);
  if (ENTRY_BASENAMES.has(base)) score = Math.max(score, 90);
  const lower = rel.toLowerCase();
  if (CORE_PATH_HINTS.some((h) => lower.includes(h))) score = Math.max(score, 75);
  if (SERVICE_ADAPTER_HINTS.some((h) => lower.includes(`/${h}/`) || lower.includes(`/${h}.`) || lower.endsWith(`/${h}`))) {
    score = Math.max(score, 60);
  }
  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(rel) || /\.(test|spec)\./i.test(base)) {
    score = Math.max(score, 40);
  }
  // 目标关键词加权
  const tokens = goal
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
  for (const t of tokens) {
    if (lower.includes(t)) score += 3;
  }
  return score;
}

function normalizeRel(item: SnapshotItem): string {
  if (item.relativePath && item.relativePath.trim()) {
    return item.relativePath.replace(/\\/g, '/');
  }
  // 冻结路径名仅作回退;禁止把盘符绝对路径送入模型标识
  const raw = item.sourcePath.replace(/\\/g, '/');
  const parts = raw.split('/');
  return parts[parts.length - 1] || 'unknown';
}

function formatExperiences(
  entries: Array<{ title: string; detail: string; tags: string[] }>,
): { text: string } {
  if (!entries.length) return { text: '' };
  const blocks: string[] = [];
  let used = 0;
  for (const e of entries) {
    const eventId = 'eventId' in e && typeof (e as { eventId?: string }).eventId === 'string'
      ? (e as { eventId: string }).eventId
      : '';
    const block = eventId
      ? `- eventId=${eventId} | ${scrubText(e.title)}: ${scrubText(e.detail)} [${e.tags.join(',')}]`
      : `- ${scrubText(e.title)}: ${scrubText(e.detail)} [${e.tags.join(',')}]`;
    if (used + block.length > CODE_PROMPT_EXPERIENCE_MAX_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return { text: blocks.join('\n') };
}

export function scrubText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]');
}
