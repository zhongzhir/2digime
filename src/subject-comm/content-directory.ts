/**
 * V0.1 中立目录 = 已校验 NetworkItem 的可搜索投影。
 * 不含用户身份、偏好或 ranking。全文检索只发生在内容字段。
 */
import type { NetworkItem } from './network-item';
import { forbiddenPersonalizationKeys } from './network-item';

export interface DirectorySearchQuery {
  q?: string;
  publisher?: string;
  limit?: number;
}

export function searchContentDirectory(
  items: NetworkItem[],
  query: DirectorySearchQuery = {},
): NetworkItem[] {
  const forbidden = forbiddenPersonalizationKeys(query as unknown as Record<string, unknown>);
  if (forbidden.length) {
    throw Object.assign(new Error(`directory_query_rejected:${forbidden[0]}`), { code: 'query_keys_rejected' });
  }
  const q = String(query.q || '')
    .trim()
    .toLowerCase();
  const publisher = String(query.publisher || '').trim();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const matched = items.filter((item) => {
    if (publisher && item.publisherSubjectId !== publisher) return false;
    if (!q) return true;
    const hay = `${item.content.title}\n${item.content.text}\n${item.content.url || ''}`.toLowerCase();
    return hay.includes(q);
  });
  return matched.slice(0, limit);
}

export function directoryHoldsUserData(item: NetworkItem): string[] {
  const blob = JSON.stringify(item).toLowerCase();
  const hits: string[] = [];
  for (const key of ['digitalself', 'preferencevector', 'userid', 'recipientid', 'rankingscore']) {
    if (blob.includes(key)) hits.push(key);
  }
  return hits;
}
