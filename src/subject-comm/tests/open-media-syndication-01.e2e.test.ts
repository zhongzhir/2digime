import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../content-ingest';
import { parsePageMetadata } from '../page-metadata';
import { resolveOEmbed } from '../content-oembed';
import { cardFromNetworkItem } from '../content-discover';
import { directoryHoldsUserData } from '../content-directory';
import type { NetworkItem } from '../network-item';
import { safePublicHttpGet } from '../../work-runtime/public-http-safety';

const EVIDENCE = path.join(process.cwd(), 'build', 'evidence', 'open-media-syndication-01');
const PEERTUBE_FEED = 'https://framatube.org/feeds/videos.xml';
const PEERTUBE_WATCH = 'https://framatube.org/w/8NKy5gzMeCKpK5nhabecoy';
const JSON_FEED = 'https://www.jsonfeed.org/feed.json';

async function writeEvidence(name: string, payload: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await fs.writeFile(path.join(EVIDENCE, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function sample(item: NetworkItem) {
  return {
    title: item.content.title,
    canonicalUrl: item.content.url || null,
    contentType: item.content.contentType || null,
    thumbnail: item.content.thumbnailUrl || null,
    mediaUrl: item.content.mediaUrl || null,
    embedUrl: item.content.embedUrl || null,
    durationSeconds: item.content.durationSeconds ?? null,
    provenance: item.content.mediaProvenance || item.provenance.via || null,
    consumption: item.content.consumption || null,
    access: item.content.access || null,
  };
}

test('real JSON Feed source parses into the directory', async (t) => {
  const store = new MemoryNetworkItemStore();
  const json = await ingestSource({ sourceUrl: JSON_FEED, store, limit: 3 });
  if (!json.items.length) {
    t.skip(`JSON Feed unavailable: ${json.records[0]?.reason || 'empty'}`);
    return;
  }
  assert.ok(json.items[0]!.content.url);
  assert.equal(directoryHoldsUserData(json.items[0]!).length, 0);
  await writeEvidence('real-json-feed.json', {
    sourceUrl: JSON_FEED,
    discoveryType: 'json_feed',
    directoryCount: json.items.length,
    sample: sample(json.items[0]!),
  });
});

test('real Media RSS / PeerTube feed becomes unified media items', async (t) => {
  const store = new MemoryNetworkItemStore();
  const feed = await ingestSource({ sourceUrl: PEERTUBE_FEED, store, limit: 5 });
  if (!feed.items.length) {
    t.skip(`PeerTube/Media RSS unavailable: ${feed.records[0]?.reason || 'empty'}`);
    return;
  }
  const item = feed.items.find((row) => row.content.mediaUrl || row.content.thumbnailUrl) || feed.items[0]!;
  assert.ok(item.content.url);
  assert.equal(directoryHoldsUserData(item).length, 0);
  await writeEvidence('real-media-rss.json', {
    sourceUrl: PEERTUBE_FEED,
    discoveryType: 'media_rss',
    directoryCount: feed.items.length,
    sample: sample(item),
  });
});

test('real schema.org VideoObject page and official oEmbed', async (t) => {
  const store = new MemoryNetworkItemStore();
  const feed = await ingestSource({ sourceUrl: PEERTUBE_FEED, store, limit: 20 });
  if (!feed.items.length) {
    t.skip(`PeerTube/Media RSS unavailable: ${feed.records[0]?.reason || 'empty'}`);
    return;
  }
  const page = await ingestSource({ sourceUrl: PEERTUBE_WATCH, store, limit: 1 });
  if (!page.items.length) {
    t.skip(`schema.org page unavailable: ${page.records[0]?.reason || 'empty'}`);
    return;
  }
  const item = page.items[0]!;
  assert.equal(item.content.url, PEERTUBE_WATCH);
  let html = '';
  try {
    const got = await safePublicHttpGet(PEERTUBE_WATCH, { accept: 'text/html' }, 3, { maxBodyBytes: 1_500_000 });
    html = got.body || '';
  } catch {
    html = '';
  }
  const meta = html ? parsePageMetadata(html, PEERTUBE_WATCH) : parsePageMetadata('', PEERTUBE_WATCH);
  assert.equal(meta.schemaType, 'VideoObject');
  assert.equal(item.content.contentType, 'video');
  assert.equal(item.content.mediaProvenance, 'media_rss');
  assert.ok(item.content.mediaUrl);
  const card = cardFromNetworkItem(item, '公开视频');
  assert.equal(card.contentType, 'video');
  await writeEvidence('real-schema-org.json', {
    sourceUrl: PEERTUBE_WATCH,
    discoveryType: 'schema_org',
    sample: sample(item),
    pageHints: {
      contentType: meta.contentType || null,
      schemaType: meta.schemaType || null,
      oembedUrl: meta.oembedUrl || null,
      thumbnailUrl: meta.thumbnailUrl || null,
      embedUrl: meta.embedUrl || null,
    },
  });
  const oem = await resolveOEmbed({ url: PEERTUBE_WATCH, html });
  if (!oem) {
    t.skip('oEmbed unavailable');
    return;
  }
  assert.ok(oem.title || oem.embedUrl || oem.thumbnail_url);
  await writeEvidence('real-oembed.json', {
    sourceUrl: PEERTUBE_WATCH,
    discoveryType: 'oembed',
    type: oem.type || null,
    title: oem.title || null,
    provider: oem.provider_name || null,
    thumbnail: oem.thumbnail_url || null,
    embedUrl: oem.embedUrl || null,
    consumption: oem.media.consumption || null,
    htmlUnsafeRejected: oem.htmlUnsafeRejected || false,
    safeEmbed: oem.embedUrl ? 'descriptor' : 'OPEN_SOURCE',
  });
  await writeEvidence('real-peertube.json', {
    sourceUrl: PEERTUBE_WATCH,
    feed: PEERTUBE_FEED,
    discoveryType: 'feed+oembed+schema_org',
    oembed: {
      title: oem.title || null,
      author: oem.author_name || null,
      provider: oem.provider_name || null,
      thumbnail: oem.thumbnail_url || null,
      embedUrl: oem.embedUrl || null,
      type: oem.type || null,
    },
    directory: sample(item),
    discoverCard: { contentType: card.contentType || null, thumbnailUrl: card.thumbnailUrl || null },
  });
});
