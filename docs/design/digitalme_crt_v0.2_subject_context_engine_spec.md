# Digital Me CRT v0.2  
## Subject Context Engine 技术规格

| 项 | 值 |
|----|-----|
| 文档状态 | `frozen_for_implementation`（已获实现授权；工程完成 ≠ Owner accepted） |
| 版本 | v0.2.2 |
| 日期 | 2026-07-27 |
| 修订 | 吸收上位原则「主体连续性与未来开放」；标题去「草案」；清理过期 `design_draft` /「实现授权前编码」表述。**不改变** CRT-MVP-02 验收状态 |
| 前置 | CRT v0.1（`digitalme_cognitive_runtime_v0.1.md`）；CRT-MVP-01 / CRT-MVP-01.1（持续性读回已接通） |
| 产品依据 | `digitalme_subject_model_and_cognitive_algorithm_v0.1.md`（v0.1.1；状态 `owner_accepted` / `active_product_principle`；含「主体连续性与未来开放原则」） |
| 对齐原则 | `digitalme_subject_architecture_and_rd_principles_v0.1.md` §1–§3.1 |
| 范围 | **Subject Context Engine**：情境分类 → 按需装配 → 证据边界 → 归属边界 → 学习分类回流 |
| 明确排除 | Collaboration Runtime；对外授权网关；完整人格评分体系；复杂 ontology；大规模向量 RAG |

### 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2 | 2026-07-26 | Subject Context Engine 草案 |
| v0.2.1 | 2026-07-27 | Owner Review 吸收；`frozen_for_implementation`；CRT-MVP-02 授权实施 |
| v0.2.2 | 2026-07-27 | 同步上位产品原则「主体连续性与未来开放」；Claim Posture 作为该原则的工程表达之一；标题改为「技术规格」（去草案）；§10.2 改为防范围扩张。CRT-MVP-02 仍为 `ready_for_owner_runtime_acceptance`，不标 `accepted` / `implemented` |

---

## 0. 摘要

CRT-MVP-01 已证明：**主体可读、可注入、可溯源、可回流**。  
CRT v0.2 要解决的下一断点是：

> 系统已经能读到主体信息，但**不知道当前任务需要什么主体信息**；  
> 事实 / 判断 / 探索混用；学习写入后缺少分类；装配仍偏静态；  
> 任务附件与外部信息易与主体资产混淆。

**Subject Context Engine（主体情境引擎）** 是 CRT v0.2 的核心增量：在既有 `SubjectContextAssembler` 之上，增加**情境驱动的装配策略**、**证据边界**与**归属边界**，使「主体 + 情境 → 行动」可实现、可审计、可在 1–3 轮落地。

一句话：

> CRT v0.1/MVP：能带着「我」做事。  
> CRT v0.2：知道**这次任务需要哪一部分「我」**；标明**事实 / 判断 / 推演**；并分清**谁拥有这段信息**（主体 / 任务 / 外部 / AI）。

设计约束（强制保留）：

- 五类 `contextClass` 不变  
- 薄策略层挂在现有 Assembler 上，不重构架构  
- 不增加人格评分体系  
- 不引入复杂 ontology  
- 不扩展 Collaboration Runtime  

### 0.1 上位产品原则：主体连续性与未来开放

本规格的 Claim Posture、Evidence Boundary、Context Classification 与生成验收，均服从《主体模型与认知运行算法》**「主体连续性与未来开放原则」**（v0.1.1）。

**核心原则（不得弱化）：**

> Digital Me 的事实边界保护「我是谁、我做过什么、我确认什么」，  
> 但不限制 AI 帮助我推理未知、构造假设和发现新的可能性。

固化分工：

| 角色 | 职责 |
|------|------|
| 过去的我 | 提供连续性 |
| 当前的我 | 保有决定权 |
| AI | 扩展未来可能性 |

工程铁律：

> **无事实依据，不等于禁止生成。**  
> 无事实依据的内容：不得表述为已确认事实；不得表述为 Owner 已有判断；可以表述为 AI 推断、建议、创意或待验证假设。  
> 不要要求字字有来历、句句有出处。

主体资产用于维护：主体连续性、所有权、表达真实性、行动可追溯性。  
主体资产不得用于：把人冻结为历史数据集合、用既有 Memory 限制未来判断、禁止科学/商业/战略/创意中的新可能性。

---

## 1. 产品目标

### 1.1 在 Digital Me 中的定位

依据《主体模型与认知运行算法》：

- Digital Me 的核心不是「更聪明的通用 AI」，而是**持续逼近个人认知与行动规律的数字主体**。  
- 人的行为是 **主体 + 情境 → 行动**，不是静态人格标签 → 行动。  
- CRT 负责：判断任务需要什么主体信息、装配最相关上下文、控制事实/判断/探索边界、按反馈更新主体模型。

CRT v0.2 Subject Context Engine 是该原则的**第一版可执行算法规格**：

| 层级 | 职责 |
|------|------|
| 产品层 | 做事时更像本人；不把 AI 推测写成「我的观点」；不把附件写成「我的终身事实」 |
| 运行层 | 任务 → Context Class → Layer Policy → Assembly → Evidence + Ownership → Generation → Learn Classify |
| 工程层 | 薄策略层挂在现有 Assembler / GenerationContext / provenance / auto-learn 上 |

### 1.2 相对 CRT-MVP-01 的增量

| MVP-01 已具备 | v0.2 必须新增 |
|---------------|---------------|
| 读 Package / distill / memory | **按任务情境决定用哪些层、禁哪些信息** |
| 静态配额装配 | **Context-aware Assembly 策略表** |
| provenance 记录 refs | **Evidence Boundary + Ownership Boundary** |
| accept → memory 写入 | **学习结果分类；Judgment Candidate 逻辑态** |
| `emptyReason` / 不伪造主体 | 保持；策略不得伪造主体 |

### 1.3 成功时用户可感知什么

同一 Owner、不同任务类型时：

1. **代表表达**（如投资人介绍）：优先身份、经历、稳定偏好；判断框架可激活；探索层默认关闭或强标记。  
2. **开放探索**（如商业模式推演）：允许 AI 探索，但输出明确区分「本人已有判断」与「本次推演」。  
3. **接受成果后**：系统能把「新事实 / 新判断 / 表达偏好 / 决策模式」分到不同层，而不是一律塞进无差别 memory。  
4. **材料不污染主体**：本次附件与外部信息可追溯为任务/外部归属，不自动升格为主体资产。

### 1.4 非目标（本规格）

- 不实现完整人类认知模拟。  
- 不建立大量人格标签与复杂评分。  
- 不引入复杂 ontology。  
- 不扩展 Collaboration Runtime / 多主体协作。  
- 不要求 Owner 当训练员（分类由系统完成；仅高敏/冲突才打断）。  
- 不在 MVP 实现完整 Active Judgment 产品化（见 §7.2 Judgment Candidate）。

---

## 2. 核心算法：Context-driven Subject Modeling

### 2.1 算法陈述

```text
Task Context
    ↓
Context Classification（情境分类）
    ↓
Subject Assembly Policy（层启用 / 禁止 / 配额 / 探索许可）
    ↓
SubjectContextAssembler（检索 + 配额 + 渲染）
    ↓
Evidence Tagging + Ownership Tagging
    ↓
Generation Context → Prompt
    ↓
（接受后）Learning Classifier → 对应主体层写入
         （judgment 类 → Judgment Candidate，非 Active Judgment）
```

原则对齐产品规划：

1. **少变量，高表达力** — 分类枚举少；策略表可解释；不引入不可维护的多维人格分。  
2. **事实、判断、探索必须隔离** — 装配策略与证据标签双重约束。  
3. **持续学习，而不是一次训练** — 接受后分类回流，供下次按情境调用。  
4. **归属清晰** — 主体资产 / 任务材料 / 外部信息 / AI 生成不得混称。

### 2.2 Task Context 输入（最小）

来自现有 DVL2 Plan / Generation query，**不新增用户必填表单**：

| 字段 | 来源 | 用途 |
|------|------|------|
| `goal` | PlanVersion.understanding | 分类主信号 |
| `audience` | 同上 | representation / decision 加权 |
| `usage` | 同上 | 对外/对内；探索许可 |
| `constraints` | 同上 | 禁止项与边界 |
| `deliverableKind` | item.kind | creation / execution 加权 |
| `deliverableTitle` / `purpose` | item | 细分类辅助 |
| 附件关键词 | referenceMaterials 标题摘要 | 检索；evidence=`task_material`；ownership=`task_owned` |

可选（v0.2 后期）：`ownerHint`（显式「只陈述事实 / 允许推演」）— **MVP 不做 UI**，仅预留策略键。

### 2.3 Task Context 如何决定三件事

#### A. 使用哪些 Subject Layer

映射到现有 Assembler 八层（与 MVP-01 兼容；未实现层可为空）：

| 产品三层（规划） | 工程层（已有） | 说明 |
|------------------|----------------|------|
| Reality（事实） | `identity` / `knowledge` / `experience` / 部分 `memory` | 可验证、可追溯 |
| Cognition（认知） | `preference` / `judgment`；MVP 中 Judgment Candidate 存于 memory+`learnKind` | 本人如何理解与取舍 |
| Exploration（探索） | **不进入 Subject Active 伪装**；仅生成侧 `ai_inference` / `ai_exploration` 块 | 允许发散，禁止标成「我的观点」 |

策略输出形态：`enabledLayers[]` + `priorityLayers[]` + 每层 `topK` / `charBudget`。

#### B. 禁止哪些信息

策略可产生硬禁止（进入 `policy.forbidden`，Assembler 直接跳过）：

| 禁止类 | 触发情境示例 | 原因 |
|--------|--------------|------|
| 敏感身份细节外泄 | representation + 对外受众 + 无授权 | 隐私超披露 |
| 未确认候选资产冒充 Active | 任意默认生成 | Judgment Candidate ≠ Active Judgment；未确认不装成已确认 |
| 把探索结论写入 Subject 块 | exploration / creation | 防伪装成主体 |
| 任务附件升格为主体块 | 任意 | `task_owned` 不得写入 `subject_owned` 默认装配源 |
| 与本次材料冲突的旧「项目事实」 | 有强附件证据时 | 任务材料优先于旧 Knowledge（CRT v0.1 §2.3） |
| 全量 memory | 任意 | 保持配额；禁止无差别灌入 |

#### C. 如何控制事实 / 判断 / 探索

| 模式 | Reality | Cognition | Exploration |
|------|---------|-----------|-------------|
| `representation` | 高 | 中（表达偏好 + 适用判断） | **关**或极低且强标记 |
| `decision_support` | 中 | **高**（判断/决策模式优先） | 低；仅作选项对比且标记 AI |
| `exploration` | 低–中（锚点事实） | 中（已知立场作边界） | **开**；主体块与推演块分栏 |
| `creation` | 按需 | 偏好高 | 中；创意归 AI，人设归主体 |
| `execution` | 中（约束与能力边界） | 低–中（流程偏好） | 低 |

**与上位原则对齐（强制）：**

- `exploration` / `decision_support` / `creation`，以及科学研究、商业模式探索、战略推演、未知问题分析：**必须保留** AI 扩展能力；事实与判断只作锚点与边界，不得要求字字来自 Memory。  
- `representation`：**不是**完全禁止 AI 扩展。允许建议、分析、待验证方案；**禁止**把它们包装为已经发生的事实或 Owner 已确认立场。表中 Exploration「关」指默认不开启开放探索主体块，**不等于**禁止 `inferred` / `hypothetical` 主张姿态。

生成提示强制句式（用户面中性，工程侧约束）：

- 标为 `subject_fact` 的内容：可写成「根据已确认信息…」。  
- 标为 `subject_judgment` 的内容：可写成「按本人一贯取舍…」——**仅当来源为 Active Judgment 或 Owner 已确认等价资产**；Judgment Candidate 须降级表述（见 §7.2）。  
- 标为 `ai_inference` / `ai_exploration` 的内容：**不得**写成「我认为 / 我的结论是」（指 Owner），须标明为本次分析或推演。  
- 标为 `task_material` 的内容：作为**本次任务材料**，不得写成终身主体事实。

### 2.4 Claim Posture（主张姿态）

Claim Posture 是「主体连续性与未来开放原则」在生成侧的最小工程表达，服务 Evidence Boundary 与验收，**不是**独立 ontology。

| 姿态 | 语义 | 规则 |
|------|------|------|
| `confirmed` | 已确认事实或已确认主体判断 | 必须有 `subject_owned` / `task_material` 明确证据或可验证来源 |
| `attributed` | 来自本次任务材料或外部资料 | 可引用；不自动代表 Owner 或进入长期主体事实 |
| `inferred` | AI 基于现有材料的分析推断 | 不要求 Memory 已有出处；须用分析/可能等姿态表达 |
| `hypothetical` | 开放方案、未来情景、商业模式、技术路线等假设 | 允许大胆生成；须用可考虑/假设/待验证等姿态 |

**核心规则：** 没有来源的内容不得作为 `confirmed`；但可以作为 `inferred` 或 `hypothetical`。不要实现「每句话必须有出处」。

正式区分（与产品依据一致）：

1. 已确认主体事实  
2. 已形成主体判断  
3. AI 分析推断  
4. 面向未来的开放假设  

---

## 3. Context Classification

### 3.1 枚举（固定 5 类）

| `contextClass` | 中文 | 典型任务 | 主体侧重点 |
|----------------|------|----------|------------|
| `representation` | 代表用户表达 | 投资人介绍、对外简介、答辩陈述 | Identity / Experience / Preference；Judgment 适度 |
| `decision_support` | 辅助用户决策 | 方案对比、取舍建议、风险权衡 | Judgment / Decision Pattern / 相关 Experience |
| `exploration` | 开放探索 | 模式推演、假设讨论、研究方向 | 少量事实锚点 + 明确 AI 探索 |
| `creation` | 创作生成 | 文案、演示结构、网页表达 | Preference + 适用 Identity；创意空间给模型 |
| `execution` | 执行任务 | 按计划产出交付件、清单落地 | Constraints + Capability/流程记忆；少发挥 |

**默认类**：若信号不足 → **`execution`**。  

**原因（Owner Review）**：不确定情况下，Digital Me **不应主动创造用户主体表达**；应采用保守执行模式——按任务约束完成产出，少发挥、少代表、少探索。  

**不得**用「用户性格标签」替代 `contextClass`。

### 3.2 分类器（MVP：规则优先）

输入：Task Context 文本拼接。  
输出：

```text
ContextClassification {
  contextClass,          // 五选一
  confidence,            // high | medium | low
  signals[],             // 命中的短规则 id，便于审计
  secondaryClass | null  // 可选第二类；MVP 可只用主类
}
```

规则示例（实现时可配置，规格只定意图）：

| 信号 | 倾向 |
|------|------|
| audience 含 投资人/对外/官网/介绍；usage 含 对外发布 | `representation` |
| goal 含 对比/是否该/取舍/风险/决策 | `decision_support` |
| goal 含 探索/假设/可能性/推演/如果 | `exploration` |
| goal/usage 含 创作/文案/叙事风格 等强创作信号 | `creation` |
| goal 含 执行/完成清单/按计划产出；**或信号不足** | `execution` |

冲突时优先级（可解释、少变量）：

`decision_support` > `representation` > `exploration` > `creation` > `execution`

（有明确信号时优先匹配高意图类；**无信号时落在优先级最低的 `execution`，与默认类一致**。）

### 3.3 与产品「情境驱动」的关系

分类结果**不是**人格，而是**本次任务的情境标签**。  
同一 Owner：

- 创业融资材料 → `representation` + 相关 Judgment（若有 Active）  
- 家庭财务建议 → `decision_support` + 保守决策模式（若有）  
- 目标含糊的「做一份材料」→ `execution`（保守，不主动代表）

无需「用户 = 冒险型」全局标签。

---

## 4. Context-aware Assembly

### 4.1 流水线

```text
Task
  ↓
Context Classification
  ↓
Required Subject Layers（Assembly Policy）
  ↓
SubjectContextAssembler（现有；接收 policy 扩展入参）
  ↓
Evidence Tagging + Ownership Tagging + renderedText 分块
  ↓
Generation Context
  ↓
Prompt / provenance
```

### 4.2 Assembly Policy（最小表）

每个 `contextClass` 对应一张策略（字段少、可测）：

```text
AssemblyPolicy {
  contextClass,
  enabledLayers: string[],     // 子集 of 八层
  priorityLayers: string[],    // 预算优先保障
  layerTopK: { [layer]: number },
  forbidExplorationAsSubject: boolean,  // 恒 true 于 MVP
  allowAiExplorationBlock: boolean,
  maxSubjectChars: number,     // 可覆盖 Assembler 默认
  sensitivity: "strict" | "normal",
  includeTaskMaterials: boolean // MVP：true 时材料分账并打 task_material / task_owned
}
```

**建议默认（冻结语义下可微调数值，不可改语义）：**

| contextClass | enabled（优先） | allowAiExplorationBlock | sensitivity |
|--------------|-----------------|-------------------------|-------------|
| representation | identity, experience, preference, judgment, knowledge | false | strict |
| decision_support | judgment, experience, knowledge, preference, identity | true（仅选项对比） | normal |
| exploration | identity(少量), knowledge(锚点), judgment(边界), memory(少) | **true** | normal |
| creation | preference, identity, experience, judgment(少) | true | normal |
| execution | knowledge, memory, preference, identity(少) | false | normal |

未启用层：不检索或 `topK=0`，并在 provenance.policy 记 `skippedByContext`。

关于 Judgment 层（MVP）：

- Assembler 的 `judgment` 层可为空（尚无 Active Judgment 存储）。  
- 带 `learnKind=new_judgment|decision_pattern` 且逻辑态为 **Judgment Candidate** 的 memory：**不得**默认当作 Active Judgment 灌入「本人判断」硬约束块；至多进入「候选判断 / 待确认」低权块，或仅在 `decision_support` 下以降级措辞出现（见 §7.2）。

### 4.3 对 Assembler 的扩展方式（设计约束）

**不重构架构**：

- 保持 `assembleSubjectContext(input)` 为主入口。  
- v0.2 增加可选 `input.policy` / `input.contextClass`；缺省时行为 = MVP-01（向后兼容）。  
- 检索与配额逻辑仍在 Assembler 内；Engine 只产出 policy，不另造第二套装配器。  
- 任务附件仍走现有 referenceMaterials 分账；MVP **必须**为其打上 `evidenceKind=task_material` 与 `ownership=task_owned`。

### 4.4 Generation Context 挂载

在现有 `subjectAssembly` 旁增加（均可选，控制复杂度）：

| 字段 | 说明 |
|------|------|
| `contextClass` | 本次分类 |
| `contextClassification` | 含 confidence/signals（可精简） |
| `assemblyPolicyDigest` | 策略摘要哈希，便于复现 |

`renderedText` 建议分块标题（工程/审计用；用户面生成文案仍中性）：

1. 已确认主体事实（subject_fact / subject_owned）  
2. 本人判断与偏好（subject_judgment；仅 Active 或等价确认）  
3. 本次任务材料（task_material / task_owned）  
4. 外部信息（external_owned，若有）  
5. 本次分析与推演（ai_inference / ai_exploration / ai_generated）— 仅当 policy 允许  

---

## 5. Evidence Boundary

> Evidence Boundary 回答「这段内容从哪里来」。它保护主体连续性与可追溯性，**不得**被解释成「无证据则一律禁止生成」。无证据内容应降级为 `inferred` / `hypothetical`（见 §0.1、§2.4），而不是静默删除一切分析与假设。

### 5.1 内容来源标识（MVP 全量纳入）

| `evidenceKind` | 含义 | 可否写成「本人观点」 |
|----------------|------|----------------------|
| `subject_fact` | 来自已确认 Reality 资产（身份/经历/知识等） | 可作为本人已确认信息 |
| `subject_judgment` | 来自 Cognition（**Active** 判断/决策模式/稳定取舍偏好） | 可作为本人取舍框架 |
| `ai_inference` | 模型基于材料与主体做出的推导 | **否**；须标明分析 |
| `ai_exploration` | 开放可能性推演 | **否**；须标明探索 |
| `task_material` | 本次任务附件/计划约束 | **否（非主体观点）**；作为本次项目证据，**不升格为终身主体** |

**Owner Review 决议**：`task_material` **纳入 MVP**。  
原因：必须区分用户主体资产、本次任务材料、外部信息，避免附件污染主体。

### 5.2 追溯要求

生成结果必须满足：

1. **provenance 声称 ⊆ 实际进入 messages 的内容**（继承 CRT v0.1）。  
2. 每个注入片段在 refs 中带 `evidenceKind`（或由 layer/来源映射默认值）。  
3. 交付物审阅/调试视图可回答：「这句话依据的是主体事实、主体判断、任务材料，还是 AI 推演？」  
4. 禁止：探索块内容写入 `subjectRefs` 并伪装 `subject_fact`。  
5. 禁止：`task_material` 在学习回流时默认写入 Identity / 无 kind 的终身事实（须经 Learning Classifier；一次性项目措辞不写入或 session_only）。

### 5.3 默认映射（少规则）

| 来源 | 默认 evidenceKind |
|------|-------------------|
| identity, knowledge, experience（Active） | `subject_fact` |
| Active judgment；已确认取舍类 preference | `subject_judgment` |
| Judgment Candidate（memory+learnKind） | **不得**标为可硬约束的 `subject_judgment`；可标扩展态或降级为低权记忆证据（实现可选 `subject_judgment_candidate`，若求枚举更少则仍用 memory 引用 + ownership/状态字段区分） |
| referenceMaterials / 计划约束摘录 | `task_material` |
| 外部只读调研等（若接入） | 不进 subject_*；见 Ownership `external_owned` |
| 生成模型额外段落 | `ai_inference` 或 `ai_exploration`（由 contextClass 决定） |

> MVP 枚举保持 5 个 `evidenceKind`；Judgment Candidate 用 **逻辑状态** 区分，不为此新增人格/ontology 维度。

---

## 6. Ownership Boundary（主体归属边界）

### 6.1 定义

**Ownership Boundary** 回答：**这段信息「属于谁 / 归谁管」**，决定默认能否进入主体资产、能否代表本人说话。

| `ownership` | 含义 | 默认可否写入 Subject Active | 默认生成角色 |
|-------------|------|----------------------------|--------------|
| `subject_owned` | 属于数字主体（Owner 的主体资产） | 是（在生命周期规则内） | 可支撑「本人」表述 |
| `task_owned` | 仅属于本次任务（计划、附件、本次约束） | **否**（默认） | 本次项目证据 |
| `external_owned` | 外部来源（只读调研、第三方文档、公网摘录等） | **否** | 外部依据；须可追溯 |
| `ai_generated` | 本轮模型生成的分析/推演/措辞 | **否**（除非经 Learn 阀门升格） | 非本人观点 |

### 6.2 与 Evidence Boundary 的区别

| 维度 | Evidence Boundary | Ownership Boundary |
|------|-------------------|--------------------|
| 核心问题 | **这句话依据什么认知类型？**（事实 / 判断 / 推演 / 材料） | **这段信息归谁？**（主体 / 任务 / 外部 / AI） |
| 防的失败模式 | AI 推演伪装成「我的判断」；判断与事实混用 | 附件/外部/AI 输出污染主体资产；误代表本人 |
| 典型枚举 | `subject_fact`, `subject_judgment`, `task_material`, `ai_*` | `subject_owned`, `task_owned`, `external_owned`, `ai_generated` |
| 正交关系 | 同一 ownership 可有不同 evidence；同一 evidence 也可能对应不同 ownership（少见） | 与 evidence **同时打标**，不互相替代 |

**正交示例**：

| 内容 | evidenceKind | ownership |
|------|--------------|-----------|
| 已确认「我创办过 X 公司」 | `subject_fact` | `subject_owned` |
| 本次上传的融资 BP 摘录 | `task_material` | `task_owned` |
| 外部行业报告一句 | （可复用 task/external 证据口径；MVP 外部少时用 `task_material` 或单独 ref 类型） | `external_owned` |
| Active「对外材料先讲问题再讲方案」 | `subject_judgment` | `subject_owned` |
| 本轮模型提出的三种商业模式假设 | `ai_exploration` | `ai_generated` |
| Judgment Candidate 存于 memory | 降级判断证据 | 仍为 `subject_owned` **候选**，但逻辑态 ≠ Active |

### 6.3 MVP 强制规则

1. 注入 prompt 的附件块：`ownership=task_owned` + `evidenceKind=task_material`。  
2. 主体 distill / Active 资产：`ownership=subject_owned`。  
3. 模型自行发挥块：`ownership=ai_generated`。  
4. Learning Loop：**默认只允许**将合格观察升格为 `subject_owned` 候选/Active；`task_owned` / `external_owned` / `ai_generated` **不得**静默变成 Identity。  
5. provenance 应能同时回答 Evidence 与 Ownership（refs 上两字段；或等价可推导映射）。

### 6.4 不做

- 不引入多级权利 ontology、ACL 产品矩阵、跨账户协作所有权（Collaboration Runtime）。  
- 不在本阶段做链上确权 / DID 归属。

---

## 7. Learning Loop

### 7.1 触发

保持现有路径：**Owner 接受 DeliverableVersion → auto-learn**。  
v0.2 增量在 **classify**：写入前判定学习种类与逻辑状态，再进入对应载体。

### 7.2 学习种类（四类）与 Judgment Candidate

| `learnKind` | 含义 | MVP 载体 | 逻辑状态 |
|-------------|------|----------|----------|
| `new_fact` | 可复核的新事实 | memory（或 Knowledge 映射）+ `learnKind=new_fact` | 低置信 Active 或候选事实（沿用 active_low 策略） |
| `new_judgment` | 可复用取舍规则（需 situation 线索） | **memory + `learnKind=new_judgment`** | **`Judgment Candidate`** |
| `expression_preference` | 表达/结构/语气偏好 | memory + `learnKind=expression_preference`（或 Preference 映射） | 偏好候选 / active_low |
| `decision_pattern` | 跨情境决策倾向 | memory + `learnKind=decision_pattern` | **`Judgment Candidate`**（决策模式类） |

#### Judgment Candidate（Owner Review 决议）

- **MVP 实现方式**：保留 **memory + `learnKind`** 作为判断类学习的物理承载。  
- **逻辑状态**：`Judgment Candidate`（判断候选）。  
- **明确不等式**：

> **memory 承载 Judgment Candidate ≠ Active Judgment。**

| | Judgment Candidate | Active Judgment |
|--|--------------------|-----------------|
| 存储（MVP） | memory jsonl + learnKind | 尚无独立 Active Judgment Store（后续 Phase） |
| 可否硬约束生成 | **否**（默认） | 是（在授权与合法范围内） |
| provenance / 渲染 | 降级：「待确认的取舍线索」 | 「本人判断框架（须遵守）」 |
| 升格 | 需后续 Gate / 稳定复现 / 或 Owner 冲突决议；**本 MVP 不实现完整升格产品化** | — |

**明确不做（本阶段）**：

- 自动把 Judgment Candidate 写成 Active Judgment；  
- 自动改写 Identity 高敏字段；  
- 自动升格为终身价值观而不经冲突策略；  
- 因 Candidate 存在而宣称「已具备完整 Judgment 系统」。

### 7.3 判定启发式（少变量）

对接受成果 + 任务上下文抽取候选句后：

| 信号 | learnKind |
|------|-----------|
| 含可核验经历/数据/角色陈述，且 Owner 已接受 | `new_fact` |
| 含「应该先…再…」「优先…而非…」「在…情况下选…」 | `new_judgment` → Judgment Candidate |
| 含文风、篇幅、结构、受众口吻偏好 | `expression_preference` |
| 多次同类任务出现相同取舍（≥N 次，N 可先=2） | `decision_pattern` → Judgment Candidate |
| 明显来自 `task_owned` / 一次性项目措辞 | **不写入**或 session_only（沿用 Gate 思想） |
| 明显 `ai_generated` 且无 Owner 接受背书以外的稳定信号 | **不写入**主体，或仅审计 |

冲突/敏感：沿用 CRT-MVP「默认 active_low；明显矛盾才打断」——**不新增训练员流程**。  
对 Judgment Candidate：允许写入 memory，但装配策略必须保持「非 Active」。

### 7.4 闭环检验

```text
接受 → learnKind 分类写入
  → judgment 类标记 Judgment Candidate（非 Active）
  → 下次同 contextClass 装配（Candidate 降级或不作硬约束）
  → provenance / prompt 出现 UNIQUE 学习标记（事实/偏好类）
```

若一律写入无 kind 的 memory，或将 Judgment Candidate 当作 Active Judgment 硬约束，则 Learning Loop **未达标**。

---

## 8. 数据结构

> 控制复杂度：只新增薄对象；不修改 SubjectContextAssembler 的 layers schema 形状；不修改 Memory 物理 schema 的破坏性变更（仅可增加可选字段）。

### 8.1 ContextClassification

```text
{
  schemaVersion: 1,
  contextClass: "representation" | "decision_support" | "exploration" | "creation" | "execution",
  confidence: "high" | "medium" | "low",
  signals: string[]          // 短 id，如 "audience:external"；无信号时含 "default:execution"
}
```

### 8.2 AssemblyPolicy（见 §4.2）

### 8.3 EvidenceRef / OwnershipRef（扩展现有 ref，字段极少）

```text
{
  ...existingRefFields,
  evidenceKind: "subject_fact" | "subject_judgment" | "ai_inference" | "ai_exploration" | "task_material",
  ownership: "subject_owned" | "task_owned" | "external_owned" | "ai_generated",
  logicalState: "active" | "judgment_candidate" | "session_only" | null
}
```

- `logicalState=judgment_candidate`：仅用于 judgment/decision 类 memory 回流。  
- `logicalState` 缺省：按来源推导（Active 资产 → `active`）。

### 8.4 LearningRecord 增量（可选字段）

auto-learn 写入 memory 行时增加：

```text
{
  learnKind: "new_fact" | "new_judgment" | "expression_preference" | "decision_pattern",
  logicalState: "active_low" | "judgment_candidate" | "session_only",
  ownership: "subject_owned",   // 学习升格目标；写入前已过滤 task/external/ai
  sourceDeliverableVersionId: string,
  contextClassAtLearn: string | null
}
```

不新增独立数据库；PackageStore Change Set 审计可记录 `learnKind` / `logicalState`。

### 8.5 SubjectAssembly 增量（可选，向后兼容）

```text
{
  ...existingAssembly,
  contextClass: string | null,
  evidenceSummary: {
    subjectFactCount: number,
    subjectJudgmentCount: number,      // 仅 Active 口径
    judgmentCandidateCount: number,    // 非 Active
    taskMaterialCount: number,
    aiBlockEnabled: boolean
  },
  ownershipSummary: {
    subjectOwnedCount: number,
    taskOwnedCount: number,
    externalOwnedCount: number,
    aiGeneratedCount: number
  }
}
```

**禁止**：为 v0.2 引入大型评分卡、人格向量、多级 ontology。

---

## 9. 与现有代码映射

| 现有模块 | v0.2 连接方式 | 改动性质 |
|----------|---------------|----------|
| **`subject-context-assembler.js`** | 接收 `contextClass` / `policy`；按 enabledLayers 与 topK 过滤；refs 打 `evidenceKind` + `ownership`；Candidate 降级 | 扩展入参与过滤；**不改 layers schema** |
| **`deliverable-context.js` `buildGenerationContext`** | 挂载 `contextClass`、assembly、evidence/ownership 摘要；附件标 task_* | 薄扩展 |
| **`deliverable-generation.js` `generateOneDeliverable`** | 生成前：Classify → Policy → `assembleSubjectContext`；保留 `packageDir` 贯通（CRT-MVP-01.1） | 调用顺序扩展 |
| **`deliverable-generators.js` `contextBlock`** | 按 evidence + ownership 分块渲染；探索块单独约束句 | 提示拼装 |
| **provenance（DeliverableVersion）** | 保留 assemblyId / subjectRefs / memoryRefs；增 evidenceKind、ownership、logicalState、contextClass | 扩展字段 |
| **`deliverable-auto-learn.js`** | extract 后 learnKind + Judgment Candidate；过滤 task/external/ai 污染；仍经 PackageStore | **不重做**学习引擎 |
| **PackageStore** | 继续作为写入与 Change Set 权威；不新造写通道 | 复用 |
| **distillMe** | 仍为 Identity/Experience/Fact 主读源（subject_owned） | 只读适配不变 |
| **Judgment 完整 Activation** | 规格在 CRT v0.1 §8；本 v0.2 MVP = **Judgment Candidate（memory+kind）**，非 Active Judgment | 明确降级 |
| **Collaboration Runtime** | **不连接** | 禁止扩范围 |

### 9.1 建议模块边界（新文件，设计级）

```text
subject-context-engine.js
  classifyTaskContext(taskContext) → ContextClassification
  resolveAssemblyPolicy(classification) → AssemblyPolicy
  tagEvidenceAndOwnership(assembly, materials) → assembly'

（调用方仍是 generateOneDeliverable）
```

不替换 Assembler；Engine = 策略层。

### 9.2 权威优先级（冲突时，继承并细化）

1. 任务约束与授权边界  
2. 本 contextClass 的 AssemblyPolicy 禁止项  
3. Active Identity / **Active** Judgment（不含 Candidate）  
4. 本次参考材料（`task_owned` / `task_material`）  
5. Active Knowledge / Experience / Preference  
6. Memory（按 learnKind；Judgment Candidate 降级）  
7. 外部信息（`external_owned`）  
8. 模型通用能力（`ai_generated` 探索/推理块单独标记）

---

## 10. MVP 范围（1–3 轮可完成）

### 10.1 做

| 轮次（建议） | 交付 |
|--------------|------|
| **R1** | `classifyTaskContext`（默认 `execution`）+ 固定 5 类规则；`resolveAssemblyPolicy`；Assembler 按 enabledLayers 过滤；provenance 记 `contextClass` |
| **R2** | refs / 渲染块：`evidenceKind`（含 **`task_material`**）+ `ownership`；generators 分块；禁止探索伪装主体、禁止附件污染主体块 |
| **R3** | auto-learn `learnKind` 四分类；**Judgment Candidate**（memory+kind，≠ Active）；下次装配降级读回；UNIQUE token 分情境回归 |

### 10.2 不做

| 不做 | 原因 |
|------|------|
| Collaboration Runtime / 多账户协作 | 范围禁止 |
| 完整 Active Judgment / Judgment Activation 产品化 | 本阶段仅 Judgment Candidate |
| Subject Version / Snapshot 产品化 | CRT 后续 Phase |
| 向量检索 / 新存储引擎 | 规则 + 现有 jsonl/distill 足够 |
| Owner 标注 UI / 训练流水线 | 违背「用户不是训练员」 |
| 人格评分体系 / 复杂 ontology | Owner Review 禁止 |
| 修改 SubjectContextAssembler layers schema、Memory 破坏性 schema | 任务约束 |
| 扩大到研究/写作独立场景主线 | 仍挂 DVL2 generation |
| 未经新的范围授权扩大实现 | 防止超出冻结规格继续扩张 |

### 10.3 复杂度预算

- 新增用户可见设置：**0**（分类自动）。  
- 新增核心枚举：contextClass **5** + evidenceKind **5**（含 task_material）+ ownership **4** + learnKind **4** + 逻辑态少量。  
- 新增必测路径：≤ 2 个主入口（生成前分类装配；接受后学习分类）。  
- 架构：薄策略层；不第二套装配器。

---

## 11. 验收标准

> 工程测试通过 ≠ Owner 真机 accepted。本规格验收分**可自动化**与**真机**两级；均不得在未经 Owner 确认时标记 `accepted`。

### 11.1 自动化（实现后必须）

| ID | 场景 | 期望 |
|----|------|------|
| C0 | 信号不足 / 含糊目标 | `contextClass === "execution"` |
| C1 | 目标含「对外介绍 / 投资人」等 | `contextClass === "representation"`；exploration 主体块不出现或空 |
| C2 | 目标含「对比方案 / 是否该」 | `contextClass === "decision_support"`；Active 判断/经历优先于无关 memory |
| C3 | 目标含「探索可能性」 | `allowAiExplorationBlock === true`；推演 `evidenceKind` ∈ ai_* 且 `ownership=ai_generated`；不进入 subject_fact |
| C4 | 无 packageDir | 仍 `emptyReason === "no_package"`；不伪造主体（回归 CRT-MVP-01.1） |
| C5 | 有主体资产 + representation | provenance.`contextClass` 有值；`subjectRefs` 含 `evidenceKind`；`emptyReason !== "no_package"` |
| C6 | 有参考附件的生成 | 附件相关 ref：`evidenceKind=task_material` 且 `ownership=task_owned`；不得标 `subject_owned` |
| L1 | 接受含 UNIQUE_FACT 的成果 | 写入 `learnKind === "new_fact"` |
| L2 | 接受含「优先 A 而非 B」结构 | `learnKind === "new_judgment"` 或 `decision_pattern`，且 `logicalState=judgment_candidate` |
| L2b | 装配含 Judgment Candidate | **不得**进入 Active Judgment 硬约束块 |
| L3 | 再次同情境生成 | prompt/provenance 出现 UNIQUE 学习标记（非 Candidate 伪装 Active） |
| R1 | DVL2-03 one-click / CRT continuity | 既有回归仍绿 |
| P0 | 无事实依据的分析/假设（带姿态） | **允许生成**；不得标为 confirmed / Owner 已有判断 |
| P1 | representation 无依据「已拥有 N 名用户」等 | 拦截高风险事实型断言 |
| P2 | representation「可探索 / 可考虑 / 待验证」方案 | **保留**；不得误删 |

### 11.2 Owner 真机（实现授权且工程通过后）

1. 配置有效 Digital Me Package。  
2. 含糊目标生成：表现为稳健执行，而非主动「代表我创作立场」。  
3. 做事 → 生成「对外介绍」类成果：可见更像本人的身份/经历，而非无关记忆堆砌。  
4. 做事 → 生成「开放探索」类成果：能区分本人已有立场、任务材料与本次推演；**允许** memory 中不存在的新可能性（标明假设/分析）。  
5. 带附件生成：附件内容不被当成「我一直如此」的主体事实。  
6. 接受一次含判断结构的成果后：可查到 Judgment Candidate，且再生成不把它当成已确认终身判断硬套。  
7. **不**将状态标为 Owner accepted，除非 Owner 显式确认。

### 11.3 失败判定（任一即未过）

- 分类在无信号时仍偏向 `creation` / `representation` / `exploration`。  
- 策略表未改变装配结果，或分类恒为同一 class（除故意默认）。  
- AI 探索内容进入 `subject_fact` 或用户可见「我的观点」伪装。  
- 附件以 `subject_owned` 进入主体块或学习污染 Identity。  
- Judgment Candidate 被当作 Active Judgment。  
- 学习写入无 `learnKind` 且无法在再生成中按情境区分。  
- 为通过测试伪造 package / 主体资产。  
- **将「无事实依据」错误执行成全面禁止 AI 推断、假设与创意**（违反主体连续性与未来开放原则）。  
- representation 误删已明确标为假设/建议/待验证的方案表述。

---

## 12. 状态与下一步

| 项 | 值 |
|----|-----|
| 当前文档状态 | `frozen_for_implementation` |
| 实现任务 | CRT-MVP-02 Subject Context Engine（含后续最小修正如附件对齐 / Claim Posture） |
| 验收状态 | **保持** `ready_for_owner_runtime_acceptance`；未经 Owner 真机确认不得 `accepted`；本修订**不**标 `implemented` / `owner_runtime_accepted` |
| Owner Review | 已吸收：默认 `execution`；Judgment Candidate；`task_material` MVP；Ownership Boundary；**主体连续性与未来开放原则** |

### 已拍板（不再待决）

1. 信号不足默认类 = **`execution`**（保守，不主动创造主体表达）。  
2. Judgment MVP = **memory + learnKind**，逻辑态 **Judgment Candidate**；**≠ Active Judgment**。  
3. **`task_material` 纳入 MVP evidenceKind**；并以 Ownership Boundary 与主体资产隔离。  
4. **无事实依据 ≠ 禁止生成**；无依据内容不得 confirmed / 冒充 Owner 判断，可为 inferred / hypothetical。

---

## 13. 参考

- `digitalme_subject_model_and_cognitive_algorithm_v0.1.md`（v0.1.1；`owner_accepted` / `active_product_principle`；主体连续性与未来开放原则）  
- `digitalme_cognitive_runtime_v0.1.md`  
- `digitalme_phase1_task_CRT-MVP-01_cognitive_runtime_continuity_v0.1.md`  
- CRT-MVP-01.1：`packageDir` 生产贯通修复（`confirmPlanAndGenerate` → Assembler）

---

**文档结束**
