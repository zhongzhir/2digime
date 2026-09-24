# DISCOVER-2.0-NEWS-SUPPLY-LIVE-GATE-02

Date: 2026-09-24. Verdict: **DISCOVER_NEWS_SUPPLY_PARTIAL**.

Branch: `build/discover-2-news-supply-01`; input HEAD `c3c5520d15de34a4c5516597b0fb2e8b9dce34fa`. Continues NEWS-SUPPLY-01 on its isolated worktree. No push, main merge, packaging or release. Original dirty checkout and frozen Alpha were not edited.

## Authorization and isolation

Owner explicitly authorized real DeepSeek requests using the existing credential reader, public queries/content only, in a blank test Subject/Package. The former credential import would persist another key copy, so it is not used. The acceptance entry uses existing `readRuntimeModelCredential` and `createEnvSecretAccessor`, allows only `https://api.deepseek.com`, and returns a read-only in-memory accessor. No API key is written, exported or printed. This is an acceptance-only credential adapter, not a product credential-path acceptance claim.

Each Electron run creates a new `news-supply-ui-*` temporary userData. The unchanged formal `electron/main.cjs` automatically creates its default empty Subject. No Owner self, conversations, private materials or official application directory is opened. Stub flags are off. Model/runtime/IPC/renderer business logic is not mocked. Existing Electron executable is reused read-only. Safety evidence checks that no model-config or secrets file was created in the final test directory. Final harness also clears inherited trace/smoke flags and asserts model destination on every call; these final guard-only edits received syntax checks, not another paid live run.

## Capability sufficiency and minimal change

Existing public Feed supply, Search connector, model HTTP, command bus and Electron renderer are sufficient to exercise this chain. No new search service/engine, model-specific router, fixture news or central profile was added.

Live diagnostics found successful HTTP model responses with `finish_reason=length` and empty final content. The original 500-token intent / 3,000-token selection budgets can be consumed before a reasoning-capable model produces final JSON. Budgets are now bounded at 4,096 / 8,192 respectively. No automatic repeated retry or reasoning-content promotion was added. This corrected the real daily-news query; the broad event-clustering query still exhausted 8,192 tokens and is explicitly not accepted.

One older regression assertion treated `NewsArticle` with an embedded audio clip as `article`; updated it to the now-required `news` type. The adjacent ordinary Article + video case still asserts article, and standalone media assertions remain intact.

## Real results

Evidence: `evidence/news-supply-live-gate-02/ui.json`, `search.json`, `model-metadata.json`, `isolation.json`, `tests.txt`. Earlier failed UI runs are retained as `ui-first.json` and `ui-budget-failure.json`. Local screenshots are in ignored `build/evidence/news-supply-live-gate-02/ui-1.png` through `ui-4.png`; screenshot hashes are committed. Public article bodies and full model diagnostics remain local, not committed.

The harness navigates the real renderer and calls the exact handler bound to the search form, through preload IPC and the real runtime, then clicks the real “直接阅读” control. It does not inject responses. It is not a physical keyboard-submit/Owner acceptance claim.

| Gate | Observed | Result |
|---|---|---|
| Real supplemental Search | Existing Gemini connector, one bounded diagnostic with retries disabled, returned `quota / HTTP 429`; formal UI honestly reports Search unavailable while showing Feed results | BLOCKED |
| Daily AI news | Final Electron run returned 8 cards in 38.1 seconds; news cards dated local 2026-09-24, separate article labels, real source attribution and expanded text visible | PASS for this sample |
| Same-event multiple publishers | Broad real query produced no cards; model stopped at length with no final JSON even after the bounded budget increase | FAIL / not proven |
| Ordinary article reading | Real SSPAI article, 6,401-character Readability body, reader expanded in formal Electron, 11.7 seconds | PASS for direct text consumption |
| Freshness | News dates visible; ordinary article Feed date says Sep 24 but extracted body contains Sep 10. Feed publication/promotion versus original article publication is not reconciled | PARTIAL |
| Audio | Real Gcores audio card and source-listening action, 10.2 seconds; no fake player | PASS for discovery/fallback only; no playback acceptance |
| Full UI journey | Real window/blank auto-created package/search handler/reader completed. Open-original, Ask transfer, explicit feedback and physical form submission were not all exercised in this run | PARTIAL |

The collected `empty` field is the DOM text even when hidden, not proof of a visible error on successful cases; screenshots and visible cards are the actual UI evidence. UI first/budget-failure evidence must not be replaced with later successes when evaluating reliability. News body lengths may reflect publisher Feed content; no claim that every publisher feed includes its complete original article.

## Validation and remaining work

TypeScript build PASS. Targeted tests **32/32 PASS, zero skipped**, covering supply, freshness primitives, content selection, ingest, preference isolation, object fidelity and asynchronous result stability. CJS syntax and `git diff --check` PASS. Initial wider regression exposed the obsolete NewsArticle assertion described above; the final run includes its correction. No full repository suite or release test claim.

To reach ACCEPTED: restore the existing mature Search service within authorized account/quota arrangements; obtain a real multi-publisher event group without forcing unrelated items together; resolve Feed/original publication-date disagreement; complete remaining formal UI actions. Do not keep increasing model budgets blindly, build a replacement search engine, introduce hardcoded stories or count fixture clustering as live evidence. No new account/payment or official Digital Self modification was attempted.
