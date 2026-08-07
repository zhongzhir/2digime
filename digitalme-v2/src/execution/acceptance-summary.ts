/**
 * 面向 Owner 的 Digital Me 验收摘要（来自 verifier，非 agent 自述）。
 */
import type { ExecutionVerificationReport, VerificationVerdict } from './external-executor-contract';

export type OwnerAcceptanceRecommendation =
  | '可以采用'
  | '建议继续修改'
  | '暂不建议采用'
  | '请重新验证';

export type OwnerAcceptanceSummary = {
  title: string;
  goalLabel: string;
  goalVerdict: VerificationVerdict;
  recommendation: OwnerAcceptanceRecommendation;
  bullets: string[];
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
  const scope = byId('scope_boundary');
  const goal = byId('goal_alignment');

  const bullets: string[] = [];

  if (input.summaryExcerpt) {
    const first = input.summaryExcerpt
      .split(/\n/)
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('**') && l.length > 4);
    if (first) bullets.push(first.slice(0, 160));
  }

  if (input.changedFileCount > 0) {
    bullets.push(`文件变化：修改 ${input.changedFileCount} 个文件`);
  } else if (fileCheck?.verdict === 'unsatisfied') {
    bullets.push('文件变化：未检测到实质修改');
  }

  if (testPass) {
    bullets.push(
      testPass.verdict === 'satisfied'
        ? '测试：通过'
        : testPass.verdict === 'unsatisfied'
          ? '测试：失败'
          : '测试：无法确认',
    );
  } else if (testRun?.verdict === 'unsatisfied') {
    bullets.push('测试：未运行');
  } else if (!testRun && !testPass) {
    bullets.push('测试：本次未记录测试结果');
  }

  if (scope) {
    bullets.push(
      scope.verdict === 'satisfied'
        ? '范围：未发现越权修改'
        : '范围：发现范围外变化',
    );
  }

  if (goal?.detail) {
    bullets.push(`目标核对：${String(goal.detail).slice(0, 120)}`);
  }

  for (const item of (input.unresolvedItems || []).slice(0, 3)) {
    bullets.push(`未完成：${item.slice(0, 120)}`);
  }

  bullets.push('未执行 commit、push 或部署');

  if (input.directoryChangedSinceResult) {
    bullets.push('当前项目目录已与成果生成时不同，请重新核对后再决定');
  }

  const testsOk =
    !testPass ||
    testPass.verdict === 'satisfied' ||
    (testPass.verdict === 'unverifiable' && !testRun);
  const scopeOk = !scope || scope.verdict === 'satisfied';
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
    verification.digitalMeVerified
  ) {
    recommendation = '可以采用';
    canAdoptSuggested = true;
  } else if (
    verification.overall === 'partially_satisfied' ||
    (hasChanges && !overallOk)
  ) {
    recommendation = '建议继续修改';
  } else {
    recommendation = '暂不建议采用';
  }

  // 禁止仅凭 agent 自述采用
  if (!verification.digitalMeVerified) {
    canAdoptSuggested = false;
    if (recommendation === '可以采用') recommendation = '建议继续修改';
  }

  return {
    title: 'Digital Me 检查结果',
    goalLabel: goalLabel(verification.overall),
    goalVerdict: verification.overall,
    recommendation,
    bullets: bullets.slice(0, 10),
    digitalMeVerified: verification.digitalMeVerified,
    agentClaimedSuccess: verification.agentClaimedSuccess,
    canAdoptSuggested,
  };
}
