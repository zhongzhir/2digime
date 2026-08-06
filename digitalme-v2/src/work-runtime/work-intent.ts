/**
 * 做事意图派生 — 纯函数，不落第二 Store。
 * intentKind ≠ Capability 选择 ≠ expectedOutputFamily。
 */
import type { ContextRef } from './task';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const TASK_INTENT_KINDS = [
  'create_document',
  'analyze_code',
  'external_research',
  'general',
] as const;

export type TaskIntentKind = (typeof TASK_INTENT_KINDS)[number];

export type MaterialKind = 'file' | 'folder' | 'code_repo' | 'text_doc' | 'unknown';

export type ExpectedOutputFamily = 'document' | 'code-analysis' | string;

export interface WorkIntent {
  intentKind: TaskIntentKind;
  expectedOutputFamily: ExpectedOutputFamily;
  materialKinds: MaterialKind[];
  /** 高置信自动选择代码分析等时的用户面一句说明（中性，无内部名）。 */
  userFacingNotice?: string;
  /** 是否高置信（可用于自动选能力且只读分析无需确认）。 */
  highConfidence: boolean;
}

const CODE_ANALYZE_GOAL_RE =
  /分析(一下|下)?(这个|该|此)?(代码|仓库|项目|代码库|codebase)|代码审查|审查代码|找出.*(问题|风险|缺陷)|问题清单|静态分析|repo\s*analysis|analyze\s+(the\s+)?(code|repo|project)|code\s*review/i;

const WRITE_DOC_GOAL_RE =
  /写(一篇|一份|个)?|起草|改写|润色|总结|整理成文|方案|文章|报告(?!分析)|周报|纪要|文档|说明书|readme(?!\s*分析)/i;

const CODE_REPO_MARKERS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt',
  '.git',
  'src',
  'lib',
];

export function isTaskIntentKind(value: unknown): value is TaskIntentKind {
  return (
    typeof value === 'string' &&
    (TASK_INTENT_KINDS as readonly string[]).includes(value)
  );
}

/** 轻量材料分类（无 IO）：仅看 ContextRef.kind。 */
export function classifyMaterialRefs(refs: readonly ContextRef[]): MaterialKind[] {
  const kinds: MaterialKind[] = [];
  for (const ref of refs) {
    if (ref.kind === 'folder') kinds.push('folder');
    else if (ref.kind === 'file') {
      const lower = ref.path.toLowerCase();
      if (/\.(md|txt|docx?|rtf)$/i.test(lower)) kinds.push('text_doc');
      else if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|c|cpp|h|cs)$/i.test(lower)) kinds.push('code_repo');
      else kinds.push('file');
    } else kinds.push('unknown');
  }
  return kinds.length ? kinds : ['unknown'];
}

/** 探测文件夹是否像代码仓库（有限深度，失败则不当作仓库）。 */
export async function detectCodeRepoFolders(
  refs: readonly ContextRef[],
): Promise<string[]> {
  const hits: string[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'folder') continue;
    const root = path.resolve(ref.path);
    try {
      const st = await fs.stat(root);
      if (!st.isDirectory()) continue;
      for (const marker of CODE_REPO_MARKERS) {
        try {
          await fs.access(path.join(root, marker));
          hits.push(root);
          break;
        } catch {
          /* next marker */
        }
      }
    } catch {
      /* skip */
    }
  }
  return hits;
}

/**
 * 同步派生（不访问磁盘）。用于测试与无 IO 场景。
 * 代码仓库命中需调用方先把 materialKinds 标为 code_repo。
 */
export function deriveWorkIntentSync(input: {
  goal: string;
  contextRefs: readonly ContextRef[];
  materialKinds?: readonly MaterialKind[];
  explicitCapabilityId?: string;
  /** 外部研究能力 ID 提示（产品面可不展示）。 */
  externalResearchCapabilityIds?: readonly string[];
}): WorkIntent {
  const goal = String(input.goal || '').trim();
  const materialKinds = [...(input.materialKinds ?? classifyMaterialRefs(input.contextRefs))];
  const hasCodeMaterial = materialKinds.some((k) => k === 'code_repo' || k === 'folder');
  const externalIds = input.externalResearchCapabilityIds ?? [
    'cap_a2a_research_analysis',
  ];
  const explicit = String(input.explicitCapabilityId || '').trim();

  if (explicit && externalIds.includes(explicit)) {
    return {
      intentKind: 'external_research',
      expectedOutputFamily: 'document',
      materialKinds,
      highConfidence: true,
      userFacingNotice: '将使用已连接的专业能力处理本次要求。',
    };
  }

  const wantsCodeAnalysis = CODE_ANALYZE_GOAL_RE.test(goal);
  const wantsWrite = WRITE_DOC_GOAL_RE.test(goal);
  const codeRepoPresent = materialKinds.includes('code_repo');

  // 高置信：明确分析目标 + 代码材料（仓库或代码文件）
  if (wantsCodeAnalysis && (codeRepoPresent || hasCodeMaterial)) {
    return {
      intentKind: 'analyze_code',
      expectedOutputFamily: 'code-analysis',
      materialKinds,
      highConfidence: codeRepoPresent || materialKinds.includes('folder'),
      userFacingNotice: '将分析你添加的代码并整理问题清单与依据。',
    };
  }

  // 明确要求代码分析但材料不足：仍标 analyze_code，由选择层报不可用/缺材料
  if (wantsCodeAnalysis && !hasCodeMaterial) {
    return {
      intentKind: 'analyze_code',
      expectedOutputFamily: 'code-analysis',
      materialKinds,
      highConfidence: false,
      userFacingNotice: '代码分析需要你添加代码文件夹或项目文件。',
    };
  }

  if (wantsWrite && !wantsCodeAnalysis) {
    return {
      intentKind: 'create_document',
      expectedOutputFamily: 'document',
      materialKinds,
      highConfidence: true,
    };
  }

  if (explicit) {
    return {
      intentKind: 'general',
      expectedOutputFamily: 'document',
      materialKinds,
      highConfidence: true,
    };
  }

  return {
    intentKind: 'general',
    expectedOutputFamily: 'document',
    materialKinds,
    highConfidence: false,
  };
}

/** 带仓库探测的派生（Runtime / 主进程使用）。 */
export async function deriveWorkIntent(input: {
  goal: string;
  contextRefs: readonly ContextRef[];
  explicitCapabilityId?: string;
  externalResearchCapabilityIds?: readonly string[];
}): Promise<WorkIntent> {
  const baseKinds = classifyMaterialRefs(input.contextRefs);
  const codeFolders = await detectCodeRepoFolders(input.contextRefs);
  const materialKinds: MaterialKind[] = baseKinds.map((k) =>
    k === 'folder' && codeFolders.length > 0 ? 'code_repo' : k,
  );
  // 若存在代码仓库文件夹，确保种类中有 code_repo
  if (codeFolders.length > 0 && !materialKinds.includes('code_repo')) {
    materialKinds.push('code_repo');
  }
  // 单文件代码也算
  for (const ref of input.contextRefs) {
    if (ref.kind === 'file' && /\.(ts|tsx|js|jsx|py|go|rs|java)$/i.test(ref.path)) {
      if (!materialKinds.includes('code_repo')) materialKinds.push('code_repo');
    }
  }
  return deriveWorkIntentSync({
    goal: input.goal,
    contextRefs: input.contextRefs,
    materialKinds,
    ...(input.explicitCapabilityId
      ? { explicitCapabilityId: input.explicitCapabilityId }
      : {}),
    ...(input.externalResearchCapabilityIds
      ? { externalResearchCapabilityIds: input.externalResearchCapabilityIds }
      : {}),
  });
}
