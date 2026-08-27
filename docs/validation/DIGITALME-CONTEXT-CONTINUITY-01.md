# DIGITALME-CONTEXT-CONTINUITY-01

> 任务上下文连续性：相关信息必须稳定成为当前任务的实际执行上下文。  
> 基线：Trial-05 `b83ef275`（产品能力祖先 `bf5e1fd`）。  
> 不 push。T1（研究综合质量）不在本任务范围。

---

## Before / after

| 环节 | Before（Trial-05） | After |
|------|-------------------|-------|
| 候选发现 | 历史 Job 只有标题/元数据；conversation 与 adopted preference 不进候选 | 同一权威源加厚：artifact 正文摘要、近期 conversation、Subject 已采用 preference、当前附件 |
| 指代 / 相关性 | converse 把 `relevantContextIds` 写成可空；无独立 relevance 调用；偏好靠词面门槛 | 有界 AI relevance：结合当前输入、近期对话、Job/result、项目语义；模型有非空选择则用之 |
| execution freeze | T2/T5 无 historical-artifact；T3 `selectedEventIds=[]` | 选中 artifact / conversation 写入 snapshot；选中 preference 写入 freeze（`planner_selected`） |
| executor | 未收到已有项目事实 → 通用空模板 | `materialUse` 含 `historical-artifact:` / `historical-conversation:`；偏好经 freeze 进入执行提示 |
| 可追溯 | 无法证明「知道但没用」 | Job.contextContinuity：`candidateIds` / `selectedIds` / `attachedRefs` / `freezeEventIds`（validation only，不展示给用户） |
| Review | 容易只看「有没有生成东西」 | 按 AI plan + selected context + 用户目标判断是否可直接使用；产品代码无 `[填写…]` regex blocker |

Deterministic 仍只负责：授权范围、数据存在性、时间/数量预算、敏感边界、context size。  
「用户说的是什么 / 哪些历史相关 / 偏好本次是否适用」由模型判断。

未新增：关键词路由、「下一步/这件事」正则、lastJob 无条件绑定、第二套 memory/retrieval、大型状态机、Trial 样例 prompt patch。

---

## T2 / T3 / T5 根因

统一问题：**相关信息已经存在，但没有进入 execution freeze，executor 看不到。**

### T2 开放指代

- Trial-05：输入「下一步最该先啃哪块？」；苇舟财务说明已完成，更近还有无关任务。
- `historical_context_used=false`；成果是通用「单点突破规划」，无 184 万 / 11 天 / 不做移动端。
- 根因：候选不含 artifact 正文；planner 未把刚完成成果选进 `relevantContextIds`；snapshot 无 historical-artifact。不是「下一步」关键词缺失。

### T3 Preference 已学会但没进入执行

- Trial-05：T3A 已 `preference_observed` + confirmed（`gevt_mtb5g8qjacd77e2c7265`）。
- T3B freeze `selectedEventIds=[]`，`preference_in_context=false`。
- 根因：`selectSubjectInjection` 用关键词门槛；目标「季度进展说明」与偏好「先摊开风险」词面不够重合。Store 有 ≠ 任务使用了。发生在 freeze 前，不是学习失败。

### T5 已有项目上下文仍输出空模板

- Trial-05 Hard Fail：例会稿含 `[填写核心项目/业务名称]` 等占位。
- `historical_context_used=false`。
- 根因与 T2 同链：苇舟上下文未进 candidates → 未选中 → 未 freeze → executor 按通用例会模板写。后续 generic prompt 没有覆盖「已选中的事实」，而是根本没收到事实。不要用 `[填写…]` regex 堵。

---

## 统一修复

数据流：

```
available context
  → candidate discovery（既有 Job/artifact/conversation/Subject/附件）
  → AI relevance / referent resolution
  → bounded assembly
  → execution freeze
  → executor
  → review（plan + selected context + 用户目标）
```

主要模块：

- `src/work-runtime/context-candidates.ts` — 候选加厚；`mergeSelectedContextIds`（模型非空选择优先，否则回退 plan ids）
- `src/work-runtime/context-relevance.ts` — 独立有界相关性调用；`decided:false` 时偏好仍走旧门槛，避免周报复用回归
- `src/work-runtime/work-converse.ts` — 指代解析规则（无 Trial 原句）
- `src/work-runtime/job-runner.ts` — freeze 前 relevance；装配 artifact + conversation；写入 `job.contextContinuity`
- `src/runtime/digitalme-runtime.ts` — preference 候选 + relevance chat → `plannerPreferenceIds`
- `src/subject-core/experience-selector.ts` — 一旦提供 `plannerPreferenceIds`（含空数组），偏好由模型列表决定
- Review：`selectedContext` 进证据包

---

## Candidate → selection → freeze → execution 证据

### Electron T2（`build/evidence/context-continuity-01/t2.json`）

- 输入未再提项目名。候选含苇舟 artifact、番茄炒蛋 artifact、conversation、preference。
- `selectedIds`：苇舟财务说明 + 对应 conversation + preference；**未选**更近的炒蛋成果。
- `attachedRefs`：`historical-artifact:【情况说明】关于苇舟…` + historical-conversation。
- 正文含 184 万元、11 天、不做移动端。`unrelated_cooking_leak=false`。

### Electron T3（同目录 `t3b.json`，T3/G1 收口轮）

- T3A：`preference:gevt_mtb8334wed232872d2c0` confirmed（先风险后建议）。
- T3B 候选含该 preference + 苇舟 artifact/conversation。
- `selectedIds` 含三者；`freezeEventIds` 含该 event；freeze entries kind=preference。
- 计划要求「先风险后建议」；正文第二节先写 11 天审批卡点，建议后置。`preference_in_context=true`。

### Electron T5（`t5.json`）

- 输入「把这件事情整理到…例会」；选中 T2 产出的收窄路线 artifact + preference。
- executor 收到 `historical-artifact:苇舟协作试点项目：下一阶段核心收窄路线…`。
- 例会稿含 184 万 / 11 天 / 不做移动端；`empty_template=false`。无 `[填写…]`。

---

## 泛化验证

单测 `src/work-runtime/tests/context-continuity-01.test.ts` 全部通过。

| 组 | 内容 | 结果 |
|----|------|------|
| A Recent-work referent | 完成真实项目任务后，自然延续意图、不重复项目名 | 模型关联刚完成成果；freeze 含 historical-artifact |
| B Ambiguous-looking | 从未出现在 Trial-05 的自然说法 | 正确 context 被选择；源码扫描无「下一步最该先啃 / 这件事情 / 和上次一样」 |
| C Preference reuse | 与 Trial-05 不同的长期偏好（先写卡点） | adopted → candidate → AI select → freeze → executor |
| D Competing context | 相关历史项目 + 近期无关家常菜 + 相关 preference | **不是**最近一条全塞；炒蛋未进入 selectedIds；偏好进入 freeze |

Electron 新表达：

- **G1**「开场能直接讲的那种，帮我收一版。」选中季度进展说明 + preference；讲稿先风险后建议，含项目事实。
- **G2**「回头把能对外说的数字和边界单独拎出来。」选中三份苇舟成果（未选炒蛋）；对外口径保留 11 天 / Web 端 / 不做移动端，主动脱敏 184 万预算。驱动曾因 excerpt 未含 `184` 误判；以 Job `historical_context_used` 与正文为准，**产品通过**。

---

## 是否出现错误上下文污染

- T2 / D2：`unrelated_cooking_leak=false`。更近的番茄炒蛋在候选中，未被选进 freeze / executor。
- T3B 财务说明任务（附件已足够）未注入偏好：`selectedIds=[]`、`freezeEventIds=[]`，符合「不相关不机械注入」。
- D2 对外一页纸：选中对外口径成果，未把炒蛋或内部预算偏好无差别塞入。

---

## 真实 Electron（未改 Trial 输入）

驱动：`scripts/context-continuity-ui-driver.cjs`  
证据：`build/evidence/context-continuity-01/`（不入库）

| 项 | 结果 | 证据要点 |
|----|------|----------|
| T2 | **pass** | 自然继续苇舟；不用重新介绍；不是更近炒蛋 |
| T3 | **pass**（第二轮 Job 成功） | Store 采用 → candidate → selected → freeze → 产物结构受偏好影响。第一轮 T3B 因 Gemini 503 失败，驱动已加重试 |
| T5 | **pass** | 可直接例会使用；非空模板 |
| G1 | **pass** | 新表达；项目上下文 + 偏好进入 freeze |
| G2 | **pass**（产品） | 新表达；historical artifacts 进入 executor |
| D2 | **pass** | competing 筛选，无炒蛋污染 |
| T6 | **pass** | 纯判断不建 Job |
| T7 | **pass** | 附件足够不联网 |

T8 / Coding Agent / Search routing / Subject correction-supersede：本任务未改这些路径；单测回归 `ai-native-semantic-control-01`、`subject-grounded-work-01`、`subject-learning-availability-01`、`growth-closed-loop-03`、`capability-execution-reliability-01`、`work-converse`、`ai-first-execution`。

---

## Regression 约束核对

- 无 keyword router / regex referent resolver
- 无第二套 memory 或 retrieval store
- 无 case-specific Trial prompt
- 未修改 semantic search routing
- 未处理 T1 研究综合质量
- contextContinuity 仅 Job 审计字段，不进普通用户 UI

---

## Verdict

**通过。** 完成标准 1–10 均满足。
