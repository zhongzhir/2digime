# DISCOVER-2.0-DOMESTIC-CONTENT-04

Date: 2026-09-24. Verdict: **DISCOVER_DOMESTIC_CONTENT_ACCEPTED**.

Branch: `build/discover-2-news-supply-01`; baseline `925957d`. New HEAD: the commit that adds this document. Continues after NEWS-SUPPLY-ACCEPTED. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Independent blank test Subject/Package only.

## Scope

Extend Discover from "news works" to stable discovery and consumption of real mainland-China internet content across news, ordinary/deep articles, video and audio. Focus: broaden domestic source coverage, make video directly consumable, keep article reading, and prove a real audio playback path. Not a content platform. No new search engine, no media hosting/CDN/transcoding, no new 兔机米 content protocol, no closed-platform reverse engineering, no central recommendation.

## Source Matrix (verified live 2026-09-24)

| Source | Type | Discovery mechanism | Representation | Direct consumption | Auth | Producer work | 2digime adapter |
|---|---|---|---|---|---|---|---|
| 中国新闻网 / 人民网 / IT之家 / 少数派 / 爱范儿 / 机核 (existing RSS) | news, article | public RSS/Atom | Feed body + Mozilla Readability | read | none | 0 | existing |
| 硅谷101 (`sv101.fireside.fm/rss`) | audio | public podcast RSS | `<enclosure>` MP3 (INLINE_MEDIA) | play | none | 0 | generic Feed + enclosure |
| 中国新闻网视频 (`chinanews.com.cn/shipin/`) | video | public listing HTML (`video-src`/`node-url`) | direct MP4 (INLINE_MEDIA) | play | none | 0 | one generic listing reader |
| PeerTube / Framatube | video | open public API + Media RSS | HLS manifest + official embed | official embed (OFFICIAL_EMBED); HLS not native | none | 0 | existing |
| Wikimedia Commons | video, image | open public API | direct WebM/MP4 | play | none | 0 | existing |
| iTunes Podcasts | audio | open public API + RSS | episode enclosure / preview | play (enclosure) or source fallback | none | 0 | existing |
| CCTV / 腾讯视频 / Bilibili / 优酷 / 爱奇艺 etc. | video | JS player resolved by platform-internal API | not exposed in public HTML | external-only fallback | none | 0 | none (not reverse-engineered) |

Core rule holds: `producer work = 0`, `2digime work = compatibility`. Overseas sources (PeerTube, Wikimedia, iTunes) stay compatible but are ordered after the domestic source and are not the domestic default.

## Reused mature mechanisms (Build-vs-Integrate)

| Decision | Capability | Evidence |
|---|---|---|
| REUSE | RSS/Atom/Media RSS/JSON Feed parsing | `fast-xml-parser` in `content-feed.ts` |
| REUSE | HTML parsing / metadata | `node-html-parser` in `page-metadata.ts` / `content-oembed.ts` |
| REUSE | Readability + inert jsdom article text | `@mozilla/readability` + `jsdom` in `content-resolution.ts` |
| REUSE | schema.org / OpenGraph / oEmbed media fields | `page-metadata.ts`, `content-oembed.ts`, `content-media.ts` |
| REUSE | Chromium native media playback | Electron `<video>`/`<audio>` (MP4/H.264/AAC/MP3/WebM) |
| REUSE | Official platform embed | sandboxed `<iframe>` from structured `embedUrl` only |
| INTEGRATE | Domestic podcast RSS enclosure | generic Feed + `<enclosure>` |
| INTEGRATE | Domestic public video listing | generic `video-src`/`node-url` attribute scan, no per-site article selector |
| REJECT | CCTV/Bilibili/Tencent/Youku/iQiyi internal player APIs | would require reverse engineering; kept external-only |
| REJECT | HLS/DASH playback | Chromium lacks native HLS; not faked, no hls.js added |

## Implementation

- `news-supply.ts`: added 硅谷101 (domestic podcast) to `PUBLIC_FEEDS`; bounded feed body budget raised to 4 MB so a long podcast history parses; feed media now reaches the item via a `mediaByUrl` map.
- `content-ingest.ts`: optional `mediaByUrl` attaches the rich parser's enclosure/media to the lightweight Feed path (the existing NetworkItem schema is unchanged).
- `content-feed.ts`: parse `<itunes:duration>` when the enclosure omits duration.
- `content-media.ts`: two-part clock durations (`58:12`) are read as `M:SS` (media/podcast convention), fixing a real duration bug.
- `open-source-catalog.ts`: new `media_listing` kind; the domestic video listing is registered first.
- `content-source-capabilities.ts`: `listingVideoHits` scans public `video-src`/`node-url` attributes and accepts only natively playable progressive containers; no query keyword filter (the model judges relevance).
- `content-seek.ts`: open-media items are persisted via an optional `putNetworkItem` so open/boost/reduce/follow/block can resolve them by id.
- `content-discover.ts`: `DiscoverCard` carries `mimeType`.
- `digitalme-runtime.ts`: open-media fetch is enabled by default (domestic source first); the primary seek path now passes `fetchOpenMedia` and `putNetworkItem`.
- `electron/renderer/content-discover.js` + CSS: native `<video>` playback for MP4/WebM, sandboxed official-embed `<iframe>`, and honest fallback labels ("在来源观看" / "去原平台看" / "在来源收听" / "去原平台听"). HLS/DASH are never presented as directly playable.

## Real cases (real Electron + blank Package + real DeepSeek)

Evidence: `evidence/domestic-content-04/ui.json`, `journey.json`, `feed.json`, `articles.json`; local `build/evidence/domestic-content-04/` holds screenshots, `commands.jsonl`, `model.jsonl`, `opens.jsonl`, `tests.txt`. The harness fills the real discover form and submits it; the bound handler runs the renderer `seek` -> preload IPC -> runtime path. No response is injected. Providers per query: `gemini RATE_LIMITED (429)`, `dashscope FAILED (401)`, `managed AVAILABLE (16)`.

| Query | Cards | Latency | Pool (raw / feed / search) | Direct consumption |
|---|---:|---:|---|---|
| A. 今天有什么重要科技新闻？ | 12 | 205.4s | 164 / 152 / 12 | 12 direct-read |
| B. 最近有什么值得看的 AI 深度内容？ | 6 | 104.2s | 177 / 152 / 13 | 3 direct-read |
| C. 给我找一些最近值得看的 AI 视频。 | 6 | 174.8s | 193 / 152 / 29 | 0 direct video (no openly-available domestic AI video); related AI content shown honestly |
| D. 最近有什么值得听的科技/商业音频？ | 4 | 183.2s | 167 / 152 / 15 | 2 direct `<audio>` |
| V1. 给我找几个最近值得看的视频，要能直接播放的。 | 4 | 88.1s | 136 / 116 / 20 | 4 direct `<video>` |
| V2. 给我找一些国外开源社区或 Blender 相关的视频。 | 6 | 120.5s | 184 / 152 / 32 | 6 official embed |

Direct-consumption ratio (of shown cards): A 12/12, B 3/6, D 2/4, V1 4/4, V2 6/6.

### 图文 direct read — 5 distinct domestic sites

`articles.json` (live Feed -> `resolveContent` -> Readability): 少数派 6,942 chars, 机核 2,431, 中国新闻网 915, IT之家 489, 爱范儿 461; all `readability`, with `originalPublishedAt`/provenance where the page exposes it. All >= 3 required.

### 视频 direct play (V1) — domestic

4 real China News videos rendered with native `<video>` and real durations: 同心坐标 61s, 秋分 44s, 科学家精神 307s, 新疆女孩 314s. Direct MP4 from `v-oss.cnsimg.net` / `poss-videocloud.cns.com.cn` (`video/mp4`, range-capable). No download, no re-hosting, no transcoding.

### 视频 platform fallback (V2) — official embed

6 PeerTube/Blender videos rendered with sandboxed official-embed `<iframe>` (`framatube.org/videos/embed/...`, `OFFICIAL_EMBED`). CCTV/Bilibili/Tencent video pages are resolved as external-only ("去原平台看"); no internal API was called.

### 音频 direct play (D) — domestic

2 硅谷101 episodes rendered with native `<audio>` and real durations (3,272s / 2,144s) from public `<enclosure>` MP3. The default Discover feed surfaced 12 domestic audio cards with direct playback.

### Electron UI chain

`journey.json` (article card): title shown; `直接阅读` body 3,927 chars; `阅读原文` opened the original (`opens.jsonl`); `问兔机米` carried the title/URL/body into Talk (`正在讨论：…`); `加推类似` wrote a reversible preference; return to Discover kept the cards; Digital Self unchanged; no credential file created.

## Limitations

1. Query C found no openly-available domestic AI video; it honestly offered related AI content instead of faking a video. Generic domestic video is available and directly playable (V1).
2. HLS/DASH cannot play natively in Chromium; such sources are shown as official embed or external-only, never as a fake player.
3. CCTV / Bilibili / Tencent / Youku / iQiyi video resolve only through their JS players; without an official embed or open API they stay external-only.
4. The domestic video listing is a small, current snapshot; it is not a crawler and does not enumerate a site.
5. 3 live tests fail in this environment (invalid DashScope key, missing default model credential, external-site reachability) — unrelated to this change.

## Verdict

**DISCOVER_DOMESTIC_CONTENT_ACCEPTED** against the 13 conditions: news capability not regressed (A 12 news cards); >=3 domestic article sites directly readable (5 verified); >=1 domestic video directly playable in Electron (V1); >=1 different video platform with legal official fallback (V2 PeerTube embed); >=1 domestic audio directly playable (D 硅谷101); Ask 2digime works on article and media metadata; no third-party media hosted; no new external content protocol; no closed platform reversed; no central recommendation; a single provider failure does not empty results (A returns 12 despite gemini 429 / dashscope 401); real Electron acceptance; related tests pass (336/342, 3 skipped, 3 environment-gated live failures).

## Recommended next single task

`DISCOVER-2.0-MEDIA-SOURCES-05`: add one or two more domestic open video/audio endpoints (e.g. an official open embed for a major domestic platform, and a second domestic podcast/audio Feed) so video and audio no longer depend on a single domestic listing, and evaluate whether a mature HLS player library is worth integrating for open HLS sources. No product expansion, packaging or release before that.
