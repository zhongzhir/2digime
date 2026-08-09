/**
 * B 本地机会匹配 — 不把完整 Subject 交给 A；仅用本包私有事实判断。
 * 优先复用主体已配置模型做语义判断；不可用时保守启发式 fallback。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import { collectInactiveEventIds } from '../subject-core/derive-all';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { SignalPayload, SignalResponsePayload, MatchVerdict } from './signal';
import { enrichSignalPayload } from './signal-derive';

const BOUNDARY_MARKERS = ['不参赛', '拒绝联合', '不对外合作', 'boundary:no_collab', '不参与合作'];

export interface OpportunityMatchOptions {
  /** 测试注入；默认走 subject.completeSemanticJson / distill 模型 */
  chatComplete?: ChatCompleteFn | null;
  forceHeuristic?: boolean;
}

export interface LocalMatchContext {
  displayName: string;
  identityDescription: string;
  growth: Array<{
    type: string;
    confidence: 'confirmed' | 'candidate';
    title: string;
    detail: string;
    tags: string[];
  }>;
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
        (event.source.kind === 'owner_direct' && event.type === 'identity_clarified'),
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

  return {
    displayName: pkg.identity.displayName,
    identityDescription: pkg.identity.description || '',
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
    if (parsed.verdict !== 'potential_match' && parsed.verdict !== 'no_match') return null;
    return {
      verdict: parsed.verdict,
      matchKind: parsed.matchKind === 'shared_goal' ? 'shared_goal' : 'complementary',
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
): Promise<{ verdict: MatchVerdict; matchKind: 'complementary' | 'shared_goal' } | null> {
  const system =
    '你是 Digital Me 的本地合作机会判断器。只判断双方是否存在具体、可行动的能力互补或共同合作目标。主题词相似但没有合作连接时必须 no_match；不得为了提高召回而默认匹配。主体上下文是本地私有资料，只用于判断，禁止在输出中复述。不要依赖“提供”“可以”等固定措辞。只输出 JSON：{"verdict":"potential_match"|"no_match","matchKind":"complementary"|"shared_goal"}';
  const user = `对方合作意图：\n${JSON.stringify({
    intent: signal.intent,
    seeking: signal.seeking,
    offering: signal.offering,
    constraints: signal.constraints || [],
  })}\n\n本方权威上下文（个人简介 / 自我说明 / 有效成长要点）：\n${JSON.stringify({
    displayName: context.displayName,
    identityDescription: context.identityDescription,
    growth: context.growth.slice(-30),
  })}`;

  if (options.chatComplete) {
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
      return parseSemanticDecision(result.text);
    } catch {
      return null;
    }
  }

  const raw = await runtime.subject.completeSemanticJson(system, user);
  return parseSemanticDecision(raw);
}

/** 模型不可用时的保守 fallback；完整自然意图 + 简介仍参与判断。 */
function fallbackMatch(context: LocalMatchContext, signal: SignalPayload): boolean {
  const local = contextBlob(context);
  const peer = [signal.intent, ...(signal.seeking || []), ...(signal.offering || [])].join('\n');
  const localHasFinance = hasAny(local, ['金融', '投资', 'Aivestor', '应用场景', '理财', '财富管理', '投研']);
  const localHasAgent = hasAny(local, ['Agent', 'Digital Me', '智能体', '数字之我', '数字分身']);
  const localWantsCollaboration = hasAny(local, [
    '合作',
    '协作',
    '联合',
    '参赛',
    '赛事',
    '比赛',
    '寻找',
    '想找',
    '伙伴',
    '一起',
    '升级',
    '希望',
  ]);
  const peerHasFinance = hasAny(peer, ['金融', '投资', 'Aivestor', '应用场景', '理财', '财富管理', '投研']);
  const peerHasAgent = hasAny(peer, ['Agent', 'Digital Me', '智能体', '数字之我', '数字分身']);
  const peerWantsCollaboration = hasAny(peer, [
    '合作',
    '协作',
    '联合',
    '参赛',
    '赛事',
    '比赛',
    '寻找',
    '想找',
    '伙伴',
    '一起',
    '希望',
    '共同',
  ]);
  const peerHasContest = hasAny(peer, ['参赛', '赛事', '比赛']);
  const localHasContest = hasAny(local, ['参赛', '赛事', '比赛', '联合']);

  if (!(localWantsCollaboration && peerWantsCollaboration)) return false;
  return (
    (localHasFinance && peerHasAgent) ||
    (localHasAgent && peerHasFinance) ||
    (localHasFinance && localHasAgent && peerHasFinance && peerHasAgent) ||
    (localHasFinance && peerHasFinance && peerHasContest && localHasContest) ||
    (localHasAgent && peerHasAgent && peerHasContest && localHasContest)
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

  if (hasAny(local, BOUNDARY_MARKERS)) {
    return { verdict: 'no_match', response: { verdict: 'no_match' } };
  }

  const semantic = options.forceHeuristic
    ? null
    : await semanticMatch(runtime, enriched, context, options);
  const verdict =
    semantic?.verdict ?? (fallbackMatch(context, enriched) ? 'potential_match' : 'no_match');
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
