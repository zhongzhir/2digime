/**
 * D11-C AI CTO 验收：模型只在受限证据包内作出独立判断；
 * 验证器与硬门仍由确定性规则执行，不能被模型结论覆盖。
 * 不保存提示词、模型原文或推理过程。
 */
import type { ChatMessage } from '../infrastructure/model-http';
import type { VerificationCheckResult } from './external-executor-contract';
import type { CtoReviewInput, DigitalMeCtoReview } from './cto-review';
import { formatCtoUserConclusion } from '../work-runtime/work-cto-consult';

export const AI_CTO_DECISIONS = [
  'meets_plan',
  'needs_revision',
  'blocked',
  'insufficient_evidence',
] as const;
export type AiCtoDecision = (typeof AI_CTO_DECISIONS)[number];
export type CtoReviewChat = (input: { messages: ChatMessage[] }) => Promise<{ text: string }>;

export interface AiCtoEvidencePack {
  goal: string;
  understanding?: string;
  planSteps: string[];
  verification: {
    overall: string;
    digitalMeVerified: boolean;
    agentClaimedSuccess: boolean;
    checks: Array<{ ref: string; title: string; verdict: string; detail?: string }>;
  };
  changedFiles: Array<{ ref: string; path: string }>;
  changedFileCount: number;
  directoryChangedSinceResult: boolean;
  unresolvedItems: string[];
  agentSummary?: string;
  evidenceRefs: string[];
}

export interface AiCtoReviewOutput {
  decision: AiCtoDecision;
  /** 面向用户的五项结论；由模型基于证据包生成，硬门只可收紧不可伪造。 */
  canUse: string;
  goalAttained: string;
  needChange: string;
  nextStep: string;
  userSummary: string;
  completed: string[];
  gaps: string[];
  evidenceRefs: string[];
  risks: string[];
  nextAction: string;
  revisionPlan?: string;
}

const SYSTEM_PROMPT = [
  '你是 Digital Me 的独立 AI CTO，审查一项软件成果是否可采用。',
  '只能依据提供的证据包判断；不得假设未提供的测试、文件或结果。',
  '不要输出思考过程、内部协议名、字段名或 Markdown。只输出一个 JSON 对象。',
  'JSON 字段：decision（meets_plan | needs_revision | blocked | insufficient_evidence）、canUse、goalAttained、needChange、risks、nextStep、userSummary、completed、gaps、evidenceRefs、nextAction、revisionPlan（仅 needs_revision 时可有）。',
  'canUse、goalAttained、needChange、risks、nextStep 必须是面向用户的自然语言判断，由你基于证据包独立作出；不要复述检查项英文 id 或内部枚举。',
  '所有数组均为简短中文字符串；evidenceRefs 必须逐项来自证据包 evidenceRefs。',
  '当证据包同时满足：changedFileCount>0、digitalMeVerified=true、file_changes/scope_boundary/git_integrity/build_check 均为 satisfied，且没有 unsatisfied 的硬门检查时，应判定 meets_plan。',
  '仅在关键核对项缺失、结果互相矛盾，或无法从现有证据支持目标时使用 insufficient_evidence。',
  'needs_revision 的 revisionPlan 应是可交给专业执行者的明确修正要求；系统可在授权范围内自动执行修订，不要向用户承诺具体轮次。',
  '面向用户的中文要中性、清楚，避免内部术语。',
].join('\n');

function textList(value: unknown, maximum = 8): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
  return items.length === value.length || value.length > maximum ? items : null;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

/** 输出结构与证据引用都必须经过本地校验，不能信任模型自行声明。 */
export function parseAiCtoReviewOutput(
  text: string,
  allowedEvidenceRefs: readonly string[],
): AiCtoReviewOutput | null {
  const candidate = extractJsonObject(String(text || '').trim());
  if (!candidate) return null;
  try {
    const raw = JSON.parse(candidate) as Record<string, unknown>;
    if (!(AI_CTO_DECISIONS as readonly string[]).includes(String(raw.decision))) return null;
    const canUse = typeof raw.canUse === 'string' ? raw.canUse.trim() : '';
    const goalAttainedText =
      typeof raw.goalAttained === 'string' ? raw.goalAttained.trim() : '';
    const needChange = typeof raw.needChange === 'string' ? raw.needChange.trim() : '';
    const nextStepRaw = typeof raw.nextStep === 'string' ? raw.nextStep.trim() : '';
    const userSummary = (
      typeof raw.userSummary === 'string' ? raw.userSummary.trim() : ''
    ) || canUse;
    const nextAction = (
      typeof raw.nextAction === 'string' ? raw.nextAction.trim() : ''
    ) || nextStepRaw;
    const nextStep = nextStepRaw || nextAction;
    if (!userSummary || !nextAction) return null;
    const completed = textList(raw.completed ?? []) ?? [];
    const gaps = textList(raw.gaps ?? []) ?? [];
    const risksFromList = textList(raw.risks ?? []);
    const risks =
      risksFromList ??
      (typeof raw.risks === 'string' && raw.risks.trim() ? [raw.risks.trim().slice(0, 400)] : []);
    let evidenceRefs = textList(raw.evidenceRefs ?? [], 16) ?? [];
    // 丢掉伪造引用；若模型未给引用则回退到可用证据中的前几项（仍不放宽决策本身）
    evidenceRefs = evidenceRefs.filter((ref) => allowedEvidenceRefs.includes(ref));
    if (evidenceRefs.length === 0 && allowedEvidenceRefs.length > 0) {
      evidenceRefs = allowedEvidenceRefs.slice(0, 4);
    }
    if (evidenceRefs.length === 0) return null;
    const revisionPlan =
      typeof raw.revisionPlan === 'string' && raw.revisionPlan.trim()
        ? raw.revisionPlan.trim()
        : undefined;
    const five = {
      canUse: (canUse || userSummary).slice(0, 400),
      goalAttained: (goalAttainedText || userSummary).slice(0, 400),
      needChange: (needChange || nextAction).slice(0, 400),
      nextStep: nextStep.slice(0, 400),
    };
    if (raw.decision === 'needs_revision' && !revisionPlan) {
      const synthesized = gaps.length
        ? `请针对以下缺口完成修正并补充可核对证据：${gaps.join('；')}。不得提交、推送或发布。`
        : '请对照已确认规划补齐缺口，完成必要验证并提供可核对证据。不得提交、推送或发布。';
      return {
        decision: 'needs_revision',
        ...five,
        userSummary: userSummary.slice(0, 900),
        completed,
        gaps,
        evidenceRefs,
        risks,
        nextAction: nextAction.slice(0, 400),
        revisionPlan: synthesized,
      };
    }
    return {
      decision: raw.decision as AiCtoDecision,
      ...five,
      userSummary: userSummary.slice(0, 900),
      completed,
      gaps,
      evidenceRefs,
      risks,
      nextAction: nextAction.slice(0, 400),
      ...(revisionPlan ? { revisionPlan: revisionPlan.slice(0, 1600) } : {}),
    };
  } catch {
    return null;
  }
}

export function buildAiCtoEvidencePack(input: CtoReviewInput): AiCtoEvidencePack {
  const checks = (input.verification.checks || []).map((check) => ({
    ref: `check:${check.id}`,
    title: check.title || check.id,
    verdict: check.verdict,
    ...(check.detail ? { detail: String(check.detail).slice(0, 500) } : {}),
  }));
  const changedFiles = (input.changedFiles || []).slice(0, 32).map((path) => ({
    ref: `file:${path.replace(/\\/g, '/')}`,
    path: path.replace(/\\/g, '/'),
  }));
  return {
    goal: String(input.userGoal || '').trim() || '未提供明确目标',
    ...(input.understandingBrief ? { understanding: input.understandingBrief.slice(0, 1800) } : {}),
    planSteps: (input.planSteps || []).slice(0, 12),
    verification: {
      overall: input.verification.overall,
      digitalMeVerified: input.verification.digitalMeVerified,
      agentClaimedSuccess: input.verification.agentClaimedSuccess,
      checks,
    },
    changedFiles,
    changedFileCount: input.changedFileCount,
    directoryChangedSinceResult: !!input.directoryChangedSinceResult,
    unresolvedItems: (input.unresolvedItems || []).slice(0, 12),
    ...(input.agentSummaryExcerpt
      ? { agentSummary: String(input.agentSummaryExcerpt).replace(/\s+/g, ' ').slice(0, 800) }
      : {}),
    evidenceRefs: [...checks.map((check) => check.ref), ...changedFiles.map((file) => file.ref)],
  };
}

function hardGateIssues(input: CtoReviewInput): { security: string[]; quality: string[] } {
  const checks = input.verification.checks || [];
  const failed = (id: string) => checks.find((check) => check.id === id)?.verdict === 'unsatisfied';
  const security: string[] = [];
  const quality: string[] = [];
  if (input.directoryChangedSinceResult) security.push('项目目录已变化，需要重新核对');
  if (failed('scope_boundary')) security.push('存在范围外修改');
  if (failed('git_integrity')) security.push('检测到版本状态异常');
  if (failed('concurrent_edit')) security.push('执行期间可能发生并发修改');
  if (failed('adopt_consistency')) security.push('当前目录与待验收成果不一致');
  if (input.changedFileCount <= 0 || failed('file_changes')) {
    security.push('没有可核对的实质文件变化');
  }
  if (failed('build_check')) quality.push('构建未通过');
  if (failed('run_startup_check')) quality.push('启动检查未通过');
  if (
    failed('tests_passed') &&
    !/not_configured|未配置|skipped/i.test(
      String(checks.find((c) => c.id === 'tests_passed')?.detail || ''),
    )
  ) {
    quality.push('自动测试未通过');
  }
  return { security, quality };
}

/** 缺少这些基础工程证据时，模型不得把成果判为可采用。 */
function criticalEvidenceMissing(input: CtoReviewInput): boolean {
  const checks = input.verification.checks || [];
  const hasSatisfied = (id: string) =>
    checks.some((check) => check.id === id && check.verdict === 'satisfied');
  // 构建未配置不算关键缺失；只有完全没有文件变化或未独立核对，才禁止达标
  return (
    input.changedFileCount <= 0 ||
    !input.verification.digitalMeVerified ||
    !hasSatisfied('file_changes')
  );
}

function unavailableReview(
  reason: 'unavailable' | 'unparseable',
  input?: CtoReviewInput,
): DigitalMeCtoReview {
  if (input) {
    const { security } = hardGateIssues(input);
    if (security.length > 0) {
      return {
        schemaVersion: 'digitalme-cto-review/1',
        report: `暂时无法完成独立验收，同时发现必须先处理的问题：${security.join('；')}。现有工程证据会保留。`,
        findings: security.slice(0, 6),
        nonBlockingRisks: [],
        primaryAction: 'need_decision',
        userFacingNextStep: '请先处理环境或权限问题，并在模型可用后重新验收。',
        goalAttained: false,
        confidence: 'low',
        requiresUserDecision: true,
        decisionPrompt: '当前不能建议采用。',
        decision: 'blocked',
      };
    }
  }
  const why =
    reason === 'unavailable'
      ? '独立验收所需的模型连接不可用。'
      : '本次独立验收结论未能按要求形成。';
  return {
    schemaVersion: 'digitalme-cto-review/1',
    report: [
      '这是暂时性判断，还不是完整的 AI CTO 分析。',
      formatCtoUserConclusion({
        canUse: '现在还不建议当作可用版本。',
        goalAttained: '还不能认定已达到目标。',
        needChange: '需要。先看已有改动，再决定是否继续修改。',
        risks: `暂时无法完成独立验收：${why}不会自动提交、推送或发布。`,
        nextStep: '可以先查看已有成果；连上模型后我会重新给出完整结论。',
      }),
    ].join('\n'),
    findings: ['尚未形成可核对的独立验收结论'],
    nonBlockingRisks: [],
    primaryAction: 'need_decision',
    userFacingNextStep: '请检查模型连接后重新验收，或先查看已有成果再决定。',
    goalAttained: false,
    confidence: 'low',
    requiresUserDecision: true,
    decisionPrompt: '当前不能形成独立验收结论，不能建议采用。',
    decision: 'insufficient_evidence',
  };
}

export function mapAiCtoReview(
  output: AiCtoReviewOutput,
  input: CtoReviewInput,
): DigitalMeCtoReview {
  const { security, quality } = hardGateIssues(input);
  const missingCriticalEvidence = criticalEvidenceMissing(input);
  let guardedDecision: AiCtoDecision = output.decision;
  if (security.length > 0) {
    guardedDecision = 'blocked';
  } else if (quality.length > 0 && output.decision === 'meets_plan') {
    guardedDecision = 'needs_revision';
  } else if (output.decision === 'meets_plan' && input.verification.overall !== 'satisfied') {
    guardedDecision =
      input.verification.overall === 'unverifiable' ? 'insufficient_evidence' : 'needs_revision';
  } else if (output.decision === 'meets_plan' && missingCriticalEvidence) {
    guardedDecision = 'insufficient_evidence';
  }
  const gateNotes = [...security, ...quality];
  const findings = [
    ...output.gaps,
    ...gateNotes,
    ...(missingCriticalEvidence && guardedDecision !== 'meets_plan'
      ? ['缺少支持采用所需的关键工程证据']
      : []),
  ].slice(0, 8);
  let canUse = output.canUse;
  let goalAttainedText = output.goalAttained;
  let needChange = output.needChange;
  let nextStep = output.nextStep || output.nextAction;
  if (guardedDecision === 'blocked' || guardedDecision === 'insufficient_evidence') {
    if (/可以完全使用|建议当作可用|已经可以交付/.test(canUse)) {
      canUse = '现在还不能当作可用版本。';
    }
    if (/已达到|已经达标/.test(goalAttainedText)) {
      goalAttainedText = '还不能认定已达到目标。';
    }
    if (/不是必须|不必再改|可以不改/.test(needChange)) {
      needChange = '需要先处理必须面对的问题，再决定是否继续修改。';
    }
  } else if (guardedDecision === 'needs_revision' && output.decision === 'meets_plan') {
    if (/可以完全使用|已经可以交付/.test(canUse)) {
      canUse = '现在还不建议当作最终可用版本。';
    }
    if (/不是必须|不必再改/.test(needChange)) {
      needChange = '还需要按核对结果继续修改。';
    }
  }
  const riskText = [
    ...(output.risks || []).slice(0, 4),
    ...gateNotes,
  ]
    .filter(Boolean)
    .join('；') || '不会自动提交、推送或发布。';
  const report = formatCtoUserConclusion({
    canUse,
    goalAttained: goalAttainedText,
    needChange,
    risks: riskText,
    nextStep,
  });
  const revisionDirective =
    guardedDecision === 'needs_revision'
      ? output.revisionPlan ||
        (quality.length
          ? `请先处理以下问题并补充可核对证据：${quality.join('；')}。不得提交、推送或发布。`
          : undefined)
      : guardedDecision === 'blocked' && security.length
        ? `请先处理以下问题并补充可核对证据：${security.join('；')}。不得提交、推送或发布。`
        : undefined;
  return {
    schemaVersion: 'digitalme-cto-review/1',
    report,
    findings,
    nonBlockingRisks: output.risks.slice(0, 6),
    primaryAction:
      guardedDecision === 'meets_plan'
        ? 'confirm_adopt'
        : guardedDecision === 'needs_revision'
          ? 'confirm_continue'
          : 'need_decision',
    userFacingNextStep: output.nextAction,
    ...(revisionDirective ? { revisionDirective } : {}),
    goalAttained: guardedDecision === 'meets_plan',
    confidence:
      guardedDecision === 'meets_plan'
        ? 'high'
        : guardedDecision === 'needs_revision'
          ? 'medium'
          : 'low',
    requiresUserDecision:
      guardedDecision === 'blocked' || guardedDecision === 'insufficient_evidence',
    ...(guardedDecision === 'blocked' || guardedDecision === 'insufficient_evidence'
      ? { decisionPrompt: '当前不能建议采用，请先处理问题或补充决定。' }
      : {}),
    decision: guardedDecision,
    evidenceRefs: output.evidenceRefs,
  };
}

export async function buildAiDigitalMeCtoReview(
  input: CtoReviewInput,
  chat: CtoReviewChat | null | undefined,
): Promise<DigitalMeCtoReview> {
  if (!chat) return unavailableReview('unavailable', input);
  const evidencePack = buildAiCtoEvidencePack(input);
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(evidencePack) },
  ];
  try {
    let parsed: AiCtoReviewOutput | null = null;
    let lastText = '';
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const messages =
        attempt === 0
          ? baseMessages
          : [
              ...baseMessages,
              { role: 'assistant' as const, content: lastText.slice(0, 4000) },
              {
                role: 'user' as const,
                content:
                  '上一次输出无法验收。请只输出一个合法 JSON 对象；evidenceRefs 只能使用证据包中的引用；不要 Markdown。',
              },
            ];
      const result = await chat({ messages });
      lastText = String(result.text || '');
      parsed = parseAiCtoReviewOutput(lastText, evidencePack.evidenceRefs);
    }
    return parsed ? mapAiCtoReview(parsed, input) : unavailableReview('unparseable', input);
  } catch {
    return unavailableReview('unavailable', input);
  }
}
