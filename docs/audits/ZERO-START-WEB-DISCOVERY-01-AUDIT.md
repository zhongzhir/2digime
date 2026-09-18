# ZERO-START-WEB-DISCOVERY-01 — AUDIT

**Status:** implementation-ready  
**Date:** 2026-09-18  
**Worktree:** `D:\Projects\dm-discover-personal-feed-01`  
**Branch:** `build/discover-personal-feed-01`  
**HEAD at audit:** `46354f74d25360d8a7de174b56a84ee6e1fcf577`  
**Ancestors required:** `7df387f` (supply availability) · `51031b5` (intent fidelity) · `46354f7` (open catalogs)

No product code was written before this audit. This file answers the eight required questions and the Relay reuse gate.

---

## 0. Current facts (what exists)

| Area | Current state | Binding |
|---|---|---|
| Discover web search | `DigitalMeRuntime.resolveContentSearch` only creates `createGeminiSearchConnector` when a client Gemini key exists | Client BYOK |
| Talk web search | `discoverSearchCapabilities` registers `cap_gemini_web_search` only when Gemini key present; otherwise Talk cannot search | Client BYOK |
| Settings | 「联网搜索」→ Gemini API Key (`#gemini-search-api-key`) | Product-facing Gemini |
| SecretStore | `model.provider.gemini-search.apiKey` via FileSecretStore / safeStorage | Keep; do not delete |
| Zero-key content | Content Directory, RSS/Atom ingest, PeerTube / Wikimedia Commons / iTunes Podcast Search (`content-source-capabilities.ts`, `open-source-catalog.ts`) | No API key |
| Feed replenish | Local directory first; then Gemini search (if key) **and** open media | Open media already works without Gemini |
| Network state | `snapshotNetworkDiscovery` is `NOT_CONFIGURED` when `resolveContentSearch()` is missing — even if open catalogs work | Wrong for ordinary users |
| Relay | `src/relay-service/server.ts`: `/health`, `/v1/network-items`, `/v1/envelopes`. No search, no auth, no rate limit | Reusable |
| Historical public Relay | `https://relay.muhub.cn` (ECS + Nginx TLS, documented in `digitalme_log.md`) | Reuse, do not rebuild |
| Institution | Separate Institution Backend (`institutionDefaults.backendBaseUrl`); not a search gateway | Architecture-compat only |
| Install identity | None for search. Subject/peer identity exists for collab Relay, not for anonymous public search | Need install capability token |
| Bing baseline | Opt-in `DIGITALME_V2_BASELINE_SEARCH=1` only; not a product default | Leave as-is |

Owner has already hit Gemini **429**. Client-only BYOK cannot be the default path.

---

## 1. 当前联网请求为什么必须用户 BYOK？

Because the only production `SearchConnector` for Discover and Talk is Gemini, and the only credential path is:

1. Settings saves `gemini-search` into local SecretStore.
2. Electron bootstrap injects `geminiSearchApiKey` into `DigitalMeRuntime`.
3. `resolveContentSearch` / `discoverSearchCapabilities` refuse to create a connector without that key.

There is **no server-side search endpoint**. The app would have to embed a 2digime provider key to search without BYOK — which is forbidden. So today, ordinary users must register Google Cloud, enable billing, and paste a Gemini key. That is a developer path, not a product default.

Open catalogs already do **not** need a key; the product still *presents* search as key-gated because `snapshotNetworkDiscovery` and Talk professional discovery only look at Gemini.

---

## 2. 是否已有可复用 server/Relay 来提供托管 Search Gateway？

**YES — reuse `createRelayServer`.**

Reasons it is suitable:

- Already a public HTTP JSON service with `/health` and public candidate listing (`/v1/network-items`).
- Already forbids personalization query keys (`forbiddenPersonalizationKeys`).
- Already logs without plaintext business fields (`logSafe`).
- Historical public deployment exists; no second server product is justified.
- `package.json` has no `relay:start`, but `node dist/relay-service/server.js` is the existing entry.

What Relay is **missing** (thin additions, not a new platform):

- `POST /v1/web-discovery/search`
- install capability token for rate limit / quota (not a user profile id)
- provider secret from server env
- short public-result cache
- honest status: `AVAILABLE` / `RATE_LIMITED` / `AUTH_FAILED` / `PROVIDER_ERROR` / `TEMPORARY_UNAVAILABLE`

What we will **not** add to Relay: crawler, recommender, Digital Self storage, accounts, billing.

Institution Backend stays separate. Gateway may later accept a reserved `institutionToken` without changing Discover/Talk APIs.

---

## 3. 当前哪些内容发现能力根本不需要 API Key？

Already in-tree, zero-key:

- Local Content Directory (`FileNetworkItemStore` under `content/`)
- RSS / Atom ingest (`content-ingest.ts` / `parseFeed`)
- Open Source Catalog: PeerTube public API/feed, Wikimedia Commons official API, iTunes Podcast Search
- Media RSS / JSON Feed consumption via existing ingest when a URL is a feed
- Public HTTP GET with `safePublicHttpGet` (robots / public-http safety)
- Cached personal feed snapshots (IDs only; selection is local)

These should be the **default Discover supply** for a new user with no Gemini key. They already replenish video / image / audio when `fetchOpenMedia` is present (production default). Tests disable them via `NODE_TEST_CONTEXT`.

They do **not** replace general web search (news, arbitrary URLs, “今天 AI 有什么进展”).

---

## 4. 哪些任务确实需要通用 Web Search？

- Talk: “查一下今天 AI 有什么重要进展” and other current-web questions.
- Discover **article** replenishment when directory + open catalogs are not enough.
- User-initiated Discover seek for non-media topics (news, docs, sites not in the open catalog).

Not required for:

- Default Feed of already-catalogued videos / images / podcasts.
- Showing local/cached cards.
- Opening a known public URL.

Routing:

1. Default Feed: local / cache / open catalog first; managed search only to fill a shortfall (≤2 queries).
2. Explicit Talk / Discover search: managed web discovery first; open catalog where the intent is media; honest failure if both miss.
3. BYOK: only when the user chooses 「使用自己的服务」.

---

## 5. 如何做到 server 只看到必要 query，而看不到 Digital Self？

Split the job:

**On device (2digime):**

- Digital Self + current task + explicit preferences stay local.
- Model writes `searchQuery` with existing MINIMUM NECESSARY rules (already in `personal-feed.ts` / `discover-intent.ts`: no name, address, account, full self, fact list, preference vector; no sensitive facts unless the user explicitly searched them).
- Gateway request body is only `{ query, contentTypes?, freshness?, limit? }` plus optional reserved `institutionToken`.

**On Gateway:**

- Reject any payload key in the personalization / profile / recommendation / embedding / facts / history set.
- Do not accept `self.json`, Digital Self, preference vectors, recent recommendation state, or browsing history.
- Do not store a “this user likes X” profile keyed by install token.
- Install token is random, non-expressive, used only for quota / abuse.
- Logs: query hash, provider, latency, HTTP status, cache hit, quota — not raw query, not Authorization, not Digital Self.

Personal ranking remains in the user’s 2digime (`personal-selection.ts`).

---

## 6. 如何控制成本与滥用？

Minimum controls this round:

- Per-install hourly rate limit (capability token).
- Global hourly ceiling on the Relay process.
- Short TTL cache keyed by **query hash + public params**, storing only public URL metadata.
- Open-source-first Feed so Discover refresh is not “search the whole web every time”.
- Cap managed queries per Feed replenish (2).
- Query length limit, response size limit, provider timeout.
- Missing install token → reject (no fully anonymous unlimited gateway).
- Hard server-side skip if `WEB_DISCOVERY_PROVIDER_API_KEY` is unset: `MANAGED_PROVIDER_SECRET_REQUIRED` — never ask ordinary users to paste a key.

No payment, subscription, or billing UI.

---

## 7. 如何保持 provider 可替换？

Introduce a product capability **WEB_DISCOVERY**, not GEMINI_SEARCH.

- App / Talk / Discover consume `SearchConnector` / `{ title, url, snippet }` only.
- Gateway internal: `WebDiscoveryProvider.search({ query, ... })`.
- First implementation wraps the existing Gemini Search connector **on the server**.
- App contract must not require `geminiApiKey` or `geminiSearchResult`.
- BYOK remains an advanced path that may still use the local Gemini connector; that is a user-chosen provider, not the default API.

Failover to other paid providers is architecturally reserved (provider id in metrics). This round: one managed provider + zero-key fallback on 429 / outage.

---

## 8. 普通用户 Settings 应该长什么样？

**Normal:**

```
联网发现                         [开启]
兔机米可以从公开网络查找最新信息和内容。
搜索时只发送必要的搜索词，不会上传完整数字之我。
联网服务：兔机米提供（推荐）
```

No Gemini, no API Key, no endpoint, no quota numbers.

**Advanced (collapsed):**

```
高级联网设置
联网服务：
● 兔机米提供（推荐）
○ 使用自己的服务
```

Only 「使用自己的服务」 reveals Provider + API Key (existing Gemini SecretStore). Existing keys must survive upgrade; they are unused until the user selects BYOK.

---

## 9. Identity, secrets, 429, cache (audit conclusions)

**Identity:** Do not build an account system. Add a random install capability token in userData. Subject identity and institution tokens stay for other products.

**Secrets:** Managed provider key lives only in Relay env (`WEB_DISCOVERY_PROVIDER_API_KEY` or server `GEMINI_API_KEY`). Never in renderer, asar, evidence, or git. If the public Relay has no secret yet, engineering stops live managed calls at `MANAGED_PROVIDER_SECRET_REQUIRED`.

**429:** Classify as `RATE_LIMITED`. Discover continues with cache + open catalogs. Talk reports honest temporary unavailability, does not demand a Gemini key.

**Cache:** Public URL / title / description / thumbnail / canonical / contentType / publishedAt only. No “why this user saw it”. Query cache is short TTL + hash, not identity-bound.

---

## 10. Implementation sequence (minimum)

1. Relay: thin `POST /v1/web-discovery/search` + Gemini `WebDiscoveryProvider` + quota/cache.
2. Client: WEB_DISCOVERY routing (open / managed / BYOK) + install token.
3. Settings rewrite; keep SecretStore.
4. Tests for privacy, secrets, quota, 429 fallback, zero-start Discover, Talk without BYOK.

**Build-vs-Integrate:** (1) models cannot hold a public search quota for all users; (2) Gemini Search already exists as a connector; (3) Relay already exists and is the right place for a secret; (4) OS has no equivalent; (5) the missing piece is authorization/secret on the server, not a new engine. Therefore: integrate a thin gateway, do not self-build search.
