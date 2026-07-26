# 任务包 DVL2-01：成果规划器实施规格

版本：v0.1.1
日期：2026-07-26
状态：`specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation` / `implementation_authorized` / `owner_runtime_accepted` / `accepted_as_implemented`
实施：`implemented`
实现基线：`6e7c38401466c08660890080e763430bf1f3a44d`
上位合同：[`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（**DVL2-00 v0.1.1** / `owner_accepted` / `frozen_for_implementation`）
规格冻结基线：`aa9a8c56186edff9020b0cb0f3633b0571c2a17a`
所属架构：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)

> **正式结论（Owner 真机验收收口）**：DVL2-01 成果规划器已按冻结范围实现并通过 Owner 真机验收（`owner_runtime_accepted` / `accepted_as_implemented`）。此处 `implemented` **仅**表示成果规划器闭环已落地并通过真机验收；**不**表示真实成果生成、成果包交付或按计划执行已经实现。冲突时：架构原则文 > DVL2-00 > 本文。

### Implementation progress

- 2026-07-26：第一轮集中修复——reconciliation fail-closed、Plan Store 严格校验、revision token、archive/soft-delete 同步、planning audit、两阶段进程重启验收。
- 2026-07-26：第二轮集中修复——Plan Store 写临界区 CAS、`callModel→string` adapter、生命周期 severity 收敛、版本链校验增强。
- 2026-07-26：CTO 最终实现复核通过；实现提交 `6e7c384`。
- 2026-07-26：**Owner 真机验收通过** → `owner_runtime_accepted` / `accepted_as_implemented`；实施 `implemented`（范围限定见上）。

### Owner 真机验收记录

**结论**：通过。

已确认：

- 可从自然语言目标形成预计交付；
- 可查看任务理解和成果计划；
- 可对成果项增删改排；
- 可保存草稿；
- 应用重启后可恢复；
- 可确认成果计划；
- 确认后显示「成果计划已准备，尚未开始执行」；
- 未生成真实成果文件；
- 未出现虚假下载、路径、生成进度或成果预览；
- 当前「开始」仍为旧执行链路，不读取 `activeConfirmedVersionId`；
- 当前成果计划 UI 信息较完整，但用户决策负担仍可进一步降低。

### 非阻断后续项（P1；不回开 DVL2-01）

**P1：执行入口衔接**

在按成果计划执行能力完成前：

- 已进入成果计划流程的任务，不应让「开始」按钮被误解为执行已确认计划；
- 建议临时禁用该入口，或明确标注为旧版直接执行；
- 后续执行入口必须绑定 `Task.deliverablePlanning.activeConfirmedVersionId`；
- 不得绕过已确认计划进入旧执行链路。

该问题属于后续阶段前置要求，不回开 DVL2-01。

**P1：计划确认减负**

后续 UI 优化采用渐进披露：

默认简洁层：

- 系统对目标的一句话理解；
- 建议成果数量和摘要；
- 关键假设；
- 「按此计划继续」；
- 「调整计划」。

详细调整层：

- 完整任务理解；
- 成果类型、格式、优先级；
- 依赖和风险；
- 增删改排。

原则：

- 默认接受，只确认例外；
- 系统先做可撤销假设；
- 未解决问题不默认变成阻塞问卷；
- 不向普通用户直接暴露内部依赖 ID、状态枚举等实现字段。

---

## 0. 文档地位

1. 本文承接 DVL2-00 §13「DVL2-01 成果规划器」边界，把自然语言目标 → 结构化任务理解 → 预计成果计划 → 用户轻量修正与确认 → 计划持久化/恢复，写成可实施合同。
2. 本文**不是**实现授权；Codex 复核通过与 Owner 明确实施授权后，方可创建实现分支。
3. 本文**不修改** DVL2-00 已冻结合同；发现合同缺口须先回改 DVL2-00，不得在实现中静默偏离。
4. 确认后的计划可交给后续 DVL2-02 / DVL2-03 执行；**本任务不生成真实成果文件**。

---

## 1. 目标与非目标

### 1.1 目标

> 用户以自然语言表达任务目标后，Digital Me 自动形成结构化任务理解和预计成果计划，用户可以用低认知负担完成修正和确认。确认后的计划可持久化、恢复和交给后续 DVL2-02/DVL2-03 执行，但本任务不生成真实成果文件。

必须实现的产品能力：

1. 用户输入自然语言目标；
2. 系统形成任务理解摘要；
3. 系统识别：`goal`、`audience`、`usage`、`constraints`、`deadline`（可选）、`expectedQuality`；
4. 系统形成预计交付列表；
5. 每项预计交付包含：`kind`、推荐 `format`、`title`、`purpose`、`priority`、`dependencies`、`suggestedExecutionMode`、`capabilityRequirements`、`riskFlags`、`contractSupport`、`runtimeAvailability`；
6. 用户可以：删除、新增、修改类型、修改格式、修改标题和用途、调整优先级、调整顺序、修改受众/用途/约束；
7. 用户确认成果计划；
8. 保存计划版本；
9. 重启后恢复；
10. 可以重新打开并继续修改；
11. 修改已确认计划时创建新的不可变版本（见 §5）；
12. 记录计划形成和修改审计；
13. 派生并展示当前执行就绪度（确认 ≠ 可执行；见 §6）。

### 1.2 非目标（明确不实现）

- 真实 Word / PPT / HTML / 图片生成；
- `ArtifactRef` 真实文件落盘；
- 成果型 `capabilityInvocation`；
- 付费；
- 发布；
- 文件预览；
- 质量验证（DVL2-04）；
- `SubjectCandidate`；
- 七模块写回（DVL2-05）；
- DVL2-02～05 其余交付。

说明：「禁止真实生成能力调用」**不等于**禁止规划模型推理（见 §4.5）。

---

## 2. 用户主路径（冻结）

```text
用户描述目标
→ 系统分析目标
→ 展示任务理解
→ 展示预计交付
→ 用户轻量修正
→ 用户确认成果计划
→ 保存计划
→ 显示“计划已准备，尚未执行”
```

### 2.1 入口原则

- 继续使用「做事」主入口；规划器是做事流程中的**计划阶段**，不是独立工具中心。
- **不得**新增「创作」一级导航（继承 DVL2-00 裁决 #1）。
- **不得**要求用户首先选择：模型、Skill、MCP、Agent、文件保存位置、技术能力、内部工作流。
- **不得**因用户未手动选择产物类型而拒绝开始规划。

### 2.2 确认后用户面文案（冻结）

确认成功后显示：

> 成果计划已准备，尚未开始执行。

不得显示虚假的生成进度、文件路径、或「已生成成果」。若当前 `CurrentExecutionReadiness.status=not_executable`，须另用中性文案说明「当前尚无法执行生成」（不得暗示已排队生成）。

---

## 3. 规划器输入合同

```ts
type CapabilityAvailabilitySummary = {
  schemaVersion: 1;
  capturedAt: string;
  items: Array<{
    capabilityId: string;
    kindHint?: string;
    availability:
      | "available"
      | "unavailable"
      | "not_installed"
      | "unknown"
      | "degraded";
    userLabel: string; // 用户面中性标签；禁止协议名/内部字段名
  }>;
};

type DeliverablePlanningInput = {
  goal: string;
  audience?: string;
  usage?: string;
  constraints?: string[];
  deadline?: string | null;
  expectedQuality?: string;
  availableSubjectContextRef?: string | null;
  availableCapabilitySummary?: CapabilityAvailabilitySummary;
};
```

### 3.1 输入约束

| 规则 | 口径 |
|------|------|
| 唯一必填 | `goal`（非空自然语言） |
| 信息不足 | **不得**拒绝规划；用合理默认值与有限追问补全（§8） |
| 主体完善 | **不得**要求用户先完善数字之我 |
| Package | **不得**将完整主体 Package 复制进规划输入 |
| 主体上下文 | 仅允许任务相关摘要或引用（`availableSubjectContextRef`） |
| 能力 | DVL2-01 **可读取**能力可用性摘要，**不得执行**成果生成能力 |

### 3.2 与 DVL2-00 §3.1 的对齐

DVL2-00 要求受众/用途「是（可系统推断后用户改）」——DVL2-01 实现为：系统可推断并写入 `TaskUnderstanding`（标明推断），用户可编辑；缺失不阻断规划。

---

## 4. 规划器输出合同

```ts
type FieldProvenance =
  | "user_provided"
  | "system_inferred"
  | "unresolved";

type ProvenancedString = {
  value: string | null;
  provenance: FieldProvenance;
};

type TaskUnderstanding = {
  goal: ProvenancedString;
  audience: ProvenancedString;
  usage: ProvenancedString;
  constraints: {
    value: string[];
    provenance: FieldProvenance;
  };
  deadline: ProvenancedString;
  expectedQuality: ProvenancedString;
  assumptions: string[];
  unresolvedQuestions: string[];
  subjectContextUsedRefs: string[];
};

type PlanningRiskSummary = {
  flags: string[];
  notes: string[];
  // 仅记录未来可能需要的风险提示；不得创建有效 authorizationRefs
};

type PlanVersionStatus =
  | "draft"
  | "needs_user_input"
  | "ready_for_confirmation"
  | "confirmed"
  | "superseded"
  | "cancelled";

type ContractSupport =
  | "in_current_product_scope"
  | "reserved_for_future"
  | "out_of_scope";

type RuntimeAvailability =
  | "available"
  | "unavailable"
  | "unknown"
  | "degraded";

type PlannedDeliverable = {
  id: string;
  planDisposition: "included" | "removed";
  kind:
    | "document"
    | "presentation"
    | "webpage"
    | "image"
    | "audio"
    | "video"
    | "dataset"
    | "code"
    | "dashboard"
    | "archive"
    | "other";
  format?: string;
  title: string;
  purpose: string;
  priority: "required" | "recommended" | "optional";
  order: number;
  dependencies: string[]; // PlannedDeliverable.id[]
  suggestedExecutionMode:
    | "digital_me_direct"
    | "external_capability"
    | "delegated_agent"
    | "human_ai_collaboration";
  capabilityRequirements: string[];
  riskFlags: string[];
  contractSupport: ContractSupport;
  runtimeAvailability: RuntimeAvailability;
};

type ExecutionReadinessStatus =
  | "executable"
  | "partially_executable"
  | "not_executable"
  | "unknown";

/** 不可变：写入某 plan version 时的能力/可用性快照（确认时冻结） */
type PlanningAvailabilitySnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  capabilitySummaryRef?: string | null;
  itemSnapshots: Array<{
    itemId: string;
    contractSupport: ContractSupport;
    runtimeAvailability: RuntimeAvailability;
    capabilityRequirements: string[];
  }>;
};

/** 可重算：相对某 confirmed/draft 版本的当前执行评估；可缓存但必须可重算 */
type CurrentExecutionReadiness = {
  schemaVersion: 1;
  basedOnVersionId: string;
  status: ExecutionReadinessStatus;
  executableItemIds: string[];
  blockedItemIds: string[];
  blockers: Array<{
    itemId?: string;
    code: string;
    message: string;
  }>;
  evaluatedAt: string;
  cacheValid?: boolean;
};

type DeliverablePlanVersion = {
  schemaVersion: 1;
  versionId: string;
  planId: string;
  taskId: string; // 必需所属引用；必须等于 ActBehalfTask.taskId
  versionNumber: number;
  understanding: TaskUnderstanding;
  items: PlannedDeliverable[];
  riskSummary: PlanningRiskSummary;
  status: PlanVersionStatus;
  planningAvailabilitySnapshot: PlanningAvailabilitySnapshot;
  planningInvocationRef?: string | null;
  sourceVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
};

type DeliverablePlanRecord = {
  schemaVersion: 1;
  planId: string;
  taskId: string; // 必需所属引用
  currentDraftVersionId: string | null;
  activeConfirmedVersionId: string | null;
  versionIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

> 兼容说明：对外叙述可将「计划版本」简称 `DeliverablePlan`；权威身份以 `DeliverablePlanRecord` + `DeliverablePlanVersion` 为准。**禁止**再使用单一字段 `implementationAvailability=supported_now`。版本上的 `planningAvailabilitySnapshot` **不可**因之后能力变化被改写；当前是否可执行见 `CurrentExecutionReadiness`（§6）。

### 4.1 TaskUnderstanding 认识论约束

必须区分：

- **用户明确提供**（`user_provided`）；
- **系统合理推断**（`system_inferred`）；
- **尚未解决**（`unresolved`，`value` 可为 `null`）。

**不得**把推断伪装成用户事实。UI 须对假设与未明确事项可见（§12）。

### 4.2 合同支持 × 运行可用性（强制拆分）

| 维度 | 取值 | 含义 |
|------|------|------|
| `contractSupport` | `in_current_product_scope` | 本产品轮次合同内目标交付类型 |
| | `reserved_for_future` | 可识别、可规划，但本轮不实现真实生成 |
| | `out_of_scope` | 明确不在产品合同内 |
| `runtimeAvailability` | `available` | 真实生成能力已完成验收，当前可调用 |
| | `unavailable` | 当前不可调用（含「合同内但未实现」） |
| | `unknown` | 无法判定 |
| | `degraded` | 可调用但质量/配额等降级 |

#### 4.2.1 当前基线强制表（DVL2-01 实施时）

| kind | `contractSupport` | `runtimeAvailability` |
|------|-------------------|------------------------|
| `document` / `presentation` / `webpage` / `image` | `in_current_product_scope` | `unavailable` |
| `audio` / `video` | `reserved_for_future` | `unavailable` |
| 其他 kind | 默认 `reserved_for_future` 或 `out_of_scope` | `unavailable`（除非另有只读摘要证明） |

强制：

- **不得**用单一 `supported_now` 把「合同内」伪装成「运行可执行」；
- 只有后续能力完成**真实验收**后，对应 kind 的 `runtimeAvailability` 才可变为 `available`；
- 规划器可以识别音视频需求，但必须明确「当前版本暂不执行」；
- **不得**创建虚假能力承诺；
- 能力变化**不得改写**历史不可变版本中的快照字段；展示层可叠加「重新评估」结果（见 §6）。

### 4.3 推荐 format 示例（非穷尽）

| kind | 推荐 format 例 |
|------|----------------|
| document | `docx` / `md` |
| presentation | `pptx` |
| webpage | `html` |
| image | `png` / `jpg` |

用户可修改 format；DVL2-01 不校验真实生成器是否已实现该格式的写出。

### 4.4 PlannedDeliverable 依赖图校验

同一 `DeliverablePlanVersion` 内：

| 规则 | 口径 |
|------|------|
| 依赖范围 | `dependencies` 只能引用**同一版本**中 `planDisposition=included` 的 item `id` |
| 自依赖 | 禁止 |
| 循环 | 禁止（有向无环） |
| removed | `removed` 项不得作为有效依赖目标 |
| 删除被依赖项 | 必须提示用户，或自动从依赖方移除该依赖并记审计；**不得**静默保留悬空依赖 |
| item ID | 稳定；**不**随排序改变 |
| order | 必须为有限确定值；保存前可规范化为 `0..n-1` 连续序（或等价稳定序）；规范化不得改变 `id` |

校验失败：不得进入 `ready_for_confirmation` / `confirmed`。

### 4.5 规划模型调用边界与隐私

DVL2-01 可采用：

1. **model-assisted planning**（模型辅助规划）；
2. **rule-based fallback planning**（规则降级规划）。

允许规划模型调用完成理解、结构化和建议，但必须：

- 复用现有模型路由、密钥与隐私治理（见 §16）；
- **只形成规划结果**；
- **不**调用文档 / PPT / HTML / 图片生成能力；
- **不**创建成果型 `capabilityInvocation`；
- 可记录 `planningInvocationRef` 或等价规划审计；
- 敏感材料不得无条件发送到外部模型。

**明确**：「禁止真实生成能力调用」≠「禁止规划模型推理」。

#### 4.5.1 规划调用隐私边界（冻结）

| 规则 | 口径 |
|------|------|
| 触发 | 仅当用户触发「形成预计交付」（或等价显式动作）才开始规划调用；**不得**在输入过程中自动外发 |
| 默认载荷 | 仅发送 `goal`、`audience`、`usage`、`constraints`、`deadline`、`expectedQuality` 等**最小必要**字段 |
| 默认不发送 | 附件全文、完整项目材料、完整主体 Package |
| 主体上下文 | 仅任务相关的**最小摘要**（经 `availableSubjectContextRef` 装配）；不得整包复制 |
| 外部模型 | 遵守现有模型路由、密钥、隐私与审计规则（`callModel` / `model-routing` / SecretStore） |
| rule-based fallback | **不**依赖外部服务 |
| 失败 | 规划失败**不得**丢失用户原始输入（含 task goal） |

---

## 5. PlanRecord / PlanVersion 语义（冻结）

### 5.1 身份

| 字段 | 含义 |
|------|------|
| `planId` | 逻辑计划（跨版本稳定） |
| `versionId` | 具体**不可变**版本身份 |
| `currentDraftVersionId` | 当前编辑草稿版本；无草稿则为 `null` |
| `activeConfirmedVersionId` | 当前有效确认版本；无确认则为 `null` |
| `versionNumber` | 面向用户的单调递增版本号 |

### 5.2 PlanVersionStatus 语义

| 状态 | 含义 |
|------|------|
| `draft` | 系统正在形成或用户仍在编辑 |
| `needs_user_input` | 缺少会显著改变成果计划的信息（见 §8） |
| `ready_for_confirmation` | 计划可确认（通过确认规则与图校验） |
| `confirmed` | 用户确认**该**不可变版本 |
| `superseded` | 被更新的确认版本替代 |
| `cancelled` | 用户放弃该草稿/版本线中的该版本 |

### 5.3 允许转换（单版本）

```text
→ draft
draft → needs_user_input
needs_user_input → draft
draft → ready_for_confirmation
needs_user_input → ready_for_confirmation
ready_for_confirmation → confirmed
*draft|needs_user_input|ready_for_confirmation* → cancelled
confirmed → superseded   （仅当另一版本成为新的 activeConfirmed）
```

强制：

- **`confirmed` 不得原地改回 `draft`**；
- 历史版本**不可覆盖**；
- `cancelled` 不删除历史。

### 5.4 v1 confirmed → v2 draft → v2 confirmed（冻结示例）

```text
1) 创建 planId=P；生成 versionId=V1（versionNumber=1, status=draft）
2) 用户确认 V1 → V1.status=confirmed；
   PlanRecord.activeConfirmedVersionId=V1；
   currentDraftVersionId=null
3) 用户再次修改 → 基于 V1 fork 出 V2（versionNumber=2, status=draft, sourceVersionId=V1）；
   currentDraftVersionId=V2；
   activeConfirmedVersionId 仍为 V1（V1 仍有效）
4) 若用户放弃 V2 → V2.status=cancelled；
   currentDraftVersionId=null；
   activeConfirmedVersionId 仍为 V1（不受影响）
5) 若用户确认 V2 → V2.status=confirmed；
   V1.status=superseded；
   activeConfirmedVersionId=V2；
   currentDraftVersionId=null
```

要点：

- v1 confirmed 后可创建 v2 draft；
- v2 **未确认**时 v1 **仍有效**；
- v2 确认后 v1 才 `superseded`；
- 放弃 v2 不影响 v1；
- confirmed 不得原地改回 draft。

### 5.5 其他强制约束

1. **计划确认 ≠ 执行授权**（继承 DVL2-00 §3.4）；
2. `confirmed` **不等于**任何真实产物已生成；
3. `confirmed` **不等于** `CurrentExecutionReadiness.status=executable`；
4. renderer **不得**自行写业务状态；业务状态权威在 main；
5. 新版本必须保留来源与修改审计（§10.5）；
6. **不得**提前创建有效 `authorizationRefs`；仅记录 `riskFlags`。

### 5.6 Task 与 DeliverablePlan 所有权（冻结）

| 对象 | 地位 |
|------|------|
| 现有 `ActBehalfTask` | 用户任务生命周期**第一权威**（活动列表/打开/停止；archive/soft-delete 见 §5.6.2；现有物理 `deleteTask` 不得直接当产品删除） |
| `DeliverablePlanRecord` | 所属 task 下的**版本化领域对象**；不是第二套任务 |
| `DeliverablePlanVersion` | 不可变计划版本；`taskId` 为**必需**所属引用 |

强制：

1. **不得**建立第二套任务生命周期（无并行「计划任务」导航权威）；
2. 一个 task 在第一阶段（规划阶段）**最多一个** active `DeliverablePlanRecord`；
3. `taskId` 必须始终等于所属 `ActBehalfTask.taskId`；
4. task 与 plan 的状态**不得**由 renderer 拼装后写回；仅通过 main IPC 变更；
5. `plan-store` / planner **不得**重新实现 task 导航、停止或会话生命周期。

#### 5.6.1 任务上的关系字段建议

```text
ActBehalfTask.deliverablePlanning:
  planId
  currentDraftVersionId
  activeConfirmedVersionId
```

说明：上述字段为**指针镜像**（便于 list/get）；权威 PlanRecord 与版本正文由 plan 领域存储维护，并与 task 指针在 main 内保持一致事务（或等效顺序写）。

#### 5.6.2 plan cancelled vs 归档 / 软删除 / 永久清除

**不得**再笼统写「task 删除则计划一并清理」。

| 动作 | 含义 | 计划处理 |
|------|------|----------|
| 取消某 draft 版本 | `PlanVersionStatus=cancelled` | 清 `currentDraftVersionId`（若指向它）；**不影响** `activeConfirmedVersionId`；task 继续 |
| 取消规划（放弃当前草稿线） | 无活跃草稿；可保留历史 versionIds | task **不**因此归档/删除；默认同 `planId` 继续递增版本 |
| **archive（归档）** | task 与 plan **保留**；不在活动列表；可恢复 | 同步标记不可活动；**不得**继续执行生成；confirmed 版本正文保留 |
| **soft delete（软删除）** | task 与 plan **同步**进入不可活动状态；保留历史与恢复窗口 | **不**产生可继续使用的孤儿 plan；普通删除走此路径 |
| **permanent purge（永久清除）** | 物理抹除 | **不属于 DVL2-01 实现范围**；留待统一数据删除与主权合同；DVL2-01 **不**自行实现新的全局 purge 系统 |

强制补充：

1. **普通删除不得立即物理删除** confirmed plan versions；
2. Task 的软删除/归档 **不自动删除**由其计划在未来产生的 `DeliverablePackage`（DVL2-02+ 对象）；不同对象经引用与各自生命周期规则处理；
3. 现有 `digitalme-app/src/act-behalf/task-store.js` 的 `deleteTask` 为**物理过滤删除**（从 `act-behalf-tasks.json` 移除条目）。DVL2-01 **依赖说明**：产品面「删除」不得直接映射为该物理删除（尤其存在 confirmed 计划时）；有界处理为引入 archive/soft-delete 状态字段并由 main 编排，或对含 confirmed 计划的物理删除 **fail-closed**。**不得**借本任务重构全局删除系统。

#### 5.6.3 DVL2-02 接手点

DVL2-02 **必须**从具体 `activeConfirmedVersionId`（或显式指定的 confirmed `versionId`）创建 `DeliverablePackage`；不得从 draft、不得从已 superseded 版本静默取「最新编辑」。

### 5.7 Task goal 与 Understanding goal（冻结）

| 字段 | 含义 |
|------|------|
| `ActBehalfTask.goal` | **当前任务主目标**（现有代码亦镜像 `taskIntent.goal` / `request`；产品语义以 task 主目标为准） |
| `TaskUnderstanding.goal` | **某个计划版本**对目标的解释快照（含 provenance） |

#### 5.7.1 同步矩阵

| 用户动作 | main 必须做 | 禁止 |
|----------|-------------|------|
| 只修改系统理解（受众/用途/假设等），不改任务主目标 | 更新当前 draft 的 `understanding`；必要时新 draft 编辑 | 改写历史 confirmed 版本；改写 `ActBehalfTask.goal` |
| 修改任务主目标 | 在 **main** 更新 `ActBehalfTask.goal`（及既有镜像字段）；**一致性**地 fork 新计划版本，understanding.goal 以新主目标为 `user_provided` 快照起点 | renderer 分别写两个 goal；原地改写历史 confirmed 版本的 understanding |
| 打开历史 confirmed 版本 | 只读展示当时 understanding 快照 | 因后续 task goal 变化而重写该历史版本 |

强制：

- 历史确认版本**不得**因 task goal 后续变化而重写；
- renderer **不得**分别写两个 goal 字段；只提交用户意图事件，由 main 裁决写入哪一层。

### 5.8 Task Store 与 Plan Store 一致性协议（冻结）

两个持久化文件（推荐）：

| Store | 运行时路径 | 代码权威 |
|-------|------------|----------|
| Task Store | `<userData>/act-behalf-tasks.json` | `digitalme-app/src/act-behalf/task-store.js` |
| Plan Store | `<userData>/deliverable-plans.json` | `digitalme-app/src/act-behalf/deliverable-plan-store.js`（候选新增） |

每个 JSON 文件自身仍使用**原子写**（tmp + rename / 写队列）。两文件之间**没有**跨文件事务；通过**确定性提交顺序 + 启动 reconciliation** 达到最终一致。

#### 5.8.1 所有权与指针不变量

```text
一个 task 最多一个 PlanRecord
一个 PlanRecord 只属于一个 task
currentDraftVersionId 必须属于该 PlanRecord
activeConfirmedVersionId 必须指向 confirmed version
同一 PlanRecord 最多一个 active confirmed version
task 指针不得指向无效版本
renderer 不得自行修复或选择冲突版本
```

另：`task.deliverablePlanning.planId` 必须等于该 PlanRecord.`planId`；PlanVersion.`taskId` 必须等于所属 task。

#### 5.8.2 写入前校验

任何提交 Plan Store 或更新 task 指针前，main 必须校验：

- `taskId` 存在且未处于不可恢复的损坏态；
- 目标 `versionId` 属于该 `planId`；
- 状态转换合法（§5.3）；
- 图校验与确认规则（若动作为 confirm）；
- 写入不会产生「同一 record 两个 active confirmed」。

校验失败 → **整次操作失败**；不得部分更新指针。

#### 5.8.3 确定性写入顺序（冻结）

原则：**先写 Plan Store（领域正文），再写 Task Store（指针镜像）**。

| 操作 | 顺序 |
|------|------|
| 新建 plan / 新 draft version / 编辑草稿保存 | ① Plan Store 写入/更新 version + record ② Task Store 更新 `deliverablePlanning` 指针 |
| 确认版本 | ① Plan Store：目标 version → `confirmed`；旧 active confirmed → `superseded`（若有）② Task Store：`activeConfirmedVersionId` / 清 draft 指针 |
| 取消草稿 | ① Plan Store：version → `cancelled` ② Task Store：清 `currentDraftVersionId` |
| archive / soft delete | ① Plan Store：record/versions 标记不可活动（不改 immutable 正文字段语义外的状态元数据允许）② Task Store：task 同步不可活动 |
| 恢复 archive/soft-delete | ① Plan Store 恢复可活动标记 ② Task Store 恢复；再跑 reconciliation |

禁止：

- 用「最新时间戳胜出」解决冲突；
- 静默删除孤儿或冲突版本；
- 改写不可变 `DeliverablePlanVersion` 正文（items/understanding/snapshot 等）。

#### 5.8.4 跨文件失败矩阵

| 步骤① Plan Store | 步骤② Task Store | 返回给调用方 | 后续 |
|------------------|------------------|--------------|------|
| 失败 | （未执行） | **失败**；用户面不得显示已保存/已确认 | 无变更或仅内存回滚 |
| 成功 | 失败 | **`degraded_consistency`**（或等价错误码）；**不得**报告完全成功 | 记审计；下次启动/下次读写触发 reconciliation；UI 可提示「计划已写入，任务索引待同步」类中性文案 |
| 成功 | 成功 | 成功 | 正常 |

renderer **不得**在 `degraded_consistency` 下自行挑选版本继续「假装一致」。

#### 5.8.5 重启 reconciliation 规则

启动或 `getTask`/打开计划时，main 只读比对两 store，按**确定性规则**修复**指针**（不改 version 正文）：

| 发现 | 处理 |
|------|------|
| task 指向不存在的 `planId` / `versionId` | 清空无效指针字段；记指针修复审计；若仍有唯一合法 confirmed version 属于该 task 的唯一 PlanRecord，可恢复 `activeConfirmedVersionId` 指向它；否则 fail-closed 至需用户介入的只读态 |
| PlanRecord 存在但 task 无指针 | 写回 task 指针镜像（按 record 的 currentDraft/activeConfirmed）；记审计 |
| 多个 PlanRecord 挂同一 task | **fail-closed**：拒绝自动规划/确认/执行；保留全部 record；记冲突审计；等待人工/后续修复工具（DVL2-01 不静默删） |
| 同一 PlanRecord 多个 `status=confirmed` 且未 superseded | **fail-closed**：不自动选「最新」；记冲突；只读展示冲突；需显式修复动作（仍不得时间戳胜出） |
| 孤儿 PlanRecord（task 已不存在） | **不静默删除**；标记 `orphaned`（或等价）；不进入活动列表；不参与执行；留待统一 purge 合同 |
| 孤儿 version（不在任何 record.versionIds） | **不静默删除**；标记隔离；不参与确认/执行 |
| soft-deleted/archived 不一致（一侧活一侧死） | 以 **更严格（不可活动）** 为准收敛两侧；记审计 |

#### 5.8.6 指针修复审计

每次 reconciliation 或一致性修复必须追加审计事件（至少含：`at`、`taskId`、`planId`、发现类型、采取的指针动作、是否 fail-closed）。**不得**在无审计时静默改指针。

#### 5.8.7 fail-closed 条件（摘要）

出现以下任一情况时，禁止确认新计划、禁止展示为可执行、禁止启动后续生成准备：

- 多 PlanRecord / 多 active confirmed 冲突未解；
- task 指针与 Plan Store 严重不一致且无法安全恢复单一指针；
- PlanVersion 正文校验失败或损坏；
- `degraded_consistency` 未完成 reconciliation。

---

## 6. 计划时能力快照 vs 当前执行评估（冻结）

### 6.1 PlanningAvailabilitySnapshot（不可变）

属于某 `DeliverablePlanVersion` 的不可变字段，记录**规划/确认时**各项的合同支持与运行可用性认知：

- 写入版本后**不得**因当前能力变化而改写；
- 用于审计「当时认为怎样」；
- 确认时必须存在完整快照。

### 6.2 CurrentExecutionReadiness（可重算）

属于相对某 `versionId` 的**派生结果**（可缓存，`cacheValid` 可失效）：

- 记录**当前**是否可执行生成；
- 能力目录/路由变化后必须可重算；
- **DVL2-01 只展示，不启动执行**；
- DVL2-02 / DVL2-03 **执行前必须重新评估**。

### 6.3 派生矩阵（逻辑）

评估对象：目标版本中 `planDisposition=included` 的项；对照**当前**能力摘要重算（不修改版本正文）。

| 条件 | `CurrentExecutionReadiness.status` |
|------|-------------------------------------|
| 无法取得能力摘要或评估失败 | `unknown` |
| 无 included 项 | `not_executable` |
| 任一 `priority=required` 当前不可用（或图/授权 blocker） | `not_executable` |
| required 当前均可执行，但部分 recommended/optional 不可用 | `partially_executable` |
| 全部 included 当前可用且无 blocker | `executable` |

补充：

- `contractSupport=reserved_for_future` / `out_of_scope`：默认 blocked；
- **当前基线**四类合同内产物 runtime 仍为 unavailable → 确认后通常 `not_executable`；
- **不得**因能力变化静默修改产物类型、格式或执行模式；
- 用户面须能说明：**「计划未变化，当前执行条件发生变化。」**

### 6.4 与确认的关系

见 §7。确认时写入/冻结 `planningAvailabilitySnapshot`；展示层同时可显示 `CurrentExecutionReadiness`。

---

## 7. 确认规则矩阵

| 条件 | 可否确认计划 | 确认后含义 |
|------|--------------|------------|
| `included` 项为 0 | **不可确认** | — |
| 图校验失败 | **不可确认** | — |
| 全部 included 项当时快照为 unavailable | **可确认** | 冻结 snapshot；当前 readiness 通常 `not_executable`；文案「计划已准备，尚未开始执行」+ 不可执行说明 |
| `required` 项（按当前或快照）blocked | **可确认计划**（若至少一项 included） | **不得**进入真正执行（留给 DVL2-03 门禁） |
| 仅 `optional`/`recommended` blocked | **可确认** | 可能 `partially_executable`（执行前重评） |
| 存在 `reserved_for_future` / 运行不可用项 | 确认前必须**显式展示** | 不得伪装为已可生成 |
| 用户点击确认 | 仅确认交付物/受众/用途/格式/优先级/顺序/依赖 | **不得**解释为风险授权或执行启动 |
| 确认后能力变化 | 计划版本正文与 snapshot **不变** | 仅重算 `CurrentExecutionReadiness`；UI 说明「计划未变化，当前执行条件发生变化」 |

---

## 8. 有限追问合同

DVL2-01 **不得**把自然语言任务重新变成复杂问卷。

只在缺失信息会**显著改变**成果计划时追问。

### 8.1 追问优先级

1. 受众；
2. 用途；
3. 必须包含或禁止包含的内容；
4. 截止时间；
5. 渠道或格式限制。

### 8.2 追问规则

- 一次最多提出**一个**关键问题；
- 可以跳过；
- 可使用合理假设继续；
- 假设必须明确显示（`assumptions` + UI）；
- **不得**询问模型、技术路径或内部能力；
- **不得**要求用户补全全部七模块。

### 8.3 「不追问也可以规划」的默认策略

| 缺失项 | 默认假设（须写入 assumptions，provenance=`system_inferred`） |
|--------|--------------------------------------------------------------|
| audience | 「面向与该任务相关的一般读者或相关方」 |
| usage | 「用于说明与沟通」 |
| constraints | 空列表；不臆造保密或品牌约束 |
| deadline | `null` |
| expectedQuality | 「清晰、可直接对外使用的完整稿」 |
| 项目材料不足 | 基于目标字面与通用知识规划；主体资料仅做相关校准 |

模糊输入仍须产出可编辑的初步计划；不得因「资料不足」拒绝规划。

---

## 9. 自动计划规则（冻结）

### 规则一：项目对外介绍

自然语言中包含（示例线索，非穷尽）：项目介绍、投资人、合作伙伴、路演、官网、对外传播。

默认候选**可以**包括：`document`、`presentation`、`webpage`、`image`。

但应根据用途和约束裁剪，**不得每次机械生成四项**。例如仅「官网落地页」可不强制 PPT。

### 规则二：单一明确产物

例如：「帮我写一份项目介绍文档。」

默认只规划 `document`，**不强制**增加 PPT、网页和图片。

### 规则三：音视频需求

例如：「帮我做一条项目宣传视频。」

规划器可以识别 `video`，但必须：

- `contractSupport=reserved_for_future`；
- `runtimeAvailability=unavailable`；
- 推荐当前合同内替代物（例如脚本文档、分镜文档、封面图片；其运行可用性仍按基线表）；
- **不得**宣称当前可生成真实视频。

音频同理。

### 规则四：能力不可用

若建议产物运行不可用：

- 仍可保留为计划建议；
- 明确 `contractSupport` + `runtimeAvailability`；
- 提供替代成果；
- **不得**在确认后假装可执行。

### 规则五：主体资料不足

**不得**降低通用规划质量。使用通用知识、任务材料、当前明确目标。主体资料仅用于相关校准。

### 规则六：用户删除后不静默加回

用户删除某项后，系统不得静默加回，除非用户明确请求重新规划。删除被依赖项时遵守 §4.4。

---

## 10. 计划持久化与恢复合同

本轮定义**逻辑持久化合同**；**不得**决定引入 SQLite（R2.5 仍 `deferred`），除非另行批准。

### 10.1 身份与指针

| 要求 | 口径 |
|------|------|
| `planId` | 稳定 |
| `versionId` | 不可变版本身份 |
| `versionNumber` | 单调递增 |
| `currentDraftVersionId` / `activeConfirmedVersionId` | 见 §5 |
| confirmed 版本 | **不可覆盖**；修改 → 新版本 |
| 历史 | 保留；`superseded` / `cancelled` 不删除 |

### 10.2 恢复

重启后须可恢复：

- `currentDraftVersionId` 指向的草稿（若存在）；
- `activeConfirmedVersionId` 与历史确认版本；
- 原始目标文本；
- 任务理解、预计交付、状态与版本元数据。

恢复后**不得**出现「已生成成果」假状态。

### 10.3 写入安全

- 存储失败**不得**向用户显示「已保存」；
- 须原子写入或等效安全策略；
- 计划损坏时**不得**覆盖最后一个有效版本；
- 损坏计划：进入只读/修复路径，允许用户基于原始目标手工重建。

### 10.4 存储内容禁令

计划数据**不得**包含：密钥、完整主体 Package 副本、真实成果文件或 `ArtifactRef` 文件内容、有效 `authorizationRefs`。

### 10.5 审计（最小）

```ts
type PlanAuditEvent = {
  at: string;
  planId: string;
  versionId: string;
  versionNumber: number;
  action:
    | "created"
    | "planned"
    | "edited"
    | "confirmed"
    | "cancelled"
    | "restored"
    | "superseded_by"
    | "readiness_reevaluated";
  actor: "system" | "user";
  summary: string;
  sourceVersionId?: string;
  planningInvocationRef?: string | null;
};
```

---

## 11. 成果计划确认 vs 风险执行授权

### 11.1 成果计划确认（DVL2-01 做）

只确认：交付物清单、受众、用途、格式、优先级、顺序、依赖。

### 11.2 风险执行授权（DVL2-01 不做）

不获得：外部数据传输、付费、执行代码、上传、发布、高风险工具授权。只记录 `riskFlags`。**不得**提前创建有效 `authorizationRefs`。

---

## 12. UI 合同（最低）

### 12.1 任务理解区

展示：我理解你要做什么；面向谁；用于什么；当前假设；尚未明确事项。用户可编辑关键字段。推断须可辨识。

### 12.2 预计交付区

每项卡片展示：类型、标题、用途、推荐格式、优先级、合同范围（是否本轮目标类型）、当前是否可执行生成、风险提示。

支持：新增、删除、修改、排序。确认前对 `reserved_for_future` / `unavailable` 项**显式展示**。

### 12.3 底部动作

至少包括：保存草稿、确认成果计划、取消。确认后显示「成果计划已准备，尚未开始执行。」不得显示虚假生成进度和文件路径。

### 12.4 文案约束

严谨、明白、中性。默认产品面禁止协议名、内部字段名、工程黑话。

---

## 13. 错误与降级

| # | 情况 | 要求 |
|---|------|------|
| 1 | 规划模型调用失败 | 规则降级或手工列表；保留原始目标 |
| 2 | 返回非法 JSON | 验证与修复；失败则手工编辑 |
| 3 | 返回空成果列表 | 不得确认；允许手工新增 |
| 4 | 推荐运行不可用 / 未来保留产物 | 显式标记；可附替代；不虚假承诺 |
| 5 | 用户删除全部产物 | 禁止确认 |
| 6 | 保存失败 | 不得伪装成功 |
| 7 | 恢复到损坏计划 | 不覆盖最后有效版本 |
| 8 | 能力可用性变化 | 重算 `CurrentExecutionReadiness`；**不**改写历史版本与 `planningAvailabilitySnapshot`；不静默改产物类型/格式/执行模式；UI 说明计划未变、执行条件变了 |
| 9 | 极短或极模糊输入 | 初步规划 + 最多一个追问 |
| 10 | 互相冲突的要求 | 显式列出；请用户取舍 |
| 11 | 依赖图非法 | 阻止确认；提示修复 |

---

## 14. 验收场景

### 场景 A：完整项目介绍包

输入：为一个项目制作面向投资人的完整对外介绍材料。

预期：识别受众；形成四类候选或合理子集；各项为 `in_current_product_scope` + `unavailable`；用户可删改；可确认；当前 `CurrentExecutionReadiness` 通常为 `not_executable`；不生成真实文件。

### 场景 B：单一文档

输入：写一份项目介绍文档。默认只生成文档计划，不机械补齐四类。

### 场景 C：视频需求

输入：做一条项目宣传视频。识别 video；`reserved_for_future` + `unavailable`；推荐脚本/分镜/封面等替代；不虚假承诺。

### 场景 D：资料不足

输入：帮我把这个项目介绍清楚。可形成初步计划；最多一个关键问题；不要求先完善数字之我。

### 场景 E：确认后修改（版本语义）

1. 确认 V1；`activeConfirmedVersionId=V1`；
2. 修改 → 创建 V2 draft；V1 仍为 activeConfirmed；
3. 确认 V2 → V1=`superseded`，`activeConfirmedVersionId=V2`；
4. 或放弃 V2 → V1 仍有效。
5. V1 正文不被覆盖。

### 场景 F：重启恢复

保存草稿；重启；恢复目标、理解、预计交付与指针；不出现「已生成成果」假状态。

---

## 15. 安全与隐私

默认私有；计划不等于发布；计划不授权外部传输；不保存密钥；不复制完整主体 Package；不把推断写成已确认事实；不把任务项目材料自动写入七模块；renderer 不持有高风险权限；规划日志不得泄露敏感全文。规划调用隐私细则见 **§4.5.1**。

---

## 16. 现有代码只读映射（不修改代码）

> 以下基于仓库 `digitalme-app/` 只读检索。无法确认处标 `mapping_unresolved`。

### 16.1 「做事」入口与页面候选

| 项 | 路径 / 符号 |
|----|-------------|
| Legacy HTML 入口 | `digitalme-app/src/renderer/index.html` — `data-view="do"`「做事」、`#view-do`、`#do-hub`、`#do-act-behalf` |
| Legacy 逻辑 | `digitalme-app/src/renderer/app.js` — `switchView()`、`openDoScene()`、`actBehalfState`、`window.digitalMe.actBehalf*` |
| Legacy 样式 | `digitalme-app/src/renderer/styles.css` — `#view-do`、`.do-hub`、`.do-act-behalf` |
| 帮助 | `digitalme-app/src/renderer/help.js` — `do:` topic |
| Shell 加载 | `digitalme-app/src/renderer-entry-load.js` — `LEGACY_INDEX` → `src/renderer/index.html` |
| renderer-next | `digitalme-app/src/renderer-next/` — **未发现**「做事」/ `actBehalf` / `do-hub` UI |

**结论**：做事用户路径在 **legacy renderer**；规划器 UI 默认落点为 `view-do` / `act_behalf` 流程阶段。

### 16.2 任务 / session 权威位置

| 权威 | 存储 | 代码 |
|------|------|------|
| 做事任务 | `<userData>/act-behalf-tasks.json` | `digitalme-app/src/act-behalf/task-store.js` — `storePath`、`loadStore`、`saveTask`、`persistStoreAtomic` |
| 对话 session | `<userData>/workbench-sessions.json` | `digitalme-app/src/sessions.js` |
| 做事上下文旁路审计 | `<userData>/doing-context-audit.json` | `digitalme-app/src/doing-context.js` — **非**任务主存 |

规划器任务权威应挂靠 **act-behalf 任务**，不得与 chat session 混用。

### 16.3 main / preload IPC 模式

| 项 | 证据 |
|----|------|
| Preload | `digitalme-app/src/preload.js` — `contextBridge.exposeInMainWorld("digitalMe", api)` |
| 隔离 | `main.js` `createWindow`：`contextIsolation: true`，`nodeIntegration: false` |
| Channel 约定 | `domain:action`（如 `actBehalf:list`、`sessions:save`、`modelRouting:get`） |
| Handler | 集中 `digitalme-app/src/main.js` `ipcMain.handle(...)` |

### 16.4 模型路由入口

| 层 | 路径 |
|----|------|
| 路由逻辑 | `digitalme-app/src/model-routing.js` — `resolveModelRoute`、`invokeModelRoute` |
| 门面 | `digitalme-app/src/main.js` — `callModel` / `callModelStream` |
| 配置与密钥 | `digitalme-app/src/security/config-secrets.js`、`digitalme-app/src/security/secret-store.js` |
| IPC | `modelRouting:get` / `save` / `test` / `recent` |

### 16.5 可复用持久化模式

优先复用：`act-behalf/task-store.js`、`sessions.js`、`security/secret-store.js`、`package-store/fs-util.js` 的 **tmp + rename（+ 写队列）** 原子写。
`doing-context.js` `appendAudit` 为直写，**不宜**作为计划权威写入模板。

### 16.6 可复用审计模式

| 候选 | 路径 | 备注 |
|------|------|------|
| 任务内 audit 字段 | `task-store.js` `normalizeTask().audit` | 规划器版本审计可先挂任务字段 |
| 决策审计链 | `digitalme-app/src/decision-audit/index.js` | 需要不可篡改链时对齐 |
| doing-context 审计 | `doing-context.js` | 旁路且非原子 |
| research provenance | `act-behalf/research-run.js` 内嵌字段 | 非独立库 |

### 16.7 legacy renderer 有界实施策略（冻结）

允许使用 legacy「做事」宿主，但强制：

| 规则 | 口径 |
|------|------|
| renderer | **仅**负责展示、输入和事件绑定 |
| 领域逻辑 | 计划状态机、版本、持久化、模型调用、校验、readiness **均在 main/domain** |
| JSON | renderer **不**直接读写 |
| preload | 只提供类型化窄 IPC |
| 双写 | **不**建立 legacy/next 双写 |
| next | 本任务**不**新增做事页面 |
| R3 | 继续 `paused` |
| 复用 | 领域服务与 IPC **必须**可供未来 next renderer 复用（稳定 channel 与 payload 合同） |
| app.js | **不允许**顺便重构整个 `renderer/app.js`；仅有界增加计划阶段绑定 |

### 16.8 精确候选新增文件与职责（完整仓库相对路径）

| 完整路径 | 职责 |
|----------|------|
| `digitalme-app/src/act-behalf/deliverable-plan-schema.js` | PlanRecord/Version/Understanding/图校验/确认规则/一致性不变量的纯函数 |
| `digitalme-app/src/act-behalf/deliverable-plan-store.js` | Plan Store 持久化（`<userData>/deliverable-plans.json`）；原子写；**不**实现 task 导航/停止/会话；**不**实现全局 purge |
| `digitalme-app/src/act-behalf/deliverable-planner.js` | model-assisted + rule-based 规划编排、默认规则、隐私载荷裁剪、`planningInvocationRef` |
| `digitalme-app/src/act-behalf/deliverable-plan-readiness.js` | 派生 `CurrentExecutionReadiness`（可缓存、可重算） |
| `digitalme-app/src/act-behalf/deliverable-plan-consistency.js` | 两 store 写入顺序编排辅助、reconciliation、指针修复审计（可与 store 合并，但逻辑边界独立；若合并则本路径标为不单独新建：`mapping_unresolved` 二选一，推荐独立文件） |
| `digitalme-app/scripts/test-dvl2-01-planner-contracts.cjs` | 合同/状态机/图校验/goal 同步/readiness/一致性协议单元测试 |
| `digitalme-app/scripts/electron-dvl2-01-planner-acceptance.cjs` | Electron 主路径验收（可选） |

运行时数据文件（非源码，由 store 写入）：

| 路径 | 说明 |
|------|------|
| `<userData>/act-behalf-tasks.json` | 现有 Task Store（`digitalme-app/src/act-behalf/task-store.js`） |
| `<userData>/deliverable-plans.json` | 候选 Plan Store（由 `deliverable-plan-store.js` 的 `storePath`） |

若实施改为仅嵌在 `act-behalf-tasks.json` 而不建并列文件：允许，但须在实现授权任务包中锁定；本规格**推荐并列 Plan Store + task 指针**。

### 16.9 候选有界修改文件与职责（完整路径）

| 完整路径 | 允许的有界改动 |
|----------|----------------|
| `digitalme-app/src/act-behalf/task-store.js` | `normalizeTask` 增加 `deliverablePlanning` 与 archive/soft-delete 所需最小状态字段；**不**把现有 `deleteTask` 物理删除直接绑到产品「删除」；**不**重构全局删除系统 |
| `digitalme-app/src/main.js` | 注册规划 IPC；编排 §5.8 两文件提交顺序与 reconciliation；经现有 `callModel` 做规划调用；**不**大范围无关重构 |
| `digitalme-app/src/preload.js` | 类型化窄 API（propose/saveDraft/confirm/getReadiness/archive/softDelete 等） |
| `digitalme-app/src/renderer/index.html` | `#do-act-behalf` 内计划 UI DOM；**不**新增一级导航 |
| `digitalme-app/src/renderer/app.js` | **有界**事件绑定；禁止整文件重构；禁止自行修复冲突版本 |
| `digitalme-app/src/renderer/styles.css` | 计划阶段最小样式 |
| `digitalme-app/src/renderer/help.js` | 做事帮助补充计划阶段中性说明 |
| `digitalme-app/package.json` | **仅可**增加下列测试 script；不得改依赖版本 |

### 16.10 明确不修改的文件或目录（完整路径）

| 完整路径 | 原因 |
|----------|------|
| `digitalme-app/src/renderer-next/**` | 本任务不新增做事页；无双写 |
| `digitalme-app/src/renderer-entry-controller.js` | 不改入口策略；R3 paused |
| `digitalme-app/src/renderer-entry-load.js` | 同上 |
| `digitalme-app/src/renderer-entry-runtime.js` | 同上 |
| `digitalme-app/src/outputs/**` | 禁止真实产物生成偷跑 |
| `digitalme-app/src/sessions.js` | 计划不挂 chat session |
| `digitalme-app/src/package-store/**` | 不写主体 Package |
| `digitalme-app/src/act-behalf/result-generation.js` | 禁止借规划调用成果生成 |
| `digitalme-app/package-lock.json` | 不升级依赖 |
| `digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md` | 上位合同冻结 |
| `digitalme_first_vertical_loop_sprint_plan_v0.1.md` | 第一闭环历史计划不扩大修改 |

IPC channel 前缀 `actBehalf:` vs `deliverablePlan:`：实施授权时锁定；未锁定前：`mapping_unresolved`（仅命名）。

### 16.11 测试 script 与 legacy DOM 验收范围

`digitalme-app/package.json` **仅增加**：

```text
"test:dvl2-01-planner": "node scripts/test-dvl2-01-planner-contracts.cjs"
"test:dvl2-01-planner-acceptance": "electron scripts/electron-dvl2-01-planner-acceptance.cjs"
```

对应脚本完整路径：

- `digitalme-app/scripts/test-dvl2-01-planner-contracts.cjs`
- `digitalme-app/scripts/electron-dvl2-01-planner-acceptance.cjs`（可选）

Legacy DOM 验收范围（有界）：`#view-do` / `#do-act-behalf` 计划理解区、预计交付、保存草稿/确认/取消、确认文案、重启恢复与一致性降级提示；**不**验收整站导航重构；Playwright 是否强制 = `mapping_unresolved`（默认不强制）。

### 16.12 与 React/Vite renderer-next 的关系

生产默认 legacy（`digitalme-app/src/renderer-entry-controller.js`）。`digitalme-app/src/renderer-next/**` 无做事 UI。领域模块与 IPC 须可被未来 next 复用；本任务不实现 next 页面。

---

## 17. 实现边界建议（候选；本轮不编码）

| 层 | 职责 | 禁止 |
|----|------|------|
| **main + act-behalf domain** | Task 权威、PlanRecord/Version、§5.8 一致性、goal 同步、snapshot、CurrentExecutionReadiness、规划调用 | renderer 写权威状态；第二套任务生命周期；静默 purge |
| **renderer（legacy）** | 展示 / 输入 / 事件 | 读写 JSON；直接 callModel；整文件重构 `digitalme-app/src/renderer/app.js`；自行修复冲突版本 |
| **preload** | 类型化窄 IPC | 宽权限 / 原始 fs |
| `digitalme-app/src/act-behalf/deliverable-planner.js` | model-assisted + rule fallback、隐私裁剪 | 成果生成 / ArtifactRef |
| `digitalme-app/src/act-behalf/deliverable-plan-readiness.js` | 只读重算 readiness | 改写历史版本 |
| `digitalme-app/src/act-behalf/deliverable-plan-store.js` | Plan 持久化 | task 导航/停止/会话/全局 purge |

---

## 18. 测试矩阵

### 18.1 单元测试

- schema / provenance 校验；
- `contractSupport` × `runtimeAvailability` 基线表；
- 默认规划规则；
- 状态与 PlanRecord 指针（含 §5.4 / §5.6 / §5.8）；
- task goal / understanding goal 同步矩阵；
- 两 store 提交顺序与失败矩阵、reconciliation；
- archive / soft delete 语义（非物理 purge）；
- 依赖图（自依赖/环/removed/order）；
- `PlanningAvailabilitySnapshot` 不可变 + `CurrentExecutionReadiness` 可重算；
- 确认规则矩阵；
- 非法 JSON / 空计划；
- 规划模型失败 → rule fallback；隐私载荷不含附件全文/完整 Package。

### 18.2 集成测试

- main/preload/renderer 合同；
- 保存/恢复指针；
- V1 confirmed → V2 draft（V1 仍 active）→ V2 confirmed / 放弃 V2；
- 能力变化后 readiness 重评不改写历史版本；
- 不产生成果文件、不调用生成能力。

### 18.3 Electron 验收（获授权后）

自然语言 → 自动规划 → 手工修改 → 保存草稿 → 确认 → 重启恢复；确认文案正确；无真实文件；无成果生成调用。

---

## 19. 禁止偷跑

不得：创建 ArtifactRef 文件；生成文档/PPT/HTML/图片；调用图片生成；创建成果型 capabilityInvocation；执行代码；外部发布；主体成长回流；引入 SQLite（除非另批）；重写 renderer-next / 解锁 R3、R2.5、PAN-02；修改 DVL2-00；把 `runtimeAvailability` 在无真实验收前标为 `available`。

---

## 20. 交接给 DVL2-02 / DVL2-03

DVL2-02 **必须**从具体 confirmed plan version（`ActBehalfTask.deliverablePlanning.activeConfirmedVersionId` → `DeliverablePlanVersion`）创建 `DeliverablePackage`：

- 不得从 draft；
- 不得静默使用已 `superseded` 版本；
- 创建包时拷贝该版本 items / understanding 快照，不回写计划版本。

DVL2-03：执行前**重新评估** `CurrentExecutionReadiness`；仅当前 `available` 且风险授权满足的项可生成；不得因能力变化改写历史计划版本。

---

## 21. 明确不做（本接受/冻结阶段）

- 不修改 `digitalme-app/**`、测试、配置、依赖或 lockfile；
- 不启动 Electron；不读取真实 Package / sessions / userData / 密钥；
- 不创建实现分支；不开始编码；不创建 `deliverable-plans.json` 或规划器源码/测试脚本；
- 不标 `implementation_authorized` / `implementation_started` / `implemented` / `completed`；
- 不启动 DVL2-02；不生成真实文档/PPT/HTML/图片；
- 不 push（由独立提交流程按 Owner 指令执行提交，仍不 push）。

---

## 22. 文档同步清单（本轮允许）

| 文件 | 动作 |
|------|------|
| 本文 | Owner 接受与规格冻结 → `owner_accepted` / `frozen_for_implementation` / `not_started`（不改合同正文） |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 最小同步：等待 DVL2-01 implementation authorization；不得开始编码 |

---

## 23. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1-draft | 2026-07-26 | 初稿：`codex_review_pending` |
| v0.1-draft（R2） | 2026-07-26 | 过程修订（历史） |
| v0.1-draft（R3） | 2026-07-26 | 过程修订（历史） |
| v0.1-draft（R4） | 2026-07-26 | 过程修订（历史）；曾为 `codex_changes_requested` |
| v0.1.1 | 2026-07-26 | CTO 最终技术复核通过：曾标 `ready_for_owner_acceptance` |
| **v0.1.1（Owner 接受）** | 2026-07-26 | **Owner 正式接受** DVL2-01 v0.1.1；规格冻结为成果规划器实施合同（`owner_accepted` / `frozen_for_implementation` / `not_started`）。只负责：自然语言目标理解、预计交付规划、用户轻量修改、计划版本/保存/恢复、execution readiness 展示。**不**生成真实文档/PPT/HTML/图片；**不**启动 DVL2-02；**尚未获得** implementation authorization |

### 23.1 CTO 复核轮次摘要（不重写合同正文）

1. **第一轮复核**：分离合同支持与真实运行可用性；明确计划版本；分离规划调用与成果生成；增加 execution readiness；完成代码映射。
2. **第二轮复核**：冻结 Task 为第一权威；分离任务目标与理解快照；分离能力快照与当前 readiness；冻结 legacy renderer 薄适配策略；收紧规划调用隐私。
3. **第三轮复核**：冻结 Plan Store 与 Task Store 的提交顺序；增加 reconciliation 与 fail-closed；区分 archive、soft delete、permanent purge；补齐完整候选实施路径。
4. **CTO 最终结论**：技术复核通过；曾为 `ready_for_owner_acceptance`；随后 Owner 接受并冻结。
5. **Owner 最终接受**：`owner_accepted` / `frozen_for_implementation` / `not_started`；尚未 `implementation_authorized`。
