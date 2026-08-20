/**
 * 对话阶段材料简报：复用 extract 抽取，不建 Job、不改项目文件。
 * 供 work.converse 在确认规划前获得真实材料事实。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  extractFile,
  extractFolder,
  type ExtractionOutcome,
} from '../infrastructure/extract';
import { contentDigest, normalizeText } from '../infrastructure/digest';
import { extractTopicTerms } from '../capability/adapters/task-goal-terms';
import { isTextCandidate } from './recursive-ingest';
import type { ContextRef } from './task';

export type ConverseMaterialCompleteness = 'full' | 'truncated' | 'unread';

export interface ConverseMaterialItem {
  sourcePath: string;
  displayName: string;
  completeness: ConverseMaterialCompleteness;
  sourceChars: number;
  usedChars: number;
  excerpt?: string;
  skipReason?: string;
}

export interface ConverseMaterialBrief {
  authorizedPaths: string[];
  items: ConverseMaterialItem[];
  /** 注入模型的材料事实正文。 */
  promptBlock: string;
  fullReadCount: number;
  truncatedCount: number;
  unreadCount: number;
}

/** 对话阶段总摘录预算（字符）。 */
export const CONVERSE_MATERIAL_BUDGET_CHARS = 12_000;
/** 单文件进入对话摘录上限。 */
export const CONVERSE_MATERIAL_ITEM_MAX_CHARS = 2_400;

const SECRET_NAME_RE = /(^|[/\\])(\.env|\.pem|\.key|id_rsa|credentials|secrets?)(\.|$)/i;

/**
 * 从已授权 contextRefs 构建轻量材料事实（清单 + 相关摘录 + 完整性）。
 */
export async function buildConverseMaterialBrief(input: {
  contextRefs: readonly ContextRef[];
  goal?: string;
}): Promise<ConverseMaterialBrief> {
  const refs = (input.contextRefs || []).filter(
    (r) => r && (r.kind === 'file' || r.kind === 'folder') && String(r.path || '').trim(),
  );
  const authorizedPaths = refs.map((r) => String(r.path));
  if (!refs.length) {
    return emptyBrief([]);
  }

  const outcomes: ExtractionOutcome[] = [];
  for (const ref of refs) {
    if (ref.kind === 'file') {
      outcomes.push(await extractForConverse(ref.path));
    } else {
      const folderOutcomes = await extractFolder(ref.path);
      for (const outcome of folderOutcomes) {
        outcomes.push(await recoverWorkspaceText(outcome));
      }
    }
  }

  const goal = String(input.goal || '');
  const terms = extractTopicTerms(goal);
  const ranked = outcomes
    .map((o) => ({
      outcome: o,
      score: scoreOutcome(o, terms),
    }))
    .sort((a, b) => b.score - a.score);

  const items: ConverseMaterialItem[] = [];
  let budgetLeft = CONVERSE_MATERIAL_BUDGET_CHARS;
  let fullReadCount = 0;
  let truncatedCount = 0;
  let unreadCount = 0;

  for (const { outcome } of ranked) {
    const displayName = path.basename(outcome.sourcePath);
    if (SECRET_NAME_RE.test(outcome.sourcePath)) {
      items.push({
        sourcePath: outcome.sourcePath,
        displayName,
        completeness: 'unread',
        sourceChars: 0,
        usedChars: 0,
        skipReason: '安全排除（疑似密钥或凭证文件）',
      });
      unreadCount += 1;
      continue;
    }
    if (outcome.status !== 'ok' || !outcome.text) {
      const warning = String(outcome.warning || '未能读取');
      const skipReason =
        /格式暂不支持/.test(warning) && isTextCandidate(displayName)
          ? '规划摘录未纳入；代码执行会在项目里直接读取'
          : warning;
      items.push({
        sourcePath: outcome.sourcePath,
        displayName,
        completeness: 'unread',
        sourceChars: 0,
        usedChars: 0,
        skipReason,
      });
      unreadCount += 1;
      continue;
    }
    const sourceChars = outcome.length ?? outcome.text.length;
    if (budgetLeft <= 0) {
      items.push({
        sourcePath: outcome.sourcePath,
        displayName,
        completeness: 'unread',
        sourceChars,
        usedChars: 0,
        skipReason: '对话阶段材料预算已用尽，本文件未纳入摘录',
      });
      unreadCount += 1;
      continue;
    }
    const cap = Math.min(CONVERSE_MATERIAL_ITEM_MAX_CHARS, budgetLeft);
    const excerpt = outcome.text.length > cap ? outcome.text.slice(0, cap) : outcome.text;
    const usedChars = excerpt.length;
    const completeness: ConverseMaterialCompleteness =
      usedChars >= sourceChars && !outcome.truncated ? 'full' : 'truncated';
    if (completeness === 'full') fullReadCount += 1;
    else truncatedCount += 1;
    budgetLeft -= usedChars;
    items.push({
      sourcePath: outcome.sourcePath,
      displayName,
      completeness,
      sourceChars,
      usedChars,
      excerpt,
    });
  }

  return {
    authorizedPaths,
    items,
    promptBlock: formatBriefPrompt(authorizedPaths, items, {
      fullReadCount,
      truncatedCount,
      unreadCount,
    }),
    fullReadCount,
    truncatedCount,
    unreadCount,
  };
}

async function extractForConverse(filePath: string): Promise<ExtractionOutcome> {
  return recoverWorkspaceText(await extractFile(filePath));
}

async function recoverWorkspaceText(outcome: ExtractionOutcome): Promise<ExtractionOutcome> {
  if (outcome.status === 'ok' && outcome.text) return outcome;
  const name = path.basename(outcome.sourcePath);
  if (!isTextCandidate(name)) return outcome;
  try {
    const raw = await fs.readFile(outcome.sourcePath, 'utf8');
    const text = normalizeText(raw);
    if (!text.trim()) {
      return { sourcePath: outcome.sourcePath, status: 'warning', warning: '空文件' };
    }
    return {
      sourcePath: outcome.sourcePath,
      status: 'ok',
      text,
      length: text.length,
      digest: contentDigest(text),
    };
  } catch (error) {
    return {
      sourcePath: outcome.sourcePath,
      status: 'warning',
      warning: `无法读取: ${(error as Error).message}`,
    };
  }
}

function emptyBrief(authorizedPaths: string[]): ConverseMaterialBrief {
  return {
    authorizedPaths,
    items: [],
    promptBlock: authorizedPaths.length
      ? [
          '【已授权材料】',
          ...authorizedPaths.map((p) => `- ${p}`),
          '说明：已附加路径，但规划阶段还没有抽出可读正文。不要说当前工具不支持源码格式；请确认附加的是正确的项目文件夹，源码由后续代码执行在项目里直接读取。',
        ].join('\n')
      : '',
    fullReadCount: 0,
    truncatedCount: 0,
    unreadCount: 0,
  };
}

function scoreOutcome(o: ExtractionOutcome, terms: string[]): number {
  const name = path.basename(o.sourcePath).toLowerCase();
  let score = 0;
  if (o.status === 'ok' && o.text) score += 10;
  for (const t of terms) {
    if (t.length >= 2 && name.includes(t.toLowerCase())) score += 5;
  }
  if (/\.(html?|md|csv|txt)$/i.test(name)) score += 3;
  if (/handoff|readme|project|index|inventory|format/i.test(name)) score += 2;
  if (/\.(js|json|ts|tsx|mjs|cjs)$/i.test(name)) score += 4;
  return score;
}

function formatBriefPrompt(
  authorizedPaths: string[],
  items: ConverseMaterialItem[],
  counts: { fullReadCount: number; truncatedCount: number; unreadCount: number },
): string {
  const lines: string[] = [];
  lines.push('【已授权材料】');
  lines.push(
    '以下路径由用户在本机授权附加。理解与规划阶段可以、也应该基于这些材料事实工作；不得要求用户把全文粘贴进对话，也不得声称“无法访问本地文件夹”。',
  );
  lines.push(
    'js / json / ts 等源码是普通文本。规划阶段若未摘录到正文，应说明尚未纳入摘录，不得说成“当前工具不支持该格式、看不到代码”。代码执行会在项目目录里直接读取这些文件。',
  );
  for (const p of authorizedPaths) {
    lines.push(`- 授权路径：${p}`);
  }
  lines.push(
    `材料完整性：完整阅读 ${counts.fullReadCount} 份；部分阅读 ${counts.truncatedCount} 份；未纳入摘录 ${counts.unreadCount} 份。`,
  );
  lines.push('【材料清单】');
  for (const item of items) {
    if (item.completeness === 'unread') {
      lines.push(
        `- ${item.displayName}（未读取${item.skipReason ? `：${item.skipReason}` : ''}）路径：${item.sourcePath}`,
      );
    } else {
      lines.push(
        `- ${item.displayName}（${item.completeness === 'full' ? '完整阅读' : '部分阅读'}，所用 ${item.usedChars}/${item.sourceChars} 字）路径：${item.sourcePath}`,
      );
    }
  }
  const withExcerpt = items.filter((i) => i.excerpt);
  if (withExcerpt.length) {
    lines.push('【相关正文摘录】');
    for (const item of withExcerpt) {
      lines.push(`--- ${item.displayName}（${item.completeness}）---`);
      lines.push(item.excerpt!);
    }
  }
  return lines.join('\n');
}

/** confirm_start 时模型给出的本轮执行族；仅校验配对，不根据关键词猜测。 */
export const CONFIRMED_PLAN_EXECUTION_KINDS = [
  'modify_code',
  'create_document',
  'analyze_code',
] as const;
export type ConfirmedPlanExecutionKind = (typeof CONFIRMED_PLAN_EXECUTION_KINDS)[number];

export const CONFIRMED_PLAN_OUTPUT_FAMILIES = [
  'code-change',
  'document',
  'code-analysis',
] as const;
export type ConfirmedPlanOutputFamily = (typeof CONFIRMED_PLAN_OUTPUT_FAMILIES)[number];

const EXECUTION_KIND_FAMILY: Record<ConfirmedPlanExecutionKind, ConfirmedPlanOutputFamily> = {
  modify_code: 'code-change',
  create_document: 'document',
  analyze_code: 'code-analysis',
};

/**
 * 校验模型瞬时执行族：只做枚举与配对，不读目标/规划正文、不按关键词路由。
 */
export function validateConfirmedPlanExecutionIntent(input: {
  executionIntentKind?: unknown;
  expectedOutputFamily?: unknown;
}): {
  intentKind: ConfirmedPlanExecutionKind;
  expectedOutputFamily: ConfirmedPlanOutputFamily;
} | null {
  const kind = typeof input.executionIntentKind === 'string' ? input.executionIntentKind.trim() : '';
  const family =
    typeof input.expectedOutputFamily === 'string' ? input.expectedOutputFamily.trim() : '';
  if (!(CONFIRMED_PLAN_EXECUTION_KINDS as readonly string[]).includes(kind)) return null;
  if (!(CONFIRMED_PLAN_OUTPUT_FAMILIES as readonly string[]).includes(family)) return null;
  const expected = EXECUTION_KIND_FAMILY[kind as ConfirmedPlanExecutionKind];
  if (expected !== family) return null;
  return {
    intentKind: kind as ConfirmedPlanExecutionKind,
    expectedOutputFamily: family as ConfirmedPlanOutputFamily,
  };
}
