# CONTENT-SOURCE-CAPABILITY-GATE-01

**Status:** `CONTENT_SOURCE_CAPABILITY_GATE_ACCEPTED`  
**Date:** 2026-09-15  
**Nature:** Build-vs-Integrate / Content Source Architecture Gate  
**Worktree:** `D:\Projects\dm-content-source-capability-gate-01`  
**Branch:** `research/content-source-capability-gate-01`  
**HEAD / origin/main:** `f16951f51ade656b132be5263d120d11de65356c`

This Gate answers: **where should a consumable content object reliably come from**, and what long-lived Content Source Capability 2digime should keep.

It is **not**:

- another iQiyi scrape;
- another site-specific listing heuristic;
- a new content-product Sprint;
- an implementation of payment, DRM, AP2, wallet, or user-authenticated Chinese video.

No product code was written. No files in the blocked dirty worktree were modified.

Companion plan: [`docs/plans/OPEN-CONTENT-PUBLISHER-PROFILE-01.md`](../plans/OPEN-CONTENT-PUBLISHER-PROFILE-01.md).

---

## 0. Authority and field protection

### 0.1 Current Authority

```text
origin/main = f16951f51ade656b132be5263d120d11de65356c
```

Confirmed by `git rev-parse origin/main` and `git rev-parse HEAD` in this worktree. They are identical.

### 0.2 Blocked dirty worktree (read-only)

```text
path:   D:\Projects\dm-discover-content-consumption-01
branch: build/discover-content-consumption-01
HEAD:   1d736a9b4b09b305b0f7f59df6e4337d3c25f515
status: DIRTY  (11 files, +1052 / −95)
```

This Gate **did not** `reset` / `clean` / `stash` / `checkout` / `commit` / edit that tree. Dirty diff was read only for KEEP / DROP / REWORK / DEFER.

Uncommitted files:

```text
 M electron/renderer/content-discover.js
 M electron/renderer/index.html
 M electron/renderer/public-trial.css
 M src/intelligence/tests/discover-content-consumption-01.electron.test.ts
 M src/runtime/digitalme-runtime.ts
 M src/runtime/tests/discover-content-consumption-01.test.ts
 M src/subject-comm/content-discover.ts
 M src/subject-comm/content-object-resolve.ts
 M src/subject-comm/discover-intent.ts
 M src/subject-comm/page-metadata.ts
 M src/subject-comm/tests/discover-content-consumption-01.test.ts
```

HEAD `1d736a9` is already **4 commits ahead of origin/main**. Those committed changes are not this dirty patch. They are noted where they already contain reusable media fields, but they are **not Authority** and must not be merged without a later integration review.

### 0.3 Build-vs-Integrate answers (before any future code)

| # | Question | Answer for this Gate |
|---|---|---|
| 1 | Can the base model already produce consumable objects from a JS-shell hub HTML? | No. A 6KB shell has no objects. The model cannot invent Media RSS that the page did not publish. |
| 2 | Can an existing Agent / Tool already do the external action? | Yes for Class A (feeds) and Class B (official APIs / oEmbed). Mature parsers already exist. |
| 3 | Can current runtime already carry it? | Partially. `ingestSource` + Feed Autodiscovery + sitemap + `safePublicHttpGet` exist on main. They only materialize **article-shaped** NetworkItems. |
| 4 | Would new code add a missing capability, or replace model intelligence? | Parsing Media RSS / JSON Feed / oEmbed is a missing **mechanical** capability. Hub-page mention extraction replaces a missing supplier feed with more crawling. |
| 5 | Can existing code be deleted instead? | Yes: site-path listing heuristics, mention/secondary-search as a discovery core, and any plan to reverse-engineer closed platforms. |
| 6 | Must 2digime invent a proprietary protocol? | **NO.** |

Yellow / Red (02): DISCOVER-CONTENT-CONSUMPTION live gates failed because generic HTML cannot extract works from JS-shell hubs. Continuing scrapers would be at least Yellow. This Gate stops that line.

---

## 1. Corrected Content Source model

2digime does not care whether a candidate arrived as RSS, Media RSS, JSON Feed, ActivityPub, YouTube Data API, PeerTube REST, a user-authorized provider, or Web Search. Downstream only sees a **ConsumableContentCandidate** (mapped onto existing `NetworkItem`; see §7). Upstream, sources belong to four classes.

### CLASS A — OPEN STANDARD SOURCE

The supplier already publishes a machine-readable, publicly reachable content outlet using open Web / syndication standards:

RSS 2.0, Atom, JSON Feed, Media RSS, WebSub, oEmbed, schema.org structured data, ActivityPub.

Supplier does **not** need: a 2digime account, a 2digime proprietary API, a user-profile form, or paid recommendation inventory.

Supplier only needs: **a public, machine-readable content outlet**.

This is the **primary long-term path**.

### CLASS B — OFFICIAL PUBLIC PLATFORM API

A centralized platform publishes a documented public API, embed, or search. Examples verified in this Gate:

- YouTube Data API v3 `search.list` (`type=video`, `videoEmbeddable`)
- YouTube IFrame Player / official embed
- Vimeo oEmbed
- PeerTube public REST + oEmbed (PeerTube is also Class A via ActivityPub / feeds)

Principle: call **only** documented official capabilities. Honor quota, license, and embed restrictions. Do not scrape private / undocumented endpoints.

### CLASS C — USER-AUTHENTICATED PROVIDER

Content requires login, subscription, or paid entitlement. Future 2digime may use:

user → explicit authorization → OAuth / official API / normal browser login → content the user already has a right to access.

Hard bans: no paywall bypass, no DRM crack, no credential sharing, no forged entitlement, no unauthorized internal APIs, no automation that violates provider terms.

This Gate **defines the class**. It does **not** implement iQiyi (or any other) account access.

### CLASS D — CLOSED / UNSUPPORTED

If the public HTML is a JS shell, there is no standard metadata, no official public API, no allowed embed, and no user-authorization path:

```text
UNSUPPORTED_WITHOUT_PROVIDER_INTEGRATION
```

Stop honestly. Do not punch through with a site-specific scraper, browser reverse engineering, hidden APIs, or DRM bypass.

---

## 2. Current ingest on origin/main (what already exists)

| Capability | Location | Verdict |
|---|---|---|
| RSS 2.0 / Atom item → title / url / text / publishedAt | `src/subject-comm/content-ingest.ts` `parseFeed` | KEEP. Article syndication is already enough for **text items**. |
| Feed Autodiscovery (`rel=alternate` rss/atom/rdf) | `src/subject-comm/page-metadata.ts` `discoverFeedHints` | KEEP. JSON Feed type is **not** in `FEED_TYPES`. |
| sitemap loc via `fast-xml-parser` | `src/subject-comm/open-web-discovery.ts` | KEEP. Parser is already a dependency (`fast-xml-parser` ^5.11.1). |
| HTML preview: canonical, OG title/description, JSON-LD Article/NewsArticle/BlogPosting/WebPage, author, publisher, datePublished | `parsePageMetadata` | KEEP for Level 0–2 **article** cards. |
| RSS `<enclosure>` | none | MISSING |
| Media RSS `media:content` / `media:group` / `media:thumbnail` | none | MISSING |
| JSON Feed `application/feed+json` | none | MISSING |
| oEmbed fetch from `rel=alternate type=application/json+oembed` | none on main | MISSING on main; present on blocked discover branch |
| schema.org VideoObject / AudioObject / ImageObject `contentUrl` / `embedUrl` / `thumbnailUrl` / `duration` | none on main | MISSING on main; partial on blocked discover branch |
| NetworkItem media fields (`contentType`, `thumbnailUrl`, `embedUrl`, `mediaUrl`, `duration`, `consumptionMode`) | none on main | MISSING on main; present on blocked discover branch `network-item.ts` |
| WebSub subscriber | none | DEFER |
| ActivityPub client | none | LATER |
| YouTube / Vimeo / PeerTube official clients | none | see §5 |

`parseFeed` is still a regex XML slicer. It is good enough for RSS/Atom **article** fields. It is **not** a Media RSS parser. Next cut should reuse `fast-xml-parser` (already used for sitemap, `ignoreAttributes: false`) rather than hand-writing a namespace extension parser.

`NetworkItem` on main is article-shaped: `content.title` / `content.text` / `content.url` plus provenance. That is enough for Level 0–1. Direct consumption needs the optional media fields already prototyped on the discover branch — extend, do not invent a second schema.

---

## 3. Open standards research

Official sources only. Verdicts are NOW / NEXT / DEFER / LATER / INTEGRATE.

### 3.1 RSS 2.0 / Atom

**Sources:** RSS 2.0 (`https://www.rssboard.org/rss-specification`), Atom (`https://datatracker.ietf.org/doc/html/rfc4287`).

**Current ingest:** sufficient for article/entry syndication (title, canonical/link URL, summary, publishedAt). Live BBC / HN style feeds already round-trip through `ingestSource`.

**Gap:** `<enclosure url type length>` is in RSS 2.0 and is the historical podcast / image path. `parseFeed` ignores it.

**Verdict:** KEEP current article path. NEXT: read enclosure when present. Do not rewrite the ingest pipeline.

### 3.2 Media RSS 1.5.1 — recommended multimedia supplier standard

**Official spec:** [Media RSS 1.5.1](https://www.rssboard.org/media-rss) (RSS Advisory Board; namespace `http://search.yahoo.com/mrss/`).

A supplier **can** put all of the following in one standard feed:

| Need | Spec element / attribute |
|---|---|
| video / image / audio | `media:content@media` = `video` \| `image` \| `audio` |
| media URL | `media:content@url` |
| MIME | `media:content@type` |
| duration | `media:content@duration` (seconds) |
| thumbnail | `media:thumbnail@url` |
| player / embed | `media:player@url` |
| group of renditions | `media:group` containing multiple `media:content` |
| sample vs full | `media:content@expression` = `sample` \| `full` \| `nonstop` |
| license / restriction | `media:license`, `media:restriction` |
| price (signal only) | `media:price` — **not** a payment protocol |

This is exactly the missing object model behind DISCOVER's failed “I want to watch X” path: a feed item that **is** a video/image/audio object, not a news URL that mentions one.

**Integrate, do not hand-write a second XML stack.** `fast-xml-parser` is already in `package.json` and already constructed with `ignoreAttributes: false`. That is enough to read `media:content` / `media:thumbnail` / `media:group`. Do not add a Media RSS npm if the existing parser already exposes the namespace.

**Verdict:** INTEGRATE as **the** recommended Class A multimedia outlet. NOW for architecture; NEXT for code (`OPEN-MEDIA-SYNDICATION-01`).

### 3.3 JSON Feed 1.1

**Official spec:** [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/). MIME: `application/feed+json`.

Relevant fields:

- item `url` / `id` / `title` / `content_text` | `content_html` / `date_published` / `authors` / `language` / `image`
- `attachments[]`: `url`, `mime_type`, `title`, `size_in_bytes`, `duration_in_seconds`
- top-level `hubs[]` (`type` + `url`) — WebSub discovery, not a reason to implement WebSub now
- autodiscovery: `<link rel="alternate" type="application/feed+json" href="...">` (same pattern as RSS; currently excluded by `FEED_TYPES`)

JSON Feed is the JSON peer of RSS/Atom. Attachments already carry audio/video/image without XML namespaces. Parsing is `JSON.parse` plus the existing canonicalize/ingest path.

**Verdict:** NEXT, in the same syndication cut as Media RSS. Not DEFER: the cost is small and it is an official open outlet. Not NOW as a separate Sprint.

### 3.4 oEmbed

**Official spec:** [oEmbed](https://oembed.com/).

oEmbed is **not** a discovery protocol. It is:

```text
known content URL
  → provider oEmbed endpoint (often advertised as rel=alternate type=application/json+oembed)
  → standard representation (html / type=video|photo|rich, thumbnail_url, title, author_name)
```

That maps cleanly to consumption:

```text
ContentItem → oEmbed → OFFICIAL_EMBED or INLINE_MEDIA
```

It does not replace RSS/JSON Feed, and it cannot find “AI videos” from a blank query. It **does** turn a PeerTube / YouTube / Vimeo / Flickr URL the user already has into an embeddable object.

Discover branch already has `discoverOembedUrl` + fetch. Main does not.

**Verdict:** INTEGRATE as a **consumption-layer** capability for known URLs. NEXT, after (or with) Media RSS ingest so there is something to embed. Do not treat oEmbed as a search engine.

### 3.5 schema.org

**Official types used in this Gate:** [VideoObject](https://schema.org/VideoObject), [AudioObject](https://schema.org/AudioObject), [ImageObject](https://schema.org/ImageObject), [Article](https://schema.org/Article), [CreativeWork](https://schema.org/CreativeWork), plus Episode / TVSeries / TVEpisode where publishers emit them.

| Field | Purpose | main today |
|---|---|---|
| `contentUrl` | direct media file | no |
| `embedUrl` | official player | no |
| `thumbnailUrl` / `image` | card art | no (OG image also unused on main) |
| `duration` | ISO 8601 | no |
| `requiresSubscription` | access hint | no |
| `license` / `usageInfo` | rights hint | no |
| `publisher` / `author` | attribution | Article path yes |
| `headline` / `datePublished` | card | Article path yes |

`parsePageMetadata` currently `pickArticle`s NewsArticle / Article / BlogPosting / WebPage and **drops** VideoObject/AudioObject/ImageObject as first-class types.

**Verdict:** NEXT — extend the existing JSON-LD walker; do not add a second metadata engine. `requiresSubscription` maps to access flags, not to a paywall bypass.

### 3.6 WebSub

**Official spec:** [W3C WebSub](https://www.w3.org/TR/websub/).

```text
Feed discovery ≠ WebSub
WebSub = publisher notifies hub → subscriber receives the update
```

JSON Feed 1.1 even advertises `hubs[]` for this. It is the standards path to **replace polling**, not a way to find unknown suppliers.

**Verdict:** LATER / DEFER. Do not implement a subscriber in the next cut. Keep it as Publisher Profile Level 4.

### 3.7 ActivityPub

**Official spec:** [W3C ActivityPub](https://www.w3.org/TR/activitypub/). PeerTube's use: [PeerTube ActivityPub](https://docs.joinpeertube.org/api/activitypub) — public `Video` objects with attached files / streaming playlists, plus inbox/outbox federation.

ActivityPub is the realistic **decentralized content supply network** protocol. It is also an entire protocol stack (actors, inbox, HTTP signatures, collections). Implementing a generic AP client now would violate Capability Sufficiency: PeerTube already exposes the same public videos over REST + oEmbed.

**Verdict:** LATER as a first-class protocol implementation. NEXT-compatible via PeerTube REST/oEmbed and via any AP-speaking server that also publishes RSS/oEmbed. Do not build an ActivityPub stack because the spec is powerful.

---

## 4. What the open stack already covers by media type

| Type | Sufficient open stack | Notes |
|---|---|---|
| **Article** | RSS / Atom / JSON Feed + OG + schema.org Article | Already on main. |
| **Image** | RSS enclosure **or** Media RSS `medium=image` **or** JSON Feed attachment `image/*` **or** schema.org ImageObject `contentUrl` | No commercial image platform required. |
| **Audio** | same + `medium=audio` / `audio/*` / AudioObject | Podcasts are already this. |
| **Video** | Media RSS `medium=video` + `media:player` **or** JSON Feed video attachment **or** schema.org VideoObject `contentUrl`/`embedUrl` **or** oEmbed type=video **or** PeerTube REST/oEmbed **or** YouTube official API/embed | Closed Chinese video hubs are **not** this. |
| **Comic / 漫剧** | There is no separate open “manhua protocol”. A chapter/episode is an Article, ImageObject sequence, VideoObject, or Media RSS item with a stable canonical URL. | If a platform only offers a JS shell and no feed/API/embed, it is Class D. |

2digime does **not** need a proprietary comic protocol.

---

## 5. Mature system benchmarks

### 5.1 PeerTube — open video reference implementation

**Official docs:** [REST API](https://docs.joinpeertube.org/api-rest-reference.html), [ActivityPub](https://docs.joinpeertube.org/api/activitypub), embed/oEmbed in the same docs set.

Verified public capabilities (unauthenticated, instance-public videos):

- list / search: `GET /api/v1/videos`, `GET /api/v1/search/videos`
- object: `GET /api/v1/videos/{id|uuid|shortUUID}`
- oEmbed: `/services/oembed?url=...`
- public file / streaming playlist URLs on public videos
- ActivityPub `Video` objects for federation
- authentication boundary: private / unlisted / password / premium videos are **not** public

**Question:** if a supplier wants to bypass centralized video platforms and run PeerTube (or equivalent), can 2digime discover and consume with near-zero friction?

**Answer: YES**, provided the instance and the videos are public. Discovery = REST search/list or the instance's RSS/JSON Feed. Consumption = oEmbed or HTML5 file/playlist URLs. No 2digime account, no scrape, no reverse engineering.

PeerTube is the **open video reference implementation** 2digime should stay compatible with. Compatibility means Class A + Class B against documented surfaces, not a PeerTube fork.

### 5.2 YouTube — official Class B supplement

**Official:** [search.list](https://developers.google.com/youtube/v3/docs/search/list), [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [player parameters](https://developers.google.com/youtube/player_parameters), [quota](https://developers.google.com/youtube/v3/getting-started#quota).

Can 2digime go from “我要看 AI 视频” → video objects via official API, instead of searching news pages and guessing?

**Yes, officially:**

- `search.list` with `q`, `type=video`, `videoEmbeddable=true`, `part=snippet`
- each item is a video id + title + channel + thumbnails
- playback via documented iframe embed (`https://www.youtube.com/embed/{videoId}`), subject to embeddable / age / geo restrictions the API already exposes

**Cost:** API key required. Default quota 10,000 units/day; `search.list` costs **100 units**, so about **100 searches/day** per project before extra quota. That is a product/ops decision, not a scrape decision.

**Verdict:** INTEGRATE as Class B **supplement**, not as the open supply chain. DEFER the actual client to after Class A media syndication works, unless Owner explicitly wants YouTube in the next cut. Never scrape `youtubei` / InnerTube.

### 5.3 Vimeo

**Official:** [oEmbed](https://developer.vimeo.com/api/oembed) (`https://vimeo.com/api/oembed.json?url=`), [Vimeo API](https://developer.vimeo.com/api/reference).

- **Known URL → ContentItem:** YES via oEmbed (title, thumbnail, HTML embed). Unauthenticated for public videos.
- **Catalog / search:** Vimeo API is authenticated (access token). Public oEmbed is not a search API.

**Verdict:** INTEGRATE oEmbed for known public Vimeo URLs (same consumption layer as YouTube/PeerTube). Catalog search is DEFER (token + terms).

### 5.4 Open image / audio path (no commercial platform)

A public photographer, podcaster, or museum already has enough if they publish:

1. RSS 2.0 with `<enclosure>` and/or Media RSS `media:content`, or
2. JSON Feed with `attachments`, or
3. a page with schema.org ImageObject / AudioObject `contentUrl`.

That is sufficient to form `contentType=image|audio` ConsumableContentCandidates. **No** Flickr/Unsplash commercial contract is required for the architecture to be true. Optional Class B image hosts can be added later via oEmbed if they offer it.

---

## 6. Chinese centralized platforms — classification only

No reverse engineering. No hidden-API mapping. If official consumer-facing evidence was not found in this Gate, the cell is **UNKNOWN**.

| Platform | PUBLIC_OFFICIAL_CONTENT_API | PUBLIC_EMBED | USER_AUTH_SUPPORTED | OPEN_SUPPLIER_FRIENDLY | CURRENT_2DIGIME_STRATEGY |
|---|---|---|---|---|---|
| **爱奇艺** | **LIMITED** — [爱奇艺号开放平台](https://creator-open.iqiyi.com/api-reference) is creator **upload / own-video search / stats** with API Token, not a public catalog for consumers. Older 视频云 OpenAPI similarly covers upload of *the caller's* files. No official unauthenticated “search all iQiyi titles as video objects” API was found. | **UNKNOWN** — no official public embed spec found in this audit. | **UNKNOWN** for *consumer watch* OAuth. Creator Token exists for upload. Advertising OAuth (奇麟) is ads, not content. | **NO** | **unsupported** for unauthenticated discovery (Class D). Class C only if a future official consumer-auth path is documented. |
| **腾讯视频** | **UNKNOWN** as a public consumer catalog API. Cloud / 腾讯云点播 OpenAPI is the caller's own media, not Tencent Video's catalog. | **LIMITED** — official player/embed documents exist for licensed / 云点播 players; not a general “embed any Tencent Video title” grant. | **UNKNOWN** | **NO** | **unsupported** without provider integration; do not scrape `v.qq.com` JS shells. |
| **优酷** | **LIMITED** — 优酷 / 阿里云点播 OpenAPI is the caller's own cloud videos. | **LIMITED** — documented embed for 云点播 / 开放播放器, not a blanket Youku catalog embed. | **UNKNOWN** | **NO** | **unsupported** without provider integration. |
| **Bilibili** | **LIMITED** — [开放平台](https://openhome.bilibili.com/doc) is app/login/user-authorized, not an anonymous public catalog equivalent to YouTube Data API. | **YES / LIMITED** — documented `player.bilibili.com/player.html` iframe for a known `aid`/`bvid`. That is consumption of a **known** id, not discovery. | **YES** via open platform OAuth (user-authorized apps). | **LIMITED** | known-URL official embed: Class B later. Catalog search: **user-authorized later** or **unsupported**. No HTML scrape. |
| **抖音** | **LIMITED** — Douyin OpenAPI is creator/user-authorized (publish, user data), not an anonymous content catalog. | **LIMITED** — official iframe-by-videoid exists in Douyin open docs for authorized / known videos. | **YES** (OAuth). | **NO** | **user-authorized later**; unauthenticated discovery **unsupported**. |
| **快手** | **LIMITED** — open platform is OAuth + publish, not a public catalog. | **UNKNOWN** | **YES** (OAuth). | **NO** | **user-authorized later**; unauthenticated **unsupported**. |
| **小红书** | **LIMITED** — public docs emphasize e-commerce / OAuth, not a public note/video catalog API. | **UNKNOWN** | **YES** (OAuth for listed scopes). | **NO** | **unsupported** for open discovery; **user-authorized later** only if official content scopes exist. |

**Summary:** none of these seven is Class A. None is YouTube-like Class B public search. Most are Class D for *open* discovery and possibly Class C later via official OAuth. **OPEN_SUPPLIER_FRIENDLY = NO** across the board: a creator who wants 2digime users to consume their work without a platform account should publish on the open stack (or PeerTube / own site with Media RSS), not wait for 2digime to parse a JS shell.

---

## 7. ConsumableContentCandidate — architecture only

Do **not** change `NetworkItem` schema in this Gate. Map onto what exists.

Suggested semantic (runtime projection, not a new store):

```text
contentId
contentType            article | video | image | audio | work | page
title
creator
publisher
canonicalUrl
thumbnail
publishedAt
duration
consumption            INLINE_MEDIA | OFFICIAL_EMBED | OPEN_SOURCE | AUTH_REQUIRED | PAID | UNSUPPORTED
media.contentUrl
media.embedUrl
media.mimeType
provenance.sourceType  CLASS_A | CLASS_B | CLASS_C | CLASS_D | SEARCH
provenance.sourceUrl
provenance.provider
provenance.discoveryMethod   feed | sitemap | page | autodiscovery | search | official_api | oembed | activitypub
access.public | loginRequired | subscriptionRequired | geoRestriction
```

### Mapping to current objects

| Candidate field | origin/main `NetworkItem` | discover-branch extras (not Authority) |
|---|---|---|
| contentId | `itemId` | same |
| title / canonicalUrl | `content.title` / `content.url` | same |
| publisher | `publisherDisplayName` / `publisherSubjectId` | same |
| publishedAt | `createdAt` (from feed date) | `content.publishedAt` |
| creator | — | `content.author` |
| contentType / thumbnail / embed / media / duration / consumption | — | optional `content.*` fields already drafted |
| provenance.discoveryMethod | `provenance.via` (`search` \| `feed` \| `sitemap` \| `page` \| `autodiscovery`) | extend via later: `official_api` / `oembed` |
| consumption AUTH_REQUIRED / PAID / UNSUPPORTED | — | **do not** ship as ranking; they are access honesty |

Reuse `NetworkItem`. Add optional media fields when the next task lands — the discover branch already prototyped them. Do **not** create `ContentItem` v2 as a second truth.

Search remains a **discovery method**, not a content class. A Gemini/Bing URL is Class A if the landed page has a feed/schema/oEmbed, Class B if it is an official API hit, Class D if it is a JS shell.

---

## 8. Future paid layer — boundary only

Two layers, never mixed:

```text
FREE PUBLIC CONTENT     Class A / public Class B
PAID / SUBSCRIPTION     Class C + future commercial layer
```

A future paid layer may need identity, entitlement, payment, receipt, settlement, provider authorization. Suppliers may then get a more direct user relationship, lower platform take-rate, and their own pricing.

**This Gate does not develop:** payment, AP2, wallet, settlement, DRM, paid player.

`media:price`, schema.org `requiresSubscription`, and `consumption: PAID` are **signals**. They are not an entitlement system.

---

## 9. Blocked dirty patch audit (`1d736a9` working tree)

Audit of the **uncommitted** +1052/−95 only. Committed discover-branch work (media fields, oEmbed discovery, consumption-capability) is reusable later but is not this patch.

### KEEP

| Item | Why |
|---|---|
| `consume` vs `research` intent (`interpretDiscoverIntent`) | Model-owned contextual role. Not a keyword router. Matches 01: system must not classify the task type. |
| `objectWanted` work_itself vs commentary | Stops news from impersonating the work under consume intent. |
| `classifyCandidateRoles` PRIMARY / SERIES / EPISODE / HUB / LISTING / COMMENTARY | Model classification of **page role relative to this request**. Thin JSON contract, no score. |
| Commentary → `relatedReports`, not primary cards | Honest UI separation. |
| Popularity honesty note | “没有跨平台统一播放榜” — required honesty, not a fake ranker. |
| Empty `keep` respected (`filterConsumableCandidates` treats `keep: []` as empty, not as “keep all”) | Failed live gate taught the opposite bug. |
| Bounded fetch budget, SSRF via `safePublicHttpGet`, HTTPS resource checks | Mechanical safety. |
| Hub path that follows **Feed Autodiscovery / RSS / Atom / sitemap XML** | This *is* Class A reuse. |
| Redirect wrapper that lands on the object URL (not outbound news links) | Generic, low risk, still one hop. |
| `relatedReports` renderer projection | Display only. |

### DROP

| Item | Why |
|---|---|
| `extractMentionedObjects` + `searchWeb` secondary search as object discovery | Extra planner. Turns a JS shell into “guess titles then search again”. That is deeper crawling, not a missing standard. Yellow against 02 L1/L2. |
| `extractPageLinkCandidates` HTML `<a>` harvest as the primary way through a listing hub | On a JS shell this yields 0 links (already observed). On a full HTML listing it is a mini-crawler. Not a supplier standard. |
| Site-path specials in `isLikelyListingUrl`: `comicdrama`, `/u/record`, `/webs`, `youtube.com/t`, Google Play `store/apps` | Case patches for named sites. 02 L2. Generic `/`, `/search`, `/rank*` may stay as mechanical URL shape checks. |
| Using leftover PRIMARY/COMMENTARY rows as fallback hubs to crawl | Recursively expands the same closed pages. |
| Any future iQiyi / Tencent / Kuaikan HTML rule | Class D. |

### REWORK

| Item | How |
|---|---|
| Web Search as the **primary** way to get video/comic objects | Search stays as a way to **find Class A/B outlets** (feed URLs, PeerTube instances, YouTube video ids). It must not be the object factory. |
| Hub resolution | Keep depth=1, timeout, max N. Restrict expansion to: autodiscovered feed, RSS/Atom/JSON Feed body, JSON-LD ItemList, oEmbed, official API. If none: honest empty + relatedReports. |
| `isLikelyListingUrl` | Keep homepage / search-query / `rank` path as a **display safety net**. Stop growing a per-site path dictionary. Do not override a model `PRIMARY_CONTENT` on a grounding redirect solely because the URL “looks like a hub”. |
| `filterConsumableCandidates` readable-article fallback inside `finish()` | Keep for `requestedMedia` article. Do not use it to refill consume-video with leftover commentary. |

### DEFER

| Item | Until |
|---|---|
| YouTube Data API client | After Class A media syndication, plus an explicit key/quota decision. |
| Vimeo catalog API | Token + terms review. |
| WebSub subscriber | Publisher Profile Level 4 demand. |
| ActivityPub client | After PeerTube REST/oEmbed is actually used. |
| Class C Chinese platforms | Official consumer-auth docs + Owner authorization UX. |
| Merging `build/discover-content-consumption-01` into Authority | Separate integration review; this Gate is not that merge. |

---

## 10. Core strategy answers

### 1. Recommended supply stack for the free open content ecology

```text
REQUIRED-ish (Level 0–1): HTTPS URL + title + canonical
RECOMMENDED discovery:     RSS 2.0 / Atom / JSON Feed 1.1 + autodiscovery + sitemap
RECOMMENDED richness:      Media RSS 1.5.1 and/or schema.org Video/Audio/Image/Article + OpenGraph
RECOMMENDED consumption:   oEmbed and/or HTML5 media URL and/or official embed / media:player
OPTIONAL realtime:         WebSub
OPTIONAL federation:       ActivityPub (PeerTube as the video reference)
SUPPLEMENT (Class B):      YouTube Data API + official embed; Vimeo oEmbed
NEVER as supply chain:     JS-shell scrape of closed catalogs
```

### 2. Are these protocols already enough for article / image / video / audio / comic?

**Yes**, if the supplier publishes them. See §4. Comics/漫剧 are not a fifth protocol; they are episodes/pages/images/videos with stable URLs.

### 3. Invent a 2digime proprietary base protocol?

**NO.** The audit did not find an unavoidable gap that RSS + Media RSS + JSON Feed + oEmbed + schema.org + ActivityPub (later) cannot express. A “2digime Open Content Publisher Profile” is a **conformance profile over existing standards**, not a new protocol.

### 4. PeerTube / ActivityPub as the decentralized video direction?

**PeerTube: YES** as the open video reference (REST + oEmbed now; ActivityPub compatibility later).  
**ActivityPub as a full client: LATER**, not the next cut.

### 5. YouTube (and similar) via official API as a supplement?

**YES — INTEGRATE as Class B**, with key/quota cost, not as the open supply chain. DEFER the client until Class A media ingest exists, unless Owner prioritizes it.

### 6. User's own paid-platform accounts?

**USER_AUTHENTICATED_PROVIDER (Class C).** Not the open content supply chain. Future, authorized, official APIs only.

### 7. Why would a supplier bother?

**Current real value (can be said now):** more visits / discovery opportunity among 2digime users who open the **original URL**. Zero registration.

**Long-term potential (must not be written as shipped):** direct user relationship, lower platform take-rate, sovereignty over content and audience, future direct charge/settlement.

Do not market the long-term layer as Public Alpha fact.

### 8. Why 2digime must not become another central content platform

Constitution 00: the innovation is **moving the selection algorithm onto the user's Digital Self**. A central ranking inventory, a supplier portal that sells attention, or a 2digime-hosted video CDN would recreate the thing 2digime exists to escape. 2digime discovers and normalizes **candidates**; each recipient's 2digime decides SHOW / IGNORE. Full copyrighted bodies are not re-hosted by default.

### 9. What must be centralized vs what must never be

| Must be able to live centrally (mechanical, shared) | Must never be centralized |
|---|---|
| Public candidate directory: canonical URL, title, source, optional public media metadata | User interest profile / Digital Self |
| Protocol adapters (RSS, Media RSS, JSON Feed, oEmbed, official APIs) | Selection / ranking / “for you” |
| Safety: SSRF, robots, quota, license, embed restriction, auth gates | User credentials for Class C providers (stay on the user's machine / user-granted token store) |
| Honesty: UNSUPPORTED, PAID, AUTH_REQUIRED flags | Entitlement to paid catalogs (user+provider, not 2digime-as-store) |
| Neutral provenance: how the URL was found | Recommendation inventory sold to suppliers |

---

## 11. What CONTENT-SUPPLIERS.md should change next (not in this Gate)

Current `CONTENT-SUPPLIERS.md` (Public Alpha 2026-09-15) is correct that RSS/Atom + autodiscovery + sitemap + OG + schema.org Article are the default, and that there is no supplier portal.

Next public revision should add, without promising unshipped code:

1. Media RSS and JSON Feed as **recommended** multimedia / JSON outlets.
2. oEmbed as the way a known URL becomes playable.
3. schema.org VideoObject / AudioObject / ImageObject, not only Article.
4. Honest Class C / Class D: closed platforms are not “supported” just because search can find their homepage.
5. A pointer to Open Content Publisher Profile levels 0–4.
6. PeerTube (or any public ActivityPub video host) as an example of an open video supplier.
7. Explicit: 2digime will not scrape JS shells or unofficial APIs to fake a catalog.

**This Gate does not edit the public file.**

---

## 12. NEXT_RECOMMENDED_TASK (do not execute here)

```text
OPEN-MEDIA-SYNDICATION-01
```

Not `CONTENT-SOURCE-ADAPTER-FOUNDATION-01`: `ingestSource` already is the adapter. A new adapter layer would be a second ingestion path.

Not another DISCOVER hub-crawler.

### Why this first

The strategic hole is not “more HTML heuristics”. It is: **Class A feeds cannot yet carry video/image/audio into NetworkItem**. Until that is true, every consume-video query falls back to Web Search + JS shells and fails honestly or dishonestly.

### Reuse

- `ingestSource` / `parseFeed` / canonicalize / directory / Discover cards
- `fast-xml-parser` already in dependencies (do not add a Media RSS library unless the existing parser cannot expose `media:*`)
- `discoverFeedHints` (add `application/feed+json`)
- `parsePageMetadata` JSON-LD walker (add VideoObject / AudioObject / ImageObject)
- optional media fields already prototyped on `build/discover-content-consumption-01` `network-item.ts` — port the **fields**, not the hub crawler

### Integrate

- Media RSS 1.5.1 via existing XML parser
- RSS `<enclosure>`
- JSON Feed 1.1 + autodiscovery
- oEmbed fetch for known URLs (consumption)
- schema.org media objects on public pages

### Do not

- iQiyi / Tencent / Youku / Douyin / Kuaishou / Xiaohongshu scrape
- YouTube unofficial clients
- WebSub subscriber
- ActivityPub stack
- payment / DRM / Class C
- `extractMentionedObjects` / secondary search
- site-specific `isLikelyListingUrl` growth
- a 2digime proprietary feed format

### Suggested follow-ups (later, not this next cut)

1. `YOUTUBE-OFFICIAL-SEARCH-01` — Class B, key/quota explicit.
2. `PEERTUBE-PUBLIC-CLIENT-01` — thin REST/oEmbed against public instances.
3. Discover-branch KEEP slice integration (roles, relatedReports, popularity honesty, empty keep) **without** DROP items.

---

## 13. Workspace and git

This Gate is docs only. Allowed commit:

```text
docs(content): audit open content source capabilities
```

No push. Blocked dirty worktree untouched.

**Verdict:** `CONTENT_SOURCE_CAPABILITY_GATE_ACCEPTED`
