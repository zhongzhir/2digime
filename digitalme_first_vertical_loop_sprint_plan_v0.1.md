# Digital Me 第一纵向闭环短冲刺计划

版本：v0.1.3  
日期：2026-07-21  
状态：`spec_frozen` / **当前唯一执行计划**（规格已冻结；第 1 块已实现并完成确认边界验收修正；**下一项为第 2 块**）  
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
服务闭环：**第一闭环 — 理解我并产出**  
**冻结规格（正文）**：[`digitalme_first_vertical_loop_spec_v0.1.md`](digitalme_first_vertical_loop_spec_v0.1.md)（**v0.1.0 `spec_frozen`**）

---

## 0. 文档地位

1. 本文是 **2026-07-21 起** 的**当前唯一执行计划**（仓库内**仅本文**可声称此身份）。  
2. 产品流程、四合同、能力方案、`55ae01f` 裁定与验收以 **冻结规格** 为准；本文保留冲刺状态、旧计划处置与任务顺序。  
3. [`digitalme_panorama_execution_index_v0.1.md`](digitalme_panorama_execution_index_v0.1.md) = 历史状态表（`superseded_as_current_execution_index`）。  
4. 未跟踪重复副本（如 `* (1).md`）**不是**权威文件。  
5. **本阶段已完成**：限定范围的仓库实现映射与第一闭环规格冻结。  
6. **下一项**：代码实现（见 §6）；**不得**在无规格授权前编码。

---

## 1. 冲刺目标

证明：

> **Digital Me 能代表我完成一项研究与表达任务。**

完整示例、入口、逐步流程、证据栏与验收 → 见冻结规格 §1–§2、§4、§9。

### 1.1 已纠正的关键误差（强制）

| 误差 | 正确口径 |
|------|----------|
| 称 `buildSelectedSelfContext()` 为「与当前任务相关」 | **否**。它是**固定比例**有界初始摘录；须由用户确认/编辑。任务相关装配见规格 §3.2。 |
| 以模型输出「使用的本人信息」为可审计唯一证据 | **否**。系统必须记录实际输入的 Subject Context；模型整理仅供参考。见规格 §3.3。 |

### 1.2 本闭环明确不做

外部 Agent 委派；真实对外发送；DID/VC；区块链；支付/签约/公开发言；能力市场；多场景扩展；大规模 renderer 迁移；与主流程无关的 UI/竞态修补；按**旧 DM-Core-01A 开发指令**扩展；在未获实现授权时改 `55ae01f` 代码。

---

## 2. 旧计划处置

| 项 | 状态标记 | 说明 |
|----|----------|------|
| R0 / R1 | `completed` / **retained as infrastructure** | 已 accepted |
| R2 | **retained as infrastructure** | 停止验收主线 |
| R3 | **`paused`** | 不是下一步 |
| R2.5 | `planned` / `deferred` | — |
| PAN-02～06 | **`paused`** | 相对新主线 |
| 并列 7 任务块 | **`superseded`** | — |
| 旧 DM-Core-01A **开发指令** | **`superseded`** | 见废止说明 |
| 提交 **`55ae01f`** | **`partially_reused_as_first_vertical_loop_scaffold`** | 已完成规格映射裁定；任务列表/恢复/callModel 等直接复用；固定截取与模型自述证据方式不作为最终闭环实现。第 1 块已复用其脚手架并演进 Task Intent / Subject Context |
| 本执行计划 | **`spec_frozen`** | 映射与规格冻结完成 |

### 2.1 `55ae01f` 裁定摘要

详见规格 §6。摘要：任务列表/重启/callModel → 直接复用；入口更名、执行路径、四栏、JSON/IPC → 调整后复用；固定比例「任务相关」逻辑 → 暂不采用；Skill/外搜/Proposal → 本闭环缺失待实现。

---

## 3. 四合同与能力选型（指针）

字段级冻结表 → [`digitalme_first_vertical_loop_spec_v0.1.md`](digitalme_first_vertical_loop_spec_v0.1.md) §5。

| 能力 | 选定 | 接口要点 |
|------|------|----------|
| Skill | **通用调研** `psk_preset_general_research` | `skills:setActive` + `systemHint` 注入 + steps；禁止只记名称 |
| 只读外部信息 | **研究网页搜索** `searchWeb` | `research:discoverSources`；Brave 或 DuckDuckGo 兜底 |

---

## 4. 代码级映射索引（本任务只读结论）

| 区域 | 路径 | 映射结论 |
|------|------|----------|
| act-behalf | `src/act-behalf/{task-store,select-self-context,parse-output}.js` | 持久化与解析可演进复用；选摘逻辑须按规格替换 |
| IPC | `main.js` `actBehalf:*`；`preload.js` 对应 API | 调整后复用 |
| 入口 UI | `renderer/app.js` / `index.html` 工作台卡片 | 调整文案与流程 |
| Package | `package:load` → persona/style/frameworks/memory/life/boundaries | Subject Context 候选源 |
| 模型 | `callModel` | 直接复用 |
| Skill | `src/skills/{personal,research-presets}.js` | 选定通用调研 |
| 外搜 | `src/research/web-search.js`；`research:discoverSources` | 选定只读外搜 |
| 本地检索 | `src/retrieval.js` | 仅辅助相关性；不算外部信息闭环 |
| Proposal 候选 | `src/feedback.js` preview/apply | Experience Proposal 对齐 |
| 研究 loop | `src/research/agent-loop.js` | 可选复用四步拓扑；Skill.steps 须真实影响提示与检索 |

---

## 5. 近期任务顺序

| # | 任务 | 状态 |
|---|------|------|
| 1 | 限定范围的仓库实现映射与第一闭环规格冻结 | **`completed`（本文档提交）** |
| 2 | （已并入 #1）产品结果/主流程/最小合同冻结 | **`completed`** → 见规格文 |
| **3（进行中/本提交）** | **实现任务意图与本人上下文装配（第一闭环实现 · 第 1 块）** | **`implemented`（本提交）** |
| 4 | 实现「研究与表达」真实任务入口（与第 1 块入口对齐，后续接执行） | 部分已由第 1 块覆盖入口；执行未开 |
| 5 | 接入真实 Skill 并证明改变方法 | **下一项** |
| 6 | 接入只读外搜 | 待 |
| 7 | 证据四栏 | 待 |
| 8 | Experience Proposal 与回流 | 待 |
| 9 | 集中复核 + Owner 验收 + 对照测试 | 待 |

---

## 6. 当前状态与下一项

### 当前

- 执行计划状态：`spec_frozen`；第 1 块实现已合入  
- 冻结规格：`digitalme_first_vertical_loop_spec_v0.1.md`  
- **`55ae01f`**：`partially_reused_as_first_vertical_loop_scaffold`

### 下一项（准确名称）

**第一闭环实现 · 第 2 块：真实 Skill 与只读外部调研调用**

---

## 7. 维护规则

1. 冲突时：架构原则文 > 本文（排期）> 冻结规格（产品/合同细节）与本文一致时以规格字段表为准。  
2. 不得另立第二份「当前执行计划」。  
3. 更新时同步 `digitalme_context.md` 决策 log。

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-21 | 规划基线重建 |
| v0.1.1 | 2026-07-21 | 澄清指令 vs `55ae01f`；四合同字段初核 |
| v0.1.2 | 2026-07-21 | 映射完成；规格冻结为 `spec_frozen`；下一项改为实现第 1 块 |
| v0.1.3 | 2026-07-21 | 第 1 块实现合入；`55ae01f` → `partially_reused_as_first_vertical_loop_scaffold`；下一项 = 第 2 块 |
