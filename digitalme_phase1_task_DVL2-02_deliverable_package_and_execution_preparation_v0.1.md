# 任务包 DVL2-02：成果包实例与执行准备

版本：v0.1.0-draft
日期：2026-07-26
状态：`spec_drafting` / `codex_review_pending`
实施：`not_started`
上位合同：
- [`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（**DVL2-00 v0.1.1** / `owner_accepted` / `frozen_for_implementation`）
- [`digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md`](digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md)（**DVL2-01 v0.1.1** / `accepted_as_implemented` / 实施 `implemented` @ `6e7c384`）
基线：`690e1fc1663d44b180a70c1d4f5f777f4eea42d5`
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)

> **正式边界（草案）**：本文仅起草规格，供 Codex / Owner 评审。**不是**实现授权。不得标 `owner_accepted` / `frozen_for_implementation` / `implementation_authorized` / `implementation_in_progress`。冲突时：架构原则文 > DVL2-00 > DVL2-01 > 本文。发现冻结合同缺口须先回改 DVL2-00，不得在实现中静默偏离。

---

## 0. 文档地位

1. 承接 DVL2-00 §13「DVL2-02 成果包与本地交付」与 DVL2-01 §20 交接点：从已确认计划版本建立可恢复的 `DeliverablePackage` 实例。
2. 解决 Owner / DVL2-01 P1「执行入口衔接」：成果计划模式下的执行准备必须绑定 `Task.deliverablePlanning.activeConfirmedVersionId`。
3. 落实 Owner 在 DVL2-01 验收提出的减负原则（默认接受、只确认例外、渐进披露）。
4. **本任务不生成真实 Word / PPT / 网页 / 图片**；不为四类产物伪造 `ArtifactRef`、路径、下载入口或生成进度。

---

## 1. 产品目标与非目标

### 1.1 目标

> 用户确认成果计划后，系统建立一个稳定、可恢复、可审阅、可继续执行的成果包实例，并为 DVL2-03 真实生成提供唯一、明确的输入。

目标链路（冻结意图）：

```text
Task.deliverablePlanning.activeConfirmedVersionId
→ 创建执行快照（ExecutionSnapshot）
→ 创建 DeliverablePackage
→ 为 included PlannedDeliverable 创建 Deliverable
→ 建立本地持久化
→ 显示执行准备状态（非伪生成）
→ 支持中断与重启恢复
→ 为 DVL2-03 提供稳定输入
```

必须实现的产品能力（获实施授权后）：

1. 仅从 `activeConfirmedVersionId`（或显式指定的 confirmed `versionId`）创建成果包；
2. 冻结执行快照，后续 plan draft / 新 confirmed **不得**静默改变既有成果包；
3. 为每个 `planDisposition=included` 的计划项创建 `Deliverable`；
4. 本地持久化、原子写、启动 reconciliation、fail-closed；
5. 幂等「准备成果包」；
6. 重启后恢复 package / deliverable 元数据与准备状态；
7. 用户面准确展示「已准备 / 因能力未就绪而暂不可生成」；
8. 定义审阅合同与占位流程（完整审阅 UI 可延后，但不得写错语义）；
9. 定义 Attempt / Version / ArtifactRef 对象合同（可无真实文件）；
10. 明确隔离旧版「开始」直接执行链。

### 1.2 非目标（明确不实现）

- 真实 Word / PPT / HTML / 图片生成（属 DVL2-03）；
- 伪造 `ArtifactRef` / `contentHash` / 文件路径 / 下载入口 / 「已生成版本」；
- 完整质量引擎（DVL2-04）；
- `SubjectCandidate` / 七模块写回（DVL2-05）；
- 付费、发布、对外分享执行；
- 重写 renderer-next / 解锁 R3、R2.5、PAN-02；
- 未经评审复用或改造 `src/package-store/**`（主体 Package 店铺）；
- 把 `runtimeAvailability` 在无真实验收前标为 `available`。

### 1.3 与 DVL2-00 表意对齐说明

DVL2-00 §13 写 DVL2-02 含「ArtifactRef；版本；重启恢复；采用与否定」。本草案解释为：

| 合同要求 | DVL2-02 本阶段落地 |
|----------|-------------------|
| ArtifactRef | **定义对象与持久化槽位**；仅当真实内容写出后才填有效引用（本阶段保持 `null` / 不创建假引用） |
| 版本 | 定义 `DeliverableVersion`；允许 metadata-only / placeholder candidate；**禁止**宣称已生成 |
| 重启恢复 | **必须**：package / deliverable 元数据与准备状态可恢复 |
| 采用与否定 | **定义合同 + 最小占位流程**；完整审阅 UI 可列为实施子阶段，但语义不可错 |

---

## 2. 用户主路径（草案）

```text
用户已确认成果计划
→ 看到「成果计划已准备，尚未开始执行」
→ 点击「准备成果包」（唯一成果包执行入口）
→ 系统校验 activeConfirmedVersionId
→ 创建或返回既有 DeliverablePackage
→ 展示准备结果：成果数量、准备状态、阻塞原因（若有）
→ 应用可退出并重启恢复
→ （DVL2-03）在能力可用时再开始真实生成
```

### 2.1 入口原则

- 继续使用「做事」主入口；成果包准备是计划确认后的**执行准备阶段**，不是新的一级导航。
- **唯一成果包执行入口**必须绑定 `Task.deliverablePlanning.activeConfirmedVersionId`。
- 不得读取 `currentDraftVersionId` 执行；不得绕过 confirmed；不得用「最新版本」替代明确确认版本；不得静默回落到旧版 `actBehalf:generateResult` 研究表达链并伪装为按计划执行。

### 2.2 「开始」按钮产品处理（推荐，待 Owner 确认）

| 情形 | 推荐处理 |
|------|----------|
| 无 `activeConfirmedVersionId` | 不得进入成果包准备；主操作保持规划流或明确禁用 |
| 有 confirmed，且走成果计划模式 | 主按钮改为 **「准备成果包」**（或等价准确语义）；点击只创建/打开 package，不伪装生成 |
| 真实生成能力尚不可用 | 准备成功后文案：**「成果包已准备；当前尚无法生成真实文件」**；不得显示生成进度条冒充执行 |
| 旧版研究表达「开始」 | **隔离保留**：仅对未进入成果计划流程（无 plan 指针）的历史任务可见；须标注「旧版直接执行」；**不得**与「按确认计划准备成果包」混用同一语义 |

---

## 3. 领域模型

### 3.1 身份链（强制）

```text
DeliverablePackage.id
→ Deliverable.id
→ DeliverableVersion.id
→ ArtifactRef.contentHash   // 仅真实写出后存在；DVL2-02 不得伪造
```

命名禁止：裸名 `Package` 继续专指主体 Package；成果包只能称 `DeliverablePackage`。

### 3.2 DeliverablePackage（最小字段）

```ts
type DeliverablePackage = {
  schemaVersion: 1;
  id: string;                         // delivery_…
  taskId: string;
  sourcePlanId: string;
  sourcePlanVersionId: string;        // = confirmedPlanVersionId
  lifecycleStatus: PackageLifecycleStatus;   // 派生，见 §4
  completionStatus: PackageCompletionStatus; // 派生，见 §4
  createdAt: string;
  updatedAt: string;
  deliverableIds: string[];
  executionSnapshot: ExecutionSnapshot;      // 不可变引用/摘要，见 §5
  reviewSummary: PackageReviewSummary;       // 可派生缓存
  recovery: PackageRecoveryMetadata;
  localStore: {
    storeKind: "deliverable_packages_json";
    relativeKey: string;              // 逻辑键；非用户下载路径
  };
  revision: number;                   // CAS / 乐观并发
  softDeletedAt?: string | null;
  archivedAt?: string | null;
};
```

说明：

- 继续使用 DVL2-00 冻结双维：`lifecycleStatus` × `completionStatus`；**不得**合并为单一模糊 `status`。
- `goal` / `audience` / `usage` / `visibility` 等可从 snapshot 投影到包级只读字段，便于列表展示；权威仍以 snapshot 为准。

### 3.3 Deliverable（最小字段）

每个 confirmed 计划中 `included` 的 `PlannedDeliverable` 映射为一个 `Deliverable`：

```ts
type Deliverable = {
  schemaVersion: 1;
  id: string;                         // deliverable_…
  packageId: string;
  sourcePlannedDeliverableId: string;
  kind: string;
  format?: string;
  title: string;
  purpose?: string;
  order: number;
  dependencies: string[];             // 引用其他 Deliverable.id 或计划项映射后的 id
  planDisposition: "included" | "removed";
  generationStatus: DeliverableGenerationStatus;
  reviewStatus: "unreviewed" | "accepted" | "rejected";
  currentVersionId: string | null;
  latestAttemptId: string | null;
  capabilityRequirements: unknown;    // 自计划拷贝；UI 默认不暴露原始结构
  riskFlags: unknown[];
  createdAt: string;
  updatedAt: string;
};
```

继续使用冻结三维：`planDisposition` × `generationStatus` × `reviewStatus`。

### 3.4 DeliverableVersion（本阶段）

```ts
type DeliverableVersion = {
  schemaVersion: 1;
  id: string;                         // dver_…
  deliverableId: string;
  version: number;
  kind: "metadata_placeholder" | "generated"; // DVL2-02 仅允许 metadata_placeholder
  generationStatus: DeliverableGenerationStatus;
  reviewStatus: "unreviewed" | "accepted" | "rejected";
  artifactRef: null;                  // DVL2-02 强制 null
  contentAvailable: false;            // DVL2-02 强制 false
  attemptId: string | null;
  provenance: Record<string, unknown>;
  supersedesVersionId: string | null;
  supersededByVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

**禁止**：在 DVL2-02 创建 `kind=generated`、非空 `artifactRef`、假 `contentHash`、假路径或下载入口。

### 3.5 DeliverableAttempt（推荐：本阶段引入）

```ts
type DeliverableAttempt = {
  schemaVersion: 1;
  id: string;                         // attempt_…
  deliverableId: string;
  packageId: string;
  purpose: "package_preparation" | "generation" | "validation";
  status: "started" | "succeeded" | "failed" | "interrupted" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;        // 用户可读；无密钥
  producesVersionId: string | null;
};
```

**推荐**：DVL2-02 **引入** Attempt 对象与持久化。准备包时可写 `purpose=package_preparation` 的成功 attempt；`purpose=generation` 的 attempt **留到 DVL2-03** 再创建。历史 attempt **不得覆盖**。

### 3.6 ArtifactRef

完整形状遵循 DVL2-00 §4.6。DVL2-02：

- 合同与 schema **必须**存在；
- 运行时 **不得**写入伪造引用；
- `DeliverableVersion.artifactRef` 保持 `null`，直至 DVL2-03 真实写出。

### 3.7 Task 指针扩展（推荐）

```ts
// ActBehalfTask 增量（与 deliverablePlanning 并列或内嵌）
deliverablePlanning: {
  planId: string | null;
  currentDraftVersionId: string | null;
  activeConfirmedVersionId: string | null;
  activePackageId: string | null;     // 新增：当前活动成果包
};
```

**推荐**：增加 `activePackageId`。语义：指向该 task 当前用于继续执行/展示的 package；不等于历史唯一 package。

---

## 4. 状态模型（与 DVL2-00 对齐）

### 4.1 包级枚举（冻结，不得自创冲突值）

**`lifecycleStatus`**（DVL2-00）：

`planned` | `in_progress` | `stopping` | `stopped` | `completed` | `interrupted`

**`completionStatus`**（DVL2-00）：

`none` | `partial` | `ready` | `ready_with_failures` | `partially_accepted` | `accepted` | `failed`

**明确禁止**在包级发明：`blocked`、`not_started` 作为 `completionStatus` / `lifecycleStatus` 新枚举值。

### 4.2 单项 `generationStatus`（冻结）

`planned` · `queued` · `generating` · `generated` · `validating` · `ready` · `failed` · `cancel_requested` · `cancelled` · `interrupted` · `superseded`

### 4.3 DVL2-02 典型状态（能力尚不可用时）

在 document / presentation / webpage / image 的 `runtimeAvailability=unavailable` 时：

| 对象 | 推荐状态 | 说明 |
|------|----------|------|
| Package `lifecycleStatus` | `planned` | 尚未入队真实生成 |
| Package `completionStatus` | `none` | 尚无 ready/accepted/failed |
| Deliverable `generationStatus` | `planned` | **不得**因「准备包」进入 `queued`/`generating` |
| Deliverable `reviewStatus` | `unreviewed` | |
| `currentVersionId` | `null` 或仅指向 metadata_placeholder（且不得当已生成） | 推荐默认 `null`，避免 UI 误读 |

用户面「阻塞 / 尚未可生成」来自 **派生准备态**（§4.4），不是新的包级枚举。

### 4.4 用户面准备态（派生，非持久权威枚举）

```ts
type PackagePreparationView = {
  status:
    | "needs_confirmed_plan"
    | "ready_to_prepare"
    | "prepared_waiting_generation"
    | "partially_executable"
    | "not_executable"
    | "degraded";
  userSummary: string;     // 中性白话
  blockerSummaries: string[]; // 无内部 ID/枚举原文
  primaryAction:
    | "prepare_package"
    | "open_package"
    | "wait_for_generation_capability"
    | "fix_plan"
    | "none";
};
```

派生输入：`activeConfirmedVersionId`、既有 `activePackageId`、`CurrentExecutionReadiness`（DVL2-01）、package 持久化是否完整。

### 4.5 审阅不变量（继承 DVL2-00）

- 接受/否定绑定具体 `DeliverableVersion.id`；
- `currentVersionId` ≠ 已接受；
- package `completionStatus=accepted` **不**自动等于「用户点过准备」；
- 新版本不继承旧版本接受状态；
- DVL2-02 可只做合同 + 占位；不得在无 version 内容时显示「已采用真实成果」。

---

## 5. 执行快照（ExecutionSnapshot）

创建 `DeliverablePackage` 时必须冻结：

```ts
type ExecutionSnapshot = {
  schemaVersion: 1;
  taskId: string;
  planId: string;
  confirmedPlanVersionId: string;
  confirmedPlanContent: {
    // 不可变拷贝或内容哈希 + 结构化摘要；不得只存可变指针
    versionId: string;
    understandingSummary: string;
    items: PlannedDeliverable[];   // included + 创建时的 disposition 快照
    contentDigest: string;         // sha256 of canonical JSON
  };
  planningAvailabilitySnapshot: unknown; // 来自计划版本，创建后不可改
  capabilityAvailabilityAtCreate: CapabilityAvailabilitySummary;
  createdAt: string;
  createdBy: "user" | "system";
  triggerSource: "prepare_package_ui" | "prepare_package_ipc" | "recovery_rebind";
  riskAndAuthorization: {
    listedRisks: unknown[];
    authorizationsSatisfied: boolean;
    notes: string[];
  };
};
```

规则：

1. 快照在 create 时写入后 **不可变**；
2. 后续 draft / 新 confirmed **不得**静默改写既有 package 的 snapshot；
3. 新 confirmed 若需执行，创建 **新** package（见 §8）；
4. DVL2-03 执行前仍须 **重算** `CurrentExecutionReadiness`；快照只证明「按哪版计划准备」，不证明「此刻仍可生成」。

---

## 6. Store 合同

### 6.1 推荐方案

| 项 | 推荐 |
|----|------|
| 文件 | `<userData>/deliverable-packages.json` |
| 模式 | 对齐 `act-behalf-tasks.json` / `deliverable-plans.json`：单文件 JSON、原子 rename、进程内 write queue、`schemaVersion`、revision/CAS |
| 模块 | **新建** `digitalme-app/src/act-behalf/deliverable-package-store.js`（及 schema / consistency / recovery 辅助） |
| 与主体 Package | **完全隔离** |

### 6.2 与现有 `src/package-store/**` 的关系（审计结论）

| 现有模块 | 用途 | DVL2-02 关系 |
|----------|------|--------------|
| `src/package-store/**` | **主体 Package** 目录店铺（journal、lock、staging、manifest digest） | **禁止触碰 / 禁止复用为成果包存储**；命名冲突风险高 |
| `experience-proposal.js` 等读取 PackageStore | 主体成长/经验提案 | **禁止**把 DeliverablePackage 写入主体 Package |
| `result-generation.js` | 旧研究表达成果（文本 JSON 结果） | **必须隔离**；不得伪装为 DeliverablePackage 生成 |

**不得**把成果包塞进主体 Package 目录语义；**不得**未经评审「顺便改造」package-store。

### 6.3 Store 强制要求

1. 原子写（temp + rename）；
2. 写队列（同进程串行）；
3. `schemaVersion` + 向前兼容的迁移策略（破坏性迁移须显式任务）；
4. 损坏时 fail-closed（可读只读诊断，不假装健康）；
5. package ↔ task ↔ plan 引用一致性检查；
6. startup reconciliation；
7. 孤儿 package / deliverable：**隔离**（标记 `orphaned` / 移入隔离区字段），不得静默 purge；
8. permanent purge 边界：仅显式危险操作 + 审计；默认 soft-delete / archive；
9. CAS：`revision` 或等价 token；冲突返回可重试错误，不静默覆盖。

### 6.4 建议顶层形状

```ts
type DeliverablePackageStoreFile = {
  schemaVersion: 1;
  revision: number;
  packages: Record<string, DeliverablePackage>;
  deliverables: Record<string, Deliverable>;
  versions: Record<string, DeliverableVersion>;
  attempts: Record<string, DeliverableAttempt>;
  updatedAt: string;
};
```

（若单文件过大再拆；本阶段推荐单文件以降低一致性成本。）

---

## 7. 幂等与一致性

### 7.1 推荐决策（明确）

| 问题 | 推荐 |
|------|------|
| 同一 `confirmedPlanVersionId` 是否允许多个 **active** package？ | **否**。同一 `(taskId, confirmedPlanVersionId)` 至多一个非归档/非 soft-deleted 的 active package |
| 重复点击「准备成果包」？ | **幂等**：返回既有 package（更新 `updatedAt` 仅在无语义变化时可省略） |
| 新 confirmed 计划？ | **创建新 package**；旧 package **保留**（可标记 superseded-by-new-plan 于 recovery/审计，不删） |
| Task 是否增加 `activePackageId`？ | **是**；指向当前活动包 |
| 写入顺序 | ① Package Store 写入 package+deliverables（CAS）→ ② Task Store 更新 `activePackageId`（带期望旧指针）→ ③ 失败则 reconciliation 修复指针 |
| 部分写入 | 允许短暂 degraded；启动 reconciliation 以 Package Store 为包权威、Task 指针可修复；不得假装 completed |
| 跨进程 | 同机多实例：依赖文件 CAS；冲突失败可见；不做分布式锁幻想 |

### 7.2 一致性修复（startup）

1. `activePackageId` 指向缺失 package → 清空并审计；若存在唯一匹配 `(taskId, activeConfirmedVersionId)` 的合法 package，可恢复指针；
2. package 的 `sourcePlanVersionId` 与 task `activeConfirmedVersionId` 不一致 → **不改 package**；UI 说明「当前确认计划已变化；既有成果包仍对应旧确认版本」；主操作可「按新确认计划准备新成果包」；
3. deliverable 缺映射 / 多余 → fail-closed 至只读 + 审计，不自动编造计划外 deliverable。

---

## 8. 中断恢复

| 情形 | 处理 |
|------|------|
| 应用退出（仅完成准备、无 generation） | 重启后恢复 package；准备态仍为 `prepared_waiting_generation` / `not_executable`；**不得**显示伪 completed |
| 准备写入中崩溃 | reconciliation：不完整 package 隔离或回滚到上一 revision；不得半包当成功 |
| 未来 generation 中崩溃（合同预留） | `generationStatus → interrupted`；attempt `interrupted`；重试 **新建** attempt，不覆盖历史 |
| 迟到结果 | 继承 DVL2-00：不得自动成为 current；不得在 DVL2-02 伪造迟到文件 |

运行状态与最终成果状态继续分离（lifecycle × completion；generation × review）。

---

## 9. 审阅合同（本阶段）

1. 接受/否定 API 与数据模型绑定 `DeliverableVersion.id`；
2. DVL2-02 **可以**提供「尚无可审阅版本」的空态，而不是假采用；
3. 完整审阅 UI 可作为实施子阶段 B；不得因未做完整 UI 而写错 `reviewStatus`；
4. package `reviewSummary` 仅派生缓存。

---

## 10. UI 与减负原则（落实 DVL2-01 Owner 意见）

### 10.1 默认层只展示

- 系统理解摘要（一句话）；
- 成果数量；
- 当前准备状态（白话）；
- 阻塞原因（白话，至多少量）；
- **一个**主要操作（准备成果包 / 打开已准备成果包 / 等待生成能力）。

### 10.2 默认不得暴露

- dependency ID；
- 内部状态枚举原文；
- plan / version / package ID；
- capability requirement 原始结构；
- 完整风险对象。

### 10.3 原则

- 默认接受，只确认例外；
- 系统先做可撤销假设；
- 未解决问题不默认变成阻塞问卷；
- 专业详细信息放在二级展开区；
- 渐进披露。

### 10.4 确认后 / 准备后文案（推荐）

| 时机 | 文案 |
|------|------|
| 计划确认后（DVL2-01 已冻结） | 成果计划已准备，尚未开始执行。 |
| 成果包准备成功且生成不可用 | 成果包已准备；当前尚无法生成真实文件。 |
| 重复准备 | 已有对应成果包，已为你打开。 |
| 禁止 | 「正在生成文档…」、假路径、假下载、假预览缩略图冒充成品 |

---

## 11. IPC 边界（草案）

建议（命名可微调，语义冻结）：

| Channel | 作用 |
|---------|------|
| `actBehalf:prepareDeliverablePackage` | 唯一准备入口；校验 confirmed；幂等创建/返回 |
| `actBehalf:getDeliverablePackage` | 读取包与派生准备态 |
| `actBehalf:listDeliverablePackagesForTask` | 历史包列表（默认折叠） |
| `actBehalf:reconcileDeliverablePackages` | 启动/诊断用（可不对 renderer 暴露） |

规则：

- renderer **不得**直接写 Store；
- 准备入口必须在 main 侧校验 `activeConfirmedVersionId`；
- 不得提供「从 draft 准备」的正式 API。

---

## 12. 代码映射（只读审计；≠ 授权修改）

### 12.1 可复用（模式 / 调用）

| 资产 | 用途 |
|------|------|
| `act-behalf/task-store.js` | userData JSON + 原子写 + write 模式；扩展 `activePackageId` |
| `act-behalf/deliverable-plan-store.js` | Plan Store / CAS 模式样板 |
| `act-behalf/deliverable-plan-schema.js` | 计划项字段、included 过滤 |
| `act-behalf/deliverable-plan-readiness.js` | `CurrentExecutionReadiness` 重算 |
| `act-behalf/deliverable-plan-consistency.js` | 指针一致性思路 |
| `main.js` 中 plan IPC 装配方式 | 新 IPC 挂载方式可对齐 |
| `preload.js` 暴露模式 | 薄封装 |

### 12.2 必须隔离

| 资产 | 原因 |
|------|------|
| `act-behalf/result-generation.js` | 旧研究表达成果链；非 DeliverablePackage |
| `btn-act-run` / `actBehalf:generateResult` | 旧「开始」；不得伪装按确认计划执行 |
| 主体成长 / experience-proposal 写 Package | 不同对象生命周期 |

### 12.3 禁止触碰（本任务未经另批）

| 资产 | 原因 |
|------|------|
| `src/package-store/**` | 主体 Package 店铺；名称易混；策略完全不同 |
| DVL2-03 生成器 / 外部图片能力 | 偷跑 |
| renderer-next / R3 / R2.5 SQLite / PAN-02 | 暂停项 |
| 真实 userData 密钥、主体隐私内容进规格示例 | 隐私 |

### 12.4 候选新增文件（获授权后）

```text
digitalme-app/src/act-behalf/deliverable-package-schema.js
digitalme-app/src/act-behalf/deliverable-package-store.js
digitalme-app/src/act-behalf/deliverable-package-prepare.js
digitalme-app/src/act-behalf/deliverable-package-consistency.js
digitalme-app/src/act-behalf/deliverable-package-recovery.js
digitalme-app/tests/…（合同/store/幂等/恢复）
```

### 12.5 候选有界修改文件（获授权后）

```text
digitalme-app/src/act-behalf/task-store.js          # activePackageId
digitalme-app/src/main.js                          # IPC + reconciliation 挂载
digitalme-app/src/preload.js                       # API 暴露
digitalme-app/src/renderer/app.js                  # 做事页：准备入口文案/按钮隔离（薄适配）
（可选）package.json scripts                       # 仅测试脚本名；本起草阶段禁止改
```

**只读审计 ≠ 授权修改。**

---

## 13. 测试与 Owner 验收

### 13.1 工程测试（获授权后）

1. schema 校验与拒绝非法状态合并；
2. 仅 confirmed 可准备；draft / superseded 拒绝；
3. 幂等准备；新 confirmed → 新 package；
4. CAS 冲突；
5. 启动 reconciliation（断指针、孤儿隔离）；
6. 无 ArtifactRef 伪造；
7. 能力 unavailable 时 generation 保持 `planned`，包为 `planned`×`none`；
8. 重启恢复元数据。

### 13.2 Owner 真机验收：应看到

- 确认计划后可「准备成果包」；
- 准备后看到成果数量与准备状态；
- 说明当前尚不能生成真实文件（若能力未就绪）；
- 重启后成果包仍在；
- 重复准备不产生重复 active 包；
- 旧版直接执行（若仍可见）有明确隔离标识。

### 13.3 Owner 验收：不得看到

- 真实 Word/PPT/HTML/图片文件；
- 虚假下载、路径、生成进度、成果预览成品；
- 伪造 contentHash / ArtifactRef；
- 「已全部生成/已完成交付」等夸大文案；
- 默认界面上的内部 ID / 枚举堆砌。

---

## 14. 风险与未决策（均附推荐）

| # | 问题 | 推荐 | 备选 |
|---|------|------|------|
| 1 | 当前无法生成时是否仍创建真实 DeliverablePackage？ | **是**（DVL2-02 核心价值） | 仅 UI 提示——否决：无法给 DVL2-03 稳定输入 |
| 2 | 同一 confirmed version 多个 active package？ | **否**；幂等返回 | 允许多包——增加选择负担，不默认 |
| 3 | Task 是否增加 `activePackageId`？ | **是** | 每次按 version 查找——可做但 UX/一致性更差 |
| 4 | 「开始」是否改为「准备成果包」？ | **成果计划模式：是** | 保留「开始」但改语义——否决：易误解 |
| 5 | 旧版直接执行入口？ | **隔离+标识**；无 plan 指针任务可保留 | 立即删除——可作后续清理，不阻塞 DVL2-02 |
| 6 | Store：JSON vs 其他？ | **`<userData>/deliverable-packages.json`** | SQLite——R2.5 deferred，不采用 |
| 7 | 与 `src/package-store/**`？ | **隔离，禁止复用改造** | 复用——否决：主体包语义冲突 |
| 8 | DeliverableAttempt 是否引入？ | **是（本阶段）**；generation attempt 留给 DVL2-03 | 延后到 DVL2-03——可，但中断合同会弱 |
| 9 | interrupted / blocked / not_started 划分？ | **包枚举严格用 DVL2-00**；「阻塞」仅用户面派生；generation 在 DVL2-02 停在 `planned` | 自创 `completionStatus=blocked`——否决 |
| 10 | DVL2-03 输入合同？ | `activePackageId` + 不可变 `executionSnapshot` + deliverableIds；执行前重算 readiness；仅 `available` 且授权满足者可 `queued` | 直接读 plan——否决：绕过快照 |
| 11 | Owner 验收看见什么？ | 见 §13.2 / §13.3 | — |

---

## 15. 实施阶段拆分（仅规划；未授权）

| 阶段 | 内容 | 退出 |
|------|------|------|
| A | Store + schema + prepare 幂等 + Task 指针 + reconciliation | 合同测试绿 |
| B | legacy 做事页薄 UI：准备入口、减负默认层、旧入口隔离 | 静态/Electron 烟测 |
| C | Attempt/Version 占位合同挂载（无真实文件） | 无伪造引用断言 |
| D | Owner 真机验收 | `owner_runtime_accepted`（另批） |

不得在未获 `implementation_authorized` 前开始 A–D 编码。

---

## 16. 禁止偷跑

1. 不实现四类真实生成器；
2. 不伪造 ArtifactRef / 路径 / 下载 / 预览成品；
3. 不把 `runtimeAvailability` 标为 `available`；
4. 不改造 `src/package-store/**`；
5. 不启动 DVL2-03～05；
6. 不解锁 R3 / R2.5 / PAN-02；
7. 不把旧 `generateResult` 接到 confirmed 计划上冒充执行；
8. 不修改 DVL2-00 / DVL2-01 冻结合同正文（缺口走正式升版）；
9. 本草案阶段不修改 `digitalme-app/**`。

---

## 17. 退出条件（规格阶段）

规格可升为可冻结候选，当且仅当：

1. Codex 复核关闭本章未决冲突；
2. Owner 接受关键推荐或书面改判 §14；
3. 状态可改为 `codex_review_passed` →（另步）`owner_accepted` / `frozen_for_implementation`；
4. **另获** `implementation_authorized` 后方可建实现分支与编码。

本草案当前：**不满足**冻结与实施条件。

---

## 18. DVL2-03 输入合同（预告，非本任务实现）

DVL2-03 必须：

1. 读取 `Task.deliverablePlanning.activePackageId` → `DeliverablePackage`；
2. 校验 `executionSnapshot.confirmedPlanVersionId` 仍是意图执行的版本（若用户已新确认，须显式选择「按旧包继续」或「准备新包」）；
3. 重算 `CurrentExecutionReadiness`；
4. 仅对 `runtimeAvailability=available` 且风险授权满足的 included deliverable 创建 **generation** attempt 并转入 `queued`；
5. 真实写出后创建 `DeliverableVersion` + 有效 `ArtifactRef`；
6. 不得从 draft 计划生成；不得绕过 package。

---

## 19. 明确不做（本起草阶段）

- 不修改 `digitalme-app/**`、测试、`package.json`、lockfile；
- 不创建实现分支；不编码；不生成真实成果；
- 不标 `owner_accepted` / `frozen_for_implementation` / `implementation_authorized` / `implementation_in_progress`；
- 不 push。

---

## 20. 文档同步清单（本轮允许）

| 文件 | 动作 |
|------|------|
| 本文 | 新建 v0.1.0-draft / `spec_drafting` / `codex_review_pending` / 实施 `not_started` |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 最小同步：DVL2-02 进入规格起草；**未**获实施授权 |

---

## 21. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| **v0.1.0-draft** | 2026-07-26 | 初稿：Owner/CTO 授权起草；待 Codex 复核；实施 `not_started`；基线 `690e1fc` |
