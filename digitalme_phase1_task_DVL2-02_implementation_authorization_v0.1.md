# 任务包 DVL2-02：implementation authorization（实施授权）

版本：v0.1.0
日期：2026-07-26
状态：`specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation` / `implementation_authorized` / `owner_runtime_accepted` / `accepted_as_implemented` / `implemented`
实施：`implemented`
implementation_authorized：`true`
implementation_branch：`codex/dvl2-02-deliverable-package-preparation`
implementation_branch_base：`ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`
上位冻结规格：[`digitalme_phase1_task_DVL2-02_deliverable_package_and_execution_preparation_v0.1.md`](digitalme_phase1_task_DVL2-02_deliverable_package_and_execution_preparation_v0.1.md)（**DVL2-02 v0.1.1** / `owner_accepted` / `frozen_for_implementation`）
冻结规格提交：`ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`
冻结实施授权基线：`0a52606b058688865e27b96ed965b22f937fd278`
规格内容冻结基线：`578648f31d86594cc2bd56ede2e367122cfa98f8`
实现提交：`20c883298ba9f2e5e707015c4fd6c9dd109ad601`
Owner 授权记录提交：`b041fde27edb052143a50b466bb5455888b35e4a`
实施证据提交：`866f2b2e3400da81d1afc1a54b6477f679766cc6`

> **正式边界**：DVL2-02 **成果包与执行准备**已实现，且 **Owner 真机验收通过**（`owner_runtime_accepted` / `accepted_as_implemented` / `implemented`）。  
> **明确不等于**：真实成果生成已实现。DVL2-03 / DVL2-03A **尚未实现**。本任务**没有**生成 Word / PPT / HTML / 图片成果；**没有** DeliverableVersion；**没有** ArtifactRef / contentHash；自动验收路径**没有**真实模型调用。冲突时：架构原则文 > DVL2-00 > DVL2-01 > DVL2-02 冻结规格 > 本文。

### Owner 真机验收记录

**结论**：Owner 真机验收通过（2026-07-26）。

验收范围仅限 DVL2-02：

- 可从 confirmed plan 准备成果包；
- 可恢复 `activePackageId` 与准备态；
- 重复准备命中同一有效 package；
- 不进入真实文件生成。

### Owner 实施授权记录

**结论**：已授权并已实现。

Owner 授权原意（历史）：

- 按冻结规格和实施授权包实现；
- 允许创建指定实现分支 `codex/dvl2-02-deliverable-package-preparation`，起点 `ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`；
- 不允许扩大到 DVL2-03；
- 不允许生成真实成果 / DeliverableVersion / ArtifactRef / contentHash；
- 不允许 push；
- 实现完成后必须等待 Owner runtime acceptance（**本轮已通过**）。

### 实施证据（已通过 Owner 真机）

| 项 | 证据 |
|----|------|
| 实现 commit | `20c883298ba9f2e5e707015c4fd6c9dd109ad601` |
| 证据 commit | `866f2b2e3400da81d1afc1a54b6477f679766cc6` |
| 新增模块 | `deliverable-package-{schema,store,prepare,consistency,recovery,readiness}.js` |
| 新增测试 | `test-dvl2-02-package-contracts.cjs`；`run/electron/dvl2-02-package-acceptance*.cjs` |
| 有界修改 | `task-store.js`、`main.js`、`preload.js`、`renderer/{app.js,deliverable-planner.js,index.html,styles.css}`、`package.json` |
| Store 路径 | `<userData>/deliverable-packages.json`（顶层含 schemaVersion/revision/packages/deliverables/preparationAttempts/updatedAt；无 versions/artifacts） |
| CAS / queue | temp+rename；进程内 write queue；queue 内重读 + expectedRevision / expectAbsent |
| 合同测试 | `npm run test:dvl2-02-package` → 17 passed |
| Electron Phase A/B | `.codex-qa/dvl2-02-package-acceptance/`；two-phase summary pass |
| 真实模型 / 付费（自动验收） | 无（`DIGITALME_PLANNER_FORCE_RULE=1` / `DIGITALME_ACT_BEHALF_FAKE=1`） |
| Version / ArtifactRef / contentHash | 无 |
| 禁止路径变化 | 无 |

---

## 0. 文档地位

1. 承接 DVL2-02 v0.1.1 文首「implementation_authorization 门禁」。
2. Codex 授权复核已通过（`codex_review_passed` / `ready_for_owner_implementation_authorization`）。
3. 仅当 Owner 另批 `implementation_authorized=true` 后，方可创建实现分支并编码。
4. 授权通过 ≠ 已实现 ≠ Owner 真机验收通过。

---

## 1. 实施目标（授权覆盖）

获授权后实现仅覆盖：

1. 从 confirmed plan 准备 `DeliverablePackage`；
2. 创建 `Deliverable`；
3. 创建 `PackagePreparationAttempt`；
4. 写入 `<userData>/deliverable-packages.json`；
5. `Task.deliverableExecution.activePackageId`；
6. CAS / 原子写 / write queue；
7. reconciliation；
8. `CurrentPreparationReadiness`；
9. legacy 做事页「准备成果包」入口；
10. 默认隐藏旧执行入口；
11. 重启恢复；
12. **无**真实成果、**无** `DeliverableVersion`、**无** `ArtifactRef`、**无** `contentHash`。

### 1.1 明确不覆盖

- Word / PPT / HTML / 图片生成；
- `DeliverableVersion` / `ArtifactRef` / `contentHash`；
- `DeliverableGenerationAttempt`；
- DVL2-03 及后续；
- 将 `result-generation.js` 接入 confirmed 计划；
- `src/package-store/**`；
- renderer-next；
- R3 / R2.5 / PAN-02。

---

## 2. 实现分支方案（冻结意图）

| 项 | 要求 |
|----|------|
| 分支名 | `codex/dvl2-02-deliverable-package-preparation` |
| 起点 | **`ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`** |
| 创建时机 | **仅在** Owner 授予 `implementation_authorized=true` 之后 |
| 禁止 | 继续在 `codex/dvl2-01-deliverable-planner` 上编码 |

创建后必须：

1. `git rev-parse HEAD` 验证等于 `ad3b6ee…`；
2. 不允许混入 DVL2-01 后续未审查修改；
3. 不允许 merge 其他未审查分支；
4. 不允许 push，除非 Owner 另行授权。

---

## 3. 允许新增文件（最终推荐）

### 3.1 运行时（act-behalf）

```text
digitalme-app/src/act-behalf/deliverable-package-schema.js
digitalme-app/src/act-behalf/deliverable-package-store.js
digitalme-app/src/act-behalf/deliverable-package-prepare.js
digitalme-app/src/act-behalf/deliverable-package-consistency.js
digitalme-app/src/act-behalf/deliverable-package-recovery.js
digitalme-app/src/act-behalf/deliverable-package-readiness.js
```

### 3.2 测试与验收脚本

```text
digitalme-app/scripts/test-dvl2-02-package-contracts.cjs
digitalme-app/scripts/run-dvl2-02-package-acceptance.cjs
digitalme-app/scripts/electron-dvl2-02-package-acceptance.cjs
digitalme-app/scripts/dvl2-02-package-acceptance-harness.cjs
```

### 3.3 package.json 脚本名（仅新增，不改依赖）

```text
"test:dvl2-02-package": "node scripts/test-dvl2-02-package-contracts.cjs"
"test:dvl2-02-package-acceptance": "node scripts/run-dvl2-02-package-acceptance.cjs"
```

---

## 4. 允许有界修改文件

| 文件 | 必须改的原因 | 最大允许范围 | 禁止 | 测试覆盖 |
|------|--------------|--------------|------|----------|
| `act-behalf/task-store.js` | 增加 `deliverableExecution.activePackageId` | 仅 Task 形状 / normalize / save 指针字段；schemaVersion 递增须显式迁移 | 禁止顺手重构 Task 生命周期、结果、调研链 | 指针 CAS、reconciliation、与 confirmed 一致性 |
| `main.js` | prepare/get/list IPC；启动 reconciliation；接线 readiness | 仅新增 handler 与必要 require | 禁止改 research/result 主链；禁止大重构 | IPC、幂等、`degraded_consistency` |
| `preload.js` | 暴露 prepare/get/list | 仅薄封装 | 禁止默认暴露 reconcile | preload 绑定 |
| `renderer/app.js` | 「准备成果包」；旧入口默认隐藏；减负默认层 | 做事页薄适配 | 禁止「开始生成成果」；禁止并列旧主按钮 | UI 状态机 |
| `renderer/index.html` | 按钮/容器挂点（如需） | 最小 DOM | 禁止大改布局 | testid |
| `renderer/styles.css` | 二级展开区（如需） | 最小样式 | 禁止整套重设计 | 冒烟 |
| `digitalme-app/package.json` | 新增上述 test 脚本 | **仅** scripts 两项 | **禁止**升级依赖；**禁止**改 `package-lock.json` | 脚本可运行 |

只允许新增或修改本包列出的文件。

---

## 5. 禁止修改范围

```text
digitalme-app/src/package-store/**
digitalme-app/src/act-behalf/result-generation.js
digitalme-app/src/renderer-next/**
digitalme-app/src/entry/**
digitalme-app/src/sessions.js
digitalme-app/package-lock.json
任何 outputs / artifacts / generated-results 目录
任何真实 userData
任何密钥配置
DVL2-00 / DVL2-01 冻结正文
DVL2-02 冻结合同正文
DVL2-03 及后续任务实现
```

如发现必须修改禁止范围：**立即停止**，回到规格或授权评审，不得自行扩大范围。

---

## 6. Store / CAS 合同（Gate 2）

| 项 | 冻结 |
|----|------|
| 文件 | `<userData>/deliverable-packages.json` |
| 顶层 | `{ schemaVersion, revision, packages, deliverables, preparationAttempts, updatedAt }` |

强制：

1. 原子 **temp + rename**；
2. 进程内 **write queue**；
3. **CAS 必须在 write queue 内完成**；
4. 进入 queue 后、CAS 前 **重新读取最新 Store**；
5. 首次创建使用 **`expectAbsent`**；
6. 更新使用 **`expectedRevision`**（或等价 token）；
7. **stale write 不改变持久化内容**（字节或语义不变）；
8. schema **fail-closed**；损坏 Store **不得**自动覆盖为空；
9. **同一 `taskId` + `confirmedPlanVersionId` 最多一个有效 package**；
10. 双有效包 **fail-closed**；**不得**用 `updatedAt` 自动择优；
11. **不出现** `versions` / `artifacts` 运行时集合；
12. **不得**写真实路径或伪文件引用；
13. 未知字段：不得驱动业务；非法 schemaVersion fail-closed。

### 6.1 CAS / 并发矩阵（必须测试）

1. 首次创建 `expectAbsent`；
2. 同 confirmed 重复准备幂等返回；
3. 两个并发首次准备只成功一个；
4. stale `expectedRevision` 被拒绝；
5. stale write 后 Store 字节或语义不变；
6. Store 成功、Task 指针失败 → **`degraded_consistency`**；
7. degraded 再次准备前先 reconciliation；
8. **不得**产生第二个有效 package；
9. 双有效 package fail-closed；
10. archived 普通准备不静默新建；
11. soft_deleted 普通准备不恢复、不替代；
12. 新 confirmed 创建新 package；
13. 旧 package `sourcePlanVersionId` 不变；
14. `activePackageId` 只指向当前 confirmed 对应包。

---

## 7. PackagePreparationAttempt 合同

Attempt 必须包含（或等价表达）字段：

```ts
outcome: "created_new" | "existing_package" | null
// null 仅允许于非成功终态（started/interrupted/failed/cancelled）
```

必须测试：

- `started` / `interrupted` / `failed` **不得**成为 `activePackageId` 依据；
- `succeeded` 时 `packageId === createdPackageId`；
- `existing_package` **不修改**既有成功 attempt；
- 每次用户显式准备动作**可以**新增 attempt；
- 历史 attempt **不覆盖**；
- **不完整 attempt 不得显示「成果包准备成功」**；
- 崩溃恢复保留历史。

**冻结推荐**：每次显式准备可建新 attempt；幂等命中 `outcome=existing_package`；不得改写既有成功 attempt。

---

## 8. reconciliation 合同（Gate 3）

| # | 情形 | 行为 |
|---|------|------|
| 1 | Task 指针缺失、Store 有唯一合法包 | 恢复指针 |
| 2 | Task 指针指向缺失包 | 清空指针并审计 |
| 3 | `activeConfirmedVersionId` 改变 / 与指针包不一致 | 清空旧 `activePackageId`；**不修改**旧 `sourcePlanVersionId`；UI 提示按新确认计划重新准备 |
| 4 | 两个有效包 | fail-closed；**不**按 `updatedAt` 自动选 |
| 5 | 包缺 Deliverable | 隔离 / 只读失败；**不**自动补造 |
| 6 | attempt 指向不存在 package | 保留为失败/中断审计；**不**视为成功包 |
| 7 | Store 成功、Task 指针失败 | **`degraded_consistency`**；再次准备前先 reconciliation；**不**创建第二包 |

**强制**：reconciliation **不得**静默删除或覆盖用户数据；不得自动 purge 历史 package。

---

## 9. CurrentPreparationReadiness

- 每次打开包、每次准备前重算；
- DVL2-03 启动前可复用；
- **不覆盖** `ExecutionSnapshot`；
- 不持久化为永久事实，或仅缓存且必须标 `evaluatedAt`；
- 用户面只展示白话；不暴露内部 ID、原始枚举、依赖图、原始能力结构。

能力 `unavailable` 时：Package = `planned` × `none`；Deliverable = `included` × `planned` × `unreviewed`；文案：「成果包已准备；当前尚无法生成真实文件。」

---

## 10. UI 边界（Gate 5）

| 情形 | 行为 |
|------|------|
| 无 confirmed | **不能准备**；不显示可执行「准备成果包」；提示先确认 |
| 有 confirmed、无 package | 主按钮「准备成果包」 |
| 已有 package | 主操作「查看成果包准备」或等价语义 |
| 能力 unavailable | 准确说明；**不**显示「开始生成成果」 |

旧入口：默认隐藏；兼容/开发模式才可见；明示「不会使用已确认成果计划」；**不**与主操作并列。

默认仅显示：一句话摘要、成果数量、准备状态、少量白话阻塞原因、一个主操作。

---

## 11. IPC 合同（prepare 权威在 main）

| Channel | 暴露 | 作用 |
|---------|------|------|
| `actBehalf:prepareDeliverablePackage` | preload | 准备 / 幂等 |
| `actBehalf:getDeliverablePackage` | preload | 读包 + readiness |
| `actBehalf:listDeliverablePackagesForTask` | preload | 历史列表 |
| reconcile | **仅 main 内部** | 不默认暴露 |

### 11.1 prepare 输入（仅允许）

```ts
{ taskId: string }
```

### 11.2 main 侧必须自行

1. 读取 Task；
2. 读取 `activeConfirmedVersionId`；
3. 读取并校验 confirmed PlanVersion；
4. 查找同 confirmed 的既有 package；
5. 在 write queue 内执行 CAS（`expectAbsent` / `expectedRevision`）；
6. 更新 `activePackageId`；
7. 返回 package + derived readiness + `outcome`（`created_new` \| `existing_package`）；
8. **不**返回真实文件路径。

### 11.3 renderer 不得传入

- `sourcePlanVersionId`；
- arbitrary package fields；
- `lifecycleStatus` / `completionStatus`；
- Deliverable IDs；
- Store `revision`；
- 文件路径；
- draft versionId。

---

## 12. Electron 两阶段验收（Gate 4）

必须是：

- Phase A：**一个独立** Electron 进程；
- Phase B：**另一个独立** Electron 进程；
- 两进程共享**同一个隔离临时 userData**；
- **不得**用同进程 reload 冒充重启；
- Phase A 写机器可读结果；
- Phase B 验证重启恢复与幂等；
- 输出 **two-phase summary**；
- 测试结束后**无真实成果文件**；
- **不调用真实模型**；
- **不消耗付费额度**。

### Phase A

隔离 userData → 创建 Task → 创建并确认 Plan → 准备成果包 → 断言 package / deliverable 数量 / `currentVersionId=null` / `versionIds=[]` / 无 ArtifactRef·contentHash → 写结果 → 退出。

### Phase B

同一隔离 userData → **新** Electron 进程 → 恢复 → 断言 `activePackageId` → 重算 readiness → 重复准备命中同一包 → 无第二有效包 → 无成果文件 → 写 Phase B + summary → 退出。

驱动：`run-dvl2-02-package-acceptance.cjs` → `electron-dvl2-02-package-acceptance.cjs` + harness。

---

## 13. Owner 真机验收路径

1. 打开已有 confirmed 计划任务；
2. 看到「准备成果包」；
3. 点击后看到成果数量和准备状态；
4. 不看到「开始生成成果」；
5. 关闭并重启应用；
6. 成果包仍存在；
7. 再次准备不创建重复包；
8. 新建 plan draft 不改变旧包；
9. 确认新 plan 后，旧 `activePackageId` 清空；
10. 为新 confirmed 准备新包；
11. 旧包仍可在历史中查看；
12. 无真实 Word/PPT/HTML/图片；
13. 无下载、路径、假进度、假预览。

---

## 14. 停止条件

- 需要修改禁止范围；
- DVL2-00 枚举无法满足；
- 必须创建 placeholder Version；
- 必须调用 `result-generation.js`；
- 必须生成真实文件；
- 无法保证同 confirmed 只有一个有效 package；
- CAS 无法置于 write queue 内；
- reconciliation 可能删除/覆盖用户数据；
- UI 必须暴露内部 ID 才能完成；
- Electron 无法两独立进程或无法隔离 userData；
- 测试需真实模型或付费额度；
- 需要扩展到 DVL2-03。

---

## 15. 实施提交策略

| 阶段 | 内容 | 状态上限 |
|------|------|----------|
| 1 | Owner 授予实施授权（纯文档） | `implementation_authorized=true`；实施仍可 `not_started` |
| 2 | 实现提交 | 最多 `implementation_in_progress` / `ready_for_owner_runtime_acceptance` |
| 3 | Owner runtime acceptance 纯文档 | 方可 `owner_runtime_accepted` / `accepted_as_implemented` / `implemented` |

实现提交 **不得**同时标 `owner_runtime_accepted`。

---

## 16. Codex 最终授权复核

**结论**：PASS（授权包文档级）。

已确认：

- 实现分支与起点明确（`codex/dvl2-02-deliverable-package-preparation` @ `ad3b6ee`）；
- 新增/修改文件范围明确；禁止范围明确；
- Store/CAS 位于 write queue 内；`expectAbsent` / `expectedRevision`；stale 不改持久化；
- 并发首次创建只能产生一个有效 package；双有效包 fail-closed；不用 `updatedAt` 择优；
- `degraded_consistency` 不得制造第二包；再次准备前 reconciliation；
- reconciliation 不静默删除用户数据；
- preparation attempt 可区分 `created_new` / `existing_package`；不完整 attempt 不得显示成功；
- prepare IPC 只接受 `taskId`；main 侧权威读取 confirmed 并 CAS；
- Electron 使用两个独立进程 + 共享隔离 userData；无真实模型、无付费额度；
- Owner 验收路径明确；
- 无 `DeliverableVersion` / `ArtifactRef` / `contentHash` / 真实成果；
- Codex 授权复核通过；
- 等待 Owner 授予 `implementation_authorized`；
- **当前仍不得编码**。

**本轮分类**：无 Blocker；已同轮补齐 Implementation requirements（`expectedRevision`、`degraded_consistency` 命名、IPC 权威清单、Electron 无模型/无付费、不完整 attempt UI）。无 Non-blocking 单独开轮项。

---

## 17. 明确不做（本收口阶段）

- 不修改 `digitalme-app/**`；
- 不创建实现分支；不编码；
- 不改 lockfile；
- 不标 `implementation_authorized=true`；
- 不 push（本轮仅纯文档提交，仍不 push 远端）。

---

## 18. 文档同步清单

| 文件 | 动作 |
|------|------|
| 本文 | → v0.1.0 / `authorization_specified` / `codex_review_passed` / `ready_for_owner_implementation_authorization`；`implementation_authorized=false`；基线 `0a52606` |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 最小同步：等待 Owner 授予实施授权 |

---

## 19. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| **v0.1.0（Owner runtime accepted）** | 2026-07-26 | **Owner 真机验收通过**：`owner_runtime_accepted` / `accepted_as_implemented` / `implemented`。范围仅 DVL2-02 成果包准备；不等于真实成果生成；无 Version/ArtifactRef/contentHash；DVL2-03 未实现 |
| **v0.1.0（implementation evidence）** | 2026-07-26 | 实现完成证据：commit `20c8832`；合同测试与两阶段 Electron 通过；状态曾为 `ready_for_owner_runtime_acceptance`；实施曾为 `implementation_complete_pending_owner_acceptance` |
| **v0.1.0（Owner implementation authorized）** | 2026-07-26 | **Owner 授予实施授权**：`implementation_authorized=true`；实施曾为 `implementation_in_progress`；分支 `codex/dvl2-02-deliverable-package-preparation` @ `ad3b6ee`；不得 push；不得扩大到 DVL2-03；完成后等待 Owner runtime acceptance |
| **v0.1.0（Codex final authorization review）** | 2026-07-26 | **Codex 最终授权复核通过（历史）**。状态曾为 `authorization_specified` / `codex_review_passed` / `ready_for_owner_implementation_authorization`；`implementation_authorized=false` |
| v0.1.0-draft | 2026-07-26 | 初稿：`authorization_drafting` / `codex_review_pending`；基线 `ad3b6ee` 起草提交 `0a52606` |
