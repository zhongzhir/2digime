# DISCOVER-2.0-NEWS-RELIABILITY-03

Date: 2026-09-24. Verdict: **DISCOVER_NEWS_SUPPLY_ACCEPTED**.

Branch: `build/discover-2-news-supply-01`; baseline `dbf912c`. New HEAD: the commit that adds this document. Continues NEWS-SUPPLY-LIVE-GATE-02 on its isolated worktree. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Independent blank test Subject/Package only.

## Scope

Only the four remaining real gaps from LIVE-GATE-02 were addressed: single-provider Search dependency, same-event multi-publisher clustering, Feed/original publication-date semantics, and the unfinished formal Electron UI journey. No product expansion, no new search engine, no hardcoded news, no central profile, no fixture acceptance, no Digital Self reads, no frozen-Alpha edits.

## Authorization and isolation

Owner authorized real DeepSeek requests using the existing read-only credential reader, public queries/content only, in a blank test Subject/Package. The acceptance entry reuses `readRuntimeModelCredential` + `createEnvSecretAccessor`, allows only `https://api.deepseek.com`, and returns an in-memory accessor. No API key is written, exported or printed. Each Electron run creates a fresh `news-supply-ui-*` userData; the unchanged formal `electron/main.cjs` auto-creates its default empty Subject. Stub flags are off; model/runtime/IPC/renderer business logic is not mocked. Safety evidence checks that no `secrets.v2.json` was created in the test directory and that the Digital Self file stayed absent/unchanged.

## Search: from single-service dependency to provider fallback

Build-vs-Integrate Gate (no new engine, no result-page scraping, no quota bypass):

| Decision | Capability | Evidence / scope |
|---|---|---|
| REUSE | Gemini grounding connector | `src/capability/adapters/gemini-search.ts`; now with `maxRetries: 0`, bounded timeout |
| REUSE | Managed web-discovery gateway | `src/relay-service/web-discovery-gateway.ts`; existing install-token path |
| INTEGRATE | DashScope search-grounded generation | Official `enable_search` + `search_info.search_results`; only provider grounding metadata is consumed, never URLs invented in assistant prose |
| REUSE | Feed / direct acquisition | Unchanged `acquirePublicFeeds`; Search only supplements the candidate pool |

`src/capability/supplemental-search.ts` builds an ordered provider chain and records per-provider `AVAILABLE / RATE_LIMITED / UNCONFIGURED / FAILED` with attempt state. A provider that failed is not re-hammered for the next query in the same seek. A failed or rate-limited provider never removes Feed/direct results: Search is supplementation, not a survival condition. Evidence: `evidence/news-reliability-03/ui.json` (`providers` per query).

## Multi-source event clustering without output explosion

The previous failure was not "the model cannot cluster"; it was handing an over-wide pool to one reasoning call, which exhausted 8,192 tokens (`finish_reason=length`, empty result). Budgets were not increased. `src/subject-comm/news-selection.ts` now runs a thin staged pipeline:

```text
candidate pool -> canonical/title dedup -> bounded batches (<=10)
  -> model semantic grouping (<=6 groups, <=10 ids, maxTokens 4096)
  -> merge compatible groups -> select representative story
```

- Deterministic preprocessing is limited to canonical URL, normalized title, publisher and the time window; "same event or not" stays a model judgment.
- Every model input/output has a hard bound; a failed batch or merge is isolated and preserves the rest of the pool.
- Merge stops on no reduction, retaining successful batches instead of retrying or discarding the pool.

A real same-day event (Tesla App leak of Optimus Gen 3) produced a single event group with **11 independent source links across multiple publishers** (IT之家, 手机新浪网, 新浪, DoNews, 东方财富, 同花顺, 搜狐, 网易, UC), not a fixture and not two identical titles. Evidence: `ui.json` query 3 `commandCards[0].sources`, `journey.json` `groupedSources: 11`.

## News date semantics

`publishedAt / updatedAt / discoveredAt / sourceFeedTimestamp / originalPublishedAt` are now distinct fields with a `dateProvenance` map. `resolveContent` reconciles the original publication even when the Feed already supplies a full body, by reading JSON-LD/OpenGraph `datePublished`/`dateModified` from the article page. The renderer prefers a trustworthy `originalPublishedAt` ("原文发布 …"); otherwise it labels the Feed timestamp ("Feed 时间 …") and never presents a re-pushed Feed item as published today. Selection uses `originalPublishedAt` first for freshness.

Real regression on the prior SSPAI sample (`evidence/news-reliability-03/date.json`): Feed timestamp `2026-09-24T04:15:24Z`, original `2026-09-10T06:38:03Z`, provenance `{feed: sspai.com/feed, original: sspai.com/post/114395#datePublished}`, body 6,401 chars, and a "今天" query selected **0** of it.

## Real results

Evidence: `evidence/news-reliability-03/ui.json`, `journey.json`, `date.json`; local `build/evidence/news-reliability-03/` holds screenshots, `commands.jsonl`, `model.jsonl`, `opens.jsonl`, `tests*.txt`. The harness fills the real discover form and submits it; the bound handler runs the renderer `seek` -> preload IPC -> runtime path. No response is injected.

| Query | Cards | Latency | Providers (this query) | Pool |
|---|---:|---:|---|---|
| A. 今天 AI 有什么重要新闻？ | 12 | 75.8s | gemini RATE_LIMITED(429), dashscope FAILED(401), managed FAILED(8) | raw 124, feed 116, search 8 |
| B. 最近具身智能有什么重要消息？ | 3 | 60.8s | gemini RATE_LIMITED(429), dashscope FAILED(401), managed AVAILABLE(16) | raw 132, feed 116, search 16 |
| C. 今天特斯拉 App 泄露第三代 Optimus 人形机器人的具体消息…（合并同事件并保留各来源） | 1 (11 sources) | 42.5s | gemini RATE_LIMITED(429), dashscope FAILED(401), managed AVAILABLE(16) | raw 136, feed 116, search 13 |

Query A is the broad-query stress case: managed Search failed that call, yet 12 real Feed/direct cards were still returned. Across the run `finish_reason=length` occurred on 3 of 47 model calls (1 merge + 2 batches); every one was isolated and no query returned an empty result.

Provider status across the run: **managed AVAILABLE** (a real supplemental search path is usable), **gemini RATE_LIMITED (HTTP 429)**, **dashscope FAILED (HTTP 401, the environment's DashScope key is not valid)**. The product degrades gracefully and reports Search unavailability without dropping Feed.

## Electron UI chain

Real Electron + blank Package, `journey.json`:

1. Enter query and submit the discover form — done (real form submit).
2. Show news cards — done (event card, "来自 N 个来源").
3. Expand / direct reading — `直接阅读` body 1,449 chars.
4. Open original — renderer `openCard -> window.open` recorded the article URL (`opens.jsonl`).
5. 问兔机米 carries the content into Talk — `#talk-content-context` = "正在讨论：密封关节设计…", quoted body 1,449 chars.
6. Explicit feedback — `加推类似` wrote a reversible `boost` directive to `content-preferences.json`.
7. Return to Discover — 1 card still shown; Digital Self unchanged; no credential file created.

## Validation

TypeScript build PASS; `git diff --check` PASS; CJS/renderer syntax checks PASS.

- Focused relevant suites (news selection/supply, seek, discover, ingest, preferences, open-web-discovery, async-result stability, content preference, personal feed): **47/48 PASS, 1 skipped, 0 failed** (`tests-focused.txt`).
- Wider subject-comm + capability run: **331/338 PASS, 3 skipped, 4 failed** (`tests.txt`). All 4 failures are environment-gated live tests unrelated to this change: an invalid `DASHSCOPE_API_KEY` (HTTP 401) for REAL-CONTENT-TRIAL-01, a missing default model credential for EVOLUTION-01, and two external-site/MCP reachability checks (schema.org/oEmbed, real MCP readonly). They also fail on the untouched baseline paths.

## Fixes in this task (beyond the inherited work)

- Retain a same-event group when only a non-first member carries a valid non-future date, and make that dated member the representative.
- Resolve a search-origin card by id for open/boost/reduce/follow/block instead of relying on the bounded directory listing.
- Include grouped-source count, body presence and publication date in the renderer card signature so an already-rendered card updates when its sources change.
- Prefer the richer-provenance duplicate when the same canonical URL arrives from both directory and feed.

## Remaining gaps

1. Search supplementation still depends on the managed gateway; Gemini remains quota-limited and the DashScope credential in this environment is invalid. Feed/direct works without either.
2. Clustering quality is model-dependent; a broad meta-query ("which event has ≥2 outlets") may legitimately return nothing even though a named real event clusters reliably.
3. Directory-sourced cards can carry only the feed publication time (no page-level original date) when the article page does not expose one; the display never conflates the two.
4. Screenshots and full model diagnostics are local (gitignored); only JSON evidence is committed.

## Verdict

**DISCOVER_NEWS_SUPPLY_ACCEPTED** against the 14 acceptance conditions: Feed/direct works; Search failure does not fail Discover; a real supplemental search path (managed) is available; a real event clustered 11 sources across ≥2 publishers; model-length failures no longer empty broad results; Feed and original dates are separated with provenance; "今天" does not treat a re-push as today's publication; direct reading, the full Electron UI chain, and related tests pass; no private Digital Self egress; no hardcoded news; no new search engine; no central recommendation.

## Recommended next single task

`DISCOVER-2.0-NEWS-SUPPLY-SOURCES-04`: evaluate whether to add one or two additional already-authorized supplemental Search providers (or a managed-gateway retry policy) so that a single provider's 429/401 is not the only Search option, and review the five pilot Feed sources for coverage. No product expansion, packaging or release before that.
