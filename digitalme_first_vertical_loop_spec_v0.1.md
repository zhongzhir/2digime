# Digital Me 第一纵向闭环规格（研究与表达）

版本：v0.1.1
日期：2026-07-25
状态：`spec_frozen` / **实施规格已冻结**（**不是**实现完成，**不是** Owner 验收通过）
所属执行计划：[`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)（**唯一当前计划**）
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)

> 本文冻结第一纵向闭环的产品结果、主流程、四合同、能力方案、`55ae01f` 复用裁定与验收标准。
> **下一项才是代码实现**；本文不得被解读为已交付可用闭环。

---

## 0. 本规格回答的十个核心问题（摘要）

| # | 问题 | 冻结答案 |
|---|------|----------|
| 1 | 要证明什么？ | Digital Me 能代表 Owner 完成**一项**研究与表达任务，且结果可核对、可纠正、可回流。 |
| 2 | Owner 从哪进入、看到什么？ | 工作台入口「研究与表达」→ 填写目标 → 确认 Subject Context → 执行（Skill + 只读外搜）→ 四栏证据 + 成果 → 采用/修改/否定 → 可选 Experience Proposal 确认 → 重启可恢复 → 相似任务对照。 |
| 3 | `55ae01f`？ | 入口/任务持久化/模型调用等**调整后复用**；固定比例摘录与「模型自述即证据」**不采用**；Skill/外搜/Proposal **本闭环缺失待实现**。见 §6。 |
| 4 | Subject Context 如何选？ | 候选来自 Package；按 Task Intent 做相关性排序 + 用户确认编辑；**不是**当前 `buildSelectedSelfContext` 固定比例截取。见 §3。 |
| 5 | 证据如何区分？ | 系统记录的本人快照 / 外搜调用结果与来源 / 标明的新推断 / 可编辑成果；模型自述不得作唯一审计依据。见 §4。 |
| 6 | Skill 如何改变方法？ | 选定 `psk_preset_general_research`：注入其 `systemHint`、按 `steps` 推进研究步骤、并准备其 `recommendedExtensions`；须有 Capability Invocation 证明方法差异。见 §5。 |
| 7 | 外部信息接口？ | `research/web-search.js` 的 `searchWeb`（经 `research:discoverSources`）；无 Key 时 DuckDuckGo 内置兜底；只读。见 §5。 |
| 8 | 修正如何成 Proposal？ | 用户对成果/本人信息的纠正生成 Experience Proposal（对齐 `feedback:preview` 形态）；默认不写 Package。见 §7。 |
| 9 | 何时更新主体？ | 仅当用户对 Proposal **明确确认**后，经 `feedback:apply` 同类路径写入；推测永不自动升格为已确认事实。见 §7。 |
| 10 | 下次如何证明变化？ | 相似任务重新装配 Subject Context 时须包含已确认条目；Owner 对照验收用例验证。见 §8。 |

---

## 1. 要证明的产品结果（单场景冻结）

### 1.1 一句话

> **Digital Me 代表 Owner 完成一项研究与表达任务。**

### 1.2 完整示例（本闭环唯一场景）

> 研究一个与 Owner 项目或投资判断相关的现实问题，并形成一份符合 Owner 事实、判断框架、表达风格和行为边界的可编辑成果。

示例任务标题（验收可用）：「评估某公开市场事件对本人当前关注方向的含义，并起草一份可对外微调的判断短文」。

**本任务不得扩展到第二个场景。**

### 1.3 用户面入口（冻结）

| 项 | 冻结值 |
|----|--------|
| 入口位置 | 经典 renderer **任务工作台** |
| 入口名称 | **研究与表达**（用户面文案；内部可映射 act-behalf / research 装配层） |
| 状态标签 | 实现完成并经 Owner 验收前标 **「预览」** 或 **「实验」**；不得标「可用」 |
| 明确不做入口 | 不新建第二套工作台；不启动 R3 迁移；不按旧 DM-Core-01A **指令**扩 scope |

---

## 2. Owner 主流程（逐步冻结）

```text
1. 打开工作台 → 点「研究与表达」
2. 输入：任务标题 + 研究与表达目标（Task Intent.goal）
3. 系统展示 Subject Context 候选（带 sourceRefs）→ Owner 确认 / 删除 / 补充
4. 系统激活 Skill「通用调研」并展示将采用的方法步骤
5. 执行：按 Skill 方法推进；调用只读外搜获取外部事实
6. 展示证据区分区 + 最终可编辑成果
7. Owner：采用 / 修改成果 / 否定
8. 若有可回流修正 → 生成 Experience Proposal → Owner 确认或拒绝
9. 重启应用 → 任务、依据、成果、决定仍在
10. 发起相似任务 → 已确认变化出现在新 Subject Context 中
```

### 2.1 输入字段（冻结）

| 字段（用户面） | 对应合同 | 必填 |
|----------------|----------|------|
| 任务标题 | Task Intent（展示用） | 否（可从目标截取） |
| 研究与表达目标 | `Task Intent.goal` | 是 |
| 本次角色说明（可选） | `Task Intent.role` | 否；缺省 =「代表本人做研究与表达」 |
| 期望成果形态（可选） | `Task Intent.expectedOutcome` | 否；缺省 =「可编辑短文/纪要」 |
| Subject Context 编辑区 | Subject Context 确认 | 是（可空包时须手补） |

### 2.2 界面区块（冻结）

1. **目标区**：标题 + 目标
2. **本人信息确认区**：候选列表（可勾选/删除）+ 补充框；文案必须说明「以下为系统根据本次目标选出的候选，请确认后再提交」
3. **方法区**：展示 Skill「通用调研」及其步骤（澄清→检索→读源→撰写）
4. **执行与进度**：失败时可见原因，不得显示成功
5. **证据区分区**（四栏，见 §4）
6. **成果区**：可编辑正文
7. **处置区**：采用 / 保存修改 / 否定；可选「将本次纠正写入我的资料（需再确认）」
8. **任务列表**：草稿与已完成；支持重新打开（重启恢复）

---

## 3. Subject Context：任务相关装配（纠正误差 ①）

### 3.1 对现状的准确表述（强制）

当前 `buildSelectedSelfContext()`（`src/act-behalf/select-self-context.js`）：

- **是**：从主体资料中按**固定比例预算**截取的有界初始摘录；
- **不是**：按 Task Intent 做相关性选择。

其 UI note 中「与当前任务相关」**表述不准确**，规格与实现均不得再如此宣称。

正确产品表述：

> **从主体资料中生成的有界初始摘录，由用户在任务提交前确认或编辑。**

第一闭环实现必须升级为 §3.2 的**任务相关装配**；在升级前，用户确认编辑是相关性的唯一权威来源。

### 3.2 冻结的装配流程

| 步骤 | 行为 |
|------|------|
| A. 候选来源 | `package:load` 形状字段：`persona`、`lifeSummary`、`styleGuide`、`boundariesSummary`、`longTermMemory`、`decisionFrameworks`；可选辅以本地 `retrieval.retrieve(pkgDir, goal)`（只读 Package 内检索，**不**算外部信息能力） |
| B. 相关性 | 以 `Task Intent.goal`（及可选 role）为查询：对候选块做检索打分 / 关键词与主题重叠排序；取 top-N 且总字符受预算约束（可沿用 ~5500 量级） |
| C. 用户确认 | 展示每条候选的 `label` + 摘要 + `sourceRefs`；允许删除、勾选、自由补充文本 |
| D. 最终快照 | 确认后写入任务的 Subject Context 合同对象（见 §5.1）；执行时**仅**使用该快照 |
| E. sourceRefs | 每条 claim 至少保留 `source`（如 `persona.md` / `memory/long-term-memory.jsonl`）与可选片段定位；补充文本标 `source: user_supplement`、`confirmationState: confirmed` |
| F. 未确认推测 | 模型新推断、外搜摘要、系统猜测 **不得**写入 Subject Context 的已确认 claims；只能进结果栏或 Experience Proposal |

### 3.3 审计原则（纠正误差 ②）

| 错误做法 | 正确做法 |
|----------|----------|
| 把模型输出栏「使用的本人信息」当作系统实际使用了什么的唯一证据 | **系统记录**实际输入模型的 Subject Context 快照（`disclosedContext` / claims） |
| 把 prompt 正文或页面 textarea 直接等同正式合同 | 合同对象单独结构化保存；UI/prompt 为投影 |
| 无来源的「本人观点」 | 引用本人观点须能回到 Subject Context 条目或 sourceRefs |

模型仍可输出「使用的本人信息」作可读摘要，但界面须标注：**「模型整理，供参考；系统实际采用以确认快照为准」**。

### 3.4 校准 vs 限制原则（VL1-FIX 冻结）

数字之我不限制 AI 通用能力上限。§3 此前规则以本校准原则为前提重读。数字之我通过以下六类校准维度介入 AI 生成：

1. **方向**：本人已声明的研究与判断方向
2. **真实性**：本人已确认的事实与观点（注入见 Subject Context）
3. **风格**：本人已声明的表达偏好
4. **价值观**：本人已声明的立场与禁忌
5. **安全**：本人已声明的禁区（医疗确定性建议、法律确定性建议、对外承诺等）
6. **边界**：本人已声明的禁止用途

AI 通用能力**完整保留**。三类来源显式区分：

- 本人事实（claimId 引用）
- 外部事实（resultRef 引用）
- 通用推理（无引用，uncertainty ≥ medium）

缺原料时：不得限制 AI 输出，不得让用户补料。用通用知识答，显式标注来源。

---

## 4. 证据区分方案（冻结）

界面固定四栏（用户面中性文案）：

| 栏 | 内容 | 证据来源（系统侧） |
|----|------|-------------------|
| **本人已有事实或观点** | 仅来自已确认 Subject Context | Subject Context claims（`confirmationState` ∈ confirmed / user_edited） |
| **外部事实及来源** | 外搜得到的标题、摘要、URL 等 | Capability Invocation（`kind: tool`）的 `resultRefs`；禁止无 URL/提供方的「外部事实」 |
| **Digital Me 的新推断** | 本轮推理、综合、建议 | 模型产出；须能指向所依据的本人条目 id 与/或外部 resultRef；依据不足须写明不确定 |
| **最终可编辑成果** | Owner 可改的正文 | 初始由模型生成；Owner 编辑后以任务保存为准 |

**禁止**：把外部事实写入「本人」栏；把未确认推测写入 Package；把模型自述当作外搜证据。

---

## 5. 四个最小合同（字段级冻结）

状态枚举：`已实现` · `部分实现` · `候选设计` · `缺失`。
「已实现」仅指仓库中已有**等价读写**，不等于合同已接线到本闭环主路径。

### 5.1 Subject Context

| 字段 | 最小类型 | 语义 | 现有对应 | 状态 | 本闭环必需 | 保存/所有者 | 创建·修改·确认 |
|------|----------|------|----------|------|------------|-------------|---------------|
| `subjectId` | `string` | 本地稳定主体 id | Package `manifest` / 路径；尚无跨设备 id | 缺失→实现时最小本地 id | 是 | 任务快照复制；权威在 Package | 系统创建；用户不改 |
| `subjectVersion` | `string` | 装配时 Package 版本锚 | PackageStore revision / digest | 部分实现（库有、任务未挂） | 是 | 任务快照 | 系统写入 |
| `claims` | `{ id, kind, text, sourceRefs[], confirmationState }[]` | 本次允许使用的本人条目；`kind`: fact\|opinion\|preference\|style\|boundary\|other | Package 各文件文本；act-behalf `items[]` 为粗糙投影 | 部分实现 | 是 | 任务内快照 | 系统提案；**用户确认/删改** |
| `sourceRefs` | `{ source, locator? }[]`（可嵌在 claim 内） | 可回到 Package 路径或用户补充标记 | `items[].source` 粗标签 | 部分实现 | 是 | 随 claim | 系统；用户补充标 `user_supplement` |
| `confidence` | `high\|medium\|low\|unknown`（可选/条目级） | 条目置信 | Builder/memory 局部有 | 候选设计 | 否（缺则显示不确定） | 随 claim | 系统建议 |
| `confirmationState` | `proposed\|confirmed\|user_edited\|rejected` | 是否经用户确认 | 仅有 `userEdited` 布尔 | 部分实现 | 是 | 随 claim / 快照 | **用户**确认 |
| `scope` | `string` | 本次使用范围说明 | 字符预算裁剪，无正式字段 | 部分实现 | 是 | 任务快照 | 系统生成；用户可改说明 |
| `prohibitedUses` | `string[]` | 本次禁止用途 | `boundariesSummary` 文本 | 部分实现 | 是（可从边界摘要映射） | 任务快照 | 系统从边界装入；用户可加严 |

### 5.2 Task Intent

| 字段 | 最小类型 | 语义 | 现有对应 | 状态 | 本闭环必需 | 保存/所有者 | 创建·修改·确认 |
|------|----------|------|----------|------|------------|-------------|---------------|
| `taskId` | `string` | 任务 id | act-behalf `abt_*` | 已实现 | 是 | `act-behalf-tasks.json`（或后继同职责文件） | 系统 |
| `goal` | `string` | 研究与表达目标 | `request` 自由文本 | 部分实现 | 是 | 任务 | 用户 |
| `role` | `string` | 本次代表角色 | 无 | 缺失 | 是（可有缺省） | 任务 | 用户/缺省 |
| `expectedOutcome` | `string` | 期望成果形态 | 无 | 缺失 | 是（可有缺省） | 任务 | 用户/缺省 |
| `constraints` | `string[]` | 额外约束 | 无结构化 | 缺失 | 否 | 任务 | 用户 |
| `riskLevel` | `low\|medium\|high` | 本闭环固定 `low` | 无 | 缺失 | 是（常量 low） | 任务 | 系统 |
| `approvalPolicy` | `object` | 本闭环：禁止对外发送；写 Package 须二次确认 | `authorization: null` 预留 | 候选设计 | 是（最小策略常量） | 任务 | 系统 |

### 5.3 Capability Invocation

| 字段 | 最小类型 | 语义 | 现有对应 | 状态 | 本闭环必需 | 保存/所有者 | 创建·修改·确认 |
|------|----------|------|----------|------|------------|-------------|---------------|
| `capabilityId` | `string` | 能力 id | `capabilityRefs: []` 空预留；skills / extensions id 存在于他处 | 缺失（本路径） | 是 | 任务 `invocations[]` | 系统 |
| `kind` | `skill\|tool\|agent` | 类型 | 无 | 缺失 | 是 | 同上 | 系统 |
| `provider` | `string` | 提供方 | `modelMeta.model`；web-search `provider` | 部分实现 | 是 | 同上 | 系统 |
| `inputs` | `object` | 调用输入摘要 | 散落在 prompt | 部分实现 | 是 | 同上 | 系统 |
| `disclosedContext` | `object` | 本次向该能力披露的 Subject Context 子集引用 | `selectedSelfContext` | 部分实现 | 是 | 同上 | 系统 |
| `permissions` | `string[]` | 权限边界 | 扩展连接态 | 候选设计 | 是（只读外搜写死） | 同上 | 系统 |
| `resultRefs` | `{ title?, url?, snippet?, provider? }[]` | 结果引用 | research sources；act-behalf 无 | 部分实现（研究侧） | 是（外搜） | 同上 | 系统 |
| `status` | `pending\|ok\|failed\|skipped` | 调用状态 | 任务级 status 仅部分重叠 | 部分实现 | 是 | 同上 | 系统 |

本闭环**至少**两条 invocation：① `kind:skill` 通用调研；② `kind:tool` 只读外搜。`kind:agent` **不实现**。

### 5.4 Experience Proposal

| 字段 | 最小类型 | 语义 | 现有对应 | 状态 | 本闭环必需 | 保存/所有者 | 创建·修改·确认 |
|------|----------|------|----------|------|------------|-------------|---------------|
| `proposalId` | `string` | 提案 id | 无；接近 feedback changeSetId | 候选设计 | 是 | 任务内或并行 proposals 存储 | 系统创建 |
| `derivedFrom` | `{ taskId, resultSection? }` | 来源任务 | 无 | 缺失 | 是 | proposal | 系统 |
| `proposedChange` | `object` | 拟写入内容与目标文件类别 | `feedback.buildWritePlan` | 候选设计 | 是 | proposal | 系统提案；用户可改文案 |
| `targetScope` | `style\|memory\|persona\|boundary` | 作用域 | feedback categories | 候选设计 | 是 | proposal | 系统分类；用户可改类 |
| `evidence` | `string` | 依据摘要 | feedback 上下文 | 候选设计 | 是 | proposal | 系统 |
| `userDecision` | `pending\|accepted\|rejected` | 用户决定 | feedback 须 confirmed | 候选设计 | 是 | proposal | **用户** |
| `appliedVersion` | `string\|null` | 写入后的 subjectVersion | PackageStore revision | 候选设计 | 是（接受后填写） | proposal | 系统在 apply 后写 |

**默认**：一切模型推测与外搜结论 → 最多进入成果/推断栏或 proposal；**不得**自动成为已确认本人事实/观点/偏好/边界。

---

## 6. 对提交 `55ae01f` 的逐项复用裁定

提交：`55ae01fd089a232200d90191fa788da5153d88e8`
状态仍为：**`retained_for_mapping_review`**（本规格完成逐项裁定；**实现阶段**才按表改代码；**本任务不改代码**）。

| 组件 | 裁定 | 说明 |
|------|------|------|
| 工作台入口「代表我完成任务」 | **需要调整后复用** | 用户面更名为「研究与表达」；保留工作台卡片模式 |
| 任务列表 | **直接复用** | list/get UI 与 IPC 模式可保留 |
| 草稿和执行 | **需要调整后复用** | 保留 draft→run→completed；run 须接入 Skill + 外搜 + 新证据栏 |
| 重启恢复 | **直接复用** | `act-behalf-tasks.json` 原子写模式保留（可演进字段） |
| 本人信息摘录 `buildSelectedSelfContext` | **暂不采用**（逻辑） | 固定比例截取保留为「无目标时的降级种子」可选；主路径改为 §3.2 |
| 摘录可编辑 + `userEdited` | **需要调整后复用** | 升级为 claims + confirmationState |
| 模型调用 `callModel` | **直接复用** | 继续经现有配置与封装 |
| 四栏结果（无外部来源栏） | **需要调整后复用** | 增加「外部事实及来源」；「使用的本人信息」降为模型摘要并加审计说明 |
| 本地 JSON 保存结构 | **需要调整后复用** | 扩展为四合同字段；保持原子写 |
| IPC `actBehalf:*` / preload | **需要调整后复用** | 可保留通道名或别名；语义对齐新合同 |
| 测试 `test-act-behalf-contracts.cjs` | **需要调整后复用** | 随合同扩展；本任务不改 |
| Skill / 外搜 / Proposal / 主体回流 | **本闭环缺失** | 见 §5、§7；须新接线，不在 `55ae01f` 内 |

**不得**将 `55ae01f` 标为第一纵向闭环完成。

---

## 7. 真实能力方案（各选一个）

### 7.1 Skill：通用调研

| 项 | 冻结值 |
|----|--------|
| 名称 | **通用调研** |
| id | `psk_preset_general_research` |
| 是否已存在 | **是**（`src/skills/research-presets.js`；`ensurePresetResearchSkills` 种子） |
| 调用接口 | `skills:setActive` / `getActive` / `get`（`src/skills/personal.js`）；IPC 已暴露 |
| 最小输入 | `scene: "research"`（或本闭环等价 scene 键）、`skillId` |
| 最小输出 | Skill 对象含 `systemHint`、`steps`、`recommendedExtensions` |
| 权限边界 | 仅准备推荐扩展连接；不授权对外写操作 |
| 披露 Subject Context | 仅已确认快照；写入 Capability Invocation.`disclosedContext` |
| 如何记录 Invocation | `kind: "skill"`, `capabilityId: "psk_preset_general_research"`, `inputs` 含 goal 摘要, `status` |
| 失败处理 | 无法加载 Skill → **阻断本任务执行**并提示；不得静默退回「普通聊天 prompt」还显示已使用 Skill |
| **为何改变方法** | （1）将 Skill.`systemHint` **注入**本轮研究/生成提示，约束澄清→检索→读源→撰写；（2）UI **展示并遵循** `steps`；（3）按 `recommendedExtensions` **准备**只读检索扩展。**禁止**仅把 Skill 名称写入记录而不注入 hint、不走检索步骤。说明：现有 `research/agent-loop.js` 的步骤拓扑固定，本闭环允许复用该 loop 或在 act-behalf 执行路径中**等价实现**同序步骤；验收以「换用快速简报时产出结构明显不同」为对照证明（实现阶段可选回归，不阻塞主验收）。 |

### 7.2 只读外部信息：研究网页搜索

| 项 | 冻结值 |
|----|--------|
| 名称 | **研究网页搜索（只读）** |
| 是否已存在 | **是**（`src/research/web-search.js` → `searchWeb`） |
| 调用接口 | 优先 `research:discoverSources`（main 已接线）；底层 `searchWeb(em, query)`；Brave MCP 优先，否则 **DuckDuckGo HTML 内置兜底**（无 API Key 可跑） |
| 最小输入 | `query`（由目标 + Skill 澄清步骤得到） |
| 最小输出 | `{ query, provider, results: [{ title, url, snippet, provider }] }` |
| 权限边界 | **只读**；不得调用 filesystem/github 等可写扩展；本闭环不要求 `fetch` 正文（可选增强，失败不阻断若已有搜索结果） |
| 披露 Subject Context | 查询词可含**非敏感**目标短语；**禁止**把完整私人 Package 或未确认正文发给搜索提供方；Invocation 记录 `disclosedContext` 为「查询词级别」 |
| 如何记录 Invocation | `kind: "tool"`, `capabilityId: "research.webSearch"`, `provider`, `resultRefs`, `status` |
| 失败处理 | 搜索失败 → 外部事实栏明示失败；主流程可继续生成，但**不得伪造**外部事实；成果中须标明「无外部来源」 |
| 为何选它 | 已接线、有无 Key 兜底、只读、能提供 URL 级来源，满足「带来源的外部事实」验收 |

本地 `retrieval.retrieve`：**可作 Subject Context 相关性辅助**，**不**替代本条外部信息能力。

---

## 8. Experience Proposal 与主体回流（冻结）

### 8.1 产生条件

在下列之一发生时，系统可生成 Proposal（`userDecision: pending`）：

1. Owner 明确点击「将本次纠正写入我的资料」类操作；
2. Owner 在成果中改正了**针对本人事实/观点/风格/边界**的陈述，并选择生成提案（非默默保存成果）。

仅编辑成果文本、采用成果、否定任务 → **默认不写 Package**，可只更新任务记录。

### 8.2 确认与写入

1. 展示 Proposal：`proposedChange`、`targetScope`、`evidence`；
2. Owner `accepted` → 调用与 `feedback:apply` 等价的确认提交（须预览/changeSet 同源约束）；写入后填 `appliedVersion`；
3. Owner `rejected` → 保留提案记录，不写 Package；
4. **禁止**无确认写入。

映射候选：`src/feedback.js` 的 `previewFeedback` / `applyFeedback`（IPC `feedback:preview` / `feedback:apply`）。

### 8.3 下一次相似任务如何证明

1. 新任务 goal 与旧任务主题相近（验收手测同题或近义改写）；
2. Subject Context 装配结果中**出现**已确认写入的条目（或 sourceRefs 指向 feedback 记忆/风格行）；
3. Owner 能指出「上次确认的纠正影响了本次选用的本人信息或表达」；
4. 未确认的推测仍不得出现在「本人已有」栏。

---

## 9. Owner 验收用例（一次集中验收）

前置：已配置可用模型；Package 有基本 persona/边界（可薄）；网络可用（外搜）；实现已按本规格接线。

| # | 步骤 | 期望 |
|---|------|------|
| 1 | 从工作台进入「研究与表达」，提交真实研究与表达目标 | 主流程可走完，得到可编辑成果 |
| 2 | 在提交前查看并修改本人信息候选 | 可删/可补；快照被系统记录；不得宣称「已自动相关」若仍用降级截取 |
| 3 | 确认使用「通用调研」 | Invocation 有 skill 记录；方法步骤可见；hint 实际注入 |
| 4 | 查看外部事实栏 | 至少一条带来源（URL 或明确 provider）；失败则明示失败非伪造 |
| 5 | 核验四栏 | 本人 / 外部 / 新推断 / 成果 可区分；模型自述栏不作为唯一本人证据 |
| 6 | 修改成果但不确认 Proposal | Package 无新确认写入 |
| 7 | 生成并确认一条 Experience Proposal | 写入成功；`appliedVersion` 有值 |
| 8 | 重启应用 | 任务、依据、成果、决定仍在 |
| 9 | 再开相似任务 | 已确认变化出现在 Subject Context 或表达中 |
| 10 | 同题对照通用 AI（Owner 自备） | Owner 能稳定识别 Digital Me 更符合本人事实/框架/风格/边界 |

### 9.1 阻断 / 非阻断

**允许阻断**：主流程无法完成；个人数据损坏或丢失；隐私超出任务需要披露；未经授权对外行动。

**不得阻断本闭环**：低频竞态、非关键异常、页面不够精致、动画文案、感知不到的架构优化、为未来预建平台能力、R2 边缘、停止按钮细节等 → backlog。

---

## 10. 实现边界与下一项

| 项 | 状态 |
|----|------|
| 本规格 | `spec_frozen` |
| 代码实现 | **未开始**；须另获授权后按本规格执行 |
| R3 | **`paused`** |
| `55ae01f` | **`retained_for_mapping_review`**（已逐项裁定，见 §6） |
| **下一项任务** | **实现任务意图与本人上下文装配（第一闭环实现 · 第 1 块）** |

实现顺序建议（仍受执行计划约束，一次一块）：
1) Task Intent + Subject Context 装配与审计快照 → 2) 入口与主流程接线 → 3) Skill → 4) 外搜 → 5) 证据四栏 → 6) Experience Proposal 回流 → 7) 集中复核与 Owner 验收。

---

## 11. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-21 | 第一闭环规格冻结：流程、四合同、能力、55ae01f 裁定、验收；纠正固定截取与模型自述证据误差 |
| v0.1.1 | 2026-07-25 | 新增 §3.4「校准 vs 限制原则」（VL1-FIX）：数字之我校准 AI，不限制通用能力上限；缺原料不得限制输出、不得让用户补料 |
