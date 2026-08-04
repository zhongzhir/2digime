/**
 * P2B.1 编排：隔离工作区 → 工程计划 → Coding Agent(L1) → Change Proposal → 独立验证。
 * 不新增生产命令；不 apply / commit / push / deploy；不改原仓。
 *
 * 用法:
 *   node scripts/run-p2b1-isolated-code-change.cjs                 # 全流程（默认 Codex）
 *   node scripts/run-p2b1-isolated-code-change.cjs --phase=prepare
 *   node scripts/run-p2b1-isolated-code-change.cjs --phase=finalize --agent=cursor-agent
 *   node scripts/run-p2b1-isolated-code-change.cjs --agent=codex
 */
'use strict';

const { promises: fs } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const out = { phase: 'all', agent: 'codex' };
  for (const a of argv) {
    if (a.startsWith('--phase=')) out.phase = a.slice('--phase='.length);
    if (a.startsWith('--agent=')) out.agent = a.slice('--agent='.length);
  }
  return out;
}

async function ensureBuild(appRoot) {
  process.chdir(appRoot);
  const r = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('build failed');
}

async function loadModules() {
  return {
    IsolatedWorkspaceManager: require('../dist/engineering/workspace-manager').IsolatedWorkspaceManager,
    digestTree: require('../dist/engineering/workspace-manager').digestTree,
    writeEngineeringPlanBundle: require('../dist/engineering/bundle-writers').writeEngineeringPlanBundle,
    writeChangeProposalFromWorkspace: require('../dist/engineering/bundle-writers')
      .writeChangeProposalFromWorkspace,
    writeVerificationBundle: require('../dist/engineering/bundle-writers').writeVerificationBundle,
    runIndependentVerification: require('../dist/engineering/verification-runner')
      .runIndependentVerification,
    runCodexCodingAgent: require('../dist/capability/adapters/coding-agent-codex').runCodexCodingAgent,
    CODING_AGENT_CODEX_CAPABILITY_ID: require('../dist/capability/adapters/coding-agent-codex')
      .CODING_AGENT_CODEX_CAPABILITY_ID,
    CODING_AGENT_CODEX_ADAPTER_ID: require('../dist/capability/adapters/coding-agent-codex')
      .CODING_AGENT_CODEX_ADAPTER_ID,
  };
}

async function phasePrepare(appRoot, evidenceRoot, mods) {
  const fixtureRoot = path.join(appRoot, 'fixtures', 'p2b1-mini-ui');
  const sourceDigestBefore = await mods.digestTree(
    fixtureRoot,
    new Set(['.git', 'node_modules', 'dist']),
  );

  const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-p2b1-ws-'));
  const manager = new mods.IsolatedWorkspaceManager();
  const workspace = await manager.create({
    sourceRoot: fixtureRoot,
    parentDir,
    retention: 'retain_on_failure',
  });

  const npmInstall = spawnSync('npm', ['install'], {
    cwd: workspace.rootPath,
    stdio: 'inherit',
    shell: true,
  });
  if (npmInstall.status !== 0) throw new Error('workspace npm install failed');

  const goal =
    '将主按钮文案从「开始」改为「开始处理」，保持其余行为不变，并确保现有测试与类型检查可通过。';

  const { planDir, manifest: planManifest } = await mods.writeEngineeringPlanBundle(evidenceRoot, {
    goal,
    snapshotNote: `样例夹具 p2b1-mini-ui；隔离副本 ${workspace.id}`,
    workspace,
  });

  const handle = {
    goal,
    fixtureRoot,
    sourceDigestBefore,
    workspace,
    planDir,
    planManifest,
    grantId: `grant_p2b1_l1_${workspace.id}`,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(evidenceRoot, 'workspace-handle.json'),
    `${JSON.stringify(handle, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({ ok: true, phase: 'prepare', workspace: workspace.rootPath, handle: 'workspace-handle.json' }, null, 2));
  return handle;
}

async function phaseAgentCodex(evidenceRoot, handle, mods) {
  const agentLogDir = path.join(evidenceRoot, 'agent-logs');
  const agent = await mods.runCodexCodingAgent({
    workspace: handle.workspace,
    goal: handle.goal,
    planSummary: [
      `权限: L1 only (${handle.grantId})`,
      'Owner 决策点: 0',
      '禁止 apply/push/deploy',
      (handle.planManifest.stages || []).map((s) => s.title).join('；'),
    ].join('\n'),
    logDir: agentLogDir,
  });
  const record = {
    agentName: agent.agentName,
    capabilityId: mods.CODING_AGENT_CODEX_CAPABILITY_ID,
    adapterId: mods.CODING_AGENT_CODEX_ADAPTER_ID,
    claimedSuccess: agent.claimedSuccess,
    exitCode: agent.exitCode,
    summary: agent.summary,
    ok: agent.ok,
  };
  await fs.writeFile(
    path.join(evidenceRoot, 'agent-result.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  return record;
}

async function phaseAgentCursorExternal(evidenceRoot) {
  // Cursor Agent 由编排会话在隔离工作区完成修改后写入本记录。
  const recordPath = path.join(evidenceRoot, 'agent-result.json');
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch {
    throw new Error('缺少 agent-result.json：请先由 Cursor Agent 在隔离工作区完成修改并写入结果');
  }
  return record;
}

async function phaseFinalize(evidenceRoot, handle, agent, mods) {
  const {
    changeDir,
    manifest: changeManifest,
    changedFiles,
    patch,
  } = await mods.writeChangeProposalFromWorkspace(evidenceRoot, {
    workspace: handle.workspace,
    goal: handle.goal,
    agentSummary: agent.summary || '',
    authorizationGrantId: handle.grantId,
    generatedBy: {
      capabilityId: agent.capabilityId,
      adapterId: agent.adapterId,
    },
  });

  const verificationLogs = path.join(evidenceRoot, 'verification', 'logs');
  const independentChecks = await mods.runIndependentVerification(
    handle.workspace,
    verificationLogs,
  );
  const checks = [
    {
      name: 'agent_self_report',
      commandOrActionSummary: `${agent.agentName} self-report`,
      status: agent.claimedSuccess ? 'passed' : 'failed',
      durationMs: 0,
      evidenceRef: 'agent-result.json',
      reproducible: false,
      verdictSource: 'agent_claimed',
    },
    ...independentChecks,
  ];
  if (!agent.claimedSuccess) {
    checks[0].failureSummary = 'Agent 未给出成功自报';
  }

  const { verificationDir, manifest: verificationManifest } = await mods.writeVerificationBundle(
    evidenceRoot,
    {
      workspace: handle.workspace,
      changeArtifactRel: 'change-proposal',
      checks,
    },
  );

  changeManifest.verificationStatus = verificationManifest.digitalMeVerified
    ? 'digitalme_verified'
    : 'failed';
  await fs.writeFile(
    path.join(changeDir, 'manifest.json'),
    `${JSON.stringify(changeManifest, null, 2)}\n`,
    'utf8',
  );

  const sourceAfter = await mods.digestTree(
    handle.fixtureRoot,
    new Set(['.git', 'node_modules', 'dist']),
  );
  const sourceUnchanged = sourceAfter === handle.sourceDigestBefore;

  const report = {
    phase: 'P2B.1-isolated-code-change',
    codingAgent: agent.agentName,
    codingAgentCapabilityId: agent.capabilityId,
    grantId: handle.grantId,
    permissionLevel: 'L1',
    goal: handle.goal,
    engineeringPlan: {
      path: handle.planDir,
      ownerDecisionRequired: handle.planManifest.ownerDecisionRequired,
      stages: handle.planManifest.stages,
      summary: '隔离区改主按钮文案「开始」→「开始处理」；独立验证；不 apply',
    },
    workspace: {
      id: handle.workspace.id,
      path: handle.workspace.rootPath,
      baseRevision: handle.workspace.baseRevision,
      baseDigest: handle.workspace.baseDigest,
    },
    changedFiles,
    patchSummary: {
      bytes: Buffer.byteLength(patch, 'utf8'),
      additions: changeManifest.additions,
      deletions: changeManifest.deletions,
      preview: patch.slice(0, 1200),
    },
    agentClaimed: {
      ok: !!agent.claimedSuccess,
      exitCode: agent.exitCode ?? null,
      summary: String(agent.summary || '').slice(0, 1000),
    },
    digitalMeVerified: {
      ok: verificationManifest.digitalMeVerified,
      overall: verificationManifest.overall,
      checks: checks.map((c) => ({
        name: c.name,
        status: c.status,
        verdictSource: c.verdictSource,
        durationMs: c.durationMs,
        failureSummary: c.failureSummary || null,
      })),
    },
    ownerAccepted: false,
    originalRepoChanged: !sourceUnchanged,
    sourceDigestBefore: handle.sourceDigestBefore,
    sourceDigestAfter: sourceAfter,
    artifacts: {
      plan: handle.planDir,
      changeProposal: changeDir,
      verification: verificationDir,
    },
    recommendP2B2: verificationManifest.digitalMeVerified && sourceUnchanged,
    ok: verificationManifest.digitalMeVerified && sourceUnchanged && changedFiles.length > 0,
  };

  await fs.writeFile(
    path.join(evidenceRoot, 'p2b1-summary.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appRoot = path.resolve(__dirname, '..');
  const evidenceRoot = path.join(appRoot, 'scripts', '_mvp-p2b1-isolated-code-change-evidence');
  await fs.mkdir(evidenceRoot, { recursive: true });
  await ensureBuild(appRoot);
  const mods = await loadModules();

  let handle;
  if (args.phase === 'prepare' || args.phase === 'all') {
    handle = await phasePrepare(appRoot, evidenceRoot, mods);
  } else {
    handle = JSON.parse(await fs.readFile(path.join(evidenceRoot, 'workspace-handle.json'), 'utf8'));
  }
  if (args.phase === 'prepare') return;

  let agent;
  if (args.phase === 'finalize' && args.agent === 'cursor-agent') {
    agent = await phaseAgentCursorExternal(evidenceRoot);
  } else if (args.agent === 'codex' && args.phase !== 'finalize') {
    agent = await phaseAgentCodex(evidenceRoot, handle, mods);
  } else if (args.phase === 'finalize') {
    agent = await phaseAgentCursorExternal(evidenceRoot);
  } else {
    agent = await phaseAgentCodex(evidenceRoot, handle, mods);
  }

  if (args.phase === 'agent') {
    console.log(JSON.stringify({ ok: true, phase: 'agent', agent }, null, 2));
    return;
  }

  const report = await phaseFinalize(evidenceRoot, handle, agent, mods);
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
