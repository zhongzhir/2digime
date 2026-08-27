# DIGITALME-RESEARCH-RESULT-QUALITY-01

> 搜索成功 ≠ 研究成功：证据必须经模型筛选，综合与目标级 review 才是研究完成。  
> 基线：`3d4830d123bf249fafc61c6f2f9c66b5df9f47bc`（CONTEXT-CONTINUITY-01）。  
> 不 push。不重开 semantic routing / context continuity / Subject。

---

## T1 根因

Trial-05 T1：用户未说「搜索」，AI 正确判断需要外部信息并选中 search。失败不是「不会搜」，而是搜完把命中清单当交付。

| 环节 | Trial-05 事实 |
|------|----------------|
| Query | 整段用户 goal 直接当 `searchQuery` |
| Provider | Bing HTML 扫到非有机 `h2`（视频模块）→ YouTube about/press 导航页 |
| 证据 | 有 URL+标题即视为可用；无相关性/充足性判断 |
| 综合 | search dump 可当最终 Artifact；综合不是独立成功条件 |
| Review | 只看有无正文/来源/Job 结束；H1 嵌了整段 goal 即过主题检查 |

**第一失真点：** 用整段 goal 当查询，并把「有命中」当成研究完成。  
**主失真层：** 工作路径 SearchAdapter dump → 无证据筛选 → dump 可交付 → review 不检查是否回答了问题。

---

## Before / after

| 环节 | Before | After |
|------|--------|-------|
| Query | `capInput.goal` 整句 | 模型规划 1–2 条短查询；失败才回退整句 |
| Provider 解析 | 优先任意 `h2` | 优先有机 `li.b_algo`，再 fallback `h2`（结构解析，不是域名黑名单） |
| 候选 | dump 即证据 | 去重 / URL 正常化 / grounding 片段提升为 snippet |
| 筛选 | 无 | 模型判断 relevant / useful / insufficient / duplicate；空选再问一次 |
| 再检索 | 无 | 不足则 followup，最多 2 轮 × 2 query，最多 8 条选用 |
| 综合 | 可跳过 | 有选用证据后强制综合；综合失败 bounded retry，不丢 search、不污染 cooldown |
| 空证据 | 仍用内部知识写成「最新事实」 | 诚实失败，禁止假完成 |
| Review | 有文本即过 | 是否回答用户问题、是否只是链接清单、证据不足是否过强结论 |
| 审计 | 无 | `job.researchEvidence`：query / rounds / candidate / selected / rejected / sufficient（不展示给用户） |

未增加：YouTube 黑名单、新闻关键词、T1 原句 patch、固定白名单、第二套 research engine。

---

## 统一研究链

```
用户问题
  → AI 明确要回答什么（已有 plan）
  → 模型生成 search query
  → 既有 search capability 检索
  → 模型筛选证据（相关 / 充足 / 缺口）
  → 不足则 bounded 再检索
  → 基于 selected evidence 综合（独立成功条件）
  → review 对照原始目标
```

主要模块：

- `src/work-runtime/research-evidence.ts` — 查询规划与证据判断 JSON 合同
- `src/work-runtime/job-runner.ts` — `runBoundedResearch`；综合排除 search capability；空选用诚实失败
- `src/capability/adapters/search-adapter.ts` — `searchQuery`；grounding 片段进入 snippet/chunk
- `src/capability/adapters/bing-html-search.ts` — 有机结果优先
- Review：`ai-cto-review.ts` / `generic-cto-review.ts`

预算：`RESEARCH_MAX_ROUNDS=2`，每轮最多 2 query，最多 8 条选用。

证据相关性 / 充足性：**由模型判断**。Deterministic 只做去重、格式解析、无内容剔除、失败检测、预算。空 `selectedIndexes` 只表示「全部无关」；标题已相关必须选。选用为 0 时不得综合、不得用内部知识补「最新事实」。

---

## 泛化单测（A–D）

`src/work-runtime/tests/research-result-quality-01.test.ts`

| 组 | 要求 | 结果 |
|----|------|------|
| A | 当前变化研究：综合成文，不是链接清单 | pass |
| B | 噪声结果：筛掉明显无关，不按排名全用 | pass |
| C | 第一轮不足：调整查询再检索 | pass |
| D | 来源冲突：保留差异，不随便选一个 | pass |
| 额外 | 空选用不得综合；grounding 片段可作 snippet | pass |

---

## Electron

驱动：`scripts/research-result-quality-ui-driver.cjs`  
证据：`build/evidence/research-result-quality-01/`（不入库）

### Trial-05 T1 原句

输入不变。通过跑：`job_mtbbh6hc3cb8aaa8617c`，211s，Job succeeded。

- 自主判断需要现实信息，选中 `cap_gemini_web_search`
- Query：`EU AI Act high risk employment recruitment compliance requirements` 等，不是整段 goal
- 1 轮检索；选用 8 条（含 europa.eu / artificialintelligenceact.eu / EEOC 相关页）
- 候选里有一条 YouTube 视频链接，**终稿不是** YouTube about/press 导航清单
- 综合成监管趋势 + 产品盯防清单；`materialUse` 含 `external-information://search-evidence`
- driver 与 persisted `researchEvidence` 一致

同一次全量跑中 T1 曾因 420s 驱动超时未等到 artifact（当时已选出 8 条）。驱动超时改为 600s 后重跑通过。产品链本身已在超时前完成筛选。

### 泛化研究

| ID | 输入（不说搜索/联网/研究） | 结果 |
|----|---------------------------|------|
| G1 | 碳边境与碳定价近一年推进及对出口制造的意义 | 通过。1 轮；CBAM 综合说明；选用 8 条 |
| G2 | 美国先进芯片/设备出口限制及配套企业窗口 | 通过。2 轮补查询；BIS/Federal Register 等进入选用 |

### 回归（同一 Electron 会话）

| ID | 要求 | 结果 |
|----|------|------|
| T6 | 纯对话不建 Job | 通过（46s，未泄漏到工作台） |
| T7 | 附件足够不乱搜 | 通过（纪要数字进正文，`search_used=false`） |

单测回归：context continuity、semantic control、search/synthesis 阶段隔离、search failure closure 均通过。未改 semantic ownership / T2–T5 产品路径。

---

## 完成标准核对

1. T1 第一失真点已定位（整句 query + 命中即完成）。  
2. search hit ≠ research success。  
3. 模型判断 relevance / sufficiency。  
4. 证据不足可 bounded 再检索（单测 C；Electron G2 两轮）。  
5. 综合有独立成功条件；综合失败不丢 search、不污染 cooldown。  
6. Review 检查是否真正回答用户目标。  
7. Trial-05 T1 真实 Electron 通过。  
8. G1 / G2 泛化研究通过。  
9. 无关键词/域名/case patch。  
10. T6 / T7 与既有单测无回归。
