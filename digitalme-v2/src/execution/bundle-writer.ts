/**
 * code-change bundle 写出 — 进入现有 Artifact 主链。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { nowIso } from '../shared/ids';
import type {
  CollectedExecutionChanges,
  ExecutionVerificationReport,
  ExecutorRunResult,
  ExecutorTaskPackage,
} from './external-executor-contract';
import { CODE_CHANGE_ARTIFACT_TYPE, userFacingVerification } from './external-executor-contract';

export async function writeCodeChangeBundle(input: {
  outDir: string;
  taskPackage: ExecutorTaskPackage;
  agentResult: ExecutorRunResult;
  collected: CollectedExecutionChanges;
  verification: ExecutionVerificationReport;
}): Promise<{
  bundleDir: string;
  entries: Array<{ sourcePath: string; mediaType: string; role: string }>;
  title: string;
}> {
  const bundleDir = path.join(input.outDir, 'code-change-bundle');
  await fs.mkdir(bundleDir, { recursive: true });

  const summaryMd = [
    '# 执行摘要',
    '',
    `**验收结论：** ${userFacingVerification(input.verification.overall)}`,
    '',
    '## 目标',
    '',
    input.taskPackage.goal,
    '',
    '## 执行器说明',
    '',
    input.agentResult.summary.slice(0, 4000) || '（无）',
    '',
    '## Digital Me 独立验证',
    '',
    ...input.verification.checks.map(
      (c) => `- ${c.title}：${userFacingVerification(c.verdict)} — ${c.detail}`,
    ),
    '',
    '## 工作目录',
    '',
    input.taskPackage.workingDirectory,
    '',
    `执行器：${input.agentResult.executorId} / ${input.agentResult.executorRunId}`,
    `退出码：${input.agentResult.exitCode ?? '未知'}`,
    '',
  ].join('\n');
  await fs.writeFile(path.join(bundleDir, 'execution-summary.md'), summaryMd, 'utf8');

  await fs.writeFile(
    path.join(bundleDir, 'changed-files.json'),
    JSON.stringify(
      {
        changedFiles: input.collected.changedFiles,
        changes: input.collected.changes.filter((c) => c.withinWriteScope),
        outOfScopeChanges: input.collected.outOfScopeChanges,
        untrackedCreated: input.collected.untrackedCreated,
        untrackedDeleted: input.collected.untrackedDeleted,
        concurrentModificationSuspected: input.collected.concurrentModificationSuspected,
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(path.join(bundleDir, 'patch.diff'), input.collected.unifiedDiff || '', 'utf8');

  await fs.writeFile(
    path.join(bundleDir, 'tests.json'),
    JSON.stringify(
      {
        commands: input.agentResult.testCommands,
        results: input.agentResult.testResults,
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(bundleDir, 'evidence.json'),
    JSON.stringify(
      {
        taskPackageRef: 'task-package.json',
        baselineRef: 'baseline.json',
        collectedRef: 'collected-changes.json',
        verificationRef: 'verification.json',
        agentStdoutRef: 'codex-stdout.jsonl',
        workingDirectory: input.taskPackage.workingDirectory,
        scopeDigestAfter: input.collected.afterScopeDigest,
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(bundleDir, 'unresolved-items.md'),
    [
      '# 未完成事项',
      '',
      ...(input.agentResult.unresolvedItems.length
        ? input.agentResult.unresolvedItems.map((x) => `- ${x}`)
        : ['- （无）']),
      '',
      '## 警告',
      '',
      ...(input.agentResult.warnings.length
        ? input.agentResult.warnings.map((x) => `- ${x}`)
        : ['- （无）']),
      '',
      '## 提问',
      '',
      ...(input.agentResult.questions.length
        ? input.agentResult.questions.map(
            (q) =>
              `- ${q.text}${q.answeredBy ? `（已由${q.answeredBy === 'digitalme' ? ' Digital Me' : '你'}回答）` : ''}`,
          )
        : ['- （无）']),
      '',
    ].join('\n'),
    'utf8',
  );

  const manifest = {
    schemaVersion: 'code-change/1',
    artifactType: CODE_CHANGE_ARTIFACT_TYPE,
    generatedAt: nowIso(),
    workingDirectory: input.taskPackage.workingDirectory,
    changedFiles: input.collected.changedFiles,
    verificationOverall: input.verification.overall,
    digitalMeVerified: input.verification.digitalMeVerified,
    agentClaimedSuccess: input.verification.agentClaimedSuccess,
    executor: {
      executorId: input.agentResult.executorId,
      executorRunId: input.agentResult.executorRunId,
      exitCode: input.agentResult.exitCode,
    },
    authorization: {
      readScope: input.taskPackage.readScope,
      writeScope: input.taskPackage.writeScope,
      forbiddenOperations: input.taskPackage.forbiddenOperations,
    },
    writeScope: input.taskPackage.writeScope,
    acceptanceCriteria: input.taskPackage.acceptanceCriteria,
    afterScopeDigest: input.collected.afterScopeDigest,
  };
  await fs.writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const entries = [
    {
      sourcePath: path.join(bundleDir, 'execution-summary.md'),
      mediaType: 'text/markdown',
      role: 'execution-summary',
    },
    {
      sourcePath: path.join(bundleDir, 'changed-files.json'),
      mediaType: 'application/json',
      role: 'changed-files',
    },
    {
      sourcePath: path.join(bundleDir, 'patch.diff'),
      mediaType: 'text/x-diff',
      role: 'diff',
    },
    {
      sourcePath: path.join(bundleDir, 'tests.json'),
      mediaType: 'application/json',
      role: 'tests',
    },
    {
      sourcePath: path.join(bundleDir, 'evidence.json'),
      mediaType: 'application/json',
      role: 'evidence',
    },
    {
      sourcePath: path.join(bundleDir, 'unresolved-items.md'),
      mediaType: 'text/markdown',
      role: 'unresolved-items',
    },
    {
      sourcePath: path.join(bundleDir, 'manifest.json'),
      mediaType: 'application/json',
      role: 'manifest',
    },
  ];

  return {
    bundleDir,
    entries,
    title: `代码修改：${input.taskPackage.goal.slice(0, 60)}`,
  };
}
