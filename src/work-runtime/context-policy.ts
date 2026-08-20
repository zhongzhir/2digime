/**
 * ContextIngestionPolicy — Snapshot 构建阶段的通用摄取策略(P2.0 契约,P2.1 实现)。
 * 仓库遍历、敏感排除、预算控制与内容冻结全部发生在 ContextSnapshotBuilder,
 * Adapter 执行期只消费冻结 Snapshot,不再触碰用户文件系统。
 * 策略是通用值对象:不含任何代码场景专用状态;缺省(undefined)即现行文档能力行为。
 */

export interface ContextIngestionBudget {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
  maxScanMs: number;
}

export interface ContextIngestionPolicy {
  /** 目录遍历方式;'top-level' 即现行行为(仅顶层受支持文件)。 */
  folderTraversal: 'top-level' | 'recursive';
  /** 是否在构建期跳过敏感路径(凭证/密钥/生成目录),命中不打开文件句柄。 */
  excludeSensitivePaths: boolean;
  /** recursive 遍历必须给预算;超预算降级为部分快照(warning),不算失败。 */
  budget?: ContextIngestionBudget;
}

/** 缺省策略 — 与现行文档能力行为完全一致。 */
export const DEFAULT_CONTEXT_INGESTION_POLICY: ContextIngestionPolicy = {
  folderTraversal: 'top-level',
  excludeSensitivePaths: false,
};

/** 递归摄取的默认预算 — 触发即截断降级,不视为失败。 */
export const RECURSIVE_INGESTION_BUDGET: ContextIngestionBudget = {
  maxFiles: 2000,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxDepth: 12,
  maxScanMs: 60_000,
};

/** 目录级排除:整树跳过,不进入 Snapshot。 */
export const SENSITIVE_DIR_NAMES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  'release-staging',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.pnpm-store',
] as const;

/** 文件级硬排除(凭证与密钥):命中即跳过,永不打开文件句柄。 */
export const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore|ppk)$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\..+)?$/i,
  /^secrets.*\.json$/i,
  /^credentials(\..+)?$/i,
  /^\.(npmrc|netrc|pypirc)$/i,
  /^\.runtime-model-credential\.json$/i,
  /^secrets\.v2\.json$/i,
];

/**
 * 纯函数:判断根内相对路径是否命中敏感排除规则。
 * relPath 使用 '/' 分隔;命中目录级或文件级任一规则即为敏感。
 */
export function isSensitivePath(relPath: string): boolean {
  const segments = relPath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  const dirNames = SENSITIVE_DIR_NAMES as readonly string[];
  for (const segment of segments.slice(0, -1)) {
    if (dirNames.includes(segment.toLowerCase())) return true;
  }
  const base = segments[segments.length - 1]!;
  if (dirNames.includes(base.toLowerCase())) return true;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(base));
}
