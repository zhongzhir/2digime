import type { CapabilityInput } from '../adapter';
import type { ContextSnapshot } from '../../work-runtime/context-snapshot';

/**
 * Prompt 组装(P1.4 / P1.7):仅使用 goal / Snapshot / confirmed subjectContext / artifactType / revision。
 * - warning 条目不进入正文;
 * - 不序列化完整内部对象;
 * - 长材料有总预算与截断标记;
 * - Task Brief 为确定性抽取,不调用第二次模型。
 */
export const PROMPT_MATERIAL_BUDGET_CHARS = 24_000;
export const PROMPT_EXPERIENCE_BUDGET_CHARS = 2_000;
export const PROMPT_ITEM_MAX_CHARS = 6_000;
export const PROMPT_PREVIOUS_TEXT_MAX_CHARS = 8_000;

export interface AssembledPrompt {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  /** 进入正文的材料条数。 */
  materialCount: number;
  /** 因预算被截断的材料条数。 */
  truncatedCount: number;
  /** 跳过的 warning 条数。 */
  skippedWarningCount: number;
  /** 确定性 Task Brief(可测试)。 */
  taskBrief: TaskBrief;
}

export interface TaskBrief {
  goal: string;
  artifactType: string;
  publishScene: string;
  genre: string;
  audience: string;
  lengthHint: string;
  mustCover: string[];
  styleAndForbid: string[];
  materialSources: string[];
}

export async function assembleDocumentPrompt(
  input: CapabilityInput,
  readExtractedText: (ref: string) => Promise<string>,
): Promise<AssembledPrompt> {
  const materials = await formatMaterials(input.snapshot, readExtractedText);
  const taskBrief = extractTaskBrief(input, materials.sources);

  const system = [
    '你是数字主体的文档能力。根据用户目标、给定材料与（若有）已确认经验，撰写一份可直接使用的 Markdown 文档。',
    '要求:结构清楚、忠于材料、不要编造材料中不存在的关键事实。',
    '若材料不足,明确写出缺口而不是虚构。',
    '只输出文档正文,不要输出内部协议名、推理链或系统字段。',
  ].join('\n');

  const sections: string[] = [];
  // AI-first：不重复写「任务概要 + 任务目标」；概要只保留体裁/受众/必须覆盖等非重复约束
  sections.push(`# 任务\n目标：${input.goal.trim()}\n成果类型：${input.artifactType}`);
  const briefExtras = formatTaskBriefExtras(taskBrief);
  if (briefExtras) {
    sections.push(`# 写作约束\n${briefExtras}`);
  }

  if (input.revision) {
    sections.push(`# 修改要求\n${input.revision.request.trim()}`);
    const prev = truncateText(input.revision.previousText, PROMPT_PREVIOUS_TEXT_MAX_CHARS);
    sections.push(`# 当前成果(待改)\n${prev}`);
  }

  const experienceBlock = formatExperiences(input.subjectContext.entries);
  if (experienceBlock.text.length > 0) {
    sections.push(`# 已确认经验\n${experienceBlock.text}`);
  }

  if (materials.text.length > 0) {
    sections.push(`# 材料\n${materials.text}`);
  } else {
    sections.push('# 材料\n(本次未提供可用材料,请仅依据目标撰写;不得虚构未给出的事实。)');
  }

  if (input.revision) {
    sections.push('# 输出\n请直接给出修改后的完整 Markdown 文档(不是补丁)。第一行可以是标题。');
  } else {
    sections.push('# 输出\n请直接给出 Markdown 文档。第一行可以是标题。不要输出计划或推理过程。');
  }

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: sections.join('\n\n') },
    ],
    materialCount: materials.included,
    truncatedCount: materials.truncated,
    skippedWarningCount: materials.skippedWarnings,
    taskBrief,
  };
}

/** 从目标与材料来源确定性抽取 Task Brief(无第二次模型调用)。 */
export function extractTaskBrief(
  input: Pick<CapabilityInput, 'goal' | 'artifactType'>,
  materialSources: string[] = [],
): TaskBrief {
  const goal = input.goal.trim();
  const lower = goal.toLowerCase();

  const publishScene = detectPublishScene(goal, lower);
  const genre = detectGenre(goal, lower, publishScene);
  const audience = detectAudience(goal, lower, publishScene);
  const lengthHint = detectLength(goal);
  const mustCover = detectMustCover(goal);
  const styleAndForbid = detectStyleAndForbid(goal, lower, genre);

  return {
    goal: goal.slice(0, 240),
    artifactType: input.artifactType,
    publishScene,
    genre,
    audience,
    lengthHint,
    mustCover,
    styleAndForbid,
    materialSources: materialSources.slice(0, 12),
  };
}

/** AI-first：仅输出非与目标重复的约束，避免「概要 + 目标」双写。 */
function formatTaskBriefExtras(brief: TaskBrief): string {
  const lines = [
    `- 场景: ${brief.publishScene}`,
    `- 体裁: ${brief.genre}`,
    `- 受众: ${brief.audience}`,
    `- 长度: ${brief.lengthHint}`,
  ];
  if (brief.mustCover.length) lines.push(`- 必须覆盖: ${brief.mustCover.join('；')}`);
  if (brief.styleAndForbid.length) lines.push(`- 风格与禁止: ${brief.styleAndForbid.join('；')}`);
  return lines.join('\n');
}

function detectPublishScene(goal: string, lower: string): string {
  if (/公众号|微信/.test(goal)) return '公众号发布';
  if (/官网|网站|landing/i.test(goal) || /官网/.test(goal)) return '官网或站点发布';
  if (/邮件|newsletter/i.test(lower)) return '邮件沟通';
  if (/内部|汇报|周报|纪要/.test(goal)) return '内部汇报';
  if (/比赛|赛事|获奖|通稿|报道/.test(goal)) return '对外传播/赛事报道';
  return '通用文档';
}

function detectGenre(goal: string, lower: string, scene: string): string {
  if (/报道|通稿|新闻|获奖/.test(goal)) return '新闻报道';
  if (/简报|进展/.test(goal)) return '进展简报';
  if (/说明书|规格|api|接口|架构/.test(lower) || /技术规格/.test(goal)) return '技术说明';
  if (/教程|指南|how\s*to/i.test(lower)) return '操作指南';
  if (/总结|复盘/.test(goal)) return '总结复盘';
  if (scene.includes('公众号') && /介绍|优势|价值/.test(goal)) return '传播稿/介绍文';
  return '通用文稿';
}

function detectAudience(goal: string, _lower: string, scene: string): string {
  if (/评委|选手|参赛/.test(goal)) return '赛事相关读者';
  if (/开发|工程师|技术读者/.test(goal)) return '技术读者';
  if (scene.includes('公众号') || /公众|用户|读者/.test(goal)) return '公众号读者';
  if (/领导|管理层|内部/.test(goal)) return '内部同事';
  return '一般读者';
}

function detectLength(goal: string): string {
  const m = /约?\s*(\d{2,5})\s*字/.exec(goal);
  if (m) return `约 ${m[1]} 字`;
  if (/短文|一两段|一句话/.test(goal)) return '短文';
  if (/长文|详细/.test(goal)) return '较长文稿';
  return '适中';
}

function detectMustCover(goal: string): string[] {
  const items: string[] = [];
  if (/优势|价值|亮点/.test(goal)) items.push('介绍项目优势或价值');
  if (/获奖|比赛|赛事|AIGO|参赛/.test(goal)) items.push('交代参赛/获奖相关事实(仅限材料或目标已给出的信息)');
  if (/Digital\s*Me|数字主体/.test(goal)) items.push('点明 Digital Me / 数字主体是什么');
  if (/进展|现状/.test(goal)) items.push('说明当前进展');
  if (/背景/.test(goal)) items.push('必要背景');
  return items.slice(0, 6);
}

function detectStyleAndForbid(goal: string, lower: string, genre: string): string[] {
  const rules: string[] = [];
  if (genre === '新闻报道') {
    rules.push('以事实开篇,采用新闻报道结构');
    rules.push('不要写成技术规格说明书或产品白皮书');
    rules.push('不要虚构材料中不存在的赛事、奖项或数据');
  } else {
    rules.push('语气清晰、可直接发布');
    rules.push('不要编造材料中不存在的关键事实');
  }
  if (/公众号/.test(goal)) rules.push('适合公众号阅读节奏,避免堆砌术语');
  if (/说明书|规格/.test(lower) === false && genre !== '技术说明') {
    rules.push('避免清单式技术规格口吻');
  }
  return rules.slice(0, 6);
}

function truncateText(text: string, max: number): string {
  const t = String(text || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
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
): Promise<{
  text: string;
  included: number;
  truncated: number;
  skippedWarnings: number;
  sources: string[];
}> {
  let budget = PROMPT_MATERIAL_BUDGET_CHARS;
  let included = 0;
  let truncated = 0;
  let skippedWarnings = 0;
  const blocks: string[] = [];
  const sources: string[] = [];

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
    sources.push(item.sourcePath);
    budget -= block.length + 2;
    included += 1;
    if (itemTruncated) truncated += 1;
  }

  return {
    text: blocks.join('\n\n'),
    included,
    truncated,
    skippedWarnings,
    sources,
  };
}
