# OPEN-CONTENT-PUBLISHER-PROFILE-01

**Status:** plan / v0.1 profile  
**Date:** 2026-09-15  
**Authority for this research:** `origin/main` `f16951f51ade656b132be5263d120d11de65356c`  
**Gate:** [`docs/audits/CONTENT-SOURCE-CAPABILITY-GATE-01.md`](../audits/CONTENT-SOURCE-CAPABILITY-GATE-01.md)

This is **not** a 2digime proprietary protocol.

It is a conformance profile:

> If you already use these existing open standards, 2digime can discover and consume your content more reliably.

Suppliers are never required to implement every level. Richer standards produce a more complete experience. The floor remains ordinary public Web.

2digime does not ask suppliers to register, fill a user-profile form, adopt a 2digime SDK, or buy recommendation inventory.

---

## 0. Principles

1. **Standards, not a portal.** The public Web is the default eligible universe.
2. **Discovery ≠ consumption ≠ entitlement.** A URL can be discoverable and still AUTH_REQUIRED / PAID / UNSUPPORTED to play.
3. **Original URL stays canonical.** 2digime indexes metadata and sends the user back to the source. It does not re-host copyrighted media by default.
4. **Selection stays on the recipient's Digital Self.** Publishing into this profile does not purchase a user's hidden interests.
5. **No scrape contract.** If a site is only a JS shell with no outlet below, 2digime will not reverse-engineer it. That is `UNSUPPORTED_WITHOUT_PROVIDER_INTEGRATION`.

Current Public Alpha value of publishing this way: **visits and discovery opportunity**.

Long-term potential (not shipped): direct user relationship, lower platform take-rate, sovereignty over content and audience, future direct charge/settlement. Do not describe those as current product facts.

---

## 1. Open Content Publisher Profile v0.1

### LEVEL 0 — BASIC WEB

Minimum for 2digime to form a basic candidate:

- public `https` URL
- a title (`<title>` or OpenGraph `og:title` or schema.org `headline` / `name`)
- a stable canonical URL (`<link rel="canonical">` or `og:url`)

2digime can **basically discover** the page (search hit or pasted URL → HTML preview). Consumption is usually `OPEN_SOURCE` (open the original page). No promise of inline play.

### LEVEL 1 — DISCOVERABLE

Recommended so 2digime can **keep finding updates** without crawling the site:

- public **RSS 2.0** and/or **Atom** and/or **JSON Feed 1.1**
- standard **Feed Autodiscovery** in HTML:

```html
<link rel="alternate" type="application/rss+xml" title="Feed" href="https://example.org/feed.xml">
<link rel="alternate" type="application/atom+xml" title="Atom" href="https://example.org/atom.xml">
<link rel="alternate" type="application/feed+json" title="JSON Feed" href="https://example.org/feed.json">
```

- optional **sitemap** (`robots.txt` `Sitemap:` or `/sitemap.xml`)
- each item has a stable item URL that should be the canonical URL of the work

2digime already ingests RSS/Atom on current Authority. JSON Feed autodiscovery is specified here; product support is the next syndication cut, not a new protocol.

### LEVEL 2 — RICH CONTENT

Recommended so 2digime can build a **high-quality content card** (not just a blue link):

| Field | Open standard |
|---|---|
| thumbnail | Media RSS `media:thumbnail`, JSON Feed `image` / item `image`, OpenGraph `og:image`, schema.org `thumbnailUrl` / `image` |
| duration | Media RSS `media:content@duration`, JSON Feed attachment `duration_in_seconds`, schema.org `duration` |
| author / creator | RSS/Atom author, JSON Feed `authors`, schema.org `author` |
| publisher | feed title / `og:site_name` / schema.org `publisher` |
| publishedAt | `pubDate` / `published` / JSON Feed `date_published` / schema.org `datePublished` |
| type | Media RSS `medium`, attachment `mime_type`, schema.org `@type` (Article, VideoObject, AudioObject, ImageObject, Episode, TVSeries, …) |
| language | JSON Feed `language`, `hreflang`, schema.org `inLanguage` |

Also recommended: OpenGraph (`og:title`, `og:description`, `og:type`, `og:url`) and schema.org JSON-LD on the canonical page.

2digime does **not** require a proprietary taxonomy. Existing tags may stay on the source site.

### LEVEL 3 — DIRECT CONSUMPTION

Recommended so 2digime can play or show the object **on the Discover surface** without pretending to host it:

Pick any one (more is better):

1. **HTML5 media URL** — publicly fetchable `https` `contentUrl` / Media RSS `media:content@url` / RSS `<enclosure>` / JSON Feed `attachments[].url` with a real `video/*`, `audio/*`, or `image/*` MIME. Maps to `INLINE_MEDIA`.
2. **Official embed** — `media:player`, schema.org `embedUrl`, or a documented iframe (YouTube, Vimeo, PeerTube, Bilibili known-id player, …). Maps to `OFFICIAL_EMBED`. Honor the provider's embed restrictions.
3. **oEmbed** — advertise:

```html
<link rel="alternate" type="application/json+oembed"
      href="https://example.org/oembed?url=https%3A%2F%2Fexample.org%2Fwatch%2F123">
```

oEmbed is not how 2digime **finds** you. It is how 2digime **renders** a URL it already has.

If none of these exist, 2digime still opens the canonical URL (`OPEN_SOURCE`). It will not scrape a player out of a JS bundle.

### LEVEL 4 — REAL-TIME / FEDERATED

Optional, for suppliers who want to join a decentralized distribution network or push updates:

- **WebSub** — publisher → hub → subscriber. JSON Feed 1.1 `hubs[]` is the discovery hook. 2digime does not subscribe yet.
- **ActivityPub** — actors, outbox, `Video` / `Note` objects. [PeerTube](https://docs.joinpeertube.org/api/activitypub) is the video reference implementation 2digime intends to stay compatible with.

Level 4 is **not** required for a good Public Alpha experience.

---

## 2. Recommended stacks by media type

These are combinations of existing standards. None is a 2digime API.

### Article / blog / news

Level 1 RSS or Atom or JSON Feed, plus Level 2 OpenGraph + schema.org `Article` / `NewsArticle` / `BlogPosting`.

### Image

Level 1 feed + Level 2/3:

- RSS `<enclosure type="image/jpeg">` or Media RSS `media:content medium="image"`, or
- JSON Feed `attachments` with `image/*`, or
- schema.org `ImageObject` `contentUrl` on the canonical page.

### Audio / podcast

Same as image, with `audio/*` / `medium="audio"` / `AudioObject`. Duration strongly recommended.

### Video

Preferred open path:

1. Media RSS `media:content medium="video"` + `media:thumbnail` + `media:player` **or** schema.org `VideoObject` (`contentUrl` and/or `embedUrl`, `thumbnailUrl`, `duration`)
2. JSON Feed attachment `video/*` or oEmbed `type=video`
3. Self-host or [PeerTube](https://docs.joinpeertube.org/) public instance (REST list/search + oEmbed + optional ActivityPub)

Class B supplement (not the open supply chain): YouTube Data API + official iframe embed; Vimeo oEmbed for known public URLs.

### Comic / 漫剧 / serial work

There is no separate open “manhua protocol”. Publish:

- a stable series URL and per-episode/chapter URLs (Level 0–1)
- feed items per episode (Level 1)
- `ImageObject` sequence, `VideoObject`, or Media RSS item per episode (Level 2–3)

A platform that only offers a logged-in JS catalog is **out of profile** until it exposes one of the outlets above or an official user-auth API (Class C, outside this profile).

---

## 3. Media RSS as the multimedia recommendation

[Media RSS 1.5.1](https://www.rssboard.org/media-rss) (`xmlns:media="http://search.yahoo.com/mrss/"`) is the recommended **single-feed** way for a supplier to declare video, image, and audio objects.

Minimal video item (illustrative, not a 2digime schema):

```xml
<item>
  <title>Example episode</title>
  <link>https://example.org/watch/ep1</link>
  <pubDate>Mon, 14 Sep 2026 00:00:00 GMT</pubDate>
  <media:content url="https://cdn.example.org/ep1.m4v"
                 type="video/mp4" medium="video"
                 duration="720" expression="full" />
  <media:thumbnail url="https://cdn.example.org/ep1.jpg" />
  <media:player url="https://example.org/embed/ep1" />
</item>
```

`expression="sample"` vs `full` lets a supplier offer a preview without implying 2digime may unlock a paywall.

`media:restriction`, `media:license`, and `media:price` are **signals**. They are not 2digime payment or DRM.

---

## 4. JSON Feed 1.1 as the JSON peer

[JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/), MIME `application/feed+json`.

Attachments replace Media RSS for shops that do not want XML:

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Example",
  "feed_url": "https://example.org/feed.json",
  "home_page_url": "https://example.org/",
  "items": [
    {
      "id": "https://example.org/watch/ep1",
      "url": "https://example.org/watch/ep1",
      "title": "Example episode",
      "date_published": "2026-09-14T00:00:00Z",
      "image": "https://cdn.example.org/ep1.jpg",
      "attachments": [
        {
          "url": "https://cdn.example.org/ep1.m4v",
          "mime_type": "video/mp4",
          "duration_in_seconds": 720
        }
      ]
    }
  ]
}
```

---

## 5. What 2digime will not ask of suppliers

- A 2digime account, SDK, or proprietary meta tag
- A required keyword taxonomy or “interest tags” for targeting
- Payment to enter a recommendation auction
- Re-hosting files on 2digime servers
- Implementing every Level 4 protocol

---

## 6. What 2digime will not do to “help”

- Site-specific HTML scrapers
- Hidden / unofficial player APIs
- DRM bypass or paywall circumvention
- Sharing one user's Class C credentials with another
- Pretending a ranking hub is a list of consumable works when no standard outlet exists

Those pages stay `UNSUPPORTED` until the supplier (or the platform, via official API) joins this profile or a documented Class B/C integration.

---

## 7. Paid / subscription content (future commercial layer)

Out of v0.1 implementation. Profile boundary only:

```text
FREE PUBLIC CONTENT     this profile, Levels 0–4
PAID / SUBSCRIPTION     Class C + future identity / entitlement / payment / receipt / settlement
```

A supplier may already mark `requiresSubscription`, `media:price`, or `media:restriction`. 2digime may show **PAID** / **AUTH_REQUIRED** honestly. It must not play the locked media.

Future value for suppliers (not current): direct user relationship, own pricing, lower take-rate than a central video store. 2digime still must not become that central store.

---

## 8. Relation to CONTENT-SUPPLIERS.md

Public Alpha `CONTENT-SUPPLIERS.md` already states: public Web, RSS/Atom, autodiscovery, canonical, sitemap, OpenGraph, schema.org Article, no portal.

The next public revision should point at this profile (Levels 0–4), add Media RSS / JSON Feed / oEmbed / media schema.org types, and state Class D honesty. **This Gate does not edit the public file.**

---

## 9. Next engineering cut (not executed here)

`OPEN-MEDIA-SYNDICATION-01` — teach current `ingestSource` to read enclosure, Media RSS, and JSON Feed into optional NetworkItem media fields; teach HTML metadata to keep VideoObject / AudioObject / ImageObject; fetch oEmbed for known URLs.

That implements Levels 1–3 on the 2digime side. It does not invent a protocol, and it does not scrape closed catalogs.
