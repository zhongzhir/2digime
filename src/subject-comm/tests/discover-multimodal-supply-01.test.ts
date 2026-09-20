import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { seekContent, openMediaQueries } from '../content-seek';
import { intentFromModelText, objectFidelity, defaultDiscoverIntent } from '../discover-intent';
import { ensurePersonalFeed } from '../personal-feed';
import { catalogEndpointsFor, OPEN_SOURCE_CATALOG } from '../open-source-catalog';
import { searchOpenMedia, sourceKindsForRequest } from '../content-source-capabilities';
import { hasPlayableAudioRepresentation } from '../content-media';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import type { ChatCompleteFn } from '../../subject-core/structured-distill';

const NOW = '2026-09-18T12:00:00.000Z';

function itemOf(input: {
  id: string;
  title: string;
  text: string;
  url: string;
  contentType?: 'article' | 'image' | 'audio' | 'video';
  mediaUrl?: string;
  thumbnailUrl?: string;
}): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: input.id,
    publisherSubjectId: 'pub_' + input.id,
    publisherDisplayName: 'Example Pub',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: {
      title: input.title,
      text: input.text,
      url: input.url,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

const AI_ARTICLE = itemOf({
  id: 'ni_ai_essay',
  title: 'Why open models matter this week',
  text: 'A long essay on open-weight models.',
  url: 'https://example.org/ai-essay',
  contentType: 'article',
});
const ABOUT_VIDEO = itemOf({
  id: 'ni_watchlist',
  title: 'Best AI Short Films to Watch: A 2026 Watchlist',
  text: 'A roundup of AI shorts.',
  url: 'https://example.org/news/ai-watchlist',
  contentType: 'article',
});
const PHOTO = itemOf({
  id: 'ni_photo',
  title: '航天摄影：土星环特写',
  text: 'A spacecraft photograph.',
  url: 'https://example.org/photos/saturn',
  contentType: 'image',
  mediaUrl: 'https://cdn.example.org/saturn.jpg',
});
const EPISODE = itemOf({
  id: 'ni_pod',
  title: '科技播客：芯片这一周',
  text: 'A technology podcast episode.',
  url: 'https://example.org/podcast/chips',
  contentType: 'audio',
  mediaUrl: 'https://cdn.example.org/chips.mp3',
});
const VIDEO = itemOf({
  id: 'ni_ai_video',
  title: 'A public AI short film',
  text: 'An actual short film.',
  url: 'https://example.org/watch/ai-short',
  contentType: 'video',
  mediaUrl: 'https://cdn.example.org/ai-short.mp4',
  thumbnailUrl: 'https://cdn.example.org/ai-short.jpg',
});

function chatFromScript(script: {
  intent?: Record<string, unknown>;
  roles?: Array<{ id: string; role: string }>;
}): ChatCompleteFn {
  return async ({ messages }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('判断用户在「发现」里')) {
      return { text: JSON.stringify(script.intent || { mode: 'consume', topic: 'AI', requestedContentTypes: [] }) };
    }
    if (blob.includes('判断每个候选')) {
      return { text: JSON.stringify({ roles: script.roles || [] }) };
    }
    return { text: '{}' };
  };
}

test('CONTEXTUAL FIDELITY: broad content query keeps article as PRIMARY even if model said COMMENTARY', async () => {
  const sought = await seekContent({
    query: '最近值得看的 AI 内容',
    items: [AI_ARTICLE, ABOUT_VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: [], objectWanted: 'primary_content' },
      roles: [
        { id: AI_ARTICLE.itemId, role: 'COMMENTARY' },
        { id: ABOUT_VIDEO.itemId, role: 'LISTING' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.some((card) => card.itemId === AI_ARTICLE.itemId), true);
  assert.equal(sought.cards.some((card) => card.itemId === ABOUT_VIDEO.itemId), false);
  assert.equal(objectFidelity('COMMENTARY', sought.intent), 'PRIMARY_CONTENT');
});

test('CONTEXTUAL FIDELITY: video query keeps article-about-video as ABOUT', async () => {
  const sought = await seekContent({
    query: '找几个 AI 视频看看',
    items: [VIDEO, ABOUT_VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: ['video'], objectWanted: 'primary_content' },
      roles: [
        { id: VIDEO.itemId, role: 'PRIMARY_CONTENT' },
        { id: ABOUT_VIDEO.itemId, role: 'COMMENTARY' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(sought.cards.length, 1);
  assert.equal(sought.cards[0]?.contentType, 'video');
  assert.equal(sought.relatedCards.some((card) => card.itemId === ABOUT_VIDEO.itemId), true);
});

test('CONTEXTUAL FIDELITY: image query keeps image PRIMARY; audio query keeps episode PRIMARY', async () => {
  const images = await seekContent({
    query: '航天摄影',
    items: [PHOTO, ABOUT_VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: '航天摄影', requestedContentTypes: ['image'], objectWanted: 'primary_content' },
      roles: [
        { id: PHOTO.itemId, role: 'PRIMARY_CONTENT' },
        { id: ABOUT_VIDEO.itemId, role: 'COMMENTARY' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(images.cards[0]?.contentType, 'image');
  assert.equal(images.cards.some((card) => card.contentType === 'article'), false);

  const audio = await seekContent({
    query: '科技播客',
    items: [EPISODE, ABOUT_VIDEO],
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: '科技', requestedContentTypes: ['audio'], objectWanted: 'primary_content' },
      roles: [
        { id: EPISODE.itemId, role: 'PRIMARY_CONTENT' },
        { id: ABOUT_VIDEO.itemId, role: 'LISTING' },
      ],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(audio.cards[0]?.contentType, 'audio');
  assert.equal(audio.cards.some((card) => card.contentType === 'article'), false);
});

test('SOURCE ROUTING: current search does not spray all media APIs when type is unspecified', async () => {
  let called = 0;
  const sought = await seekContent({
    query: '最近值得看的 AI 内容',
    items: [AI_ARTICLE],
    fetchOpenMedia: async () => {
      called += 1;
      return { status: 500, body: '{}', finalUrl: 'https://example.org' };
    },
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: [], objectWanted: 'primary_content' },
      roles: [{ id: AI_ARTICLE.itemId, role: 'PRIMARY_CONTENT' }],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(called, 0);
  assert.equal(sought.cards.some((card) => card.itemId === AI_ARTICLE.itemId), true);
});

test('SOURCE ROUTING: article / video / image / audio pick distinct open capabilities', async () => {
  assert.deepEqual(sourceKindsForRequest([]), ['article', 'video', 'image', 'audio']);
  assert.deepEqual(sourceKindsForRequest(['video']), ['video']);
  assert.equal(catalogEndpointsFor(['video']).some((row) => row.kind === 'peertube_search'), true);
  assert.equal(OPEN_SOURCE_CATALOG.some((row) => row.contentTypes.includes('image')), true);
  assert.equal(OPEN_SOURCE_CATALOG.some((row) => row.kind === 'itunes_podcast'), true);

  const fetchImpl = async (url: string) => {
    if (url.includes('framatube.org/api')) {
      return {
        status: 200,
        body: JSON.stringify({
          total: 1,
          data: [
            {
              name: 'AI talk',
              url: 'https://framatube.org/w/abc',
              thumbnailPath: '/t.jpg',
              embedPath: '/videos/embed/abc',
              duration: 42,
            },
          ],
        }),
        finalUrl: url,
      };
    }
    if (url.includes('commons.wikimedia.org') && url.includes('filetype')) {
      return { status: 200, body: JSON.stringify({ query: { pages: {} } }), finalUrl: url };
    }
    if (url.includes('commons.wikimedia.org')) {
      return {
        status: 200,
        body: JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Saturn.jpg',
                imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/s.jpg', mime: 'image/jpeg' }],
              },
            },
          },
        }),
        finalUrl: url,
      };
    }
    if (url.includes('entity=podcastEpisode')) {
      return {
        status: 200,
        body: JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: 'podcast-episode',
              trackName: 'Chips this week',
              trackViewUrl: 'https://podcasts.apple.com/ep/1',
              previewUrl: 'https://example.org/ep.mp3',
              trackTimeMillis: 90000,
              artworkUrl600: 'https://example.org/a.jpg',
            },
          ],
        }),
        finalUrl: url,
      };
    }
    if (url.includes('itunes.apple.com')) {
      return { status: 200, body: JSON.stringify({ resultCount: 0, results: [] }), finalUrl: url };
    }
    return { status: 404, body: '{}', finalUrl: url };
  };

  const videos = await searchOpenMedia({ query: 'AI', kinds: ['video'], fetchImpl });
  assert.equal(videos[0]?.contentType, 'video');
  assert.equal(videos[0]?.capability, 'peertube-framatube-search');
  const images = await searchOpenMedia({ query: '航天摄影', kinds: ['image'], fetchImpl });
  assert.equal(images[0]?.contentType, 'image');
  const audio = await searchOpenMedia({ query: '科技播客', kinds: ['audio'], fetchImpl });
  assert.equal(audio[0]?.contentType, 'audio');

  const routed = await seekContent({
    query: '找几个 AI 视频看看',
    items: [ABOUT_VIDEO],
    fetchOpenMedia: fetchImpl,
    chatComplete: chatFromScript({
      intent: { mode: 'consume', topic: 'AI', requestedContentTypes: ['video'], objectWanted: 'primary_content' },
      roles: [{ id: 'ignored', role: 'COMMENTARY' }],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(routed.cards.some((card) => card.contentType === 'video'), true);
  assert.equal(routed.cards.some((card) => card.contentType === 'article'), false);
});

test('PERSONAL FEED: mixed candidate types without a forced ratio or fabricated media type', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-mm-feed-'));
  const items = [AI_ARTICLE, VIDEO, PHOTO, EPISODE];
  const self: DigitalSelf = {
    schemaVersion: 1,
    subjectId: 'subj_mm',
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '我关心公开科学与影像。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: self,
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        return {
          text: JSON.stringify({
            intents: [
              { topic: 'science', contentTypes: ['article', 'video'], searchQuery: 'science', explorationMode: 'core' },
              { topic: 'image', contentTypes: ['image'], searchQuery: 'space photo', explorationMode: 'adjacent' },
              { topic: 'audio', contentTypes: ['audio'], searchQuery: 'tech podcast', explorationMode: 'explore' },
            ],
          }),
        };
      }
      const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
      return {
        text: JSON.stringify({
          decisions: [...new Set(ids)].map((itemId) => ({ itemId, decision: 'show', reason: '与你关心的公开内容有关' })),
        }),
      };
    },
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'refresh',
    now: NOW,
  });
  const types = new Set(result.view.cards.map((card) => card.contentType || 'article'));
  assert.equal(types.size >= 2, true);
  assert.equal(result.view.cards.every((card) => !card.contentType || ['article', 'video', 'image', 'audio'].includes(card.contentType)), true);
  assert.equal(result.view.cards.some((card) => card.itemId === PHOTO.itemId && card.contentType === 'article'), false);
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-feed.ts'), 'utf8');
  assert.equal(/MAX_ARTICLE|articleRatio|0\.25 \*|articles: 3/.test(src), false);
});

test('intent JSON keeps broad vs media requests distinct', () => {
  const broad = intentFromModelText(
    JSON.stringify({ mode: 'consume', topic: 'AI', requestedContentTypes: [], objectWanted: 'primary_content' }),
    '最近值得看的 AI 内容',
  );
  assert.deepEqual(broad.requestedMedia, []);
  const video = intentFromModelText(
    JSON.stringify({ mode: 'consume', topic: 'AI', requestedContentTypes: ['video'] }),
    '找几个 AI 视频看看',
  );
  assert.deepEqual(video.requestedMedia, ['video']);
  const image = intentFromModelText(
    JSON.stringify({ mode: 'consume', topic: '航天摄影', requestedContentTypes: ['摄影'] }),
    '找一些航天摄影作品',
  );
  assert.deepEqual(image.requestedMedia, ['image']);
  const audio = intentFromModelText(
    JSON.stringify({ mode: 'consume', topic: '科技', requestedContentTypes: ['播客'] }),
    '给我听点科技播客',
  );
  assert.deepEqual(audio.requestedMedia, ['audio']);
});

test('UI consumes image as visual subject, video at source, audio controls without fake 0:00', async () => {
  const ui = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  assert.equal(ui.includes("card.contentType === 'image'"), true);
  assert.equal(ui.includes('content-discover-cover--image'), true);
  assert.equal(ui.includes("type === 'video'") && ui.includes('在来源观看'), true);
  assert.equal(ui.includes("loadedmetadata"), true);
  assert.equal(ui.includes('audio.controls = true'), true);
  assert.equal(ui.includes('audio.hidden = true'), true);
  assert.equal(ui.includes("img.addEventListener('error'"), true);
  assert.equal(ui.includes("skipRender: true"), true);
  assert.equal(/0:00\/0:00/.test(ui), false);
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  assert.match(html, /img-src[^"]*https:/);
  assert.match(html, /media-src[^"]*https:/);
});

test('IMAGE: open media still runs after web articles, and full-sentence query is not the only Commons term', async () => {
  const commonsSearches: string[] = [];
  const fetchImpl = async (url: string) => {
    if (url.includes('commons.wikimedia.org')) {
      const parsed = new URL(url);
      const gsr = parsed.searchParams.get('gsrsearch') || '';
      commonsSearches.push(gsr);
      if (gsr === '找一些航天摄影作品') {
        return { status: 200, body: JSON.stringify({ query: { pages: {} } }), finalUrl: url };
      }
      return {
        status: 200,
        body: JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Earthrise.jpg',
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/e.jpg',
                    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e.jpg/1280px-e.jpg',
                    mime: 'image/jpeg',
                  },
                ],
              },
            },
          },
        }),
        finalUrl: url,
      };
    }
    return { status: 404, body: '{}', finalUrl: url };
  };
  const query = '找一些航天摄影作品';
  const intent = {
    ...defaultDiscoverIntent(query),
    requestedMedia: ['image'],
    topic: '航天摄影',
    searchQueries: [query],
  };
  const planned = openMediaQueries(query, intent);
  assert.equal(planned[0], query);
  assert.equal(planned.some((row) => row !== query), true);

  const webHits = Array.from({ length: 24 }, (_, i) => ({
    title: `航天摄影相关报道 ${i + 1}`,
    url: `https://news.example.org/space-photo-${i + 1}`,
    snippet: 'A news article about space photography.',
  }));
  const sought = await seekContent({
    query,
    items: [],
    searchWeb: async () => webHits,
    fetchOpenMedia: fetchImpl,
    chatComplete: chatFromScript({
      intent: {
        mode: 'consume',
        topic: '航天摄影',
        requestedContentTypes: ['image'],
        objectWanted: 'primary_content',
        searchQueries: [query],
      },
      roles: [],
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
  });
  assert.equal(commonsSearches.some((row) => row && row !== query), true);
  assert.equal(sought.cards.some((card) => card.contentType === 'image'), true);
  assert.equal(sought.cards.some((card) => card.contentType === 'article'), false);
  assert.equal(sought.relatedCards.some((card) => /相关报道/.test(card.title)), true);
  const image = sought.cards.find((card) => card.contentType === 'image');
  assert.ok(image?.mediaUrl || image?.thumbnailUrl);
  assert.match(String(image?.thumbnailUrl || image?.mediaUrl || ''), /https:\/\/upload\.wikimedia\.org\//);
});

test('AUDIO: episode preview is playable representation; show landing page is not', async () => {
  assert.equal(hasPlayableAudioRepresentation({ mediaUrl: 'https://example.org/ep.mp3' }), true);
  assert.equal(hasPlayableAudioRepresentation({ mediaUrl: 'https://podcasts.apple.com/podcast/id1' }), false);
  const fetchImpl = async (url: string) => {
    if (url.includes('entity=podcastEpisode')) {
      return {
        status: 200,
        body: JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: 'podcast-episode',
              trackName: 'Chips this week',
              trackViewUrl: 'https://podcasts.apple.com/ep/1',
              previewUrl: 'https://example.org/ep.mp3',
              trackTimeMillis: 90000,
            },
          ],
        }),
        finalUrl: url,
      };
    }
    if (url.includes('entity=podcast')) {
      return {
        status: 200,
        body: JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: 'podcast',
              collectionName: 'Tech Daily',
              collectionViewUrl: 'https://podcasts.apple.com/podcast/id9',
              feedUrl: 'https://example.org/tech.xml',
            },
          ],
        }),
        finalUrl: url,
      };
    }
    return { status: 404, body: '{}', finalUrl: url };
  };
  const audio = await searchOpenMedia({ query: '科技播客', kinds: ['audio'], fetchImpl });
  const episode = audio.find((row) => row.title === 'Chips this week');
  const show = audio.find((row) => row.title === 'Tech Daily');
  assert.equal(episode?.contentType, 'audio');
  assert.equal(episode?.mediaUrl, 'https://example.org/ep.mp3');
  assert.equal(show?.contentType, 'audio');
  assert.equal(show?.mediaUrl, undefined);
  assert.equal(show?.url, 'https://podcasts.apple.com/podcast/id9');
});
