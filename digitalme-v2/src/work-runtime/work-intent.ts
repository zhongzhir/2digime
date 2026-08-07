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
  'modify_code',
  'external_research',
  'general',
] as const;

export type TaskIntentKind = (typeof TASK_INTENT_KINDS)[number];

export type MaterialKind = 'file' | 'folder' | 'code_repo' | 'text_doc' | 'unknown';

export type ExpectedOutputFamily = 'document' | 'code-analysis' | 'code-change' | string;

export interface WorkIntent {
  intentKind: TaskIntentKind;
  expectedOutputFamily: ExpectedOutputFamily;
  materialKinds: MaterialKind[];
  /** 高置信自动选择代码分析等时的用户面一句说明（中性，无内部名）。 */
  userFacingNotice?: string;
  /** 是否高置信（可用于自动选能力且只读分析无需确认）。 */
  highConfidence: boolean;
  /** 代码修改意图时，提交前需用户确认写权限。 */
  requiresExecutionConfirm?: boolean;
}

/** 软件项目文件夹派生视图 — 可计算，非永久事实源。 */
export interface SoftwareProjectInspection {
  path: string;
  projectName: string;
  isSoftwareProject: boolean;
  markersHit: string[];
  /** 用户面说明；非软件项目时为空。 */
  userFacingHint: string;
  /** 目录为空（或仅含可忽略项），可作为新项目工作目录。 */
  isEmptyDirectory?: boolean;
  /** 可作为「准备创建的软件项目」使用。 */
  isNewProjectCandidate?: boolean;
}

const CODE_ANALYZE_GOAL_RE =
  /分析(一下|下)?(这个|该|此)?(代码|仓库|项目|代码库|codebase)|代码审查|审查代码|找出.*(问题|风险|缺陷)|问题清单|静态分析|repo\s*analysis|analyze\s+(the\s+)?(code|repo|project)|code\s*review/i;

const CODE_MODIFY_GOAL_RE =
  /修改|修复|实现|开发|重构|改成|改为|更新代码|添加.+功能|删除.+代码|补上|修一下|写一个|做一个|创建.+游戏|fix\b|implement|refactor|change\s+the|update\s+the\s+code|add\s+a\s+|remove\s+the|build\s+a\s+|create\s+a\s+/i;

const WRITE_DOC_GOAL_RE =
  /写(一篇|一份|个)?|起草|改写|润色|总结|整理成文|方案|文章|报告(?!分析)|周报|纪要|文档|说明书|readme(?!\s*分析)/i;

/** 根目录识别信号（有限、可解释）。 */
export const SOFTWARE_PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'src',
  'app',
  'lib',
] as const;

/** 扩展名识别（根目录扫描，非递归）。 */
const SOFTWARE_PROJECT_EXTENSIONS = ['.sln', '.csproj'] as const;

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

/**
 * 检查单个文件夹是否像软件项目（派生视图，不落 Store）。
 */
export async function inspectSoftwareProject(
  folderPath: string,
): Promise<SoftwareProjectInspection> {
  const root = path.resolve(folderPath);
  const projectName = path.basename(root) || root;
  const empty: SoftwareProjectInspection = {
    path: root,
    projectName,
    isSoftwareProject: false,
    markersHit: [],
    userFacingHint: '',
  };
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) return empty;
  } catch {
    return empty;
  }

  const markersHit: string[] = [];
  for (const marker of SOFTWARE_PROJECT_MARKERS) {
    try {
      await fs.access(path.join(root, marker));
      markersHit.push(marker);
    } catch {
      /* next */
    }
  }

  try {
    const entries = await fs.readdir(root);
    const meaningful = entries.filter(
      (name) => name !== '.' && name !== '..' && name !== '.DS_Store' && name !== 'Thumbs.db',
    );
    const isEmptyDirectory = meaningful.length === 0;
    const onlyGit = meaningful.length === 1 && meaningful[0] === '.git';
    for (const name of meaningful) {
      const lower = name.toLowerCase();
      if (SOFTWARE_PROJECT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        markersHit.push(name);
      }
    }

    // 仅有 src/app/lib 而无其他工程文件时仍可能是项目；保留命中即可
    const isSoftwareProject = markersHit.length > 0;
    const isNewProjectCandidate = isEmptyDirectory || onlyGit;
    return {
      path: root,
      projectName,
      isSoftwareProject: isSoftwareProject || isNewProjectCandidate,
      markersHit,
      isEmptyDirectory: isEmptyDirectory || onlyGit,
      isNewProjectCandidate,
      userFacingHint: isNewProjectCandidate
        ? '将在这个空文件夹中创建新的项目文件；开始前会请你确认范围。'
        : isSoftwareProject
          ? 'Digital Me 可以在你确认范围后读取项目、修改文件并运行本地测试。'
          : '',
    };
  } catch {
    /* ignore listing errors */
  }

  const isSoftwareProject = markersHit.length > 0;
  return {
    path: root,
    projectName,
    isSoftwareProject,
    markersHit,
    userFacingHint: isSoftwareProject
      ? 'Digital Me 可以在你确认范围后读取项目、修改文件并运行本地测试。'
      : '',
  };
}

/** 探测文件夹是否像代码仓库；返回命中的绝对路径（每项独立判断）。 */
export async function detectCodeRepoFolders(
  refs: readonly ContextRef[],
): Promise<string[]> {
  const hits: string[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'folder') continue;
    const inspected = await inspectSoftwareProject(ref.path);
    if (inspected.isSoftwareProject) hits.push(inspected.path);
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
  const wantsCodeModify = CODE_MODIFY_GOAL_RE.test(goal) && !wantsCodeAnalysis;
  const wantsWrite = WRITE_DOC_GOAL_RE.test(goal);
  const codeRepoPresent = materialKinds.includes('code_repo');

  // 高置信：明确修改目标 + 代码仓库材料 → 外部代码执行
  if (wantsCodeModify && (codeRepoPresent || hasCodeMaterial)) {
    return {
      intentKind: 'modify_code',
      expectedOutputFamily: 'code-change',
      materialKinds,
      highConfidence: codeRepoPresent || materialKinds.includes('folder'),
      requiresExecutionConfirm: true,
      userFacingNotice:
        '这项任务需要修改项目文件，将交给已连接的代码执行能力完成。开始前你可以查看它能够访问和修改的范围。',
    };
  }

  if (wantsCodeModify && !hasCodeMaterial) {
    return {
      intentKind: 'modify_code',
      expectedOutputFamily: 'code-change',
      materialKinds,
      highConfidence: false,
      requiresExecutionConfirm: true,
      userFacingNotice: '修改代码需要你添加项目文件夹。',
    };
  }

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
  const codeFolders = await detectCodeRepoFolders(input.contextRefs);
  const codeSet = new Set(codeFolders.map((p) => path.resolve(p)));
  const materialKinds: MaterialKind[] = [];
  for (const ref of input.contextRefs) {
    if (ref.kind === 'folder') {
      materialKinds.push(codeSet.has(path.resolve(ref.path)) ? 'code_repo' : 'folder');
    } else if (ref.kind === 'file') {
      const lower = ref.path.toLowerCase();
      if (/\.(md|txt|docx?|rtf)$/i.test(lower)) materialKinds.push('text_doc');
      else if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|c|cpp|h|cs)$/i.test(lower)) {
        materialKinds.push('code_repo');
      } else materialKinds.push('file');
    } else {
      materialKinds.push('unknown');
    }
  }
  if (!materialKinds.length) materialKinds.push('unknown');

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
