/**
 * 非个性化开放来源登记。只存 Feed / 官方开放 API endpoint。
 * 不是用户推荐，不含 preference vector，不按人排序。
 * 默认目录只放国内常规供给优先的来源；排除规则见 domestic-source-boundary。
 */
import { allowsDefaultSupply } from './domestic-source-boundary';

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
    id: 'ithome-news',
    label: 'IT之家',
    kind: 'media_rss',
    url: 'https://www.ithome.com/rss/',
    contentTypes: ['article'],
  },
  {
    id: 'solidot-news',
    label: 'Solidot',
    kind: 'media_rss',
    url: 'https://www.solidot.org/index.rss',
    contentTypes: ['article'],
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
  const rows = !wanted.size
    ? OPEN_SOURCE_CATALOG.slice()
    : OPEN_SOURCE_CATALOG.filter((row) => row.contentTypes.some((type) => wanted.has(type)));
  return rows.filter((row) => allowsDefaultSupply({ url: row.url, publisher: row.label }));
}
