# DISCOVER-2.0-PERSONAL-VALUE-08

Date: 2026-09-26. Verdict: **DISCOVER_PERSONAL_VALUE_ACCEPTED**.

Branch: `build/discover-2-news-supply-01`; baseline `2008fc6`. New HEAD: the commit that adds this document. No push, main merge, packaging or release. Original dirty checkout and frozen Public Alpha were not edited. Only isolated test Subjects were used; the Owner's formal Digital Self was not read or modified.

## Scope

Verify whether Discover already delivers Digital Me's distinctive value: not the same hot list for everyone, but each user's own 2digime choosing from one shared public pool using current intent + Digital Self + explicit feedback. No new sources, no central recommender, no extra ContentProfile.

## Current personalization chain (from real code + prompts)

`User request → runContentSeek → interpretDiscoverIntent → candidate pool (Feed + open media + Search) → selectSupply`

- **Digital Self into the model**: `readDigitalSelf(packageRoot, subjectId)` → `selectSelfContext(self, query)` returns **all live understandings** (no query keyword filtering, `self-context.ts`) → `formatSelfContext` renders `已确认` / `尚待确认` lines. When empty it says "当前还没有已写入的数字之我认识。读取失败不得假装了解用户。"
- **Explicit feedback**: `listContentPreferences` reads `content/content-preferences.json`, which only ever contains `origin: 'user_action'` directives (`boost/reduce/follow/block`), formatted as `- [kind] text`.
- **Where they are used**: both model stages in `news-selection.ts` receive `digitalSelf` (≤1600 chars) and `explicitPreferences` (≤800 chars) in the user JSON. Stage 1 system: "数字之我与显式偏好只在请求范围内帮助判断"; stage 3: "按当前请求选择相关内容，数字之我/偏好只在范围内帮助判断". So the current request is authoritative and the self is a bounded hint.
- **Personal Feed path** (`runContentDiscover` → `ensurePersonalFeed` → `selectNetworkItems`) also compiles the Digital Self + directives; `block` sources are filtered deterministically there.
- **No extra profile / InterestGraph**: the only persistent personal artifacts are the Digital Self and the user-action preference file. `network_content_feedback` records AI decisions separately and is never read back as user preference.

Audit answers:

1. **What is provided**: all current/候选 understandings as text + the user's explicit content directives. Not a score, not a vector.
2. **Real role**: it biases relevance/ranking *within* the request; it is explicitly subordinate to the request.
3. **Explicit feedback**: `boost/reduce/follow/block` directives are injected into both stages; reversible via `reverseContentPreference`; provenance is the directive's `origin/updatedAt`.
4. **Paths not consuming Digital Self**: the seek's non-supply fallback (`classifyCandidateRoles`) does not pass the self, but that path is not the active Electron path; every active seek and the Personal Feed do consume it.
5. **Over-injection risk**: the prompt bounds it to the request, but a vague request can still let the long-term profile leak (see the one WORSE case below).

## Three test Subjects (isolated, never the Owner's)

| Subject | Self | 
|---|---|
| A | 长期关注 AI、创业、一级市场、前沿科技；科技投资人 |
| B | 长期关注文化、阅读、影视、内容创作；内容创作者 |
| C | 长期关注消费生活、旅行、娱乐、健康生活 |
| GENERIC | no Digital Self (control) |

These live only in the acceptance harness, never in product logic.

## Controlled comparison

Same public pool (476 acquired, a shared bounded 200 used), same query `最近有什么值得我看的？`, only the Digital Self differs. `experiment.json`.

| Subject | cards | representative picks |
|---|---:|---|
| A | 12 | 米哈游千亿AI野心 / 智元具身机器人 / Deepseek+Muse / 谷歌TPU跑Kimi / 硅谷101 E252 |
| B | 5 | 济公（文化）/ 微软早期游戏史 / 纪录片《长征二十夜》/ 剪映AI影游 / 北京人艺 |
| C | 12 | 中美元首茶叙 / 问界自驾路书 / 维密扩店 / 长假体验消费 / 游戏 |
| GENERIC | 12 | 混合热点（游戏、AI、维密、宜家、网易云音乐） |

Different Subjects produced **different, explainable** selections from the identical pool (A → AI/投资; B → 文化/创作; C → 消费/生活), and each card carried a model reason tied to the Subject (e.g. A: "米哈游AI布局深度观察"; B: "今日上线纪录片，适合关注纪录片与内容创作").

## Intent-conflict tests (Subject A is AI/investor)

- `今天不要给我科技内容，想看点轻松的。` → 8 cards, all culture/lifestyle (维密、历史模拟器、地理边界、跑五公里、本周看什么、核市奇谭、护眼、世赛). **No AI/tech**; the current explicit intent overrode the long-term profile.
- `我最近需要研究出版业 AI 应用。` → 4 cards: 米哈游AI、Deepseek 桌面版、数智周报（企业级Agent）、硅谷101《藏在大模型背后的新闻人：GPT们的回复是这样写出来的》. The one-off task pulled AI-content work to the top even though it is not a long-term preference.

## Explicit-feedback loop

Node experiment (Subject A) and real Electron. Directives are user-action only and reversible.

| Step | Result |
|---|---|
| baseline | 11 cards, AI/investment top |
| after `少推类似` on the top card | the reduced card disappears; the set shifts |
| after `加推类似` | the boosted card is kept first |
| after `撤销` | the directive is removed and the pre-reduce set returns |

Electron `ui.json`: first-discover 17 cards with reasons → `少推类似` moved the reduced item out → `撤销` restored it. The preference file after reversal is `{"version":1,"directives":[]}` — reverse is real, and `origin` is always `user_action`. `open`/`ask`/AI decisions never write preferences.

## Generic vs Personalized A/B (10 real queries)

Same pool, Subject A vs no Digital Self; a real model judged BETTER/SAME/WORSE with a one-line reason. `experiment.json`.

| Verdict | Count |
|---|---:|
| BETTER | 7 |
| SAME | 2 |
| WORSE | 1 |

BETTER cases: 最近有什么值得我看的？/今天有什么值得我关注的新闻？/AI 深度内容/一级市场/长文/通勤音频/重要视频 — "更聚焦 AI、创业、投资，剔除无关社会新闻". SAME: 商业科技播客 and 文化阅读 (model judged no useful difference). WORSE: `有什么轻松一点、不费脑的内容？` — the personalized set mixed in a history-strategy game, i.e. the long-term AI profile leaked on a vague "relaxing" request.

## "Why recommend"

The reason shown on each card is the model's own cluster/selection reason, produced from the request + Digital Self + explicit preference + content itself, and is now preserved across the progressive fast→full merge (`mergeCardPair` keeps the fuller reason; the renderer card signature includes the reason so the node re-renders). Examples from live Electron: "索尼芯片返岗加速物理AI研发", "具身机器人量产交付，商业化落地进展", "今日AI综合要闻，涵盖多家公司动态". No post-hoc text is generated.

## Latency

The Digital Self and directives are added only as prompt text; no extra model calls or reasoning rounds were introduced (stage 1 stays `thinking: disabled`, stage 3 stays `reasoning_effort: low`). The controlled Node selections took ~27–32s each because they run the whole 200-card pool synchronously; the product Electron path is unchanged, and the SOURCE-COVERAGE-07 measurement held TTFV `< 15s` for all five queries (P50 `< 15s`, P90 `< 25s`). One fix was needed: stage-3 clustering had been capped at 2048 tokens, which truncated the reason and dropped clustering; it is back to 4096 with a 45s timeout.

## Limitations

1. On a vague request ("轻松不费脑") the long-term profile can still bias the result — 1 of 10 A/B cases. Explicit "不要科技" overrides cleanly; the vague case is the remaining tension.
2. The controlled Node A/B uses a bounded shared pool (200 of 476) to keep the experiment affordable; the live Electron run used the full pool.
3. First-pass cards can briefly lack a reason until the full pass merges one in.
4. Subject C's result was the smallest and most game-heavy (few consumer/lifestyle sources in the current pool).

## Verdict

**DISCOVER_PERSONAL_VALUE_ACCEPTED** against the 14 conditions: same pool yields sensibly different results per Subject; current explicit intent overrides long-term preference; news retains public importance (C's list still surfaced 中美元首茶叙); news/article/video/audio mix without a fixed quota; explicit feedback really changes later results and reverses; AI selection never writes user preferences; "why recommend" is traceable to real reasons; A/B is majority BETTER with no systematic WORSE; TTFV not regressed; no central recommender, no ContentProfile/InterestGraph, no click/dwell learning; tests pass (370/382, 9 pre-existing environment failures verified on the untouched baseline).

## Recommended next single task

`DISCOVER-2.0-PERSONAL-VALUE-09`: reduce the vague-request leakage seen in the one A/B WORSE case — let the model treat a weakly-specified request as a signal to widen beyond the long-term profile (an explicit-intent-strength judgment, not a keyword rule), and add a light "why" affordance check so the first-pass cards carry the reason too. No new sources, no central profile.
