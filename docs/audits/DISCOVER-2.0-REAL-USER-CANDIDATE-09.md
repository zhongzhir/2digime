# DISCOVER-2.0-REAL-USER-CANDIDATE-09

Date: 2026-09-26. Verdict: **DISCOVER_2_REAL_USER_TRIAL_CANDIDATE_READY**.

- **source SHA:** `e0d5da656e6d912f45cf5a495f459af7cb3e1b91` (branch `build/discover-2-news-supply-01`)
- **candidate commit SHA:** the commit that adds this document.
- Baseline chain `29a7d404..e0d5da6` is 8 commits; working tree clean; no unrelated dirty/untracked files included.

## Discover 2.0 accepted capabilities

| Task | Verdict | Capability |
|---|---|---|
| NEWS-SUPPLY (LIVE-GATE-02) | ACCEPTED | real Feed supply, search fallback, clustering, date provenance |
| DOMESTIC-CONTENT-04 | ACCEPTED | domestic news/deep-article/video/audio consumption |
| LATENCY-05 / FAST-SELECTION-06 | ACCEPTED | progressive first cards + non-thinking lightweight selection |
| SOURCE-COVERAGE-07 | ACCEPTED | 22 domestic Feeds + 5 domestic video sources |
| PERSONAL-VALUE-08 | ACCEPTED | per-Subject selection from one public pool + feedback loop |

## Regressions

Classification against the Public Alpha baseline `29a7d404` (same 31 files run on both):

- **NEW REGRESSION — fixed**: `networking disabled does not call external search on Discover` (offline notice disappeared). Cause: the new Search fallback made `resolveContentSearch` return a function even when no provider was configured, so the runtime reported search as available. Fix: return `undefined` when Gemini / DashScope / managed are all unconfigured. Re-run of the 31 files: HEAD now **0 new failures** vs baseline.
- **EXISTING (baseline) failures — not caused by Discover**: ~40 tests in `collaboration/`, `execution/`, `work-runtime/`, coding-capability, plus `document-capability-none`, `subject-communicate-bridge`, `chat-scroll-electron`, `user-feedback-loop-02.e2e`, `open-media-syndication-01.e2e`, `real schema.org/oEmbed`. Identical set on the untouched baseline.
- **EXTERNAL SERVICE**: `Electron Discover cold start uses live Gemini + DeepSeek` (Gemini 429), the framatube live Feed (its first item is now audio), external schema.org/oEmbed pages.
- **ENVIRONMENT**: the full `.electron.test.js` suite hangs in this sandbox; the individually run relevant Electron tests behave as baseline.

Wider run: non-Electron suite **1290/1336 PASS, 5 skipped, 41 failed** (all baseline failures). Dependency change since baseline is additive only (`@mozilla/readability`, `jsdom`, `@types/jsdom`).

## Smoke evidence

Real Electron, blank auto-created Subject with an injected **test-only** Digital Self (never the Owner's). Real internet + real model. `evidence/real-user-candidate-09/smoke.json`.

| Step | Result |
|---|---|
| A 今天有什么值得关注的新闻？ | 19 cards · TTFV 8.0s · TTFC 52.9s |
| B 最近有什么值得我看的？ | 17 cards · TTFV 10.7s · TTFC 45.9s |
| C 最近有什么值得看的 AI / 科技视频？ | 6 cards · TTFV 8.9s · TTFC 50.6s |
| D 最近有什么值得听的内容？ | 11 cards · TTFV 12.0s · TTFC 59.9s |
| E 打开正文 → 问兔机米 | body 2,534 chars, Ask carried the content |
| F 播放视频 | 2 native `<video>` (duration 1,262s, played to 2.6s) + 3 official embeds |
| G 播放音频 | 11 native `<audio>` (duration 3,272s, played to 2.3s) |
| H 少推类似 → 再 Discover → 撤销 | reduced card removed; reverse restored it |
| I 当前意图覆盖长期偏好 | "不要科技内容" → 15 cards, 0 tech titles |

- **No fixture, no stub, no Owner Digital Self.**
- **No technical jargon** leaked to the visible text on any query (`RSS/HLS/DASH/JSON-LD/resolver/NetworkItem/Relay/provider/embed/...` all absent).
- **No obvious wrong copy, no empty-but-broken-looking page, no unresponsive click, no reader/player failure, no Ask context loss.**

## Latency baseline (no regression)

Smoke TTFV: A 8.0s, B 10.7s, C 8.9s, D 12.0s — all `< 15s`. Across runs the video query occasionally reaches ~20–30s (first-pass shortlist empty, waits for the full pass); this is the known media-TTFV variance and is not a blocker. TTFC 46–60s. These match the SOURCE-COVERAGE-07 accepted evidence.

## Known limitations (backlog, not blockers)

Fuzzy-request profile leakage; occasional slow video/audio first card; single Search provider failures absorbed by managed Search + Feed; no in-process TTL cache; some video is official-embed/external-only.

## Smoke evidence

`evidence/real-user-candidate-09/`: `smoke.json` (A–I), `packaged-smoke.json`, `candidate.json`; local `build/evidence/real-user-candidate-09/` holds `tests-nonelectron2.txt`, `tests-electron-subset.txt`, `baseline-failing.txt`, `head-failing2.txt`, screenshots.

Packaged smoke (real built exe, isolated blank profile): window started, blank Subject created, trial note present, **no** `secrets.v2.json` / `model-config.json` created.

## Trial Candidate artifact

- Source SHA `e0d5da6`; buildId `v2-tujimi-20260926T135041Z-e0d5da65`; brand `tujimi`; unsigned.
- **Installer:** `兔机米-0.2.0-discover2-trial-win-x64-setup.exe` — 85,161,264 bytes — SHA256 `650c63e05e0e062356090125f14d28903a948b225de25a432c26ba164c18024d`
- **Zip:** `兔机米-0.2.0-discover2-trial-win-x64.zip` — 117,659,058 bytes — SHA256 `7d32a86d47b34d0deb260605b8127dbab10aa203ee527859138997468da06139`
- Not packaged in git (`release-staging/` is gitignored); the existing `兔机米-0.2.0-public-alpha-win-x64` in `.codex-delivery/` was not overwritten.

## Trial instructions

See [`docs/trials/DISCOVER-2.0-REAL-USER-TRIAL-09.md`](../trials/DISCOVER-2.0-REAL-USER-TRIAL-09.md): 3–5 real people, 2–3 days each, no coaching, existing logs + short human notes.

## Verdict

**DISCOVER_2_REAL_USER_TRIAL_CANDIDATE_READY.** One new regression was found and fixed; remaining failures are baseline or external. All smoke steps pass with all TTFV `< 15s` in the final run. Development on Discover 2.0 stops here pending real-user trial evidence.

## Next single task

Owner hands the Trial Candidate to 3–5 real users for 2–3 days; then produce the real-user value verdict
(`DISCOVER_REAL_USER_VALUE_PROVEN | MIXED | NOT_PROVEN`) from their behaviour. No Discover development before that.
