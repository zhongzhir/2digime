/**
 * 当前搜索的请求身份与可见结果合并。
 * 只守机械不变量：哪一次搜索、PRIMARY 不得被 ABOUT 覆盖、过期异步不得改当前 UI。
 */
import { randomBytes } from 'node:crypto';
import { normalizeCanonicalUrl } from './content-canonical';
import type { DiscoverCard, DiscoverView } from './content-discover';
import { hasPlayableAudioRepresentation, isSafePublicMediaUrl } from './content-media';

export type SearchFeedMode = 'personal' | 'intent';
export type ObjectFidelityKind = 'PRIMARY_CONTENT' | 'ABOUT_CONTENT' | 'UNRELATED';

export interface DiscoverUiScope {
  searchGenerationId: string;
  feedMode: SearchFeedMode;
}

export interface SeekCardSet {
  cards: DiscoverCard[];
  relatedCards: DiscoverCard[];
}

export function createSearchGenerationId(): string {
  return `sg_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function canonicalCardKey(card: Pick<DiscoverCard, 'itemId' | 'url'>): string {
  const url = String(card.url || '').trim();
  if (url) {
    try {
      return `url:${normalizeCanonicalUrl(url)}`;
    } catch {
      return `url:${url}`;
    }
  }
  const id = String(card.itemId || '').trim();
  return id ? `id:${id}` : '';
}

export function hasDirectMediaRepresentation(card: DiscoverCard): boolean {
  const type = String(card.contentType || '');
  if (type === 'image') {
    return !!(isSafePublicMediaUrl(card.thumbnailUrl) || isSafePublicMediaUrl(card.mediaUrl));
  }
  if (type === 'video') {
    return !!(
      isSafePublicMediaUrl(card.embedUrl) ||
      isSafePublicMediaUrl(card.mediaUrl) ||
      isSafePublicMediaUrl(card.thumbnailUrl)
    );
  }
  if (type === 'audio') {
    return (
      hasPlayableAudioRepresentation({ mediaUrl: card.mediaUrl }) || !!isSafePublicMediaUrl(card.embedUrl)
    );
  }
  return false;
}

export function isBrokenImageRepresentation(card: DiscoverCard): boolean {
  return String(card.contentType || '') === 'image' && !hasDirectMediaRepresentation(card);
}

export function representationRank(card: DiscoverCard): number {
  if (hasDirectMediaRepresentation(card)) return 40;
  const type = String(card.contentType || '');
  if (type === 'image' || type === 'video' || type === 'audio') return 20;
  if (card.url) return 10;
  return 0;
}

export function fidelityOf(card: DiscoverCard): ObjectFidelityKind {
  const raw = String(card.objectFidelity || '').toUpperCase();
  if (raw === 'PRIMARY_CONTENT' || raw === 'ABOUT_CONTENT' || raw === 'UNRELATED') {
    return raw;
  }
  if (hasDirectMediaRepresentation(card)) return 'PRIMARY_CONTENT';
  return 'ABOUT_CONTENT';
}

export function fidelityRank(card: DiscoverCard): number {
  const kind = fidelityOf(card);
  if (kind === 'PRIMARY_CONTENT') return 30;
  if (kind === 'ABOUT_CONTENT') return 10;
  return 0;
}

export function cardQualityRank(card: DiscoverCard): number {
  return fidelityRank(card) + representationRank(card);
}

export function shouldApplyDiscoverView(
  active: DiscoverUiScope,
  incoming: DiscoverView | null | undefined,
): boolean {
  if (!incoming) return false;
  const gen = String(incoming.searchGenerationId || '');
  const mode: SearchFeedMode = incoming.feedMode === 'intent' ? 'intent' : 'personal';
  if (active.feedMode === 'intent') {
    return mode === 'intent' && !!active.searchGenerationId && gen === active.searchGenerationId;
  }
  if (mode === 'intent') return false;
  if (gen && active.searchGenerationId && gen !== active.searchGenerationId) return false;
  return true;
}

export function mergeCardPair(existing: DiscoverCard, incoming: DiscoverCard): DiscoverCard {
  if (fidelityOf(incoming) === 'UNRELATED' && fidelityOf(existing) !== 'UNRELATED') {
    return existing;
  }
  if (isBrokenImageRepresentation(incoming) && hasDirectMediaRepresentation(existing)) {
    return existing;
  }
  if (hasDirectMediaRepresentation(existing) && !hasDirectMediaRepresentation(incoming)) {
    return {
      ...incoming,
      ...(existing.contentType ? { contentType: existing.contentType } : {}),
      ...(existing.thumbnailUrl || incoming.thumbnailUrl
        ? { thumbnailUrl: existing.thumbnailUrl || incoming.thumbnailUrl }
        : {}),
      ...(existing.mediaUrl || incoming.mediaUrl ? { mediaUrl: existing.mediaUrl || incoming.mediaUrl } : {}),
      ...(existing.embedUrl || incoming.embedUrl ? { embedUrl: existing.embedUrl || incoming.embedUrl } : {}),
      ...(existing.durationSeconds != null || incoming.durationSeconds != null
        ? { durationSeconds: existing.durationSeconds ?? incoming.durationSeconds }
        : {}),
      ...(existing.consumption || incoming.consumption
        ? { consumption: existing.consumption || incoming.consumption }
        : {}),
      ...(existing.objectFidelity === 'PRIMARY_CONTENT'
        ? { objectFidelity: 'PRIMARY_CONTENT' as const }
        : incoming.objectFidelity
          ? { objectFidelity: incoming.objectFidelity }
          : {}),
    };
  }
  if (cardQualityRank(incoming) > cardQualityRank(existing)) {
    return {
      ...incoming,
      ...(incoming.thumbnailUrl || existing.thumbnailUrl
        ? { thumbnailUrl: incoming.thumbnailUrl || existing.thumbnailUrl }
        : {}),
      ...(incoming.mediaUrl || existing.mediaUrl ? { mediaUrl: incoming.mediaUrl || existing.mediaUrl } : {}),
      ...(incoming.embedUrl || existing.embedUrl ? { embedUrl: incoming.embedUrl || existing.embedUrl } : {}),
    };
  }
  return existing;
}

export function mergeCardLists(current: DiscoverCard[], incoming: DiscoverCard[]): DiscoverCard[] {
  const order: string[] = [];
  const map = new Map<string, DiscoverCard>();
  const add = (card: DiscoverCard) => {
    if (fidelityOf(card) === 'UNRELATED') return;
    const key = canonicalCardKey(card);
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, card);
      order.push(key);
      return;
    }
    map.set(key, mergeCardPair(prev, card));
  };
  for (const card of current) add(card);
  for (const card of incoming) add(card);
  return order.map((key) => map.get(key)!);
}

export function mergeSeekCardSets(previous: SeekCardSet, next: SeekCardSet): SeekCardSet {
  const currentPrimary = previous.cards || [];
  const incomingPrimary = next.cards || [];
  const currentRelated = previous.relatedCards || [];
  const incomingRelated = next.relatedCards || [];
  const primaryKeys = new Set(currentPrimary.map(canonicalCardKey).filter(Boolean));
  const pulled = incomingRelated.filter((card) => primaryKeys.has(canonicalCardKey(card)));
  const relatedKept = incomingRelated.filter((card) => !primaryKeys.has(canonicalCardKey(card)));
  const primary = mergeCardLists(currentPrimary, [
    ...incomingPrimary,
    ...pulled.map((card) => ({ ...card, objectFidelity: 'PRIMARY_CONTENT' as const })),
  ]);
  const primaryKeySet = new Set(primary.map(canonicalCardKey).filter(Boolean));
  const related = mergeCardLists(
    currentRelated.filter((card) => !primaryKeySet.has(canonicalCardKey(card))),
    relatedKept.filter((card) => !primaryKeySet.has(canonicalCardKey(card))),
  );
  return { cards: primary, relatedCards: related.slice(0, 6) };
}

export function mergeIntentViews(current: DiscoverView, incoming: DiscoverView): DiscoverView {
  if (String(incoming.searchGenerationId || '') !== String(current.searchGenerationId || '')) {
    return current;
  }
  if (current.feedMode === 'intent' && incoming.feedMode !== 'intent') return current;
  if (current.feedMode !== 'intent') return current;
  const merged = mergeSeekCardSets(
    { cards: current.cards || [], relatedCards: current.relatedCards || [] },
    { cards: incoming.cards || [], relatedCards: incoming.relatedCards || [] },
  );
  const related = merged.relatedCards;
  return {
    ...incoming,
    ...(current.searchGenerationId ? { searchGenerationId: current.searchGenerationId } : {}),
    feedMode: 'intent',
    ...(incoming.searchQuery || current.searchQuery
      ? { searchQuery: incoming.searchQuery || current.searchQuery }
      : {}),
    cards: merged.cards,
    relatedCards: related,
    ...(related.length ? { relatedTitle: incoming.relatedTitle || current.relatedTitle || '相关介绍' } : {}),
    notice: merged.cards.length ? incoming.notice || current.notice : current.notice || incoming.notice,
    ...(typeof incoming.replenishing === 'boolean' ? { replenishing: incoming.replenishing } : {}),
  };
}

export function audioPlaybackKind(card: DiscoverCard): 'direct_playable' | 'source_only' | 'not_audio' {
  if (String(card.contentType || '') !== 'audio') return 'not_audio';
  const httpsMedia = /^https:\/\//i.test(String(card.mediaUrl || ''));
  if (
    httpsMedia &&
    card.consumption !== 'OFFICIAL_EMBED' &&
    hasPlayableAudioRepresentation({ mediaUrl: card.mediaUrl })
  ) {
    return 'direct_playable';
  }
  return 'source_only';
}

export function durationLabel(seconds: unknown): string | undefined {
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
