import type { CapabilityInput } from '../adapter';
import type { ContextSnapshot } from '../../work-runtime/context-snapshot';

/**
 * Prompt 组装(P1.4):仅使用 goal / Snapshot / confirmed subjectContext / artifactType。
 * - warning 条目不进入正文;
 * - 不序列化完整内部对象;
 * - 长材料有总预算与截断标记。
 */
export const PROMPT_MATERIAL_BUDGET_CHARS = 24_000;
export const PROMPT_EXPERIENCE_BUDGET_CHARS = 2_000;
export const PROMPT_ITEM_MAX_CHARS = 6_000;

export interface AssembledPrompt {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  /** 进入正文的材料条数。 */
  materialCount: number;
  /** 因预算被截断的材料条数。 */
  truncatedCount: number;
  /** 跳过的 warning 条数。 */
  skippedWarningCount: number;
}

export async function assembleDocumentPrompt(
  input: CapabilityInput,
  readExtractedText: (ref: string) => Promise<string>,
): Promise<AssembledPrompt> {
  const system = [
    '你是数字主体的文档能力。根据用户目标、给定材料与已确认经验,撰写一份可直接使用的 Markdown 文档。',
    '要求:结构清楚、忠于材料、不要编造材料中不存在的关键事实。',
    '若材料不足,明确写出缺口而不是虚构。',
    '只输出文档正文,不要输出内部协议名或系统字段。',
  ].join('\n');

  const sections: string[] = [];
  sections.push(`# 任务目标\n${input.goal.trim()}`);
  sections.push(`# 成果类型\n${input.artifactType}`);

  const experienceBlock = formatExperiences(input.subjectContext.entries);
  if (experienceBlock.text.length > 0) {
    sections.push(`# 已确认经验(必须尊重)\n${experienceBlock.text}`);
  }

  const materials = await formatMaterials(input.snapshot, readExtractedText);
  if (materials.text.length > 0) {
    sections.push(`# 材料\n${materials.text}`);
  } else {
    sections.push('# 材料\n(本次未提供可用材料,请仅依据目标与已确认经验撰写。)');
  }

  sections.push('# 输出\n请直接给出 Markdown 文档。第一行可以是标题。');

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: sections.join('\n\n') },
    ],
    materialCount: materials.included,
    truncatedCount: materials.truncated,
    skippedWarningCount: materials.skippedWarnings,
  };
}

function formatExperiences(
  entries: CapabilityInput['subjectContext']['entries'],
): { text: string } {
  if (entries.length === 0) return { text: '' };
  let budget = PROMPT_EXPERIENCE_BUDGET_CHARS;
  const lines: string[] = [];
  for (const entry of entries) {
    const line = `- [${entry.eventId}] ${entry.title}: ${entry.detail}`;
    if (line.length > budget) {
      lines.push(`${line.slice(0, Math.max(0, budget - 1))}…`);
      break;
    }
    lines.push(line);
    budget -= line.length + 1;
  }
  return { text: lines.join('\n') };
}

async function formatMaterials(
  snapshot: ContextSnapshot,
  readExtractedText: (ref: string) => Promise<string>,
): Promise<{ text: string; included: number; truncated: number; skippedWarnings: number }> {
  let budget = PROMPT_MATERIAL_BUDGET_CHARS;
  let included = 0;
  let truncated = 0;
  let skippedWarnings = 0;
  const blocks: string[] = [];

  for (const item of snapshot.items) {
    if (item.status === 'warning') {
      skippedWarnings += 1;
      continue;
    }
    if (!item.extractedTextRef) continue;
    if (budget <= 80) {
      truncated += 1;
      continue;
    }

    let body: string;
    try {
      body = await readExtractedText(item.extractedTextRef);
    } catch {
      skippedWarnings += 1;
      continue;
    }

    let used = body;
    let itemTruncated = false;
    if (used.length > PROMPT_ITEM_MAX_CHARS) {
      used = used.slice(0, PROMPT_ITEM_MAX_CHARS);
      itemTruncated = true;
    }
    if (used.length > budget) {
      used = used.slice(0, budget);
      itemTruncated = true;
    }
    const header = `## 来源: ${item.sourcePath}${itemTruncated ? ' (已截断)' : ''}`;
    const block = `${header}\n${used}`;
    blocks.push(block);
    budget -= block.length + 2;
    included += 1;
    if (itemTruncated) truncated += 1;
  }

  return {
    text: blocks.join('\n\n'),
    included,
    truncated,
    skippedWarnings,
  };
}
