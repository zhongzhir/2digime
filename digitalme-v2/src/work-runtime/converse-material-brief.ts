/**
 * 对话阶段材料简报：复用 extract 抽取，不建 Job、不改项目文件。
 * 供 work.converse 在确认规划前获得真实材料事实。
 */
import * as path from 'node:path';
import {
  extractFile,
  extractFolder,
  type ExtractionOutcome,
} from '../infrastructure/extract';
import { extractTopicTerms } from '../capability/adapters/task-goal-terms';
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
      outcomes.push(await extractFile(ref.path));
    } else {
      outcomes.push(...(await extractFolder(ref.path)));
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
      items.push({
        sourcePath: outcome.sourcePath,
        displayName,
        completeness: 'unread',
        sourceChars: 0,
        usedChars: 0,
        skipReason: String(outcome.warning || '未能读取'),
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

function emptyBrief(authorizedPaths: string[]): ConverseMaterialBrief {
  return {
    authorizedPaths,
    items: [],
    promptBlock: authorizedPaths.length
      ? [
          '【已授权材料】',
          ...authorizedPaths.map((p) => `- ${p}`),
          '说明：已附加路径，但尚未抽取出可读正文。不得声称“系统永远无法访问本地文件夹”；应说明具体阻断并请用户确认路径或材料格式。',
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
  if (/handoff|readme|project|index/i.test(name)) score += 2;
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

/**
 * 确认后按已确认方案判断本轮执行族：改项目 → Coding；仅报告 → 文档。
 * 不依据 Git / package.json / 目录关键词。
 */
export function resolveConfirmedPlanExecutionIntent(input: {
  goal: string;
  planContent: string;
  contextRefs: readonly ContextRef[];
}): {
  intentKind: 'modify_code' | 'create_document' | 'general';
  expectedOutputFamily: 'code-change' | 'document';
} {
  const goal = String(input.goal || '');
  const plan = String(input.planContent || '');
  const blob = `${goal}\n${plan}`;
  const hasProjectPath = (input.contextRefs || []).some(
    (r) => r && (r.kind === 'folder' || r.kind === 'file') && String(r.path || '').trim(),
  );

  const reportOnly =
    /(只|仅).{0,6}(输出|交付|撰写|整理).{0,8}(方案|报告|文档)/.test(blob) &&
    !/(批准后|确认后|通过后).{0,16}(实施|修改|改动|落地|改代码|写入)/.test(blob) &&
    !/(开始|进行|执行).{0,10}(实施|修改|改代码|落地)/.test(blob);

  if (reportOnly || !hasProjectPath) {
    return { intentKind: 'create_document', expectedOutputFamily: 'document' };
  }

  const wantsModify =
    /(修改|改动|写入|编辑|落地|实施).{0,20}(项目|代码|文件|源码|仓库|网页|应用)/.test(blob) ||
    /(批准后|确认后|通过后).{0,16}(实施|修改|改动|落地)/.test(blob) ||
    /待批准后实施|批准后实施|确认后开始/.test(blob) ||
    /(效率优化|升级方案).{0,40}(实施|落地|修改)/.test(blob) ||
    /按(?:确认|批准)?(?:的)?方案.{0,12}(执行|实施|修改)/.test(blob);

  if (wantsModify) {
    return { intentKind: 'modify_code', expectedOutputFamily: 'code-change' };
  }

  // 有项目路径且方案未明确“只出报告”时，默认按改项目执行（避免再落成空转文档 Job）
  if (hasProjectPath && /(实施|优化|升级|修复|改进)/.test(blob)) {
    return { intentKind: 'modify_code', expectedOutputFamily: 'code-change' };
  }

  return { intentKind: 'create_document', expectedOutputFamily: 'document' };
}
