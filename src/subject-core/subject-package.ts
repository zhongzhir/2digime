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
  /** Owner 设置、用于未来社交与协作名片的本机用户名；联网唯一性需由未来服务确认。 */
  username?: string;
  bio?: string;
  /** 包内相对路径；头像随 SubjectPackage 迁移。 */
  avatarRef?: string;
  /** Owner 主动登记的联系方式。未接认证方前只表示已登记，不表示已验证。 */
  email?: string;
  phone?: string;
}

/** 包内固定分区布局。 */
export const SUBJECT_PACKAGE_LAYOUT = {
  manifest: 'manifest.json',
  growthEvents: 'growth/events.ndjson',
  materials: 'materials/',
  derivedViews: 'derived/',
} as const;
