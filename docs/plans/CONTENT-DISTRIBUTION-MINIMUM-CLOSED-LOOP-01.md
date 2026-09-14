# CONTENT-DISTRIBUTION-MINIMUM-CLOSED-LOOP-01

**Status:** Repository-audited; implementation may proceed slice by slice  
**Date:** 2026-09-14  
**Product:** Digital Me / 2digime（兔机米）  
**Current Authority:** `origin/main = 7629880f0c995d03135f4186b9c90672483774f1`  
**Preceding engineering trial:** `7d10e865c9c655693a0047c832ec69217a87a43d` (`SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01`, not pushed; engineering gate passed, real-user gate 1/2)

---

## 0. Why this plan exists

The preceding trial proved one important technical proposition:

> The same real content can travel through broadcast / relay to isolated subjects, and each recipient's own 2digime can use that recipient's Digital Self and a real model to independently decide SHOW / IGNORE without central personalization.

That is **not yet a content-distribution product**.

The next task is to establish the smallest product architecture and real user flow that connects:

> **content supply → ingestion → discovery → recipient-side AI selection → consumption → explicit human feedback → next-round selection**

The goal is not to build another centralized recommendation platform, CMS, video platform, or social network. The goal is to make **content a first-class use case of a user-owned digital subject network**.

---

# 1. Product-development requirement added in this task

## 1.1 Problem-first completeness gate

Owner input is **not a specification and not presumed to be an optimal problem statement**.

The Owner may be:
- pointing to a concern rather than defining the whole problem;
- proposing a possible solution rather than the best solution;
- omitting important actors, lifecycle stages, risks, non-functional requirements, or alternative approaches;
- framing the problem too narrowly or at the wrong layer.

Therefore, before planning or implementation, AI must:

1. **reframe the problem itself** — verify that the problem statement is correct and sufficiently general;
2. **identify omitted must-have dimensions** — actors, lifecycle, UX, data, security, trust, rights, operations, economics, interoperability, failure handling, observability, migration, accessibility, and future platform implications where relevant;
3. **benchmark mature approaches and existing capabilities first**;
4. **separate essential architecture from optional future features**;
5. **propose the smallest complete solution**, not merely implement the list of items the Owner happened to mention;
6. **explicitly challenge or correct Owner proposals** when they would create local optimization, unnecessary complexity, product drift, or conflict with established Digital Me principles;
7. ask the Owner only for decisions that materially change product direction, risk, cost, or irreversible architecture.

This rule strengthens the existing "Owner opinion = hypothesis / clue" principle. It applies to all future Digital Me product, architecture, planning, development, and acceptance work.

---

# 2. Reframed problem

The real problem is not:

> "How should 2digime recommend content?"

It is:

> **How can a user-owned digital subject continuously obtain, understand, select, consume, and use content from many suppliers without handing the user's identity, preferences, or attention model to a central recommendation platform?**

This has four sides that must all work:

1. **Supply:** creators / institutions need a low-friction way to make content discoverable.
2. **Neutral network / catalog:** content must be addressable, searchable, deduplicated, trustworthy enough, and distributable without central user profiling.
3. **Personal subject:** each user's own 2digime must decide what is worth surfacing, based on the user's own Digital Self and explicit content preferences.
4. **Consumption and feedback:** the user must be able to consume, ask AI to help understand/use the content, and explicitly adjust future distribution.

A fifth cross-cutting side is mandatory:

5. **Trust / rights / operations:** provenance, content rights, spam, malicious links, takedown, lifecycle, metrics, failures, and supplier feedback must be designed enough that the loop is viable.

---

# 3. Strategic product hypothesis

For knowledge workers, "doing work" may remain a primary value surface.

For ordinary users, **content discovery + consumption + AI-assisted understanding and use** may become one of 2digime's highest-frequency value surfaces.

The differentiation is not "another feed". It is:

> **My 2digime finds and filters the world for me, can explain why something matters to me, can help me understand and use it, and only changes my long-term content preferences when I explicitly tell it to.**

This must remain compatible with Digital Me's sovereignty principles:
- the user owns the Digital Self;
- central services do not own a personal profile;
- the network does not optimize for time-spent by default;
- user intent and explicit preference directives outrank engagement optimization;
- AI decisions do not silently rewrite the user.

---

# 4. Scope and explicit non-goals

## 4.1 In scope for the minimum closed loop

The first complete slice must cover:

1. one or more real supplier ingestion paths;
2. normalized content metadata;
3. source identity and provenance;
4. neutral content catalog / searchability;
5. new-content distribution into the existing network substrate;
6. recipient-side candidate selection by each user's own 2digime;
7. a minimal user-facing discovery / consumption surface;
8. active user search in natural language;
9. explicit preference controls;
10. consumption history separate from preference learning;
11. content lifecycle / removal handling;
12. minimum safety / spam / malicious-link handling;
13. supplier-visible ingestion status;
14. observability sufficient to debug supply-to-consumption failures;
15. architecture that can support a mobile thin client later.

## 4.2 Explicitly not in the first slice

Do not build:

- a centralized recommendation engine;
- a central user-profile or user-embedding service;
- a TikTok-like ranking model;
- a full CMS;
- a full creator studio;
- a media hosting / transcoding platform;
- a custom web crawler when mature search / feed / API mechanisms are available;
- a large ontology;
- a new social network;
- a native iOS / Android app in this slice;
- an ad system;
- a payment / revenue-sharing system;
- creator monetization settlement;
- engagement-based preference learning;
- autoplay / infinite-scroll optimization for time spent.

---

# 5. Actors and lifecycle

## 5.1 Actors

### User / Subject Owner
Owns:
- Digital Self;
- explicit content preferences;
- local consumption history;
- final decisions about what to follow, boost, reduce, or block.

### 2digime
Responsible for:
- understanding user intent;
- discovering candidate content;
- recipient-side evaluation;
- explaining / summarizing / comparing content;
- applying explicit preference directives;
- managing local consumption state;
- selecting external capabilities rather than reimplementing them.

### Content supplier
May be:
- individual creator;
- publisher;
- media organization;
- platform;
- institution;
- automated public source.

Needs:
- very low-cost publishing / ingestion;
- source identity;
- status visibility;
- eventual aggregate reach / action signals without access to user profiles.

### Content Directory / Index
Stores **content-side** data, not user-side profiles:
- canonical content identity;
- source / publisher identity;
- metadata;
- AI-generated semantic descriptors;
- searchable index;
- lifecycle state;
- global safety / abuse state;
- availability.

### Relay / Network Transport
Responsible only for:
- broadcast / delivery;
- addressing;
- expiry / revocation / minimal audit;
- transport metadata.

### External capability providers
Examples:
- web search;
- RSS/Atom parser;
- platform APIs;
- embedding / semantic search;
- malware / URL reputation;
- model-based content understanding.

Build-vs-Integrate applies before implementing any of these.

---

# 6. End-to-end target architecture

```text
Supplier / Public Source
        │
        │ URL / RSS / Atom / API / institutional feed
        ▼
Content Ingestion
        │
        ├─ source identity / rights assertion
        ├─ fetch / normalize
        ├─ deduplicate / canonicalize
        ├─ AI metadata extraction
        ├─ safety / malicious-link checks
        ▼
Neutral Content Directory + Search Index
        │
        ├─────────────── Active discovery ───────────────┐
        │                                                │
        │ new-content event                              │ natural-language query
        ▼                                                ▼
Existing broadcast / relay                     2digime search planner
        │                                                │
        ▼                                                ├─ Content Directory
Recipient runtime                                      ├─ public web/search
        │                                                ├─ connected content APIs
        ├─ own Digital Self                              └─ user's saved/history
        ├─ explicit Content Preferences                         │
        ├─ current intent / context                             ▼
        ▼                                                candidate set
real model / 2digime                                      │
        │                                                  ▼
SHOW / IGNORE / explanation                    recipient-side evaluation
        │                                                  │
        └───────────────────────┬───────────────────────────┘
                                ▼
                          Discover / Content View
                                │
                    ┌───────────┼────────────┐
                    ▼           ▼            ▼
                 consume     ask 2digime    save/history
                    │           │
                    │      summarize / assess /
                    │      compare / explain / use
                    ▼
              explicit user action
          boost / reduce / follow / block
                    │
                    ▼
       user-owned Content Preference Directives
                    │
                    └──── used in future recipient-side selection
```

Critical boundary:

```text
Central:
content metadata + content embeddings + global safety state = allowed

Central:
user profile + user preference vector + personalized ranking = forbidden

Recipient 2digime:
Digital Self + explicit preferences + current intent + candidate content
→ personalized decision
```

---

# 7. Content object: minimal but future-safe

Do not create a large schema before repository audit. Reuse `NetworkItem` where possible.

A minimal normalized content record should be able to represent:

### Identity
- `contentId`
- `canonicalUrl`
- `contentFingerprint` / payload hash
- source item ID if provided

### Supplier / provenance
- `publisherId` or source identity
- `sourceName`
- `sourceUrl`
- `ingestionMethod`
- `submittedAt`
- `publishedAt`
- provenance / verification level

### Structural metadata
- `contentType` (article / video / comic / audio / course / post / etc.)
- language
- title
- summary
- thumbnail / official media reference where legally usable
- duration / length when available

### Semantic metadata
Generated by AI, not required from suppliers:
- broad topics;
- entities;
- themes;
- style / format descriptors;
- audience / age suitability when relevant;
- model-generated quality / confidence annotations.

### Lifecycle
- `status`: active / unavailable / removed / blocked
- `updatedAt`
- expiry if applicable
- takedown / revocation pointer

### Rights / availability
- original-link-only / embeddable / licensed-hosted;
- geo / login / subscription restrictions when known.

Do not require suppliers to manually fill dozens of tags.

---

# 8. Taxonomy and semantic understanding

Use a **three-layer description**, not a complex ontology.

## Layer A — structural attributes
Deterministic / source-provided:
- content type;
- language;
- publisher;
- publish date;
- duration;
- accessibility / login requirement.

## Layer B — coarse browse categories
Small, stable set only for human browsing:
- news;
- article;
- video;
- comic;
- film/TV;
- game;
- audio;
- course;
- other.

Exact list must be validated against existing product terminology before implementation.

## Layer C — AI semantic descriptors
Generated from the content:
- topics;
- people / organizations;
- events;
- themes;
- genre;
- tone;
- domain;
- novelty / evidence / uncertainty cues where useful.

Use model understanding / embeddings for search and matching. Do not hand-engineer a large rule taxonomy.

Supplier tags may be accepted as claims but should not be the sole truth.

---

# 9. Supply-side minimum viable path

The supply system should minimize duplicate work for publishers.

## Near-term ingestion methods

### 1. Single URL
Best for:
- small creators;
- manual validation;
- customer support / trial.

Flow:
`URL → fetch metadata/content where allowed → normalize → preview → publish`

### 2. RSS / Atom / existing feed
Best for:
- publishers;
- blogs;
- media;
- recurring content.

Flow:
`feed registration → scheduled ingest → dedup → publish`

### 3. Simple JSON / API publishing endpoint
Best for:
- platforms;
- institutions;
- high-volume suppliers.

Must be minimal and documented.

## Later, only when demand exists
- sitemap ingest;
- webhook;
- platform-specific connectors;
- batch file import;
- managed institutional integrations.

## Supplier UX minimum
Supplier needs:
- source / feed registration;
- validation result;
- ingestion status;
- errors in human-readable form;
- sample preview;
- ability to disable / revoke a source.

No full CMS in V0.1.

---

# 10. Supplier identity, provenance, trust, and rights

This was not in the Owner's initial list but is mandatory for a real supply chain.

## 10.1 Source identity
Reuse Institution Distribution identity / authorization if suitable.

At minimum distinguish:
- verified supplier;
- claimed supplier;
- discovered public source.

## 10.2 Provenance
Users and 2digime must be able to know:
- where the content came from;
- whether it was supplier-submitted or discovered;
- canonical original URL;
- when metadata was fetched.

## 10.3 Rights
Default V0.1 policy:
- index metadata;
- link to original source;
- do not rehost copyrighted media by default;
- only embed / cache / transform where source terms and rights allow;
- AI summary / quotation must respect applicable content-use rules.

## 10.4 Takedown / revocation
A supplier or operator must be able to:
- disable an item;
- disable a feed;
- mark an item removed;
- propagate removal / expiry into the directory and future delivery.

A removed item should not continue to appear as newly recommended.

---

# 11. Global safety and abuse controls

"Central network does not personalize" does **not** mean "central services do nothing".

Central, content-side controls are legitimate and necessary:
- malware / phishing URL screening;
- illegal content handling;
- spam / duplicate flood control;
- basic content policy enforcement;
- source abuse throttling;
- content availability health checks.

These are global content / safety functions, not personalized ranking.

Personalized suitability remains recipient-side.

---

# 12. User-owned content preference model

Do not make all of Digital Self equivalent to "interests".

Introduce or reuse a thin **Content Preference Directive** concept owned by the user's subject.

Sources that may change preference:
- explicit UI action;
- direct natural-language statement by the user.

Examples:
- "多给我 AI 应用案例"
- "少推体育"
- "关注这个作者"
- "别再给我这个来源"
- "多给我类似这条的内容"

Required provenance:
`origin=user_action` or equivalent explicit user provenance.

## 12.1 Events that do NOT automatically change preference

By default:
- impression;
- dwell time;
- scroll depth;
- open;
- completion;
- replay;
- save;
- share;
- AI SHOW / IGNORE.

These may be stored as consumption/history events when useful, but must not silently rewrite preference.

## 12.2 Explicit preference actions

V0.1 should support a small set:
- **加推类似**
- **少推类似**
- **关注主题/来源**
- **不再推荐主题/来源**

Exact UI wording should be validated in product design.

The system may use AI to interpret "类似" semantically, but the resulting directive belongs to the user and must remain inspectable / reversible.

---

# 13. Passive acquisition / push

Passive acquisition has two stages:

## Stage 1 — candidate availability
The network makes candidate content available to the recipient.

Possible sources:
- subscribed feeds;
- network broadcast;
- followed sources / topics;
- later: opportunity / subject-network signals.

## Stage 2 — recipient-side selection
The user's 2digime uses:
- current Digital Self;
- explicit Content Preference Directives;
- current intent / context;
- candidate content metadata;
- real model reasoning;

to produce:
- SHOW;
- IGNORE;
- optional short explanation / reason.

No central personalized rank is required.

## 13.1 Notification is a separate decision
"SHOW in Discover" and "interrupt the user with a push notification" are not the same.

V0.1:
- default to appearing in Discover;
- avoid OS/mobile interruption by default.

Later:
- recipient-side 2digime may decide notification urgency under user-configured notification policy;
- central push service sees only opaque delivery instructions, not the user's profile.

This avoids notification fatigue and preserves sovereignty.

---

# 14. Active acquisition / search

The user should be able to ask naturally:

- "找一些最近值得看的漫剧"
- "最近 AI 视频生成有什么真正有用的内容？"
- "我想系统了解中国 AI 短剧的发展"
- "帮我找这周最值得看的核聚变进展"

2digime should plan search across:
1. Content Directory;
2. public web search / mature search capability;
3. connected platform APIs / feeds;
4. user's saved / historical content when relevant.

Then AI should:
- deduplicate;
- assess source quality;
- compare;
- explain relevance;
- summarize;
- identify uncertainty;
- organize results for the user's actual goal.

Do **not** build a custom crawler/search engine if mature capabilities can be integrated.

---

# 15. Content consumption UX

## 15.1 The product value is more than "show a feed"

For each surfaced item, the user should be able to:
- open / read / play at the source;
- save / later;
- ask 2digime;
- get summary;
- get assessment / credibility / relevance explanation where appropriate;
- compare with alternatives;
- turn content into an action / learning / work input;
- explicitly adjust future distribution.

This is where 2digime can outperform a normal feed.

## 15.2 Minimal desktop surface

Do not create a large "content platform".

Recommended minimum:
- existing main conversational shell remains primary;
- add a lightweight **发现** surface / tab if repository/product audit confirms it fits current IA;
- natural-language search field;
- feed/list of content cards;
- item detail / external open;
- "问兔机米";
- save / later;
- explicit preference controls.

Final placement must follow the current product spec and existing navigation rather than this draft if they conflict.

---

# 16. Mobile strategy

Content consumption for ordinary users is likely mobile-first in the long run.

But native mobile is **not** required to validate the first closed loop.

## Short term
- Electron / existing desktop client proves the complete product loop.
- Domain APIs and state models must not depend on Electron renderer internals.
- Content cards and actions should use client-neutral contracts.

## Medium term
- thin mobile web / PWA or equivalent client for:
  - Discover;
  - content open;
  - search;
  - save;
  - explicit feedback;
  - lightweight talk-to-2digime.

Technology choice should be made after audit of current frontend/runtime separation.

## Long term
- mobile 2digime runtime / secure local subject state;
- native notifications;
- local recipient-side decision where practical;
- cross-device end-to-end sync of user-owned state.

Do not build native iOS/Android in this task.

---

# 17. Cross-device state

This is another required architecture concern.

The following belong to the user:
- explicit content preferences;
- saved / later list;
- consumption history;
- follow / block state.

If multiple devices are introduced, these must sync as **user-owned subject state**, not as a central advertising profile.

V0.1 may remain single-device, but data contracts should not make future E2E subject sync impossible.

---

# 18. Content lifecycle, deduplication, and freshness

Required minimum behaviors:

## Deduplication
The same article/video/item may arrive from:
- supplier API;
- RSS;
- manual URL;
- network broadcast.

The directory should canonicalize and deduplicate when possible.

## Updates
If source metadata changes:
- update the canonical content record;
- retain traceable timestamps.

## Unavailable content
If original content disappears:
- mark unavailable;
- stop new surface;
- preserve only minimal history necessary for the user's own record.

## Freshness
Freshness is a content-side signal and may be indexed centrally.
How freshness matters **to a specific user** remains recipient-side.

---

# 19. Quality, credibility, and AI-assisted assessment

For high-information content, 2digime should gradually provide:
- source credibility context;
- duplicates / syndicated copies;
- evidence quality;
- whether claims are opinion / reporting / primary source;
- comparison against other sources;
- "why this matters to you".

For entertainment content:
- genre / theme / format understanding;
- spoiler-safe summaries where possible;
- suitability / time commitment;
- recommendation rationale.

Do not create a universal numeric "quality score" in V0.1 unless an existing mature capability already provides one and it is clearly useful.

---

# 20. Supplier economics and analytics — reserve, do not build fully

A sustainable supplier path eventually requires evidence of value.

Future suppliers will need:
- ingestion success;
- aggregate delivery / open / explicit-interest signals;
- source attribution;
- referral / conversion hooks;
- potentially settlement / licensing.

However, this must not expose personal profiles.

V0.1:
- keep stable `contentId` / `publisherId`;
- retain enough event semantics to support future aggregate analytics;
- supplier sees ingestion status, not individual recipient profiles.

Later:
- privacy-preserving aggregate analytics;
- optional attribution / settlement.

Do not build ad-tech analytics.

---

# 21. Observability and failure handling

A "closed loop" is not real if nobody can tell where it broke.

At minimum be able to distinguish:
- supplier fetch failed;
- item rejected;
- duplicate;
- directory publish failed;
- broadcast failed;
- relay delivery failed;
- recipient selection failed;
- model unavailable;
- content source unavailable;
- user action write failed.

User-facing errors must be plain language.
Technical audit can keep detailed IDs/logs.

---

# 22. Accessibility, localization, and international content

Reserve:
- multi-language metadata;
- translation / summarization via model;
- accessibility labels where source provides them;
- keyboard / screen-reader compatible core actions;
- captions/transcript availability metadata for audio/video.

Do not turn this into a large accessibility project now, but do not create schema/UI that blocks it.

---

# 23. Minimal product loops to validate

## Loop A — passive distribution

```text
real supplier source
→ ingest
→ normalize / metadata
→ Content Directory
→ NetworkItem / broadcast
→ relay
→ user's 2digime
→ recipient-side SHOW / IGNORE
→ Discover
→ open / ask 2digime
→ explicit boost/reduce/follow/block
→ user-owned preference directive
→ next candidate decision consumes the new directive
```

## Loop B — active acquisition

```text
user natural-language request
→ 2digime
→ Content Directory + mature external search capability
→ deduplicate / assess / organize
→ results
→ open / ask / save
→ optional explicit preference directive
```

The task is not complete until both loops work at least minimally.

---

# 24. V0.1 acceptance criteria

A successful V0.1 should prove all of the following.

## Supply
- at least one low-friction recurring supplier path (prefer existing RSS/feed/API if already available);
- one-off URL path if cheap to support;
- real content, not fixtures;
- AI metadata generation;
- dedup / canonical ID;
- supplier/source provenance;
- disable/remove path.

## Neutral infrastructure
- searchable content directory;
- no central user profile;
- no central personalized ranking;
- content-side embeddings/metadata allowed;
- existing Relay remains transport-only.

## Passive user path
- same content can reach candidate recipients;
- each recipient's own 2digime decides locally/subject-side;
- Discover surfaces SHOW items;
- "why this was shown" or equivalent minimal explanation available;
- AI decision does not modify preferences.

## Active user path
- natural-language content request;
- searches directory and at least one mature external discovery capability if available;
- AI organizes / explains results.

## Consumption
- user can open original content;
- user can ask 2digime to summarize/evaluate/explain/use the content;
- save/later or equivalent history exists.

## Explicit learning
- at least boost/reduce or equivalent preference controls;
- only explicit user action changes content preference;
- change is inspectable and reversible;
- subsequent recipient-side judgment consumes that change.

## Trust and lifecycle
- malicious / invalid URL failure path;
- duplicate handling;
- item removal/unavailable handling;
- source provenance visible in audit and minimally in UI.

## Engineering
- client-neutral domain/API boundary sufficient for future mobile thin client;
- tests cover central neutrality and explicit-feedback-only learning;
- no new CMS / recommender / user-profile center;
- workspace clean;
- no secrets / private Digital Self in evidence.

---

# 25. Repository audit required before implementation

Before writing product code, inspect existing implementation and map each target capability to:

`REUSE / EXTEND / INTEGRATE / BUILD / DEFER`

Audit at least:

- `NetworkItem`;
- Subject Network Feed;
- broadcast;
- Relay endpoints and storage;
- `selectNetworkItems`;
- Digital Self loading and write path;
- `network_content_feedback`;
- `networkItemPayloadHash`;
- Institution Distribution v0.1;
- existing source / publisher identity;
- existing search / web capabilities;
- any RSS / URL ingestion support;
- capability installer / external web search tools;
- existing UI navigation and feed surfaces;
- local audit / event store;
- userData / subject state structure;
- cross-device / sync boundaries if present;
- tests around network neutrality and Digital Self isolation.

The audit must also inspect the unpushed trial commit:

`7d10e865c9c655693a0047c832ec69217a87a43d`

and determine:
- which changes are genuine reusable product primitives;
- which are trial-only harness/evidence;
- whether the new content task should linearly build on it;
- whether any part should be reverted or kept out of the product surface.

No duplicate subsystem may be built before this audit.

---

# 26. Audit output required

Produce:

`docs/audits/CONTENT-DISTRIBUTION-CAPABILITY-AUDIT-01.md`

with a table:

| Required capability | Existing implementation | Evidence | Decision | Minimal gap |
|---|---|---|---|---|
| Supplier ingest | | | REUSE/EXTEND/INTEGRATE/BUILD/DEFER | |
| Source identity | | | | |
| Content normalization | | | | |
| Semantic metadata | | | | |
| Dedup | | | | |
| Directory/search | | | | |
| Broadcast | | | | |
| Relay | | | | |
| Recipient selection | | | | |
| Explicit preference | | | | |
| Discover UI | | | | |
| Active search | | | | |
| Ask-2digime | | | | |
| Save/history | | | | |
| Removal/takedown | | | | |
| Safety/spam | | | | |
| Observability | | | | |
| Mobile-ready boundary | | | | |

The audit may correct this planning draft.

---

# 27. Post-audit planning gate

After audit, update this plan into an implementation-ready plan.

The implementation plan must:
- identify the **fewest product cuts** needed to close both loops;
- name exact existing modules to reuse;
- name mature external capabilities to integrate;
- identify any schema additions and justify each;
- state which items are explicitly deferred;
- define tests before implementation;
- contain no speculative platform build.

If the audit discovers a more general or better framing, correct this document rather than forcing implementation to match the draft.

---

# 28. Development order

Only after audit + updated plan:

## Slice 1 — supply to neutral directory
Real source → ingest → normalize → metadata → dedup → searchable item.

## Slice 2 — passive subject-side distribution
Directory item → existing network → recipient-side selection → Discover.

## Slice 3 — consumption and explicit preference
Open / ask 2digime → explicit boost/reduce/follow/block → preference directive → next decision consumes it.

## Slice 4 — active acquisition
Natural-language query → directory + integrated external search → AI-organized results.

Each slice:
`real validation → acceptance → commit → next slice`.

Do not implement all slices in one giant change.

---

# 29. Authority / branch discipline

Continue:

> one Authority → one current main task → real validation → acceptance → commit → next slice

The previous B-participant gate is **frozen**, not cancelled:
- engineering trial: passed;
- Owner real-user gate: passed;
- two-human final gate: 1/2;
- it does not block this content-distribution task.

Linear history decision: this task continues on `7d10e865c9c655693a0047c832ec69217a87a43d` via branch `build/content-distribution-minimum-closed-loop-01`. Do not merge/rebase/cherry-pick.

---

# 30. Final success definition

This task succeeds when 2digime can demonstrate, with real content:

> A supplier can make content available at low cost; the content becomes neutrally searchable/distributable; each user's own 2digime can independently find or receive it, decide whether it is worth showing, help the user understand/use it, and only change future content preferences after explicit human instruction — without a central service owning the user's personalized recommendation profile.

That is the minimum content-distribution architecture worth extending into mobile, richer supplier integrations, creator economics, and larger-scale network effects.

---

## Repository-audited implementation plan

Audit: `docs/audits/CONTENT-DISTRIBUTION-CAPABILITY-AUDIT-01.md`. Material corrections vs this draft: directory = existing Relay NetworkItem store; Discover = Talk-adjacent projection not a fourth primary tab; dedup = canonical URL not `networkItemPayloadHash`; preference directives are package-local, not Digital Self; one `content` command; trial HTML scrape stays trial-only.

### Exact modules/files to reuse

- `src/subject-comm/network-item.ts` — `NetworkItem` v1, `validateNetworkItem`, `networkItemPayloadHash`, `candidatePoolHash`, `filterNetworkItems`
- `src/subject-comm/relay-client.ts` — `publishNetworkItem`, `listNetworkItems`
- `src/relay-service/network-item-store.ts` — `FileNetworkItemStore` / `MemoryNetworkItemStore`
- `src/relay-service/server.ts` — `POST/GET /v1/network-items`, forbidden personalization keys
- `src/subject-comm/personal-selection.ts` — `selectNetworkItems`
- `src/subject-comm/network-content-feedback.ts` — `ai_decision` vs `user_action`
- `src/subject-core/digital-self/store.ts` — `readDigitalSelf` / `writeDigitalSelf`
- `src/work-runtime/public-http-safety.ts` — SSRF-safe GET
- `src/capability/conversation-search.ts` + `src/capability/adapters/gemini-search.ts` — active web search
- `src/runtime/commands.ts` `talk` — ask-2digime / active NL request
- `electron/renderer/index.html` Talk shell — Discover projection host

### Exact external capabilities to integrate

- Public RSS/Atom or HTTPS URL as supplier input (real feed, not fixture)
- Gemini Search Grounding when a search credential exists (Bing HTML is not primary)
- System browser open of original `content.url` (no rehost)

### Exact minimal schema changes

- No `NETWORK_ITEM_SCHEMA_VERSION` bump
- Stable `itemId` = hash of normalized canonical URL; overwrite on re-ingest
- Package-local `content-preferences.json` (explicit directives only)
- Optional ingest status file (fetched / rejected / duplicate / published / expired)
- Local later/history list derived from `user_action` events, not a second profile

### Exact UI surface changes

- Slice 1: none
- Slice 2: Talk-adjacent Discover list of SHOW items + short reason; no new primary nav; do not unhide `#nav-collab`
- Slice 3: open / later / boost / reduce / follow / block on the card; inspect/reverse directives
- Slice 4: natural-language request stays in Talk; results may also appear as content cards

### Exact tests

- Slice 1: canonical URL dedup; RSS/URL → valid NetworkItem; no user fields in directory; real feed fetch (skip if offline)
- Slice 2: identical Relay pool; two Digital Selves diverge; `self.json` unchanged after SHOW/IGNORE; Discover view contains only SHOW; Relay query still rejects personalization keys
- Slice 3: only `user_action` writes directives; open/later/AI decision do not; next `selectNetworkItems` prompt includes directive; reverse works
- Slice 4: Talk query hits directory and/or Gemini Search; provenance URL retained; no crawler module

### Exact deferred items

- Native iOS/Android / PWA
- Institution publisher KYC
- URL reputation / malware vendor
- CMS, media hosting, transcoding
- Central personalized ranking / user embeddings
- Engagement-based preference learning
- Interruptive push notifications
- Supplier aggregate analytics product
- Accessibility/l10n project (do not block schema)
- Sitemap / webhook / platform connectors
- Payment / ads / settlement

### Exact slices and commit boundaries

1. **Slice 1 — supply → neutral directory**  
   New: `src/subject-comm/content-canonical.ts`, `content-ingest.ts`, `content-directory.ts` + tests.  
   Commit only after real RSS/URL ingest into NetworkItem store with dedup. No UI.

2. **Slice 2 — directory → Discover**  
   New: `content` command (one CommandBus name), wire `selectNetworkItems` + Digital Self, Talk-adjacent SHOW list.  
   Commit after real model SHOW/IGNORE on real ingested items.

3. **Slice 3 — explicit preference**  
   New: package-local directive store consumed by selection.  
   Commit after boost/reduce/follow/block changes the next decision and remains reversible.

4. **Slice 4 — active acquisition**  
   Talk + directory match + Gemini Search.  
   Commit after a natural-language request returns sourced results.

Each slice: real validation → commit → next. No push until Owner acceptance.

---

# Closure

**2026-09-14 verdict:** `CONTENT_DISTRIBUTION_MINIMUM_CLOSED_LOOP_ACCEPTED`

Audit: `docs/audits/CONTENT-DISTRIBUTION-FINAL-CLOSURE-01.md`.

Demonstrated with real BBC RSS, Owner Digital Self, official DeepSeek (`stub=false`), and live Gemini Search:

- content supply → consumption closed loop
- central personalization = none
- explicit preference only
- active + passive acquisition
- mobile deferred, client-neutral `content` command reserved
- B-participant real-user gate remains frozen 1/2 and independent

