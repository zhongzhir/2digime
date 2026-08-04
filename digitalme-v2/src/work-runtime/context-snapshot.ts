/**
 * ContextSnapshot — 提交时刻上下文的不可变快照(domain model §2.4)。
 * Job 只读 Snapshot,不回读原文件;单条目失败降级为 warning。
 * P2.1:可选 relativePath/bytes/truncated 与 ingestion 摘要承载递归摄取元信息,
 * 不新增核心对象。
 */
export interface ContextSnapshot {
  id: string;
  taskId: string;
  createdAt: string;
  items: SnapshotItem[];
  /** 注入的已确认经验视图快照引用。 */
  subjectContextRef?: string;
  /**
   * 递归摄取摘要(可选)。计数来自构建期,供 Adapter 写 manifest;
   * 缺省(文档能力)不写此字段。
   */
  ingestion?: SnapshotIngestionMeta;
  /** 协作披露溯源（可选）；记录 Grant 与材料摘要，非独立协作状态机。 */
  authorization?: {
    grantId: string;
    issuerSubjectId: string;
    granteeSubjectId: string;
  };
}

export interface SnapshotItem {
  sourcePath: string;
  kind: 'file' | 'folder-entry';
  status: 'ok' | 'warning';
  warning?: string;
  contentDigest?: string;
  /** 抽取文本的存储引用(infrastructure 层解析)。 */
  extractedTextRef?: string;
  /** 根内相对路径('/' 分隔);递归摄取时填写。 */
  relativePath?: string;
  bytes?: number;
  truncated?: boolean;
}

/** 构建期摄取摘要 — 非独立对象,挂在 Snapshot 上。 */
export interface SnapshotIngestionMeta {
  rootName?: string;
  truncated: boolean;
  skippedSensitiveCount: number;
  skippedBudgetCount: number;
  totalBytesScanned: number;
  fileCountScanned: number;
}
