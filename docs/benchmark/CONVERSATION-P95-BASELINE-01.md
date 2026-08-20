# CONVERSATION-P95-BASELINE-01

> 2digime 对话搜索/研究能力 vs 市场头部产品：第一轮真实基线测量。
> 任务：DIGITALME-CONVERSATION-P95-BENCHMARK-01
> 分支：`build/conversation-p95-benchmark-01`（base `9188696`，未 push）
> 测量日期：2026-08-20（同一时间窗口内顺序执行）
> **本任务只测量，不改功能。** 全部 arm 使用冻结的 9188696 真实实现。

---

## 结论速览

1. **2digime 当前大致处于什么水平** — 在「无真实市场头部对照可运行」的受限条件下，以同模型裸 API 为基线（Arm B），2digime 整体 AI 判分 2.07/5 vs 1.72/5，具备可测得的搜索/研究增益，但绝对水平距头部产品（ChatGPT/Claude/Gemini/Perplexity 的 Search/Research）仍有明显差距，且存在重大可靠性短板。
2. **强项** — 事实正确性（3.75）、推理/综合（3.66）、矛盾处理（3.06）、诚实失败（不假装实时）、Deep Research 最小多轮闭环真实运行、引用 URL 可达率 98%。
3. **最大 3 个差距** — (1) 引用支持度/来源质量（citation_entailment 0.66、source_quality 1.75）；(2) 自动搜索决策不稳定（19 个应搜任务只触发 13 个）；(3) 综合生成偶发截断/空输出导致 hard fail（C-04 整题失分）。
4. **Search Provider 问题** — Bing HTML 是明显瓶颈（见 §9）。
5. **Orchestration 问题** — 决策触发不足、Deep Research 二次查询退化（仅拼「最新进展 2026」）、稳定知识题反而因搜索编排降低回答质量（C-03/C-04 输给裸 API）。
6. **Synthesis/Model 问题** — 推理 token 挤占正文导致截断；偶发空输出；引用标签与来源不对齐。
7. **个性化是否产生真实增益** — 正例无显著增益（0.38 vs 0.59 甚至落后），但负例防护有效（3.06 vs 2.91，G-05 得 5）。个性化增益被弱搜索拖累。
8. **下一步最值得修** — 换搜索 provider（官方 search API / 模型原生 web search / 专业 research Agent）；修合成截断；修决策触发与 Deep Research 查询质量。

---

## 1. 对照 arm 可用性

| Arm | 类型 | 状态 | 说明 |
|---|---|---|---|
| Arm A：2digime（DeepSeek + Bing HTML） | 产品 | ✅ 可运行 | 真实 2digime 管线：决策 → Bing HTML 搜索 → 综合（引用/来源/owner context） |
| Arm B：DeepSeek-v4-flash 裸 API（无搜索） | API capability | ✅ 可运行 | 同模型、无搜索、无编排；作为基线衡量搜索+编排增益 |
| ChatGPT Search / Deep Research | 产品 | ❌ unavailable | 无账号/API key/CLI |
| Claude Search / Research | 产品 | ❌ unavailable | 无 CLI/API key |
| Gemini / Deep Research | 产品 | ❌ unavailable | 无 API key/已保存登录 |
| Perplexity / Research | 产品 | ❌ unavailable | 无账号/API key |

> 探测依据：本机仅 `chat.qwen.ai` 有已保存登录，但 Chrome/Edge 运行中锁定 profile；DashScope key 401；无 Anthropic/OpenAI/Gemini/Perplexity 凭据；无相关 CLI。**未伪造对照，未用普通模型 API 冒充竞品完整产品。** 因此 P95 判定只能相对裸 API 基线，无法相对市场头部。

## 2. 任务集

- 共 **32 题**，7 类：A 知识/推理 5、B 最新事实 7、C 官方事实/价格/规则 4、D 来源冲突 3、E 综合比较 3、F Deep Research 5、G 个性化 5（含 2 负例）。
- 覆盖：今日/最近事件（B-01~B-07）、发布日期≠事件日期（B-02 世界杯赛果）、官方源与媒体源（C 类）、来源冲突（D 类）、找不到可靠答案（F-01 诚实说明）、需要二次/三次搜索（F 类全部触发多轮）、Owner context 相关（G-01~G-03）与无关负例（G-04/G-05）、中文为主含少量英文（B-07）。
- 样本答案未写入任何 arm 的 prompt。

## 3. 评分维度

每题 11 维 AI Judge（0-5 整数，独立模型 deepseek-v4-pro）+ 2 维确定性指标（latency/cost）+ 来源 URL 可达性。硬事实错误记 correctness=0 并 hard fail。固定 rubric 见 `scripts/_conversation-p95-benchmark-01-evidence/benchmark-plan 快照` 与 `conversation-p95-judge.cjs`。

## 4. 总体结果

| 指标 | Arm A（2digime） | Arm B（裸 API） |
|---|---|---|
| 平均分（11 维 AI Judge） | **2.07** | 1.72 |
| 完成题数 | 32/32 | 32/32 |
| 错误数 | 0 | 0 |
| 总成本 | $0.022 | $0.011 |
| 平均延迟/题 | 12.7s | 8.1s |
| 硬失败（correctness=0） | **1** | **4** |

## 5. 分维度排名（0-5）

| 维度 | Arm A | Arm B | 差距 |
|---|---|---|---|
| correctness 事实正确性 | **3.75** | 3.38 | A 优 |
| reasoning 推理/综合 | **3.66** | 3.09 | A 优 |
| contradiction_handling 矛盾处理 | **3.06** | 2.97 | A 优 |
| irrelevant_personalization_penalty 无关个性化惩罚 | **3.06** | 2.91 | A 优 |
| coverage 覆盖度 | 2.91 | **3.19** | B 优 |
| freshness 时效性 | **2.19** | 1.84 | A 优 |
| source_quality 来源质量 | **1.75** | 0.94 | A 优（绝对仍低） |
| research_depth 研究深度 | **0.81** | 0 | A 独有 |
| citation_entailment 引用支持度 | **0.66** | 0 | A 优（绝对很低） |
| citation_completeness 引用完整性 | **0.56** | 0 | A 优（绝对很低） |
| personalization_usefulness 个性化有用性 | 0.38 | **0.59** | B 优（异常） |
| latency 平均 ms | 12,716 | 8,077 | B 优 |
| cost 平均 USD | $0.0007 | $0.0003 | B 优 |

> 注：B 类（裸 API 无来源）citation_* 各维按 rubric 记 0；A 类（纯常识无搜索）source/freshness 记 3、citation 记 0。

## 6. Hard Fail 明细

| 任务 | Arm | 原因 |
|---|---|---|
| C-04 2026 春节日期 | Arm A | 综合回答在「春节是」处截断（推理 token 挤占正文，仅 126 字，未给出日期）→ 整题 correctness=0 |
| B-04 iPhone 最新款价格 | Arm B | 凭旧知识答错 |
| C-02 DeepSeek API 定价 | Arm B | 编造定价数字（幻觉） |
| F-01 AI Agent 融资趋势 | Arm B | 无答案（明确无法获知） |
| F-03 固态电池 | Arm B | 凭旧知识答错 |

Arm A 仅 1 个 hard fail（C-04），且是合成截断导致的可靠性问题，非事实能力问题。

## 7. 快搜（web_search）表现

- 触发率不足：19 个应搜任务只触发 13 个（68%）。漏触发：B-03 当日汇率、B-05 人口普查、D-03 8 杯水、G-01/G-02（个性化搜索正例竟被判定 no_search，直接导致个性化增益落后）。
- 命中质量：B-02 世界杯冠军搜索返回的是日历/赛程页而非赛果新闻（来源召回差）；C-02/C-03 返回标题但无正文数字；C-04 返回通用日历页而非含春节日期的权威页。
- 优势：能给出真实来源列表，引用 URL 可达率 98%（抽样 5 个/题）。
- 对比裸 API：B 类（最新事实）A=3.0 vs B=2.57（A 胜）；但 C 类（官方稳定事实）A=2.25 vs B=3.25（**A 输**）。

## 8. Deep Research 表现

| 任务 | 轮次 | 查询数 | 来源数 |
|---|---|---|---|
| F-01 AI Agent 融资 | 2 | 2 | 9（但无关：台湾旅游/政治页） |
| F-02 生成式AI医疗 | 2 | 1 | 3 |
| F-03 固态电池 | 2 | 2 | 2 |
| F-04 半导体供应链 | 2 | 2 | 9 |
| F-05 数字主体伦理 | 2 | 2 | 9 |

- 最小闭环真实运行（≥2 轮、gap 查询）。但二次查询质量差：几乎都是「原问题 + 最新进展 2026」式退化拼接，未体现真正的 gap identification 后重新定向。
- 交叉验证弱：F-01 首轮命中无关页面，gap 轮未纠偏；最终只能给个人推理并诚实声明，来源无法支撑。
- 过程指标记录完备（iterations/queries/sourceCounts），为后续对比提供了结构化审计基线。

## 9. Bing HTML 是否成为明显瓶颈

**是。** 证据：

1. **来源召回差**：多处搜索返回标题/链接但无正文，模型无法从来源提取数字事实（C-02 DeepSeek 定价、B-02 世界杯赛果、C-04 春节日期）。Bing HTML 只给标题+URL+短摘要，正文/表格抓不到。
2. **官方源比例低**：source_quality 1.75/5；C-04 返回通用日历页/维基而非权威日历；F-01 返回完全无关的台湾页。
3. **链接稳定性**：URL 可达率 98% 尚可，但内容相关性差，可达≠有用。
4. **freshness 差**：B-02 搜不到 2026 世界杯赛果这类显然存在的最新新闻 → Bing HTML 的新闻时效覆盖不足。
5. 结论：Bing HTML 作为第一轮真实实现可运行、零成本、诚实，但**明显限制答案质量上限**。按任务规则，本轮不改，交由 CTO 决定是否替换（官方 search API / 模型原生 web search / 专业 research Agent / MCP provider）。

## 10. 问题归属

- **Search Provider（最大）**：来源召回差、官方源低、无正文、时效弱、偶发无关结果。
- **Orchestration**：自动决策漏触发（68%）；Deep Research 二次查询退化；稳定知识题因编排被拖累（搜索失败→综合不敢答，反而不如裸 API 直接答）。
- **Synthesis/Model**：推理 token 挤占正文导致截断（C-04 hard fail）；偶发空输出（需重试）；引用标签与来源排列不对齐。

## 11. 个性化专项

| 任务 | Arm A 有用性 | Arm B 有用性 | 备注 |
|---|---|---|---|
| G-01 找比赛（正例） | 2 | 4 | A 被判 no_search，未搜索具体比赛 |
| G-02 参赛技术栈（正例） | 5 | 5 | 两者都很好 |
| G-03 写参赛简介（正例） | 5 | 5 | 纯写作，两者一致 |
| G-04 Python 书（负例） | 有用性0/惩罚3 | 有用性5/惩罚3 | 负例上 B 强带项目背景（减分）；A 正常作答（正确） |
| G-05 电影（负例） | 有用性0/惩罚**5** | 有用性0/惩罚0 | **A 干净作答不强行带入；B 强植 AI 身份（减分）** |

- 结论：**个性化防护有效（负例不污染，G-05 得满分）；但正例增益被弱搜索拖累**（G-01 因决策漏触发而无具体结果，有用性 2<4）。基础事实能力不足不能靠个性化弥补——本任务 G 类基础正确性两者均为 4.4（持平），恰说明个性化未补偿搜索短板。

## 12. 结论与下一步

**P95 判定：`market_p95_met = false`，`p95_candidate = false`。**
依据：无真实市场头部对照可运行（禁止用功能齐全/多数通过即宣称）；且在可得对照（同模型裸 API）中，2digime 虽有可测增益，但 citation 支持/来源质量/时效性/决策可靠性存在重大短板，远未到「对照分布顶端+无重大可靠性短板」。

**推荐修复优先级（3 项）：**
1. **换搜索 provider**（最高收益）：官方 search API / 模型原生 web search / 专业 research Agent / MCP provider，以解决来源召回、正文提取、时效与官方源占比。
2. **修合成截断**：提高综合 maxTokens 或改用非推理模式，确保正文不被 reasoning_content 挤占（C-04 类 hard fail 直接消除）。
3. **修决策触发与 Deep Research 查询质量**：提高应搜任务触发率（G-01/B-03/B-05/D-03）；Deep Research gap 轮应生成真正的定向子问题而非「+最新进展 2026」拼接。

---

## 附录：产物

- `scripts/fixtures/conversation-p95-benchmark-01.json` — 任务集 + 维度 + 协议
- `scripts/conversation-p95-run.cjs` — 运行器（Arm A/B）
- `scripts/conversation-p95-anonymize.cjs` — 盲评输入生成
- `scripts/conversation-p95-judge.cjs` — AI Judge（deepseek-v4-pro，独立实例）
- `scripts/conversation-p95-summarize.cjs` — 汇总计算
- `scripts/_conversation-p95-benchmark-01-evidence/` — 运行证据（gitignored）：
  - `benchmark-runs.jsonl`（64 条原始运行，含文本/来源/延迟/usage/成本）
  - `blind-input.json`（匿名化评测输入）
  - `blind-key.json`（Arm 映射）
  - `blind-scores.json`（盲评分数）
  - `benchmark-summary.json`（汇总）
  - `benchmark-plan` 快照（含 arm 探测结论与 rubric）