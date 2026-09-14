# CONTENT-DISTRIBUTION-CAPABILITY-AUDIT-01

**Status:** complete / implementation-ready  
**Date:** 2026-09-14  
**Worktree:** `D:\Projects\dm-content-distribution-01`  
**Branch:** `build/content-distribution-minimum-closed-loop-01`  
**HEAD:** `7d10e865c9c655693a0047c832ec69217a87a43d`  
**origin/main:** `7629880f0c995d03135f4186b9c90672483774f1`  
**Plan audited:** `docs/plans/CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01.md`

No product code was written for this audit.

---

## 0. Authority and delta inspected

`origin/main..HEAD` is **one commit**, 11 files, +1005/−4:

`7d10e865` `feat(network): validate recipient-side real content selection`

Product primitives in that commit:

- `src/subject-comm/network-item.ts` — `networkItemPayloadHash` only; `NetworkItem` schema unchanged
- `src/subject-comm/network-content-feedback.ts` — new event, origin-separated
- tests: `network-item.test.ts`, `network-content-feedback.test.ts`, `subject-network-real-content-trial-01.test.ts`

Trial-only:

- `src/subject-comm/tests/subject-network-real-content-trial-01.e2e.test.ts` (WEBTOON HTML scrape + engineering subjects)
- `scripts/export-v2-runtime-model-credential.cjs`

Docs: trial plan/report, `digitalme_context.md`, `digitalme_log.md`.

No renderer/UI, no RSS product module, no `selectNetworkItems` logic change, no Relay schema change.

---

## 1. Challenge to the draft plan

### 1. Is "content distribution" the correct problem framing?

**Partially.** Distribution is the supply/network half. The draft already reframes correctly:

> How can a user-owned digital subject continuously obtain, understand, select, consume, and use content from many suppliers without handing identity, preferences, or attention to a central recommender?

Keep that reframe. Do not title the product a "content distribution platform". The user-facing job is **subject-owned content acquisition**. Distribution is infrastructure.

### 2. Must-have dimensions still missing from the draft

The draft already added rights, takedown, spam, observability, mobile-ready contracts, history≠learning. Remaining gaps after repository inspection:

- **No product command** exists for network content. Relay APIs are test/client-only. Desktop UI cannot Discover, save, or give explicit feedback today.
- **Command-bus hard limit is 25** (`COMMAND_COUNT_LIMIT`). A family of Discover commands would be an architecture violation. Need **one** multiplexed `content` command, same pattern as `digitalSelf`.
- **`networkItemPayloadHash` is not content canonicalization.** It hashes the whole item including `itemId` / `createdAt`. Same article ingested twice hashes differently. Dedup must use normalized `content.url`, not payload hash.
- **Relay listing is not full-text search.** Query keys: kind / publisher / createdAfter / createdBefore / visibility / cursor / limit. Personalized keys are rejected. There is no `q=`.
- **Institution identity is the wrong publisher ID.** Institution store maps org→entitlement users and forbids Digital Self. Content publishers should stay `NetworkItem.publisherSubjectId` (opaque source id), not Institution User Mapping.
- **Bing HTML search is a known weak path** (02 L10). Active acquisition must prefer Gemini Search Grounding already integrated; Bing remains fallback only.

### 3. Proposed components that already exist under other names

| Draft name | Existing name |
|---|---|
| Neutral catalog / directory | Relay `FileNetworkItemStore` + `GET /v1/network-items` |
| Broadcast | `RelayClient.publishNetworkItem` / `POST /v1/network-items` |
| Recipient selection | `selectNetworkItems` in `personal-selection.ts` |
| Digital Self | `readDigitalSelf` / `self.json` |
| Feedback event | `network_content_feedback` |
| Instance fingerprint | `networkItemPayloadHash` |
| Candidate pool identity | `candidatePoolHash` |
| Ask 2digime | `talk` command + `conversation-search` |
| Web search | `SearchConnector` / Gemini Search / Bing HTML |
| Public URL fetch safety | `src/work-runtime/public-http-safety.ts` |
| Source identity (thin) | `publisherSubjectId` + `publisherDisplayName` |
| Soft "interests" | Digital Self facet `preferences` (identity, **not** content directives) |

### 4. Proposed components to delete because mature capabilities exist

Do **not** build:

- custom crawler (trial HTML scrape is not a product)
- custom search engine
- recommendation model / ranking service
- central user-profile / preference vector
- CMS / media hosting
- separate Content Directory microservice
- new social system / `#nav-collab`
- native mobile app
- malware reputation stack (no in-repo vendor; integrate later)
- Institution publisher KYC for V0.1

RSS: **INTEGRATE** protocol parse + existing safe HTTP. Do not invent a crawler. Node has no XML parser dependency today; Slice 1 may parse RSS/Atom item fields with a small dedicated parser **or** add a mature parser. Prefer small protocol parse over a CMS.

### 5. Legitimate central functions vs forbidden personalization

**Allowed (content-side):**

- ingest, normalize, canonical URL dedup
- store/list NetworkItems
- expire / overwrite (takedown)
- SSRF / private-IP block on fetch
- global spam flood control later
- Relay transport + expiry
- `logSafe` counts without Digital Self

**Forbidden:**

- Relay query keys in `RELAY_FORBIDDEN_QUERY_KEYS`
- central ranking / score / embedding-of-user
- writing AI SHOW/IGNORE into Digital Self or preference directives
- Institution backend storing Talk / Digital Self / preference

### 6. Smallest complete architecture (both loops)

```text
RSS or URL
  → safe public HTTP GET
  → normalize title/text/canonicalUrl
  → itemId = stable hash(canonicalUrl)
  → NetworkItem v1 (no schema bump)
  → Relay FileNetworkItemStore  (= V0.1 directory)
  → recipient listNetworkItems   (identical pool)
  → readDigitalSelf + explicit Content Preference Directives
  → selectNetworkItems (real model)
  → ai_decision feedback (does not rewrite preference)
  → Talk-adjacent Discover projection of SHOW items
  → user open / later / boost / reduce / follow / block
  → user_action feedback + inspectable local directives
  → next selectNetworkItems consumes directives

Active:
  talk text
  → directory text match on NetworkItem title/text/url
  → Gemini Search (mature) if needed
  → same canonicalize / assess / Talk results
```

No second catalog service. No Feed runtime. No new Relay.

### 7. Discover UI / navigation

Current official nav (`electron/renderer/index.html`):

1. 与兔机米 (`nav-chat`) — primary
2. 数字之我 (`nav-subject`)
3. 设置 (`nav-settings`)
4. 做事 (`nav-work`) — hidden legacy
5. 协作 (`nav-collab`) — hidden; 03 forbids restoring it

A fourth primary "发现" tab would reopen the five-surface product. **Incorrect placement.**

**Correct V0.1 placement:** Talk-adjacent Discover panel/list inside the conversational shell (same window as 与兔机米). Cards are a projection of `content` command output. Active search stays natural language in Talk.

### 8. Mobile-ready boundary now (no mobile build)

Needed now:

- one `content` command on CommandBus (client-neutral)
- domain objects in `src/subject-comm/`, not `electron/renderer/`
- Discover/search/open/save/feedback as command actions + JSON views
- no renderer-owned preference store

Not needed now: PWA, native app, OS push.

### 9. Content preference state

**Must exist, must not be Digital Self.**

Digital Self `preferences` facet is "who I am / how I judge", written through `tell` with confirmation rules. Content boost/reduce/follow/block is **attention control**, inspectable and reversible, provenance `user_action` only.

V0.1 store:

- path: SubjectPackage-local `content-preferences.json` (or equivalent under package root)
- records: `{ id, kind: follow|block|boost|reduce, targetType: source|topic|item, target, text, origin: user_action, updatedAt }`
- `selectNetworkItems` reads it as extra prompt context, **does not write it**
- `network_content_feedback` remains the event log; directives are the derived, user-visible control state
- open / dwell / save / AI SHOW **do not** write this store

Do not create `network-profile.json` as a hidden second self.

### 10. `7d10e865` product vs trial

**Keep/extend:** `networkItemPayloadHash`, `network_content_feedback` + tests, existing NetworkItem/Relay/`selectNetworkItems`.

**Trial-only:** WEBTOON HTML listing harness, engineering subjects A/B, credential export script, gitignored evidence under `build/evidence/subject-network-real-content-trial-01/`.

Linear history: this task **continues from** `7d10e865`. Do not rebase/cherry-pick.

---

## 2. Capability table

| Required capability | Existing implementation | Evidence | Decision | Minimal gap |
|---|---|---|---|---|
| Supplier ingest | Trial e2e `fetchPublicListing` HTML-only; no product RSS/URL ingest | `subject-network-real-content-trial-01.e2e.test.ts` | **INTEGRATE + BUILD thin** | Safe HTTP + RSS/Atom/URL metadata → NetworkItem. Do not productize WEBTOON scrape. |
| Source identity | `publisherSubjectId`, `publisherDisplayName`, provenance.origin includes `publisher` | `network-item.ts` | **REUSE** | Treat as opaque source id. Do not reuse Institution User Mapping. |
| Content normalization | `validateNetworkItem` strips to title/text/url | `network-item.ts` | **EXTEND** | Add URL normalize + stable `itemId` from canonical URL. Keep schema v1. |
| Semantic metadata | None on NetworkItem. Models already used in Talk / personal selection | `personal-selection.ts`, `intelligence/service.ts` | **EXTEND** | Slice 1: model-written summary into `content.text`. No ontology. |
| Dedup / canonical identity | `networkItemPayloadHash` = whole-item hash; `itemId` caller-chosen | `network-item.test.ts` proves hash changes if `itemId` changes | **BUILD thin** | Canonical key = normalized `content.url`. Overwrite same itemId. Payload hash stays transport fingerprint. |
| Directory / search | Relay `FileNetworkItemStore.list` + filter keys; no `q=` | `relay-service/network-item-store.ts`, `relay-public-candidates.test.ts` | **EXTEND** | Recipient/local full-text over listed items. No new search engine. |
| Broadcast | `POST /v1/network-items` | `relay-service/server.ts`, `relay-client.ts` | **REUSE** | Publish ingested items through existing client. |
| Relay | HTTP transport, forbidden personalization keys, TTL/expiry | `server.ts`, `RELAY_FORBIDDEN_QUERY_KEYS` | **REUSE** | Transport only. No ranking. |
| Recipient selection | `selectNetworkItems(digitalSelf, items, model)` | `personal-selection.ts` + feed/trial tests | **EXTEND** | Pass explicit preference directives into prompt. Still no writeback. |
| Explicit preference | Feedback events exist; **not consumed** by selection | `network-content-feedback.ts`; test asserts personal-selection does not import it | **BUILD thin** | Package-local directive store + user_action only. |
| Discover UI | None. Nav is Talk / 数字之我 / 设置 | `electron/renderer/index.html` | **BUILD thin projection** | Talk-adjacent list. No 4th primary tab. No `#nav-collab`. |
| Active search | `conversation-search.ts` + Gemini Search + Bing HTML | `search-capability-discovery.ts`, `gemini-search.ts` | **REUSE / INTEGRATE** | Talk plans directory match + Gemini Search. Do not make Bing primary. |
| Ask-2digime | `talk` command | `commands.ts` `talk` | **REUSE** | Pass item URL/title as Talk context. No new ask runtime. |
| Save / later / history | `user_action` includes `later`; Growth `later` is unrelated | `network-content-feedback.ts` | **EXTEND** | Persist later/open as local history list. Do not treat as preference. |
| Removal / takedown | `expiresAt` + `purgeExpired`; put overwrites itemId | `network-item-store.ts` | **EXTEND** | Ingest disable = republish with `expiresAt=now`. No schema `status` field in v1. |
| Safety / spam | SSRF guard on public HTTP; no URL-reputation vendor | `public-http-safety.ts`, `public-web-ssrf-01.test.ts` | **REUSE + DEFER** | Reuse SSRF. Defer phishing/malware vendor. Invalid URL = honest fail. |
| Observability | Relay `logSafe` publish/list/reject | `relay-service/server.ts` | **EXTEND** | Ingest status: fetched / rejected / duplicate / published / expired. Plain-language errors. |
| Mobile-ready boundary | CommandBus is the client contract; renderer is projection | `commands.ts`, `preload.cjs` | **EXTEND** | Add one `content` command. Do not put domain state in renderer. |
| Institution identity | Org/user/entitlement; forbids Digital Self persistence | `institution/backend/store.cjs` | **DEFER** | Wrong layer for content publishers. |
| Digital Self load/write | `readDigitalSelf` / `writeDigitalSelf`; selection reads only | `subject-core/digital-self/store.ts` | **REUSE** | Selection must keep byte-stable `self.json` unless user tells. |
| Mature external tools | Gemini Search Grounding; safe HTTP; RSS protocol; models | `gemini-search.ts`, `public-http-safety.ts` | **INTEGRATE** | Search via Gemini. Ingest via RSS/URL. No crawler. |

---

## 3. Build-vs-Integrate gate (this task)

1. **Repo:** NetworkItem, Relay, selectNetworkItems, Digital Self, Talk, conversation-search, public-http-safety, feedback events.
2. **Already integrated:** Gemini Search, DeepSeek/OpenAI-compatible chat, Institution adapter (not for content).
3. **Mature external:** RSS/Atom, original-link open in system browser, later URL reputation if needed.
4. **Build only:** canonical URL identity, ingest adapter, package-local content preference directives, Talk-adjacent Discover projection, one `content` command.

Forbidden without this justification: crawler, search engine, recommender, central profile, ontology, CMS, media stack, social system.

---

## 4. Schema changes justified

| Change | Why user loop fails without it | Alternative rejected |
|---|---|---|
| Stable `itemId` from canonical URL | Dedup / overwrite / takedown | New CMS id space |
| Package-local content preference directives | Explicit learning cannot affect next SHOW/IGNORE | Writing into Digital Self (L4) |
| `content` command actions | UI otherwise scrapes Relay from renderer | 6 new CommandBus names (limit 25) |
| Optional ingest status record | Supplier cannot see fetch/reject | None in V0.1 would fail §21 of the plan |

**Do not bump `NETWORK_ITEM_SCHEMA_VERSION`.** Keep title/text/url. Semantic extras stay in `content.text` for V0.1.

**Do not add** score, ranking, embedding, userId, or preference fields to NetworkItem (`validateNetworkItem` already rejects personalization keys).

---

## 5. Owner decision required?

**None.**

| Topic | Why autonomous |
|---|---|
| Product direction | Owner already assigned this task and the reframe in the plan |
| Sovereignty | Keep recipient-side selection; no central profile |
| Architecture | Extend existing NetworkItem/Relay; no new runtime |
| Cost | Use existing model + Gemini Search if present; RSS is HTTP |
| Rights | Original-link-only, no rehost |
| Mobile | Contract only; no app |

---

## 6. Corrections applied to the plan

The planning document is updated in `## Repository-audited implementation plan`. Material corrections:

1. Directory = existing Relay NetworkItem store, not a new service.
2. Discover = Talk-adjacent projection, not a primary nav tab.
3. Dedup key = canonical URL, not `networkItemPayloadHash`.
4. Preference directives live beside Digital Self, not inside it.
5. One `content` command; Talk remains active acquisition.
6. Trial HTML scrape stays trial-only.
7. Institution identity deferred for publishers.
