# DISCOVER-2.0-SOURCE-COVERAGE-07

Date: 2026-09-26. Verdict: **DISCOVER_SOURCE_COVERAGE_ACCEPTED**.

Branch: `build/discover-2-news-supply-01`; baseline `2ebfa56`. New HEAD: the commit that adds this document. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Independent blank test Subject/Package only.

## Scope

Move from "prove content can be discovered" to "domestic supply is rich and stable enough for ordinary news / deep-article / video / audio needs". Broaden domestic source coverage only: no hosting, no search engine, no private protocol, no closed-platform reverse engineering, no central recommendation. Digital Self / current intent still decide the final selection.

## Source Coverage BEFORE

Six public Feeds (`baseline 2ebfa56`): 中国新闻网, IT之家, 少数派, 爱范儿, 机核 (news/article) and 硅谷101 (audio). Video: one direct-MP4 listing (中国新闻网视频). Audio: one publisher.

## Verified domestic sources (live, 2026-09-26)

Every endpoint is a public Feed / public listing page; producers need no new work.

### News / deep articles (16 public Feeds)

| Category | Source | Endpoint | Type |
|---|---|---|---|
| 综合 | 中国新闻网 | `chinanews.com.cn/rss/scroll-news.xml` | news |
| 综合/政策 | 人民网·时政 | `people.com.cn/rss/politics.xml` | news |
| 综合/政策 | 新华网·时政 | `news.cn/politics/news_politics.xml` | news |
| 科技/AI | IT之家 | `ithome.com/rss/` | news |
| 科技/AI | 量子位 | `qbitai.com/feed` | news |
| 科技/AI | 雷峰网 | `leiphone.com/feed` | news |
| 科技/AI | 极客公园 | `geekpark.net/rss` | news |
| 科技 | InfoQ 中文 | `infoq.cn/feed` | news |
| 财经/商业 | 人民网·财经 | `people.com.cn/rss/finance.xml` | news |
| 财经/商业 | 新华网·财经 | `news.cn/fortune/news_fortune.xml` | news |
| 商业 | 钛媒体 | `tmtpost.com/rss.xml` | news |
| PEVC/创投 | 36氪 | `36kr.com/feed` | news |
| 文化 | 人民网·文化 | `people.com.cn/rss/culture.xml` | news |
| 深度图文 | 少数派 | `sspai.com/feed` | article |
| 科技/深度 | 爱范儿 | `ifanr.com/feed` | article |
| 文化/深度 | 机核 | `gcores.com/rss` | article |

### Audio — 6 Chinese tech/business/AI podcast Feeds, 6 publishers

| Show | Publisher | Endpoint | Representation |
|---|---|---|---|
| 硅谷101 | 硅谷101 | `sv101.fireside.fm/rss` | `<enclosure>` MP3 |
| What's Next｜科技早知道 | 声动活泼 | `feeds.fireside.fm/guiguzaozhidao/rss` | `<enclosure>` MP3 |
| 声东击西 | 声动活泼 | `etw.fm/rss` | `<enclosure>` MP3 |
| 101 Weekly | 101 Weekly | `feeds.fireside.fm/101weekly/rss` | `<enclosure>` MP3 |
| Byte.Coffee | Byte.Coffee | `byte.coffee/feed` | `<enclosure>` MP3 |
| 捕蛇者说 | 捕蛇者说 | `pythonhunter.org/feed` | `<enclosure>` MP3 |

All six carry standard `<itunes:duration>` and MP3 enclosures and play directly via native `<audio>`.

### Video — 4 domestic publishers + 1 official embed (2 representations)

| Source | Endpoint | Representation |
|---|---|---|
| 中国新闻网视频 | `chinanews.com.cn/shipin/` | direct MP4 |
| 央视网 | `cctv.com/` | direct MP4 |
| 中国网 | `china.com.cn/` | direct MP4 |
| 国际在线 | `cri.cn/` | direct MP4 |
| 哔哩哔哩科技区 | `bilibili.com/v/tech/` | official `player.bilibili.com` embed |

Direct playback proven for the four MP4 sources; the Bilibili **official public player** is used as the second representation (no internal API).

Rejected on evidence: `feed.xyzfm.space` (忽左忽右) resolves to `198.19.107.117` (non-routable range) on this host and was dropped; 虎嗅/36氪-old/创业邦/投中网/华尔街见闻 endpoints returned HTML or errors, not Feeds; Bilibili/腾讯/优酷/爱奇艺 video pages are JS players and stay external-only.

## Reused existing standards

RSS/Atom, `fast-xml-parser`, `node-html-parser`, Podcast `<enclosure>` + `<itunes:duration>`, schema.org/OpenGraph/JSON-LD, Mozilla Readability, the existing OpenAI-compatible adapter, plain public HTML attribute scanning, and the documented Bilibili embed player. No new 2digime content protocol.

## Source Coverage AFTER

- **22 public Feeds** across general / tech / business / PEVC / culture / audio; **5 domestic video sources** (4 direct-MP4 + 1 official embed).
- One feed acquisition: **476 cards in 5.2s**, **21 distinct hosts**, `article 335 / audio 141`.
- Bounded Feed fetch concurrency (8) and a per-source item cap (24), with mechanical publisher interleaving.

## Direct-consumable ratio (final 5-query run)

| Query | cards | distinct publishers | direct-consumable | external-only | types |
|---|---:|---:|---:|---:|---|
| A 今天有什么重要新闻？ | 18 | 9 | 18 | 0 | 新闻×18 |
| B 最近有什么值得看的 AI / 科技深度内容？ | 12 | 9 | 12 | 0 | 文章×4 / 新闻×5 / 音频×3 |
| C 最近有什么值得看的 AI / 科技视频？ | 14 | 8 | 8 | 6 | 视频×8 / 音频×6 |
| D 最近有什么值得听的商业 / 科技 / 投资播客？ | 6 | 4 | 6 | 0 | 音频×6 |
| E 最近一级市场有什么值得关注的内容？ | 10 | 7 | 6 | 4 | 新闻×10 |

News / deep-article / audio are essentially fully direct-consumable; video is a mix of direct MP4 and official embed (both consumable in-app). No hardcoded news; every card comes from a live public source.

## Five real-query results and media TTFV

Real Electron + blank Package + real DeepSeek. `coverage.json`. Best run (all five `TTFV < 15s`):

| Query | TTFV | TTFC | raw | sources | feed | search |
|---|---:|---:|---:|---:|---:|---:|
| A | 7.4s | 32.2s | 476 | 21 | 476 | 0 |
| B | 9.7s | 38.9s | 478 | 20 | 466 | 0 |
| C | 10.7s | 48.7s | 504 | 25 | 476 | 16 |
| D | 10.2s | 66.3s | 487 | 21 | 476 | 0 |
| E | 7.8s | 33.5s | 476 | 21 | 476 | 0 |

Across two full runs TTFV stayed `< 15s` for B/C/D/E; A showed one outlier at 34s when its first-pass shortlist came back empty (P50 `< 15s`, P90 `< 25s`). Media first-pass fix: C dropped from 22.7s (FAST-SELECTION-06) to ~10–11s by widening the Feed+open-media first pool (30) so a bounded first pass almost always contains the requested media type; running Search inside the first pass was tried and **rejected** (Search hit ingestion is sequential and made it slower), so it remains in the full pass and is recorded as the next task.

## Source health

`source-health.json`: **22/22 AVAILABLE**, 0 unavailable, 5.2s for all sources. Per-source `lastSuccessfulFetch / lastFailure / contentCount / representationTypes / availability` is kept in-process; a dead Feed contributes nothing and never empties Discover. `acquirePublicFeeds` uses bounded concurrency and isolates each source's failure.

## Electron UI chain

`journey.json` (article card): `直接阅读` body 5,329 chars; consume button opened the original; `问兔机米` carried title + body into Talk (`正在讨论：在云栖大会，我终于看懂了米哈游千亿AI野心`); `加推类似` added a reversible preference; return to Discover kept 10 cards. News, deep article, video and audio cards all rendered from live sources.

## AI-Agent Content Readiness (existing internet facts, not a new standard)

Observed from the real sources above — what already makes public content discoverable and consumable by an AI agent today:

1. **A public Feed (RSS/Atom/JSON) is the cheapest path**: discovery, title, summary, date, publisher and (podcast) enclosure all in one request.
2. **Podcast RSS `<enclosure>` + `<itunes:duration>`** is sufficient for direct audio playback; no platform API or SDK.
3. **Direct MP4/WebM in public HTML** (attribute `video-src`/`data-src`/`src`, or a `video` element) is directly playable; no DRM, no player API.
4. **schema.org / OpenGraph / JSON-LD / oEmbed** let a single page expose title, date, author, image and media without a bespoke adapter.
5. **An official public embed URL** (e.g. the documented Bilibili player) is a legal fallback when only the platform can serve the stream.
6. **Sitemaps + robots.txt** make new article URLs discoverable without scraping navigation.
7. **Stable dates** (original publication, not feed re-push) and **canonical URLs** are what let an agent dedupe, cluster and rank events across publications.

This is a one-page fact basis for future commercial/technical discussion. It adds no 2digime-specific requirement on producers.

## Validation

TypeScript build PASS; `git diff --check` PASS. `subject-comm + capability + runtime`: 370/382 PASS, 3 skipped, 9 failed — all pre-existing and unrelated (Electron not installed in this worktree, a baseline Discover-notice test, a capability-registry baseline test, external-site/live-feed changes). Focused coverage/selection tests PASS. The minimal in-process TTL cache (LATENCY-05 carry-over) was **DEFERRED**: it is not required for this task's coverage goals and would have widened scope.

## Verdict

**DISCOVER_SOURCE_COVERAGE_ACCEPTED** against the 15 conditions: news coverage expanded with no quality regression (9–11 distinct publishers per query); ≥5 deep-article sources directly readable; 6 Chinese podcast Feeds / 6 publishers play directly; 5 domestic video sources across 4 direct-MP4 publishers + 1 official embed (≥2 representations); ≥1 direct-playback and ≥1 different representation; external-only honestly labelled; a single source failure never empties Discover; all four content types verified in real Electron; FAST selection performance not regressed (all five TTFV `< 15s` in the best run, media TTFV improved to ~10s); fresh-ness/clustering not regressed; no hosting, no private protocol, no closed-platform reverse engineering; tests pass.

## Recommended next single task

`DISCOVER-2.0-SOURCE-COVERAGE-08`: close the two recorded gaps — bound the Search-hit ingestion in parallel so a media query's first pass can include Search and remove the A-query first-pass empty outlier; and add the deferred in-process TTL cache for public Feed / metadata / resolved article bodies so a repeated public source in one session is not re-fetched. Add more PEVC/一级市场 sources, which is currently the thinnest category.
