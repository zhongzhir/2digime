/**
 * 面向 Owner 的 Digital Me 验收摘要（来自 verifier，非 agent 自述）。
 * 默认层白话；技术细节折叠。
 */
import type { ExecutionVerificationReport, VerificationVerdict } from './external-executor-contract';

export type OwnerAcceptanceRecommendation =
  | '可以采用'
  | '建议继续修改'
  | '暂不建议采用'
  | '请重新验证';

export type OwnerAcceptanceSummary = {
  title: string;
  /** 默认层结论标题（普通用户） */
  headline: string;
  /** 执行已结束说明（与验收通过分离） */
  executionStatusLabel: string;
  goalLabel: string;
  goalVerdict: VerificationVerdict;
  recommendation: OwnerAcceptanceRecommendation;
  /** 默认层要点（禁止关键词命中等机器指标） */
  bullets: string[];
  /** 技术证据（折叠后展示） */
  technicalBullets: string[];
  /** 强制采用前的明确风险提示 */
  adoptWarnings: string[];
  digitalMeVerified: boolean;
  agentClaimedSuccess: boolean;
  /** 不得仅因 agentClaimedSuccess 显示可采用 */
  canAdoptSuggested: boolean;
};

export type AcceptanceEvidenceInput = {
  changedFiles?: string[];
  changes?: Array<{ path: string; status?: string }>;
  unifiedDiff?: string;
  outOfScopeChanges?: string[];
};

function goalLabel(v: VerificationVerdict): string {
  switch (v) {
    case 'satisfied':
      return '已满足';
    case 'partially_satisfied':
      return '部分满足';
    case 'unsatisfied':
      return '未满足';
    case 'unverifiable':
      return '无法验证';
    default:
      return '无法验证';
  }
}

function looksLikeMachineMetric(text: string): boolean {
  return /命中关键词|keyword|goal_alignment|verdict|verification command|overall=/i.test(
    text,
  );
}

/** 从 unified diff 汇总每个文件的 +/- 行数。 */
export function summarizeDiffStats(
  unifiedDiff: string | undefined,
  changedFiles: string[],
): Array<{ path: string; added: number; deleted: number }> {
  const files = changedFiles.map((p) => p.replace(/\\/g, '/'));
  const byPath = new Map<string, { path: string; added: number; deleted: number }>();
  for (const p of files) {
    byPath.set(p, { path: p, added: 0, deleted: 0 });
  }
  const diff = String(unifiedDiff || '');
  if (!diff.trim()) {
    return files.map((p) => byPath.get(p)!);
  }
  let current: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const header = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (header) {
      const raw = header[1]!.trim();
      if (raw === '/dev/null') {
        current = null;
        continue;
      }
      current = raw.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!byPath.has(current)) {
        byPath.set(current, { path: current, added: 0, deleted: 0 });
      }
      continue;
    }
    const gitA = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitA) {
      current = gitA[2]!.replace(/\\/g, '/');
      if (!byPath.has(current)) {
        byPath.set(current, { path: current, added: 0, deleted: 0 });
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      byPath.get(current)!.added += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      byPath.get(current)!.deleted += 1;
    }
  }
  const ordered = files.length
    ? files.map((p) => byPath.get(p)!).filter(Boolean)
    : [...byPath.values()];
  return ordered;
}

function checkLooksNotConfigured(detail: string | undefined): boolean {
  return /not_configured|未配置|无 build 脚本|无脚本|没有配置自动测试/i.test(
    String(detail || ''),
  );
}

export function buildOwnerAcceptanceSummary(input: {
  verification: Pick<
    ExecutionVerificationReport,
    'overall' | 'checks' | 'digitalMeVerified' | 'agentClaimedSuccess'
  >;
  changedFileCount: number;
  directoryChangedSinceResult?: boolean;
  unresolvedItems?: string[];
  summaryExcerpt?: string;
  evidence?: AcceptanceEvidenceInput;
}): OwnerAcceptanceSummary {
  const { verification } = input;
  const checks = verification.checks || [];
  const byId = (id: string) => checks.find((c) => c.id === id);

  const fileCheck = byId('file_changes');
  const testPass = byId('tests_passed');
  const testRun = byId('tests_executed');
  const testConfigured = byId('tests_configured');
  const testExecuted = byId('tests_executed');
  const scope = byId('scope_boundary');
  const goal = byId('goal_alignment');
  const gitIntegrity = byId('git_integrity');
  const testCfgSatisfied = testConfigured?.verdict === 'satisfied';

  const userBullets: string[] = [];
  const technicalBullets: string[] = [];

  if (input.summaryExcerpt) {
    const first = input.summaryExcerpt
      .split(/\n/)
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('**') && l.length > 4);
    if (first && !looksLikeMachineMetric(first)) {
      userBullets.push(first.slice(0, 160));
    }
  }

  if (input.changedFileCount > 0) {
    userBullets.push(`${input.changedFileCount} 个文件发生了变化`);
  } else if (fileCheck?.verdict === 'unsatisfied') {
    userBullets.push('没有检测到实质文件变化');
  }

  if (testPass) {
    if (!testCfgSatisfied && testConfigured?.verdict === 'unsatisfied') {
      userBullets.push('这个项目没有配置自动测试');
    } else if (testPass.verdict === 'satisfied') {
      userBullets.push('自动测试已经通过');
    } else if (testPass.verdict === 'unsatisfied') {
      userBullets.push('自动测试失败');
    } else if (testExecuted?.verdict === 'unsatisfied') {
      userBullets.push('测试命令无法启动');
    } else {
      userBullets.push('还不能确认自动测试结果');
    }
  } else if (testConfigured?.verdict === 'unsatisfied') {
    userBullets.push('这个项目没有配置自动测试');
  } else if (testRun?.verdict === 'unsatisfied') {
    userBullets.push('本次没有运行测试');
  } else if (!testRun && !testPass) {
    userBullets.push('还不能确认程序是否已经可以正常运行');
  }

  const startup = byId('run_startup_check');
  if (startup) {
    if (startup.verdict === 'satisfied') {
      userBullets.push('已通过启动检查');
    } else if (startup.verdict === 'unsatisfied') {
      userBullets.push(
        `启动检查失败${startup.detail ? `：${String(startup.detail).slice(0, 120)}` : ''}`,
      );
      userBullets.push('尚不能确认可以正常使用');
    } else if (checkLooksNotConfigured(startup.detail)) {
      userBullets.push('未配置可用启动方式');
    } else {
      userBullets.push('尚未验证实际运行');
    }
  }

  const build = byId('build_check');
  if (build?.verdict === 'unsatisfied') {
    userBullets.push('构建失败');
  } else if (build?.verdict === 'satisfied') {
    userBullets.push('构建已通过');
  }

  if (scope) {
    userBullets.push(
      scope.verdict === 'satisfied'
        ? '没有发现项目范围之外的修改'
        : '发现了项目范围之外的修改',
    );
  }

  // —— 技术证据：完整文件列表、diff 摘要、命令与结果、越界/提交 ——
  const changedFiles =
    input.evidence?.changedFiles?.length
      ? input.evidence.changedFiles
      : (input.evidence?.changes || []).map((c) => c.path).filter(Boolean);
  const fileList =
    changedFiles.length > 0
      ? changedFiles
      : input.changedFileCount > 0
        ? []
        : [];

  technicalBullets.push(
    fileList.length
      ? `修改文件（${fileList.length}）：${fileList.join('；')}`
      : input.changedFileCount > 0
        ? `修改文件数：${input.changedFileCount}（清单未随摘要传入）`
        : '修改文件：无',
  );

  const stats = summarizeDiffStats(input.evidence?.unifiedDiff, fileList);
  if (stats.length) {
    for (const s of stats) {
      technicalBullets.push(
        `变更摘要 ${s.path}：+${s.added} / -${s.deleted}`,
      );
    }
  } else if (input.evidence?.unifiedDiff && input.evidence.unifiedDiff.length > 20) {
    technicalBullets.push(
      `diff 长度：${input.evidence.unifiedDiff.length} 字符（未能按文件拆分统计）`,
    );
  }

  if (goal?.detail) {
    technicalBullets.push(`目标核对：${String(goal.detail).slice(0, 320)}`);
  }

  const commandish = ['tests_executed', 'tests_passed', 'build_check', 'run_startup_check'];
  for (const id of commandish) {
    const c = byId(id);
    if (!c) continue;
    const notCfg = checkLooksNotConfigured(c.detail);
    const resultLabel =
      c.verdict === 'satisfied'
        ? '通过'
        : notCfg || c.verdict === 'unverifiable'
          ? '未配置（not_configured）'
          : c.verdict === 'unsatisfied'
            ? '失败（execution_failed）'
            : String(c.verdict);
    technicalBullets.push(
      `${c.title}：${resultLabel}${c.detail ? ` — ${String(c.detail).slice(0, 220)}` : ''}`,
    );
  }

  if (testConfigured) {
    technicalBullets.push(
      `测试配置：${
        testConfigured.verdict === 'satisfied'
          ? '已配置'
          : '未配置（not_configured）'
      }${testConfigured.detail ? ` — ${String(testConfigured.detail).slice(0, 120)}` : ''}`,
    );
  }

  technicalBullets.push(
    `构建：${
      !build
        ? '未执行'
        : build.verdict === 'satisfied'
          ? '通过'
          : checkLooksNotConfigured(build.detail) || build.verdict === 'unverifiable'
            ? '未配置（not_configured）'
            : '未通过'
    }`,
  );
  technicalBullets.push(
    `启动：${
      !startup
        ? '未执行'
        : startup.verdict === 'satisfied'
          ? '通过'
          : checkLooksNotConfigured(startup.detail) || startup.verdict === 'unverifiable'
            ? '未配置或未验证（not_configured）'
            : '未通过'
    }`,
  );

  const outOfScope =
    input.evidence?.outOfScopeChanges ||
    (scope?.verdict !== 'satisfied' && scope?.detail
      ? [String(scope.detail)]
      : []);
  technicalBullets.push(
    outOfScope.length
      ? `越界修改：有 — ${outOfScope.slice(0, 12).join('；')}`
      : '越界修改：无',
  );

  if (gitIntegrity) {
    technicalBullets.push(
      `自动 commit / HEAD：${
        gitIntegrity.verdict === 'satisfied' ? '未移动' : `异常 — ${String(gitIntegrity.detail || '').slice(0, 160)}`
      }`,
    );
  } else {
    technicalBullets.push('自动 commit / HEAD：本摘要未含 git_integrity 检查项');
  }

  for (const c of checks) {
    if (
      c.id === 'goal_alignment' ||
      commandish.includes(c.id) ||
      c.id === 'tests_configured' ||
      c.id === 'git_integrity'
    ) {
      continue;
    }
    const line = `${c.title}：${c.verdict}${c.detail ? ` — ${String(c.detail).slice(0, 120)}` : ''}`;
    technicalBullets.push(line.slice(0, 240));
  }

  for (const item of (input.unresolvedItems || []).slice(0, 3)) {
    if (!looksLikeMachineMetric(item)) {
      userBullets.push(`未完成：${item.slice(0, 120)}`);
    }
  }

  userBullets.push('未执行提交、推送或部署');

  if (input.directoryChangedSinceResult) {
    userBullets.push('当前项目目录已与成果生成时不同，请重新核对后再决定');
  }

  const testsOk =
    testConfigured?.verdict === 'unsatisfied' ||
    !testPass ||
    testPass.verdict === 'satisfied' ||
    (testPass.verdict === 'unverifiable' && (!testRun || testRun.verdict !== 'unsatisfied'));
  const scopeOk = !scope || scope.verdict === 'satisfied';
  const startupCheck = byId('run_startup_check');
  const startupOk =
    !startupCheck ||
    startupCheck.verdict === 'satisfied' ||
    startupCheck.verdict === 'unverifiable';
  const buildCheck = byId('build_check');
  const buildOk =
    !buildCheck ||
    buildCheck.verdict === 'satisfied' ||
    buildCheck.verdict === 'unverifiable';
  const hasChanges = input.changedFileCount > 0;
  const overallOk = verification.overall === 'satisfied';

  let recommendation: OwnerAcceptanceRecommendation = '暂不建议采用';
  let canAdoptSuggested = false;

  if (input.directoryChangedSinceResult) {
    recommendation = '请重新验证';
  } else if (
    overallOk &&
    hasChanges &&
    scopeOk &&
    testsOk &&
    startupOk &&
    buildOk &&
    verification.digitalMeVerified
  ) {
    recommendation = '可以采用';
    canAdoptSuggested = true;
  } else if (
    verification.overall === 'partially_satisfied' ||
    (hasChanges && !overallOk) ||
    (startupCheck && startupCheck.verdict === 'unsatisfied')
  ) {
    recommendation = '建议继续修改';
  } else {
    recommendation = '暂不建议采用';
  }

  if (!verification.digitalMeVerified) {
    canAdoptSuggested = false;
    if (recommendation === '可以采用') recommendation = '建议继续修改';
  }

  const adoptWarnings: string[] = [];
  if (!canAdoptSuggested) {
    if (testConfigured?.verdict === 'unsatisfied') {
      /* 无自动测试不是“测试未通过” */
    } else if (testPass?.verdict === 'unsatisfied') {
      adoptWarnings.push('自动测试未通过');
    }
    if (byId('run_startup_check')?.verdict === 'unsatisfied') {
      adoptWarnings.push('启动检查未通过');
    }
    if (byId('build_check')?.verdict === 'unsatisfied') {
      adoptWarnings.push('构建未通过');
    }
    if (
      verification.overall === 'partially_satisfied' ||
      verification.overall === 'unsatisfied'
    ) {
      adoptWarnings.push('部分要求尚未确认');
    }
    if (verification.overall === 'unverifiable') adoptWarnings.push('无法完整验证');
    if (scope && scope.verdict !== 'satisfied') adoptWarnings.push('存在范围外修改');
    if (input.directoryChangedSinceResult) adoptWarnings.push('项目目录已变化，建议重新核对');
    if (adoptWarnings.length === 0) adoptWarnings.push('Digital Me 检查发现还有问题');
  }

  let headline: string;
  let executionStatusLabel: string;
  if (canAdoptSuggested) {
    headline = 'Digital Me 已检查，可以采用';
    executionStatusLabel = '本次处理已结束，验收通过';
  } else if (recommendation === '请重新验证') {
    headline = '请重新核对后再决定';
    executionStatusLabel = '本次处理已结束，但需要重新验证';
  } else {
    headline = '还有问题需要处理';
    executionStatusLabel = '本次处理已结束，但还有问题需要处理';
  }

  return {
    title: 'Digital Me 检查结果',
    headline,
    executionStatusLabel,
    goalLabel: goalLabel(verification.overall),
    goalVerdict: verification.overall,
    recommendation,
    bullets: userBullets.slice(0, 10),
    technicalBullets: technicalBullets.slice(0, 48),
    adoptWarnings,
    digitalMeVerified: verification.digitalMeVerified,
    agentClaimedSuccess: verification.agentClaimedSuccess,
    canAdoptSuggested,
  };
}
