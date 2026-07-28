# 任务包 IDCOLLAB-MIN-01：最小行动授权与参与方语义接线

版本：v0.1.2
日期：2026-07-27
状态：`implemented` / `revocation_bug_fixed` / `owner_runtime_accepted` / `accepted_as_implemented`
实施：`implemented`
implementation_authorized：`true`
owner_runtime_accepted：`true`
accepted_as_implemented：`true`
边界：`minimal_identity_collaboration_loop_only` / `external_network_collaboration_not_validated` / `market_and_settlement_not_started`

> **状态校正（2026-07-28，TASK-QUALITY-LOOP-01 实施指令第五节）**：撤销即时生效修复（MIN-01.1）已经 Owner 真机重新验收通过；Owner 确认本文此前残留的 `ready_for_owner_runtime_reacceptance` 与各处 `ready_for_owner_acceptance` / `not_started` 为过期状态，统一校正为上述真实状态。本校正**不重开**本任务、不重新实现身份与撤销、不扩展外部协作网络。
实施分支：`codex/idcollab-min-01-action-identity`
上位依据：
- [`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)（当前最高架构原则）
- [`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（DVL2 上位合同）
- [`digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md`](digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md)（DVL2-03 已收口事实）
- [`docs/design/digitalme_crt_v0.2_subject_context_engine_spec.md`](docs/design/digitalme_crt_v0.2_subject_context_engine_spec.md)（CRT v0.2 Subject Context Engine）
- [`DigitalMe_identity_collaboration_plan_v0.2_2026-07-22.md`](DigitalMe_identity_collaboration_plan_v0.2_2026-07-22.md)（身份与协作长期规划）

> **正式边界**：本文定义并记录单主体做事链的最小身份、参与方与授权语义实现证据。**本文不是**外部协作运行时、多人协作产品、Digital Org、Agent 市场或完整 Collaboration Runtime 的实施授权。工程完成 ≠ Owner 真机验收；**不得**提前标 `owner_runtime_accepted` / `accepted_as_implemented`。

---

## 0. 任务结论

### 0.1 要解决的真实缺口

DVL2-03 已能生成真实文件、建立 `DeliverableVersion` / `ArtifactRef` / `contentHash` / provenance，并支持接受、否定、重新生成与接受后学习；但当前记录仍无法稳定回答：

1. 谁发起了这次行动；
2. 谁是任务与成果的主归属主体；
3. Digital Me 代表谁行动；
4. 本次以什么角色行动；
5. 由哪个模型、Skill、工具或运行时执行；
6. 执行依据了什么授权；
7. 谁最终接受或否定成果；
8. 哪些责任保留给 Owner，哪些只是系统准备或技术执行。

### 0.2 本轮正式目标

在**不改变普通用户主路径、不开放外部协作网络、不新建复杂协作中心**的前提下，为现有做事链补齐以下最小合同：

1. 最小主体模型；
2. 最小参与方模型；
3. 最小执行体模型；
4. 最小授权引用模型；
5. 不可变的 `ActionIdentityContext` 快照；
6. 与 CRT / provenance / accepted-artifact learning 的明确分工；
7. legacy 数据兼容策略；
8. 可通过合同测试与 Electron 验收的最小验收面。

### 0.3 本轮关键裁剪

1. **不建立独立 Participant Store**；
2. **不要求本轮落地完整 AuthorizationRecord 网络服务**；
3. **不重做 DID / VC 基础设施**，仅允许 `identityRef` 作为可选关联；
4. **不让 CRT 承担完整身份与授权系统职责**；
5. **不改变当前单主体默认关系**：Owner 本人仍是 initiator / owner / represented subject / final acceptor；
6. **优先使用不可变快照**，而不是运行时回头拼接当前可变身份状态；
7. **历史读取使用兼容视图推断**，不得把推断值冒充原始事实。

---

## 1. 本轮范围与非范围

### 1.1 本轮必须做

1. 定义 `SubjectRef`、`ParticipantRef`、`ActionIdentityContext`、`ExecutorRef`、`AuthorizationRef`、`responsibilityBoundary`；
2. 定义最小默认主体关系；
3. 定义与 `Task / PlanVersion / DeliverablePackage / DeliverableVersion / Learning Record` 的接线；
4. 定义不可变身份快照与变更规则；
5. 定义 legacy 兼容；
6. 定义测试与 Electron 验收场景。

### 1.2 本轮明确不做

1. 公网协作、实时多人协作、他人的 Digital Me 调用；
2. Agent 市场、Digital Org、AP2、支付、结算；
3. 邀请、群组、组织权限产品面；
4. 完整 Collaboration Runtime；
5. 新的 DID / VC 主系统；
6. 新的外部协作 UI 中心；
7. 任何应用实现代码修改。

---

## 2. 最小主体语义

### 2.1 Initiator

定义：发起本次任务或行动的主体。

当前默认：

```text
initiatorSubjectId = Owner 本人
```

本轮规则：

1. 只允许语义上预留 future source；
2. 当前产品面不开放“定时触发”“外部系统触发”“其他主体触发”；
3. legacy 读取可推断为 Owner 本人，但必须标记 `identityContextSource=legacy_default_inference`。

### 2.2 Owner

定义：任务、数据、成果与最终控制权的主归属主体。

当前默认：

```text
ownerSubjectId = Owner 本人
```

强制：

1. 模型不是 owner；
2. Skill 不是 owner；
3. 工具不是 owner；
4. Digital Me 不是脱离本人的资产所有人；
5. 执行体变化不得改变成果所有权。

### 2.3 Represented Subject

定义：本次行动所代表的主体。

当前默认：

```text
representedSubjectId = Owner 本人
```

本轮结论：

1. 必须与 `ownerSubjectId` 分开建模，尽管当前默认值相同；
2. 未来可扩展为项目、组织角色或“仅助手、不代表主体”；
3. 当前普通用户无需选择；默认跟随 Owner 本人。

### 2.4 Acting Subject

定义：数字系统中承担统筹、判断和行动编排的数字主体。

当前默认：

```text
actingSubjectId = 本人的 Digital Me
```

强制：

1. Acting Subject 不等于 executor；
2. 模型供应商、工具进程、Skill 不能冒充 Acting Subject；
3. 当前产品面可白话显示为“你的 Digital Me 代表你生成”。

### 2.5 Acting Role

定义：Digital Me 本次以什么角色或职责行动。

本轮结论：

1. 字段必须存在；
2. 允许为空；
3. 若存在，应优先引用当前角色视图；
4. 角色变化不会改写历史成果；新计划或新生成时才可形成新快照。

### 2.6 Executor

定义：执行具体步骤的模型、Skill、工具、运行时或人工执行体。

本轮结论：

1. `executor` 永远不等于 `owner`、`representedSubject` 或 `actingSubject`；
2. 当前常见 executor 类型为 `model` / `tool` / `skill` / `local_runtime` / `composite_executor`；
3. 同一 `representedSubject` 可对应多个不同 executor；
4. 更换 executor 不改变成果归属，只影响 provenance。

---

## 3. 核心模型

### 3.1 SubjectRef

```json
{
  "subjectId": "subj_owner_xxx",
  "subjectType": "natural_person",
  "displayName": "Owner",
  "identityRef": {
    "kind": "did_dme",
    "refId": "did:dme:..."
  },
  "ownerSubjectId": "subj_owner_xxx",
  "localOnly": true
}
```

本轮要求：

1. `subjectType` 正式枚举：
   - `natural_person`
   - `digital_me`
   - `role`
   - `organization`
   - `external_agent`
   - `system`
2. 本轮实际主路径只要求：
   - `natural_person`
   - `digital_me`
   - `role`
3. `identityRef` 可空；若存在，只作为关联，不暴露原始 DID / VC 到默认产品面；
4. `ownerSubjectId` 用于表达“这个主体实体归谁控制”；`digital_me` 类型应指回 Owner 本人。

### 3.2 ParticipantRef

```json
{
  "participantId": "part_acting_xxx",
  "participantType": "acting_subject",
  "subjectRef": { "...": "SubjectRef" },
  "executorRef": null,
  "displayName": "你的 Digital Me",
  "role": "founder",
  "participationScope": ["plan", "generate", "review_prepare"],
  "responsibilityScope": ["digital_me_preparation_only"]
}
```

正式枚举：

- `initiator_subject`
- `owner_subject`
- `represented_subject`
- `acting_subject`
- `reviewer_subject`
- `acceptor_subject`
- `executor`
- `tool`
- `skill`
- `system_guard`

本轮结论：

1. **不建立独立 Participant Store**；
2. `participantRefs` 作为 `ActionIdentityContext` 内嵌不可变快照；
3. 主体参与者与执行参与者必须区分，不得全部包装成“人”；
4. `executor` / `tool` / `skill` 可不带 `subjectRef`，但必须带 `executorRef`。

### 3.3 ExecutorRef

```json
{
  "executorId": "exec_modelroute_xxx",
  "executorType": "model",
  "provider": "local_route",
  "capabilityRef": "artifact_generation",
  "modelRef": "artifact/default",
  "skillRef": null,
  "toolRef": null,
  "runtimeRef": "main_process",
  "version": "route_v1",
  "locality": "local"
}
```

本轮正式枚举：

- `model`
- `skill`
- `tool`
- `local_runtime`
- `coding_agent`
- `human`
- `composite_executor`

强制：

1. 不得记录密钥；
2. `provider` 不是主体；
3. `locality` 仅表达执行位置与信任边界，不表达所有权；
4. 多执行体场景使用 `executorRefs[]`。

### 3.4 AuthorizationRef

```json
{
  "authorizationId": "auth_task_xxx",
  "authorizationType": "task_preparation",
  "grantorSubjectId": "subj_owner_xxx",
  "granteeSubjectId": "subj_dm_xxx",
  "scope": {
    "taskId": "abt_xxx",
    "planVersionId": "dplanver_xxx",
    "outputRoot": "userData/deliverable-artifacts"
  },
  "resourceRefs": ["task:abt_xxx", "planVersion:dplanver_xxx"],
  "actionTypes": ["task_preparation", "source_read", "model_processing", "local_artifact_write"],
  "issuedAt": "2026-07-27T00:00:00.000Z",
  "expiresAt": null,
  "revokedAt": null,
  "status": "granted",
  "confirmationRef": "confirm:plan_xxx",
  "policyRef": null
}
```

#### 本轮授权类型

- `task_preparation`
- `source_read`
- `model_processing`
- `local_artifact_write`
- `artifact_acceptance`
- `learning_writeback`

预留但不落地产品面：

- `external_send`
- `publish`
- `payment`
- `contract`
- `data_share`

#### 授权状态

- `proposed`
- `granted`
- `expired`
- `revoked`
- `consumed`
- `denied`

本轮结论：

1. 暂不强制独立网络化 `AuthorizationRecord`；
2. 但必须定义**权威持久化对象**：最小 `AuthorizationRecord` 或同等主表记录；
3. `AuthorizationRef` 只是引用或裁剪视图，不能单独承担全部授权事实；
4. 用户点击一次“开始生成”不得被解释为无限期、跨任务、跨目录、跨动作授权；
5. revoke 只影响**新动作能否启动**，不删除历史审计记录。

### 3.5 ActionIdentityContext

```json
{
  "schemaVersion": 1,
  "identityContextId": "aic_xxx",
  "identityContextSource": "native_snapshot",
  "initiatorSubjectId": "subj_owner_xxx",
  "ownerSubjectId": "subj_owner_xxx",
  "representedSubjectId": "subj_owner_xxx",
  "actingSubjectId": "subj_dm_xxx",
  "actingRoleRef": {
    "roleId": "role_founder",
    "displayName": "创始人角色"
  },
  "participantRefs": [],
  "executorRefs": [],
  "authorizationRefs": [],
  "responsibilityBoundary": [
    "owner_decision_required",
    "digital_me_preparation_only",
    "executor_technical_execution",
    "no_external_commitment",
    "no_payment",
    "no_publication"
  ],
  "createdAt": "2026-07-27T00:00:00.000Z"
}
```

本轮正式结论：

1. `ActionIdentityContext` 是**统一身份上下文模型**；
2. 权威副本应由 **main/store** 持久化；
3. `Task` 持有“当前引用”；
4. `PlanVersion / DeliverablePackage / DeliverableVersion / Learning Record` 保存**不可变快照或快照引用**；
5. **执行和成果版本必须保存不可变身份快照**，不能只依赖当前身份状态；
6. 执行期间身份上下文默认不可变；发生关键变更时，应创建新上下文并要求新计划或新生成确认。

### 3.6 responsibilityBoundary

最小正式枚举：

- `owner_decision_required`
- `digital_me_preparation_only`
- `executor_technical_execution`
- `no_external_commitment`
- `no_payment`
- `no_publication`

本轮默认表达：

1. Digital Me 可以代表 Owner 进行规划、准备、生成编排；
2. executor 只负责技术执行；
3. Owner 保留最终接受/否定权；
4. 系统不得自动对外承诺、发布、付款或签约。

---

## 4. 当前单主体默认关系

| 语义 | 当前默认 |
|------|----------|
| `initiator` | Owner 本人 |
| `owner` | Owner 本人 |
| `representedSubject` | Owner 本人 |
| `actingSubject` | 本人的 Digital Me |
| `actingRole` | 当前选择角色；缺省为默认本人模式 |
| `executor` | 本地或已接入模型、Skill、工具 |
| `finalReviewer` | Owner 本人 |
| `finalAcceptor` | Owner 本人 |
| `deliverableOwner` | Owner 本人 |

强制：

1. 上述默认值应自动形成；
2. 普通用户不需要手填六个身份字段；
3. 默认值只是当前 UX 简化，不得写成长期唯一语义。

---

## 5. 与现有系统接线

### 5.1 Task

`Task` 应新增或保存兼容视图：

```json
{
  "identityContextRef": "aic_xxx",
  "initiatorSubjectId": "subj_owner_xxx",
  "ownerSubjectId": "subj_owner_xxx",
  "representedSubjectId": "subj_owner_xxx"
}
```

权威规则：

1. `Task` 持有当前身份引用；
2. renderer 不得自行构造权威 owner / represented subject；
3. `main` / store 负责校验和持久化；
4. `Task` 上的 `initiatorSubjectId` / `ownerSubjectId` / `representedSubjectId` 仅为当前视图缓存，不得作为 `DeliverableVersion`、接受/否定、学习写回的权威来源；权威身份以对应时点不可变 `identityContextSnapshot` 为准；
5. 禁止用 `Task` 当前身份字段回写或覆盖已落盘的 `PlanVersion` / `DeliverablePackage` / `DeliverableVersion` / `Learning Record` 快照。

### 5.2 PlanVersion

`PlanVersion` 必须能回答“规划时以什么身份理解目标”。

本轮结论：

1. 保存 `identityContextSnapshot` 或 `identityContextRef + identityContextDigest`；
2. 身份快照的权威落盘时点为「成果计划确认（planConfirmed）」；确认前的规划草稿可持临时引用，但不得以未确认草稿作为生成或接受的权威身份依据；
3. 计划确认后，若 `actingRole` / `representedSubject` 发生变化，应视为需要重新确认计划；
4. 仅 displayName 变化不强制重确认，但历史快照应保留原值。

### 5.3 DeliverablePackage

至少记录：

- `identityContextSnapshot`
- `sourcePlanVersionId`
- `initiatorSubjectId`
- `ownerSubjectId`
- `representedSubjectId`
- `actingSubjectId`
- `authorizationRefs`

本轮结论：

1. Package 是执行准备阶段的权威身份落点之一；
2. 若 Package 由旧数据读出而缺字段，可在兼容视图中补推断，但不得静默回写成原始事实。

### 5.4 DeliverableVersion

本轮重点接线对象。至少记录：

```json
{
  "identityContextSnapshot": { "...": "ActionIdentityContext" },
  "initiatorSubjectId": "subj_owner_xxx",
  "ownerSubjectId": "subj_owner_xxx",
  "representedSubjectId": "subj_owner_xxx",
  "actingSubjectId": "subj_dm_xxx",
  "actingRoleRef": { "...": "roleRef" },
  "executorRefs": [],
  "authorizationRefs": [],
  "reviewerSubjectId": "subj_owner_xxx",
  "acceptedBySubjectId": "subj_owner_xxx",
  "responsibilityBoundary": []
}
```

强制：

1. `DeliverableVersion` 必须成为身份与责任语义的主审计对象；
2. `ArtifactRef` 继续负责文件与完整性，不承载全部身份语义；
3. 重新生成可沿用同一个 `Task` / `representedSubject`，但应允许创建新的 `executorRefs` 与新的 `ActionIdentityContext` 快照；
4. `acceptedBySubjectId` 只有在接受后才有值；否定路径必须保留 `reviewerSubjectId` 但 `acceptedBySubjectId=null`。

### 5.5 ArtifactRef

规则：

1. 继续只负责 `relativePath` / `mimeType` / `byteSize` / `contentHash` 等文件事实；
2. 通过 `versionId` 回溯到对应 `DeliverableVersion.identityContextSnapshot`；
3. 不应复制整套身份字段。

### 5.6 CRT

分工固定：

| 层 | 职责 |
|----|------|
| 身份与授权语义 | 谁代表谁、谁授权、谁负责、成果归谁 |
| CRT | 带哪些主体材料、采用何种 evidence / ownership / claim posture |
| Deliverable provenance | 实际用了哪些输入、模型、工具和生成过程 |
| ArtifactRef | 文件位置、格式、哈希 |
| Owner review | 接受、否定、重新生成 |

强制：

1. 不得让 CRT 承担完整身份与授权系统职责；
2. `ownership`、`evidence`、`claim posture` 必须与 `ActionIdentityContext` 一致，不得互相冲突；
3. `representedSubject` 与 `actingRole` 影响“该带哪些主体材料”，但不取代 CRT 的情境分类。

### 5.7 Learning Record

接受后学习至少记录：

- 谁接受了哪个版本；
- 该版本代表谁生成；
- 写入哪个主体的长期资产；
- 使用了什么 `authorizationRef`（如 `learning_writeback`）；
- 若为 legacy 推断，必须明示推断来源。

强制：

1. 否定成果不得进入正向学习；
2. 未接受版本不得自动写入长期资产；
3. 不得把属于其他主体的成果写进 Owner 的 Digital Me；
4. 当前默认仍写回 Owner 的 Digital Me；
5. `learning_writeback` 的 `granteeSubjectId` 必须与 `identityContextSnapshot` 中约定的长期资产写回主体一致；当前默认是 Owner 的 Digital Me；未来 `representedSubjectId ≠ ownerSubjectId` 时，写回目标须在快照中显式指定，不得默认回落到 Owner。

---

## 6. 不可变快照与变更规则

### 6.1 总原则

> 历史成果保留生成时的不可变身份快照；当前身份信息变化不得重写历史事实。

### 6.2 具体规则

1. 用户更换角色后，旧成果保留原 `actingRoleRef`；
2. Package 更新后，旧成果仍指向原 `identityContextSnapshot`；
3. 模型更换后，旧成果的 `executorRefs` 不变；
4. 授权被撤销后，旧成果 provenance 仍保留，但新动作不得继续启动；
5. displayName 变化时，历史快照保留旧 displayName；当前视图可另显示“当前名”；
6. 重新生成默认创建新的 `DeliverableVersion`，并允许新 `identityContextSnapshot`；
7. 若 `representedSubject` 或 `actingRole` 变化，应要求重新确认计划或至少重新生成，不得静默沿用旧确认。

---

## 7. 授权语义

### 7.0 与 DVL2-00 授权关系

DVL2-00 的 `planConfirmed` 与 `riskAuthorizations[]` 继续表达“成果计划确认”与“高风险动作边界”。IDCOLLAB-MIN-01 引入的本地 `AuthorizationRecord` 是身份与责任审计主表，`authorizationRefs[]` 是各层引用。

实施时必须满足：

1. 低风险本地动作（`task_preparation` / `source_read` / `model_processing` / `local_artifact_write` / `artifact_acceptance` / `learning_writeback`）写入本地 `AuthorizationRecord` 并由各对象引用；
2. `riskAuthorizations[]` 仅承载 DVL2-00 已定义的高风险动作，不得与低风险授权混成同一无界 scope；
3. 禁止两套记录对同一动作给出冲突 `status`；
4. `planConfirmed` 不是无限授权，也不替代 `AuthorizationRecord`。

### 7.1 最小授权对象

本轮推荐引入**任务级本地 `AuthorizationRecord`**，由 `main/store` 维护。它不是公网协议对象，而是本地权威审计对象。

注：示例中的 `oneTime: false` 仅表示同一 `taskId` + 已确认 `planVersionId` 边界内可多次生成/重试；不得跨任务、跨目录或无界复用。

最小字段：

```json
{
  "authorizationId": "auth_xxx",
  "schemaVersion": 1,
  "grantorSubjectId": "subj_owner_xxx",
  "granteeSubjectId": "subj_dm_xxx",
  "scope": {
    "taskId": "abt_xxx",
    "planVersionId": "dplanver_xxx",
    "materialRefs": ["mat_xxx"],
    "outputRoot": "userData/deliverable-artifacts",
    "oneTime": false
  },
  "actionTypes": [],
  "status": "granted",
  "issuedAt": "2026-07-27T00:00:00.000Z",
  "expiresAt": null,
  "revokedAt": null
}
```

### 7.2 当前默认授权映射

1. 计划确认后，不自动获得 `external_send` / `publish` / `payment`；
2. 进入当前 DVL2 主路径时，仅可默认形成：
   - `task_preparation`
   - `source_read`
   - `model_processing`
   - `local_artifact_write`
3. 接受成果时形成或消费：
   - `artifact_acceptance`
   - `learning_writeback`

### 7.3 revoke 语义

1. revoke 后不能启动新的生成或学习写回；
2. 已存在的版本、文件和审计记录保留；
3. 不因 revoke 删除历史。

---

## 8. 安全与隐私

1. 默认私有、本地优先；
2. 不把完整 DID / VC 暴露到默认用户面；
3. `AuthorizationRef` 不包含密钥；
4. executor 不获得超出任务所需的数据；
5. 旧授权不得被新任务无界复用；
6. renderer 不得构造或覆盖权威 owner / represented subject；
7. IPC 输入必须校验；
8. 不允许通过修改前端字段伪造 owner / represented subject / acceptedBy；
9. main/store 是权威持久化边界；
10. 日志不得记录敏感凭据正文。

---

## 9. Legacy 策略

### 9.1 读取旧数据

不做批量破坏性迁移。旧 `Task / Package / Version / Learning` 读取时生成兼容视图。

### 9.2 默认推断

对 DVL2-03 以前记录可推断：

```text
initiatorSubjectId = Owner 本人
ownerSubjectId = Owner 本人
representedSubjectId = Owner 本人
actingSubjectId = 本人的 Digital Me
acceptedBySubjectId = Owner 本人（仅当旧 reviewStatus = accepted）
```

### 9.3 推断来源标记

所有兼容视图必须携带：

```text
identityContextSource = legacy_default_inference
```

并可附加：

```text
identityConfidence = inferred_default_single_subject
```

### 9.4 schema 升级

1. 新记录使用新的 `schemaVersion`；
2. 旧记录不强制回填；
3. 若后续执行有界迁移，应保留“原始缺失字段”和“迁移后推断字段”的区别，不得抹平。

---

## 10. 用户体验原则

### 10.1 普通用户默认看到

```text
由你的 Digital Me 代表你生成
执行能力：当前模型与文档工具
成果归你所有
最终由你确认
```

### 10.2 高级详情展开可见

1. 发起者；
2. 代表主体；
3. 行动主体；
4. 当前角色；
5. 执行能力；
6. 授权范围；
7. 来源与接受人；
8. 责任边界摘要。

### 10.3 默认不得显示

1. `subjectId`
2. `participantId`
3. `authorizationId`
4. provider 内部编号
5. schema 名称
6. DID 原始字符串
7. VC 原始内容

---

## 11. 测试与验收设计

### 11.1 合同测试

至少覆盖：

1. `SubjectRef` 字段与 `subjectType`；
2. `ParticipantRef` 不变量；
3. `ActionIdentityContext` 必填字段；
4. `ExecutorRef` 与主体分离；
5. `AuthorizationRef` 不含密钥；
6. 所有权一致性；
7. 引用完整性；
8. 不可变快照；
9. legacy 兼容；
10. 前端篡改 owner / represented subject 被拒绝。

### 11.2 Electron 验收 A–H

| 场景 | 目标 |
|------|------|
| A 默认单主体生成 | 新成果自动形成默认单主体语义 |
| B 角色化生成 | 角色被写入 `actingRoleRef`，后续换角色不改旧成果 |
| C 执行体可追溯 | 同一计划更换模型/工具时，`executorRefs` 变化、ownership 不变 |
| D 成果接受人与所有人 | `reviewerSubjectId` / `acceptedBySubjectId` 正确 |
| E 授权撤销后禁止新行动 | revoke 后无法启动新生成；旧记录保留 |
| F 重启恢复 | 身份上下文、接受状态、责任摘要恢复一致 |
| G 旧成果兼容 | legacy 记录可展示且带 `legacy_default_inference` |
| H 前端篡改 owner 字段被拒绝 | renderer 伪造 owner / represented subject 无效 |

补充：

1. 场景 E（授权撤销）可通过受控入口触发 revoke，如 main IPC 验收 harness 或开发者验收开关；
2. 本轮不要求为普通用户新增授权撤销控制台；
3. 验收必须证明 revoke 后新生成/学习写回被拒绝，且历史版本、文件与审计仍保留。

---

## 12. 独立复核与修订记录

### 12.1 v0.1.0 初稿主要风险

1. 容易把 `ParticipantRef` 推向独立 Store，超出本轮范围；
2. 容易让 `AuthorizationRef` 直接承担全部授权事实；
3. 容易把角色变化与 displayName 变化都当作重确认触发；
4. 容易让 legacy 推断看起来像原始真实记录；
5. 容易把 CRT 的 ownership/evidence 与身份授权语义混成同一层。

### 12.2 v0.1.1 修订

1. 明确 **不建 Participant Store**；
2. 明确 `AuthorizationRef` 背后仍需要本地权威 `AuthorizationRecord` 或同等主表；
3. 明确只有 `representedSubject` / `actingRole` 等关键身份语义变化才要求重新确认，displayName 变化不强制；
4. 强制 `identityContextSource=legacy_default_inference`；
5. 固化“身份与授权语义 / CRT / provenance / ArtifactRef / Owner review”五层分工。

### 12.3 v0.1.2 修订

1. 明确 `Task` 上的主体字段只是当前视图缓存，不得覆盖版本快照；
2. 明确 `PlanVersion` 身份快照的权威锁定时点为 `planConfirmed`；
3. 明确 DVL2-00 高风险授权与 IDCOLLAB 本地授权主表的关系；
4. 明确 `learning_writeback` 的写回主体必须由快照显式指定；
5. 明确 revoke 的验收入口可以是受控 harness，不要求新增普通用户主路径 UI；
6. 收敛后维持 `codex_review_passed` / `ready_for_owner_acceptance`。

### 12.4 最终结论

本文 v0.1.2 曾通过 Codex 独立复核；Owner 已确认实施决策并授权实现。

### 12.5 实施证据（2026-07-27）

1. `representedSubjectId = Owner 本人`（无项目/组织切换 UI）；
2. 独立轻量本地 `AuthorizationRecord` 主表（`<userData>/authorizations.json`）；
3. revoke = 受控 harness + 高级详情「撤销本次授权」。

实现落点：

| 模块 | 路径 |
|------|------|
| Schema | `digitalme-app/src/act-behalf/action-identity-schema.js` |
| Identity helpers | `digitalme-app/src/act-behalf/action-identity.js` |
| Authorization store | `digitalme-app/src/act-behalf/authorization-store.js` |
| Plan confirm 锁定 | `deliverable-planner.js` / `deliverable-confirm-and-generate.js` |
| Package / Version | `deliverable-package-prepare.js` / `deliverable-generation.js` |
| Learning | `deliverable-auto-learn.js` |
| IPC / preload | `main.js` / `preload.js` |
| 高级详情 UI | `renderer/deliverable-planner.js` / `renderer/app.js` |
| 合同测试 | `scripts/test-idcollab-min-01-contracts.cjs` |

自动化：

```text
npm run test:idcollab-min-01     → 11 passed
npm run test:dvl2-03-one-click   → 6 passed
npm run test:dvl2-03-generation  → 6 passed
npm run test:dvl2-04-auto-learn  → 6 passed
```

当前状态：

```text
implemented / codex_verified / ready_for_owner_runtime_reacceptance
```

**不得**提前标记 `owner_runtime_accepted` / `accepted_as_implemented`。不得 push。

### 12.6 Owner 真机验收失败修复（MIN-01.1 · 2026-07-27）

**问题 1 — 撤销未即时生效**

根因：`prepareDeliverablePackage` 在检测到无 active grant 时会**自动重新授予**；`grantTaskAuthorization` 在已有 revoked 记录时仍会创建新 grant。持久化已撤销，但同进程内后续动作可绕过。

修复：
- 新增 `resolveActiveTaskAuthorization` / `getTaskAuthorizationStatus` / `findRevokedGrantForPlan`；
- 所有生成/接受/学习/prepare 入口改为每次从 Store 权威读取；
- revoked 后禁止同 planVersion 重新 grant（`revoked_blocked`）；
- renderer 撤销后立即刷新面板、禁用按钮、显示撤销横幅。

**问题 2 — 主界面信息过载**

修复：默认只保留一句摘要；计划高级字段与身份/授权内容收入「更多设置」「详情」「高级审计」折叠区；成果卡只显示标题/类型/时间/状态与必要操作。

自动化（修复后）：

```text
npm run test:idcollab-min-01       → 13 passed
npm run test:idcollab-min-01.1-ui  → 3 passed
npm run test:dvl2-03-one-click     → 6 passed
npm run test:dvl2-03-generation    → 6 passed
npm run test:dvl2-04-auto-learn    → 6 passed
```

---

## 13. Owner 接受后实施边界（预告）

Owner 若接受并冻结本规格，后续实施只允许：

1. 向现有 `Task / PlanVersion / DeliverablePackage / DeliverableVersion / Learning` 补最小身份与授权字段；
2. 引入本地最小 `AuthorizationRecord`；
3. 增加兼容视图与校验；
4. 增加最小责任摘要展示；
5. 增加合同测试与 Electron 验收；
6. 不得顺带开启公网协作、Digital Org、支付、Agent 市场或完整 Collaboration Runtime。

> 注：上表边界已在本轮实现中遵守；本节保留为历史合同表述。

---

## 14. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-27 | 初稿：定义最小主体、参与方、授权、快照、legacy 与验收面 |
| v0.1.1 | 2026-07-27 | Codex 独立复核后收敛：不建 Participant Store、授权采用本地主表 + 引用、强化 legacy 标记与分层职责 |
| v0.1.2 | 2026-07-27 | 吸收独立复核补强：Task 缓存字段非权威、PlanVersion 锁定时点、DVL2-00 授权关系、学习写回主体与 revoke 验收入口 |
| v0.1.2-impl | 2026-07-27 | 实施完成：状态改为 `implemented` / `codex_verified` / `ready_for_owner_runtime_acceptance`；记录实现证据与回归结果 |
| v0.1.2-fix1 | 2026-07-27 | Owner 真机验收失败修复（MIN-01.1）：撤销即时生效；主界面极简与渐进披露；`ready_for_owner_runtime_reacceptance` |

**文档结束**
