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
  | 'internet_archive'
  | 'bangumi_api'
  | 'wikivoyage';
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
    id: 'chinanews-scroll',
    label: '中新网即时新闻',
    kind: 'media_rss',
    url: 'https://www.chinanews.com.cn/rss/scroll-news.xml',
    contentTypes: ['article'],
  },
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
    id: 'sspai-feed',
    label: '少数派',
    kind: 'media_rss',
    url: 'https://sspai.com/feed',
    contentTypes: ['article'],
  },
  {
    id: 'kr36-feed',
    label: '36氪',
    kind: 'media_rss',
    url: 'https://www.36kr.com/feed',
    contentTypes: ['article'],
  },
  {
    id: 'gcores-feed',
    label: '机核',
    kind: 'media_rss',
    url: 'https://www.gcores.com/rss',
    contentTypes: ['article'],
  },
  {
    id: 'douban-book-review',
    label: '豆瓣书评',
    kind: 'media_rss',
    url: 'https://www.douban.com/feed/review/book',
    contentTypes: ['article'],
  },
  {
    id: 'douban-movie-review',
    label: '豆瓣影评',
    kind: 'media_rss',
    url: 'https://movie.douban.com/feed/review/movie',
    contentTypes: ['article'],
  },
  {
    id: 'douban-music-review',
    label: '豆瓣乐评',
    kind: 'media_rss',
    url: 'https://www.douban.com/feed/review/music',
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
  {
    id: 'bangumi-calendar',
    label: 'Bangumi 放送',
    kind: 'bangumi_api',
    url: 'https://api.bgm.tv/calendar',
    contentTypes: ['article'],
  },
  {
    id: 'bangumi-search',
    label: 'Bangumi 条目',
    kind: 'bangumi_api',
    url: 'https://api.bgm.tv/search/subject',
    contentTypes: ['article'],
  },
  {
    id: 'wikivoyage-zh',
    label: '维基导游',
    kind: 'wikivoyage',
    url: 'https://zh.wikivoyage.org/w/api.php',
    contentTypes: ['article'],
  },
  {
    id: 'steam-featured',
    label: 'Steam 精选',
    kind: 'media_rss',
    url: 'https://store.steampowered.com/feeds/featured/',
    contentTypes: ['article'],
  },
];

export function catalogEndpointsFor(kinds: string[]): OpenSourceEndpoint[] {
  const wanted = new Set(kinds.filter((row) => row === 'article' || row === 'video' || row === 'image' || row === 'audio'));
  const rows = !wanted.size
    ? OPEN_SOURCE_CATALOG.slice()
    : OPEN_SOURCE_CATALOG.filter((row) => row.contentTypes.some((type) => wanted.has(type)));
  return rows.filter((row) => allowsDefaultSupply({ url: row.url, publisher: row.label }));
}
