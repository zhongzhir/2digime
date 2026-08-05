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
  /** 验收追溯：原始候选与归一结果（不上用户面） */
  normalizeTrace?: Array<{
    raw: Record<string, unknown>;
    normalized?: { category: string; eventType: string; mappedFrom: string };
    ok: boolean;
    reason?: string;
  }>;
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

async function modelDistillProposals(input: StructuredDistillInput): Promise<{
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
  error?: string;
} | null> {
  if (!input.chatComplete || !input.model) return null;
  const system = [
    '你从用户输入中提炼 1 到 3 条成长候选。只输出 JSON。',
    '可用字段: title, text, category, scope, temporary, risk, maybeConflict, modelConfidenceSummary, eventType。',
    'category 建议: preference, working_method, principle, boundary, goal, identity_fact, temporary_context, external_claim。',
    'text 尽量保留用户原词（如结论、篇幅、决策），不要改写成第三人称长句。',
    '不得把外部资料写成用户观点；不得推断性格/立场/敏感属性；不得把一次性要求写成长期偏好。',
    '你不能决定确认或覆盖旧内容；needs_confirmation 只是建议。',
  ].join('\n');
  const userContent = JSON.stringify({
    sourceKind: input.sourceKind,
    text: input.text.slice(0, 4000),
  });
  const attempt = async (useJsonFormat: boolean): Promise<ChatCompleteResult> =>
    input.chatComplete!({
      baseUrl: input.model!.baseUrl,
      ...(input.model!.apiKey ? { apiKey: input.model!.apiKey } : {}),
      model: input.model!.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      maxTokens: 800,
      ...(useJsonFormat ? { responseFormat: { type: 'json_object' as const } } : {}),
      timeoutMs: 60_000,
    });

  try {
    let result: ChatCompleteResult;
    try {
      result = await attempt(true);
    } catch (firstErr) {
      // 部分兼容端点不支持 json_object；再试一次无强制格式
      try {
        result = await attempt(false);
      } catch {
        return {
          proposals: [],
          trace: [],
          error: String(firstErr instanceof Error ? firstErr.message : firstErr).slice(0, 200),
        };
      }
    }
    const { proposals, trace } = parseAndNormalizeModelJson(result.text, input.sourceKind);
    if (!proposals.length) {
      return {
        proposals: [],
        trace,
        error: 'empty_or_unnormalized_model_json',
      };
    }
    return {
      proposals: proposals.slice(0, 3).map((row) => ({
        ...row,
        sourceKind: input.sourceKind,
        ...(input.materialRef ? { sourceRef: input.materialRef } : {}),
      })),
      trace,
    };
  } catch (err) {
    return {
      proposals: [],
      trace: [],
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
    };
  }
}

function parseAndNormalizeModelJson(
  text: string,
  sourceKind: string,
): {
  proposals: DistilledCandidateProposal[];
  trace: NonNullable<StructuredDistillResult['normalizeTrace']>;
} {
  const trace: NonNullable<StructuredDistillResult['normalizeTrace']> = [];
  const proposals: DistilledCandidateProposal[] = [];
  try {
    let rawText = String(text || '').trim();
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) rawText = fenced[1].trim();
    const data = JSON.parse(rawText) as unknown;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { candidates?: unknown }).candidates)
        ? (data as { candidates: unknown[] }).candidates
        : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
          ? (data as { items: unknown[] }).items
          : data && typeof data === 'object' && !Array.isArray(data)
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
  } catch {
    return { proposals: [], trace };
  }
  return { proposals, trace };
}

/** 主入口：蒸馏 → 归一 → 质量门 → GrowthEvent 候选（未 confirm）。 */
export async function structuredDistillToEvents(
  input: StructuredDistillInput,
): Promise<StructuredDistillResult> {
  let mode: StructuredDistillResult['mode'] = 'contract';
  let proposals = contractDistillProposals(input);
  let normalizeTrace: StructuredDistillResult['normalizeTrace'];

  if (input.chatComplete && input.model) {
    const fromModel = await modelDistillProposals(input);
    if (fromModel && fromModel.proposals.length > 0) {
      proposals = fromModel.proposals;
      normalizeTrace = fromModel.trace;
      mode = 'model';
    } else {
      mode = 'model_fallback_contract';
      normalizeTrace = fromModel?.trace || [];
      if (fromModel?.error) {
        normalizeTrace = [
          ...(normalizeTrace || []),
          { raw: { error: fromModel.error }, ok: false, reason: 'model_call_failed' },
        ];
      }
    }
  }

  const existingDetails = (input.existingEvents || [])
    .filter((e) => e.confidence === 'confirmed' || e.confidence === 'candidate')
    // 资料副本正文可能含整段原文，不得据此把合法提炼判为重复
    .filter((e) => e.type !== 'asset_added')
    .flatMap((e) => [e.payload.title, e.payload.detail]);

  const gated = gateDistilledBatch({
    proposals,
    sourceText: input.text,
    existingDetails,
    mode: mode === 'model' ? 'model' : 'contract',
  });

  // 真模型产出全部被质量门丢弃时，合同降级保证主路径仍有可审候选（低置信不得静默）
  if (mode === 'model' && gated.accepted.length === 0) {
    const contractProposals = contractDistillProposals(input);
    const fallback = gateDistilledBatch({
      proposals: contractProposals,
      sourceText: input.text,
      existingDetails,
      mode: 'contract',
    });
    return {
      events: fallback.accepted.map((p) => proposalToEvent(p, input, 'model_fallback_contract')),
      discarded: [...gated.discarded, ...fallback.discarded],
      mode: 'model_fallback_contract',
      ...(normalizeTrace ? { normalizeTrace } : {}),
    };
  }

  return {
    events: gated.accepted.map((p) => proposalToEvent(p, input, mode)),
    discarded: gated.discarded,
    mode,
    ...(normalizeTrace ? { normalizeTrace } : {}),
  };
}
