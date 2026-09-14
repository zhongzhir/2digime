# CONTENT-DISTRIBUTION-FINAL-CLOSURE-01

**Date:** 2026-09-14  
**Branch:** `build/content-distribution-minimum-closed-loop-01`  
**HEAD at closure run:** `b75d8bf40ffb6b2cf62d2c9ae83f501e4dd09e14`  
**Worktree:** `D:\Projects\dm-content-distribution-01`  
**Plan:** `docs/plans/CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01.md`  
**Verdict:** `CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`

Workspace was clean at gate. Closure e2e and related tests added no product surface. Evidence is gitignored: `build/evidence/content-distribution-01/final-closure-01.json`. No secrets and no Digital Self body were written to evidence.

B-participant real-user gate remains frozen `REAL_USER_GATE=1/2` and is independent of this verdict.

---

## Whole-loop evidence

### Passive

Real BBC News RSS → ingest (6 `published`) → canonical URL / provenance `origin=publisher` → Relay broadcast (6 items) → Owner Digital Self `subj_mtvi63v9e2466c8b7b7e` (52 understandings, hash unchanged) → DeepSeek `deepseek-v4-flash` `stub=false` SHOW=1 → open + later → no `content-preferences.json` → explicit `boost` `origin=user_action` → next `selectNetworkItems` / Discover prompt contained the directive (`secondConsumedDirective=true`) → reverse emptied directives.

Relay `GET /v1/network-items?preference=secret` = 400. Directory items have no user profile fields.

### Active

NL request: `帮我找最近值得看的 fusion 进展`.

- Talk injects directory candidates when they match (fixture path already PASS in `content-seek-01`; this BBC pool had no "fusion" token so directory miss is honest).
- `seekContent` + live Gemini Search: `status=used`, 4 HTTP sources, canonical URL retained.
- `content` `action=seek` returned sourced cards.
- No crawler module.

### Real model

Official app model is DeepSeek (`model-config.json`: `api.deepseek.com` / `deepseek-v4-flash`), not DashScope. Closure used the V2 SecretStore runtime file. DashScope/OPENAI env 401 was not used and was not repaired.

### External search

Gemini Search ran live (`hits=4`). Connector path exists in `createGeminiSearchConnector` / `resolveContentSearch`.

---

## Closure matrix

Status values: `PASS` | `DEFERRED_AS_PLANNED` | `BLOCKED_EXTERNAL` | `FAIL`.

### SUPPLY

| Item | Status | Evidence |
|---|---|---|
| recurring supplier path | PASS | RSS/Atom `ingestSource`; live BBC `https://feeds.bbci.co.uk/news/rss.xml` 6 published |
| one-off URL if implemented | PASS | `parseHtmlPreview` + HTML ingest path; unit coverage via non-feed body. This run's first BBC article HTML did not republish (`oneOffUrlIngest=false`); RSS remaining the live supplier path |
| real content | PASS | BBC titles/URLs in gitignored evidence sample |
| metadata generation | PASS | Source title/text/url/publishedAt normalized; optional ingest `enrich` (unit); recipient-side real-model SHOW reason this run |
| canonical/dedup | PASS | `normalizeCanonicalUrl` + stable `itemId`; re-ingest `duplicate`; utm stripped |
| provenance | PASS | `provenance.origin=publisher`; `publisherSubjectId` from source URL |
| disable/remove | PASS | `expiresAt` + `purgeExpired` / list omits expired; ingest `unavailable`/`rejected`. No supplier CMS disable UI |

### NEUTRAL INFRASTRUCTURE

| Item | Status | Evidence |
|---|---|---|
| searchable directory | PASS | `searchContentDirectory`; Relay list; `content` seek |
| no central user profile | PASS | directory items have no Digital Self / preference fields; Relay rejects `preference` / `digitalSelf` |
| no central personalized ranking | PASS | `relay-public-candidates` source has no ranking algorithm; selection is recipient-side |
| Relay transport only | PASS | `POST/GET /v1/network-items` + envelopes; no recipient id in query |
| content-side embeddings | DEFERRED_AS_PLANNED | Plan allows; audit deferred central embeddings; Relay forbids embedding query keys |

### PASSIVE

| Item | Status | Evidence |
|---|---|---|
| real candidate delivery | PASS | 6 BBC items published and listed identically |
| recipient-side selection | PASS | Owner self + DeepSeek `stub=false` |
| Discover SHOW projection | PASS | Talk-adjacent `#content-discover`; SHOW cards only |
| why/reason | PASS | `DiscoverCard.reason` from model |
| AI decision does not write preference | PASS | AI writes `ai_decision` only; `self.json` hash unchanged; open/later do not create preferences file |

### ACTIVE

| Item | Status | Evidence |
|---|---|---|
| NL request | PASS | Talk + `content.seek` with `帮我找最近值得看的 fusion 进展` |
| directory search | PASS | `seekContent` / `searchContentDirectory`; Talk prepends directory hits when matched |
| mature external search when available | PASS | Live Gemini Search 4 hits |
| provenance retained | PASS | HTTP(S) URLs on seek cards; directory items keep `content.url` |
| dedup | PASS | canonical URL; web duplicate of directory URL dropped in unit test |

### CONSUMPTION

| Item | Status | Evidence |
|---|---|---|
| original URL open | PASS | `window.open(content.url)`; `content` `open` writes `user_action` only |
| ask 2digime | PASS | Discover `问兔机米` → `TalkPage.handleSend` with title/url/text; reuses `talk` |
| later/save/history as implemented | PASS | `later` → `network-content-feedback.jsonl` `user_action`; not a second preference store. Dedicated later list UI not built |

### EXPLICIT LEARNING

| Item | Status | Evidence |
|---|---|---|
| explicit action only | PASS | boost/reduce/follow/block write `content-preferences.json`; open/later/AI do not |
| inspectable | PASS | Discover lists directives with text |
| reversible | PASS | `reverse` removes directive; this run emptied the file |
| next decision consumes directive | PASS | DeepSeek second round prompt contained `用户明确的内容偏好指令：` (`stub=false`) |

### TRUST / LIFECYCLE

| Item | Status | Evidence |
|---|---|---|
| invalid/unsafe URL rejection | PASS | `javascript:` ingest rejected; `public-http-safety` SSRF tests |
| duplicate path | PASS | re-ingest records `duplicate` |
| removed/unavailable path | PASS | expired item omitted from directory list; ingest `unavailable` on fetch fail |
| source provenance | PASS | item provenance + URL in cards; evidence sample includes origin/url |

### ENGINEERING

| Item | Status | Evidence |
|---|---|---|
| client-neutral boundary | PASS | domain in `src/` + one `content` command; renderer only invokes commands |
| no CMS | PASS | no catalog CMS added |
| no recommender service | PASS | no central ranker |
| no central profile | PASS | preferences are package-local; Digital Self unchanged |
| no crawler | PASS | `content-seek.ts` has no crawler; RSS/URL GET only |
| relevant tests pass | PASS | see §Tests |
| no secrets / private Digital Self in evidence | PASS | evidence has subjectId, hashes, titles, URLs only |

---

## Planned deferrals (not blockers)

| Item | Why |
|---|---|
| Native iOS/Android / PWA | Plan §16 / audited deferred list |
| Institution publisher KYC | Wrong identity domain |
| URL reputation vendor | Integrate later |
| CMS / media host / transcoding | Forbidden this task |
| Central embeddings / ranking | Forbidden this task |
| Engagement learning | Forbidden; only explicit directives |
| Interruptive push | Discover default |
| Dedicated later/history screen | Events exist; list UI later |
| Supplier disable console | No CMS; item expiry is the V0.1 removal path |
| Default AI enrich on every ingest | Optional hook; not a second semantic index |

---

## Tests

Related suite (ingest / canonical / directory / network item / relay / selection / feedback / preference / Talk / seek / Digital Self / public HTTP safety):

- **74 pass**
- **1 skip** (`Discover with real model` still hits env DashScope 401; not used by closure)
- **0 fail**

Whole-loop e2e:

- **1 pass** (`CONTENT-DISTRIBUTION-FINAL-CLOSURE-01 whole-loop`, DeepSeek + Gemini live)

`git diff --check`: clean.

---

## Verdict

`CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`

The V0.1 loops in plan §23/§24 are demonstrated with real content, Owner Digital Self, official DeepSeek, and live Gemini Search. Central personalization remains none. Explicit preference is the only preference write. Mobile remains deferred with a client-neutral command boundary. Do not start another product slice from this closure.
