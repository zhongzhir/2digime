import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOpenMedia } from '../content-source-capabilities';
import { ingestSource } from '../content-ingest';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';

test('live open media: PeerTube / Wikimedia / iTunes return concrete objects', { timeout: 60_000 }, async (t) => {
  const video = await searchOpenMedia({ query: 'science', kinds: ['video'] }).catch((err) => {
    t.skip(`video source unavailable: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    return [];
  });
  if (video.length) {
    assert.equal(video[0]?.contentType, 'video');
    assert.ok(video[0]?.url);
  }

  const image = await searchOpenMedia({ query: 'spacecraft photography', kinds: ['image'] }).catch((err) => {
    t.skip(`image source unavailable: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    return [];
  });
  if (image.length) {
    assert.equal(image[0]?.contentType, 'image');
    assert.ok(image[0]?.mediaUrl);
  }

  const audio = await searchOpenMedia({ query: 'technology podcast', kinds: ['audio'] }).catch((err) => {
    t.skip(`audio source unavailable: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    return [];
  });
  if (audio.length) {
    assert.equal(audio[0]?.contentType, 'audio');
    assert.ok(audio[0]?.url || audio[0]?.feedUrl || audio[0]?.mediaUrl);
  }

  const store = new MemoryNetworkItemStore();
  const feed = await ingestSource({ sourceUrl: 'https://framatube.org/feeds/videos.xml', store, limit: 2 });
  if (feed.items.length) {
    assert.equal(feed.items[0]?.content.contentType, 'video');
  }

  if (!video.length && !image.length && !audio.length && !feed.items.length) {
    t.skip('no open media source reachable');
  }
});
