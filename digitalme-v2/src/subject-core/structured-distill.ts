/**
 * 结构化蒸馏 — 产出带完整字段的候选提案，再经质量门进入 GrowthEvent。
 * 默认确定性合同蒸馏（可测）；可选接入真模型 chat，失败回退合同蒸馏。
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
  enrichGrowthTags,
  signalTag,
  type GrowthProductCategory,
} from './growth-signal';
import type { ChatCompleteOptions, ChatCompleteResult } from '../infrastructure/model-http';

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
  const category = (catTag?.slice('category:'.length) || 'temporary_context') as GrowthProductCategory;
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
    risk: tags.includes('needs_confirmation') || e.type === 'boundary_updated' ? 'high' : 'low',
    maybeConflict,
    modelConfidenceSummary: `contract:${e.type}`,
    eventType: e.type as DistilledCandidateProposal['eventType'],
    tags,
  };
}

function proposalToEvent(
  p: DistilledCandidateProposal,
  input: StructuredDistillInput,
): GrowthEvent {
  const authority = authorityFromEvents(input.existingEvents || []);
  let tags = [...(p.tags || [])];
  if (!tags.some((t) => t.startsWith('category:'))) tags.push(categoryTag(p.category));
  if (p.temporary && p.expiresAt && !tags.some((t) => t.startsWith('expiresAt:'))) {
    tags.push(`expiresAt:${p.expiresAt}`);
  }
  if (p.maybeConflict && !tags.includes('conflict')) tags.push('conflict', 'needs_confirmation');
  if (p.sourceRef && !tags.some((t) => t.startsWith('sourceRef:'))) {
    tags.push(`sourceRef:${p.sourceRef}`);
  }
  tags.push(`scope:${p.scope}`, `risk:${p.risk}`);
  tags.push(`model_reason:${p.modelConfidenceSummary.slice(0, 80)}`);

  const enriched = enrichGrowthTags({
    type: p.eventType,
    sourceKind: input.sourceKind,
    text: `${p.title} ${p.text}`,
    tags,
    authority,
  });
  tags = enriched.tags;
  if (!tags.some((t) => t.startsWith('signal:'))) tags.push(signalTag(enriched.signal));
  if (enriched.adopt === 'silent_adopt' && !tags.includes('silent_ok')) tags.push('silent_ok');

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

async function modelDistillProposals(
  input: StructuredDistillInput,
): Promise<DistilledCandidateProposal[] | null> {
  if (!input.chatComplete || !input.model) return null;
  const system = [
    '你从用户输入中提炼 1 到 3 条成长候选。只输出 JSON 数组。',
    '每项字段: title, text, category, scope, temporary, risk, maybeConflict, modelConfidenceSummary, eventType。',
    'category 仅可为: identity_fact,goal,boundary,principle,preference,working_method,capability_experience,temporary_context,external_claim。',
    '不得把外部资料写成用户观点；不得推断性格/立场/敏感属性；不得把一次性要求写成长期偏好。',
    '你不能决定确认或覆盖旧内容。',
  ].join('\n');
  try {
    const result = await input.chatComplete({
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            sourceKind: input.sourceKind,
            text: input.text.slice(0, 4000),
          }),
        },
      ],
      temperature: 0,
      maxTokens: 800,
      responseFormat: { type: 'json_object' },
      timeoutMs: 60_000,
    });
    const parsed = parseModelJson(result.text);
    if (!parsed.length) return null;
    return parsed.slice(0, 3).map((row) => ({
      ...row,
      sourceKind: input.sourceKind,
      ...(input.materialRef ? { sourceRef: input.materialRef } : {}),
    }));
  } catch {
    return null;
  }
}

function parseModelJson(text: string): DistilledCandidateProposal[] {
  try {
    const data = JSON.parse(text) as unknown;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { candidates?: unknown }).candidates)
        ? (data as { candidates: unknown[] }).candidates
        : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
          ? (data as { items: unknown[] }).items
          : [];
    const out: DistilledCandidateProposal[] = [];
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = String(r.title || '').trim();
      const body = String(r.text || r.detail || '').trim();
      if (!title || !body) continue;
      out.push({
        title,
        text: body,
        category: (String(r.category || 'temporary_context') as GrowthProductCategory),
        sourceKind: 'conversation',
        scope: (String(r.scope || 'general') as DistilledCandidateProposal['scope']),
        temporary: Boolean(r.temporary),
        risk: (String(r.risk || 'low') as DistilledCandidateProposal['risk']),
        maybeConflict: Boolean(r.maybeConflict),
        modelConfidenceSummary: String(r.modelConfidenceSummary || 'model').slice(0, 120),
        eventType: (String(r.eventType || 'knowledge_gap_noted') as DistilledCandidateProposal['eventType']),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 主入口：蒸馏 → 质量门 → GrowthEvent 候选（未 confirm）。 */
export async function structuredDistillToEvents(
  input: StructuredDistillInput,
): Promise<StructuredDistillResult> {
  let mode: StructuredDistillResult['mode'] = 'contract';
  let proposals = contractDistillProposals(input);
  if (input.chatComplete && input.model) {
    const fromModel = await modelDistillProposals(input);
    if (fromModel && fromModel.length > 0) {
      proposals = fromModel;
      mode = 'model';
    } else {
      mode = 'model_fallback_contract';
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

  return {
    events: gated.accepted.map((p) => proposalToEvent(p, input)),
    discarded: gated.discarded,
    mode,
  };
}
