/**
 * Engineering / Change / Verification bundle 写出器 — Artifact 载荷形态,无新 Store。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CODE_CHANGE_SCHEMA_VERSION,
  ENGINEERING_PLAN_SCHEMA_VERSION,
  VERIFICATION_SCHEMA_VERSION,
  type CodeChangeManifest,
  type EngineeringPlanManifest,
  type VerificationCheck,
  type VerificationManifest,
  assertChangeProposalComplete,
} from '../capability/adapters/software-engineering-contract';
import type { WorkspaceHandle } from './workspace-manager';
import { nowIso } from '../shared/ids';

export async function writeEngineeringPlanBundle(
  outDir: string,
  input: {
    goal: string;
    snapshotNote: string;
    workspace: WorkspaceHandle;
  },
): Promise<{ planDir: string; manifest: EngineeringPlanManifest }> {
  const planDir = path.join(outDir, 'engineering-plan');
  await fs.mkdir(planDir, { recursive: true });
  const manifest: EngineeringPlanManifest = {
    schemaVersion: ENGINEERING_PLAN_SCHEMA_VERSION,
    generatedAt: nowIso(),
    goalDigest: simpleDigest(input.goal),
    snapshotId: `snap_ws_${input.workspace.id}`,
    stages: [
      {
        id: 'stage_change',
        title: '在隔离工作区修改按钮文案',
        acceptanceCriteria: [
          'PRIMARY_BUTTON_LABEL 变为「开始处理」',
          '相关单测与 tsc 通过',
          '原仓库未被修改',
        ],
        requiredPermissionLevel: 'L1',
        ownerDecisionRequired: false,
      },
    ],
    requiredPermissionLevel: 'L1',
    ownerDecisionRequired: false,
    generatedBy: { capabilityId: 'cap_cto_engineering', adapterId: 'cto-engineering' },
  };

  const planMd = [
    '# 工程计划',
    '',
    '## 用户目标',
    '',
    input.goal,
    '',
    '## 当前项目状态',
    '',
    input.snapshotNote,
    '',
    `基线 revision: ${input.workspace.baseRevision || '（无 git）'}`,
    `基线 digest: ${input.workspace.baseDigest}`,
    '',
    '## 假设与未知项',
    '',
    '- 样例项目仅为 P2B.1 验证夹具，不代表生产仓。',
    '- Coding Agent 仅获 L1（隔离区写入 + 受限命令）。',
    '',
    '## 阶段拆分',
    '',
    '1. 在隔离工作区将主按钮文案从「开始」改为「开始处理」。',
    '2. Digital Me 独立运行 tsc、单测与 UI 静态检查。',
    '3. 产出 Change Proposal，供 Owner 审查；不应用到原仓。',
    '',
    '## 每阶段验收标准',
    '',
    '- 文案已改且可在源码中定位。',
    '- 独立验证至少一项 `digitalme_verified` 通过。',
    '- Owner 决策点：0。',
    '',
    '## 预期调用的能力',
    '',
    '- coding-agent（Codex CLI，workspace-write）',
    '- verify-static / verify-test（Digital Me 本地执行）',
    '',
    '## 权限需求',
    '',
    '- L1：`workspace_write`、`command_execute`（受限）',
    '- 不含 `repository_apply` / `git_push` / `deployment`',
    '',
    '## 风险与回滚',
    '',
    '- Agent 可能改错文件：以 patch 审查拦截。',
    '- 回滚：丢弃隔离工作区即可，原仓无改动。',
    '',
    '## Owner 决策点',
    '',
    '- 无（本任务 L1 only，不 apply）。',
    '',
    '## 完成定义',
    '',
    '- Change Proposal 完备 + Digital Me 独立验证完成 + 原仓 digest 不变。',
    '',
  ].join('\n');

  await fs.writeFile(path.join(planDir, 'plan.md'), planMd, 'utf8');
  await fs.writeFile(path.join(planDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { planDir, manifest };
}

export async function writeChangeProposalFromWorkspace(
  outDir: string,
  input: {
    workspace: WorkspaceHandle;
    goal: string;
    agentSummary: string;
    authorizationGrantId: string;
    generatedBy: { capabilityId: string; adapterId: string };
  },
): Promise<{
  changeDir: string;
  manifest: CodeChangeManifest;
  changedFiles: string[];
  patch: string;
}> {
  const changeDir = path.join(outDir, 'change-proposal');
  const changedFilesDir = path.join(changeDir, 'changed-files');
  await fs.mkdir(changedFilesDir, { recursive: true });

  const diff = collectGitDiff(input.workspace.rootPath);
  const changedFiles = listChangedFiles(input.workspace.rootPath);
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (/^\+[^+]/.test(line)) additions += 1;
    if (/^-[^-]/.test(line)) deletions += 1;
  }

  for (const rel of changedFiles) {
    const abs = path.join(input.workspace.rootPath, rel);
    const dest = path.join(changedFilesDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(abs, dest);
  }

  const completeness = assertChangeProposalComplete({
    hasPatch: diff.trim().length > 0,
    baseDigest: input.workspace.baseDigest,
    changedFiles,
    wroteUserRepo: false,
  });
  if (!completeness.ok) {
    throw new Error(`change proposal incomplete: ${completeness.reasons.join(',')}`);
  }

  const manifest: CodeChangeManifest = {
    schemaVersion: CODE_CHANGE_SCHEMA_VERSION,
    generatedAt: nowIso(),
    baseRevision: input.workspace.baseRevision,
    baseDigest: input.workspace.baseDigest,
    workspaceId: input.workspace.id,
    changedFiles,
    additions,
    deletions,
    generatedBy: input.generatedBy,
    authorizationGrantId: input.authorizationGrantId,
    verificationStatus: 'agent_claimed',
    unresolvedIssues: [],
  };

  const summaryMd = [
    '# 变更摘要',
    '',
    `目标：${input.goal}`,
    '',
    '## 改动文件',
    '',
    ...changedFiles.map((f) => `- ${f}`),
    '',
    '## Agent 执行摘要',
    '',
    input.agentSummary.slice(0, 4000),
    '',
    '## 说明',
    '',
    '- 本提案仅存在于隔离工作区产物，**未**应用到原仓库。',
    '- Agent 自报不等于 Digital Me 独立验证。',
    '',
  ].join('\n');

  const risksMd = [
    '# 风险',
    '',
    '- 文案修改可能遗漏其他引用点。',
    '- 未执行 apply / commit / push / deploy。',
    '- Owner 审查前不得当作已交付。',
    '',
  ].join('\n');

  const verificationPlanMd = [
    '# 验证计划',
    '',
    '1. `tsc -p tsconfig.json`',
    '2. `npm test`（样例单测）',
    '3. UI 静态：源码含「开始处理」且不再导出「开始」为最终文案',
    '',
  ].join('\n');

  await fs.writeFile(path.join(changeDir, 'summary.md'), summaryMd, 'utf8');
  await fs.writeFile(path.join(changeDir, 'patch.diff'), diff, 'utf8');
  await fs.writeFile(path.join(changeDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(path.join(changeDir, 'risks.md'), risksMd, 'utf8');
  await fs.writeFile(path.join(changeDir, 'verification-plan.md'), verificationPlanMd, 'utf8');

  return { changeDir, manifest, changedFiles, patch: diff };
}

export async function writeVerificationBundle(
  outDir: string,
  input: {
    workspace: WorkspaceHandle;
    changeArtifactRel?: string;
    checks: VerificationCheck[];
  },
): Promise<{ verificationDir: string; manifest: VerificationManifest }> {
  const verificationDir = path.join(outDir, 'verification');
  const logsDir = path.join(verificationDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });

  const dmChecks = input.checks.filter((c) => c.verdictSource === 'digitalme_verified');
  const digitalMeVerified =
    dmChecks.length > 0 && dmChecks.every((c) => c.status === 'passed');
  const anyFailed = input.checks.some((c) => c.status === 'failed' || c.status === 'error');
  const overall: VerificationManifest['overall'] = anyFailed
    ? input.checks.every((c) => c.status === 'failed' || c.status === 'error')
      ? 'failed'
      : 'mixed'
    : 'passed';

  const manifest: VerificationManifest = {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    generatedAt: nowIso(),
    workspaceId: input.workspace.id,
    checks: input.checks,
    overall,
    digitalMeVerified,
  };
  if (input.changeArtifactRel) {
    manifest.changeArtifactId = input.changeArtifactRel;
  }

  const summaryMd = [
    '# 验证摘要',
    '',
    `总体：${overall}`,
    `Digital Me 独立验证通过项：${digitalMeVerified ? '有' : '无'}`,
    '',
    '## 判定来源说明',
    '',
    '- `agent_claimed`：Agent 自报，不得单独关闭质量门',
    '- `digitalme_verified`：Digital Me 重新执行并通过',
    '- `owner_accepted`：Owner 真实验收（本切片不自动写入）',
    '',
    '## 检查项',
    '',
    ...input.checks.map(
      (c) =>
        `- [${c.status}] ${c.name} · ${c.verdictSource} · ${c.durationMs}ms` +
        (c.failureSummary ? ` · ${c.failureSummary}` : ''),
    ),
    '',
  ].join('\n');

  await fs.writeFile(path.join(verificationDir, 'summary.md'), summaryMd, 'utf8');
  await fs.writeFile(
    path.join(verificationDir, 'checks.json'),
    JSON.stringify(input.checks, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(verificationDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return { verificationDir, manifest };
}

function collectGitDiff(cwd: string): string {
  const r = spawnSync('git', ['diff', '--no-color'], { cwd, encoding: 'utf8', shell: false });
  if (r.status === 0 && String(r.stdout || '').trim()) return String(r.stdout);
  const staged = spawnSync('git', ['diff', '--no-color', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  return String(staged.stdout || r.stdout || '');
}

function listChangedFiles(cwd: string): string[] {
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  const out = String(r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out;
}

function simpleDigest(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return `g${h.toString(16)}`;
}
