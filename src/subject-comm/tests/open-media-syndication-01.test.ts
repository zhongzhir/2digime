import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource, parseFeed } from '../content-ingest';
import { parseJsonFeed } from '../content-feed';
import { discoverFeedHints, parsePageMetadata } from '../page-metadata';
import { parseOembedBody, resolveOEmbed } from '../content-oembed';
import { looksLikeJsonFeed } from '../content-media';
import { discoverForSubject } from '../content-discover';
import { searchContentDirectory } from '../content-directory';
import { validateNetworkItem } from '../network-item';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

const AUDIO_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Audio Pub</title>
<item>
  <title>Episode 1</title>
  <link>https://example.org/ep1</link>
  <description>A talk.</description>
  <enclosure url="https://cdn.example.org/ep1.mp3" type="audio/mpeg" length="12345"/>
</item></channel></rss>`;

const VIDEO_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Video Pub</title>
<item>
  <title>Clip</title>
  <link>https://example.org/clip</link>
  <description>A clip.</description>
  <enclosure url="https://cdn.example.org/clip.mp4" type="video/mp4" length="99"/>
</item></channel></rss>`;

const IMAGE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Image Pub</title>
<item>
  <title>Photo</title>
  <link>https://example.org/photo</link>
  <description>A photo.</description>
  <enclosure url="https://cdn.example.org/photo.jpg" type="image/jpeg"/>
</item></channel></rss>`;

const MISSING_TYPE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Unknown Pub</title>
<item>
  <title>File</title>
  <link>https://example.org/file</link>
  <description>unknown enclosure</description>
  <enclosure url="https://cdn.example.org/file.bin"/>
</item></channel></rss>`;

const UNSAFE_ENC_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Bad Pub</title>
<item>
  <title>Safe page</title>
  <link>https://example.org/safe</link>
  <description>ok</description>
  <enclosure url="javascript:alert(1)" type="audio/mpeg"/>
</item></channel></rss>`;

const MEDIA_RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>MRSS Pub</title>
<item>
  <title>Grouped video</title>
  <link>https://example.org/watch/1</link>
  <description>One item.</description>
  <media:group>
    <media:content url="https://cdn.example.org/full.mp4" type="video/mp4" medium="video" duration="72" expression="full" width="1280" height="720" isDefault="true"/>
    <media:content url="https://cdn.example.org/sample.mp4" type="video/mp4" medium="video" duration="8" expression="sample"/>
    <media:thumbnail url="https://cdn.example.org/thumb.jpg"/>
  </media:group>
  <media:player url="https://example.org/embed/1"/>
</item></channel></rss>`;

const JSON_FEED = `{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "JSON Pub",
  "home_page_url": "https://example.org/",
  "feed_url": "https://example.org/feed.json",
  "items": [{
    "id": "https://example.org/song",
    "url": "https://example.org/song",
    "title": "A song",
    "content_text": "Listen",
    "date_published": "2026-09-14T00:00:00Z",
    "authors": [{"name": "Ada"}],
    "attachments": [{
      "url": "https://cdn.example.org/song.mp3",
      "mime_type": "audio/mpeg",
      "duration_in_seconds": 180,
      "size_in_bytes": 3000
    }]
  }]
}`;

const VIDEO_HTML = `<!doctype html><html><head>
<link rel="canonical" href="https://example.org/watch/9">
<link rel="alternate" type="application/json+oembed" href="https://example.org/oembed?url=https%3A%2F%2Fexample.org%2Fwatch%2F9">
<meta property="og:title" content="OG title">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VideoObject","name":"Schema video","description":"A video","contentUrl":"https://cdn.example.org/v.mp4","embedUrl":"https://example.org/embed/9","thumbnailUrl":"https://cdn.example.org/v.jpg","duration":"PT1M12S","uploadDate":"2026-09-01T00:00:00Z","author":{"name":"Ada"}}
</script></head><body></body></html>`;

const AUDIO_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"AudioObject","name":"Schema audio","contentUrl":"https://cdn.example.org/a.mp3","duration":"PT3M"}
</script></head><body></body></html>`;

const IMAGE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ImageObject","name":"Schema image","contentUrl":"https://cdn.example.org/i.jpg","width":800,"height":600}
</script></head><body></body></html>`;

const PAID_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VideoObject","name":"Paid","contentUrl":"https://cdn.example.org/paid.mp4","requiresSubscription":true}
</script></head><body></body></html>`;

function selfOf(): DigitalSelf {
  const now = '2026-09-14T04:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId: 'subj_media',
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我关心公开音视频。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('RSS ENCLOSURE: audio/video/image MIME become contentType; missing type stays unknown; unsafe URL dropped', async () => {
  const audio = parseFeed(AUDIO_RSS).items[0]!;
  assert.equal(audio.media?.contentType, 'audio');
  assert.equal(audio.media?.mediaUrl, 'https://cdn.example.org/ep1.mp3');
  assert.equal(audio.media?.enclosureLength, 12345);
  assert.equal(parseFeed(VIDEO_RSS).items[0]!.media?.contentType, 'video');
  assert.equal(parseFeed(IMAGE_RSS).items[0]!.media?.contentType, 'image');
  const missing = parseFeed(MISSING_TYPE_RSS).items[0]!;
  assert.equal(missing.media?.mediaUrl, 'https://cdn.example.org/file.bin');
  assert.equal(missing.media?.contentType, undefined);
  const unsafe = parseFeed(UNSAFE_ENC_RSS).items[0]!;
  assert.equal(unsafe.url, 'https://example.org/safe');
  assert.equal(unsafe.media?.mediaUrl, undefined);
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/audio.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: AUDIO_RSS, finalUrl: 'https://example.org/audio.xml' }),
  });
  assert.equal(ingested.items[0]!.content.contentType, 'audio');
  assert.equal(ingested.items[0]!.content.consumption, 'INLINE_MEDIA');
  assert.equal(ingested.items[0]!.content.access, 'public');
});

test('MEDIA RSS: one item, primary full representation, thumbnail, duration, group not exploded', async () => {
  const parsed = parseFeed(MEDIA_RSS);
  assert.equal(parsed.items.length, 1);
  const item = parsed.items[0]!;
  assert.equal(item.media?.contentType, 'video');
  assert.equal(item.media?.mediaUrl, 'https://cdn.example.org/full.mp4');
  assert.equal(item.media?.thumbnailUrl, 'https://cdn.example.org/thumb.jpg');
  assert.equal(item.media?.durationSeconds, 72);
  assert.equal(item.media?.width, 1280);
  assert.equal(item.media?.embedUrl, 'https://example.org/embed/1');
  assert.equal(item.media?.mediaExpression, 'full');
  const sparse = parseFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Sparse</title>
<item><title>Audio only</title><link>https://example.org/a</link><media:content url="https://cdn.example.org/a.mp3" type="audio/mpeg"/></item></channel></rss>`).items[0]!;
  assert.equal(sparse.media?.contentType, 'audio');
  assert.equal(sparse.media?.thumbnailUrl, undefined);
  assert.equal(sparse.media?.durationSeconds, undefined);
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/mrss.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: MEDIA_RSS, finalUrl: 'https://example.org/mrss.xml' }),
  });
  assert.equal(ingested.items.length, 1);
  assert.equal(ingested.items[0]!.content.mediaProvenance, 'media_rss');
});

test('JSON FEED: autodiscovery, items, attachments, duration; malformed and unsafe rejected', async () => {
  const html = `<html><head><link rel="alternate" type="application/feed+json" href="/feed.json"></head></html>`;
  const hints = discoverFeedHints(html, 'https://example.org/');
  assert.equal(hints.some((row) => row.type === 'json' && row.url === 'https://example.org/feed.json'), true);
  assert.equal(looksLikeJsonFeed(JSON_FEED, 'application/feed+json'), true);
  assert.equal(looksLikeJsonFeed('{not a feed}', 'text/html'), false);
  const parsed = parseJsonFeed(JSON_FEED);
  assert.equal('error' in parsed, false);
  if ('error' in parsed) return;
  assert.equal(parsed.items[0]!.media?.contentType, 'audio');
  assert.equal(parsed.items[0]!.media?.durationSeconds, 180);
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.json',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: JSON_FEED, finalUrl: 'https://example.org/feed.json' }),
  });
  assert.equal(ingested.items[0]!.content.contentType, 'audio');
  assert.equal(ingested.items[0]!.content.author, 'Ada');
  const bad = parseJsonFeed('{not json');
  assert.equal('error' in bad && bad.error === 'malformed_json', true);
  const unsafe = parseJsonFeed(JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'x',
    items: [{ id: '1', url: 'https://example.org/a', title: 'a', attachments: [{ url: 'javascript:alert(1)', mime_type: 'audio/mpeg' }] }],
  }));
  assert.equal('error' in unsafe, false);
  if (!('error' in unsafe)) assert.equal(unsafe.items[0]!.media?.mediaUrl, undefined);
});

test('schema.org VideoObject / AudioObject / ImageObject and requiresSubscription', () => {
  const video = parsePageMetadata(VIDEO_HTML, 'https://example.org/watch/9');
  assert.equal(video.contentType, 'video');
  assert.equal(video.mediaUrl, 'https://cdn.example.org/v.mp4');
  assert.equal(video.embedUrl, 'https://example.org/embed/9');
  assert.equal(video.thumbnailUrl, 'https://cdn.example.org/v.jpg');
  assert.equal(video.durationSeconds, 72);
  assert.equal(video.oembedUrl, 'https://example.org/oembed?url=https%3A%2F%2Fexample.org%2Fwatch%2F9');
  const audio = parsePageMetadata(AUDIO_HTML, 'https://example.org/a');
  assert.equal(audio.contentType, 'audio');
  const image = parsePageMetadata(IMAGE_HTML, 'https://example.org/i');
  assert.equal(image.contentType, 'image');
  const paid = parsePageMetadata(PAID_HTML, 'https://example.org/paid');
  assert.equal(paid.access, 'subscriptionRequired');
  assert.equal(paid.requiresSubscription, true);
});

test('oEmbed: json video/photo, unsafe HTML rejected, fallback OPEN_SOURCE', () => {
  const video = parseOembedBody(JSON.stringify({
    type: 'video',
    title: 'Clip',
    author_name: 'Ada',
    provider_name: 'Example',
    thumbnail_url: 'https://cdn.example.org/t.jpg',
    width: 640,
    height: 360,
    html: '<iframe src="https://example.org/embed/1"></iframe>',
  }));
  assert.ok(video);
  assert.equal(video!.media.contentType, 'video');
  assert.equal(video!.embedUrl, 'https://example.org/embed/1');
  const photo = parseOembedBody(JSON.stringify({
    type: 'photo',
    url: 'https://cdn.example.org/p.jpg',
    thumbnail_url: 'https://cdn.example.org/p.jpg',
  }));
  assert.equal(photo!.media.contentType, 'image');
  const unsafe = parseOembedBody(JSON.stringify({
    type: 'video',
    html: '<iframe src="javascript:alert(1)"></iframe><script>x()</script>',
  }));
  assert.equal(unsafe!.htmlUnsafeRejected, true);
  assert.equal(unsafe!.embedUrl, undefined);
  assert.equal(unsafe!.media.consumption, 'OPEN_SOURCE');
  const xml = parseOembedBody('<oembed><type>video</type><html>&lt;iframe src="https://example.org/embed/x"&gt;&lt;/iframe&gt;</html></oembed>', 'text/xml+oembed');
  assert.equal(xml?.media.contentType, 'video');
});

test('oEmbed: HTML discovery link then JSON endpoint', async () => {
  const store = new MemoryNetworkItemStore();
  const html = VIDEO_HTML;
  const oembedJson = JSON.stringify({
    type: 'video',
    title: 'Clip',
    html: '<iframe src="https://example.org/embed/9"></iframe>',
    thumbnail_url: 'https://cdn.example.org/t.jpg',
  });
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/watch/9',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async (url: string) => {
      if (String(url).includes('oembed')) {
        return { status: 200, body: oembedJson, finalUrl: String(url) };
      }
      return { status: 200, body: html, finalUrl: 'https://example.org/watch/9' };
    },
  });
  assert.equal(ingested.items[0]!.content.contentType, 'video');
  assert.equal(ingested.items[0]!.content.embedUrl, 'https://example.org/embed/9');
  assert.equal(ingested.items[0]!.content.mediaProvenance, 'schema_org');
  const resolved = await resolveOEmbed({
    url: 'https://example.org/watch/9',
    html,
    fetchImpl: async () => ({ status: 200, body: oembedJson, finalUrl: 'https://example.org/oembed' }),
  });
  assert.equal(resolved?.embedUrl, 'https://example.org/embed/9');
});

test('DEDUP: same canonical from feed then schema/oembed stays one NetworkItem', async () => {
  const store = new MemoryNetworkItemStore();
  const first = await ingestSource({
    sourceUrl: 'https://example.org/mrss.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: MEDIA_RSS, finalUrl: 'https://example.org/mrss.xml' }),
  });
  const page = `<!doctype html><html><head>
    <link rel="canonical" href="https://example.org/watch/1">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Grouped video","description":"One item.","embedUrl":"https://example.org/embed/1"}</script>
  </head></html>`;
  await ingestSource({
    sourceUrl: 'https://example.org/watch/1',
    store,
    now: '2026-09-14T03:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: page, finalUrl: 'https://example.org/watch/1' }),
  });
  const listed = await store.list({ kind: 'content', limit: 50 }, '2026-09-14T03:00:00.000Z');
  const hits = listed.items.filter((item) => item.content.url === 'https://example.org/watch/1');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.itemId, first.items[0]!.itemId);
  assert.equal(hits[0]!.content.mediaUrl, 'https://cdn.example.org/full.mp4');
});

test('Discover pipeline: ingested video card keeps type and thumbnail', async () => {
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/mrss.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: MEDIA_RSS, finalUrl: 'https://example.org/mrss.xml' }),
  });
  const listed = await store.list({ kind: 'content', limit: 20 }, '2026-09-14T02:00:00.000Z');
  assert.equal(searchContentDirectory(listed.items, { q: 'Grouped' }).length, 1);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-media-disc-'));
  const result = await discoverForSubject({
    digitalSelf: selfOf(),
    items: ingested.items,
    chatComplete: async () => ({
      text: JSON.stringify({
        decisions: ingested.items.map((item) => ({ itemId: item.itemId, decision: 'show', reason: '公开视频' })),
      }),
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    feedbackFile: path.join(tmp, 'fb.jsonl'),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.cards[0]!.contentType, 'video');
  assert.equal(result.view.cards[0]!.thumbnailUrl, 'https://cdn.example.org/thumb.jpg');
});

test('NetworkItem optional media fields validate; javascript embed dropped', () => {
  const base = {
    schemaVersion: 1 as const,
    itemId: 'ni_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    publisherSubjectId: 'src_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    kind: 'content',
    createdAt: '2026-09-14T02:00:00.000Z',
    visibility: 'public',
    content: {
      title: 'Clip',
      text: 'A clip',
      url: 'https://example.org/clip',
      contentType: 'video' as const,
      thumbnailUrl: 'https://cdn.example.org/t.jpg',
      consumption: 'OFFICIAL_EMBED' as const,
    },
    provenance: { origin: 'publisher' as const, actor: 'owner' as const, statedAt: '2026-09-14T02:00:00.000Z' },
  };
  const ok = validateNetworkItem(base);
  assert.equal(ok.ok, true);
  const dropped = validateNetworkItem({
    ...base,
    content: { ...base.content, embedUrl: 'javascript:alert(1)' },
  });
  assert.equal(dropped.ok, true);
  if (dropped.ok) assert.equal(dropped.item.content.embedUrl, undefined);
});
