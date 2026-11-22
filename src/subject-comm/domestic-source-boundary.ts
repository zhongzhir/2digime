/**
 * 国内默认内容供给的机械来源边界。
 * 这是产品安全/授权边界，不是模型语义判断。模型继续负责需求理解、相关性和排序。
 *
 * 排除只作用于：默认目录、自动获取、推荐、搜索结果。
 * 用户已有收藏不删除，只标明不在国内默认供给。
 */
export type DefaultSourceDecision = 'allow' | 'exclude';

export type DefaultSourceReason =
  | 'epoch_family'
  | 'foreign_unreachable_core'
  | 'unidentified_aggregator'
  | 'allow';

export interface DefaultSourceInput {
  url?: string | undefined;
  publisher?: string | undefined;
}

export interface DefaultSourceClassification {
  decision: DefaultSourceDecision;
  reason: DefaultSourceReason;
}

/** 大纪元及明确关联来源。host 后缀匹配。 */
const EPOCH_HOSTS = [
  'epochtimes.com',
  'epochtimes.com.tw',
  'epochtimeshk.org',
  'epochtw.com',
  'dajiyuan.com',
  'ntdtv.com',
  'ntd.com',
  'ntdtv.com.tw',
  'soundofhope.org',
] as const;

const EPOCH_PUBLISHERS = [
  '大纪元',
  'epoch times',
  'the epoch times',
  '新唐人',
  'ntd',
  'ntdtv',
  '希望之声',
  'sound of hope',
] as const;

/**
 * 国内常规网络不可达、且不得再作为默认供给核心依赖的来源。
 * 清单保持短、可审查；不是开放语义分类器。
 */
const FOREIGN_CORE_HOSTS = [
  'bbc.com',
  'bbc.co.uk',
  'bbci.co.uk',
  'theguardian.com',
  'npr.org',
  'aljazeera.com',
  'nytimes.com',
  'voanews.com',
  'voachinese.com',
  'rfa.org',
  'dw.com',
  'framatube.org',
] as const;

const FOREIGN_CORE_PUBLISHERS = [
  'bbc',
  'bbc news',
  'bbc 中文',
  'bbc中文',
  'the guardian',
  'guardian',
  'npr',
  'al jazeera',
  'new york times',
  'nytimes',
  'voa',
  '美国之音',
  '自由亚洲电台',
  '自由亚洲',
  'deutsche welle',
  '德国之声',
] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(host: string, list: readonly string[]): boolean {
  if (!host) return false;
  return list.some((row) => host === row || host.endsWith(`.${row}`));
}

function normalizePublisher(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function publisherMatches(name: string, list: readonly string[]): boolean {
  const normalized = normalizePublisher(name);
  if (!normalized) return false;
  return list.some(
    (row) => normalized === row || normalized.startsWith(`${row} `) || normalized.endsWith(` ${row}`),
  );
}

function isGoogleNewsHost(host: string): boolean {
  return host === 'news.google.com' || host.endsWith('.news.google.com');
}

export function classifyDefaultSource(input: DefaultSourceInput): DefaultSourceClassification {
  const host = hostOf(String(input.url || '').trim());
  const publisher = String(input.publisher || '').trim();
  if (hostMatches(host, EPOCH_HOSTS) || publisherMatches(publisher, EPOCH_PUBLISHERS)) {
    return { decision: 'exclude', reason: 'epoch_family' };
  }
  if (hostMatches(host, FOREIGN_CORE_HOSTS) || publisherMatches(publisher, FOREIGN_CORE_PUBLISHERS)) {
    return { decision: 'exclude', reason: 'foreign_unreachable_core' };
  }
  if (isGoogleNewsHost(host)) {
    return { decision: 'exclude', reason: 'unidentified_aggregator' };
  }
  return { decision: 'allow', reason: 'allow' };
}

/** 跟随公开重定向后再判断来源。失败时按原始 URL 判断。 */
export async function classifyResolvedDefaultSource(
  input: DefaultSourceInput,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DefaultSourceClassification & { url: string }> {
  const raw = String(input.url || '').trim();
  if (!raw) return { ...classifyDefaultSource(input), url: raw };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    const res = await fetchImpl(raw, { method: 'GET', redirect: 'follow', signal: ac.signal });
    clearTimeout(timer);
    const finalUrl = String(res.url || raw);
    return { ...classifyDefaultSource({ url: finalUrl, publisher: input.publisher }), url: finalUrl };
  } catch {
    return { ...classifyDefaultSource(input), url: raw };
  }
}

export function allowsDefaultSupply(input: DefaultSourceInput): boolean {
  return classifyDefaultSource(input).decision === 'allow';
}

export function filterDefaultSupply<T extends { url?: string; publisher?: string; publisherName?: string }>(
  rows: T[],
): T[] {
  return rows.filter((row) =>
    allowsDefaultSupply({
      url: row.url,
      publisher: row.publisher || row.publisherName,
    }),
  );
}
