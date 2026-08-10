/**
 * Digital Me 作为 AI CTO 的独立验收判断。
 * 以用户确认的目标、委派边界、执行证据与仓库复核为依据；
 * 不把关键词命中或 Coding Agent 自述当作完成度主判定。
 * 不扩展为自研 Coding Agent。
 */
import type {
  ExecutionVerificationReport,
  VerificationCheckResult,
  VerificationVerdict,
} from './external-executor-contract';

export type CtoPrimaryAction =
  | 'confirm_continue'
  | 'confirm_adopt'
  | 'need_decision'
  | 'pause';

export type DigitalMeCtoReview = {
  schemaVersion: 'digitalme-cto-review/1';
  /** 默认成果面自然语言报告（主文案） */
  report: string;
  /** 用户可读发现要点 */
  findings: string[];
  /** 非阻断风险 */
  nonBlockingRisks: string[];
  primaryAction: CtoPrimaryAction;
  /** 面向用户的下一步说明 */
  userFacingNextStep: string;
  /**
   * 发给 Coding Agent 的专业修正指令（内部；用户无需理解技术细节）。
   * 仅在 confirm_continue 时必填。
   */
  revisionDirective?: string;
  goalAttained: boolean;
  confidence: 'high' | 'medium' | 'low';
  requiresUserDecision: boolean;
  decisionPrompt?: string;
};

export type CtoReviewInput = {
  userGoal: string;
  /** 确认前理解 / 方案摘要 */
  understandingBrief?: string;
  understandingKeyFiles?: string[];
  planSteps?: string[];
  verification: Pick<
    ExecutionVerificationReport,
    'overall' | 'checks' | 'digitalMeVerified' | 'agentClaimedSuccess'
  >;
  changedFileCount: number;
  changedFiles?: string[];
  directoryChangedSinceResult?: boolean;
  unresolvedItems?: string[];
  agentSummaryExcerpt?: string;
};

function byId(
  checks: VerificationCheckResult[],
  id: string,
): VerificationCheckResult | undefined {
  return checks.find((c) => c.id === id);
}

function isHardRuntimeBoundary(check: VerificationCheckResult | undefined): boolean {
  if (!check) return false;
  return check.verdict === 'unsatisfied';
}

function isExecutionFailure(check: VerificationCheckResult | undefined): boolean {
  if (!check || check.verdict !== 'unsatisfied') return false;
  const d = String(check.detail || '');
  if (/not_configured|未配置/i.test(d)) return false;
  return true;
}

function describeIssue(check: VerificationCheckResult): string {
  const title = check.title || check.id;
  const detail = String(check.detail || '').trim();
  if (!detail) return title;
  // 去掉面向用户时过长的命令行噪声，保留结论语义
  const short = detail
    .replace(/命令：[^；;]+[；;]?/g, '')
    .replace(/退出码：[^；;]+[；;]?/g, '')
    .trim();
  return short ? `${title}：${short.slice(0, 120)}` : title;
}

/**
 * 基于证据形成 CTO 判断（确定性边界 + 语义合成；无任务类型关键词规则表）。
 */
export function buildDigitalMeCtoReview(input: CtoReviewInput): DigitalMeCtoReview {
  const checks = input.verification.checks || [];
  const scope = byId(checks, 'scope_boundary');
  const git = byId(checks, 'git_integrity');
  const files = byId(checks, 'file_changes');
  const build = byId(checks, 'build_check');
  const startup = byId(checks, 'run_startup_check');
  const testsPassed = byId(checks, 'tests_passed');
  const testsConfigured = byId(checks, 'tests_configured');
  const exitCode = byId(checks, 'exit_code');
  const concurrent = byId(checks, 'concurrent_edit');
  const adoptConsistency = byId(checks, 'adopt_consistency');

  const blockingIssues: string[] = [];
  const softIssues: string[] = [];
  const nonBlockingRisks: string[] = [];

  if (input.directoryChangedSinceResult) {
    blockingIssues.push('项目目录已与本轮成果生成时不同，需要重新核对后再决定');
  }
  if (isHardRuntimeBoundary(scope)) {
    blockingIssues.push('存在授权范围外的修改');
  }
  if (isHardRuntimeBoundary(git)) {
    blockingIssues.push('检测到未授权的提交或版本头移动');
  }
  if (isHardRuntimeBoundary(concurrent)) {
    blockingIssues.push('执行期间可能发生了并发修改');
  }
  if (files?.verdict === 'unsatisfied' || input.changedFileCount <= 0) {
    blockingIssues.push('没有检测到可核对的实质文件变化');
  }
  if (isExecutionFailure(build)) {
    blockingIssues.push('构建失败');
  }
  if (isExecutionFailure(startup)) {
    blockingIssues.push('启动检查失败，尚不能确认可正常使用');
  }
  if (isExecutionFailure(testsPassed)) {
    const testMissing =
      testsConfigured?.verdict === 'unsatisfied' ||
      /not_configured|未配置|skipped|没有配置/i.test(String(testsPassed.detail || ''));
    if (!testMissing) {
      blockingIssues.push('自动测试失败');
    }
  }
  if (exitCode?.verdict === 'unsatisfied') {
    softIssues.push('外部执行器未以成功状态退出');
  }
  if (adoptConsistency?.verdict === 'unsatisfied') {
    blockingIssues.push('当前工作目录与待验收成果不一致');
  }

  for (const item of input.unresolvedItems || []) {
    const t = String(item || '').trim();
    if (t) softIssues.push(`仍有未完成项：${t.slice(0, 100)}`);
  }

  // 有变更且构建/启动通过时，将部分满足视为软问题或风险，而非直接交付
  if (
    input.verification.overall === 'partially_satisfied' &&
    blockingIssues.length === 0 &&
    input.changedFileCount > 0
  ) {
    softIssues.push('部分目标仍需对照确认');
  }
  if (
    input.verification.overall === 'unverifiable' &&
    blockingIssues.length === 0
  ) {
    softIssues.push('现有证据不足以可靠判定目标已完全达成');
  }

  // 非阻断：无测试配置、agent 自述与采集不一致等
  if (testsConfigured?.verdict === 'unsatisfied') {
    nonBlockingRisks.push('这个项目没有配置自动测试，后续回归需人工或另行验证');
  }
  if (
    input.verification.agentClaimedSuccess &&
    input.verification.overall === 'unsatisfied'
  ) {
    nonBlockingRisks.push('执行器自称成功，但 Digital Me 独立检查未认可');
  }

  const goal = String(input.userGoal || '').trim() || '用户目标';
  const keyFiles = (input.understandingKeyFiles || []).slice(0, 6);
  const planHint = (input.planSteps || []).slice(0, 4).join('；');

  let primaryAction: CtoPrimaryAction;
  let goalAttained = false;
  let confidence: DigitalMeCtoReview['confidence'] = 'medium';
  let requiresUserDecision = false;
  let decisionPrompt: string | undefined;
  let revisionDirective: string | undefined;
  let report: string;
  let userFacingNextStep: string;

  if (blockingIssues.length > 0) {
    if (
      input.directoryChangedSinceResult ||
      (scope && scope.verdict === 'unsatisfied') ||
      (git && git.verdict === 'unsatisfied')
    ) {
      primaryAction = 'need_decision';
      requiresUserDecision = true;
      confidence = 'low';
      decisionPrompt =
        '存在越权、目录变化或禁止操作迹象。请选择：确认继续修正、补充约束，或暂停后人工处理。';
      report = [
        '本轮尚未达到目标。',
        `我发现：${blockingIssues.slice(0, 4).join('；')}。`,
        '这些属于必须先处理的问题，不能直接建议采用。',
      ].join('');
      userFacingNextStep = '请确认是否继续修正，或补充你的约束后再继续。';
      revisionDirective = [
        '【Digital Me 修正指令】',
        `用户目标：${goal}`,
        `必须先解决：${blockingIssues.join('；')}`,
        keyFiles.length ? `优先对照既有方案涉及文件：${keyFiles.join(', ')}` : '',
        planHint ? `既有方案要点：${planHint}` : '',
        '在授权范围内完成修复；不得 commit/push/部署；完成后给出可核对证据。',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      primaryAction = 'confirm_continue';
      confidence = blockingIssues.some((x) => /构建|测试|启动/.test(x))
        ? 'high'
        : 'medium';
      report = [
        '本轮尚未达到目标。',
        `我发现${blockingIssues.length > 1 ? '以下问题' : ''}：${blockingIssues.slice(0, 4).join('；')}。`,
        softIssues.length
          ? `另外还有：${softIssues.slice(0, 2).join('；')}。`
          : '',
        '建议继续修正。下一轮将要求专业执行者按修正指令处理上述问题，并补充可核对证据。',
      ]
        .filter(Boolean)
        .join('');
      userFacingNextStep = '确认后将按 Digital Me 的修正指令继续同一任务。';
      revisionDirective = [
        '【Digital Me 修正指令】',
        `用户目标：${goal}`,
        `本轮未达标原因：${blockingIssues.concat(softIssues).slice(0, 6).join('；')}`,
        keyFiles.length ? `继续围绕：${keyFiles.join(', ')}` : '',
        planHint ? `原方案：${planHint}` : '',
        '请修复上述问题，保证构建/必要检查可通过；不要扩大无关改动；不得 commit/push/部署。',
        '完成后说明改了什么、如何验证。',
      ]
        .filter(Boolean)
        .join('\n');
    }
  } else if (
    input.verification.overall === 'satisfied' &&
    input.changedFileCount > 0 &&
    input.verification.digitalMeVerified &&
    (!scope || scope.verdict === 'satisfied')
  ) {
    primaryAction = 'confirm_adopt';
    goalAttained = true;
    confidence = 'high';
    const riskText =
      nonBlockingRisks.length > 0
        ? `存在${nonBlockingRisks.length === 1 ? '一项' : '若干'}非阻断风险：${nonBlockingRisks.slice(0, 3).join('；')}。`
        : '未发现必须阻断交付的问题。';
    report = [
      '我已检查实现范围、构建与关键验证结果，当前成果达到目标。',
      riskText,
      '建议采用。',
    ].join('');
    userFacingNextStep = '确认采用后，本轮成果将被标记为已采用。';
  } else if (
    input.changedFileCount > 0 &&
    (!scope || scope.verdict === 'satisfied') &&
    softIssues.length > 0 &&
    blockingIssues.length === 0
  ) {
    // 有成果但证据不足以完全认定：请用户做取舍（继续修 vs 接受风险采用）
    primaryAction = 'need_decision';
    requiresUserDecision = true;
    confidence = 'low';
    decisionPrompt =
      '证据尚不能完全证明目标已达成。你可以确认继续修正，补充你的判断，或在了解风险后仍然采用。';
    report = [
      '本轮已有实际改动，但我还不能可靠判定目标已完全达成。',
      softIssues.length ? `主要不确定点：${softIssues.slice(0, 3).join('；')}。` : '',
      nonBlockingRisks.length
        ? `同时注意：${nonBlockingRisks.slice(0, 2).join('；')}。`
        : '',
      '请你决定：继续修正，还是接受当前风险并采用。',
    ]
      .filter(Boolean)
      .join('');
    userFacingNextStep = '请选择继续修正、补充意见，或仍然采用。';
    revisionDirective = [
      '【Digital Me 修正指令】',
      `用户目标：${goal}`,
      `请针对不确定点加强实现与验证：${softIssues.slice(0, 4).join('；')}`,
      keyFiles.length ? `相关路径：${keyFiles.join(', ')}` : '',
      '保持最小必要改动；不得 commit/push/部署。',
    ]
      .filter(Boolean)
      .join('\n');
  } else if (input.changedFileCount > 0 && input.verification.digitalMeVerified) {
    primaryAction = 'confirm_continue';
    confidence = 'medium';
    report =
      '本轮有改动，但对照目标仍不够完整。建议继续修正，由专业执行者按修正指令补齐缺口并补充验证。';
    userFacingNextStep = '确认后将继续同一任务的下一执行轮次。';
    revisionDirective = [
      '【Digital Me 修正指令】',
      `用户目标：${goal}`,
      '请对照目标补齐遗漏，完善验证，避免无关改动。',
      keyFiles.length ? `重点：${keyFiles.join(', ')}` : '',
      '不得 commit/push/部署。',
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    primaryAction = 'need_decision';
    requiresUserDecision = true;
    confidence = 'low';
    decisionPrompt = '当前无法形成可靠验收结论，请补充说明或暂停后处理。';
    report =
      '我还不能可靠判断本轮是否达到目标。请补充你的期望，或暂停任务后另行处理。';
    userFacingNextStep = '请补充意见，或暂停任务。';
  }

  const findings = [
    ...blockingIssues.map((x) => `问题：${x}`),
    ...softIssues.map((x) => `待确认：${x}`),
  ].slice(0, 8);

  return {
    schemaVersion: 'digitalme-cto-review/1',
    report,
    findings,
    nonBlockingRisks: nonBlockingRisks.slice(0, 6),
    primaryAction,
    userFacingNextStep,
    ...(revisionDirective ? { revisionDirective } : {}),
    goalAttained,
    confidence,
    requiresUserDecision,
    ...(decisionPrompt ? { decisionPrompt } : {}),
  };
}

/** 将 CTO 动作映射到既有 recommendation 枚举（不新增任务状态机）。 */
export function ctoActionToRecommendation(
  action: CtoPrimaryAction,
): '可以采用' | '建议继续修改' | '暂不建议采用' | '请重新验证' {
  switch (action) {
    case 'confirm_adopt':
      return '可以采用';
    case 'confirm_continue':
      return '建议继续修改';
    case 'need_decision':
      return '暂不建议采用';
    case 'pause':
      return '请重新验证';
    default:
      return '暂不建议采用';
  }
}

export function ctoVerdictLabel(review: DigitalMeCtoReview): VerificationVerdict {
  if (review.goalAttained) return 'satisfied';
  if (review.primaryAction === 'confirm_continue') return 'partially_satisfied';
  if (review.confidence === 'low') return 'unverifiable';
  return 'unsatisfied';
}
