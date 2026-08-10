/**
 * Digital Me 独立验证 — 执行器自报不得单独决定成功。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  CollectedExecutionChanges,
  ExecutionVerificationReport,
  ExecutorRunResult,
  ExecutorTaskPackage,
  VerificationCheckResult,
  VerificationVerdict,
} from './external-executor-contract';
import { computeScopeDigest } from './baseline';
import {
  buildNpmTestCommand,
  buildNpxTscCommand,
  runCommandShellFalse,
} from './test-command';
import { nowIso } from '../shared/ids';

export async function verifyExternalExecution(input: {
  taskPackage: ExecutorTaskPackage;
  agentResult: ExecutorRunResult;
  collected: CollectedExecutionChanges;
  jobEvidenceDir: string;
  /** 采用前工作目录是否仍与成果一致 */
  adoptConsistencyDigest?: string;
}): Promise<ExecutionVerificationReport> {
  const checks: VerificationCheckResult[] = [];
  const pkg = input.taskPackage;
  const agent = input.agentResult;
  const col = input.collected;

  // 1. 退出码
  checks.push({
    id: 'exit_code',
    title: '外部执行器是否成功退出',
    verdict:
      agent.exitCode === 0
        ? 'satisfied'
        : agent.exitCode == null
          ? 'unverifiable'
          : 'unsatisfied',
    detail:
      agent.exitCode === 0
        ? '进程退出码为 0'
        : `进程退出码为 ${agent.exitCode ?? '未知'}`,
  });

  // 2. 是否实际产生文件变化
  const hasChanges = col.changedFiles.length > 0;
  checks.push({
    id: 'file_changes',
    title: '是否实际产生预期文件变化',
    verdict: hasChanges ? 'satisfied' : 'unsatisfied',
    detail: hasChanges
      ? `检测到 ${col.changedFiles.length} 个范围内文件变化`
      : '授权范围内未检测到文件变化',
  });

  // 3. 越界
  checks.push({
    id: 'scope_boundary',
    title: '是否修改了授权范围外文件',
    verdict: col.outOfScopeChanges.length === 0 ? 'satisfied' : 'unsatisfied',
    detail:
      col.outOfScopeChanges.length === 0
        ? '未发现范围外改动'
        : `范围外改动：${col.outOfScopeChanges.slice(0, 8).join(', ')}`,
  });

  // 4. 目标与变更对照：以执行前理解 / 实施方案 / 实际 diff 为主，关键词仅辅助
  checks.push(assessGoalAlignment(pkg, col));

  // 5–6. 自动测试（无 test script ≠ 测试失败）
  const { inspectAutoTestConfig, runBuildCheck, runStartupCheck } = await import(
    './startup-check'
  );
  const testCfg = await inspectAutoTestConfig(pkg.workingDirectory);
  checks.push({
    id: 'tests_configured',
    title: '项目是否配置了自动测试',
    verdict: testCfg.hasTestScript
      ? 'satisfied'
      : testCfg.hasPackageJson
        ? 'unsatisfied'
        : 'unverifiable',
    detail: testCfg.hasTestScript
      ? '已配置 test 脚本'
      : testCfg.hasPackageJson
        ? '这个项目没有配置自动测试'
        : '未发现 package.json',
  });

  const testResults = await runDeclaredTests(pkg, input.jobEvidenceDir, agent, testCfg);
  const testsRan = testResults.length > 0;
  const testsPassed = testResults.every((t) => t.passed);
  checks.push({
    id: 'tests_executed',
    title: '自动测试是否执行',
    verdict: !testCfg.hasTestScript
      ? 'unverifiable'
      : testsRan
        ? 'satisfied'
        : /测试|test/i.test(pkg.goal) || testCfg.hasTestScript
          ? 'unsatisfied'
          : 'unverifiable',
    detail: !testCfg.hasTestScript
      ? '未配置测试（not_configured），未执行'
      : testsRan
        ? `已执行 ${testResults.length} 项检查：${testResults
            .map((t) => `${t.command} → exit ${t.exitCode}`)
            .join('；')
            .slice(0, 240)}`
        : '测试命令无法启动或未执行',
  });
  checks.push({
    id: 'tests_passed',
    title: '自动测试结果',
    verdict: !testCfg.hasTestScript
      ? 'unverifiable'
      : !testsRan
        ? 'unverifiable'
        : testsPassed
          ? 'satisfied'
          : 'unsatisfied',
    detail: !testCfg.hasTestScript
      ? '未配置测试（not_configured）'
      : !testsRan
        ? '测试命令无法启动'
        : testsPassed
          ? '自动测试通过'
          : '自动测试失败（execution_failed）',
  });
  agent.testResults = testResults;
  agent.testCommands = testResults.map((t) => t.command);

  // 6b. 构建（如有）
  const build = await runBuildCheck(pkg.workingDirectory);
  if (build) {
    checks.push({
      id: 'build_check',
      title: '构建检查',
      verdict:
        build.kind === 'build_passed'
          ? 'satisfied'
          : build.kind === 'not_configured'
            ? 'unverifiable'
            : 'unsatisfied',
      detail: build.detail || build.label,
    });
  }

  // 6c. 启动检查（新项目 / 游戏类目标强制）
  const needsRun =
    !!pkg.projectOrigin ||
    /游戏|tetris|方块|启动|运行|试玩/i.test(pkg.goal) ||
    pkg.acceptanceCriteria.some((c) => /启动|运行/.test(c));
  if (needsRun || !testCfg.hasTestScript) {
    const startup = await runStartupCheck(pkg.workingDirectory);
    checks.push({
      id: 'run_startup_check',
      title: '启动检查',
      verdict:
        startup.kind === 'startup_passed'
          ? 'satisfied'
          : startup.kind === 'run_not_verified' || startup.kind === 'not_configured'
            ? 'unverifiable'
            : 'unsatisfied',
      detail: `${startup.label}${startup.detail ? `：${startup.detail}` : ''}`,
    });
  }

  // 7. 未说明脏文件 / 禁 commit
  checks.push({
    id: 'git_integrity',
    title: '是否存在未说明的提交或 HEAD 移动',
    verdict:
      col.gitHeadMoved || col.newCommitsDetected ? 'unsatisfied' : 'satisfied',
    detail:
      col.gitHeadMoved || col.newCommitsDetected
        ? '检测到 Git HEAD 被移动或产生新提交（本轮禁止）'
        : '未检测到禁止的提交操作',
  });

  // 8. 自报与实际 diff 一致
  const claimed = new Set(agent.claimedChangedFiles.map(normalizeRel));
  const actual = new Set(col.changedFiles.map(normalizeRel));
  let claimMismatch = false;
  if (claimed.size > 0) {
    for (const f of claimed) {
      if (!actual.has(f)) claimMismatch = true;
    }
  }
  checks.push({
    id: 'claim_vs_diff',
    title: '执行器报告与实际变更是否一致',
    verdict:
      claimed.size === 0
        ? hasChanges
          ? 'partially_satisfied'
          : 'unverifiable'
        : claimMismatch
          ? 'partially_satisfied'
          : 'satisfied',
    detail:
      claimed.size === 0
        ? '执行器未提供完整文件清单，以独立采集为准'
        : claimMismatch
          ? '执行器自报与独立采集存在差异，以独立采集为准'
          : '自报文件清单与独立采集一致',
  });

  // 9. 修订实质变化
  if (pkg.previousRun) {
    const prev = new Set(pkg.previousRun.changedFiles.map(normalizeRel));
    const substantive = col.changedFiles.some((f) => !prev.has(normalizeRel(f))) ||
      col.unifiedDiff.length > 20;
    // 更严：after digest 与「仅重复」——用 changedFiles 非空且 diff 非空
    checks.push({
      id: 'revision_substantive',
      title: '修订后是否产生实质变化',
      verdict: hasChanges && substantive ? 'satisfied' : 'unsatisfied',
      detail: hasChanges ? '修订产生了新的文件变化' : '修订未产生可检测变化',
    });
  }

  // 10. 并发
  checks.push({
    id: 'concurrent_edit',
    title: '执行期间是否存在并发修改',
    verdict: col.concurrentModificationSuspected ? 'unsatisfied' : 'satisfied',
    detail: col.concurrentModificationSuspected
      ? '检测到可能的并发修改，不得直接视为已满足'
      : '未发现并发修改迹象',
  });

  // 采用一致性（可选）
  if (input.adoptConsistencyDigest) {
    const current = await computeScopeDigest(pkg.workingDirectory, pkg.writeScope);
    checks.push({
      id: 'adopt_consistency',
      title: '采用版本是否与当前工作目录一致',
      verdict:
        current === input.adoptConsistencyDigest ? 'satisfied' : 'unsatisfied',
      detail:
        current === input.adoptConsistencyDigest
          ? '当前工作目录与待验收结果一致'
          : '当前项目已与待验收结果不同',
    });
  }

  const overall = aggregateVerdict(checks);
  const report: ExecutionVerificationReport = {
    schemaVersion: 'execution-verification/1',
    generatedAt: nowIso(),
    overall,
    checks,
    agentClaimedSuccess: agent.status === 'succeeded' || agent.exitCode === 0,
    digitalMeVerified: overall === 'satisfied' || overall === 'partially_satisfied',
  };
  await fs.writeFile(
    path.join(input.jobEvidenceDir, 'verification.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  return report;
}

function aggregateVerdict(checks: VerificationCheckResult[]): VerificationVerdict {
  const hardFail = checks.filter((c) =>
    ['scope_boundary', 'git_integrity', 'concurrent_edit', 'file_changes'].includes(c.id),
  );
  if (hardFail.some((c) => c.verdict === 'unsatisfied')) return 'unsatisfied';
  if (checks.every((c) => c.verdict === 'satisfied' || c.verdict === 'unverifiable')) {
    const anySat = checks.some((c) => c.verdict === 'satisfied');
    return anySat ? 'satisfied' : 'unverifiable';
  }
  if (checks.some((c) => c.verdict === 'unsatisfied')) {
    const sat = checks.filter((c) => c.verdict === 'satisfied').length;
    return sat > 0 ? 'partially_satisfied' : 'unsatisfied';
  }
  if (checks.some((c) => c.verdict === 'partially_satisfied')) return 'partially_satisfied';
  return 'unverifiable';
}

function extractGoalTerms(goal: string): string[] {
  const raw = String(goal || '');
  const terms: string[] = [];
  const quoted = raw.match(/「([^」]+)」|"([^"]+)"|'([^']+)'/g);
  if (quoted) {
    for (const q of quoted) {
      const t = q.replace(/^「|」$/g, '').replace(/^["']|["']$/g, '').trim();
      if (t.length >= 2) terms.push(t);
    }
  }
  for (const part of raw.split(/[\s,，。；;：:]+/)) {
    if (part.length >= 2 && part.length <= 40 && !/^(请|把|将|在|的|和|与|或|并)$/.test(part)) {
      if (/[A-Za-z_]/.test(part) || /[\u4e00-\u9fff]{2,}/.test(part)) terms.push(part);
    }
  }
  return [...new Set(terms)].slice(0, 12);
}

/** 从执行前理解 / 方案摘要中抽取相对路径线索。 */
function extractUnderstandingPaths(brief: string): string[] {
  const text = String(brief || '');
  const found: string[] = [];
  for (const m of text.matchAll(
    /(?:^|[\s、，,;；:：→\-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?=$|[\s、，,;；:：）)\]])/g,
  )) {
    found.push(m[1]!.replace(/\\/g, '/'));
  }
  return [...new Set(found)].slice(0, 24);
}

function assessGoalAlignment(
  pkg: ExecutorTaskPackage,
  col: CollectedExecutionChanges,
): VerificationCheckResult {
  const changed = col.changedFiles.map(normalizeRel);
  const hasDiff = changed.length > 0 && String(col.unifiedDiff || '').length > 20;
  const brief = String(pkg.projectBrief || '');
  const understandingPaths = extractUnderstandingPaths(brief);
  const pathHits = understandingPaths.filter((p) =>
    changed.some(
      (c) =>
        c === p ||
        c.endsWith('/' + p) ||
        c.includes(p) ||
        p.endsWith(c) ||
        path.posix.basename(c) === path.posix.basename(p),
    ),
  );
  const auxTerms = extractGoalTerms(pkg.goal);
  const blob = `${changed.join('\n')}\n${String(col.unifiedDiff || '').slice(0, 20000)}`;
  const auxHits = auxTerms.filter((t) => blob.toLowerCase().includes(t.toLowerCase()));

  let verdict: VerificationVerdict;
  const parts: string[] = [];
  if (!hasDiff) {
    verdict = 'unsatisfied';
    parts.push('无实际文件变更可供对照目标与方案');
  } else if (pathHits.length > 0) {
    verdict =
      pathHits.length >= Math.min(2, Math.max(1, understandingPaths.length)) ||
      pathHits.length >= 1
        ? 'satisfied'
        : 'partially_satisfied';
    parts.push(
      `变更覆盖执行前理解中的路径 ${pathHits.length}/${understandingPaths.length || pathHits.length}：${pathHits.slice(0, 8).join(', ')}`,
    );
    parts.push(`共 ${changed.length} 个文件有变更`);
  } else if (understandingPaths.length > 0) {
    verdict = 'partially_satisfied';
    parts.push(
      `已有 ${changed.length} 个文件变更，但与执行前理解点名路径未直接对齐，请对照方案与 diff`,
    );
  } else if (brief.trim().length > 40 && hasDiff) {
    verdict = 'partially_satisfied';
    parts.push(`已有 ${changed.length} 个文件变更；已结合执行前说明与 diff，需人工核对设计目标是否达成`);
  } else {
    verdict = 'partially_satisfied';
    parts.push(`已有 ${changed.length} 个文件变更；缺少可对齐的执行前路径线索`);
  }
  if (auxTerms.length) {
    parts.push(`辅助词命中 ${auxHits.length}/${auxTerms.length}（不作为主判定）`);
  }

  return {
    id: 'goal_alignment',
    title: '用户目标与实施方案是否有对应变更',
    verdict,
    detail: parts.join('；').slice(0, 400),
  };
}

async function runDeclaredTests(
  pkg: ExecutorTaskPackage,
  jobEvidenceDir: string,
  agent: ExecutorRunResult,
  testCfg?: { hasPackageJson: boolean; hasTestScript: boolean },
): Promise<ExecutorRunResult['testResults']> {
  const logsDir = path.join(jobEvidenceDir, 'test-logs');
  await fs.mkdir(logsDir, { recursive: true });
  const results: ExecutorRunResult['testResults'] = [];

  let hasPackage = testCfg?.hasPackageJson;
  let hasTestScript = testCfg?.hasTestScript;
  if (hasPackage == null || hasTestScript == null) {
    try {
      const raw = await fs.readFile(path.join(pkg.workingDirectory, 'package.json'), 'utf8');
      hasPackage = true;
      const parsed = JSON.parse(raw) as { scripts?: { test?: string } };
      hasTestScript = !!(parsed.scripts && typeof parsed.scripts.test === 'string');
    } catch {
      hasPackage = false;
      hasTestScript = false;
    }
  }

  // 未配置 test 脚本时绝不跑 npm test，避免被误判为“测试失败”
  if (!hasPackage || !hasTestScript) {
    return results;
  }

  const commands: string[][] = [];
  if (/测试|test|tsc/i.test(pkg.goal + pkg.acceptanceCriteria.join('\n')) || hasTestScript) {
    commands.push(buildNpmTestCommand(['--if-present']));
  }
  if (hasPackage && /\btsc\b|类型检查|typecheck/i.test(pkg.goal)) {
    commands.push(buildNpxTscCommand());
  }

  for (const cmd of commands) {
    const name = cmd.join('_').replace(/[^\w.-]+/g, '_');
    const t0 = Date.now();
    const r = runCommandShellFalse({
      command: cmd,
      cwd: pkg.workingDirectory,
      timeoutMs: 180_000,
      env: { ...process.env, npm_config_yes: 'true' },
    });
    const logRel = `test-logs/${name}.log`;
    await fs.writeFile(
      path.join(jobEvidenceDir, logRel),
      [
        `$ ${r.commandLine}`,
        `exit=${r.status}`,
        `ms=${Date.now() - t0}`,
        r.error ? `spawn_error=${r.error}` : '',
        r.stdout,
        r.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
      'utf8',
    );
    results.push({
      command: r.commandLine,
      exitCode: r.status,
      logRef: logRel,
      passed: r.status === 0,
    });
  }

  // 合并执行器自报（标记为 agent 侧，仍保留）
  for (const t of agent.testResults || []) {
    if (!results.some((x) => x.command === t.command)) results.push(t);
  }
  return results;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
