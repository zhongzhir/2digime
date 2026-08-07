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

export function buildOwnerAcceptanceSummary(input: {
  verification: Pick<
    ExecutionVerificationReport,
    'overall' | 'checks' | 'digitalMeVerified' | 'agentClaimedSuccess'
  >;
  changedFileCount: number;
  directoryChangedSinceResult?: boolean;
  unresolvedItems?: string[];
  summaryExcerpt?: string;
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
      userBullets.push(`启动检查失败${startup.detail ? `：${String(startup.detail).slice(0, 120)}` : ''}`);
      userBullets.push('尚不能确认可以正常使用');
    } else {
      userBullets.push('尚未验证实际运行');
    }
  }

  const build = byId('build_check');
  if (build?.verdict === 'unsatisfied') {
    userBullets.push('构建失败');
  }

  if (scope) {
    userBullets.push(
      scope.verdict === 'satisfied'
        ? '没有发现项目范围之外的修改'
        : '发现了项目范围之外的修改',
    );
  }

  if (goal?.detail) {
    technicalBullets.push(`目标核对：${String(goal.detail).slice(0, 160)}`);
  }
  for (const c of checks) {
    if (c.id === 'goal_alignment') continue;
    const line = `${c.title}：${c.verdict}${c.detail ? ` — ${String(c.detail).slice(0, 80)}` : ''}`;
    technicalBullets.push(line.slice(0, 200));
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
  const startupOk = !startupCheck || startupCheck.verdict === 'satisfied';
  const buildCheck = byId('build_check');
  const buildOk = !buildCheck || buildCheck.verdict === 'satisfied';
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
    !startupOk
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
    technicalBullets: technicalBullets.slice(0, 12),
    adoptWarnings,
    digitalMeVerified: verification.digitalMeVerified,
    agentClaimedSuccess: verification.agentClaimedSuccess,
    canAdoptSuggested,
  };
}
