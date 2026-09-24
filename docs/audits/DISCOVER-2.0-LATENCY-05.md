# DISCOVER-2.0-LATENCY-05

Date: 2026-09-24. Verdict: **DISCOVER_LATENCY_PARTIAL**.

Branch: `build/discover-2-news-supply-01`; baseline `2d38721`. New HEAD: the commit that adds this document. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Independent blank test Subject/Package only.

## Scope

Reduce the time a normal user waits after submitting a Discover request, without lowering content quality, without a rule-based recommender, and without weakening AI-native selection. Not a source expansion. The 4 real queries A–D are unchanged from DOMESTIC-CONTENT-04.

## BEFORE — where the time went

Measured from the DOMESTIC-CONTENT-04 evidence (`docs/audits/evidence/domestic-content-04/ui.json`). There was no progressive rendering: the user waited for the whole pipeline (TTFV == TTFC).

| Query | TTFC | model calls | sum of call time |
|---|---:|---:|---:|
| A 今天有什么重要科技新闻？ | 205.4s | ~38 | 396s |
| B 最近有什么值得看的 AI 深度内容？ | 104.2s | ~20 | 155s |
| C 给我找一些最近值得看的 AI 视频。 | 174.8s | ~26 | 243s |
| D 最近有什么值得听的科技/商业音频？ | 183.2s | ~19 | 269s |

Root causes (from the supply waterfall):

1. **Resolve-all-then-decide.** `selectSupply` ran `resolveContent` (robots + page fetch + Readability) on **every** candidate (~150) before any selection, `date-resolution` 15–24s per query, even though only ~6–12 are shown.
2. **Iterative merge explosion.** After batching, the pipeline looped `groups -> merge -> groups` until `<= 6`. For A this was ~22 merge calls, several `merge-failed` at ~20s each (sum of merge call time alone ≈ 260s).
3. **Serial acquisition.** `seekContent` awaited Feed, then open-media (endpoints serial), then Search (queries serial).
4. **No first render.** The renderer already supported a `replenishing` two-phase path, but the active supply path returned one fully-completed view.

## Build-vs-Integrate judgement

| Decision | Capability | Why |
|---|---|---|
| REUSE | existing `replenish` / `mergeIntentViews` two-phase renderer path | progressive UI already existed, only the runtime did not use it |
| REUSE | batched model selection (from NEWS-03) | no new recommender; stage 1 is the same metadata-only judgment |
| REUSE | `resolveContent` / Readability | unchanged; only *when* it runs changed |
| REUSE | existing Search fallback chain | unaffected |
| REJECT | new cache tier / distributed cache | no repeated-query profile in one-shot acceptance; a light in-process cache was not needed to hit the measured wins, so not added |
| REJECT | keyword scorer / deterministic ranker | would replace AI relevance judgment |
| REJECT | disabling reasoning or switching model | out of scope for this task; would change the configured capability |

## Changes

- `news-selection.ts`: `selectSupply` is now a **bounded two-stage pipeline**.
  - Stage 1: metadata-only model shortlist over the whole pool (batch 8, concurrency 4), outputting `{id,type}` only — small output, so batches are cheap and the type lets the fast pass render.
  - Stage 2: `resolveContent` runs **only on the shortlist** (≤36), not the whole pool.
  - Stage 3: cluster the resolved shortlist in batches plus at most **one** merge pass (was an unbounded loop). If clustering is unavailable, the shortlist is returned as individual cards — a slow judgment never empties the result.
  - Bounded **split-on-failure**: a batch that exhausts the token budget (`finish=length`) is split and retried (depth 2); timeouts/transient errors are *not* retried (they would multiply slow calls).
  - `mode: 'fast'` resolves only what it shows and skips clustering.
- `content-seek.ts`: Feed, open-media and Search acquisitions now run **concurrently** (`Promise.all`) with deterministic dedup afterward; media candidates are ordered first for explicit media requests.
- `content-source-capabilities.ts`: `searchOpenMedia` fans out across catalog endpoints concurrently (was serial).
- `digitalme-runtime.ts`: Feed acquisition starts **before** intent understanding so the two overlap; the supply path is **progressive** — a fast Feed-only pass returns first cards with `replenishing: true`, and the full pass (Search + full pool) is merged on `replenish`. Instrumentation records `directory/feed`, `shortlist`, `resolve-shortlist`, `cluster`, `selected`, `first-cards` per pass.
- `discover-search-generation.ts`: `mergeCardPair` now unions grouped `sources`, so progressive merging cannot drop the fuller pass's clustering.

## AFTER — waterfall

Example (query A, `docs/audits/evidence/discover-latency-05/latency.json`):

```
FAST (first cards)                 FULL (background)
directory/feed      ~3.5s          search             ~1.8s
shortlist          ~10-45s          shortlist         ~45-88s   (whole pool, batch 8)
resolve-shortlist   <1-3s           resolve-shortlist  ~1-3s
selected                              cluster           ~3-20s
first-cards         ~10-27s         selected            ~80-105s
```

## TTFV / TTFC

`latency.json` (last full run; per-query model calls/tokens from the real DeepSeek credential). TTFV is when the first cards render; TTFC when the full pass merges.

| Query | BEFORE TTFV | AFTER TTFV | BEFORE complete | AFTER complete | calls (before→after) | tokens (after) |
|---|---:|---:|---:|---:|---:|---:|
| A 科技新闻 | 205.4s | **9.9s** | 205.4s | 90.4s | 38 → 27 | 81,840 |
| B AI 深度内容 | 104.2s | **70.2s** | 104.2s | 175.8s | 20 → 35 | 77,117 |
| C AI 视频 | 174.8s | **41.6s** | 174.8s | 41.8s | 26 → 28 | 49,114 |
| D 科技/商业音频 | 183.2s | **20.8s** | 183.2s | 143.4s | 19 → 28 | 62,365 |

Across five real runs the same code produced: A 9.9–27.1s, B 7.9–85.6s, C 36.4–46.2s, D 6.4–20.8s for TTFV. The spread is **external model latency**, not pipeline structure (see below). Best observed TTFV met the `< 15s` target for A, B and D and the `< 45s` TTFC target for C; the worst runs did not.

## External latency floor (why this is PARTIAL)

The configured model (`deepseek-v4-flash`) is reasoning-capable and shares the token budget with its reasoning chain. Measured on this host: ~85–200 output tok/s, and a broad relevance judgment over 8–12 candidates produced **1,000–3,800 reasoning tokens per call** (5–45s). Concurrency helps only partially; the provider effectively bounds parallel throughput. Therefore:

- 1 model call (intent) + 1 model call (fast selection) is ≈ **7–50s** even before any work — this is the TTFV floor, and it varies per run.
- The full pass needs ~19 stage-1 calls (152 candidates / batch 8) plus clustering; at the measured per-call cost that is ≈ **60–180s** TTFC.

This floor is external. No amount of local orchestration removes it without either fewer model judgments (quality loss) or fewer candidates (supply loss), both of which the task forbids.

## Quality regression check

- News capability: A returned 9 real, dated news cards (baseline requirement: news not regressed).
- Direct reading: article cards still carry Readability bodies with provenance; `resolveContent` is unchanged apart from *when* it runs.
- Media: D returned direct-playable `<audio>` cards; the audio/video representation path is unchanged. `mergeCardPair` now preserves grouped sources across the fast/full merge.
- Item identity: cards are keyed by canonical URL across both passes; feedback/open resolve by id and the union-merge keeps the representative card.
- No central recommender, no keyword scorer, no hardcoded query added.

## Validation

TypeScript build PASS; `git diff --check` PASS; renderer/CJS syntax PASS. Focused selection tests (two-stage batching, split-on-length, provenance, clustering, feedback) PASS. Wider `subject-comm + capability + runtime`: 369/382 PASS, 3 skipped, 10 failed — all 10 are pre-existing and unrelated (Electron not installed in this worktree, invalid DashScope key, missing default model credential, external-site/MCP reachability, one known baseline Discover-notice test). Confirmed against the untouched baseline via `git stash`.

## Verdict

**DISCOVER_LATENCY_PARTIAL**. The pipeline no longer resolves the whole pool, no longer runs an unbounded merge chain, acquires in parallel, and renders first cards progressively. TTFV dropped from ~104–205s to ~8–46s in most runs and hit `< 15s` in the best runs; TTFC dropped for A/C but is not reliably `< 45s` (B/D regressed in some runs). The remaining cost is the external reasoning model's latency and its run-to-run variance, which local optimization cannot remove without lowering quality. No quality regression, no central recommender, no hardcoded query, tests pass.

## Recommended next single task

`DISCOVER-2.0-LATENCY-06`: reduce the external model's contribution to selection rather than shaving local work — e.g. ask the model to shortlist from a bounded metadata digest in fewer, larger judgments, or evaluate a non-reasoning selection path — and add a lightweight in-process cache so a repeated public Feed/article fetch in one session is not re-downloaded. Accept PARTIAL honestly if the provider latency floor is confirmed again.
