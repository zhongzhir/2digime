/**
 * 任务包生成 — 最小必要上下文，禁止 SubjectPackage / 密钥入包。
 */
import * as path from 'node:path';
import {
  CODE_CHANGE_BUNDLE_ROLES,
  DEFAULT_FORBIDDEN_OPERATIONS,
  type ExecutorTaskPackage,
} from './external-executor-contract';

const MODIFY_GOAL_HINTS =
  /修改|修复|实现|重构|改成|改为|更新|添加|删除|补上|修一下|fix|implement|refactor|change|update|add\s|remove\s/i;

export function looksLikeCodeModificationGoal(goal: string): boolean {
  return MODIFY_GOAL_HINTS.test(String(goal || '').trim());
}

export function deriveAcceptanceCriteria(goal: string): string[] {
  const g = String(goal || '').trim();
  const criteria = [
    `完成用户目标：${g.slice(0, 400)}`,
    '仅修改授权范围内的文件',
    '不执行提交、推送、发布或删除仓库',
  ];
  if (/测试|test|tsc|单测|单元/i.test(g)) {
    criteria.push('按目标要求运行相关测试并使其通过');
  } else {
    criteria.push('若项目存在可运行的本地测试，在改动后执行并报告结果');
  }
  return criteria;
}

export function deriveDoNotDo(goal: string): string[] {
  const base = [
    '不要 git commit 或 git push',
    '不要创建远程 PR、部署或发布',
    '不要修改授权范围外的文件',
    '不要读取或写入 API Key、模型凭证或完整个人主体资料',
    '不要做与目标无关的大规模重构',
  ];
  if (!/依赖|upgrade|bump|package\.json/i.test(goal)) {
    base.push('不要升级依赖或修改锁文件，除非目标明确要求');
  }
  return base;
}

export function deriveDefaultScopes(workingDirectory: string): {
  readScope: string[];
  writeScope: string[];
} {
  void workingDirectory;
  // 首轮默认：整个工作目录可读可写（用户确认卡上可见）；后续可收窄。
  return {
    readScope: ['.'],
    writeScope: ['.'],
  };
}

export function buildExecutorTaskPackage(input: {
  taskId: string;
  jobId: string;
  goal: string;
  workingDirectory: string;
  readScope?: string[];
  writeScope?: string[];
  projectBrief?: string;
  priorDecisions?: string[];
  snapshotId?: string;
  materialPaths?: string[];
  subjectDecisionBriefs?: string[];
  previousRun?: ExecutorTaskPackage['previousRun'];
  timeoutMs?: number;
  executorId: string;
  executorSelectionReason: string;
  acceptanceCriteria?: string[];
  doNotDo?: string[];
}): ExecutorTaskPackage {
  const scopes = deriveDefaultScopes(input.workingDirectory);
  const readScope = input.readScope?.length ? input.readScope : scopes.readScope;
  const writeScope = input.writeScope?.length ? input.writeScope : scopes.writeScope;
  return {
    schemaVersion: 'executor-task-package/1',
    taskId: input.taskId,
    jobId: input.jobId,
    goal: String(input.goal || '').trim(),
    acceptanceCriteria: input.acceptanceCriteria?.length
      ? input.acceptanceCriteria
      : deriveAcceptanceCriteria(input.goal),
    projectBrief: (input.projectBrief || '用户选定的本地代码项目。').slice(0, 2000),
    priorDecisions: (input.priorDecisions || []).slice(0, 20),
    doNotDo: input.doNotDo?.length ? input.doNotDo : deriveDoNotDo(input.goal),
    workingDirectory: path.resolve(input.workingDirectory),
    readScope,
    writeScope,
    forbiddenOperations: [...DEFAULT_FORBIDDEN_OPERATIONS],
    contextDigest: {
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
      materialPaths: (input.materialPaths || []).slice(0, 40),
      subjectDecisionBriefs: (input.subjectDecisionBriefs || []).slice(0, 12),
    },
    ...(input.previousRun ? { previousRun: input.previousRun } : {}),
    outputContract: {
      requiredParts: [...CODE_CHANGE_BUNDLE_ROLES],
    },
    timeoutMs: input.timeoutMs ?? 600_000,
    executorSelectionReason: input.executorSelectionReason,
    executorId: input.executorId,
  };
}

/** 渲染给人可读、给执行器可解析的 prompt（不含密钥与完整主体包）。 */
export function renderTaskPackagePrompt(pkg: ExecutorTaskPackage): string {
  const lines = [
    '你是被 Digital Me 委派的外部代码执行器。Digital Me 是任务控制方；你只负责在授权范围内实施改动。',
    '',
    '## 用户目标',
    pkg.goal,
    '',
    '## 项目背景摘要',
    pkg.projectBrief,
    '',
    '## 既有决策与边界',
    ...(pkg.priorDecisions.length
      ? pkg.priorDecisions.map((d, i) => `${i + 1}. ${d}`)
      : ['- （无额外决策）']),
    '',
    '## 明确不做',
    ...pkg.doNotDo.map((d) => `- ${d}`),
    '',
    '## 工作目录',
    pkg.workingDirectory,
    '',
    '## 允许读取的范围（相对工作目录）',
    ...pkg.readScope.map((s) => `- ${s}`),
    '',
    '## 允许修改的范围（相对工作目录）',
    ...pkg.writeScope.map((s) => `- ${s}`),
    '',
    '## 禁止操作',
    ...pkg.forbiddenOperations.map((s) => `- ${s}`),
    '',
    '## 验收条件',
    ...pkg.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## 输出要求',
    '完成后请给出：变更摘要、修改文件列表、你运行过的测试及结果、未完成事项。',
    '不要声称已 commit / push。不要修改授权范围外文件。',
  ];
  if (pkg.previousRun) {
    lines.push(
      '',
      '## 上一次执行与本次修订要求',
      `上次摘要：${pkg.previousRun.summary.slice(0, 1500)}`,
      `上次改动文件：${pkg.previousRun.changedFiles.join(', ') || '（无）'}`,
      `本次修订要求：${pkg.previousRun.revisionRequest}`,
    );
  }
  return lines.join('\n');
}

export function buildExecutionConfirmPreview(input: {
  goal: string;
  workingDirectory: string;
  readScope?: string[];
  writeScope?: string[];
  executorDisplayName: string;
}): {
  notice: string;
  workingDirectory: string;
  readScope: string[];
  writeScope: string[];
  forbidden: string[];
  acceptancePreview: {
    goals: string[];
    tests: string[];
    doNotDo: string[];
  };
} {
  const scopes = deriveDefaultScopes(input.workingDirectory);
  const readScope = input.readScope?.length ? input.readScope : scopes.readScope;
  const writeScope = input.writeScope?.length ? input.writeScope : scopes.writeScope;
  const criteria = deriveAcceptanceCriteria(input.goal);
  const doNotDo = deriveDoNotDo(input.goal);
  return {
    notice:
      '这项任务需要修改项目文件，将交给已连接的代码执行能力完成。开始前你可以查看它能够访问和修改的范围。',
    workingDirectory: path.resolve(input.workingDirectory),
    readScope,
    writeScope,
    forbidden: [
      '不会自动提交或推送代码',
      '不会创建远程合并请求或部署',
      '不会修改你未授权的目录',
      `将使用：${input.executorDisplayName}`,
    ],
    acceptancePreview: {
      goals: [criteria[0] || input.goal],
      tests: criteria.filter((c) => /测试|test/i.test(c)),
      doNotDo: doNotDo.slice(0, 4),
    },
  };
}
