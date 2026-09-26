# DISCOVER-2.0-FAST-SELECTION-06

Date: 2026-09-26. Verdict: **DISCOVER_FAST_SELECTION_ACCEPTED**.

Branch: `build/discover-2-news-supply-01`; baseline `fd9c2a3`. New HEAD: the commit that adds this document. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Independent blank test Subject/Package only.

## Scope

The remaining Discover latency came from `deepseek-v4-flash` spending reasoning tokens on many lightweight selection/grouping calls (1000–3800 reasoning tokens each, 5–50s, high variance). This task routes content processing that does **not** need complex reasoning through a non-thinking fast mode, keeping thinking only where complex semantic judgment is required. No rule-based recommender, no source reduction, no change to Digital Self selection.

## Current model-call map and FAST / DEEP classification

Judged by real input/output complexity, not function names.

| Call site | Task | Class | Mode applied |
|---|---|---|---|
| `discover-intent.interpretDiscoverIntent` | intent classification / extraction | FAST | `thinking: disabled` |
| `discover-intent.classifyCandidateRoles` | metadata relevance / type / event role | FAST | `thinking: disabled` |
| `news-selection` stage 1 | metadata relevance shortlist | FAST | `thinking: disabled` |
| `news-selection` stage 3 | same-event clustering / representative | DEEP-low | `reasoning_effort: low` |
| `personal-feed.proposeDiscoveryIntents` | propose Feed search intents | FAST | `thinking: disabled` |
| `open-web-discovery.proposeOpenWebQueries` | propose search queries | FAST | `thinking: disabled` |
| `personal-selection.selectNetworkItems` | personal Feed selection with Digital Self | DEEP | unchanged (provider default) |
| Ask 2digime / Talk | deep content understanding | DEEP | unchanged (provider default) |

## Build-vs-Integrate Gate — capability proof

The real DeepSeek credential, model `deepseek-v4-flash`, endpoint `https://api.deepseek.com/v1`, same structured request, three modes (`evidence/fast-selection-06/thinking-probe.json`):

| Mode | latency | reasoning tokens | output | result |
|---|---:|---:|---:|---|
| A thinking enabled | 1350ms | 57 | 65 | `{"ids":[0,2]}` |
| B `thinking.type=disabled` | 482ms | 0 | 7 | `{"ids":[0,2]}` |
| C `reasoning_effort=none` | 379ms | 0 | 7 | `{"ids":[0,2]}` |

Non-thinking is supported by the current service and returns identical structured JSON without a new provider. `reasoning_effort: low` (thinking on) was also verified: 208 reasoning tokens vs 673 medium / 411 default, and it correctly separated same-event from unrelated headlines in the clustering probe. Mechanism reused: the existing OpenAI-compatible adapter gained `thinking` / `reasoning_effort` payload fields; no adapter rewrite, `response_format=json_object` reused.

## Changes

- `infrastructure/model-http.ts`: `ChatCompleteOptions.thinking` (`enabled`/`disabled`) and `reasoningEffort` (`none`/`low`/`medium`/`high`) are forwarded to the provider; usage parsing now reports `reasoningTokens`.
- `discover-intent.ts`, `personal-feed.ts`, `open-web-discovery.ts`, `news-selection.ts` (stage 1): lightweight structured calls set `thinking: disabled` and a small `max_tokens`.
- `news-selection.ts` (stage 3 clustering): `reasoning_effort: low`. With thinking fully disabled, clustering over-merged distinct podcast episodes into one event; low effort restores correct grouping at ~200–400 reasoning tokens.
- `news-selection.ts`: stage-1 batch raised to 20 (safe now that no reasoning fills the budget), split-on-failure retained for the token-exhaustion case.
- No keyword/score routing: each call site chooses fast/deep from its known task nature only.

## BEFORE / AFTER — token usage

BEFORE reasoning was not separately logged; LATENCY-05 measured it at ~1000–3800 reasoning tokens per selection call across ~10–15 calls (tens of thousands per query). AFTER (per query, from `latency.json`):

| Query | calls | reasoning tokens | reasoning calls | input tokens | output tokens |
|---|---:|---:|---:|---:|---:|
| A | 14 | 2,908 | 2 | 39,970 | 3,716 |
| B | 14 | 2,711 | 2 | 39,276 | 3,237 |
| C | 13 | 275 | 1 | 35,719 | 445 |
| D | 14 | 2,066 | 3 | 40,944 | 2,513 |

All remaining reasoning tokens are the stage-3 clustering calls (`reasoning_effort: low`). Every FAST call reports **0** reasoning tokens.

## BEFORE / AFTER — latency

Same four real queries, same isolated Electron + real DeepSeek credential. Current = `fd9c2a3` (LATENCY-05 evidence); FAST = this task.

| Query | BEFORE TTFV | AFTER TTFV | BEFORE complete | AFTER complete | calls | cards |
|---|---:|---:|---:|---:|---:|---:|
| A 今天有什么重要科技新闻？ | 9.9s | **6.0s** | 90.4s | **29.1s** | 27→14 | 14 |
| B 最近有什么值得看的 AI 深度内容？ | 70.2s | **5.8s** | 175.8s | **34.3s** | 35→14 | 6 |
| C 给我找一些最近值得看的 AI 视频。 | 41.6s | 22.7s | 41.8s | **22.9s** | 28→13 | 4 |
| D 最近有什么值得听的科技/商业音频？ | 20.8s | **6.4s** | 143.4s | **41.4s** | 28→14 | 4 |

3/4 queries render first cards in `< 15s` (A/B/D 5.8–6.4s); C is 22.7s because a specific "AI video" request has no directly playable domestic AI video in the fast Feed-only pool and waits for the Search-backed pass. TTFC is now `<= 45s` for all four (`22.9–41.4s`). Run-to-run variance collapsed for A/B/D (previously 5–85s swings; now within ~1s).

## Quality comparison

- **A news**: 12 real, dated news cards, all with readable bodies — not reduced or degraded.
- **B deep content**: 6 cards, mixed audio/news/article; the non-thinking shortlist did not degrade to keyword matching (it still separates AI-relevant from unrelated items).
- **C video**: video cards retained; content type still identified as `video`.
- **D audio**: real science/business podcast audio selected, direct `<audio>` playback retained.
- **Multi-source clustering**: the clustering probe (three independent publishers of one Tesla Optimus event + unrelated items) grouped exactly the three same-event reports and kept the others separate; deterministic same-event tests pass. Today's live data had no multi-publisher event, so the live regression uses that probe plus the existing deterministic grouping contract.
- **Progressive UI**: no duplicate cards after the fast→full merge (fast cards 3/4/0/3; final 14/6/4/4; 0 duplicate titles), item identity preserved by canonical URL.

## Validation

TypeScript build PASS; `git diff --check` PASS. `subject-comm + capability + runtime`: 369/382 PASS, 3 skipped, 10 failed — all pre-existing and unrelated (Electron not installed in this worktree, invalid DashScope key, missing default model credential, external-site/live-feed changes). The live-feed failure was re-confirmed identical on the untouched baseline via `git stash`. FAST-path unit tests (two-stage batching, split-on-length, provenance, clustering, feedback/identity) PASS.

## Verdict

**DISCOVER_FAST_SELECTION_ACCEPTED** against the 13 conditions: non-thinking verified on the existing DeepSeek service; no new provider; lightweight selection no longer uses heavy reasoning; reasoning tokens dropped to 275–2,908 per query (only clustering, at low effort); TTFV variance collapsed and 3/4 queries are `< 15s`; TTFC all `<= 45s`; news selection, multi-source clustering, article/video/audio capability and the progressive UI show no regression; no keyword recommender; no central recommendation; tests pass.

## Recommended next single task

`DISCOVER-2.0-LATENCY-07`: close the remaining gap for the "specify a media type" case (query C) — make the first pass include the constrained Search/媒体补充 candidates when the request names a type, so a video/audio request also renders in `< 15s`; and add the light in-process TTL cache for public Feed/metadata/article bodies that LATENCY-05 deferred, so repeated sources in one session are not re-fetched.
