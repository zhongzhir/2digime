/**
 * B 本地机会匹配 — 不把完整 Subject 交给 A；仅用本包私有事实判断。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { SignalPayload, SignalResponsePayload, MatchVerdict } from './signal';

function blobFromRuntimeFacts(runtime: DigitalMeRuntime): string {
  try {
    const pkg = runtime.subject.requireActive();
    const parts: string[] = [pkg.identity.displayName, pkg.identity.description || ''];
    return parts.join('\n');
  } catch {
    return '';
  }
}

async function growthBlob(runtime: DigitalMeRuntime): Promise<string> {
  try {
    const events = await runtime.subject.listGrowthEvents();
    return events
      .map((e) => `${e.payload.title || ''}\n${e.payload.detail || ''}\n${(e.payload.tags || []).join(' ')}`)
      .join('\n');
  } catch {
    return '';
  }
}

function hasAny(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}

/**
 * 规则化最小匹配（Demo）：需求互补且不触碰明显边界。
 */
export async function matchSignalLocally(
  runtime: DigitalMeRuntime,
  signal: SignalPayload,
): Promise<{ verdict: MatchVerdict; response: Omit<SignalResponsePayload, 'signalEnvelopeId'> }> {
  const local = `${blobFromRuntimeFacts(runtime)}\n${await growthBlob(runtime)}`;

  if (hasAny(local, ['不参赛', '拒绝联合', '不对外合作', 'boundary:no_collab'])) {
    return {
      verdict: 'no_match',
      response: { verdict: 'no_match' },
    };
  }

  const seeking = signal.seeking || [];
  const offering = signal.offering || [];

  const canOfferWhatTheySeek = seeking.some((s) => {
    if (/金融|投资|应用场景|aivestor/i.test(s)) {
      return hasAny(local, ['金融', '投资', 'Aivestor', '应用', '场景']);
    }
    if (/agent|digital me|技术/i.test(s)) {
      return hasAny(local, ['Agent', 'Digital Me', '技术', '能力']);
    }
    return hasAny(local, [s]);
  });

  const needWhatTheyOffer = offering.some((o) => {
    if (/agent|digital me|技术/i.test(o)) {
      return hasAny(local, ['升级', 'Agent', '技术', '联合', '参赛', '寻找']);
    }
    if (/金融|场景/i.test(o)) {
      return hasAny(local, ['金融', '场景', '寻找']);
    }
    return hasAny(local, [o]);
  });

  // 也允许：对方 seeking 命中本地供给，且对方 offering 命中本地需求（关键词在自述里）
  const localSeeksTech = hasAny(local, ['寻找', '需要', '希望', '升级']) &&
    hasAny(local, ['Agent', 'Digital Me', '技术']);
  const localOffersFinance =
    hasAny(local, ['金融', '投资', 'Aivestor', '应用']) &&
    (hasAny(local, ['场景', '项目', '成熟']) || hasAny(local, ['Aivestor']));

  const peerSeeksFinance = seeking.some((s) => /金融|投资|场景|应用/i.test(s));
  const peerOffersTech = offering.some((o) => /agent|digital me|技术/i.test(o));

  const complementary =
    (peerSeeksFinance && localOffersFinance && peerOffersTech && localSeeksTech) ||
    (canOfferWhatTheySeek && needWhatTheyOffer) ||
    (peerSeeksFinance && localOffersFinance && peerOffersTech);

  if (!complementary) {
    return {
      verdict: 'no_match',
      response: { verdict: 'no_match' },
    };
  }

  return {
    verdict: 'potential_match',
    response: {
      verdict: 'potential_match',
      whyWorthKnowing: '双方当前需求存在互补',
      peerMayNeed: peerOffersTech
        ? ['Agent / Digital Me 技术能力']
        : offering.slice(0, 2),
      youMayOffer: peerSeeksFinance
        ? ['金融应用场景']
        : seeking.slice(0, 2),
    },
  };
}
