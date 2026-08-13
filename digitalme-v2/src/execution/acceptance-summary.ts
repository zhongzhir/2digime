/**
 * 面向 Owner 的 Digital Me 验收摘要（CTO 判断为主；verifier 证据为辅）。
 * 默认层自然语言报告；技术细节折叠。
 */
import type { ExecutionVerificationReport, VerificationVerdict } from './external-executor-contract';
import {
  buildDigitalMeCtoReview,
  ctoActionToRecommendation,
  ctoVerdictLabel,
  type CtoPrimaryAction,
  type DigitalMeCtoReview,
} from './cto-review';
import {
  buildAiDigitalMeCtoReview,
  type CtoReviewChat,
} from './ai-cto-review';

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
  /** Digital Me CTO 自然语言主报告 */
  ctoReport?: string;
  primaryAction?: CtoPrimaryAction;
  userFacingNextStep?: string;
  /** 内部修正指令（发给 Coding Agent；默认不要求用户阅读） */
  revisionDirective?: string;
  ctoReview?: DigitalMeCtoReview;
};

export type AcceptanceEvidenceInput = {
  changedFiles?: string[];
  changes?: Array<{ path: string; status?: string }>;
  unifiedDiff?: string;
  outOfScopeChanges?: string[];
};

export type OwnerAcceptanceSummaryInput = {
  verification: Pick<
    ExecutionVerificationReport,
    'overall' | 'checks' | 'digitalMeVerified' | 'agentClaimedSuccess'
  >;
  changedFileCount: number;
  directoryChangedSinceResult?: boolean;
  unresolvedItems?: string[];
  summaryExcerpt?: string;
  evidence?: AcceptanceEvidenceInput;
  /** 用户确认过的目标与理解（CTO 判断输入） */
  userGoal?: string;
  originalTaskGoal?: string;
  revisionRequest?: string;
  currentRoundAuthority?: 'initial_task' | 'owner_revision';
  understandingBrief?: string;
  understandingKeyFiles?: string[];
  planSteps?: string[];
  /**
   * 已由 AI 或调用方形成的验收结论。同步接口保留此注入点以兼容测试；
   * 未传时仍使用既有确定性判断。
   */
  ctoReview?: DigitalMeCtoReview;
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

export function buildOwnerAcceptanceSummary(input: OwnerAcceptanceSummaryInput): OwnerAcceptanceSummary {
  const { verification } = input;
  const checks = verification.checks || [];
  const byId = (id: string) => checks.find((c) => c.id === id);

  const fileCheck = byId('file_changes');
  const testPass = byId('tests_passed');
  const testConfigured = byId('tests_configured');
  const scope = byId('scope_boundary');
  const goal = byId('goal_alignment');
  const gitIntegrity = byId('git_integrity');

  const technicalBullets: string[] = [];

  const ctoReview = input.ctoReview || buildDigitalMeCtoReview({
    userGoal: input.userGoal || '',
    ...(input.originalTaskGoal ? { originalTaskGoal: input.originalTaskGoal } : {}),
    ...(input.revisionRequest ? { revisionRequest: input.revisionRequest } : {}),
    ...(input.currentRoundAuthority ? { currentRoundAuthority: input.currentRoundAuthority } : {}),
    ...(input.understandingBrief ? { understandingBrief: input.understandingBrief } : {}),
    ...(input.understandingKeyFiles ? { understandingKeyFiles: input.understandingKeyFiles } : {}),
    ...(input.planSteps ? { planSteps: input.planSteps } : {}),
    verification,
    changedFileCount: input.changedFileCount,
    ...(input.evidence?.changedFiles ? { changedFiles: input.evidence.changedFiles } : {}),
    ...(input.directoryChangedSinceResult != null
      ? { directoryChangedSinceResult: input.directoryChangedSinceResult }
      : {}),
    ...(input.unresolvedItems ? { unresolvedItems: input.unresolvedItems } : {}),
    ...(input.summaryExcerpt ? { agentSummaryExcerpt: input.summaryExcerpt } : {}),
  });

  const userBullets: string[] = [];
  for (const f of ctoReview.findings) {
    if (!looksLikeMachineMetric(f)) userBullets.push(f.slice(0, 160));
  }
  for (const r of ctoReview.nonBlockingRisks) {
    userBullets.push(`非阻断风险：${r.slice(0, 140)}`);
  }
  if (userBullets.length === 0 && input.changedFileCount > 0) {
    userBullets.push(`${input.changedFileCount} 个文件发生了变化`);
  }
  if (fileCheck?.verdict === 'unsatisfied' && input.changedFileCount <= 0) {
    userBullets.push('没有检测到实质文件变化');
  }
  userBullets.push('未执行提交、推送或部署');

  const startup = byId('run_startup_check');
  const build = byId('build_check');

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

  if (input.summaryExcerpt) {
    technicalBullets.push(
      `Coding Agent 摘要摘录：${String(input.summaryExcerpt).replace(/\s+/g, ' ').slice(0, 200)}`,
    );
  }

  const recommendation = ctoActionToRecommendation(ctoReview.primaryAction);
  const canAdoptSuggested = ctoReview.primaryAction === 'confirm_adopt';

  const adoptWarnings: string[] = [];
  if (!canAdoptSuggested) {
    for (const f of ctoReview.findings.slice(0, 5)) {
      adoptWarnings.push(f.replace(/^问题：|^待确认：/, '').slice(0, 120));
    }
    if (scope && scope.verdict !== 'satisfied') adoptWarnings.push('存在范围外修改');
    if (input.directoryChangedSinceResult) adoptWarnings.push('项目目录已变化，建议重新核对');
    if (adoptWarnings.length === 0) adoptWarnings.push('Digital Me 认为尚不宜直接采用');
  } else {
    for (const r of ctoReview.nonBlockingRisks.slice(0, 3)) {
      adoptWarnings.push(r);
    }
  }

  let headline: string;
  let executionStatusLabel: string;
  if (canAdoptSuggested || ctoReview.decision === 'meets_plan') {
    headline = '工程已达到规划，可以试用';
    executionStatusLabel = '本次处理已结束，工程达到规划';
  } else if (ctoReview.decision === 'insufficient_evidence') {
    headline = '证据不足，暂不能确认达标';
    executionStatusLabel = '本次处理已结束，尚不能独立确认达标';
  } else if (ctoReview.decision === 'blocked') {
    headline = '当前受阻，需要先处理环境或权限问题';
    executionStatusLabel = '本次处理已结束，环境或权限问题待处理';
  } else if (ctoReview.primaryAction === 'need_decision') {
    headline = '还有问题需要你决定';
    executionStatusLabel = '本次处理已结束，等待你的决定';
  } else if (recommendation === '请重新验证') {
    headline = '请重新核对后再决定';
    executionStatusLabel = '本次处理已结束，但需要重新验证';
  } else {
    headline = 'Digital Me 已形成修订建议';
    executionStatusLabel = '本次处理已结束，建议按修订方案继续';
  }

  return {
    title: 'Digital Me 验收结论',
    headline,
    executionStatusLabel,
    goalLabel: goalLabel(ctoVerdictLabel(ctoReview)),
    goalVerdict: ctoVerdictLabel(ctoReview),
    recommendation,
    bullets: userBullets.slice(0, 10),
    technicalBullets: technicalBullets.slice(0, 48),
    adoptWarnings,
    digitalMeVerified: verification.digitalMeVerified,
    agentClaimedSuccess: verification.agentClaimedSuccess,
    canAdoptSuggested,
    ctoReport: ctoReview.report,
    primaryAction: ctoReview.primaryAction,
    userFacingNextStep: ctoReview.userFacingNextStep,
    ...(ctoReview.revisionDirective
      ? { revisionDirective: ctoReview.revisionDirective }
      : {}),
    ctoReview,
  };
}

/**
 * 生产路径的异步 AI 验收。模型不可用或输出不合格时返回明确的不可独立验收结论，
 * 绝不回退为模板化 CTO 结论。
 */
export async function buildOwnerAcceptanceSummaryAsync(
  input: OwnerAcceptanceSummaryInput,
  chat: CtoReviewChat | null | undefined,
): Promise<OwnerAcceptanceSummary> {
  const ctoReview = await buildAiDigitalMeCtoReview(
    {
      userGoal: input.userGoal || '',
      ...(input.originalTaskGoal ? { originalTaskGoal: input.originalTaskGoal } : {}),
      ...(input.revisionRequest ? { revisionRequest: input.revisionRequest } : {}),
      ...(input.currentRoundAuthority ? { currentRoundAuthority: input.currentRoundAuthority } : {}),
      ...(input.understandingBrief ? { understandingBrief: input.understandingBrief } : {}),
      ...(input.understandingKeyFiles ? { understandingKeyFiles: input.understandingKeyFiles } : {}),
      ...(input.planSteps ? { planSteps: input.planSteps } : {}),
      verification: input.verification,
      changedFileCount: input.changedFileCount,
      ...(input.evidence?.changedFiles ? { changedFiles: input.evidence.changedFiles } : {}),
      ...(input.directoryChangedSinceResult != null
        ? { directoryChangedSinceResult: input.directoryChangedSinceResult }
        : {}),
      ...(input.unresolvedItems ? { unresolvedItems: input.unresolvedItems } : {}),
      ...(input.summaryExcerpt ? { agentSummaryExcerpt: input.summaryExcerpt } : {}),
    },
    chat,
  );
  return buildOwnerAcceptanceSummary({ ...input, ctoReview });
}

