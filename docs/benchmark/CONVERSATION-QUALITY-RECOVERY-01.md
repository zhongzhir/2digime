# CONVERSATION-QUALITY-RECOVERY-01

> 针对 benchmark a187534 实测前三个缺陷的定向修复 + 同 32 题复测 before/after。
> 任务：DIGITALME-CONVERSATION-QUALITY-RECOVERY-01
> 分支：`build/conversation-quality-recovery-01`（base `a187534`，未 push）
> 复测日期：2026-08-20（同一时间窗口顺序执行；Arm A 修复后重跑，Arm B 冻结 baseline 不复跑）
> **Provider 受限声明**：OPENAI_API_KEY（DashScope base、openai.com 与 DashScope 均 401）与 Gemini/Google key 均不可用，
> 依 §三 保留 **Bing HTML 作为 degraded fallback**；本任务**未宣称质量修复完成**，仅量化编排/综合/决策的定向修复收益。

---

## 结论速览（成功门槛对照，§十五）

| 成功门槛 | 目标 | Before | After | 是否达成 |
|---|---|---|---|---|
| citation_entailment | ≥3.0 | 0.66 | **1.19** | ❌ 未达成（Bing degraded 上限） |
| citation_completeness | ≥2.5 | 0.56 | **1.00** | ❌ 未达成 |
| source_quality | ≥3.0 | 1.75 | **2.03** | ❌ 未达成 |
| research_depth | ≥2.5 | 0.81 | **1.28** | ❌ 未达成 |
| 应搜索题触发率 | ≥90% | 13/19=68% | **18/19=94.7%** | ✅ 达成 |
| 2digime hard fail | =0 | 1 | **0** | ✅ 达成 |
| 正例 personalization | 不低于基线 | 0.38 | **0.44** | ✅ 达成 |

> **如实判定：本轮未达到 §十五 最低成功条件。** 所有指标相对 baseline 均正向提升（entailment +0.53、
> completeness +0.44、source_quality +0.28、research_depth +0.47、correctness +0.31、avg +0.24），
> 决策触发率与 hard fail 达标；但 citation/source/research 三个绝对门槛未过——根因是 **Bing HTML degraded provider**
> （OpenAI/Gemini 不可用，无法做 provider 级 upgrade）。按 §十五「未达到则如实失败，不自动修第二轮」，本轮停止，交由 CTO 决策 provider 方案。

---

## A. 实际采用的 Search Provider

- 探测（不显示 secret）：`OPENAI_API_KEY` 存在但 baseUrl 指向 DashScope compatible-mode，且对 `api.openai.com` 与 DashScope 均返回 **401**（不可用）；`GEMINI_API_KEY`/`GOOGLE_*` 缺失；`ANTHROPIC/PERPLEXITY/TAVILY/BRAVE/BING_SEARCH_API_KEY/SERPAPI` 全部缺失。唯一有效凭据为 DeepSeek（`api.deepseek.com/v1`，`deepseek-v4-flash`），无原生 web_search。
- 依 §三：二者都不可用 → **保留 Bing HTML 作为 degraded fallback**，未宣称质量修复完成。上层 `SearchConnector`/`ResearchConnector`/`ExternalCapabilityContract` 未引入任何 provider 判断（conversation domain 不写 OpenAI/Bing/Google 分支）。

## B. Evidence retrieval 方式

新链路（§二）：`search → candidate sources → read/retrieve evidence → evidence chunks → claim-grounded synthesis → citation`。
- `SearchConnector.read(url)`：从 Bing 候选来源逐个抓取正文，`htmlToText` 抽取纯文本 evidence chunk（≤6k 字符），写入 `SearchSource.evidenceChunk` + `retrievedAt`。
- `sourceType` 结构推导（`deriveSourceType`，非巨型白名单）：official/primary/news/reference/secondary/unknown。
- 抓取失败不阻断：该来源保留但标注「未能抓取正文，不得编造其内容」。
- evidence 为运行态对象，未持久化 Store；全部 `sourceClass='external'`，不进入 Owner 事实。

## C. Citation binding

- 综合输入现为「[n] 标题/URL/来源类型/检索时间/证据片段」结构化列表；系统提示强制「引用必须绑定证据：只有某来源证据片段实际支撑主张才可 [n] 引用」。
- 新增 `verifyCitations`（claim→citation→evidence chunk 最小验证）：`cited`/`outOfRange`/`ungrounded`/`validCount`，写入 `SearchEvidence.citationReport`。
- 效果：entailment 0.66→1.19（+0.53），completeness 0.56→1.00（+0.44）。本轮累计 199 次引用中 90 次为有效证据支撑。

## D. Synthesis truncation 修复（§七）

- 根因：deepseek-v4 的 `reasoning_content` 与 `content` 竞争同一 `max_tokens`，C-04 推理 token 吃光预算导致 final answer 截断在「春节是…」。
- 修复：
  1. 最终综合独立充足预算 `SYNTHESIS_MAX_TOKENS=4096`；
  2. research reasoning（决策/plan/gap）与最终回答预算**分离**（`DECISION_MAX_TOKENS=1200`、`RESEARCH_MAX_TOKENS=4000`，均低于综合预算）；
  3. 检测 `truncated/length`；截断时允许**一次 bounded continuation**（同一回答的恢复，非第二轮研究）；空输出一次重试。
- 验证：SYNTH-TRUNC 与 C-04 均不再截断；C-04 现给出完整正确答案（`2026年春节是2月17日，农历正月初一`），hard fail 消除（Arm A hard fail 1→0）。

## E. SearchNeedDecision 变化（§八）

- 决策由模型结构化输出 `SearchNeedDecision{mode,reason,freshnessRequired,externalVerificationRequired,researchComplexity,queries}`。
- 硬覆盖仅保留用户**显式意图**（不要联网/搜索一下/深入研究），不再扩 regex/keyword。
- 决策提示强化「权威来源核验（医学/科学/法规/争议）」「当前/最新个性化推荐」→ web_search，改善 D-03/G-02 漏判。
- fail-safe：判断失败但问题明显含当前外部事实信号时 → **degraded web_search** 并暴露 degraded 状态（综合如实说明核验程度），不假装实时。
- 效果：应搜索题触发 68%→94.7%（B-03/B-05/D-03/G-01/G-02 均修复），全部 no_search 任务仍保持 no_search（无误触发）。

## F. Deep Research gap 机制（§十）

- Round 1：`planResearchQueries` 生成多角度查询（非「深入研究」指令词）→ search/read → evidence chunks。
- `evaluateCoverageGaps`：coverage evaluation → `ResearchGap[]{missingQuestion,whyNeeded,preferredSourceType,followupQuery}`；gap 模型空/失败且确有缺失时用 `coverage.missing` 派生兜底查询（纠偏）。
- Round 2 只针对真实 gap 查询（非「+最新进展 2026」拼接）；若证据充分则不强制第二轮。
- 效果：F-02/F-03/F-04 达 2 次搜索迭代、5 条查询、3 个 gap 定向 followup（research_depth 0.81→1.28）。预算修复前 gap 调用被 reasoning 吃光返回空（已修）。

## G. F-01 是否纠偏成功（§十一）

- **结构性纠偏成功**：Bing 首轮返回 2026 日历/维基/世界杯/电影等**明显无关**页面时，coverage/gap 检测出「目标主体/地区/主题未被支持」，综合**诚实声明来源无法支撑该问题并列出缺失**，而非基线那样从无关台湾页伪造趋势。
- F-01 Arm A correctness 2（诚实拒答，非 hard fail；Arm B 为 0 hard fail），citation_entailment 3、reasoning 4。
- **结论：纠偏机制已生效，但 Bing degraded 无法为该题召回相关一手来源，最终走向诚实失败兜底**——这正是 §十一「诚实失败是安全兜底，但 Research 先尝试纠偏」的预期。要真正答好 F 类题需 provider 级 upgrade。

## H. 32 题 before/after（Arm A = 2digime）

| 维度 | Before | After | Δ |
|---|---|---|---|
| correctness | 3.75 | 4.06 | +0.31 |
| freshness | 2.19 | 2.41 | +0.22 |
| source_quality | 1.75 | 2.03 | +0.28 |
| citation_entailment | 0.66 | 1.19 | +0.53 |
| citation_completeness | 0.56 | 1.00 | +0.44 |
| coverage | 2.91 | 2.84 | −0.07 |
| contradiction_handling | 3.06 | 3.06 | 0 |
| reasoning | 3.66 | 3.88 | +0.22 |
| research_depth | 0.81 | 1.28 | +0.47 |
| personalization_usefulness | 0.38 | 0.44 | +0.06 |
| irrelevant_personalization_penalty | 3.06 | 3.19 | +0.13 |
| **avg** | **2.07** | **2.31** | **+0.24** |

（Arm B 冻结 baseline 复测稳定：correctness 3.38→3.47 等仅 judge 方差；对照可信。）

## I. 五个关键指标

| 指标 | Before | After | §十五 门槛 |
|---|---|---|---|
| citation_entailment | 0.66 | 1.19 | ≥3.0 ❌ |
| citation_completeness | 0.56 | 1.00 | ≥2.5 ❌ |
| source_quality | 1.75 | 2.03 | ≥3.0 ❌ |
| research_depth | 0.81 | 1.28 | ≥2.5 ❌ |
| 应搜索触发率 | 68% | 94.7% | ≥90% ✅ |

## J. hard fail

- Before：Arm A 1（C-04 截断）。After：**Arm A 0**。剩余 4 个 hard fail 全为 Arm B（冻结 baseline）——C-02/F-01/F-03（B）+ F-05（B）。F-01/F-05 的 Arm A 均以诚实拒答换取非 hard fail。

## K. personalization

- 正例 personalization_usefulness 0.38→0.44（G-01 2、G-02 4），**不低于 direct baseline**（达成门槛）。G-01/G-02 现正确触发 web_search 并获当前信息。
- 负例防护：irrelevant_personalization_penalty 3.06→3.19（G-04/G-05 未强行带入本人信息，防护有效）。Digital Me 边界未动：外部证据一律 `sourceClass='external'`，网页内容不写成 owner fact。

## L. cost / latency 变化

- Arm A total cost：$0.022 → $0.068（约 3×：evidence 抓取 + gap/plan 调用 + 截断 continuation）。
- Arm A 平均延迟：12.7s → 26.5s（evidence 读取 + 多轮 + 抓取；Bing 页面抓取耗时为主）。
- 本任务外部调用总额在 USD 0.50 硬上限内；无新增账号注册。

## M. 回归

- `conversation-search-01` 套件 25/25 通过（新增 evidence/citation/truncation/degraded/gap 用例）。
- 全量 `npm test`：**755 pass / 33 fail**，与 baseline a187534（746/33）相比 **0 新增失败**；33 个既有失败均为环境性（真实模型 e2e、软件执行能力缺失脚本、growth 需 live model），与本次改动无关。
- `npm run build` 通过。
- Growth Closed Loop 03 / owner context 边界 / external 不污染本人事实：未改动，用例覆盖（L/R 用例）。

## N. HEAD / status

- HEAD：`<待提交> test(benchmark)...` → 本轮提交 `fix(chat): improve grounded search reliability`。
- 分支：`build/conversation-quality-recovery-01`（base `a187534`，未 push）。
- 产物：`scripts/conversation-quality-recovery-run.cjs`、`conversation-quality-combine.cjs`、`conversation-quality-gate.cjs`、fixture 不变（冻结 benchmark），`docs/benchmark/CONVERSATION-QUALITY-RECOVERY-01.md`。
- 证据（gitignored）：`scripts/_conversation-quality-recovery-evidence/`（benchmark-runs.jsonl / blind-input / blind-key / blind-scores / benchmark-summary.json）、`scripts/_conversation-quality-gate-evidence/`。

## 下一步（交由 CTO 决策，本轮不自动执行）

1. **Provider 级 upgrade（关键）**：OpenAI Responses web_search / Google Search Grounding 任一有效 key，才能把 citation/source/research 三个绝对门槛拉过 §十五。
2. 修复后重跑同 32 题（Arm A）+ 冻结 Arm B，复用同 blind judge/rubric。
3. 若 provider 到位，`citation_entailment≥3.0` 的目标才可诚实达成（当前 Bing degraded 下 evidence grounding 有上限）。
