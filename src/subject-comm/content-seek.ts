/**
 * 主动获取：自然语言 → 中立目录匹配 + 可选外部搜索。
 * 去重按 canonical URL；保留来源链接；不爬站、不写偏好。
 */
import type { NetworkItem } from './network-item';
import { searchContentDirectory } from './content-directory';
import { normalizeCanonicalUrl } from './content-canonical';
import { cardFromNetworkItem, type DiscoverCard } from './content-discover';

export interface ExternalSeekHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface ContentSeekResult {
  cards: DiscoverCard[];
  usedDirectory: boolean;
  usedExternal: boolean;
  notice: string;
}

export function directorySeekTerms(query: string): string[] {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const stripped = raw
    .replace(/^(请|帮我|麻烦|想|要)?(找|搜|看看|查一下|查)?(一下|一些)?/u, '')
    .replace(/(相关)?(的)?(文章|新闻|内容|资料|报道)(吧|啊)?$/u, '')
    .trim();
  const terms: string[] = [raw];
  if (stripped && stripped !== raw) terms.push(stripped);
  for (const part of raw.split(/[\s,，。？?！!、；;]+/)) {
    if (part.length >= 2) terms.push(part);
  }
  for (const match of raw.matchAll(/[A-Za-z][A-Za-z0-9\-]{1,}/g)) {
    terms.push(match[0]);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, 8);
}

export function matchDirectoryForSeek(items: NetworkItem[], query: string): NetworkItem[] {
  const seen = new Set<string>();
  const matched: NetworkItem[] = [];
  for (const term of directorySeekTerms(query)) {
    for (const item of searchContentDirectory(items, { q: term, limit: 20 })) {
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      matched.push(item);
    }
  }
  return matched.slice(0, 12);
}

function cardFromItem(item: NetworkItem, reason: string, source: 'directory' | 'web'): DiscoverCard {
  return cardFromNetworkItem(item, reason, source);
}

export async function seekContent(input: {
  query: string;
  items: NetworkItem[];
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
}): Promise<ContentSeekResult> {
  const query = String(input.query || '').trim();
  if (!query) {
    return { cards: [], usedDirectory: false, usedExternal: false, notice: '请先说想找什么。' };
  }
  const directoryHits = matchDirectoryForSeek(input.items, query);
  const cards: DiscoverCard[] = directoryHits.map((item) =>
    cardFromItem(item, '目录里已有这条内容。', 'directory'),
  );
  const seenUrls = new Set(
    cards
      .map((card) => {
        try {
          return card.url ? normalizeCanonicalUrl(card.url) : '';
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );

  let usedExternal = false;
  if (input.searchWeb) {
    try {
      const web = await input.searchWeb(query);
      for (const hit of web) {
        let canonical = '';
        try {
          canonical = normalizeCanonicalUrl(hit.url);
        } catch {
          continue;
        }
        if (!canonical || seenUrls.has(canonical)) continue;
        seenUrls.add(canonical);
        usedExternal = true;
        cards.push({
          itemId: `seek_${seenUrls.size}`,
          title: String(hit.title || canonical).slice(0, 240),
          text: String(hit.snippet || hit.title || '').slice(0, 800),
          url: canonical,
          reason: '公开网页来源，不是目录推荐。',
          source: 'web',
        });
        if (cards.length >= 12) break;
      }
    } catch {
      /* 外部搜索失败时仍返回目录命中 */
    }
  }

  return {
    cards,
    usedDirectory: directoryHits.length > 0,
    usedExternal,
    notice: cards.length ? '' : '目录和公开搜索这次都没有找到可核对来源的内容。',
  };
}

export function formatSeekContext(result: ContentSeekResult): string {
  if (!result.cards.length) return '';
  return result.cards
    .slice(0, 8)
    .map((card) => `- ${card.title}${card.url ? `\n  来源：${card.url}` : ''}`)
    .join('\n');
}
