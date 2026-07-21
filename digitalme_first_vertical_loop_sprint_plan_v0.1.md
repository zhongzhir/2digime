# Digital Me 第一纵向闭环短冲刺计划

版本：v0.1.1  
日期：2026-07-21  
状态：`active` / **当前唯一执行计划**  
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
服务闭环：**第一闭环 — 理解我并产出**

---

## 0. 文档地位

1. 本文是 **2026-07-21 起** 的**当前唯一执行计划**（仓库内**仅本文**可声称此身份）。  
2. [`digitalme_panorama_execution_index_v0.1.md`](digitalme_panorama_execution_index_v0.1.md) 降为 **历史 P1-PANORAMA / Renderer Foundation 状态表**（`superseded_as_current_execution_index`），仍保留 R0–R2 等基础设施事实。  
3. **下一项任务仅限文档/映射/规格冻结，不得直接编码实现产品功能。**  
4. 未跟踪重复副本（如 `digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha (1).md`）**不是**权威文件，不得当作当前计划。

---

## 1. 冲刺目标（1–2 天量级，证明一事）

证明：

> **Digital Me 能代表我完成一项研究与表达任务。**

不是同时做完 Skill、MCP、Agent、DID 与完整身份系统。

### 1.1 最小用户流程（验收主路径）

1. 用户提出真实研究与表达目标。  
2. Digital Me 展示准备采用的本人事实、观点、偏好、风格与边界。  
3. 用户可快速确认或纠正。  
4. 系统使用**一个真实研究 Skill**。  
5. 系统通过**一个只读 MCP 或现有检索能力**获取外部信息。  
6. 系统生成带证据的成果。  
7. 界面明确区分：本人已有事实或观点；外部事实与来源；Digital Me 新推断；最终可编辑成果。  
8. 用户采用、修改或否定结果。  
9. **只有用户确认的修正**可成为主体模型变化。  
10. 重启后任务、依据、成果与决策仍在。  
11. 下一次相似任务能体现已确认的变化。

### 1.2 本闭环明确不做

外部 Agent 委派；真实对外发送；DID/VC；区块链；支付/签约/公开发言；能力市场；多场景扩展；大规模 renderer 迁移；与主流程无关的 UI 优化或架构重构；继续 R2 边缘修复与追加验收；**按旧 DM-Core-01A 开发指令继续扩展**（见 §2.1；**不等于**否认提交 `55ae01f` 已存在）。

---

## 2. 旧计划处置（强制）

| 项 | 状态标记 | 说明 |
|----|----------|------|
| R0 / R1 | `completed` / **`retained as infrastructure`** | 已 accepted；生产默认仍 legacy |
| R2 实现 | **`retained as infrastructure`** | 代码与自动化保留；**停止作为当前验收主线**；是否补写 Owner `accepted` **不阻塞**本计划 |
| R3 renderer 迁移 | **`paused`** | **不是**下一项；未经新授权不得启动 |
| R2.5 SQLite | `planned` / `deferred` | 非本闭环前提 |
| PAN-02～PAN-06 | **`paused`**（相对新主线） | 历史索引保留；不得按旧解锁条件自行启动 |
| Skill/MCP/Agent/身份并列 7 任务块 | **`superseded`** | 不得按并列模块开干 |
| **旧 DM-Core-01A 开发指令** | **`superseded`** | **不得**再按该旧指令扩展开发；详见 [`digitalme_dm_core_01a_superseded_notice_v0.1.md`](digitalme_dm_core_01a_superseded_notice_v0.1.md) |
| **提交 `55ae01f`（act-behalf 实现）** | **`retained_for_mapping_review`** / `experimental_infrastructure` | 新规划冻结前已合入；**真实存在**；**不是**第一闭环完成态；本次**不得改代码**；映射/规格冻结后再裁定复用、调整或废弃 |
| 大规模长期模块化建设计划 | **`archived` as approach** | 改为纵向闭环 |

### 2.1 提交 `55ae01f` 能力边界（只读核验）

路径要点：`digitalme-app/src/act-behalf/*`、`main.js`（`actBehalf:*`）、`renderer` 工作台卡片「代表我完成任务」、`userData/act-behalf-tasks.json`。

**已具备：**

- 「代表我完成任务」入口（工作台卡片 + 场景 UI）；  
- 本人信息有界摘录（`buildSelectedSelfContext`）与手工修改（textarea / `userEdited`）；  
- Task 的草稿、执行、保存与重启恢复（`act-behalf-tasks.json` 原子写）；  
- 四栏结果展示（使用的本人信息 / 本人已有事实或观点 / Digital Me 新分析或建议 / 完整结果）；  
- 现有 `callModel` 调用；  
- 本地持久化。

**尚未具备或尚未证明：**

- 真实 Skill 调用；  
- 只读 MCP 或外部检索能力（本路径未接入）；  
- 外部事实及来源证据（四栏中**无**「外部事实与来源」栏）；  
- Capability Invocation 完整记录（仅有空数组 `capabilityRefs` 预留）；  
- Experience Proposal；  
- 用户确认后改变主体模型（Package）；  
- 下一次相似任务体现已确认变化；  
- 通用 AI 对照测试。

**因此：不得将 `55ae01f` 标记为「第一纵向闭环完成」。**

---

## 3. 四个最小核心合同（第一闭环冻结范围）

> 字段为**合同意图**；实现须映射现有结构，禁止另造完整领域模型。  
> **所有推测性变化默认只能成为 Experience Proposal，不得自动成为已确认本人事实/观点。**  
> **UI 展示字段、prompt 正文或普通任务 JSON 不得直接等同于已冻结的正式合同。**

### 3.1 Subject Context（本次使用的「我」的快照）

最少：`subjectId` · `subjectVersion` · `claims` · `sourceRefs` · `confidence` · `confirmationState` · `scope` · `prohibitedUses`

### 3.2 Task Intent（本次意图与边界）

最少：`taskId` · `goal` · `role` · `expectedOutcome` · `constraints` · `riskLevel` · `approvalPolicy`

### 3.3 Capability Invocation（能力调用记录；保留 kind 差异）

最少：`capabilityId` · `kind: skill \| tool \| agent` · `provider` · `inputs` · `disclosedContext` · `permissions` · `resultRefs` · `status`

### 3.4 Experience Proposal（可能改变主体的候选经验）

最少：`proposalId` · `derivedFrom` · `proposedChange` · `targetScope` · `evidence` · `userDecision` · `appliedVersion`

---

## 4. 现有实现映射表（合同 → 仓库）

| 合同字段 / 概念 | 现有对应结构或文件 | 可复用 | 缺口 | 第一闭环是否需补齐 |
|-----------------|-------------------|--------|------|-------------------|
| **subjectId** | Package `manifest.json`、PackageStore revision；尚无稳定跨设备 subjectId | 包路径 + revision 可作临时版本锚 | 稳定 subjectId / 控制关系模型 | **是**（最小：本地稳定 id + version） |
| **subjectVersion** | PackageStore revision / root digest | 可直接引用 revision | 与「已确认主体变更」版本链对齐 | **是**（映射即可，勿新建大版本系统） |
| **claims** | `persona.md`、`memory/long-term-memory.jsonl`、life 摘要、PersonEnrichment、`decision-frameworks.json` | 已有多源「人设/记忆/框架」文本与部分结构化 | 统一 claim 形状（事实/观点/偏好/边界）、来源与确认态 | **是**（装配层，非重做记忆系统） |
| **sourceRefs** | Package 路径、材料 custody、builder 写入审计、retrieval 命中 | 文件路径与部分 hash | 任务级可展示的引用列表 | **是** |
| **confidence** | 部分 inference / 构建把握度（Builder） | 局部有 | Subject Context 级统一置信 | 可选；不足则显式「不确定」 |
| **confirmationState** | feedback 确认写入、Builder 预览→确认 | 有确认写入范式 | 任务上下文确认 ≠ Package 写入 | **是** |
| **scope / prohibitedUses** | `policies/boundaries.json`、boundariesSummary、表达禁区 | 可注入边界摘要 | 任务级 scope 裁剪与禁止用途字段 | **是**（最小裁剪规则） |
| **taskId / goal / … Task Intent** | 会话 `sessions`、研究 `research-projects`、`55ae01f` → `act-behalf-tasks.json` | 有任务/课题持久化先例 | 统一 Task Intent 合同；研究+表达目标字段 | **是** |
| **role / approvalPolicy / riskLevel** | L0 外部 Agent 授权六要素、PAN-01R harness（无生产入口） | 授权/风险概念可借鉴 | 第一闭环只需本地低风险研究表达策略 | 部分；对外行动延后 |
| **Capability Invocation · skill** | `skills/personal`、场景 skill bar、研究预设 skill | 已有个人 Skill 列表与场景绑定 | 「一个真实研究 Skill」改变方法的证据 | **是** |
| **Capability Invocation · tool** | MCP 能力扩展、`retrieval.js`、research web-search | 检索与只读工具已存在 | 统一 invocation 记录与 disclosedContext | **是**（优先复用检索/只读） |
| **Capability Invocation · agent** | L0 CLI Agent / panorama experience | 内部 harness | 本闭环**不做**真实委派 | **否**（仅预留 kind） |
| **disclosedContext** | 对话全量 prompt 注入（历史问题）；`55ae01f` 有界摘录；panorama subject-brief | 有界摘录与 brief 可借鉴 | 强制任务相关披露清单 | **是** |
| **Experience Proposal** | `feedback.js` 用户反馈写入；Builder 候选；life inference 更新 | 有「确认后写入」路径 | 独立 proposal 对象、userDecision、appliedVersion、下次任务回流证明 | **是** |
| **产物 / 证据区分 UI** | `55ae01f` 四栏；写作/研究成稿、library | 成稿与四栏可借鉴 | 缺「外部事实与来源」；正式证据合同未冻结 | **是** |
| **重启仍在** | `55ae01f` userData JSON 原子写；sessions、research | 模式成熟 | 任务+依据+决策一体与回流证明 | **是** |

### 4.1 映射原则

1. **优先装配，不另起炉灶**：Subject Context 从 Package + policies + 可选用户确认文本装配。  
2. **禁止**为第一闭环重建完整记忆/身份/DID 平台。  
3. 提交 `55ae01f` 的 `act-behalf` 代码为 **`retained_for_mapping_review`**：可作映射候选；**不得**在未完成规格冻结前按旧指令继续扩展；**不得**把 UI/prompt/任务 JSON 直接当作四合同已实现。

### 4.2 四合同逐字段实现状态（只读核验 · v0.1.1）

状态枚举：**已实现** · **部分实现** · **仅候选设计** · **缺失**。  
口径：相对「正式 Subject Context / Task Intent / Capability Invocation / Experience Proposal 合同」；`55ae01f` 为主要对照，仓库其它模块仅作候选注明。

#### Subject Context

| 字段 | 状态 | 依据（摘要） |
|------|------|--------------|
| `subjectId` | **缺失** | act-behalf 任务无此字段；Package 亦无稳定跨设备 subjectId |
| `subjectVersion` | **缺失**（任务合同）/ 仓库另有 **部分实现** 候选 | PackageStore revision 存在，但未写入 act-behalf 任务快照 |
| `claims` | **部分实现** | 有界摘录 `items[]`（persona/life/style 等文本块）；**不是**带类型/确认态的正式 claim 对象 |
| `sourceRefs` | **部分实现** | `items[].source` 为粗粒度来源标签；非可核对 sourceRef 列表 |
| `confidence` | **缺失** | act-behalf 路径无置信字段 |
| `confirmationState` | **部分实现** | 仅有 `userEdited`；无主体 claim 级确认态枚举 |
| `scope` | **部分实现** | 字符预算裁剪 + 边界文本注入；无正式 `scope` 字段 |
| `prohibitedUses` | **部分实现** | 边界摘要可进入摘录；无独立 `prohibitedUses` 合同字段 |

#### Task Intent

| 字段 | 状态 | 依据（摘要） |
|------|------|--------------|
| `taskId` | **已实现** | `abt_*` 持久化于 `act-behalf-tasks.json` |
| `goal` | **部分实现** | 以 `request` / `title` 自由文本承担；无独立 `goal` 合同字段 |
| `role` | **缺失** | — |
| `expectedOutcome` | **缺失** | 仅靠 prompt 要求四栏产出，无结构化字段 |
| `constraints` | **缺失** | 约束未结构化；边界只在摘录文本中 |
| `riskLevel` | **缺失** | — |
| `approvalPolicy` | **仅候选设计** | 任务上有 `authorization: null` 预留；无策略实现 |

#### Capability Invocation

| 字段 | 状态 | 依据（摘要） |
|------|------|--------------|
| `capabilityId` | **缺失** | `capabilityRefs: []` 仅为预留 |
| `kind` | **缺失** | 未区分 skill / tool / agent |
| `provider` | **部分实现** | `modelMeta.model` 等运行元数据；非正式 invocation.provider |
| `inputs` | **部分实现** | request + 摘录进入 prompt；无独立 invocation.inputs 记录 |
| `disclosedContext` | **部分实现** | `selectedSelfContext` 持久化；非正式 disclosedContext 合同 |
| `permissions` | **缺失** | — |
| `resultRefs` | **缺失** | 结果写在任务字段，无 resultRefs |
| `status` | **部分实现** | 任务级 `draft`/`completed`；非能力调用级 status |
| 真实 Skill 调用 | **缺失** | 本路径未调用 personal skills |
| 只读 MCP / 检索 | **缺失**（本路径）/ 仓库另有 **仅候选设计** | `retrieval.js`、MCP、research web-search 未接入 act-behalf |

#### Experience Proposal

| 字段 | 状态 | 依据（摘要） |
|------|------|--------------|
| `proposalId` | **缺失** | act-behalf 无 proposal 对象 |
| `derivedFrom` | **缺失** | — |
| `proposedChange` | **缺失** | — |
| `targetScope` | **缺失** | — |
| `evidence` | **缺失** | — |
| `userDecision` | **缺失** | 结果可编辑展示 ≠ proposal 决策 |
| `appliedVersion` | **缺失** | 不写回 Package / 无版本链 |
| 仓库其它回流 | **仅候选设计** | `feedback.js`、Builder 确认写入可作映射候选，**未**接入本闭环任务 |

---

## 5. 近期候选任务顺序（本次不开发）

| # | 任务 | 类型 |
|---|------|------|
| **1（当前）** | **限定范围的仓库实现映射与第一闭环规格冻结** | **仅文档 / 映射复核 / 规格冻结** |
| 2 | 冻结第一纵向闭环的产品结果、主流程与最小合同（若 #1 后仍有缺口则补冻） | 文档 |
| 3 | 实现任务意图与本人上下文装配 | 实现（待授权） |
| 4 | 实现「研究与表达」真实任务入口 | 实现 |
| 5 | 接入一个真实 Skill，并证明它改变任务方法 | 实现 |
| 6 | 接入一个只读 MCP 或现有外部信息能力 | 实现 |
| 7 | 实现本人观点 / 外部事实 / Digital Me 推断 / 最终成果的证据区分 | 实现 |
| 8 | 实现用户修正、Experience Proposal、确认与下一次任务回流 | 实现 |
| 9 | 集中代码复核、Owner 主流程验收、通用 AI 对照测试 | 验收 |

**规则**：只有上一任务主流程成立后，才可进入下一任务。  
**#1 不得标记为代码实现。**  
**不得**把 `55ae01f` 当作已完成 #3–#9。

---

## 6. 当前唯一任务（准确名称与范围）

### 名称

**限定范围的仓库实现映射与第一闭环规格冻结**

### 范围（允许）

- 复核并修订本文 §4 / §4.2 映射与字段状态（对照真实代码路径）；  
- 冻结第一闭环的用户可见结果、主流程步骤、四合同最小字段与「明确不做」；  
- 标明可复用文件（含 `55ae01f`）与禁止新建的重复体系；  
- 产出可供下一实现任务引用的规格切片（仍属文档）。

### 范围（禁止）

- 编写或扩展产品功能代码（含修改 `55ae01f` 引入的 act-behalf 实现）；  
- 启动 R3；  
- **按旧 DM-Core-01A 开发指令**继续扩展；  
- 并列开工 Skill/MCP/Agent/DID；  
- 扩大为数月架构项目；  
- 宣称 `55ae01f` 已完成第一纵向闭环。

### 阻断标准

仅适用架构原则文 §7.3 四类；文档任务阶段以「规格自相矛盾 / 双权威入口冲突」为额外文档阻断。

---

## 7. 维护规则

1. 更新本文时同步 [`digitalme_context.md`](digitalme_context.md) 文首主线条与决策 log。  
2. 不得与本文并列存在另一份声称「当前执行计划」且指向 R3 / 旧 7 任务块 / 旧 DM-Core-01A **指令**的文件。  
3. 历史文件保留；用 `superseded` / `paused` / `retained as infrastructure` / `retained_for_mapping_review` 指向本文与架构原则文。  
4. 文件名含 ` (1)` 的重复副本一律视为非权威。

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-21 | 规划基线重建：第一纵向闭环、四合同映射、任务顺序；废止旧执行主线 |
| v0.1.1 | 2026-07-21 | Codex 有条件通过后澄清：区分旧指令 vs `55ae01f`；能力边界；四合同逐字段状态 |
