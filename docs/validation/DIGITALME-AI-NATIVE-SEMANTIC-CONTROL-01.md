# DIGITALME-AI-NATIVE-SEMANTIC-CONTROL-01

> 恢复 AI 语义终裁权：AI owns semantics，control layer owns enforcement。  
> 分支：`build/ai-native-semantic-control-01`（自审计提交 `f12cde19` 拉出）。  
> 不 push。

---

## Before / after decision ownership

| 决策 | Before（审计） | After |
|------|----------------|-------|
| 任务需要哪些能力 | `executionIntentKind` 三值 + `deriveWorkIntent` 关键词；做事链无法表达 research | Planner `requiredCapabilities` 驱动既有 `selectForNeed`。交付形态仍可以是 document。 |
| 无 search 时 | 改写成普通 document | 语义保持「需要外部信息」；只报告能力不可用 |
| 主体偏好 | 模型失败 → heuristic/`knowledge_gap_noted` | 模型语义为主；失败则 repair；仍无可靠 proposal 则不记；低风险 durable preference 静默采用并注入 |
| 跨任务上下文 | 仅本任务 `contextRefs` | 候选发现（确定性、授权范围）→ 模型 relevance → 装配 |
| Review | 更容易确认「有没有生成东西」 | 验收 AI plan 冻结的 `planRequirements` |
| 允许的 fallback | 曾用关键词猜意图 | 仅技术失败：parse repair、重试、能力不可用、timeout、provider、合同校验、诚实失败 |

Deterministic 可以 veto，不能 reinterpret。

---

## 修改模块

- `src/work-runtime/planner-semantic.ts` — 能力需求合同（非第四 intent 值）
- `src/work-runtime/work-converse.ts` — 规划模型产出并持久化 semantic
- `src/work-runtime/job-runner.ts` — 做事链按 semantic 选 search、search 后综合、装配所选历史上下文
- `src/work-runtime/createConversationTask` — 建任务时不再用 regex 抢占 intentKind
- `src/capability/registry.ts` — `needsExternalInformation` 进入既有 search 支路；不覆盖 coding
- `src/work-runtime/context-candidates.ts` + `snapshot-builder.attachTextItem` — 候选发现与装配（同一 ContentStore）
- `src/subject-core/structured-distill.ts` — 有模型禁止 heuristic 改写成 knowledge_gap；低风险模型 preference 补齐 `silent_ok`
- `src/subject-core/small-loop.ts` — `category:preference` 进入既有风格亲和（taxonomy，非用户措辞关键词）
- `src/execution/generic-cto-review.ts` / `ai-cto-review.ts` / `cto-review.ts` — `planRequirements`
- 测试：`src/work-runtime/tests/ai-native-semantic-control-01.test.ts`

未新增：第二套 intent classifier / capability router / subject pipeline / RAG / 大型状态机 / Trial case 关键词特判。

---

## 泛化单测

| 组 | 结果 |
|----|------|
| A Research（无「搜索/调研/研究」措辞 → search 实际执行；纯附件文档不联网） | 通过 |
| B Preference（「最有效的是先看到结论…」→ preference + silent_ok；下一周报任务 freeze 注入；空模型不记 knowledge_gap；外部声称不进 preference） | 通过 |
| C Open goal / cross-task（相关 vs 无关历史成果；执行器只看到所选上下文） | 通过 |
| D 无 Trial 原句关键词补丁扫描 | 通过 |
| 既有 converse / thin / search fallback / distill JIT / CTO / correction-supersede / small-loop | 通过 |

---

## 真实 Electron UI

驱动：`build/evidence/ai-native-semantic-control-01/ui-driver.cjs`  
入口：当前源码 `electron/main.cjs`（非旧 packaged EXE）。只读 invoke 取证据，发送走真实按钮。

驱动 `summary.json.ok` **不可作为终裁**：第一轮 `scanJobs` 曾读错目录导致 `jobs: []`；T4 第二轮 `confirmedExperienceCount` 不计 preference 视图。下列以磁盘 job / derived / appliedUnderstanding 为准。

### T2 当前现实研究

- userData：`C:\Users\46554\AppData\Local\Temp\dmv2-semctl-ud-GvVHBs`
- Job：`job_mtaxssf882b66b1445df`
- `capabilityId=cap_baseline_web_search`
- plan.semantic：`external_information` + `document_synthesis`
- `materialUse`：`external-information://search-evidence`
- 正文声明已使用基础搜索；检索覆盖有限，模型诚实写出缺 2026 微观数据（不编造链接）
- **结论：AI 判定需要外部信息，search 被实际调用。** 来源质量受 baseline search 限制，不是能力选择失败。

### T2B 不同措辞（无「搜索/调研/研究」）

- Job：`job_mtaxv8x7fce4743262d2`
- 同样 `cap_baseline_web_search` + `search-evidence`
- baseline 检索到无关页时，模型声明材料不足
- **结论：能力选择已泛化，不是原句 case patch。**

### T4 自然偏好 → 后续复用

第一轮（修复前）：`gevt_mtaxw1cc982b780aa90a` 类型已是 `preference_observed`（不是 knowledge_gap），但停在 candidate，周报未注入。

第二轮（silent_ok + 风格亲和后），userData：`C:\Users\46554\AppData\Local\Temp\dmv2-semctl-ud-gmWiVO`

- 事件：`gevt_mtaya5gwcafeb183c07b`，`preference_observed` / `distill:model` / `silent_ok` / `risk:low`
- `userVisibleFacts`：看周报时结论先行
- 周报任务 `task_mtayae4te48ae3409dbc` 的 `appliedUnderstanding`：已结合你之前确认的内容 →「看周报时结论先行」
- 成文以「整体结论与摘要」开头，依据在后
- **结论：学习类型正确，已静默采用并在下一周报任务注入。**

### T5 开放目标 / 跨任务上下文

- Job：`job_mtaxxblkea96e0246a58`
- `materialUse`：`historical-artifact:NORTHSTAR_OKR_ALPHA 项目阶段说明与后续工作指引`
- plan requirements 含 NORTHSTAR / 权限收敛
- 正文为权限收敛推进方案，非通用模板
- **结论：候选发现 + 模型 relevance + 装配成立。**

---

## 保留的 deterministic enforcement

- Coding Agent 真执行与规划版本门
- 文件写入 / 高风险 / 不可逆确认
- 密钥不进用户面
- 外部事实不进入 identity
- `knowledge_gap_noted` 不能确认进权威注入
- 无 fake completion（search 无证据则失败或诚实缺口）
- subject correction / supersede
- search timeout / cooldown / fallback（既有 SEARCH-FAILURE-CLOSURE）

---

## 是否仍有 semantic ownership 残留

- `deriveWorkIntentSync` 关键词表仍存在，供无 planner semantic 的旧 `submitTask` 路径。做事页确认链以 plan.semantic 为准。
- 无模型时合同蒸馏仍含历史启发式（测试夹具）；**有模型时不再 fallback 改写**。
- `enrichGrowthTags` 仍有「结论先行」等历史域标签启发式；本轮 T4 原句未命中该规则，working_method 来自模型分类。
- `decideSearchNeed` 仍只服务对话页；做事页不复制该路由，由 planner capability needs 驱动。
- 低风险文档自动「确认」仍在；确认后执行族只表示交付形态。
- overview `confirmedExperienceCount` 不计 preference 视图（驱动误判来源，不影响注入）。
- baseline search 覆盖弱，可能检索到无关页；系统保持诚实缺口，不改写成「普通 document」。

这些是残留的旧路径或检索质量问题，不再拥有 T2/T4/T5 所证明的语义终裁权。
