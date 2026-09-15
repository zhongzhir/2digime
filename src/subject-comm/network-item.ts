/**
 * NetworkItem — 公开候选对象，不是点对点邮件，也不是 PublicSubjectCard。
 * 第一版 kind/visibility 固定为 content/public；类型保持可扩展，不锁成 FeedArticle。
 */
import { createHash } from 'node:crypto';

export const NETWORK_ITEM_SCHEMA_VERSION = 1 as const;

export const NETWORK_ITEM_KIND_CONTENT = 'content' as const;
export const NETWORK_ITEM_VISIBILITY_PUBLIC = 'public' as const;

export const PERSONAL_SELECTION_UNAVAILABLE = 'PERSONAL_SELECTION_UNAVAILABLE' as const;

/** Relay 查询禁止携带的个性化/推荐参数（字段名）。 */
export const RELAY_FORBIDDEN_QUERY_KEYS = [
  'digitalself',
  'self',
  'preference',
  'preferences',
  'interests',
  'goal',
  'profile',
  'relevance',
  'recommend',
  'recommendation',
  'score',
  'rank',
  'ranking',
  'personalize',
  'personalized',
  'similarity',
  'embedding',
] as const;

const FORBIDDEN_KEY_SET = new Set<string>(RELAY_FORBIDDEN_QUERY_KEYS);

export type NetworkItemDiscoveryVia = 'search' | 'feed' | 'sitemap' | 'page' | 'autodiscovery';

export interface NetworkItemProvenance {
  origin: DigitalSelfLikeOrigin;
  actor: 'owner' | 'model';
  statedAt: string;
  excerpt?: string;
  /** 内容如何被发现。不是 ranking，也不是用户画像。 */
  via?: NetworkItemDiscoveryVia;
}

/** 复用 Digital Self provenance 的 origin 语义，外加 publisher/seed。 */
export type DigitalSelfLikeOrigin = 'user_statement' | 'material' | 'inference' | 'publisher' | 'seed';

export interface NetworkItemContent {
  title: string;
  text: string;
  url?: string;
}

export interface NetworkItem {
  schemaVersion: typeof NETWORK_ITEM_SCHEMA_VERSION;
  itemId: string;
  publisherSubjectId: string;
  publisherDisplayName?: string;
  kind: string;
  createdAt: string;
  expiresAt?: string;
  visibility: string;
  content: NetworkItemContent;
  provenance: NetworkItemProvenance;
}

export interface NetworkItemQuery {
  kind?: string;
  publisher?: string;
  createdAfter?: string;
  createdBefore?: string;
  visibility?: string;
  cursor?: string;
  limit?: number;
}

export type NetworkItemValidation =
  | { ok: true; item: NetworkItem }
  | { ok: false; reason: string };

const ORIGINS = new Set<string>(['user_statement', 'material', 'inference', 'publisher', 'seed']);
const ACTORS = new Set<string>(['owner', 'model']);
const DISCOVERY_VIA = new Set<string>(['search', 'feed', 'sitemap', 'page', 'autodiscovery']);

function isIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export function normalizeQueryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

export function forbiddenPersonalizationKeys(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((key) => FORBIDDEN_KEY_SET.has(normalizeQueryKey(key)));
}

export function validateNetworkItem(raw: unknown): NetworkItemValidation {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, reason: 'not_object' };
  const forbidden = forbiddenPersonalizationKeys(rec);
  if (forbidden.length) return { ok: false, reason: `personalized_field:${forbidden[0]}` };
  if (rec.schemaVersion !== NETWORK_ITEM_SCHEMA_VERSION) return { ok: false, reason: 'schema_version' };

  const itemId = String(rec.itemId || '').trim();
  const publisherSubjectId = String(rec.publisherSubjectId || '').trim();
  const kind = String(rec.kind || '').trim();
  const createdAt = String(rec.createdAt || '').trim();
  const visibility = String(rec.visibility || '').trim();
  if (!itemId || itemId.length > 120) return { ok: false, reason: 'itemId' };
  if (!publisherSubjectId || publisherSubjectId.length > 120) return { ok: false, reason: 'publisherSubjectId' };
  if (kind !== NETWORK_ITEM_KIND_CONTENT) return { ok: false, reason: 'kind' };
  if (!isIso(createdAt)) return { ok: false, reason: 'createdAt' };
  if (visibility !== NETWORK_ITEM_VISIBILITY_PUBLIC) return { ok: false, reason: 'visibility' };

  const expiresAt = rec.expiresAt == null ? undefined : String(rec.expiresAt).trim();
  if (expiresAt && !isIso(expiresAt)) return { ok: false, reason: 'expiresAt' };

  const contentRec = asRecord(rec.content);
  if (!contentRec) return { ok: false, reason: 'content' };
  const title = String(contentRec.title || '').trim();
  const text = String(contentRec.text || '').trim();
  if (!title || title.length > 240) return { ok: false, reason: 'content.title' };
  if (!text || text.length > 8000) return { ok: false, reason: 'content.text' };
  const urlRaw = contentRec.url == null ? '' : String(contentRec.url).trim();
  if (urlRaw && !/^https?:\/\//i.test(urlRaw)) return { ok: false, reason: 'content.url' };

  const provRec = asRecord(rec.provenance);
  if (!provRec) return { ok: false, reason: 'provenance' };
  const origin = String(provRec.origin || '').trim();
  const actor = String(provRec.actor || '').trim();
  const statedAt = String(provRec.statedAt || '').trim();
  if (!ORIGINS.has(origin)) return { ok: false, reason: 'provenance.origin' };
  if (!ACTORS.has(actor)) return { ok: false, reason: 'provenance.actor' };
  if (!isIso(statedAt)) return { ok: false, reason: 'provenance.statedAt' };

  const displayName = String(rec.publisherDisplayName || '').trim();
  const excerpt = String(provRec.excerpt || '').trim();
  const viaRaw = String(provRec.via || '').trim();
  const via = DISCOVERY_VIA.has(viaRaw) ? (viaRaw as NetworkItemProvenance['via']) : undefined;
  const item: NetworkItem = {
    schemaVersion: NETWORK_ITEM_SCHEMA_VERSION,
    itemId,
    publisherSubjectId,
    kind,
    createdAt,
    visibility,
    content: {
      title,
      text,
      ...(urlRaw ? { url: urlRaw } : {}),
    },
    provenance: {
      origin: origin as NetworkItemProvenance['origin'],
      actor: actor as NetworkItemProvenance['actor'],
      statedAt,
      ...(excerpt ? { excerpt: excerpt.slice(0, 400) } : {}),
      ...(via ? { via } : {}),
    },
    ...(displayName ? { publisherDisplayName: displayName.slice(0, 80) } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
  return { ok: true, item };
}

export function isNetworkItemExpired(item: NetworkItem, nowIso: string): boolean {
  return !!item.expiresAt && item.expiresAt < nowIso;
}

export function compareNetworkItems(a: NetworkItem, b: NetworkItem): number {
  const t = a.createdAt.localeCompare(b.createdAt);
  return t !== 0 ? t : a.itemId.localeCompare(b.itemId);
}

export function encodeNetworkItemCursor(item: NetworkItem): string {
  return Buffer.from(`${item.createdAt}\t${item.itemId}`, 'utf8').toString('base64url');
}

export function decodeNetworkItemCursor(cursor: string): { createdAt: string; itemId: string } | null {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const tab = text.indexOf('\t');
    if (tab <= 0) return null;
    const createdAt = text.slice(0, tab);
    const itemId = text.slice(tab + 1);
    if (!createdAt || !itemId) return null;
    return { createdAt, itemId };
  } catch {
    return null;
  }
}

export function filterNetworkItems(items: NetworkItem[], query: NetworkItemQuery, nowIso: string): NetworkItem[] {
  const kind = query.kind?.trim();
  const publisher = query.publisher?.trim();
  const visibility = query.visibility?.trim();
  const createdAfter = query.createdAfter?.trim();
  const createdBefore = query.createdBefore?.trim();
  return items
    .filter((item) => !isNetworkItemExpired(item, nowIso))
    .filter((item) => (kind ? item.kind === kind : true))
    .filter((item) => (publisher ? item.publisherSubjectId === publisher : true))
    .filter((item) => (visibility ? item.visibility === visibility : true))
    .filter((item) => (createdAfter ? item.createdAt > createdAfter : true))
    .filter((item) => (createdBefore ? item.createdAt < createdBefore : true))
    .sort(compareNetworkItems);
}

export function paginateNetworkItems(
  items: NetworkItem[],
  query: NetworkItemQuery,
): { items: NetworkItem[]; nextCursor?: string } {
  const limitRaw = query.limit;
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Number(limitRaw) : 50, 1), 100);
  let start = 0;
  if (query.cursor) {
    const decoded = decodeNetworkItemCursor(query.cursor);
    if (!decoded) return { items: [] };
    const idx = items.findIndex((item) => {
      const t = item.createdAt.localeCompare(decoded.createdAt);
      const cmp = t !== 0 ? t : item.itemId.localeCompare(decoded.itemId);
      return cmp > 0;
    });
    start = idx < 0 ? items.length : idx;
  }
  const slice = items.slice(start, start + limit);
  const last = slice[slice.length - 1];
  return {
    items: slice,
    ...(last && start + slice.length < items.length ? { nextCursor: encodeNetworkItemCursor(last) } : {}),
  };
}

export function candidatePoolHash(itemIds: string[]): string {
  return createHash('sha256').update(itemIds.join('\n')).digest('hex');
}

/** 对已校验 NetworkItem 做机械 payload 指纹。不是 relevance / ranking score。 */
export function networkItemPayloadHash(item: NetworkItem): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex');
}
