/**
 * 已实测可用的公开新闻 RSS。对话和发现调用同一函数。
 * 模型决定要不要用；这里只取条目、来源和发布时间。
 */
import { parseFeed } from './content-ingest';

export interface NewsHeadline {
  title: string;
  url: string;
  publisherName?: string;
  publisherUrl?: string;
  /** 来源给出的发布时间，ISO。没有就不填，调用方不得把它说成当天。 */
  publishedAt?: string;
  /** 这次取到条目的时间。不是发布时间，也不是事件时间。 */
  fetchedAt: string;
  snippet: string;
  /** 新闻源只给了标题和摘要。没有读取原文。 */
  bodyRead: false;
}

function attr(raw: string, name: string): string {
  const match = raw.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ? match[1].trim() : '';
}

function stripHtml(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headlinesFromRss(xml: string, fetchedAt: string): NewsHeadline[] {
  const feed = parseFeed(xml);
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1] || '');
  const out: NewsHeadline[] = [];
  for (let index = 0; index < feed.items.length && out.length < 8; index += 1) {
    const item = feed.items[index];
    if (!item) continue;
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    const url = String(item.url || '').trim();
    if (!title || !url) continue;
    const block = blocks[index] || '';
    const source = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const publisherName = source ? stripHtml(source[2] || '') : '';
    const publisherUrl = source ? attr(source[1] || '', 'url') : '';
    const parsed = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    const publishedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
    out.push({
      title: title.slice(0, 240),
      url,
      ...(publisherName ? { publisherName: publisherName.slice(0, 80) } : {}),
      ...(publisherUrl ? { publisherUrl } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      fetchedAt,
      snippet: stripHtml(item.text || title).slice(0, 240),
      bodyRead: false,
    });
  }
  return out;
}

export async function fetchNewsHeadlines(
  query: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<NewsHeadline[]> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) +
    '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      'user-agent': 'digitalme-news',
    },
  });
  if (!response.ok) {
    throw new Error(`新闻来源没有返回条目（${response.status}）`);
  }
  const xml = await response.text();
  return headlinesFromRss(xml, now.toISOString());
}
