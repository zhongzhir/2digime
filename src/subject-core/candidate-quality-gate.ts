/**
 * 蒸馏候选质量门 — 进入 GrowthEvent 前的确定性裁决。
 * 模型只提候选；本模块决定丢弃 / 放行（仍不直接 confirm）。
 */
import type { GrowthProductCategory } from './growth-signal';

export interface DistilledCandidateProposal {
  /** 自然语言内容 */
  text: string;
  title: string;
  category: GrowthProductCategory;
  sourceKind: string;
  sourceRef?: string;
  scope: 'general' | 'task' | 'artifact_type' | 'temporary';
  temporary: boolean;
  expiresAt?: string;
  risk: 'low' | 'medium' | 'high';
  maybeConflict: boolean;
  modelConfidenceSummary: string;
  /** 映射到 GrowthEvent.type */
  eventType:
    | 'preference_observed'
    | 'principle_stated'
    | 'goal_updated'
    | 'boundary_updated'
    | 'identity_clarified'
    | 'feedback_recorded'
    | 'asset_added'
    | 'knowledge_gap_noted';
  tags?: string[];
}

export type QualityGateVerdict = 'accept' | 'discard';

export interface QualityGateResult {
  verdict: QualityGateVerdict;
  reason: string;
  proposal?: DistilledCandidateProposal;
}

const SENSITIVE_INFER_RE =
  /性格内向|性格外向|政治立场|党派|宗教信仰|性取向|种族|民族仇恨|精神疾病诊断/;

const VAGUE_RE = /^(更好|优化一下|随便|看情况|尽量做好|更专业一点)[。.!！]?$/;

const OVERGENERALIZE_RE = /永远|永久|所有任务|任何时候|一律必须|永远不要/;

export function runCandidateQualityGate(input: {
  proposal: DistilledCandidateProposal;
  sourceText: string;
  existingDetails: string[];
  /** contract：合同蒸馏已来自原文，跳过严格接地；model：全门 */
  mode?: 'contract' | 'model';
}): QualityGateResult {
  const p = input.proposal;
  const src = input.sourceText || '';
  const mode = input.mode || 'contract';

  if (!src.trim()) {
    return { verdict: 'discard', reason: 'missing_source' };
  }
  if (!p.text.trim() || p.text.trim().length < 4) {
    return { verdict: 'discard', reason: 'empty_content' };
  }
  // 产品归因硬规则优先于接地检查
  if (
    p.category === 'external_claim' &&
    (p.eventType === 'preference_observed' ||
      p.eventType === 'identity_clarified' ||
      p.eventType === 'principle_stated')
  ) {
    return { verdict: 'discard', reason: 'external_as_user_opinion' };
  }
  if (p.sourceKind === 'imported_material' && p.category === 'preference') {
    return { verdict: 'discard', reason: 'material_as_preference' };
  }
  // 一次性任务要求 → 不得沉淀为长期偏好（须有明确一次性措辞，不能仅因来源是任务）
  if (
    /仅本次|只这一次|这次先|一次性|不要当成长期|不要记成习惯/.test(src) &&
    (p.category === 'preference' || p.category === 'working_method' || p.category === 'principle') &&
    !/以后这样|以后都|请记住|从今以后/.test(src) &&
    !p.temporary
  ) {
    return { verdict: 'discard', reason: 'one_shot_as_long_term' };
  }
  // 模型生成口吻当作用户事实
  if (/作为 AI|我建议你是|推断你的性格|你一定是/.test(p.text)) {
    return { verdict: 'discard', reason: 'model_as_user_fact' };
  }
  if (OVERGENERALIZE_RE.test(p.text) && !/以后这样|请记住/.test(src)) {
    return { verdict: 'discard', reason: 'overgeneralize' };
  }
  if (VAGUE_RE.test(p.text.trim())) {
    return { verdict: 'discard', reason: 'vague' };
  }
  if (SENSITIVE_INFER_RE.test(p.text) || SENSITIVE_INFER_RE.test(p.modelConfidenceSummary || '')) {
    return { verdict: 'discard', reason: 'sensitive_inference' };
  }
  // 真模型候选须可核对对应来源；合同蒸馏已从原文抽取，跳过严格接地
  if (mode === 'model' && !sourceGrounded(p.text, src) && !sourceGrounded(p.title, src)) {
    return { verdict: 'discard', reason: 'not_grounded' };
  }
  // 去重：与已有内容近义
  for (const prev of input.existingDetails) {
    if (nearDuplicate(p.text, prev) || nearDuplicate(p.title, prev)) {
      return { verdict: 'discard', reason: 'duplicate' };
    }
  }
  // 临时必须有 scope/expires
  if (p.temporary || p.category === 'temporary_context') {
    if (!p.expiresAt && p.scope === 'general') {
      return { verdict: 'discard', reason: 'temporary_without_scope' };
    }
  }

  return { verdict: 'accept', reason: 'ok', proposal: normalizeProposal(p) };
}

function normalizeProposal(p: DistilledCandidateProposal): DistilledCandidateProposal {
  const next = { ...p };
  if (next.temporary && !next.expiresAt) {
    next.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    next.scope = next.scope === 'general' ? 'temporary' : next.scope;
  }
  if (next.category === 'external_claim') {
    next.eventType = 'asset_added';
    next.risk = next.risk === 'low' ? 'medium' : next.risk;
  }
  return next;
}

function sourceGrounded(candidate: string, source: string): boolean {
  const c = candidate.toLowerCase();
  const s = source.toLowerCase();
  if (c.length >= 4 && s.includes(c.slice(0, Math.min(12, c.length)))) return true;
  const tokens = c.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  let hits = 0;
  for (const t of tokens.slice(0, 8)) {
    if (s.includes(t)) hits += 1;
  }
  if (hits >= 2 || (tokens.length === 1 && hits === 1)) return true;
  // 中文无空格：按双字窗口核对语义落点（避免模型近义改写被误杀）
  let biHits = 0;
  const biSeen = new Set<string>();
  for (let i = 0; i < c.length - 1; i += 1) {
    const bi = c.slice(i, i + 2);
    if (!/[\u4e00-\u9fff]{2}/.test(bi) || biSeen.has(bi)) continue;
    biSeen.add(bi);
    if (s.includes(bi)) biHits += 1;
    if (biHits >= 3) return true;
  }
  return false;
}

function nearDuplicate(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, '').toLowerCase();
  const y = b.replace(/\s+/g, '').toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.includes(x.slice(0, Math.min(16, x.length)))) return true;
  if (y.length >= 8 && x.includes(y.slice(0, Math.min(16, y.length)))) return true;
  return false;
}

/** 批量闸门：最多保留 3 条。 */
export function gateDistilledBatch(input: {
  proposals: DistilledCandidateProposal[];
  sourceText: string;
  existingDetails: string[];
  /** contract：合同蒸馏已来自原文，跳过严格接地；model：全门 */
  mode?: 'contract' | 'model';
}): { accepted: DistilledCandidateProposal[]; discarded: Array<{ reason: string; title: string }> } {
  const accepted: DistilledCandidateProposal[] = [];
  const discarded: Array<{ reason: string; title: string }> = [];
  const seen = [...input.existingDetails];
  const mode = input.mode || 'contract';
  for (const proposal of input.proposals.slice(0, 6)) {
    if (accepted.length >= 3) {
      discarded.push({ reason: 'over_quota', title: proposal.title });
      continue;
    }
    const r = runCandidateQualityGate({
      proposal,
      sourceText: input.sourceText,
      existingDetails: seen,
      mode,
    });
    if (r.verdict === 'accept' && r.proposal) {
      accepted.push(r.proposal);
      seen.push(r.proposal.text, r.proposal.title);
    } else {
      discarded.push({ reason: r.reason, title: proposal.title });
    }
  }
  return { accepted, discarded };
}
