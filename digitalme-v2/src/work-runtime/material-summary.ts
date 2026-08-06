/**
 * 任务材料纳入摘要 — 由 ContextSnapshot.items 派生，不新增永久数据源。
 * 仅供用户面核对「读了什么 / 跳过了什么」。
 */
import * as path from 'node:path';
import type { SnapshotItem } from './context-snapshot';

export type MaterialSkipReason =
  | 'unsupported_format'
  | 'unreadable'
  | 'empty'
  | 'over_limit'
  | 'other';

export interface MaterialSummaryEntry {
  path: string;
  displayName: string;
  reason?: string;
  reasonCode?: MaterialSkipReason;
}

export interface MaterialSummary {
  readCount: number;
  skippedCount: number;
  /** 一行自然语言摘要；无材料时为空串。 */
  summaryLine: string;
  included: MaterialSummaryEntry[];
  skipped: MaterialSummaryEntry[];
}

const REASON_LABEL: Record<MaterialSkipReason, string> = {
  unsupported_format: '格式暂不支持',
  unreadable: '无法读取',
  empty: '空文件',
  over_limit: '超出当前限制',
  other: '未能纳入',
};

/**
 * 从快照条目派生用户面材料摘要。
 * ok → 已读取；warning → 跳过并归类原因。
 */
export function buildMaterialSummary(items: readonly SnapshotItem[]): MaterialSummary | undefined {
  if (!items || items.length === 0) return undefined;

  const included: MaterialSummaryEntry[] = [];
  const skipped: MaterialSummaryEntry[] = [];

  for (const item of items) {
    const displayName = displayNameOf(item);
    if (item.status === 'ok' && item.extractedTextRef) {
      included.push({ path: item.sourcePath, displayName });
      continue;
    }
    // status=ok 但无正文引用：不得标「已读取」（与进入模型上下文不一致）
    if (item.status === 'ok' && !item.extractedTextRef) {
      skipped.push({
        path: item.sourcePath,
        displayName,
        reasonCode: 'unreadable',
        reason: REASON_LABEL.unreadable,
      });
      continue;
    }
    // 空文件夹占位：整夹无可读文件时给一条汇总，不拆成假文件
    if (
      item.kind === 'folder-entry' &&
      /folder empty|no supported|无可读|空文件夹/i.test(String(item.warning || ''))
    ) {
      skipped.push({
        path: item.sourcePath,
        displayName: displayNameOf(item),
        reasonCode: 'empty',
        reason: '文件夹内没有可读取的文件',
      });
      continue;
    }
    const reasonCode = classifySkipReason(item);
    skipped.push({
      path: item.sourcePath,
      displayName,
      reasonCode,
      reason: REASON_LABEL[reasonCode],
    });
  }

  const readCount = included.length;
  const skippedCount = skipped.length;
  if (readCount === 0 && skippedCount === 0) return undefined;

  const parts: string[] = [];
  if (readCount > 0) parts.push(`已读取 ${readCount} 个文件`);
  else parts.push('未读取到可用文件');
  if (skippedCount > 0) parts.push(`${skippedCount} 个文件暂未纳入`);

  return {
    readCount,
    skippedCount,
    summaryLine: parts.join('，'),
    included,
    skipped,
  };
}

export function classifySkipReason(item: SnapshotItem): MaterialSkipReason {
  const w = String(item.warning || '').toLowerCase();
  if (/unsupported|不支持|格式暂不支持/.test(w)) return 'unsupported_format';
  if (/empty|空文件|没有可读取/.test(w)) return 'empty';
  if (/budget|超限|超出当前限制|时间上限|扫描预算|部分结果/.test(w)) return 'over_limit';
  if (/unreadable|不可读|extraction failed|无法读取|folder unreadable|目录不可读|failed/.test(w)) {
    return 'unreadable';
  }
  return 'other';
}

function displayNameOf(item: SnapshotItem): string {
  if (item.relativePath) {
    const base = item.relativePath.split('/').filter(Boolean).pop();
    if (base) return base;
  }
  return path.basename(item.sourcePath.replace(/\\/g, '/')) || item.sourcePath;
}
