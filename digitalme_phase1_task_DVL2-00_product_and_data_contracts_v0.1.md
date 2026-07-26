# 任务包 DVL2-00：第二纵向闭环产品与数据合同

版本：v0.1.1
日期：2026-07-26
状态：`specified` / `owner_decisions_recorded` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`
实施：`not_started`
基线起点：`95779624cac64b7d67b31167fc2f9e12d6d4ad09`
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)
承接：第一纵向闭环 `accepted` / `completed`；BUG1 #4 / #6 Owner 正式裁决

> **正式结论**：Owner 已接受本规格（`owner_accepted`）；合同已冻结为 DVL2-01～05 的实施合同（`frozen_for_implementation`）。实施仍为 `not_started`。DVL2-01 **尚未创建**实施分支，**尚未获得** implementation authorization。本次接受**不等于**授权整体 DVL2-01～05 编码。**不得**标 `implementation_authorized` / `implementation_started` / `implemented` / `completed`。

---

## 0. 文档地位与 Owner 已批准裁决

### 0.1 文档地位

本文是第二纵向闭环的**产品合同、主体合同、成果包合同、质量合同与成长回流合同**，并已由 Owner 接受、冻结为 DVL2-01～05 的权威实施合同。冲突时：架构原则文 > 本文 > 实现任务包。

本文**不是** DVL2-01～05 的实现授权。规格已 `frozen_for_implementation` / `not_started`；须另立实施任务包，经 Codex 复核与 Owner 明确实施授权后，方可编码。

### 0.2 Owner 已批准正式裁决（不再开放）

| # | 裁决 | 正式口径 |
|---|------|----------|
| 1 | BUG1 #4 多模态成果路径 | **采用 C + A**：系统根据自然语言目标自动识别并规划产物；用户可轻量增删、修改预计交付。**不采用 B**：不新增「创作」一级入口 |
| 2 | BUG1 #6 构建框架 | **采用七模块渐进式数字之我构建框架**（见 §8–§9） |
| 3 | 首个正式验收场景 | **为一个项目生成完整的对外介绍成果包**（不绑定 Digital Me 自身；须支持陌生用户与陌生项目） |
| 4 | 第一轮真实产物类型 | 正式介绍文档、演示文稿 PPT、单页 HTML 网站、封面图片。视频/音频：**本轮不实现真实生成**；数据模型与能力接口可扩展；**用户面不得宣称已支持视频或音频成品** |

### 0.3 本轮必须回答的十问（合同覆盖索引）

| # | 问题 | 合同章节 |
|---|------|----------|
| 1 | 自然语言目标如何变成成果计划 | §3 |
| 2 | 计划如何自动生成并由用户轻量修正 | §3.3、§3.4 |
| 3 | 多类型产物如何组成统一成果包 | §4 |
| 4 | 单项产物如何记录状态、版本、位置、来源、模型、能力与审计 | §4.2–§4.11 |
| 5 | 何谓「可交付」而非初稿 | §5、§6 |
| 6 | 七个主体模块的内容与数据边界 | §8 |
| 7 | 任务结果与反馈如何形成成长候选 | §9、§11 |
| 8 | 哪些可自动整理、哪些须本人确认 | §9.3、§9.4 |
| 9 | 如何只校准 AI、不限制通用能力 | §10 |
| 10 | DVL2-01～05 各自边界、不得偷跑 | §13 |

### 0.4 第二轮关闭的合同歧义（摘要）

1. 单项默认删除 `partially_ready`；仅含 `components[]` 的复合产物可保留（第一轮四类不用）。
2. 增加 `cancel_requested` / `cancelled` / `interrupted` 与迟到结果处理。
3. （已被第三轮取代）曾用单一整体状态表达运行/失败/可交付/采用——见 §0.5。
4. 分离「成果计划确认」与「风险执行授权」。
5. `ArtifactRef` 可迁移引用语义。
6. （第三轮修正命名）四层身份见 §4.2。
7. provenance 最小字段；禁止密钥与模型自述当审计证据。
8. 七模块主归属与引用规则。
9. 统一 `SubjectCandidate`（epistemicType × workflowStatus）。
10. 四类最低可交付门槛。
11. 任务项目材料不自动进入七模块。
12. 成果默认私有；分享/发布为独立动作。
13. 图片失败不得造假文件或拖垮其他三项。
14. DVL2-01 可读能力可用性，不得调用真实生成。

### 0.5 第三轮最小合同修订（关闭项）

1. 成果包拆分 `lifecycleStatus` × `completionStatus`；不得用单一整体状态同时掩盖失败与已完成成果。
2. 四层身份正式写作 `DeliverablePackage.id → Deliverable.id → DeliverableVersion.id → ArtifactRef.contentHash`；裸 `Package` 专指主体 Package。
3. 单项拆分 `planDisposition` × `generationStatus` × `reviewStatus`。
4. `currentVersionId` 不变量：current ≠ accepted；恢复旧版只改指针。
5. 外部文件变化：hash 不一致不得静默改写；缺失标记不可用；preview 可重建。

---

## 1. 第二纵向闭环定义

### 1.1 正式闭环

```text
构建我
→ 理解当前目标
→ 提取任务相关主体信息
→ 自动规划成果包
→ 用户轻量修正并确认计划
→ （如需）单独完成风险执行授权
→ 选择和编排最佳能力
→ 生成真实多模态产物
→ 质量审查
→ 用户逐项采用、修改或否定
→ 提取成长候选
→ 经本人确认更新数字之我
```

### 1.2 产品定性（强制）

第二纵向闭环是：

- **数字主体对任务最终交付负责的闭环**；
- 以自然语言目标为入口，以统一成果包为出口；
- 主体校准 + 能力编排 + 真实文件交付 + 质量审查 + 成长回流。

第二纵向闭环**不是**：

- 传统文件生成器；
- 多个孤立「生成按钮」；
- 先选择「文字 / 图片 / PPT / 网页」的复杂表单；
- 仅输出大纲、代码片段或「下载说明」而无真实可打开文件。

### 1.3 与第一纵向闭环的关系

| 维度 | 第一纵向闭环（已收口） | 第二纵向闭环（本轮规格） |
|------|------------------------|--------------------------|
| 证明点 | 理解我并产出研究与表达 | 对多模态交付成果包负责 |
| 产物形态 | 研究/表达文本成果为主 | 文档 + PPT + HTML + 图片统一包 |
| 主体回流 | Experience Proposal | 七模块成长候选 + 确认入主体 |
| 状态 | `accepted` / `completed` | 本规格 `owner_accepted` / `frozen_for_implementation` / `not_started` |

---

## 2. 用户主路径

默认产品路径（少决策）：

1. 用户描述目标（自然语言；可附项目材料）；
2. 系统识别受众、用途、约束与预期完成标准；
3. 系统生成「预计交付」；
4. 用户可增删、修改，并**确认成果计划**（见 §3.4；不等于风险授权）；
5. 若计划含高风险能力，用户另做**风险执行授权**；
6. 系统执行（编排能力、生成真实文件、质量审查）；
7. 用户看到统一成果包（默认私有，见 §4.11）；
8. 用户可打开、下载、继续编辑、重新生成、采用或否定单项产物；
9. 任务整体由 `lifecycleStatus` × `completionStatus` 派生（见 §4.9）；
10. 采用与修正形成成长候选；
11. 成长候选经本人确认后才可进入主体。

### 2.1 交互约束

- 前置交互必须少决策；
- **不得**要求用户先理解内部模型、Skill、MCP、Agent 或文件格式；
- **不得**因用户未手动选择产物类型而拒绝开始规划；
- 默认入口仍为做事页内的目标描述；**不新增「创作」一级入口**（裁决 #1）。

### 2.2 用户面文案约束

遵循既有产品文案规范：严谨、明白、中性。默认产品面禁止协议名、内部字段名、工程黑话。能力状态标签仅用：可用 · 实验 · 本地模拟 · 预览 · 尚未开放。

---

## 3. 自动规划与轻量纠错合同

### 3.1 规划器输入（最少字段）

| 字段 | 必填 | 说明 |
|------|------|------|
| `goal` | 是 | 自然语言目标 |
| `audience` | 是（可系统推断后用户改） | 受众 |
| `usage` | 是（可系统推断后用户改） | 用途 / 使用场景 |
| `constraints` | 否 | 格式、语气、保密、品牌等约束 |
| `deadline` | 否 | 可选时限 |
| `availableSubjectContext` | 系统装配 | 与当前目标高度相关的主体摘录 |
| `availableCapabilities` | 系统装配 | 当前已安装且可用的能力清单（只读可用性，见 §13） |

### 3.2 规划器输出（最少字段）

| 字段 | 说明 |
|------|------|
| `taskUnderstandingSummary` | 任务理解摘要 |
| `plannedDeliverables` | 预计交付列表 |
| `purposePerItem` | 每项产物的目的 |
| `recommendedFormat` | 推荐格式 |
| `dependencies` | 依赖关系（如封面服务于 HTML/PPT） |
| `executionMode` | 建议执行模式（见 §7） |
| `risksAndAuthorization` | 风险与**待授权**项清单（不得因计划确认而自动通过） |
| `blockersOrMissingCapabilities` | 无法完成或需外部能力的说明 |

### 3.3 用户轻量修正权利

用户必须可以：

- 删除单项产物；
- 新增产物（限已支持或明确标记「尚未开放」的 kind）；
- 修改类型与格式；
- 修改受众或用途；
- 调整优先级；
- **确认成果计划**（§3.4）。

系统行为：

- 用户未选手动类型时，系统仍须自动规划；
- 用户删除某项后不得静默加回（除非用户再次请求重规划）；
- 用户新增本轮未实现的 `audio` / `video` 时，界面须标明「尚未开放」，不得进入真实生成队列。

### 3.4 成果计划确认 vs 风险执行授权（强制分离）

| 动作 | 含义 | 授权范围 |
|------|------|----------|
| **成果计划确认** `planConfirmed` | 用户认可预计交付清单、受众、用途与优先级 | 仅授权进入本地编排与**已获授权范围内**的生成准备 |
| **风险执行授权** `riskAuthorization` | 用户对高风险能力/动作单独授权 | 外部数据传输、付费、执行代码、公开发布、高风险工具调用等 |

强制：

1. **计划确认不得自动授权**：外部数据传输、付费、执行代码、发布、高风险能力调用；
2. 规划输出中的 `risksAndAuthorization` 仅列示待授权项；未获对应授权前不得执行该风险动作；
3. 无高风险项时，计划确认后可进入本地低风险生成；
4. 授权记录进入 provenance.`authorizationRefs` 与审计，不得存密钥。

---

## 4. DeliverablePackage 成果包合同

### 4.1 统一逻辑模型

名称：**`DeliverablePackage`**（成果包）。合同与代码中**只能**使用此全称指代成果包。

```json
{
  "schemaVersion": 1,
  "id": "delivery_xxx",
  "taskId": "task_xxx",
  "goal": "任务目标",
  "audience": "受众",
  "usage": "用途",
  "visibility": "private",
  "lifecycleStatus": "planned",
  "completionStatus": "none",
  "planVersion": 1,
  "planConfirmedAt": null,
  "riskAuthorizations": [],
  "deliverables": [],
  "qualityReview": {},
  "subjectContext": {
    "snapshotId": null,
    "snapshotVersion": null,
    "claimRefs": [],
    "calibrationNotes": []
  },
  "capabilityPlan": {
    "items": []
  },
  "audit": {
    "events": []
  },
  "createdAt": "",
  "updatedAt": ""
}
```

字段命名可按现有代码惯例微调，但语义不得删减。`schemaVersion` 必须存在。本轮**只冻结合同**，不决定是否使用 SQLite。

**禁止**：用单一字段同时表达运行、失败、可交付与采用情况（第二轮单一 `status` 已废止）。

### 4.2 四层身份（强制命名）

正式写法：

```text
DeliverablePackage.id → Deliverable.id → DeliverableVersion.id → ArtifactRef.contentHash
```

| 层 | 身份 | 说明 |
|----|------|------|
| 1 | `DeliverablePackage.id` | 成果包逻辑身份；跨重启稳定 |
| 2 | `Deliverable.id` | 单项产物逻辑身份（计划项）；跨版本稳定 |
| 3 | `DeliverableVersion.id` | 具体生成/编辑版本身份；采用与审计绑定此层 |
| 4 | `ArtifactRef.contentHash` | 文件内容哈希；内容变则须新版本 |

命名禁止：

- 裸名 **`Package` 继续专指 Digital Me 主体 Package**（人的主体资产包）；
- 成果包在合同与代码中**只能**称 **`DeliverablePackage`**；
- **不得**把主体 Package 与 `DeliverablePackage` 放入同一存储身份语义或互相别名。

强制：

- 重新生成与用户编辑**不得原地覆盖**旧版本文件或元数据；
- 新内容 → 新 `DeliverableVersion` + 新 `ArtifactRef.contentHash`；
- 旧版本可被 `generationStatus=superseded`，但可查看、可审计。

### 4.3 Deliverable 三维状态与 DeliverableVersion

单项**不得**再用单一 `status` 混合计划、生成与用户审阅。冻结三维度：

#### 4.3.1 `planDisposition`

| 值 | 含义 |
|----|------|
| `included` | 仍在有效计划中；参与整体派生 |
| `removed` | 执行前或计划修正中从计划移除；**不是** `failed` / `rejected` / `cancelled` |

#### 4.3.2 `generationStatus`

`planned` · `queued` · `generating` · `generated` · `validating` · `ready` · `failed` · `cancel_requested` · `cancelled` · `interrupted` · `superseded`

**默认删除单项 `partially_ready`。** 仅未来含非空 `components[]` 的复合产物可保留；**第一轮四类不得使用。**

| 从 | 到 | 条件 |
|----|----|------|
| `planned` | `queued` | 计划已确认，且所需风险授权已满足（或本项无风险要求）；且 `planDisposition=included` |
| `queued` | `generating` | 能力开始生成 |
| `queued` | `cancel_requested` | 用户请求停止执行 |
| `queued` | `cancelled` | 启动前完成停止 |
| `generating` | `generated` | 文件写出成功且 ArtifactRef 有效 |
| `generating` | `failed` | 技术失败且无可用结果；**不得**写虚假文件 |
| `generating` | `cancel_requested` | 用户请求停止执行 |
| `generating` | `interrupted` | 进程中断/崩溃/应用退出 |
| `cancel_requested` | `cancelled` | 确认停止；迟到成功默认不采纳（见 §4.3.5） |
| `cancel_requested` | `failed` | 停止过程中确认技术失败 |
| `interrupted` | `queued` | 恢复后重试 |
| `interrupted` | `cancelled` | 恢复后放弃执行 |
| `interrupted` | `failed` | 恢复后不可继续 |
| `generated` | `validating` | 进入质量审查 |
| `validating` | `ready` | 质量 `pass` / `pass_with_warnings` |
| `validating` | `queued`/`generating` | `needs_revision` 触发**新 version** 重试 |
| `validating` | `failed` | `failed_validation` 且不可自动修复 |
| （旧 version）任意非 superseded | `superseded` | 新 version 成为 current 后，旧 version 标记 |

说明：

- **`cancelled`** = 停止执行，**不是**用户否定内容；
- **`failed`** = 技术/验证失败，**不是**用户审阅否定；
- 执行前从计划删除 → 仅 `planDisposition=removed`，**不要**写成 failed/rejected/cancelled。

#### 4.3.3 `reviewStatus`

| 值 | 含义 |
|----|------|
| `unreviewed` | 尚未用户审阅（含尚无生成、或已 ready 未表态） |
| `accepted` | 用户采用**某一** DeliverableVersion |
| `rejected` | 用户否定**某一**已生成版本（内容否定，非技术失败） |

规则：

- `accepted` / `rejected` **绑定具体 `DeliverableVersion.id`**；
- `rejected` 历史版本保留；可再生成新版本；新版本 `reviewStatus` 重新为 `unreviewed`；
- `rejected` ≠ `failed` ≠ `cancelled`。

#### 4.3.4 对象形状

```json
{
  "id": "deliverable_xxx",
  "kind": "document",
  "format": "docx",
  "title": "正式介绍文档",
  "purpose": "面向潜在合作伙伴",
  "planDisposition": "included",
  "generationStatus": "planned",
  "reviewStatus": "unreviewed",
  "currentVersionId": null,
  "versions": [],
  "editable": true,
  "components": null,
  "createdAt": "",
  "updatedAt": ""
}
```

```json
{
  "id": "dver_xxx",
  "deliverableId": "deliverable_xxx",
  "version": 1,
  "generationStatus": "ready",
  "reviewStatus": "unreviewed",
  "artifactRef": null,
  "previewRef": null,
  "contentAvailable": true,
  "generator": {
    "executionMode": "external_capability",
    "capabilityId": null,
    "modelRoute": null,
    "fallbackUsed": false
  },
  "provenance": {},
  "quality": {
    "verdict": null,
    "checks": []
  },
  "supersedesVersionId": null,
  "supersededByVersionId": null,
  "createdAt": "",
  "updatedAt": ""
}
```

第一轮四类：`components` 必须为 `null`。
Deliverable 上的 `generationStatus`/`reviewStatus` 为其 **currentVersion** 的投影；无 version 时 generationStatus 可为 `planned`，reviewStatus 为 `unreviewed`。

#### 4.3.5 取消、中断、重启与迟到结果

| 情形 | 处理 |
|------|------|
| 用户停止执行 | `generationStatus`: `cancel_requested` → `cancelled`；`reviewStatus` 不变（未审阅就仍 `unreviewed`） |
| 执行前移出计划 | 仅 `planDisposition=removed`；不改写为 failed/rejected/cancelled |
| 应用退出时 generating/validating | 恢复为 `interrupted`；不得假装仍在生成 |
| 重启后发现完整文件且 hash 匹配 | 可进入 `generated`→`validating`（审计「恢复发现」）；否则保持 `interrupted` |
| 取消后迟到成功结果 | **不得自动成为 `currentVersionId`**；默认丢弃；仅用户显式「采纳迟到结果」才创建**新** DeliverableVersion 并可选设为 current |
| 取消后迟到失败 | 记审计；保持 `cancelled` |
| `planDisposition=removed` | **不参与**整体派生；历史 version 仍可审计 |

强制：renderer 不得自行决定业务事实状态；变更仅由 main 侧写入。

### 4.4 `currentVersionId` 不变量

- `currentVersionId` 指向某一**现存** `DeliverableVersion.id`，或 `null`（尚无版本）；
- **current ≠ accepted**：成为 current 只表示「当前展示/后续操作默认版本」，不表示用户已采用；
- `accepted` / `rejected` 绑定具体 version（记在该 version 的 `reviewStatus`）；
- **恢复旧版**：只更新 `currentVersionId` 指向历史 version；**不得改写**该 version 的文件内容或 provenance；
- **不得原地覆盖**任何 DeliverableVersion；
- 迟到结果默认不改 `currentVersionId`（见 §4.3.5）。

### 4.5 `kind` 冻结

**第一轮至少支持（须真实生成文件）：**

| kind | 用户含义 | 本轮格式期望 |
|------|----------|--------------|
| `document` | 正式介绍文档 | `docx` 或 `md` |
| `presentation` | 演示文稿 | `pptx` |
| `webpage` | 单页网站 | `html`（可含本地 css/js） |
| `image` | 封面图片 | `png` / `jpg` / `webp` |

**预留但不实现真实生成：**

`audio` · `video` · `dataset` · `code` · `dashboard` · `archive` · `other`

预留 kind 可出现在数据模型与能力接口中；**用户界面不得宣称已经支持视频或音频成品**。

### 4.6 ArtifactRef（可迁移引用）

```json
{
  "storageKind": "local_deliverable_relative",
  "relativePath": "deliverables/doc_v3.docx",
  "externalUri": null,
  "contentHash": "sha256:...",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "byteSize": 0,
  "absolutePathCache": null
}
```

| 字段 | 规则 |
|------|------|
| `storageKind` | 至少支持 `local_deliverable_relative`；可扩展 `external_uri` 等。命名避免与主体 Package 存储混淆 |
| `relativePath` / `externalUri` | 按 storageKind 二选一为主定位 |
| `contentHash` | 必填（写出成功后）；四层身份第 4 层 |
| `mimeType` / `byteSize` | 必填 |
| `absolutePathCache` | 可选缓存；**不得**作为唯一身份 |

强制：绝对路径不得作为唯一身份；重启后凭 relativePath/externalUri + contentHash 恢复；preview 是可重建衍生物。

### 4.7 外部文件变化规则

| 情形 | 处理 |
|------|------|
| 磁盘文件 `contentHash` 与记录不一致 | **不得静默改写**权威 version；发出 `content_changed` 事件，并形成**新版本候选**（或待用户确认的新 DeliverableVersion） |
| 外部编辑器改写了文件 | 同上；采纳后才创建新 version 并可选更新 `currentVersionId` |
| 文件缺失 / 无法读取 | 标记该 version `contentAvailable=false`（引用不可用）；**不得删除**审计与 provenance 历史 |
| preview 丢失 | 可从主 artifact **重建**；不改变权威成果身份（DeliverableVersion.id / contentHash） |
| 用户拒绝新版本候选 | 保持原 current；记录审计 |

### 4.8 provenance 最小字段

每个 `DeliverableVersion.provenance` 至少包含：

| 字段 | 说明 |
|------|------|
| `subjectContextSnapshotId` | 主体上下文快照 ID |
| `subjectContextSnapshotVersion` | 快照版本 |
| `planVersion` | 对应成果计划版本 |
| `capabilityInvocationIds` | 能力调用记录 ID 列表 |
| `modelRoute` | 模型路由（无密钥） |
| `sourceRefs` | 外部/材料来源引用 |
| `evidenceRefs` | 证据引用 |
| `authorizationRefs` | 已生效的风险授权引用 |
| `actor` | 触发方（user / system / capability） |
| `generatedAt` | 生成时间 |

禁止：保存密钥/token/完整凭据；把模型自述单独当作审计证据。

### 4.9 成果包双维状态：确定性派生

整体**禁止**单一 `status`。冻结：

#### `lifecycleStatus`

`planned` | `in_progress` | `stopping` | `stopped` | `completed` | `interrupted`

#### `completionStatus`

`none` | `partial` | `ready` | `ready_with_failures` | `partially_accepted` | `accepted` | `failed`

**有效项集合 `A`**：`planDisposition=included` 的 deliverable。
评估依据：各有效项的 **currentVersion**（若无 version，则 generationStatus=`planned`，reviewStatus=`unreviewed`）。
**历史 `superseded` 版本不参与派生。**
**`planDisposition=removed` 不参与派生。**
两维均由派生得出，不得手工漂移。

##### lifecycleStatus 派生（优先级自上而下，命中即停）

| 优先级 | lifecycleStatus | 条件 |
|--------|-----------------|------|
| 1 | `interrupted` | 应用退出/崩溃后恢复：曾有进行中项，且尚未用户恢复执行或明确停止 |
| 2 | `stopping` | `A` 中至少一项 `generationStatus=cancel_requested` |
| 3 | `in_progress` | `A` 中至少一项 ∈ {`queued`,`generating`,`validating`} |
| 4 | `stopped` | 无进行中项，且至少一项 `cancelled`，且用户已停止剩余执行（或无可继续项） |
| 5 | `completed` | 无进行中/停止中项，且 `A` 中各项 generation 已离开活动队列（ready/failed/cancelled 等终态） |
| 6 | `planned` | `A` 全部仍为 `planned`（尚未入队） |

说明：`completed` 只表示**执行生命周期结束**，不表示全部成功或全部采用（见 completionStatus）。

##### completionStatus 派生（优先级自上而下，命中即停）

| 优先级 | completionStatus | 条件 |
|--------|------------------|------|
| 1 | `accepted` | `A` 非空且全部 `reviewStatus=accepted` |
| 2 | `partially_accepted` | 至少一项 `accepted`，且存在未 `accepted` 的有效项 |
| 3 | `ready_with_failures` | 至少一项 current 为 `ready`（或已 accepted），且至少一项 current `generationStatus=failed` |
| 4 | `ready` | `A` 非空，全部 current `generationStatus=ready`，且无 `failed`；审阅可尚未完成 |
| 5 | `failed` | `A` 非空，全部 current 为 `failed` 或 `cancelled`，且至少一项为 `failed`，且无任何 `ready`/`accepted` |
| 6 | `partial` | 至少一项 `ready` 或 `accepted`，同时仍有未 ready 的混合项，且尚不满足上列 |
| 7 | `none` | 尚无任何 `ready`/`accepted`/`failed`（例如全 planned，或仅 queued/generating） |

**不得**用 `cancelled` 或旧称 `partially_ready` **掩盖**已存在的失败（须能表现为 `ready_with_failures`）或已完成成果（须能表现为 `ready` / `partial` / `accepted` 等）。

##### 组合覆盖表

| 组合 | lifecycleStatus（典型） | completionStatus |
|------|-------------------------|------------------|
| 全 planned | `planned` | `none` |
| 部分 ready、部分生成中 | `in_progress` | `partial` |
| ready + failed | `completed` 或 `in_progress`（若仍有队列） | `ready_with_failures` |
| accepted + ready（其余未审） | `completed` 或 `in_progress` | `partially_accepted` |
| accepted + rejected | `completed` | `partially_accepted` |
| 全 accepted | `completed` | `accepted` |
| 全失败 | `completed` 或 `stopped` | `failed` |
| 用户停止剩余执行但已有 ready | `stopped` | `partial` 或 `ready_with_failures`（若亦有 failed） |
| 应用退出造成 interrupted | `interrupted` | 按已落盘 current 计（可有 `partial` / `none` 等） |
| 仅历史 superseded；current 全 ready | 按 current | `ready` |
| 已从计划移除的交付项 | 不计入 `A` | 不计入 |

### 4.10 版本、替代与引用（重申）

1. 重新生成/编辑不覆盖旧版本；
2. 新版本可 supersede 旧版本（旧 version `generationStatus=superseded`）；
3. 用户可查看历史版本；
4. 采用/否定绑定具体 DeliverableVersion；
5. 来源和审计绑定具体 DeliverableVersion；
6. ArtifactRef 按 §4.6；绝对路径非唯一身份；
7. preview 可重建（§4.7）。

### 4.11 默认私有与对外分享

- 成果包与单项产物默认 `visibility=private`；
- **对外分享 / 发布是独立动作**，须单独确认（可叠加风险授权）；
- 计划确认或单项采用**不等于**授权对外发布。

---

## 5. 四类第一轮真实产物合同与最低可交付门槛

### 5.1 正式介绍文档（`document`）

最低可交付门槛（未全部满足不得标 `ready`）：

1. 真实文件存在，ArtifactRef 有效，可打开；
2. 可继续编辑（docx 或 md）；
3. 含标题、摘要、正文结构（至少一级标题 + 两段以上正文）；
4. 后台 provenance 完整；
5. 用户面不强制展示技术来源墙。

### 5.2 演示文稿 PPT（`presentation`）

最低可交付门槛：

1. 真实 `.pptx` 存在且可被 WPS / PowerPoint 打开；
2. 不是纯文本大纲文件；
3. 至少含：封面页、≥2 个内容页、演讲备注（可简短）；
4. 页面有可见标题与正文块；
5. 不承诺本轮解决全部高级设计、动画与品牌系统。

### 5.3 单页 HTML 网站（`webpage`）

最低可交付门槛：

1. 完整可运行文件（非代码片段）；
2. 本地可打开；
3. 含完整页面结构（头/主内容/页脚或等价）；
4. 桌面与基本移动宽度可用（可用简单响应式）；
5. 外部资源依赖已记录；脚本/资源来源可审计。

### 5.4 封面图片（`image`）

最低可交付门槛：

1. 真实图片文件存在（非空、非占位假文件）；
2. 明确尺寸、用途与版本；
3. 成果包内可预览（preview 可后重建，但主文件必须有效）；
4. 记录图像生成能力 invocation。

失败规则（强制）：

- 图片能力失败 → 该项 `failed`；**不得**制造虚假图片文件标为成功；
- **不得**因此将文档 / PPT / HTML 标失败或取消；
- 用户可单独重试或替换图片项。

### 5.5 质量通过禁止项

**模型自我评价不能单独构成质量通过。** 须有文件级/结构级自动检查或人工确认（见 §6）。

---

## 6. 95 分位交付质量合同

### 6.1 正式定义（非统计学承诺）

> 在明确目标场景中，成果达到使用成熟专业工具、主流优秀 AI 能力与合理人机协作流程所能获得的优秀可交付水平；用户不需要重新完成主要工作。

「95 分位」是产品质量目标的简称，**不是**绝对统计学保证，不得写入用户面为量化承诺。

### 6.2 五个质量维度（强制）

| 维度 | 含义 |
|------|------|
| 完整性 | 约定结构与必备部件齐全（含 §5 最低门槛） |
| 正确性 | 关键事实无伪造；与材料/主体已确认事实不冲突 |
| 可用性 | 文件可打开、可编辑、可预览、可交付使用 |
| 场景适配 | 符合受众、用途与约束 |
| 主体一致性 | 方向/风格/价值观/边界校准正确，且**未**因校准降低通用质量 |

### 6.3 每项产物的质量机制

每项产物必须具备：必检项、可选检项、自动检查、需要人工确认的检查、失败处理、降级策略。

| verdict | 含义 |
|---------|------|
| `pass` | 必检通过，可标 `ready` |
| `pass_with_warnings` | 可用，存在非阻断警告 |
| `needs_revision` | 需修订或重试，不得标最终可交付 |
| `failed_validation` | 验证失败 |

强制：

- **不得仅依据模型自我评价**判定质量通过；
- 自动检查须有可复核规则或文件级证据；
- 用户面禁止无依据的「已质检通过」宣称。

---

## 7. 能力责任模式

| 模式 | 含义 |
|------|------|
| `digital_me_direct` | Digital Me 本地直接生成 |
| `external_capability` | 调用已安装外部能力 / 业界最佳工具 |
| `delegated_agent` | 受控委派给其他 Agent（本轮验收场景默认不依赖公网 Agent） |
| `human_ai_collaboration` | 需要人在环确认或补步 |

原则：

1. Digital Me 对最终交付负责；
2. 不要求所有能力由 Digital Me 自研；
3. 能力选择以业界最佳为优先；
4. Digital Me 负责目标、主体校准、授权、编排、审计与成果回收；
5. 密钥与高风险工具权限不得进入 renderer；
6. 失败时可切换备用能力；
7. 能力切换不得导致成果包身份与审计链丢失。

---

## 8. 七模块数字之我合同与主归属

七模块是**后台主体模型**，不是七个一次性表单或七个复杂页面。

### 8.1 主归属与引用规则（避免多权威）

| 信息类型 | 主归属模块 | 其他模块 |
|----------|------------|----------|
| 核心身份、客观事实、经历、时间线、项目/作品事实条目 | **身份与事实** | 仅引用 ID，不得复制第二份权威正文 |
| 价值观、观点、决策框架、假设 | **认知与判断** | 引用 |
| 文风、沟通方式、对象差异表达 | **表达与互动** | 引用 |
| 技能声明、已安装能力、工作流、可信成果索引 | **能力与成果** | 成果文件本身属 Deliverable 体系；模块内只保留索引/证据引用 |
| 人/组织/角色、协作历史、Interaction Contract | **关系与协作** | 引用；关系凭据主存本模块 |
| 长期方向、学习目标、希望成为的状态 | **意图与发展** | 临时任务 goal 主存任务/成果包，不升格为长期意图 unless 确认 |
| 隐私规则、行动权限、授权、审计策略 | **边界与治理** | 授权记录可被 provenance 引用，权威在本模块 |

规则：

- 任一事实/立场/授权只有**一个主归属**；
- 跨模块只用引用（ID + 模块名），禁止复制多份权威正文；
- 关系事实若同时涉及「是谁」与「和谁」：人物主档在关系模块，与本人相关的经历摘要可在身份模块引用。

### 8.2–8.8 各模块要点

**身份与事实**：区分事实 / 本人声明 / 系统推断；高后果事实不得自动确认。

**认知与判断**：不把模型推断直接当本人立场；观点可演化；保留版本。

**表达与互动**：软校准；不得机械模仿导致质量下降；不得伪造真实发言。

**能力与成果**：能力声明须有成果/经历支持；单次成功不升格稳定能力。

**关系与协作**：默认私有；对外出示需授权；协作结果不直接改写主体身份。

**意图与发展**：区分长期意图与临时任务目标；根本方向变更须本人确认。

**边界与治理**：硬约束优先；不得由任务结果自动降低边界；高风险始终本人确认。

---

## 9. 渐进式构建与 SubjectCandidate 合同

### 9.1 默认构建流程

```text
材料、对话、行为和任务结果进入
→ 系统识别候选（SubjectCandidate）
→ 候选分流到七个模块主归属
→ 低风险整理
→ 高价值事项等待确认
→ 用户只处理少量关键变化
→ 确认后写入主归属模块新版本
```

### 9.2 SubjectCandidate（统一合同）

知识性质与工作流状态**拆开**：

| 维度 | 枚举 | 含义 |
|------|------|------|
| `epistemicType` | `observed` / `inferred` / `owner_asserted` | 观察所得 / 系统推断 / 本人断言 |
| `workflowStatus` | `proposed` / `confirmed` / `edited` / `rejected` / `superseded` / `revoked` / `deleted` | 工作流状态 |

候选至少字段：

| 字段 | 说明 |
|------|------|
| `id` | 候选 ID |
| `targetModule` | 七模块之一（主归属） |
| `epistemicType` | 见上 |
| `workflowStatus` | 见上 |
| `impact` | `low` / `medium` / `high` / `critical` |
| `confidence` | 0–1 或离散等级 |
| `confirmationPolicy` | `auto_organize_allowed` / `notify_only` / `require_confirmation` |
| `content` | 候选内容 |
| `sourceRefs` / `evidenceRefs` | 来源与证据 |
| `dedupeKey` | 去重键 |
| `writeTarget` | 确认后最终写入对象（模块内记录 ID 或新建） |

去重：相同 `dedupeKey` + 同主归属模块 → 合并或 supersede，不得平行确认两份权威。

### 9.3 自动整理 vs 本人确认

| confirmationPolicy | 允许条件 |
|--------------------|----------|
| `auto_organize_allowed` | 仅低 impact + 非核心身份/边界/长期意图等 |
| `require_confirmation` | 核心身份、重大事实、价值立场、长期意图、关键关系、隐私与行动边界、对外凭据、高风险授权 |

### 9.4 任务项目材料边界（强制）

- 任务附带的**项目材料不自动进入七模块**；
- 仅可作为本次生成的 `sourceRefs`；
- 只有经成长候选（SubjectCandidate）且本人确认后，方可写入主体。

### 9.5 「我」页面默认呈现

默认不展示七个数据库控制台。用户默认看到：当前的我、最近变化、待确认重要事项、关键缺口、当前任务使用的主体信息、最近成长来源。

---

## 10. 主体上下文使用合同（校准不限制）

1. Digital Me 校准 AI，而不是限制 AI；
2. AI 能力上下限以接入模型为基线；
3. 本人资料不足时使用通用知识与能力完成任务；
4. 本人事实 / 外部事实 / 通用推理应可区分；
5. 不要求用户先补齐数字之我才得到正常答案；
6. 与任务无关的主体信息不得进入模型上下文；
7. 边界与授权为硬约束；风格与偏好为软约束；
8. 推断与发展线索不得伪装为已确认事实。

---

## 11. 成长回流合同

```text
成果生成
→ 用户采用、修改或否定
→ 系统识别 SubjectCandidate
→ 映射到七模块主归属
→ 显示来源、依据、epistemicType、confidence
→ 用户确认、编辑或拒绝
→ 写入主归属模块新版本
```

成果与反馈**不得直接改写**七模块主体。

候选类型：新事实、新能力证据、新工作流、新表达偏好、新判断经验、新关系或协作记录、新发展线索、边界冲突或治理建议。

禁止：一次采用改核心人格；外部反馈直接改立场；单次成功宣称掌握技能；任务失败自动降能力评价；未确认修改边界/身份/长期意图；项目材料未确认写入主体。

---

## 12. 首个正式验收场景

> 为一个项目制作完整的对外介绍成果包。

不得绑定 Digital Me 自身；须支持陌生用户与陌生项目；陌生项目不得使用 Owner 私有材料。

预计成果：正式介绍文档、演示文稿、单页 HTML、封面图片。

验收覆盖：自动预计交付、轻量修改、计划确认≠风险授权、四项独立状态、部分失败不拖垮整包、真实文件、重启恢复、单项再生、采用/否定、版本与审计、ArtifactRef、成长候选、未确认不入主体、校准不降质、默认私有、图片失败隔离。

---

## 13. 后续任务边界（本轮不得实现）

| 任务 | 只做 | 明确不做 |
|------|------|----------|
| **DVL2-01 成果规划器** | 自然语言目标理解；预计交付生成；用户轻量修正；成果计划持久化；**只读**能力可用性以辅助规划 | **不得**调用真实生成能力；不写真实交付文件 |
| **DVL2-02 成果包与本地交付** | DeliverablePackage；状态；ArtifactRef；版本；重启恢复；采用与否定 | 不实现四类生成器本体 |
| **DVL2-03 四类产物生成** | 文档、PPT、HTML、图片真实生成 | 不做完整质量引擎与成长回流 |
| **DVL2-04 质量审查** | 五维质量、重试与降级 | 不改规划器主合同、不写主体 |
| **DVL2-05 主体成长回流** | SubjectCandidate、七模块映射、确认、版本、撤销、审计 | 不重做生成器 |

偷跑禁令：任一实现任务不得吞并其他任务核心交付；合同缺口先回改 DVL2-00。

---

## 14. 继续暂停的工作

R3=`paused`；R2.5 SQLite=`deferred`；PAN-02=`blocked`；完整 A2A / AP2 结算 / 视频音频真实成品 / Web 与移动端产品化 / 大规模 renderer 重写：均不启动。

---

## 15. 明确不做（本规格阶段）

- 不修改任何运行代码、测试、配置、依赖或 lockfile；
- 不启动 Electron；不读取真实 Package / sessions / userData / 密钥 / 个人资料；
- 不创建 DVL2-01～05 实现分支或编码（除非另获独立实施授权）；
- 不将本规格标为 `implementation_authorized` / `implementation_started` / `implemented` / `completed`；
- 本次 Owner 接受 ≠ 授权整体 DVL2-01～05 编码；
- 不 push。

---

## 16. 文档同步清单（本轮允许）

| 文件 | 动作 |
|------|------|
| 本文 | Owner 接受与规格冻结 → `owner_accepted` / `frozen_for_implementation` / `not_started` |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 同步冻结状态；下一文档任务 = 起草 DVL2-01 任务包（非开始实现） |

旧第一纵向闭环计划保持 `completed` / `superseded_as_current_execution_plan`（本轮不改）。

---

## 17. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1-draft | 2026-07-26 | 初稿：Owner 四项裁决入库；待 CTO 复核 |
| v0.1-draft（R1 复核） | 2026-07-26 | **CTO 第一轮复核**：要求补全状态机、ArtifactRef、版本身份、provenance、候选和最低质量门槛（成果包、状态机、引用、版本、候选及质量合同需修订） |
| v0.1-draft（R2） | 2026-07-26 | **CTO 第二轮复核**：关闭取消恢复、ArtifactRef、provenance、七模块主归属、SubjectCandidate 和最低交付门槛；并要求拆分整体运行与完成状态、修正 DeliverablePackage 命名、拆分计划/生成/审阅三维状态；状态 → `codex_changes_requested` |
| v0.1-draft（R3） | 2026-07-26 | **CTO 第三轮复核**：关闭整体双维状态、单项三维状态、Package 命名、currentVersionId 和外部文件变化；确认合同歧义关闭；技术复核通过 |
| v0.1.1 | 2026-07-26 | CTO 最终技术结论：`codex_review_passed`；曾标 `ready_for_owner_acceptance` |
| **v0.1.1（Owner 接受）** | 2026-07-26 | **Owner 正式接受**：已批准 C 自动规划为主、A 轻量纠错为辅、不新增「创作」入口、七模块渐进式构建、首验场景为完整对外介绍成果包、第一轮真实产物为文档/PPT/HTML/图片。状态 → `owner_accepted` / `frozen_for_implementation` / `not_started`。DVL2-01 尚未创建、尚未获得 implementation authorization；本次接受 ≠ 授权整体 DVL2-01～05 编码 |
