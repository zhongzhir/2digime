/**
 * P2.0 代码能力可编译契约(规格阶段,不含实现)。
 * 见 docs/design/digitalme_v2_p2.0_code_capability_spec_v0.2_20260803.md。
 * CTO 复核修订(v0.2):
 * - Adapter 执行期禁止重新读取用户仓库;仓库遍历/敏感排除/预算/内容冻结
 *   全部由 ContextSnapshotBuilder 按通用 contextPolicy 执行;
 * - 真实代码分析由模型完成:权限为 network + secret_access,无 filesystem_read;
 * - 无模型凭证时 availability = needs_setup,不生成本地替代成果。
 */
import type { CapabilityRegistration } from '../registration';
import {
  RECURSIVE_INGESTION_BUDGET,
  type ContextIngestionPolicy,
} from '../../work-runtime/context-policy';

export const CODE_REPO_ANALYSIS_CAPABILITY_ID = 'cap_code_repo_analysis';
export const CODE_ANALYSIS_ARTIFACT_TYPE = 'code-analysis';

/** 期望产出族封闭表 — 可由意图派生或显式传入，不等于任务类型枚举。 */
export const REQUESTED_ARTIFACT_TYPES = ['document', CODE_ANALYSIS_ARTIFACT_TYPE] as const;
export type RequestedArtifactType = (typeof REQUESTED_ARTIFACT_TYPES)[number];

/** bundle 条目角色封闭表。evidence:P2.1 落 schema,P2.2 起为必选条目。 */
export const CODE_BUNDLE_ROLES = ['report', 'manifest', 'evidence'] as const;
export type CodeBundleRole = (typeof CODE_BUNDLE_ROLES)[number];

export const CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION = 'code-analysis/1';
export const CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION = 'code-analysis-evidence/1';

/** bundle 内 role:'manifest' 条目的 JSON 结构。 */
export interface CodeAnalysisBundleManifest {
  schemaVersion: typeof CODE_ANALYSIS_MANIFEST_SCHEMA_VERSION;
  generatedAt: string;
  /** 计数来自冻结 Snapshot 的构建结果,不来自执行期重扫。 */
  repo: {
    rootName: string;
    fileCountScanned: number;
    totalBytesScanned: number;
    truncated: boolean;
    skippedSensitiveCount: number;
    skippedBudgetCount: number;
  };
  languages: Array<{ language: string; files: number; bytes: number }>;
  /** 与 bundle entries 一一对应;path 为根内相对路径,禁止绝对路径。 */
  entries: Array<{ role: CodeBundleRole; path: string; mediaType: string; bytes?: number }>;
  /** 用户面文案,不含内部字段名与密钥样本。 */
  warnings: string[];
}

/** evidence 摘录上限 — 禁止整文件内容进入 evidence。 */
export const EVIDENCE_EXCERPT_MAX_CHARS = 240;

/**
 * evidence 确定性引用结构(role:'evidence' 条目,P2.1 实现 schema,P2.2 必选)。
 * 只引用冻结 Snapshot 条目:相对路径 + contentDigest + 行区间;
 * 不含绝对路径、完整文件或敏感内容;excerpt 有界且必须过 scrub。
 */
export interface CodeAnalysisEvidenceRef {
  /** report 中结论的引用锚点。 */
  claimId: string;
  /** 根内相对路径('/' 分隔)。 */
  path: string;
  /** 指向冻结 SnapshotItem.contentDigest。 */
  contentDigest: string;
  span?: { startLine: number; endLine: number };
  /** ≤ EVIDENCE_EXCERPT_MAX_CHARS,经 scrub;可省略。 */
  excerpt?: string;
}

export interface CodeAnalysisEvidenceFile {
  schemaVersion: typeof CODE_ANALYSIS_EVIDENCE_SCHEMA_VERSION;
  items: CodeAnalysisEvidenceRef[];
}

/**
 * 代码分析能力的上下文摄取策略 — 通用值,由 SnapshotBuilder 执行。
 * Adapter 执行期零文件系统访问。
 */
export const CODE_ANALYSIS_CONTEXT_POLICY: ContextIngestionPolicy = {
  folderTraversal: 'recursive',
  excludeSensitivePaths: true,
  budget: RECURSIVE_INGESTION_BUDGET,
};

/**
 * 可用性解析 — 与文档能力同一模型门禁:
 * 无模型凭证时 needs_setup,不注册本地替代实现,不产出替代成果。
 */
export function resolveCodeAnalysisAvailability(
  modelReady: boolean,
): CapabilityRegistration['availability'] {
  return modelReady ? 'available' : 'needs_setup';
}

/**
 * 注册声明 builder — 真实分析由模型完成:
 * permissions 仅 network + secret_access;Adapter 无 filesystem_read,
 * 仓库内容一律经冻结 Snapshot(extractedTextRef)进入。
 */
export function buildCodeRepoAnalysisRegistration(
  availability: CapabilityRegistration['availability'],
): CapabilityRegistration {
  return {
    id: CODE_REPO_ANALYSIS_CAPABILITY_ID,
    kind: 'agent',
    displayName: '代码仓库分析',
    description: '基于任务材料中的代码仓库快照,生成结构与质量分析报告',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: [CODE_ANALYSIS_ARTIFACT_TYPE],
    permissions: ['network', 'secret_access'],
    cost: { estimate: '按用量计费' },
    latencyEstimate: '数十秒到数分钟',
    location: 'remote',
    availability,
    adapter: { type: 'openai-compatible-model', adapterId: 'code-repo-analysis' },
    contextPolicy: CODE_ANALYSIS_CONTEXT_POLICY,
  };
}
