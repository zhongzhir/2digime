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

export interface MaterialEvidenceEntry {
  path: string;
  displayName: string;
  status?: string;
  reason?: string;
  completeness?: 'full' | 'truncated' | 'unread';
  sourceChars?: number;
  usedChars?: number;
}

/**
 * 验收用材料事实：区分获得、已抽取、实际使用、仅存在未读取。
 * 使用侧再区分完整读取 / 部分读取 / 未读取。
 * 不得把「项目路径存在」或 includedCount 写成已完整阅读。
 */
export interface MaterialEvidence {
  obtained: MaterialEvidenceEntry[];
  extracted: MaterialEvidenceEntry[];
  used: MaterialEvidenceEntry[];
  unread: MaterialEvidenceEntry[];
  folderAttached: boolean;
  includedCount?: number;
  fullReadCount?: number;
  truncatedCount?: number;
  notes: string[];
}

function normPath(p: string): string {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function displayFromPath(p: string): string {
  const n = String(p || '').replace(/\\/g, '/');
  return n.split('/').filter(Boolean).pop() || n;
}

export function buildMaterialEvidence(input: {
  snapshotItems?: readonly SnapshotItem[];
  contextRefs?: ReadonlyArray<{ kind: string; path: string }>;
  materialUse?: {
    usedPaths?: string[];
    includedCount?: number;
    truncatedCount?: number;
    fullReadCount?: number;
    items?: Array<{
      path: string;
      completeness: 'full' | 'truncated' | 'unread';
      sourceChars: number;
      usedChars: number;
    }>;
  };
}): MaterialEvidence {
  const items = input.snapshotItems || [];
  const obtained: MaterialEvidenceEntry[] = items.slice(0, 80).map((item) => ({
    path: item.sourcePath,
    displayName: displayNameOf(item),
    status: item.status,
    ...(item.warning ? { reason: item.warning } : {}),
  }));
  const extracted: MaterialEvidenceEntry[] = [];
  const unread: MaterialEvidenceEntry[] = [];
  for (const item of items.slice(0, 80)) {
    const entry: MaterialEvidenceEntry = {
      path: item.sourcePath,
      displayName: displayNameOf(item),
      status: item.status,
      ...(item.warning ? { reason: item.warning } : {}),
    };
    if (item.status === 'ok' && item.extractedTextRef) extracted.push(entry);
    else unread.push(entry);
  }
  const useItems = input.materialUse?.items || [];
  const usedPaths = (input.materialUse?.usedPaths || []).map((p) => String(p || '').trim()).filter(Boolean);
  const usedByPath = new Map(extracted.map((e) => [normPath(e.path), e]));
  const useByPath = new Map(useItems.map((u) => [normPath(u.path), u]));
  const used: MaterialEvidenceEntry[] = [];
  const seen = new Set<string>();
  const recordUsed = (p: string) => {
    const key = normPath(p);
    if (seen.has(key)) return;
    seen.add(key);
    const base = usedByPath.get(key) || { path: p, displayName: displayFromPath(p) };
    const fact = useByPath.get(key);
    used.push({
      ...base,
      ...(fact
        ? {
            completeness: fact.completeness,
            sourceChars: fact.sourceChars,
            usedChars: fact.usedChars,
          }
        : {}),
    });
  };
  for (const u of useItems) {
    if (u.usedChars > 0 || u.completeness !== 'unread') recordUsed(u.path);
  }
  for (const p of usedPaths.slice(0, 80)) recordUsed(p);
  for (const u of useItems) {
    if (u.completeness === 'unread' && u.usedChars === 0) {
      const key = normPath(u.path);
      if (seen.has(key)) continue;
      seen.add(key);
      unread.push({
        path: u.path,
        displayName: displayFromPath(u.path),
        completeness: 'unread',
        sourceChars: u.sourceChars,
        usedChars: 0,
      });
    }
  }
  const folderAttached =
    (input.contextRefs || []).some((r) => r.kind === 'folder' || r.kind === 'file') ||
    items.some((i) => i.kind === 'folder-entry' || i.kind === 'file');
  const truncatedCount = useItems.length
    ? useItems.filter((u) => u.completeness === 'truncated').length
    : typeof input.materialUse?.truncatedCount === 'number'
      ? input.materialUse.truncatedCount
      : 0;
  const fullReadCount = useItems.length
    ? useItems.filter((u) => u.completeness === 'full').length
    : typeof input.materialUse?.fullReadCount === 'number'
      ? input.materialUse.fullReadCount
      : 0;
  const includedCount =
    typeof input.materialUse?.includedCount === 'number'
      ? input.materialUse.includedCount
      : used.length;
  const notes: string[] = [];
  if (folderAttached && extracted.length === 0) {
    notes.push('已附加项目路径，但没有抽取到可读文件。不得把目录存在当作已通读项目。');
  }
  if (extracted.length > 0 && used.length === 0) {
    notes.push(
      input.materialUse
        ? '已抽取材料未进入本轮执行使用清单。'
        : '快照已抽取正文，但执行器未声明实际纳入提示的材料；不得把已抽取等同于已通读。',
    );
  }
  if (usedPaths.length === 0 && includedCount === 0 && extracted.length === 0) {
    notes.push('执行阶段没有可用的项目正文。');
  }
  if (truncatedCount > 0) {
    notes.push(
      `有 ${truncatedCount} 份材料仅部分读取。纳入提示 ${includedCount} 份不等于完整阅读 ${fullReadCount} 份。`,
    );
  } else if (includedCount > 0 && fullReadCount < includedCount && !useItems.length) {
    notes.push('不得把纳入提示的材料条数当成完整阅读数。');
  }
  return {
    obtained,
    extracted,
    used,
    unread,
    folderAttached,
    includedCount,
    fullReadCount,
    truncatedCount,
    notes,
  };
}
