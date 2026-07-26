# 任务包 DVL2-02：成果包实例与执行准备

版本：v0.1.1
日期：2026-07-26
状态：`specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`
实施：`not_started`
implementation_authorized：`false`
规格冻结基线：`578648f31d86594cc2bd56ede2e367122cfa98f8`
上位合同：
- [`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（**DVL2-00 v0.1.1** / `owner_accepted` / `frozen_for_implementation`）
- [`digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md`](digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md)（**DVL2-01 v0.1.1** / `accepted_as_implemented` / 实施 `implemented` @ `6e7c384`）
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)

> **正式边界（冻结规格 v0.1.1）**：Owner 已接受本规格；合同已冻结为实施准备依据（`owner_accepted` / `frozen_for_implementation`）。**v0.1.1 为冻结规格**；后续实现不得静默偏离；如发现合同缺口，必须先回到规格评审；实现只能在另行授予 `implementation_authorized` 后开始；不得通过实现细节反向修改冻结语义。冲突时：架构原则文 > DVL2-00 > DVL2-01 > 本文。**尚未**授予 `implementation_authorized`；实施仍为 `not_started`。不得标 `implementation_authorized` / `implementation_in_progress` / `implemented` / `owner_runtime_accepted` / `accepted_as_implemented` / `completed`。

### Owner 规格接受记录

**Owner 规格结论**：接受。

**Owner 接受的范围**：

- 接受从 `activeConfirmedVersionId` 创建不可变成果包实例；
- 接受 DVL2-02 只完成成果包与执行准备，不生成真实成果；
- 接受 DVL2-02 不创建 `DeliverableVersion` / `ArtifactRef` / `contentHash`；
- 接受 DVL2-02 仅创建 `PackagePreparationAttempt`；
- 接受 `Task.deliverableExecution.activePackageId` 的严格语义；
- 接受新 confirmed 版本创建新 package，旧 package 保留历史且不静默重绑；
- 接受 archived / soft_deleted / degraded consistency 幂等规则；
- 接受 `ExecutionSnapshot` 与 `CurrentPreparationReadiness` 分离；
- 接受成果计划模式主按钮为「准备成果包」；
- 接受旧版直接执行入口默认隐藏；
- 接受 DVL2-03 唯一正式输入为 `packageId`；
- 接受默认简洁层、渐进披露和只确认例外的 UI 原则。

**Owner 接受不代表**：

- 真实 Word / PPT / HTML / 图片生成已实现；
- DVL2-03 已启动；
- `implementation_authorized` 已授予；
- 可开始编码；
- 已完成 Owner 真机验收；
- DVL2-02 已 `implemented`。

### 冻结合同摘要（核心）

1. **唯一准备来源**：`Task.deliverablePlanning.activeConfirmedVersionId`
2. **DVL2-02 运行时对象**：`DeliverablePackage` · `Deliverable` · `PackagePreparationAttempt`
3. **DVL2-02 不创建**：`DeliverableVersion` · `ArtifactRef` · `contentHash` · `DeliverableGenerationAttempt`
4. **Task 指针**：`Task.deliverableExecution.activePackageId`
5. **Store**：`<userData>/deliverable-packages.json`
6. **Store 顶层**：`schemaVersion` · `revision` · `packages` · `deliverables` · `preparationAttempts` · `updatedAt`
7. **DVL2-03 正式输入**：`packageId`
8. **UI 主操作**：准备成果包
9. **旧执行入口**：默认隐藏，仅兼容/开发模式可见，不与主操作并列
10. **本阶段状态**：Package = `planned` × `none`；Deliverable = `included` × `planned` × `unreviewed`；「暂不可生成」仅属于动态 readiness / UI 投影

### implementation_authorization 门禁

DVL2-02 实现开始前，必须另行完成：

1. `implementation_authorization` 评审；
2. 实现分支方案；
3. 允许修改文件清单；
4. 禁止范围；
5. Store / CAS / reconciliation 测试矩阵；
6. Electron Owner 验收路径；
7. 不生成真实成果的边界测试；
8. 实现提交与 Owner runtime acceptance 分离。

在这些完成前，**不得**修改 `digitalme-app/**`。

---

## 0. 文档地位

1. 承接 DVL2-00 §13「DVL2-02 成果包与本地交付」与 DVL2-01 §20 交接点：从已确认计划版本建立可恢复的 `DeliverablePackage` 实例。
2. 解决 Owner / DVL2-01 P1「执行入口衔接」：成果计划模式下的执行准备必须绑定 `Task.deliverablePlanning.activeConfirmedVersionId`。
3. 落实 Owner 在 DVL2-01 验收提出的减负原则（默认接受、只确认例外、渐进披露）。
4. **本任务不生成真实 Word / PPT / 网页 / 图片**；**不创建**任何 `DeliverableVersion` / `ArtifactRef` / `contentHash`；不为四类产物伪造路径、下载入口或生成进度。
5. 本文 **v0.1.1** 已 `owner_accepted` / `frozen_for_implementation`；**不是** `implementation_authorized`；获另行实施授权前不得修改 `digitalme-app/**`。

---

## 1. 产品目标与非目标

### 1.1 目标

> 用户确认成果计划后，系统建立一个稳定、可恢复、可审阅、可继续执行的成果包实例，并为 DVL2-03 真实生成提供以 **`packageId`** 为唯一正式入参的稳定输入。

目标链路（冻结意图）：

```text
Task.deliverablePlanning.activeConfirmedVersionId
→ 创建不可变 ExecutionSnapshot
→ 创建 DeliverablePackage + included Deliverable
→ 记录 PackagePreparationAttempt
→ 建立本地持久化
→ 重算并显示 CurrentPreparationReadiness（非伪生成）
→ 支持中断与重启恢复
→ DVL2-03 以 packageId 启动真实生成
```

必须实现的产品能力（获实施授权后）：

1. 仅从 `activeConfirmedVersionId` 创建成果包；
2. 冻结 `ExecutionSnapshot`；后续 draft / 新 confirmed **不得**静默改变既有成果包；
3. 为每个创建时 `included` 的计划项创建 `Deliverable`（无 Version）；
4. 本地持久化、原子写、启动 reconciliation、fail-closed；
5. 幂等「准备成果包」（含 archived / soft_deleted / degraded 规则）；
6. 重启后恢复 package / deliverable / preparation attempt；
7. 用户面准确展示准备态与「暂不可生成」白话；
8. 定义审阅合同边界（本阶段无真实 version 可接受）；
9. 引入 **仅** `PackagePreparationAttempt`；
10. 旧版直接执行入口默认隐藏并降为兼容入口。

### 1.2 非目标（明确不实现）

- 真实 Word / PPT / HTML / 图片生成（DVL2-03）；
- 创建任何 `DeliverableVersion`（含曾设想的 placeholder / metadata-only）；
- 创建或伪造 `ArtifactRef` / `contentHash` / 文件路径 / 下载入口 / 「已生成版本」；
- `DeliverableGenerationAttempt` / validation attempt 运行记录（DVL2-03+）；
- 完整质量引擎（DVL2-04）；
- `SubjectCandidate` / 七模块写回（DVL2-05）；
- 付费、发布、对外分享执行；
- 重写 renderer-next / 解锁 R3、R2.5、PAN-02；
- 未经评审复用或改造 `src/package-store/**`；
- 把 `runtimeAvailability` 在无真实验收前标为 `available`。

### 1.3 与 DVL2-00 表意对齐说明

DVL2-00 §13 写 DVL2-02 含「ArtifactRef；版本；重启恢复；采用与否定」。本修订解释为：

| 合同要求 | DVL2-02 本阶段落地 |
|----------|-------------------|
| ArtifactRef | **仅保留合同引用说明**；运行时 **不存在**；DVL2-03 真实写出后才创建 |
| 版本 | **不创建** `DeliverableVersion`；`currentVersionId = null`；`versionIds = []` |
| 重启恢复 | **必须**：package / deliverable / preparation attempt 可恢复 |
| 采用与否定 | **定义合同边界**：无真实 version 时不得接受/否定内容；完整审阅 UI 属后续 |

**禁止**：用 placeholder version「占坑后再原地补全」。placeholder **不再存在**。

---

## 2. 用户主路径

```text
用户已确认成果计划
→ 看到「成果计划已准备，尚未开始执行」
→ 点击「准备成果包」
→ 校验 activeConfirmedVersionId
→ 幂等创建或返回既有 DeliverablePackage
→ 展示 CurrentPreparationReadiness（白话）
→ 应用可退出并重启恢复
→ （DVL2-03）调用方传入 packageId 启动真实生成
```

### 2.1 入口原则

- 继续使用「做事」主入口；成果包准备是计划确认后的**执行准备阶段**。
- **唯一成果包准备入口**必须绑定 `Task.deliverablePlanning.activeConfirmedVersionId`。
- 不得读取 `currentDraftVersionId`；不得绕过 confirmed；不得用「最新版本」替代明确确认版本。

### 2.2 成果计划模式主按钮（冻结意图）

| 情形 | 处理 |
|------|------|
| 无 confirmed | 主按钮禁用或提示先确认计划 |
| 有 confirmed、无有效 package | 主按钮 **「准备成果包」** |
| 已有有效 package、能力不可用 | 显示 **「成果包已准备；当前尚无法生成真实文件」**；主操作可为「查看成果包准备」 |
| DVL2-02 全程 | **不出现**「开始生成成果」 |

### 2.3 旧版直接执行入口（兼容）

- **默认隐藏**；
- 仅兼容模式或开发模式可见；
- 必须明确标注：**「不会使用已确认成果计划」**；
- **不得**与「准备成果包」并列为两个主按钮；
- **不得**增加普通用户选择负担。

---

## 3. 领域模型

### 3.1 身份链

**完整身份链（跨任务阶段）**：

```text
DeliverablePackage.id
→ Deliverable.id
→ DeliverableVersion.id          // 仅 DVL2-03+ 真实生成后存在
→ ArtifactRef.contentHash        // 仅真实写出后存在
```

**DVL2-02 运行时实际对象**：

```text
DeliverablePackage.id
→ Deliverable.id
（无 DeliverableVersion；无 ArtifactRef）
```

命名禁止：裸名 `Package` 继续专指主体 Package；成果包只能称 `DeliverablePackage`。

### 3.2 DeliverablePackage（最小字段）

```ts
type DeliverablePackage = {
  schemaVersion: 1;
  id: string;                         // delivery_…
  taskId: string;
  sourcePlanId: string;
  sourcePlanVersionId: string;        // 创建时 confirmed 版本；此后永不可改
  lifecycleStatus: PackageLifecycleStatus;   // 派生，见 §4
  completionStatus: PackageCompletionStatus; // 派生，见 §4
  createdAt: string;
  updatedAt: string;
  deliverableIds: string[];
  executionSnapshot: ExecutionSnapshot;      // 不可变，见 §5
  reviewSummary: PackageReviewSummary;       // 可派生缓存；本阶段通常为空态
  recovery: PackageRecoveryMetadata;
  executionPreparation?: ExecutionPreparationRecord; // 可选：准备阶段元数据（非 Version）
  supersededByPackageId?: string | null;     // 被更新后的新包取代时的关系（非 lifecycle 枚举）
  sourcePlanSuperseded?: boolean;            // 派生/缓存：其 source 计划版本已不再是 activeConfirmed
  localStore: {
    storeKind: "deliverable_packages_json";
    relativeKey: string;              // 逻辑键；非用户下载路径
  };
  revision: number;
  softDeletedAt?: string | null;
  archivedAt?: string | null;
};
```

### 3.3 Deliverable（最小字段）

```ts
type Deliverable = {
  schemaVersion: 1;
  id: string;
  packageId: string;
  sourcePlannedDeliverableId: string;
  kind: string;
  format?: string;
  title: string;
  purpose?: string;
  order: number;
  dependencies: string[];             // 映射后的 Deliverable.id
  planDisposition: "included" | "removed";
  generationStatus: DeliverableGenerationStatus;
  reviewStatus: "unreviewed" | "accepted" | "rejected";
  currentVersionId: null;             // DVL2-02 强制 null
  versionIds: [];                     // DVL2-02 强制空数组
  latestPreparationAttemptId: string | null; // 指向 PackagePreparationAttempt（包级）或本项准备痕迹；非 generation
  capabilityRequirements: unknown;
  riskFlags: unknown[];
  createdAt: string;
  updatedAt: string;
};
```

继续使用冻结三维：`planDisposition` × `generationStatus` × `reviewStatus`。

### 3.4 DeliverableVersion / ArtifactRef（本阶段禁止创建）

| 规则 | 冻结 |
|------|------|
| DVL2-02 创建 | **仅** `DeliverablePackage` + `Deliverable` |
| DVL2-02 **不**创建 | 任何 `DeliverableVersion` |
| `currentVersionId` | **恒为 `null`** |
| `versionIds` | **恒为 `[]`** |
| `ArtifactRef` | **不存在** |
| `contentHash` | **不存在** |
| 真实内容后 | **仅 DVL2-03** 创建 `DeliverableVersion` + `ArtifactRef` |
| placeholder | **废除**；禁止「先 placeholder 再原地补全/覆盖」 |

执行准备信息写入 `executionPreparation` 或 `PackagePreparationAttempt`，**绝不**写入 `DeliverableVersion`。

### 3.5 PackagePreparationAttempt（DVL2-02 唯一允许的 Attempt）

```ts
type PackagePreparationAttempt = {
  schemaVersion: 1;
  id: string;                         // pprep_…
  packageId: string | null;           // 成功前可为 null；成功后必填
  taskId: string;
  sourcePlanVersionId: string;
  status: "started" | "succeeded" | "failed" | "interrupted" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorSummary: string | null;        // 用户可读；无密钥
  createdPackageId: string | null;    // 成功时 = 新建或幂等返回的 packageId
  recoveryMetadata: Record<string, unknown>;
};
```

**阶段所有权**：

| Attempt | 所有者 | DVL2-02 |
|---------|--------|---------|
| `PackagePreparationAttempt` | 本任务 | **允许**运行时创建 |
| `DeliverableGenerationAttempt` | DVL2-03 | **禁止**预创建运行记录 |
| validation attempt | DVL2-04 附近 | **禁止** |

若未来统一 Attempt 超类型，必须带：

```ts
attemptType: "package_preparation" | "deliverable_generation" | "validation"
```

且 **DVL2-02 运行时只允许 `package_preparation`**。本修订推荐使用独立类型名 `PackagePreparationAttempt`，避免枚举污染。

### 3.6 Task.deliverableExecution（严格）

**不要**把 `activePackageId` 放进 `deliverablePlanning`。

```ts
Task.deliverablePlanning = {
  planId: string | null;
  currentDraftVersionId: string | null;
  activeConfirmedVersionId: string | null;
};

Task.deliverableExecution = {
  activePackageId: string | null;
};
```

#### 3.6.1 `activePackageId` 定义

只能指向：**当前 `activeConfirmedVersionId` 对应的、生命周期有效的、可继续准备或（未来）执行的唯一 `DeliverablePackage`**。

#### 3.6.2 写入不变量

```text
activePackage.taskId
  == Task.id（或 Task.taskId，与现有 Task 主键字段对齐）
activePackage.sourcePlanId
  == Task.deliverablePlanning.planId
activePackage.sourcePlanVersionId
  == Task.deliverablePlanning.activeConfirmedVersionId
同一 taskId + confirmedPlanVersionId 最多一个「有效」package
（有效 = 非 soft_deleted、非仅历史隔离；archived 见 §7）
```

#### 3.6.3 `activePackageId` **不**表示

- 最近查看的 package；
- 最后创建的任意 package；
- 任意历史 package；
- 「已完成或已接受」成果包的收藏指针。

---

## 4. 状态枚举映射（逐字对齐 DVL2-00）

保留 DVL2-00 已冻结枚举，**不自行修改**、不把 `blocked` / `not_started` 写入包级冻结枚举。

### 4.1 DeliverablePackage

| 维度 | DVL2-00 合法值 | DVL2-02 实际使用值 | 用户面白话（示例） | 持久权威？ | 派生视图？ |
|------|----------------|-------------------|-------------------|------------|------------|
| `lifecycleStatus` | `planned` \| `in_progress` \| `stopping` \| `stopped` \| `completed` \| `interrupted` | 典型 **`planned`**（尚未真实生成入队） | 「成果包已建立，尚未开始生成」 | 是（按 DVL2-00 规则派生后写入/缓存须可重算一致） | 派生自 deliverable 集合；可缓存 |
| `completionStatus` | `none` \| `partial` \| `ready` \| `ready_with_failures` \| `partially_accepted` \| `accepted` \| `failed` | 典型 **`none`** | 「还没有可交付的成品」 | 是（同上） | 派生 |
| （禁止）`blocked` | — | **不得写入** | — | — | — |
| （禁止）`not_started` | — | **不得写入**包枚举 | — | — | — |

### 4.2 Deliverable

| 维度 | DVL2-00 合法值 | DVL2-02 实际使用值 | 用户面白话（示例） | 持久权威？ | 派生视图？ |
|------|----------------|-------------------|-------------------|------------|------------|
| `planDisposition` | `included` \| `removed` | 创建时按计划快照；默认 **`included`** | 「在本成果包内」/「已从计划移除」 | 是 | 否（字段本身权威） |
| `generationStatus` | `planned` · `queued` · `generating` · `generated` · `validating` · `ready` · `failed` · `cancel_requested` · `cancelled` · `interrupted` · `superseded` | 典型停在 **`planned`**；准备包 **不得**因此进入 `queued`/`generating` | 「尚未生成」 | 是 | 有 version 后可由 current 投影；本阶段无 version，字段本身为权威 |
| `reviewStatus` | `unreviewed` \| `accepted` \| `rejected` | **`unreviewed`**；无 version 时禁止 `accepted`/`rejected` | 「尚未审阅」 | 是 | 有 version 后绑定 version |

### 4.3 用户面「暂不可生成 / 等待能力」

**只属于** `CurrentPreparationReadiness` 或 `PackagePreparationView`（§5.2 / §10），**不是**包级冻结枚举值。

### 4.4 审阅不变量（继承 DVL2-00；本阶段边界）

- 接受/否定绑定具体 `DeliverableVersion.id`；
- DVL2-02 无 version → **不得**把 package/deliverable 标为内容已接受；
- `currentVersionId` ≠ 已接受；本阶段 `currentVersionId` 恒 `null`；
- package `completion=accepted` **不**因「已准备」成立。

---

## 5. ExecutionSnapshot 与 CurrentPreparationReadiness

### 5.1 ExecutionSnapshot（不可变）

创建时冻结，之后 **不得修改**：

```ts
type ExecutionSnapshot = {
  schemaVersion: 1;
  taskId: string;
  planId: string;
  confirmedPlanVersionId: string;
  plannedDeliverables: PlannedDeliverable[]; // 创建时拷贝
  dependencies: Array<{ fromId: string; toId: string }>;
  planningAvailabilitySnapshot: unknown;     // 计划确认时的可用性快照
  riskDeclarations: unknown[];               // 风险声明（非「当前授权是否仍有效」）
  inputSummary: {
    goal: string;
    audience?: string;
    usage?: string;
    understandingSummary?: string;
  };
  sourcePlanDigest: string;                  // canonical JSON 的 sha256
  createdAt: string;
  triggerSource: "prepare_package_ui" | "prepare_package_ipc" | "recovery_rebind";
};
```

**不得**把下列动态事实当作 snapshot 永久权威：

- 当前能力是否可用；
- 当前授权是否有效；
- 当前依赖是否满足；
- 当前冲突是否存在；
- 当前是否可执行。

### 5.2 CurrentPreparationReadiness（可重算）

```ts
type CurrentPreparationReadiness = {
  schemaVersion: 1;
  packageId: string;
  status:
    | "ready_for_future_generation"
    | "waiting_for_capability"
    | "blocked_by_authorization"
    | "blocked_by_dependency"
    | "blocked_by_consistency"
    | "degraded";
  capabilityReadiness: "ready" | "unavailable" | "unknown";
  authorizationReadiness: "satisfied" | "required" | "unknown";
  dependencyReadiness: "satisfied" | "unsatisfied" | "unknown";
  consistencyReadiness: "ok" | "degraded" | "fail_closed";
  requiredUserActions: string[];     // 白话；默认少而准
  blockerSummaries: string[];        // 白话；无内部 ID/枚举原文
  evaluatedAt: string;
};
```

规则：

1. **可重算**；每次打开/准备/启动前重算；
2. **不覆盖** `ExecutionSnapshot`；
3. 「暂不可生成」「等待能力」只出现在本对象或 UI 投影中；
4. 可与 DVL2-01 `CurrentExecutionReadiness` 组合使用，但本对象以 **package** 为中心。

### 5.3 PackagePreparationView（UI 投影，非权威）

默认层字段：理解摘要、成果数量、准备状态白话、阻塞原因白话、一个主操作。内部 ID/枚举不默认暴露。

---

## 6. 新 confirmed 与旧 package（明确推荐）

| 规则 | 推荐 |
|------|------|
| 旧 package.`sourcePlanVersionId` | **永远不可修改** |
| 新 confirmed 出现后 | 旧 package **保留为历史** |
| 绑定 | **不**静默把旧 package 绑到新 confirmed |
| `Task.deliverableExecution.activePackageId` | **立即清空为 `null`**，并记审计 `active_package_stale_cleared`；同时可将旧包标记 `sourcePlanSuperseded=true`（字段/派生均可，**不是** lifecycle 新枚举） |
| 用户再点「准备成果包」 | 为 **新** confirmed 版本创建 **新** package，并写入新的 `activePackageId` |
| 旧 package | **不**自动物理删除 |
| DVL2-00 无 `superseded` lifecycle 值 | **不得自创** lifecycle 值；用 `supersededByPackageId`（新包创建后回写旧包关系）与/或 `sourcePlanSuperseded=true` 表达 |

**推荐写入序（新 confirmed 后首次准备）**：① 创建新 package（CAS）→ ② 旧包写 `supersededByPackageId`（若定位得到）→ ③ Task.`activePackageId`=新包。

---

## 7. 幂等与一致性矩阵

| # | 情形 | 必须行为 |
|---|------|----------|
| 1 | 同一 `taskId + planId + confirmedPlanVersionId` 已有**有效** package | **返回已有 package，不新建** |
| 2 | 已有 package 为 **archived** | **默认提示恢复**，不静默新建；仅显式「重新建立成果包」才允许新建 |
| 3 | 已有 package 为 **soft_deleted** | **不**静默恢复；**不**因普通点击新建替代包；必须显式恢复或显式新建，并保留审计 |
| 4 | 存在两个有效 package | **fail-closed**；**不**按 `updatedAt` 自动选择 |
| 5 | Package Store 写成功、Task `activePackageId` 写失败 | 标 **`degraded_consistency`**；reconciliation 恢复指针；再次点击前先 reconciliation；**不得**创建第二个 package |
| 6 | 重复点击 | **必须幂等**；**不得**靠刷新 `updatedAt` 伪造新操作 |

### 7.1 写入顺序与恢复

1. 写 Package Store（package + deliverables + preparationAttempts，CAS）；
2. 写 Task.`deliverableExecution.activePackageId`（带期望旧值）；
3. 任一步失败 → degraded + 可重试；启动 reconciliation 以 Package Store 为包权威修复指针；
4. 损坏 fail-closed；孤儿隔离，不静默 purge。

### 7.2 中断恢复

| 情形 | 处理 |
|------|------|
| 仅完成准备后退出 | 重启恢复 package；`generationStatus` 仍为 `planned`；准备态由 readiness 重算；不得伪 completed |
| 准备写入中崩溃 | 不完整包隔离或回滚上一 revision；preparation attempt → `interrupted`/`failed` |
| 重试准备 | 遵循幂等矩阵；成功可新建 preparation attempt 记录，**不覆盖**历史 attempt |
| generation 中断 | **DVL2-03** 合同；本阶段不创建 generation attempt |

---

## 8. Store 合同

### 8.1 推荐

| 项 | 推荐 |
|----|------|
| 文件 | `<userData>/deliverable-packages.json` |
| 模式 | 对齐 task/plan store：原子 rename、写队列、`schemaVersion`、revision/CAS |
| 模块 | 新建 `act-behalf/deliverable-package-store.js` 等 |
| 主体 `package-store/**` | **禁止触碰 / 禁止复用** |

### 8.2 顶层形状（DVL2-02）

```ts
type DeliverablePackageStoreFile = {
  schemaVersion: 1;
  revision: number;
  packages: Record<string, DeliverablePackage>;
  deliverables: Record<string, Deliverable>;
  preparationAttempts: Record<string, PackagePreparationAttempt>;
  updatedAt: string;
};
```

- **不**包含运行时 `versions` / ArtifactRef 集合；
- `DeliverableVersion` Store 与 `ArtifactRef` Store **留到 DVL2-03**；
- 若实现为未来保留空槽 `versions: {}`，则必须：**始终为空**；DVL2-02 **不创建**任何 version；**不得**被 UI 或状态逻辑引用；**不是**本阶段权威对象。**推荐直接省略该字段。**

---

## 9. 审阅合同（本阶段）

1. 接受/否定 API 绑定 `DeliverableVersion.id`；
2. DVL2-02 无 version → API 必须拒绝内容接受，返回「尚无可审阅版本」；
3. 完整审阅 UI 可延后；不得写错 `reviewStatus`。

---

## 10. UI 与减负

### 10.1 默认层只展示

系统理解摘要；成果数量；当前准备状态；阻塞原因；一个主要操作。

### 10.2 默认不暴露

dependency ID；内部状态枚举原文；plan/version/package ID；capability requirement 原始结构；完整风险对象。

### 10.3 原则

默认接受；只确认例外；渐进披露；系统先做可撤销假设；未解决问题不默认变成阻塞问卷。

### 10.4 文案

| 时机 | 文案 |
|------|------|
| 计划确认后（DVL2-01） | 成果计划已准备，尚未开始执行。 |
| 准备成功且能力不可用 | 成果包已准备；当前尚无法生成真实文件。 |
| 幂等命中 | 已有对应成果包，已为你打开。 |
| 禁止 | 「正在生成…」、假路径、假下载、假预览、「开始生成成果」 |

---

## 11. IPC 边界（草案）

| Channel | 作用 |
|---------|------|
| `actBehalf:prepareDeliverablePackage` | 唯一准备入口；校验 confirmed；幂等 |
| `actBehalf:getDeliverablePackage` | 读包 + 重算 readiness |
| `actBehalf:listDeliverablePackagesForTask` | 历史包（默认折叠） |
| `actBehalf:reconcileDeliverablePackages` | 启动/诊断 |

renderer 不得直接写 Store；不得提供「从 draft 准备」正式 API。

---

## 12. 代码映射（只读审计；≠ 授权修改）

### 12.1 可复用

`task-store.js`（扩展 `deliverableExecution`）、`deliverable-plan-store.js`、`deliverable-plan-schema.js`、`deliverable-plan-readiness.js`、`deliverable-plan-consistency.js`、`main.js`/`preload.js` 挂载模式。

### 12.2 必须隔离

`result-generation.js`、旧 `actBehalf:generateResult` / 「开始」链。

### 12.3 禁止触碰

`src/package-store/**`、renderer-next / R3 / R2.5 / PAN-02、四类真实生成器、DVL2-00/01 冻结合同正文。

### 12.4 候选新增（获授权后）

```text
deliverable-package-schema.js
deliverable-package-store.js
deliverable-package-prepare.js
deliverable-package-consistency.js
deliverable-package-recovery.js
deliverable-package-readiness.js
```

### 12.5 候选有界修改（获授权后）

`task-store.js`、`main.js`、`preload.js`、legacy `renderer/app.js`（准备入口 + 旧入口默认隐藏）。

---

## 13. 测试与 Owner 验收

### 13.1 工程测试（获授权后）

confirmed 门禁；幂等矩阵 1–6；无 Version/ArtifactRef；`currentVersionId=null`；`versionIds=[]`；unavailable 时 generation=`planned`、包=`planned`×`none`；snapshot 不可变；readiness 可重算；重启恢复。

### 13.1.1 PackagePreparationAttempt 一致性测试（非阻断；实现期必测）

这不是新领域范围，只是实现期一致性测试要求。`PackagePreparationAttempt` 必须验证：

1. `started` / `interrupted` / `failed` attempt **不得**成为 `activePackageId` 依据；
2. `succeeded` attempt 的 `packageId` 与 `createdPackageId` **必须**一致；
3. 幂等返回既有 package 时，必须能区分 `created_new` 与 `existing_package`；
4. attempt 历史**不可覆盖**；
5. 不完整 attempt **不得**伪装为 package 已准备成功。

### 13.2 Owner 应看到

可准备成果包；准备态白话；能力未就绪说明；重启仍在；重复准备不双包；旧入口默认不可见。

### 13.3 Owner 不得看到

真文件；假下载/路径/进度/预览；placeholder version；「开始生成成果」；内部 ID 堆砌。

---

## 14. 风险与推荐（摘要）

| # | 问题 | 推荐 |
|---|------|------|
| 1 | 无法生成时是否创建真实 Package？ | **是** |
| 2 | 同 confirmed 多有效 package？ | **否** |
| 3 | `activePackageId` 位置？ | **`Task.deliverableExecution`** |
| 4 | 主按钮？ | **「准备成果包」**；无「开始生成成果」 |
| 5 | 旧执行入口？ | **默认隐藏**兼容入口 |
| 6 | Store？ | `deliverable-packages.json` |
| 7 | package-store？ | **隔离禁止** |
| 8 | Attempt？ | **仅 PackagePreparationAttempt** |
| 9 | blocked 语义？ | **仅 readiness/视图** |
| 10 | DVL2-03 输入？ | **唯一正式入参 `packageId`**（见 §18） |

---

## 15. 实施阶段拆分（未授权）

| 阶段 | 内容 | 退出 |
|------|------|------|
| A | Store + schema + prepare 幂等 + `deliverableExecution` + reconciliation | 合同测试绿 |
| B | legacy 薄 UI：准备入口、减负默认层、旧入口默认隐藏 | 烟测 |
| C | **PackagePreparationAttempt** + preparation recovery；**无** DeliverableVersion；**无** ArtifactRef；**无**真实文件 | 无 version/伪造引用断言 |
| D | Owner 真机验收 | 另批 |

---

## 16. 禁止偷跑

不实现四类生成器；不创建 Version/ArtifactRef；不标 `runtimeAvailability=available`；不改造 `package-store/**`；不启动 DVL2-03～05；不解锁暂停项；不把旧 `generateResult` 接到 confirmed 计划；不改 DVL2-00/01 冻结合同正文；在获 `implementation_authorized` 前不改 `digitalme-app/**`。

---

## 17. 退出条件（规格阶段）

Owner 规格接受与冻结已完成（`specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`）。实施仍为 `not_started`；`implementation_authorized=false`。下一步：另行完成 **implementation_authorization 评审**（见文首门禁）后方可创建实现分支与编码。当前 **仍不满足** 实施授权条件。

---

## 18. DVL2-03 输入合同（冻结意图；非本任务实现）

**DVL2-03 唯一正式输入是 `packageId`。**

### 18.1 禁止

- 只传 `taskId` 后由 DVL2-03 自行选择 plan；
- 从 current draft 执行；
- 从「最新 plan」推断；
- 绕过 `DeliverablePackage`；
- 把 `Task.deliverableExecution.activePackageId` 当作 DVL2-03 **唯一调用合同**（它只用于 UI 默认导航/选择）。

### 18.2 启动前必须验证

1. package 存在；
2. package 生命周期有效（可继续执行的语义下有效）；
3. `sourcePlanVersionId` 是明确 confirmed 版本；
4. `executionSnapshot` 完整；
5. Deliverable 依赖图合法；
6. `currentVersionId` 为空 **或** 指向真实 version（DVL2-02 结束时应为空；生成后指向真实 version）；
7. **不存在** placeholder version；
8. `CurrentPreparationReadiness` 重算通过（或按门禁允许的子集）；
9. 授权与风险门禁通过。

通过后：仅为 `available` 且授权满足的项创建 **`DeliverableGenerationAttempt`**，转入 `queued`，真实写出后创建 `DeliverableVersion` + 有效 `ArtifactRef`。

---

## 19. 明确不做（本接受/冻结阶段）

- 不修改 `digitalme-app/**`、测试、`package.json`、lockfile；
- 不创建实现分支；不编码；不生成真实成果；
- 不标 `implementation_authorized` / `implementation_in_progress` / `implemented` / `owner_runtime_accepted` / `accepted_as_implemented` / `completed`；
- 不启动 DVL2-03；
- 不 push。

---

## 20. 文档同步清单（本轮允许）

| 文件 | 动作 |
|------|------|
| 本文 | Owner 接受与规格冻结 → **v0.1.1** / `specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`；实施仍 `not_started`；`implementation_authorized=false`；冻结基线 `578648f` |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 最小同步：规格已冻结；等待 implementation_authorization；**不得**开始编码 |

---

## 21. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0-draft | 2026-07-26 | 初稿：`codex_review_pending`；基线 `690e1fc` |
| v0.1.0-draft（R1 修订） | 2026-07-26 | **Codex 第一轮文档修订（历史）**：当时状态曾为 `spec_drafting` / `codex_review_changes_requested`。删除 placeholder Version；明确 preparation attempt；`activePackageId` 迁入 `deliverableExecution`；幂等与 Snapshot/Readiness 分离等。实施仍 `not_started`；基线 `e72f7bd` |
| v0.1.0-draft（Codex final review） | 2026-07-26 | **Codex 最终规格复核通过（历史）**：当时状态曾为 `spec_drafting` / `codex_review_passed` / `ready_for_owner_spec_acceptance`。等待 Owner 规格接受；实施未授权、未开始。基线 `e72f7bd`（复核收口提交 `578648f`） |
| **v0.1.1（Owner accepted and frozen）** | 2026-07-26 | **Owner 正式接受并冻结**。Codex 规格复核已通过；Owner 正式接受；状态 → `specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`；implementation 仍为 `not_started`；`implementation_authorized=false`；规格冻结基线 `578648f31d86594cc2bd56ede2e367122cfa98f8`；未改实现；未启动 DVL2-03；下一步为 implementation_authorization 评审 |
