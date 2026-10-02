/**
 * 非个性化开放来源登记。只存 Feed / 官方开放 API endpoint。
 * 不是用户推荐，不含 preference vector，不按人排序。
 */
export type OpenCatalogKind =
  | 'peertube_search'
  | 'media_rss'
  | 'wikimedia_commons'
  | 'itunes_podcast'
  | 'itunes_rss'
  | 'internet_archive';
export type OpenCatalogContentType = 'article' | 'video' | 'image' | 'audio';

export interface OpenSourceEndpoint {
  id: string;
  label: string;
  kind: OpenCatalogKind;
  url: string;
  contentTypes: OpenCatalogContentType[];
}

export const OPEN_SOURCE_CATALOG: OpenSourceEndpoint[] = [
  {
    id: 'bbc-news-world',
    label: 'BBC News',
    kind: 'media_rss',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    contentTypes: ['article'],
  },
  {
    id: 'bbc-zhongwen',
    label: 'BBC 中文',
    kind: 'media_rss',
    url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml',
    contentTypes: ['article'],
  },
  {
    id: 'guardian-world',
    label: 'The Guardian',
    kind: 'media_rss',
    url: 'https://www.theguardian.com/world/rss',
    contentTypes: ['article'],
  },
  {
    id: 'npr-news',
    label: 'NPR',
    kind: 'media_rss',
    url: 'https://feeds.npr.org/1001/rss.xml',
    contentTypes: ['article'],
  },
  {
    id: 'aljazeera-all',
    label: 'Al Jazeera',
    kind: 'media_rss',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    contentTypes: ['article'],
  },
  {
    id: 'peertube-framatube-search',
    label: 'Framatube',
    kind: 'peertube_search',
    url: 'https://framatube.org/api/v1/search/videos',
    contentTypes: ['video'],
  },
  {
    id: 'peertube-framatube-feed',
    label: 'Framatube videos',
    kind: 'media_rss',
    url: 'https://framatube.org/feeds/videos.xml',
    contentTypes: ['video'],
  },
  {
    id: 'wikimedia-commons',
    label: 'Wikimedia Commons',
    kind: 'wikimedia_commons',
    url: 'https://commons.wikimedia.org/w/api.php',
    contentTypes: ['image', 'video', 'audio'],
  },
  {
    id: 'internet-archive',
    label: 'Internet Archive',
    kind: 'internet_archive',
    url: 'https://archive.org/advancedsearch.php',
    contentTypes: ['audio', 'video'],
  },
  {
    id: 'itunes-podcast-search',
    label: 'iTunes Podcasts',
    kind: 'itunes_podcast',
    url: 'https://itunes.apple.com/search',
    contentTypes: ['audio'],
  },
  {
    id: 'itunes-top-podcasts',
    label: 'iTunes Top Podcasts',
    kind: 'itunes_rss',
    url: 'https://itunes.apple.com/cn/rss/toppodcasts/limit=10/json',
    contentTypes: ['audio'],
  },
];

export function catalogEndpointsFor(kinds: string[]): OpenSourceEndpoint[] {
  const wanted = new Set(kinds.filter((row) => row === 'article' || row === 'video' || row === 'image' || row === 'audio'));
  if (!wanted.size) return OPEN_SOURCE_CATALOG.slice();
  return OPEN_SOURCE_CATALOG.filter((row) => row.contentTypes.some((type) => wanted.has(type)));
}
