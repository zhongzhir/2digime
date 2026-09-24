# DISCOVER-2.0-NEWS-SUPPLY-01

Baseline: `29a7d4043942d689b7ebf9e027f9e909d6b34c1e`, fetched 2026-09-24.
Branch: `build/discover-2-news-supply-01`; isolated worktree. Original detached worktree and staged/untracked changes protected. No push/package/release.

## BEFORE / Current architecture

User intent → `electron/renderer/content-discover.js` → `content` command → `DigitalMeRuntime.runContentSeek` (`src/runtime/digitalme-runtime.ts`) → `interpretDiscoverIntent` → `seekContent` (`src/subject-comm/content-seek.ts`) → directory + open media + Web Search → canonical dedup → `classifyCandidateRoles` → 12 cards → UI.

Talk: `src/intelligence/service.ts` invokes `resolveContentSeek`; `formatSeekContext` supplies links to Talk. Personal feed separately uses `selectNetworkItems` with Digital Self and explicit preference directives. Feedback distinguishes model decisions from owner actions. Relay supplies neutral NetworkItem candidates; no personal selection occurs centrally.

Audit locations / functions:

| Boundary | Actual implementation |
|---|---|
| UI entry / original opening | `electron/renderer/content-discover.js`: `seek`, `renderCard`, `openCard`, `askTalk`; `electron/preload.cjs`: `invoke('content', ...)` |
| Talk | `src/intelligence/service.ts`: `resolveContentSeek`; `electron/renderer/talk.js`: `setContentContext`, `withContentContext` (explicit Ask then user send) |
| Active search / provider | `src/runtime/digitalme-runtime.ts`: `runContentSeek`, `resolveContentSearch`; `src/capability/adapters/gemini-search.ts`: `createGeminiSearchConnector`; managed alternative `src/relay-service/web-discovery-gateway.ts`: `createWebDiscoveryGateway` |
| Neutral directory / Relay | `loadDiscoverItems`: `RelayClient.listNetworkItems` then local fallback; `src/subject-comm/content-directory.ts`: `searchContentDirectory`; `src/subject-comm/network-item.ts`: `validateNetworkItem`; `FileNetworkItemStore` |
| Personal selection | `src/subject-comm/personal-feed.ts`: `ensurePersonalFeed`; `src/subject-comm/personal-selection.ts`: `selectNetworkItems`; existing Digital Self compiler |
| Explicit preference / feedback | `src/subject-comm/content-preferences.ts`: `upsertContentPreference`, `formatPreferenceDirectives`, `reverseContentPreference`; `network-content-feedback.ts`: `createAiJudgmentFeedback`, `createUserContentFeedback`, `appendNetworkContentFeedback`. Open/later do not create durable preferences |
| Feed / metadata / dedup | `content-ingest.ts`: `ingestSource`, `toNetworkItem`; `content-feed.ts`: `parseXmlFeed`, `parseJsonFeed`; `page-metadata.ts`: `parsePageMetadata`; `content-canonical.ts`: `normalizeCanonicalUrl`; `open-web-discovery.ts`: `discoverOpenWebSource`, `ingestOpenWebSource`, `indexSearchHits` |

## Root causes

Active search has no direct domestic feed acquisition. Directory matching caps at 12, aggregate search pool at 24, visible cards at 12; two search queries, failed ingest falls back to URL/snippet. Active selection checks object fidelity, not publication time or event duplication. `NewsArticle` is flattened to article. Feed parsing exists but clips text; no Readability consumption. UI opens external URLs. Current news is ordinary Web Search. Public HTML metadata does not prove full article availability.

## Build-vs-Integrate Gate (before product edits)

| Decision | Capability | Evidence / scope |
|---|---|---|
| REUSE | Gemini grounding / managed search | `resolveContentSearch`, `src/capability/adapters/gemini-search.ts`; provider already integrated |
| REUSE | RSS, Atom, JSON Feed, Media RSS, enclosure | `content-feed.ts` + fast-xml-parser; no new feed parser |
| REUSE | Sitemap / robots / OpenGraph / JSON-LD / oEmbed | `open-web-discovery.ts`, `page-metadata.ts`, `content-oembed.ts` |
| INTEGRATE | Mozilla Readability + inert jsdom | https://github.com/mozilla/readability ; return plain text, no scripts/resources |
| EXTEND | User-side candidate orchestration | Existing runtime carries it; missing direct source connection, news representation and event selection. Model judges topic/news/event; code validates IDs and dates |
| REUSE | Digital Self / explicit preferences | Existing self context only; no second profile, click optimization or central recommendation |
| REUSE | Browser media / source opening | Native audio/video when available; otherwise source fallback |
| DEFER | Additional Search providers / dedicated HLS-DASH player | Existing Search sufficient; no engine or player rewrite |
| DEFER | Overseas default media supply | Preserve compatibility, disable default overseas acquisition in new domestic path |

Model alone cannot retrieve an unconnected Feed or render extracted article content. Current Feed and metadata adapters already cover acquisition mechanics; only connect them. Source catalog contains public endpoints, never fixed result titles. Source content is untrusted model input.

## China Source Matrix

Checked 2026-09-24T06:12:22.988Z. Two same-host checks; HTML column describes this host only, not long-term stability. RSS absence means not discovered by this bounded check, never proof of nonexistence. JSON-LD column covers homepage only. API authorization and article access must be checked per resource. Producer work = 0 for using already-public endpoints; no private content protocol.

| 来源 / 类型 | Public URL | RSS/Atom | Sitemap | HTML | JSON-LD | Public API | 授权 | 国内可达性 | 默认源 | Producer work | Adapter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 新华社 / news | [新华社](https://www.news.cn/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 人民网 / news | [人民网](http://www.people.com.cn/) | 未发现/未全面核实 | [200 XML](http://www.people.cn/sitemap_index.xml) | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 中国新闻网 / news | [中国新闻网](https://www.chinanews.com.cn/) | [已解析 XML](https://www.chinanews.com.cn/rss/scroll-news.xml) | [200 XML](http://www.chinanews.com/sitemap.xml) | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 有限试点 | 0 | 既有 Feed + metadata / Readability |
| 央视网 / video/news | [央视网](https://www.cctv.com/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 中国政府网 / public | [中国政府网](https://www.gov.cn/) | 未发现/未全面核实 | [200 XML](http://www.gov.cn/baidu.xml)<br>[200 XML](http://www.gov.cn/google.xml) | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| IT之家 / technology | [IT之家](https://www.ithome.com/) | [已解析 XML](https://www.ithome.com/rss/) | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 有限试点 | 0 | 既有 Feed + metadata / Readability |
| 证券时报 / finance | [证券时报](https://www.stcn.com/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 北京市政府 / public | [北京市政府](https://www.beijing.gov.cn/) | 未发现/未全面核实 | [200 XML](https://www.beijing.gov.cn/sitemap_1701.xml)<br>[200 XML](https://www.beijing.gov.cn/hudong/jianyi/sitemap.xml) | 200，标题/HTML 可读 | 有 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 财新 / finance | [财新](https://www.caixin.com/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 36氪 / PEVC/technology | [36氪](https://36kr.com/) | 已测端点不可用或非 Feed | robots 未声明 | 200，但无有效标题/Feed | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 机器之心 / AI | [机器之心](https://www.jiqizhixin.com/) | 未发现/未全面核实 | [200 未确认XML](https://www.jiqizhixin.com/shared/sitemap.xml.gz) | 200，数据服务入口，正文未证实 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 投中网 / PEVC | [投中网](https://www.chinaventure.com.cn/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 澎湃新闻 / news/culture | [澎湃新闻](https://www.thepaper.cn/) | 未发现/未全面核实 | [200 XML](http://www.thepaper.cn/sitemap/sitemap.xml) | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 少数派 / article | [少数派](https://sspai.com/) | [已解析 XML](https://sspai.com/feed) | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 有限试点 | 0 | 既有 Feed + metadata / Readability |
| 中国出版传媒商报 / publishing | [中国出版传媒商报](https://www.cbbr.com.cn/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 机核 / culture/audio | [机核](https://www.gcores.com/) | [已解析 XML](https://www.gcores.com/rss) | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 有限试点 | 0 | 既有 Feed + metadata / Readability |
| 哔哩哔哩 / video | [哔哩哔哩](https://www.bilibili.com/) | 未发现/未全面核实 | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 津津乐道 / audio | [津津乐道](https://www.jinjinledao.org/) | 已测端点不可用或非 Feed | robots 未声明 | 连接失败 | 本页未发现 | 未核实；未调用私有接口 | 未验证 | 本机失败 | 否 | 0 | 公开 Search/metadata；正文按 robots/access 回退 |
| 阮一峰 / independent | [阮一峰](https://www.ruanyifeng.com/blog/) | [已解析 XML](https://www.ruanyifeng.com/blog/atom.xml) | robots 未声明 | 200，标题/HTML 可读 | 本页未发现 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 否 | 0 | 既有 Feed（非默认） |
| 爱范儿 / technology | [爱范儿](https://www.ifanr.com/) | [已解析 XML](https://www.ifanr.com/feed) | [200 XML](https://www.ifanr.com/sitemap.xml) | 200，标题/HTML 可读 | 有 | 未核实；未调用私有接口 | 本次公开访问无登录；正文逐页核验 | 本机可达；国内多网未验证 | 有限试点 | 0 | 既有 Feed + metadata / Readability |

19/20 homepages returned HTTP 200, but 36kr was not a usable Feed and Jiqizhixin was a data-service entry. Six verified XML feeds: China News, IT Home, SSPAI, ifanr, Gcores, Ruan Yifeng. Five are connected as neutral pilot sources. Jinjinledao failed TLS/DNS and is excluded. 36kr official RSS documentation exists (https://www.36kr.com/rss-center), but both `/feed` and `/feed-newsflash` returned non-Feed HTML on this host; neither is a default source. No supplier onboarding work, credentials, or closed-platform API reverse engineering.

Primary standards reviewed: [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/), [Article/NewsArticle metadata](https://developers.google.com/search/docs/appearance/structured-data/article), [Gemini grounding](https://ai.google.dev/gemini-api/docs/google-search), [oEmbed](https://oembed.com/), [Mozilla Readability](https://github.com/mozilla/readability). Raw endpoint evidence: `evidence/news-supply-01/sources.json`.

## Implemented slice

User intent → existing model intent → neutral Directory + live public Feed + Search supplementation → canonical dedup → local model event grouping / relevance selection using current request + existing Digital Self + explicit preferences → `resolveContent` → Discover cards / plain-text reader / original source / explicit Ask.

- Added `news` to existing content type, preserved structured `NewsArticle`, retained real `publishedAt` on repeated ingest (existing merge previously discarded it), added optional `updatedAt` metadata. No publication date synthesized from acquisition time.
- `news-supply.ts/acquirePublicFeeds` connects five public endpoints through the existing parser and NetworkItem store. Returns live items, not hardcoded titles; 12 per source, interleaved mechanically. Failed source contributes no fake item. Personal feed also ingests this neutral supply; overseas catalogs remain available through existing adapters but are not the default.
- `selectSupply` performs user-side model selection and event clustering. Canonical dedup plus normalized title supplied to model; groups may reference only existing candidate IDs. News requires known non-future publication time. Model receives current time and local timezone; no keyword news router, CTR scoring, central profile, new user store or Relay personalization.
- `content-resolution.ts/resolveContent`: Feed full content first; JSON Feed full content supported; existing JSON-LD/OG/oEmbed metadata retained; inert jsdom + Mozilla Readability for public article text; access/robots/network failures fall back to source. No scripts/resources executed, no HTML injected into renderer, no media download/hosting/transcoding/CDN. Full text is local consumption data; not added to external NetworkItem protocol.
- Existing Discover UI shows localized source time, plain-text reader and grouped source links. Explicit Ask carries bounded, quoted external text into the next user-sent Talk message. No auto-send or new navigation page.
- Search failures no longer erase usable Feed results: source-only result notice. Networking opt-out guards new acquisition and Search. Existing generation checks protect overlapping searches.
- Timings recorded independently for feed, search, model selection, resolver, total. No latency project or performance claim versus baseline.

## Real evidence

`evidence/news-supply-01/live.json`: real DeepSeek model (`deepseek-v4-flash`), real internet, formal command bus `content.seek`, synthetic empty SubjectPackage, no stub, no imported Owner Digital Self. Only public titles, source URLs, model ID decisions and body lengths/hashes committed; article bodies stay in ignored local `build/evidence/`.

| Case | Observed result | Limit |
|---|---|---|
| 今天 AI 有什么重要新闻 | 6 news cards, dated 2026-09-24; multiple publishers; resolved text 540–9,894 characters | Individual event reporting mixed with daily digests; not all “important” ranking independently verified |
| 最近具身智能消息 | 1 dated 2026-09-23 item containing a relevant event, 13,031-character Feed body | Returned daily digest rather than a dedicated event story; coverage limited |
| 普通国内图文 | 1 SSPAI article, 6,401 characters extracted by Readability, source/date retained | Local direct reading proven at command/resolver boundary; full Electron gate pending |
| 国内音频/视频 | 2 Gcores audio candidates, publisher/date and original URLs retained | Safe source fallback; no direct audio stream/decode success claimed |

Search supplementation was invoked for all four cases but Gemini returned **429 quota** every time (recorded in evidence). Feed supply therefore genuinely operated independently of successful Search, but successful Search supplementation remains unverified. Live groups were singleton groups: **real multi-publisher same-event clustering remains unverified**; its ID/source-preservation contract is covered by unit/command tests.

| Case | Feed ms | Search ms (two calls, quota failures) | Selection ms | Resolver ms | Total ms |
|---|---:|---:|---:|---:|---:|
| 1 | 679 | 4,883 + 2,665 | 12,715 | 3,778 | 26,475 |
| 2 | 539 | 3,798 + 2,425 | 10,738 | 0 (Feed body) | 18,982 |
| 3 | 706 | 3,106 + 2,303 | 5,132 | 10,128 | 22,667 |
| 4 | 5,399 | 3,288 + 2,767 | 3,433 | 510 | 17,440 |

Final small hardening after this live run (source-failure notice, optional update/topic fields, Ask text transfer, shared paywall metadata check, networking opt-out) was mechanically retested; not represented as another live-model pass. Renderer DOM test uses the actual renderer script with inert local test input; it is **not Electron/Owner acceptance**.

Electron attempt: independent temporary userData, formal `electron/main.cjs`, no product stub; the process closed before a window was obtained. Escalated retry was rejected by automatic approval review: importing another checkout's model credential and potentially sending Digital Self to the external model destination was not accepted as specifically authorized. No workaround or further credential-bearing run after rejection. `scripts/news-supply-ui.cjs` is prepared for an explicitly authorized retry; no official application data is used.

Validation: TypeScript build PASS; **48/48 tests PASS, zero skipped**; renderer JavaScript syntax checks and `git diff --check` PASS. Targeted regression and new tests cover dates, canonical source groups, neutral supply + Search command wiring, explicit preference boundaries, robots/access fallback via existing SSRF-safe network boundary, inert reader, explicit Ask, networking opt-out, old media compatibility and overlapping search isolation. Exact final output in `evidence/news-supply-01/tests.txt`. Production dependency audit (npm official registry): one inherited moderate `qs` advisory, no new production dependency advisories; existing package versions unchanged. No unrelated audit fix applied.

## Remaining gaps

1. Gemini quota prevents proving successful supplemental Search and wider topic coverage.
2. Need real same-event multi-publisher sample through the final selection/UI path; fixture clustering is insufficient.
3. Formal Electron reader/open-original/Ask/feedback path requires explicit authorization for the rejected credential-bearing test. DOM tests do not replace it.
4. Domestic reachability checked on one Windows host twice, not multiple domestic networks or long-term uptime. Twenty-source matrix includes excluded/unverified candidates; only five feeds are pilot defaults.
5. Case 2 digest-level granularity and direct media playback remain limited. No standalone new player or event graph added.

## Verdict

**DISCOVER_NEWS_SUPPLY_PARTIAL**. Real Feed supply, news type/time, ordinary article body and source fallback exist; successful Search supplement, real event-cluster quality and formal Electron acceptance are not yet established. No ACCEPTED or Owner acceptance claim.

## Recommended next single task

`DISCOVER-2.0-NEWS-SUPPLY-LIVE-GATE-02`: after restoring Search availability and authorizing the isolated real-model Electron check, verify the four formal UI cases plus one genuine multi-publisher same-event cluster on this branch. No new feature expansion, packaging or release before that gate.
