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
  | 'media_listing';
export type OpenCatalogContentType = 'article' | 'video' | 'image' | 'audio';

export interface OpenSourceEndpoint {
  id: string;
  label: string;
  kind: OpenCatalogKind;
  url: string;
  contentTypes: OpenCatalogContentType[];
}

export const OPEN_SOURCE_CATALOG: OpenSourceEndpoint[] = [
  // 国内公开视频列表页：页面公开 node-url（文章页）与 video-src（直链 MP4）。
  // 只读公开 HTML 属性，不调用平台内部接口，不下载/转码媒体。国内可达优先。
  {
    id: 'chinanews-video-listing',
    label: '中国新闻网视频',
    kind: 'media_listing',
    url: 'https://www.chinanews.com.cn/shipin/',
    contentTypes: ['video'],
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
  // 兼容保留：海外开放视频/图片来源，非国内默认主力。
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
    contentTypes: ['image', 'video'],
  },
];

export function catalogEndpointsFor(kinds: string[]): OpenSourceEndpoint[] {
  const wanted = new Set(kinds.filter((row) => row === 'article' || row === 'video' || row === 'image' || row === 'audio'));
  if (!wanted.size) return OPEN_SOURCE_CATALOG.slice();
  return OPEN_SOURCE_CATALOG.filter((row) => row.contentTypes.some((type) => wanted.has(type)));
}
