/**
 * D11-C AI CTO 验收：模型只在受限证据包内作出独立判断；
 * 验证器与硬门仍由确定性规则执行，不能被模型结论覆盖。
 * 不保存提示词、模型原文或推理过程。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
export type CtoReviewChat = (input: {
  messages: ChatMessage[];
}) => Promise<{ text: string; finishReason?: string; truncated?: boolean }>;

export const AI_CTO_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'decision',
    'canUse',
    'goalAttained',
    'needChange',
    'risks',
    'nextStep',
    'userSummary',
    'completed',
    'gaps',
    'evidenceRefs',
    'nextAction',
    'revisionPlan',
  ],
  properties: {
    decision: { type: 'string', enum: [...AI_CTO_DECISIONS] },
    canUse: { type: 'string' },
    goalAttained: { type: 'string' },
    needChange: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    nextStep: { type: 'string' },
    userSummary: { type: 'string' },
    completed: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
    nextAction: { type: 'string' },
    revisionPlan: { type: 'string' },
  },
};

export type CtoParseFailStep =
  | 'empty_text'
  | 'no_json_found'
  | 'json_parse_error'
  | 'illegal_decision'
  | 'missing_or_invalid_fields'
  | 'invalid_evidence_refs';

export type CtoParseAttemptDiagnosis = {
  attempt: 1 | 2;
  foundJson: boolean;
  jsonParseOk: boolean;
  illegalDecision: boolean;
  invalidEvidenceRefs: boolean;
  missingOrTypedWrong: string[];
  textLength: number;
  finishReason?: string;
  truncated?: boolean;
  failStep?: CtoParseFailStep;
};

export const CTO_CONTRACT_DEGRADED_MARKER = '这是验收合同失败，不是完整的专业判断。';

export interface AiCtoEvidencePack {
  goal: string;
  originalTaskGoal?: string;
  revisionRequest?: string;
  currentRoundAuthority?: 'initial_task' | 'owner_revision';
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
  artifactVersionId?: string;
  jobId?: string;
  testResults?: Array<{ command: string; passed: boolean; summary?: string }>;
  changedFileExcerpts?: Array<{ path: string; excerpt: string }>;
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
  'canUse、goalAttained、needChange、risks、nextStep 必须是面向用户的自然语言判断，由你基于证据包独立作出；测试未通过时写「测试未通过」，不要写 execution_failed、Job、Artifact，也不要复述检查项英文 id 或内部枚举。',
  '证据包的 goal 是本轮验收目标。若 currentRoundAuthority 为 owner_revision，必须按本轮用户要求判断，不得把 originalTaskGoal 当成当前必须达成的标准。',
  '你必须回答：用户本轮要求改成什么，当前成果是否满足本轮要求。若成果已按本轮要求改为新值，不得建议改回已被替代的旧目标。',
  '所有数组均为简短中文字符串；risks 必须是字符串数组；evidenceRefs 必须逐项来自证据包 evidenceRefs。',
  '证据包中的 goal、revisionRequest、artifactVersionId、jobId、testResults、changedFileExcerpts 描述的是本轮成果；不要把 originalTaskGoal 或已过期的失败描述当成当前事实。',
  '当证据包同时满足：changedFileCount>0、digitalMeVerified=true、file_changes/scope_boundary/git_integrity 均为 satisfied，且没有 unsatisfied 的硬门检查时，应判定 meets_plan。',
  '无 build 脚本导致的 build_check unverifiable、以及 claim_vs_diff 仅为 partially_satisfied，不得单独把已通过目标与测试的成果判为未达标。',
  '仅在关键核对项缺失、结果互相矛盾，或无法从现有证据支持目标时使用 insufficient_evidence。',
  'needs_revision 的 revisionPlan 应是可交给专业执行者的明确修正要求；系统可在授权范围内自动执行修订，不要向用户承诺具体轮次。',
  '面向用户的中文要中性、清楚，避免内部术语。',
].join('\n');

function textList(value: unknown, maximum = 8): string[] | null {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim().slice(0, 400)];
  }
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
    .filter(Boolean)
    .slice(0, maximum);
  return items;
}

export function extractJsonObject(text: string): string | null {
  let raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) raw = fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function parseJsonObject(candidate: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  return tryParse(candidate) || tryParse(candidate.replace(/,\s*([}\]])/g, '$1'));
}

export function diagnoseAiCtoParse(
  text: string,
  allowedEvidenceRefs: readonly string[],
  meta?: { attempt?: 1 | 2; finishReason?: string; truncated?: boolean },
): CtoParseAttemptDiagnosis {
  const attempt = meta?.attempt === 2 ? 2 : 1;
  const body = String(text || '');
  const diag: CtoParseAttemptDiagnosis = {
    attempt,
    foundJson: false,
    jsonParseOk: false,
    illegalDecision: false,
    invalidEvidenceRefs: false,
    missingOrTypedWrong: [],
    textLength: body.length,
    ...(meta?.finishReason ? { finishReason: meta.finishReason } : {}),
    ...(meta?.truncated ? { truncated: true } : {}),
  };
  if (meta?.truncated || meta?.finishReason === 'length') {
    diag.truncated = true;
  }
  if (!body.trim()) {
    diag.failStep = 'empty_text';
    return diag;
  }
  const candidate = extractJsonObject(body);
  diag.foundJson = !!candidate;
  if (!candidate) {
    diag.failStep = diag.truncated ? 'json_parse_error' : 'no_json_found';
    return diag;
  }
  const raw = parseJsonObject(candidate);
  diag.jsonParseOk = !!raw;
  if (!raw) {
    diag.failStep = 'json_parse_error';
    return diag;
  }
  if (!(AI_CTO_DECISIONS as readonly string[]).includes(String(raw.decision || ''))) {
    diag.illegalDecision = true;
    diag.failStep = 'illegal_decision';
    diag.missingOrTypedWrong.push('decision');
    return diag;
  }
  const requiredFive = ['canUse', 'goalAttained', 'needChange', 'nextStep'] as const;
  for (const key of requiredFive) {
    const v = raw[key];
    if (typeof v !== 'string' || !v.trim()) {
      if (key === 'canUse' && typeof raw.userSummary === 'string' && raw.userSummary.trim()) continue;
      if (key === 'nextStep' && typeof raw.nextAction === 'string' && raw.nextAction.trim()) continue;
      diag.missingOrTypedWrong.push(key);
    }
  }
  const refs = textList(raw.evidenceRefs ?? [], 16) ?? [];
  const valid = refs.filter((ref) => allowedEvidenceRefs.includes(ref));
  if (refs.length > 0 && valid.length === 0) diag.invalidEvidenceRefs = true;
  if (diag.missingOrTypedWrong.length) {
    diag.failStep = 'missing_or_invalid_fields';
    return diag;
  }
  if (valid.length === 0 && allowedEvidenceRefs.length === 0) {
    diag.invalidEvidenceRefs = true;
    diag.failStep = 'invalid_evidence_refs';
    return diag;
  }
  return diag;
}

export function buildCtoRepairUserMessage(
  diag: CtoParseAttemptDiagnosis,
  allowedEvidenceRefs: readonly string[],
): string {
  const refs = allowedEvidenceRefs.slice(0, 12).join('、') || '（证据包为空）';
  if (diag.truncated || diag.failStep === 'json_parse_error') {
    return [
      '上次输出不完整或不是合法 JSON（可能被截断）。',
      '请只输出一个更短的完整 JSON 对象，不要 Markdown，不要解释。',
      `decision 只能是 ${AI_CTO_DECISIONS.join(' | ')}。`,
      `evidenceRefs 只能使用：${refs}。`,
    ].join('');
  }
  if (diag.failStep === 'no_json_found' || diag.failStep === 'empty_text') {
    return '上次没有输出 JSON。请只输出一个合法 JSON 对象，不要 Markdown 或前后说明。';
  }
  if (diag.illegalDecision) {
    return `上次 decision 非法。decision 必须是 ${AI_CTO_DECISIONS.join(' | ')}。请只输出合法 JSON。`;
  }
  if (diag.missingOrTypedWrong.length) {
    return `上次缺少或类型错误的字段：${diag.missingOrTypedWrong.join('、')}。canUse、goalAttained、needChange、nextStep 必须是非空字符串；risks 可以是字符串或字符串数组。请只输出合法 JSON。`;
  }
  if (diag.invalidEvidenceRefs) {
    return `上次 evidenceRefs 不在证据包内。只能使用：${refs}。请只输出合法 JSON。`;
  }
  return `上次输出无法验收。请只输出合法 JSON；evidenceRefs 只能是：${refs}。`;
}

/** 输出结构与证据引用都必须经过本地校验，不能信任模型自行声明。 */
export function parseAiCtoReviewOutput(
  text: string,
  allowedEvidenceRefs: readonly string[],
): AiCtoReviewOutput | null {
  const candidate = extractJsonObject(String(text || '').trim());
  if (!candidate) return null;
  const raw = parseJsonObject(candidate);
  if (!raw) return null;
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
  if (!canUse && !userSummary) return null;
  if (!needChange && !nextAction) return null;
  if (!goalAttainedText && !userSummary) return null;
  if (!nextStep) return null;
  const completed = textList(raw.completed ?? []) ?? [];
  const gaps = textList(raw.gaps ?? []) ?? [];
  const risksFromList = textList(raw.risks ?? []);
  const risks =
    risksFromList ??
    (typeof raw.risks === 'string' && raw.risks.trim() ? [raw.risks.trim().slice(0, 400)] : []);
  if (!risks.length) {
    risks.push('不会自动提交、推送或发布。');
  }
  let evidenceRefs = textList(raw.evidenceRefs ?? [], 16) ?? [];
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
  if (!five.canUse || !five.goalAttained || !five.needChange || !five.nextStep) return null;
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
}

function toCtoModelFact(detail: string | undefined, checkId?: string, verdict?: string): string | undefined {
  if (checkId === 'tests_passed' && verdict === 'unsatisfied') return '测试未通过';
  const raw = String(detail || '').trim();
  if (!raw) return undefined;
  const fact = raw
    .replace(/（execution_failed）/g, '')
    .replace(/\bexecution_failed\b/gi, '测试未通过')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return fact || undefined;
}

export function buildAiCtoEvidencePack(input: CtoReviewInput): AiCtoEvidencePack {
  const checks = (input.verification.checks || []).map((check) => {
    const detail = toCtoModelFact(check.detail, check.id, check.verdict);
    return {
      ref: `check:${check.id}`,
      title: check.title || check.id,
      verdict: check.verdict,
      ...(detail ? { detail } : {}),
    };
  });
  const changedFiles = (input.changedFiles || []).slice(0, 32).map((path) => ({
    ref: `file:${path.replace(/\\/g, '/')}`,
    path: path.replace(/\\/g, '/'),
  }));
  const originalTaskGoal = String(input.originalTaskGoal || '').trim();
  const revisionRequest = String(input.revisionRequest || '').trim();
  const currentRoundAuthority = input.currentRoundAuthority;
  return {
    goal: String(input.userGoal || '').trim() || '未提供明确目标',
    ...(originalTaskGoal ? { originalTaskGoal: originalTaskGoal.slice(0, 800) } : {}),
    ...(revisionRequest ? { revisionRequest: revisionRequest.slice(0, 800) } : {}),
    ...(currentRoundAuthority ? { currentRoundAuthority } : {}),
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
    unresolvedItems: filterStaleUnresolved(
      (input.unresolvedItems || []).slice(0, 12),
      input.revisionRequest,
    ),
    ...(input.agentSummaryExcerpt
      ? { agentSummary: pickCurrentRoundSummary(input.agentSummaryExcerpt) }
      : {}),
    evidenceRefs: [...checks.map((check) => check.ref), ...changedFiles.map((file) => file.ref)],
    ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.testResults?.length
      ? {
          testResults: input.testResults.slice(0, 8).map((t) => ({
            command: String(t.command || '').slice(0, 120),
            passed: !!t.passed,
            ...(t.passed === false
              ? { summary: '测试未通过' }
              : t.summary
                ? { summary: String(toCtoModelFact(t.summary) || t.summary).slice(0, 240) }
                : {}),
          })),
        }
      : {}),
    ...(input.changedFileExcerpts?.length
      ? {
          changedFileExcerpts: input.changedFileExcerpts.slice(0, 8).map((f) => ({
            path: String(f.path || '').slice(0, 160),
            excerpt: String(f.excerpt || '').slice(0, 600),
          })),
        }
      : {}),
  };
}

function pickCurrentRoundSummary(full: string): string {
  const text = String(full || '');
  const happen = text.match(/##\s*发生了什么\s*([\s\S]*?)(?=\n##\s|$)/);
  if (happen?.[1]?.trim()) return happen[1].replace(/\s+/g, ' ').trim().slice(0, 800);
  return text.replace(/\s+/g, ' ').slice(0, 800);
}

function filterStaleUnresolved(items: string[], revisionRequest?: string): string[] {
  return items.filter((item) => {
    const t = String(item || '');
    if (/无需修改|当前代码已满足目标/.test(t)) return false;
    if (revisionRequest && /unexpected start/.test(t)) return false;
    return true;
  });
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

function attachDiagnosis(
  review: DigitalMeCtoReview,
  attempts: CtoParseAttemptDiagnosis[],
): DigitalMeCtoReview {
  if (attempts.length) review.ctoParseDiagnosis = attempts;
  return review;
}

async function persistCtoParseDiagnosis(input: {
  attempts: CtoParseAttemptDiagnosis[];
  parsed: boolean;
  degraded: boolean;
  jobId?: string;
  artifactVersionId?: string;
  cacheHit?: boolean;
}): Promise<void> {
  const dir = String(process.env.DIGITALME_20A_EVIDENCE || process.env.DIGITALME_CTO_PARSE_DIAG_DIR || '').trim();
  if (!dir) return;
  const file = path.join(dir, 'AI_CTO_PARSE_DIAGNOSIS.json');
  let existing: { sessions?: unknown[] } = {};
  try {
    existing = JSON.parse(await fs.readFile(file, 'utf8')) as { sessions?: unknown[] };
  } catch {
    existing = {};
  }
  const sessions = Array.isArray(existing.sessions) ? existing.sessions : [];
  sessions.push({
    at: new Date().toISOString(),
    parsed: input.parsed,
    degraded: input.degraded,
    cacheHit: !!input.cacheHit,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    attempts: input.attempts,
    notes: {
      reusedOldCtoConclusion: false,
      keywordRouting: false,
      parsedNullExecution: false,
    },
  });
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ schemaVersion: 'ai-cto-parse-diagnosis/1', sessions }, null, 2)}\n`);
  } catch {
    /* 诊断落盘失败不影响验收 */
  }
}

function unavailableReview(
  reason: 'unavailable' | 'unparseable',
  input?: CtoReviewInput,
): DigitalMeCtoReview {
  const why =
    reason === 'unavailable'
      ? '暂时无法完成独立验收：独立验收所需的模型连接不可用。'
      : '暂时无法完成独立验收：本次验收结论未能按合同形成。';
  const next =
    reason === 'unavailable'
      ? '请检查模型连接后重新验收。现有成果会保留，现在不能建议采用。'
      : '可以重新验收。现有成果会保留，现在不能建议采用。';
  if (input) {
    const { security } = hardGateIssues(input);
    if (security.length > 0) {
      return {
        schemaVersion: 'digitalme-cto-review/1',
        report: [
          CTO_CONTRACT_DEGRADED_MARKER,
          `同时发现必须先处理的问题：${security.join('；')}。现有工程证据会保留。`,
        ].join('\n'),
        findings: security.slice(0, 6),
        nonBlockingRisks: [],
        primaryAction: 'need_decision',
        userFacingNextStep: '请先处理环境或权限问题，并重新验收。现有成果会保留，现在不能建议采用。',
        goalAttained: false,
        confidence: 'low',
        requiresUserDecision: true,
        decisionPrompt: '当前不能建议采用。',
        decision: 'blocked',
        ctoContractDegraded: true,
      };
    }
  }
  return {
    schemaVersion: 'digitalme-cto-review/1',
    report: [
      CTO_CONTRACT_DEGRADED_MARKER,
      formatCtoUserConclusion({
        canUse: '现在不能建议采用。本次验收结论未能形成。',
        goalAttained: '尚未形成可核对的达标结论。',
        needChange: '需要先重新验收，而不是按未形成的结论继续改。',
        risks: `${why}现有成果会保留，不会自动提交、推送或发布。`,
        nextStep: next,
      }),
    ].join('\n'),
    findings: ['验收合同失败，尚未形成可核对的独立验收结论'],
    nonBlockingRisks: [],
    primaryAction: 'need_decision',
    userFacingNextStep: next,
    goalAttained: false,
    confidence: 'low',
    requiresUserDecision: true,
    decisionPrompt: '当前不能形成独立验收结论，不能建议采用。可以重新验收。',
    decision: 'insufficient_evidence',
    ctoContractDegraded: true,
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
  } else if (output.decision === 'meets_plan' && input.verification.overall === 'unsatisfied') {
    guardedDecision = 'needs_revision';
  } else if (
    output.decision === 'meets_plan' &&
    input.verification.overall === 'unverifiable' &&
    missingCriticalEvidence
  ) {
    guardedDecision = 'insufficient_evidence';
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
  const attempts: CtoParseAttemptDiagnosis[] = [];
  try {
    let parsed: AiCtoReviewOutput | null = null;
    let lastText = '';
    let lastDiag: CtoParseAttemptDiagnosis | undefined;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const n = (attempt + 1) as 1 | 2;
      const fallbackDiag: CtoParseAttemptDiagnosis = {
        attempt: 1,
        foundJson: false,
        jsonParseOk: false,
        illegalDecision: false,
        invalidEvidenceRefs: false,
        missingOrTypedWrong: [],
        textLength: 0,
        failStep: 'empty_text',
      };
      const messages =
        attempt === 0
          ? baseMessages
          : [
              ...baseMessages,
              { role: 'assistant' as const, content: lastText.slice(0, 4000) },
              {
                role: 'user' as const,
                content: buildCtoRepairUserMessage(lastDiag || fallbackDiag, evidencePack.evidenceRefs),
              },
            ];
      const result = await chat({ messages });
      lastText = String(result.text || '');
      lastDiag = diagnoseAiCtoParse(lastText, evidencePack.evidenceRefs, {
        attempt: n,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      });
      attempts.push(lastDiag);
      parsed = parseAiCtoReviewOutput(lastText, evidencePack.evidenceRefs);
    }
    const review = parsed
      ? mapAiCtoReview(parsed, input)
      : unavailableReview('unparseable', input);
    attachDiagnosis(review, attempts);
    await persistCtoParseDiagnosis({
      attempts,
      parsed: !!parsed,
      degraded: !!review.ctoContractDegraded,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    });
    return review;
  } catch {
    const review = unavailableReview('unavailable', input);
    attachDiagnosis(review, attempts);
    await persistCtoParseDiagnosis({
      attempts,
      parsed: false,
      degraded: true,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    });
    return review;
  }
}
