/**
 * Discover 候选蓄水池。
 *
 * 这一层只做可证明的机械工作：排除、规范 URL 去重、来源轮转、媒介露出和容量控制。
 * 它不读取 Digital Self，不计算语义相关性，不替本机模型决定用户应该看什么。
 */
import { normalizeCanonicalUrl } from './content-canonical';
import { pageAccessState } from './content-seek';
import { isNetworkItemExpired, type NetworkItem } from './network-item';

export const DEFAULT_DISCOVER_RESERVOIR_CAPACITY = 72;

export interface DiscoverCandidateReservoirStats {
  input: number;
  excluded: number;
  blocked: number;
  expired: number;
  duplicates: number;
  eligible: number;
  selected: number;
  sourceCount: number;
}

export interface DiscoverCandidateReservoir {
  items: NetworkItem[];
  stats: DiscoverCandidateReservoirStats;
}

function hostOf(url?: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 已取到的作品/媒介种类。按目录身份和 contentType，不是主题分类器。 */
export function presentationKind(item: NetworkItem): string {
  const type = String(item.content.contentType || 'article');
  if (type === 'video' || type === 'image' || type === 'audio') return type;
  const host = hostOf(item.content.url);
  if (host === 'bgm.tv' || host === 'bangumi.tv' || host.endsWith('steampowered.com')) return 'work';
  if (host === 'zh.wikivoyage.org') return 'guide';
  return type || 'article';
}

function repeatedWork(items: NetworkItem[]): boolean {
  if (items.length < 3) return false;
  const stems = items.map((item) => {
    const title = String(item.content.title || '').replace(/\s+/g, ' ').trim();
    const stem = title.replace(/(?:第\s*)?\d+\s*(?:章|节|回|话|集|期).*$/u, '').trim();
    return stem.length >= 2 && stem.length < title.length ? stem : '';
  });
  const stem = stems[0] || '';
  return stem.length > 0 && stems.every((row) => row === stem);
}

/**
 * 按来源轮转候选。同一连续作品在还有其它来源时限制爆发；单一来源时不凭空丢弃内容。
 */
export function diverseFeedCandidates(items: NetworkItem[], limit = 24, perSource = 2): NetworkItem[] {
  const groups: NetworkItem[][] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const key = item.publisherSubjectId || item.itemId;
    let at = index.get(key);
    if (at === undefined) {
      at = groups.length;
      index.set(key, at);
      groups.push([]);
    }
    groups[at]!.push(item);
  }
  const capped = groups.map((group) => groups.length > 1 && repeatedWork(group));
  const out: NetworkItem[] = [];
  const cursors = groups.map(() => 0);
  while (out.length < limit) {
    let added = false;
    for (let i = 0; i < groups.length; i += 1) {
      const cursor = cursors[i] || 0;
      if (capped[i] && cursor >= perSource) continue;
      const item = groups[i]?.[cursor];
      if (!item) continue;
      cursors[i] = cursor + 1;
      out.push(item);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}

/**
 * 先按来源轮转，再让已经取到、但还没进窗的非文章媒介有机会被模型看见。
 * 不是类型配额，也不为凑数塞无关条目。
 */
export function presentableFeedCandidates(items: NetworkItem[], limit = 24, perSource = 2): NetworkItem[] {
  const rotated = diverseFeedCandidates(items, limit, perSource);
  const kindsInPool = new Set(items.map(presentationKind));
  const kindsInWindow = new Set(rotated.map(presentationKind));
  const missing = [...kindsInPool].filter((kind) => kind !== 'article' && !kindsInWindow.has(kind));
  if (!missing.length) return rotated;
  const used = new Set(rotated.map((item) => item.itemId));
  const extras: NetworkItem[] = [];
  for (const kind of missing) {
    const found = items.find((item) => presentationKind(item) === kind && !used.has(item.itemId));
    if (!found) continue;
    extras.push(found);
    used.add(found.itemId);
  }
  if (!extras.length) return rotated;
  const out = rotated.slice();
  for (const extra of extras) {
    let replaceAt = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (presentationKind(out[i]!) === 'article') {
        replaceAt = i;
        break;
      }
    }
    if (replaceAt >= 0) out[replaceAt] = extra;
    else if (out.length < limit) out.push(extra);
  }
  return out;
}

/** 本轮按理解发出的检索结果必须进候选窗，不能被旧目录挤掉。 */
export function seatThisTurnItems(
  window: NetworkItem[],
  fresh: NetworkItem[],
  limit = 24,
  maxFresh = 8,
): NetworkItem[] {
  const extras: NetworkItem[] = [];
  const seen = new Set<string>();
  for (const item of fresh) {
    if (seen.has(item.itemId)) continue;
    if (pageAccessState({ title: item.content.title, text: item.content.text }) !== 'ok') continue;
    seen.add(item.itemId);
    extras.push(item);
    if (extras.length >= maxFresh) break;
  }
  if (!extras.length) return window;
  const extraIds = new Set(extras.map((item) => item.itemId));
  return [...extras, ...window.filter((item) => !extraIds.has(item.itemId))].slice(0, limit);
}

function canonicalIdentity(item: NetworkItem): string {
  const url = String(item.content.url || '').trim();
  if (url) {
    try {
      return `url:${normalizeCanonicalUrl(url)}`;
    } catch {
      // 已校验的 NetworkItem 正常不会进入这里；仍用 itemId 保留可诊断对象。
    }
  }
  return `item:${item.itemId}`;
}

/**
 * 建立一次可分页的中立候选蓄水池。语义选择发生在本函数之后。
 */
export function buildDiscoverCandidateReservoir(input: {
  items: NetworkItem[];
  now: string;
  capacity?: number;
  perSource?: number;
  excludedItemIds?: ReadonlySet<string>;
  blockedPublisherIds?: ReadonlySet<string>;
}): DiscoverCandidateReservoir {
  const capacity = Math.max(1, Math.floor(input.capacity || DEFAULT_DISCOVER_RESERVOIR_CAPACITY));
  const perSource = Math.max(1, Math.floor(input.perSource || 2));
  const excludedIds = input.excludedItemIds || new Set<string>();
  const blockedPublishers = input.blockedPublisherIds || new Set<string>();
  const unique = new Map<string, NetworkItem>();
  let excluded = 0;
  let blocked = 0;
  let expired = 0;
  let duplicates = 0;

  for (const item of input.items) {
    if (excludedIds.has(item.itemId)) {
      excluded += 1;
      continue;
    }
    if (blockedPublishers.has(item.publisherSubjectId)) {
      blocked += 1;
      continue;
    }
    if (isNetworkItemExpired(item, input.now)) {
      expired += 1;
      continue;
    }
    const identity = canonicalIdentity(item);
    if (unique.has(identity)) {
      duplicates += 1;
      continue;
    }
    unique.set(identity, item);
  }

  const eligible = [...unique.values()];
  const items = presentableFeedCandidates(eligible, capacity, perSource);
  return {
    items,
    stats: {
      input: input.items.length,
      excluded,
      blocked,
      expired,
      duplicates,
      eligible: eligible.length,
      selected: items.length,
      sourceCount: new Set(items.map((item) => item.publisherSubjectId)).size,
    },
  };
}

