/**
 * ContextSnapshot — 提交时刻上下文的不可变快照(domain model §2.4)。
 * Job 只读 Snapshot,不回读原文件;单条目失败降级为 warning。
 */
export interface ContextSnapshot {
  id: string;
  taskId: string;
  createdAt: string;
  items: SnapshotItem[];
  /** 注入的已确认经验视图快照引用。 */
  subjectContextRef?: string;
}

export interface SnapshotItem {
  sourcePath: string;
  kind: 'file' | 'folder-entry';
  status: 'ok' | 'warning';
  warning?: string;
  contentDigest?: string;
  /** 抽取文本的存储引用(infrastructure 层解析)。 */
  extractedTextRef?: string;
}
