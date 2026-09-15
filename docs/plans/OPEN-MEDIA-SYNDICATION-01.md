# OPEN-MEDIA-SYNDICATION-01

**Status:** implemented  
**Date:** 2026-09-15  
**Authority:** `origin/main` `17f844ad670d28cc52a4d64e4a18fe6ce9405a00`  
**Worktree:** `D:\Projects\dm-open-media-syndication-01`  
**Branch:** `build/open-media-syndication-01`

Gate: [`docs/audits/CONTENT-SOURCE-CAPABILITY-GATE-01.md`](../audits/CONTENT-SOURCE-CAPABILITY-GATE-01.md).  
Profile: [`docs/plans/OPEN-CONTENT-PUBLISHER-PROFILE-01.md`](OPEN-CONTENT-PUBLISHER-PROFILE-01.md).

Not a recommender. Not a closed-platform crawler. Not a Discover rewrite. Not a new Content API.

---

## Build-vs-Integrate

1. Model cannot invent Media RSS / JSON Feed / oEmbed that the supplier did not publish.
2. Mature parsers already in tree: `fast-xml-parser`, `node-html-parser`, `JSON.parse`.
3. Runtime already has `ingestSource` → directory → NetworkItem → Discover.
4. New code adds missing **mechanical** fields, not a second intelligence layer.
5. Do not copy the blocked discover-branch hub crawler.

---

## REUSE

- `ingestSource` / `parseFeed` / canonicalize / `contentItemId` dedup
- `discoverFeedHints` + sitemap `fast-xml-parser`
- `parsePageMetadata` JSON-LD walker
- `safePublicHttpGet` / `assertSafePublicHttpUrl`
- `NetworkItem` `kind=content` (optional media fields only)
- Discover cards + existing renderer (thumbnail / type label; no raw oEmbed HTML)

## INTEGRATE

- RSS `<enclosure>`
- Media RSS 1.5.1 via existing `fast-xml-parser` (`ignoreAttributes: false`)
- JSON Feed 1.1 + `application/feed+json` autodiscovery
- schema.org VideoObject / AudioObject / ImageObject
- oEmbed via HTML `rel=alternate` discovery (not a handmade provider table)

## DO NOT BUILD

- MediaItem store / Content API v2 / PeerTube client / YouTube search
- WebSub / ActivityPub / payment / DRM / hosting / transcoding
- iQiyi / Tencent / Douyin / Bilibili directory scrapers
- blocked-branch commentary resolver
- proprietary `<2digime:...>` tags
