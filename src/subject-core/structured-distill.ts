/**
 * 结构化蒸馏 — 产出带完整字段的候选提案，再经质量门进入 GrowthEvent。
 * 默认确定性合同蒸馏（可测）；可选接入产品模型运行时，失败回退合同蒸馏。
 * 模型不得直接 confirm / 覆盖 / 判定用户事实。
 */
import { newId, nowIso } from '../shared/ids';
import type { GrowthEvent } from './growth-event';
import type { SubjectCaptureSourceKind } from './candidate-distill';
import { distillCandidatesFromText } from './candidate-distill';
import {
  gateDistilledBatch,
  type DistilledCandidateProposal,
} from './candidate-quality-gate';
import {
  authorityFromEvents,
  categoryTag,
  detectAuthorityConflict,
  enrichGrowthTags,
  signalTag,
} from './growth-signal';
import type { ChatCompleteOptions, ChatCompleteResult } from '../infrastructure/model-http';
import { normalizeModelCandidate, type RawModelCandidate } from './candidate-normalize';

export type ChatCompleteFn = (options: ChatCompleteOptions) => Promise<ChatCompleteResult>;

export interface StructuredDistillInput {
  subjectId: string;
  text: string;
  sourceKind: SubjectCaptureSourceKind;
  materialRef?: string;
  taskId?: string;
  artifactId?: string;
  artifactVersionId?: string;
  requestedArtifactType?: string;
  capabilityId?: string;
  capabilityVersion?: string;
  sourceCapabilityKind?: 'local' | 'external_capability';
  existingEvents?: GrowthEvent[];
  /** 可选真模型；失败则回退合同蒸馏 */
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; apiKey?: string; model: string };
}

export interface StructuredDistillResult {
  events: GrowthEvent[];
  discarded: Array<{ reason: string; title: string }>;
  mode: 'contract' | 'model' | 'model_fallback_contract';
  /**
   * 模型调用/结构化输出不可靠：不得写成「无可学」幂等回执。
   * 与模型明确判定 not_durable 区分。
   */
  unreliable?: boolean;
  emptyKind?: 'explicit' | 'unnormalized' | 'technical' | 'verified_not_durable' | 'verified_uncertain';
  /** 验收追溯：原始候选与归一结果（不上用户面） */
  normalizeTrace?: Array<{
    raw: Record<string, unknown>;
    normalized?: { category: string; eventType: string; mappedFrom: string };
    ok: boolean;
    reason?: string;
  }>;
}

type DistillEmptyKind = 'explicit' | 'unnormalized' | 'technical';

interface ModelDistillAttempt {
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
  error?: string;
  emptyKind?: DistillEmptyKind;
}

/**
 * 合同蒸馏：把既有启发式结果提升为带完整字段的提案（不调用网络）。
 */
export function contractDistillProposals(input: StructuredDistillInput): DistilledCandidateProposal[] {
  const authority = authorityFromEvents(input.existingEvents || []);
  const raw = distillCandidatesFromText({
    subjectId: input.subjectId,
    text: input.text,
    sourceKind: input.sourceKind,
    ...(input.materialRef ? { materialRef: input.materialRef } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
    ...(input.requestedArtifactType
      ? { requestedArtifactType: input.requestedArtifactType }
      : {}),
    ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
    ...(input.capabilityVersion ? { capabilityVersion: input.capabilityVersion } : {}),
    ...(input.sourceCapabilityKind
      ? { sourceCapabilityKind: input.sourceCapabilityKind }
      : {}),
    authority,
  });

  return raw.slice(0, 3).map((e) => eventToProposal(e, input));
}

function eventToProposal(
  e: GrowthEvent,
  input: StructuredDistillInput,
): DistilledCandidateProposal {
  const tags = e.payload.tags || [];
  const catTag = tags.find((t) => t.startsWith('category:'));
  const category = (catTag?.slice('category:'.length) || 'temporary_context') as DistilledCandidateProposal['category'];
  const temporary =
    tags.includes('category:temporary_context') ||
    /仅本次|只这一次|临时/.test(input.text + e.payload.detail);
  const maybeConflict = tags.includes('conflict');
  return {
    text: e.payload.detail,
    title: e.payload.title,
    category,
    sourceKind: input.sourceKind,
    ...(input.materialRef ? { sourceRef: input.materialRef } : {}),
    ...(input.artifactId ? { sourceRef: `artifact:${input.artifactId}` } : {}),
    scope: temporary ? 'temporary' : input.sourceKind === 'task_requirement' ? 'task' : 'general',
    temporary,
    ...(temporary
      ? { expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }
      : {}),
    risk:
      e.type === 'boundary_updated' || e.type === 'identity_clarified' || e.type === 'goal_updated'
        ? 'medium'
        : 'low',
    maybeConflict,
    modelConfidenceSummary: `contract:${e.type}`,
    eventType: e.type as DistilledCandidateProposal['eventType'],
    tags,
  };
}

function proposalToEvent(
  p: DistilledCandidateProposal,
  input: StructuredDistillInput,
  distillMode: StructuredDistillResult['mode'],
): GrowthEvent {
  const authority = authorityFromEvents(input.existingEvents || []);
  let tags = [...(p.tags || [])].filter(
    (t) => t !== 'needs_confirmation' && t !== 'conflict' && t !== 'silent_ok',
  );
  if (!tags.some((t) => t.startsWith('category:'))) tags.push(categoryTag(p.category));
  if (p.temporary && p.expiresAt && !tags.some((t) => t.startsWith('expiresAt:'))) {
    tags.push(`expiresAt:${p.expiresAt}`);
  }
  if (p.sourceRef && !tags.some((t) => t.startsWith('sourceRef:'))) {
    tags.push(`sourceRef:${p.sourceRef}`);
  }
  tags.push(`scope:${p.scope}`, `risk:${p.risk}`);
  tags.push(`model_reason:${p.modelConfidenceSummary.slice(0, 80)}`);
  tags.push(
    distillMode === 'model'
      ? 'distill:model'
      : distillMode === 'model_fallback_contract'
        ? 'distill:contract_fallback'
        : 'distill:contract',
  );

  // 冲突仅由本地权威检测决定；模型 maybeConflict / needs_confirmation 不得越权
  const localConflict = detectAuthorityConflict({
    title: p.title,
    detail: p.text,
    type: p.eventType,
    authority,
  });
  if (localConflict) {
    tags.push('conflict', 'needs_confirmation');
  }

  const enriched = enrichGrowthTags({
    type: p.eventType,
    sourceKind: input.sourceKind,
    text: `${p.title} ${p.text}`,
    tags,
    authority,
  });
  tags = enriched.tags;
  if (!tags.some((t) => t.startsWith('signal:'))) tags.push(signalTag(enriched.signal));

  // 确定性采纳：低风险偏好可静默；模型附带的 needs_confirmation 在无 conflict 时不得阻止 silent_ok
  if (enriched.adopt === 'silent_adopt') {
    tags = tags.filter((t) => t !== 'needs_confirmation');
    if (!tags.includes('silent_ok')) tags.push('silent_ok');
  } else if (
    distillMode === 'model' &&
    p.eventType === 'preference_observed' &&
    p.risk === 'low' &&
    !localConflict &&
    (input.sourceKind === 'conversation' || input.sourceKind === 'task_requirement')
  ) {
    // 模型已判定为本人低风险 durable preference：按现有 Subject 权威机制静默采用。
    // 不得用关键词改写类型；只补齐采用闸门，避免停在 candidate 无法注入。
    tags = tags.filter((t) => t !== 'needs_confirmation');
    if (!tags.includes('silent_ok')) tags.push('silent_ok');
  } else if (enriched.adopt === 'must_confirm' || tags.includes('conflict')) {
    if (!tags.includes('needs_confirmation')) tags.push('needs_confirmation');
    tags = tags.filter((t) => t !== 'silent_ok');
  }

  const source: GrowthEvent['source'] = {
    kind:
      input.sourceKind === 'imported_material'
        ? 'import'
        : input.sourceKind === 'artifact_edit' ||
            input.sourceKind === 'artifact_acceptance' ||
            input.sourceKind === 'artifact_rejection'
          ? input.sourceKind === 'artifact_edit'
            ? 'artifact_edit'
            : 'task_feedback'
          : input.sourceKind === 'task_requirement'
            ? 'task_feedback'
            : 'owner_direct',
  };
  if (input.taskId) source.taskId = input.taskId;
  if (input.artifactId) source.artifactId = input.artifactId;

  const payload: GrowthEvent['payload'] = {
    title: p.title.slice(0, 80),
    detail: p.text.slice(0, 400),
    tags,
  };
  if (input.materialRef) payload.relation = { materialRef: input.materialRef };
  if (input.artifactId && input.artifactVersionId) {
    payload.evidence = {
      artifactId: input.artifactId,
      toVersionId: input.artifactVersionId,
    };
  }

  return {
    id: newId('growthEvent'),
    subjectId: input.subjectId,
    occurredAt: nowIso(),
    type: p.eventType,
    source,
    payload,
    confidence: 'candidate',
  };
}

/** 复用主模型时必须窄上下文：当前输入 + 少量已有事实，禁止整包/整段历史。 */
const DISTILL_TEXT_LIMIT = 800;
const DISTILL_FACT_LIMIT = 5;
const DISTILL_MAX_TOKENS = 500;
const DISTILL_TIMEOUT_MS = 12_000;

function compactExistingFacts(
  events: GrowthEvent[] | undefined,
): Array<{ type: string; title: string; detail: string }> {
  const allowed = new Set([
    'preference_observed',
    'identity_clarified',
    'goal_updated',
    'boundary_updated',
    'principle_stated',
  ]);
  return (events || [])
    .filter((e) => e.confidence === 'confirmed' && allowed.has(e.type))
    .slice(-DISTILL_FACT_LIMIT)
    .map((e) => ({
      type: e.type,
      title: e.payload.title.slice(0, 40),
      detail: e.payload.detail.slice(0, 80),
    }));
}

async function withDistillDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('distill_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function attachSource(input: StructuredDistillInput, row: DistilledCandidateProposal): DistilledCandidateProposal {
  return {
    ...row,
    sourceKind: input.sourceKind,
    ...(input.materialRef ? { sourceRef: input.materialRef } : {}),
  };
}

async function modelDistillProposals(input: StructuredDistillInput): Promise<ModelDistillAttempt | null> {
  if (!input.chatComplete || !input.model) return null;
  const system = [
    '你从用户输入中提炼 0 到 3 条成长候选。只输出 JSON。',
    '可用字段: title, text, category, scope, temporary, risk, maybeConflict, modelConfidenceSummary, eventType。',
    'category 建议: preference, working_method, principle, boundary, goal, identity_fact, temporary_context, external_claim。',
    'text 尽量保留用户原词（如结论、篇幅、决策），不要改写成第三人称长句。',
    '不得把外部资料写成用户观点；不得推断性格/立场/敏感属性；不得把一次性要求写成长期偏好。',
    '若用户在说明今后同类工作应如何完成（即使未使用特定口号），这是可沉淀的工作方法，category=working_method 或 preference，eventType=preference_observed。',
    '没有可沉淀的本人长期信息时输出 {"candidates":[]}。不要把未解析的句子写成 knowledge_gap 或 temporary_context。',
    '天气、新闻、闲聊或与用户本人无关的外部事实不是长期偏好或身份；此时输出 {"candidates":[]}。',
    'existingFacts 仅用于冲突判断，不要把旧事实再写一遍，也不要读取未提供的历史。',
    '你不能决定确认或覆盖旧内容；needs_confirmation 只是建议。',
  ].join('\n');
  const userContent = JSON.stringify({
    sourceKind: input.sourceKind,
    text: input.text.slice(0, DISTILL_TEXT_LIMIT),
    existingFacts: compactExistingFacts(input.existingEvents),
  });
  const attempt = async (useJsonFormat: boolean): Promise<ChatCompleteResult> =>
    withDistillDeadline(
      input.chatComplete!({
        baseUrl: input.model!.baseUrl,
        ...(input.model!.apiKey ? { apiKey: input.model!.apiKey } : {}),
        model: input.model!.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        maxTokens: DISTILL_MAX_TOKENS,
        ...(useJsonFormat ? { responseFormat: { type: 'json_object' as const } } : {}),
        timeoutMs: DISTILL_TIMEOUT_MS,
      }),
      DISTILL_TIMEOUT_MS,
    );

  try {
    let result: ChatCompleteResult;
    try {
      result = await attempt(true);
    } catch (firstErr) {
      try {
        result = await attempt(false);
      } catch {
        return {
          proposals: [],
          trace: [],
          error: String(firstErr instanceof Error ? firstErr.message : firstErr).slice(0, 200),
          emptyKind: 'technical',
        };
      }
    }
    return attemptFromParsed(parseAndNormalizeModelJson(result.text, input.sourceKind), input);
  } catch (err) {
    return {
      proposals: [],
      trace: [],
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
      emptyKind: 'technical',
    };
  }
}

async function modelDistillRepair(input: StructuredDistillInput): Promise<ModelDistillAttempt | null> {
  if (!input.chatComplete || !input.model) return null;
  try {
    const result = await withDistillDeadline(
      input.chatComplete({
        baseUrl: input.model.baseUrl,
        ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
        model: input.model.model,
        messages: [
          {
            role: 'system',
            content:
              '只输出 JSON。这是结构化输出修复，不是改写用户意图。若用户在说明今后同类工作怎么做，产出 1 条 preference/working_method 候选并尽量保留用户原词；否则 {"candidates":[]}。不要输出 knowledge_gap。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              sourceKind: input.sourceKind,
              text: input.text.slice(0, DISTILL_TEXT_LIMIT),
            }),
          },
        ],
        temperature: 0,
        maxTokens: DISTILL_MAX_TOKENS,
        responseFormat: { type: 'json_object' },
        timeoutMs: DISTILL_TIMEOUT_MS,
      }),
      DISTILL_TIMEOUT_MS,
    );
    return attemptFromParsed(parseAndNormalizeModelJson(result.text, input.sourceKind), input);
  } catch (err) {
    return {
      proposals: [],
      trace: [],
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
      emptyKind: 'technical',
    };
  }
}

async function modelDistillVerify(input: StructuredDistillInput): Promise<{
  decision: 'durable_preference' | 'not_durable' | 'uncertain';
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
  error?: string;
} | null> {
  if (!input.chatComplete || !input.model) return null;
  try {
    const result = await withDistillDeadline(
      input.chatComplete({
        baseUrl: input.model.baseUrl,
        ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
        model: input.model.model,
        messages: [
          {
            role: 'system',
            content: [
              '只输出 JSON。判断用户这句话是否表达本人今后同类工作应如何完成。',
              '{"decision":"durable_preference"|"not_durable"|"uncertain","candidate":null|{title,text,category,eventType,temporary,risk,scope}}',
              'durable_preference：本人对今后同类材料/判断/协作方式的稳定做法。candidate 尽量用用户原词。',
              'not_durable：仅本次安排、天气闲聊、外部事实、或在描述别人怎么做。',
              'uncertain：无法可靠判断。不要输出 knowledge_gap，不要猜测成其他主体类型。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              sourceKind: input.sourceKind,
              text: input.text.slice(0, DISTILL_TEXT_LIMIT),
            }),
          },
        ],
        temperature: 0,
        maxTokens: DISTILL_MAX_TOKENS,
        responseFormat: { type: 'json_object' },
        timeoutMs: DISTILL_TIMEOUT_MS,
      }),
      DISTILL_TIMEOUT_MS,
    );
    return parseVerifyDecision(result.text, input);
  } catch (err) {
    return {
      decision: 'uncertain',
      proposals: [],
      trace: [],
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
    };
  }
}

function parseVerifyDecision(
  text: string,
  input: StructuredDistillInput,
): {
  decision: 'durable_preference' | 'not_durable' | 'uncertain';
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
  error?: string;
} {
  const empty = {
    decision: 'uncertain' as const,
    proposals: [] as DistilledCandidateProposal[],
    trace: [] as NonNullable<StructuredDistillResult['normalizeTrace']>,
  };
  try {
    let rawText = String(text || '').trim();
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) rawText = fenced[1].trim();
    const data = JSON.parse(rawText) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { ...empty, error: 'verify_unparsed' };
    const explicitEmpty =
      Array.isArray(data.candidates) && (data.candidates as unknown[]).length === 0 && data.decision == null && data.verdict == null;
    if (explicitEmpty) {
      return { decision: 'not_durable', proposals: [], trace: [] };
    }
    const decisionRaw = String(data.decision ?? data.verdict ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    let decision: 'durable_preference' | 'not_durable' | 'uncertain' = 'uncertain';
    if (
      decisionRaw === 'durable_preference' ||
      decisionRaw === 'durable' ||
      decisionRaw === 'true' ||
      decisionRaw === 'preference'
    ) {
      decision = 'durable_preference';
    } else if (
      decisionRaw === 'not_durable' ||
      decisionRaw === 'notdurable' ||
      decisionRaw === 'false' ||
      decisionRaw === 'temporary' ||
      decisionRaw === 'other_person'
    ) {
      decision = 'not_durable';
    }
    if (decision !== 'durable_preference') {
      return { decision, proposals: [], trace: [] };
    }
    const candidateRaw =
      data.candidate && typeof data.candidate === 'object'
        ? (data.candidate as RawModelCandidate)
        : data.title || data.text
          ? (data as RawModelCandidate)
          : {
              title: input.text.slice(0, 40),
              text: input.text.slice(0, 400),
              category: 'preference',
              eventType: 'preference_observed',
              temporary: false,
              risk: 'low',
              scope: 'general',
            };
    const parsed = parseAndNormalizeModelJson(JSON.stringify(candidateRaw), input.sourceKind);
    let proposals = parsed.proposals.map((row) => attachSource(input, { ...row, tags: [...(row.tags || []), 'distill:verify'] }));
    if (!proposals.length) {
      const fallback = normalizeModelCandidate(
        {
          title: input.text.slice(0, 40),
          text: input.text.slice(0, 400),
          category: 'preference',
          eventType: 'preference_observed',
          temporary: false,
          risk: 'low',
          scope: 'general',
        },
        input.sourceKind,
      );
      if (fallback.ok && fallback.proposal) {
        proposals = [attachSource(input, { ...fallback.proposal, tags: [...(fallback.proposal.tags || []), 'distill:verify'] })];
      }
    }
    return { decision, proposals, trace: parsed.trace };
  } catch {
    return { ...empty, error: 'verify_unparsed' };
  }
}

function parseAndNormalizeModelJson(
  text: string,
  sourceKind: string,
): {
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
  parsed: boolean;
  explicitEmpty: boolean;
} {
  const trace: NonNullable<StructuredDistillResult['normalizeTrace']> = [];
  const proposals: DistilledCandidateProposal[] = [];
  try {
    let rawText = String(text || '').trim();
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) rawText = fenced[1].trim();
    const data = JSON.parse(rawText) as unknown;
    const explicitEmpty =
      !!data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Array.isArray((data as { candidates?: unknown }).candidates) &&
      ((data as { candidates: unknown[] }).candidates.length === 0);
    const nestedCandidate =
      data && typeof data === 'object' && !Array.isArray(data)
        ? ((data as { candidate?: unknown; preference?: unknown }).candidate ??
          (data as { preference?: unknown }).preference)
        : undefined;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { candidates?: unknown }).candidates)
        ? (data as { candidates: unknown[] }).candidates
        : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
          ? (data as { items: unknown[] }).items
          : nestedCandidate && typeof nestedCandidate === 'object'
            ? [nestedCandidate]
            : data && typeof data === 'object' && !Array.isArray(data) && ((data as { title?: unknown }).title || (data as { text?: unknown }).text)
              ? [data]
            : [];
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const norm = normalizeModelCandidate(row as RawModelCandidate, sourceKind);
      trace.push({
        raw: norm.rawSnapshot,
        ...(norm.normalized ? { normalized: norm.normalized } : {}),
        ok: norm.ok,
        ...(norm.reason ? { reason: norm.reason } : {}),
      });
      if (norm.ok && norm.proposal) proposals.push(norm.proposal);
    }
    return { proposals, trace, parsed: true, explicitEmpty };
  } catch {
    return { proposals: [], trace, parsed: false, explicitEmpty: false };
  }
}

function attemptFromParsed(
  parsed: ReturnType<typeof parseAndNormalizeModelJson>,
  input: StructuredDistillInput,
): ModelDistillAttempt {
  if (parsed.proposals.length) {
    return {
      proposals: parsed.proposals.slice(0, 3).map((row) => attachSource(input, row)),
      trace: parsed.trace,
    };
  }
  const emptyKind: DistillEmptyKind = !parsed.parsed ? 'technical' : parsed.explicitEmpty ? 'explicit' : 'unnormalized';
  return {
    proposals: [],
    trace: parsed.trace,
    error: parsed.parsed ? 'empty_or_unnormalized_model_json' : 'unparsed_model_json',
    emptyKind,
  };
}

function shouldVerifyPreference(sourceKind: string): boolean {
  return sourceKind === 'conversation' || sourceKind === 'task_requirement';
}

function gateExistingDetails(input: StructuredDistillInput): string[] {
  return (input.existingEvents || [])
    .filter((e) => e.confidence === 'confirmed' || e.confidence === 'candidate')
    .filter((e) => e.type !== 'asset_added')
    .flatMap((e) => [e.payload.title, e.payload.detail]);
}

function toGatedEvents(
  input: StructuredDistillInput,
  proposals: DistilledCandidateProposal[],
  mode: StructuredDistillResult['mode'],
  normalizeTrace?: StructuredDistillResult['normalizeTrace'],
): StructuredDistillResult {
  const gated = gateDistilledBatch({
    proposals,
    sourceText: input.text,
    existingDetails: gateExistingDetails(input),
    mode: mode === 'model' ? 'model' : 'contract',
  });
  return {
    events: gated.accepted.map((p) => proposalToEvent(p, input, mode)),
    discarded: gated.discarded,
    mode,
    ...(normalizeTrace ? { normalizeTrace } : {}),
  };
}

/** 主入口：蒸馏 → 归一 → 质量门 → GrowthEvent 候选（未 confirm）。 */
export async function structuredDistillToEvents(
  input: StructuredDistillInput,
): Promise<StructuredDistillResult> {
  let mode: StructuredDistillResult['mode'] = 'contract';
  let proposals = contractDistillProposals(input);
  let normalizeTrace: StructuredDistillResult['normalizeTrace'];

  if (input.chatComplete && input.model) {
    let fromModel = await modelDistillProposals(input);
    if (!fromModel?.proposals.length) {
      const kind = fromModel?.emptyKind;
      if (kind === 'technical' || kind === 'unnormalized' || !fromModel) {
        const repaired = await modelDistillRepair(input);
        if (repaired?.proposals.length) fromModel = repaired;
        else if (repaired && (kind === 'technical' || repaired.emptyKind === 'technical')) {
          fromModel = repaired;
        }
      }
    }
    if (!fromModel?.proposals.length && shouldVerifyPreference(input.sourceKind)) {
      const verified = await modelDistillVerify(input);
      if (verified?.decision === 'durable_preference' && verified.proposals.length > 0) {
        fromModel = {
          proposals: verified.proposals,
          trace: verified.trace,
        };
      } else if (verified?.decision === 'not_durable') {
        return {
          events: [],
          discarded: [{ reason: 'verified_not_durable', title: 'no_durable_subject_proposal' }],
          mode: 'model',
          emptyKind: 'verified_not_durable',
          ...(verified.trace.length ? { normalizeTrace: verified.trace } : {}),
        };
      } else {
        return {
          events: [],
          discarded: [
            {
              reason: verified?.error || fromModel?.error || 'model_unreliable',
              title: 'no_reliable_subject_proposal',
            },
          ],
          mode: 'model',
          unreliable: true,
          emptyKind: verified?.decision === 'uncertain' ? 'verified_uncertain' : fromModel?.emptyKind || 'technical',
          ...(verified?.trace.length ? { normalizeTrace: verified.trace } : fromModel?.trace ? { normalizeTrace: fromModel.trace } : {}),
        };
      }
    }
    if (fromModel && fromModel.proposals.length > 0) {
      proposals = fromModel.proposals;
      normalizeTrace = fromModel.trace;
      mode = 'model';
    } else {
      const emptyKind = fromModel?.emptyKind === 'technical' || fromModel?.emptyKind === 'unnormalized' || fromModel?.emptyKind === 'explicit'
        ? fromModel.emptyKind
        : 'explicit';
      const technical = emptyKind === 'technical' || emptyKind === 'unnormalized';
      return {
        events: [],
        discarded: [
          {
            reason: fromModel?.error || 'model_empty',
            title: 'no_reliable_subject_proposal',
          },
        ],
        mode: 'model',
        emptyKind,
        ...(technical ? { unreliable: true } : {}),
        ...(fromModel?.trace ? { normalizeTrace: fromModel.trace } : {}),
      };
    }
  }

  let gated = toGatedEvents(input, proposals, mode, normalizeTrace);
  if (mode === 'model' && gated.events.length === 0 && shouldVerifyPreference(input.sourceKind)) {
    const verified = await modelDistillVerify(input);
    if (verified?.decision === 'durable_preference' && verified.proposals.length > 0) {
      gated = toGatedEvents(input, verified.proposals, mode, verified.trace);
      if (gated.events.length > 0) return gated;
    }
    if (verified?.decision === 'not_durable') {
      return {
        events: [],
        discarded: [{ reason: 'verified_not_durable', title: 'no_durable_subject_proposal' }],
        mode: 'model',
        emptyKind: 'verified_not_durable',
      };
    }
    const gateFailed = gated.discarded.some((d) => d.reason === 'not_grounded' || d.reason === 'unknown_category');
    return {
      events: [],
      discarded: gated.discarded,
      mode: 'model',
      ...(gateFailed || verified?.decision === 'uncertain' ? { unreliable: true } : {}),
      ...(normalizeTrace ? { normalizeTrace } : {}),
    };
  }

  return gated;
}
