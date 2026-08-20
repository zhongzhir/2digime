/**
 * B 本地机会匹配 — 不把完整 Subject 交给 A；仅用本包私有事实判断。
 * 优先复用主体已配置 distill 模型做语义判断；不可用/不可解析时再保守 fallback。
 * Fallback 基于双方文本实质重合，不依赖「提供/可以」或领域关键词白名单。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import { collectInactiveEventIds } from '../subject-core/derive-all';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { SignalPayload, SignalResponsePayload, MatchVerdict } from './signal';
import { enrichSignalPayload } from './signal-derive';

const BOUNDARY_MARKERS = ['不参赛', '拒绝联合', '不对外合作', 'boundary:no_collab', '不参与合作'];

/** 功能词：不参与重合计分（不是领域白名单）。 */
const OVERLAP_STOP = new Set([
  '我们',
  '你们',
  '他们',
  '一个',
  '以及',
  '或者',
  '可以',
  '相关',
  '进行',
  '正在',
  '推进',
  '拥有',
  '获得',
  '进一步',
  '愿意',
  '考虑',
  '双方',
  '当前',
  '需求',
  '供给',
  '这个',
  '那个',
  '什么',
  '怎么',
  '如果',
  '因为',
  '所以',
  '然后',
  '已经',
  '不是',
  '没有',
  '自己',
  '对方',
  '本地',
  '主体',
]);

export interface OpportunityMatchOptions {
  /** 仅测试注入；生产路径必须走 subject.completeSemanticJson */
  chatComplete?: ChatCompleteFn | null;
  forceHeuristic?: boolean;
}

export interface LocalMatchContext {
  displayName: string;
  identityDescription: string;
  selfMaterialCount: number;
  growth: Array<{
    type: string;
    confidence: 'confirmed' | 'candidate';
    title: string;
    detail: string;
    tags: string[];
  }>;
}

export interface OpportunityMatchDiagnostics {
  distillEnabled: boolean;
  modelCalled: boolean;
  modelError: string | null;
  parseOk: boolean | null;
  semanticVerdict: MatchVerdict | null;
  usedFallback: boolean;
  identityDescriptionChars: number;
  growthCount: number;
  selfMaterialCount: number;
  finalVerdict: MatchVerdict;
}

let lastDiagnostics: OpportunityMatchDiagnostics | null = null;

export function getLastOpportunityMatchDiagnostics(): OpportunityMatchDiagnostics | null {
  return lastDiagnostics;
}

export async function buildLocalMatchContext(runtime: DigitalMeRuntime): Promise<LocalMatchContext> {
  const pkg = runtime.subject.requireActive();
  const events = await runtime.subject.listGrowthEvents().catch(() => []);
  const inactive = new Set(collectInactiveEventIds(events));
  const growth = events
    .filter((event) => !inactive.has(event.id))
    .filter(
      (event) =>
        event.confidence === 'confirmed' ||
        event.source.kind === 'owner_direct' ||
        (event.payload.tags || []).some((tag) => /source:initial_self|identity/i.test(tag)),
    )
    .filter((event) => !/SECRET_|私密财务/.test(`${event.payload.title || ''}\n${event.payload.detail || ''}`))
    .slice(-60)
    .map((event) => ({
      type: event.type,
      confidence: event.confidence,
      title: event.payload.title || '',
      detail: event.payload.detail || '',
      tags: event.payload.tags || [],
    }));

  let identityDescription = (pkg.identity.description || '').trim();
  let selfMaterialCount = 0;
  try {
    const materialsDir = path.join(pkg.rootDir, 'materials');
    const names = (await fs.readdir(materialsDir))
      .filter((name) => name.startsWith('self_') && name.endsWith('.txt'))
      .sort();
    selfMaterialCount = names.length;
    if (!identityDescription) {
      for (let i = names.length - 1; i >= 0; i -= 1) {
        try {
          const text = (await fs.readFile(path.join(materialsDir, names[i]!), 'utf8')).trim();
          if (text) {
            identityDescription = text.slice(0, 2000);
            break;
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* no materials */
  }

  return {
    displayName: pkg.identity.displayName,
    identityDescription,
    selfMaterialCount,
    growth,
  };
}

export function contextBlob(context: LocalMatchContext): string {
  return [
    context.displayName,
    context.identityDescription ? `个人简介：${context.identityDescription}` : '',
    ...context.growth.flatMap((event) => [event.title, event.detail, event.tags.join(' ')]),
  ]
    .filter(Boolean)
    .join('\n');
}

function hasAny(text: string, needles: string[]): boolean {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function extractSubstantiveTokens(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.match(/[a-z][a-z0-9_+.-]{2,}/g) || []) {
    out.add(m);
  }
  for (const run of text.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    if (run.length <= 6 && !OVERLAP_STOP.has(run)) out.add(run);
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!OVERLAP_STOP.has(bigram)) out.add(bigram);
    }
  }
  return [...out];
}

function parseSemanticDecision(raw: string | null): {
  verdict: MatchVerdict;
  matchKind: 'complementary' | 'shared_goal';
} | null {
  if (!raw) return null;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const rawVerdict = String(parsed.verdict || parsed.decision || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    let verdict: MatchVerdict | null = null;
    if (rawVerdict === 'potential_match' || rawVerdict === 'match' || rawVerdict === 'yes') {
      verdict = 'potential_match';
    } else if (rawVerdict === 'no_match' || rawVerdict === 'nomatch' || rawVerdict === 'no') {
      verdict = 'no_match';
    }
    if (!verdict) return null;
    const kindRaw = String(parsed.matchKind || parsed.match_kind || '').toLowerCase();
    return {
      verdict,
      matchKind: kindRaw.includes('shared') ? 'shared_goal' : 'complementary',
    };
  } catch {
    return null;
  }
}

async function semanticMatch(
  runtime: DigitalMeRuntime,
  signal: SignalPayload,
  context: LocalMatchContext,
  options: OpportunityMatchOptions,
  diag: OpportunityMatchDiagnostics,
): Promise<{ verdict: MatchVerdict; matchKind: 'complementary' | 'shared_goal' } | null> {
  const system =
    '你是 Digital Me 的本地合作机会判断器。根据对方合作意图与本方个人简介/成长要点，判断是否存在具体可行动的能力互补或共同合作目标。主题词偶然相似但无合作连接时必须 no_match。本方上下文是本地私有资料，禁止在输出中复述细节。不要依赖“提供”“可以”等固定措辞。只输出 JSON：{"verdict":"potential_match"|"no_match","matchKind":"complementary"|"shared_goal"}';
  const user = `对方合作意图：\n${JSON.stringify({
    intent: signal.intent,
    seeking: signal.seeking,
    offering: signal.offering,
    constraints: signal.constraints || [],
  })}\n\n本方权威上下文：\n${JSON.stringify({
    displayName: context.displayName,
    identityDescription: context.identityDescription,
    growth: context.growth.slice(-30),
  })}`;

  if (options.chatComplete) {
    diag.modelCalled = true;
    try {
      const distill = runtime.subject.getDistillModelRuntime?.();
      const result = await options.chatComplete({
        baseUrl: distill?.model.baseUrl || 'http://127.0.0.1',
        model: distill?.model.model || 'test',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        maxTokens: 500,
        responseFormat: { type: 'json_object' },
      });
      const parsed = parseSemanticDecision(result.text);
      diag.parseOk = !!parsed;
      return parsed;
    } catch (error) {
      diag.modelError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  diag.distillEnabled = !!runtime.subject.getDistillModelRuntime?.()?.enabled;
  if (!diag.distillEnabled && !options.chatComplete) {
    return null;
  }
  diag.modelCalled = true;
  const raw = await runtime.subject.completeSemanticJson(system, user);
  const modelErr =
    typeof runtime.subject.getLastSemanticJsonError === 'function'
      ? runtime.subject.getLastSemanticJsonError()
      : null;
  if (modelErr) diag.modelError = modelErr;
  const parsed = parseSemanticDecision(raw);
  diag.parseOk = raw == null ? null : !!parsed;
  return parsed;
}

/**
 * 模型不可用时的保守 fallback：双方文本实质重合即可，不要求本方也写出「寻找合作」套话。
 * 无关主题（重合不足）保持 no_match。
 */
function fallbackMatch(context: LocalMatchContext, signal: SignalPayload): boolean {
  const local = contextBlob(context);
  const peer = String(signal.intent || '').trim();
  if (!local.trim() || peer.length < 8) return false;
  if (hasAny(local, BOUNDARY_MARKERS)) return false;

  const localTokens = extractSubstantiveTokens(local).filter((t) => !OVERLAP_STOP.has(t));
  const peerTokens = extractSubstantiveTokens(peer).filter((t) => !OVERLAP_STOP.has(t));
  if (!localTokens.length || !peerTokens.length) return false;

  const shared: string[] = [];
  for (const token of localTokens) {
    if (
      peerTokens.some(
        (peerToken) =>
          peerToken === token ||
          (token.length >= 4 && peerToken.includes(token)) ||
          (peerToken.length >= 4 && token.includes(peerToken)),
      )
    ) {
      shared.push(token);
    }
  }
  const uniqueShared = [...new Set(shared)];
  const strong = uniqueShared.filter((t) => t.length >= 4 || /[a-z]/i.test(t));
  // 至少两个实质记号重合，或一个较强拉丁/长词 + 一个辅助重合
  return strong.length >= 2 || (strong.length >= 1 && uniqueShared.length >= 3);
}

function contextIsUsable(context: LocalMatchContext): boolean {
  return (
    context.identityDescription.trim().length >= 8 ||
    context.growth.some((g) => `${g.title}${g.detail}`.trim().length >= 8)
  );
}

export async function matchSignalLocally(
  runtime: DigitalMeRuntime,
  signal: SignalPayload,
  options: OpportunityMatchOptions = {},
): Promise<{ verdict: MatchVerdict; response: Omit<SignalResponsePayload, 'signalEnvelopeId'> }> {
  const enriched = enrichSignalPayload(signal);
  const context = await buildLocalMatchContext(runtime);
  const local = contextBlob(context);
  const distill = runtime.subject.getDistillModelRuntime?.() || null;

  const diag: OpportunityMatchDiagnostics = {
    distillEnabled: !!distill?.enabled,
    modelCalled: false,
    modelError: null,
    parseOk: null,
    semanticVerdict: null,
    usedFallback: false,
    identityDescriptionChars: context.identityDescription.length,
    growthCount: context.growth.length,
    selfMaterialCount: context.selfMaterialCount,
    finalVerdict: 'no_match',
  };

  if (hasAny(local, BOUNDARY_MARKERS)) {
    diag.finalVerdict = 'no_match';
    lastDiagnostics = diag;
    return { verdict: 'no_match', response: { verdict: 'no_match' } };
  }

  let semantic = options.forceHeuristic
    ? null
    : await semanticMatch(runtime, enriched, context, options, diag);
  diag.semanticVerdict = semantic?.verdict ?? null;

  // 模型在「本方上下文实质为空」时给出的 no_match 不可信：视为未判定，交 fallback
  if (semantic?.verdict === 'no_match' && !contextIsUsable(context)) {
    semantic = null;
    diag.parseOk = false;
    diag.modelError = diag.modelError || 'semantic_no_match_with_empty_local_context';
  }

  let verdict: MatchVerdict;
  if (semantic?.verdict) {
    verdict = semantic.verdict;
  } else {
    diag.usedFallback = true;
    verdict = fallbackMatch(context, enriched) ? 'potential_match' : 'no_match';
  }
  diag.finalVerdict = verdict;
  lastDiagnostics = diag;

  if (process.env.DIGITALME_DEBUG_OPPORTUNITY_MATCH === '1') {
    console.info('[opportunity-match]', {
      distillEnabled: diag.distillEnabled,
      modelCalled: diag.modelCalled,
      modelError: diag.modelError,
      parseOk: diag.parseOk,
      semanticVerdict: diag.semanticVerdict,
      usedFallback: diag.usedFallback,
      identityDescriptionChars: diag.identityDescriptionChars,
      growthCount: diag.growthCount,
      selfMaterialCount: diag.selfMaterialCount,
      finalVerdict: diag.finalVerdict,
    });
  }

  if (verdict === 'no_match') {
    return { verdict: 'no_match', response: { verdict: 'no_match' } };
  }

  return {
    verdict: 'potential_match',
    response: {
      verdict: 'potential_match',
      whyWorthKnowing:
        semantic?.matchKind === 'shared_goal'
          ? '双方当前关注方向与合作目标存在交集。'
          : '双方当前需求与能力可能形成互补。',
      peerMayNeed: (enriched.offering || []).slice(0, 2),
      youMayOffer: (enriched.seeking || []).slice(0, 2),
    },
  };
}
