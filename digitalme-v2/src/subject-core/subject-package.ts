/**
 * SubjectPackage — 主体权威来源(domain model §2.1)。
 * 权威 = growth 事件流 + 导入原始资料;其余分区为派生视图,可重放重建。
 */
export interface SubjectPackage {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  identity: SubjectIdentity;
  /** 包根目录(本地优先;整目录拷贝即迁移)。 */
  rootDir: string;
}

export interface SubjectIdentity {
  displayName: string;
  description?: string;
}

/** 包内固定分区布局。 */
export const SUBJECT_PACKAGE_LAYOUT = {
  manifest: 'manifest.json',
  growthEvents: 'growth/events.ndjson',
  materials: 'materials/',
  derivedViews: 'derived/',
} as const;
