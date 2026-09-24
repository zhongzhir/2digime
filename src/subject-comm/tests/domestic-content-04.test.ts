import test from 'node:test';
import assert from 'node:assert/strict';
import { listingVideoHits, networkItemFromOpenHit, searchOpenMedia } from '../content-source-capabilities';
import { catalogEndpointsFor, OPEN_SOURCE_CATALOG, type OpenSourceEndpoint } from '../open-source-catalog';
import { parseXmlFeed } from '../content-feed';
import { ingestSource } from '../content-ingest';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { normalizeCanonicalUrl } from '../content-canonical';
import { cardFromNetworkItem } from '../content-discover';

const LISTING: OpenSourceEndpoint = {
  id: 'test-listing',
  label: 'Test domestic video listing',
  kind: 'media_listing',
  url: 'https://video.example.cn/shipin/',
  contentTypes: ['video'],
};

test('media_listing reads public video-src/node-url attributes as direct MP4 only', () => {
  const html =
    `<div video-src='https://cdn.example.cn/a/clip.mp4' node-url='//video.example.cn/2026/a.shtml' class='mod-li'><a>真实视频标题一</a></div>` +
    `<div data-video-src='https://cdn.example.cn/b/other.webm' data-node-url='/b.shtml'><a>标题二</a></div>` +
    `<div video-src='https://cdn.example.cn/c/page.html' node-url='/c.shtml'><a>不是直链</a></div>`;
  const hits = listingVideoHits(LISTING, html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.contentType, 'video');
  assert.equal(hits[0]?.mediaUrl, 'https://cdn.example.cn/a/clip.mp4');
  assert.equal(hits[0]?.url, 'https://video.example.cn/2026/a.shtml');
  assert.equal(hits[0]?.title, '真实视频标题一');
  // non-mp4 direct link is not treated as a playable video
  assert.equal(hits.some((h) => (h.mediaUrl || '').includes('/c/page.html')), false);
});

test('a domestic direct-video listing yields INLINE_MEDIA video with a real MP4 url', async () => {
  const hits = await searchOpenMedia({
    query: '',
    kinds: ['video'],
    endpoints: [LISTING],
    fetchImpl: async (url) => ({
      status: 200,
      finalUrl: url,
      body:
        `<div video-src='https://cdn.example.cn/full/clip.mp4' node-url='https://video.example.cn/1.shtml'><a>国内视频</a></div>`,
    }),
  });
  assert.equal(hits.length, 1);
  const item = networkItemFromOpenHit(hits[0]!);
  assert.ok(item);
  assert.equal(item!.content.contentType, 'video');
  assert.equal(item!.content.mediaUrl, 'https://cdn.example.cn/full/clip.mp4');
  assert.equal(item!.content.consumption, 'INLINE_MEDIA');
  assert.equal(item!.content.mimeType, 'video/mp4');
  const card = cardFromNetworkItem(item!, '', 'web');
  assert.equal(card.contentType, 'video');
  assert.equal(card.mediaUrl, 'https://cdn.example.cn/full/clip.mp4');
});

test('the open catalog registers a domestic video listing ahead of overseas video', () => {
  const video = catalogEndpointsFor(['video']);
  assert.equal(video[0]?.kind, 'media_listing');
  assert.match(video[0]?.url || '', /chinanews\.com\.cn/);
  assert.equal(
    OPEN_SOURCE_CATALOG.some((row) => row.kind === 'peertube_search' && row.contentTypes.includes('video')),
    true,
  );
});

test('podcast enclosure media from a feed reaches the NetworkItem as INLINE_MEDIA audio', async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>科技播客</title>
  <item><title>一期节目</title><link>https://pod.example.cn/ep1</link><description>摘要</description>
  <enclosure url="https://cdn.example.cn/ep1.mp3" length="12345678" type="audio/mpeg"/>
  <itunes:duration>58:12</itunes:duration></item></channel></rss>`;
  const rich = parseXmlFeed(rss);
  const mediaByUrl = new Map(
    (rich?.items || [])
      .filter((row) => row.media && Object.keys(row.media).length)
      .map((row) => [normalizeCanonicalUrl(row.url), row]),
  );
  assert.equal(mediaByUrl.size, 1);
  const store = new MemoryNetworkItemStore();
  const result = await ingestSource({
    sourceUrl: 'https://pod.example.cn/rss',
    store,
    limit: 2,
    via: 'feed',
    mediaByUrl,
    fetchImpl: async () => ({ status: 200, finalUrl: 'https://pod.example.cn/rss', body: rss }),
  });
  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.content.contentType, 'audio');
  assert.equal(item.content.mediaUrl, 'https://cdn.example.cn/ep1.mp3');
  assert.equal(item.content.consumption, 'INLINE_MEDIA');
  assert.equal(item.content.durationSeconds, 3492);
});
