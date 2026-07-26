# 任务包 DVL2-02：implementation authorization（实施授权草案）

版本：v0.1.0-draft
日期：2026-07-26
状态：`authorization_drafting` / `codex_review_pending`
实施：`not_started`
implementation_authorized：`false`
上位冻结规格：[`digitalme_phase1_task_DVL2-02_deliverable_package_and_execution_preparation_v0.1.md`](digitalme_phase1_task_DVL2-02_deliverable_package_and_execution_preparation_v0.1.md)（**DVL2-02 v0.1.1** / `owner_accepted` / `frozen_for_implementation`）
冻结规格提交：`ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`
规格内容冻结基线：`578648f31d86594cc2bd56ede2e367122cfa98f8`（Owner 接受前的 Codex 复核收口；实现以 `ad3b6ee` 为分支起点）

> **正式边界**：本文是 **implementation authorization 评审草案**，供 Owner / Codex 审查实现范围、分支、文件、测试、验收与停止条件。**不是**实施授权。`implementation_authorized` 仍为 `false`。获 Owner 明确实施授权前：不得创建实现分支、不得修改 `digitalme-app/**`、不得编码。冲突时：架构原则文 > DVL2-00 > DVL2-01 > DVL2-02 冻结规格 > 本文。本文不得静默改写冻结规格语义。

---

## 0. 文档地位

1. 承接 DVL2-02 v0.1.1 文首「implementation_authorization 门禁」。
2. 通过后，方可由 Owner 另批将本包升为 `implementation_authorized=true`，并创建实现分支。
3. 授权通过 ≠ 已实现 ≠ Owner 真机验收通过。

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
12. **无**真实成果、**无** `DeliverableVersion`、**无** `ArtifactRef`。

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

## 2. 实现分支方案（推荐，冻结意图）

| 项 | 推荐 |
|----|------|
| 分支名 | `codex/dvl2-02-deliverable-package-preparation` |
| 起点 | **`ad3b6eed2f50bd3f1829028da8d7dc650eb01d31`** |
| 创建时机 | **仅在** `implementation_authorized=true` 之后 |
| 禁止 | 继续在 `codex/dvl2-01-deliverable-planner` 上编码 |

创建后必须：

1. `git rev-parse HEAD` 验证等于 `ad3b6ee…`（或该授权记录的起点）；
2. 不允许混入 DVL2-01 后续未审查修改；
3. 不允许 merge 其他未审查分支；
4. 不允许 push，除非 Owner 另行授权。

---

## 3. 允许新增文件（最终推荐）

对齐 DVL2-01 脚本命名惯例：

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
| `act-behalf/task-store.js` | 增加 `deliverableExecution.activePackageId` 规范化与持久化 | 仅 Task 形状 / normalize / save 路径中指针字段；schemaVersion 如需递增须显式迁移 | 禁止顺手重构 Task 生命周期、结果、调研链 | 指针 CAS、reconciliation、与 confirmed 一致性 |
| `main.js` | 挂载 prepare/get/list IPC；启动 reconciliation；接线 readiness | 仅新增 handler 与必要 require；最小调用 prepare/store | 禁止改 research/result 主链语义；禁止顺手大重构 | IPC 合同、幂等、degraded |
| `preload.js` | 暴露 prepare/get/list API | 仅新增薄封装 | 禁止暴露 reconcile 给 renderer（默认） | preload 绑定存在性 |
| `renderer/app.js` | 「准备成果包」主操作；旧入口默认隐藏；减负默认层 | 做事页薄适配；文案与按钮态 | 禁止重做整页；禁止「开始生成成果」；禁止并列旧主按钮 | UI 状态机（无 confirmed / 有包 / 能力不可用） |
| `renderer/index.html` | 如需按钮/容器挂点 | 最小 DOM 挂点 | 禁止大改布局 | DOM testid 存在 |
| `renderer/styles.css` | 如需二级展开区样式 | 最小样式 | 禁止整套视觉重设计 | 冒烟即可 |
| `digitalme-app/package.json` | 新增上述 test 脚本 | **仅** scripts 两项新增 | **禁止**升级依赖；**禁止**改 lockfile | 脚本可运行 |

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
DVL2-02 冻结合同正文（授权评审期间）
DVL2-03 及后续任务实现
```

如发现必须修改禁止范围：**立即停止**，回到规格或授权评审，不得自行扩大范围。

---

## 6. Store 合同实施要求

| 项 | 冻结 |
|----|------|
| 文件 | `<userData>/deliverable-packages.json` |
| 顶层 | `{ schemaVersion, revision, packages, deliverables, preparationAttempts, updatedAt }` |

强制：

1. 原子 temp + rename；
2. 进程内 write queue；
3. **CAS 必须在 write queue 内完成**；
4. 每次 CAS 前重新读取最新 Store；
5. stale write **不得**改变文件；
6. schema fail-closed；
7. 未知字段：保留但不得驱动业务（或拒绝非法 schemaVersion；推荐：已知字段校验失败则 fail-closed；未知字段透传保留）；
8. 损坏文件 **不得**自动覆盖为空；
9. **不得**创建 `versions` / `artifacts` 作为运行时依赖；
10. **不得**写真实路径或伪文件引用。

---

## 7. CAS 与并发矩阵（必须测试）

1. 首次创建 `expectAbsent`；
2. 同 confirmed 重复准备幂等返回；
3. 两个并发首次准备只成功一个；
4. stale revision 被拒绝；
5. stale write 后 Store 字节或语义不变；
6. Store 成功、Task 指针失败进入 degraded；
7. degraded 再次准备先 reconciliation；
8. 不得产生第二个有效 package；
9. 双有效 package fail-closed；
10. archived 普通准备不静默新建；
11. soft_deleted 普通准备不恢复、不替代；
12. 新 confirmed 创建新 package；
13. 旧 package `sourcePlanVersionId` 不变；
14. `activePackageId` 只指向当前 confirmed 对应包。

---

## 8. PackagePreparationAttempt 测试矩阵

必须测试：

- `started` 不得成为 `activePackageId` 依据；
- `interrupted` 不得成为成功依据；
- `failed` 不得伪装已准备；
- `succeeded` 时 `packageId === createdPackageId`；
- outcome 区分 `created_new` / `existing_package`；
- 历史 attempt 不覆盖；
- 崩溃恢复保留历史；
- 幂等命中是否创建新 attempt（见推荐）。

**推荐**：每次用户显式准备动作都可创建新 attempt；幂等命中结果为 `existing_package`；**不得**修改既有成功 attempt。

---

## 9. reconciliation 规则与测试

| # | 情形 | 行为 |
|---|------|------|
| 1 | Task 指针缺失、Store 有唯一合法包 | 恢复指针 |
| 2 | Task 指针指向缺失包 | 清空指针并审计 |
| 3 | Task 指针与 `activeConfirmedVersionId` 不一致 | 清空 `activePackageId`；不改旧包；UI 提示需按新确认计划重新准备 |
| 4 | 两个有效包 | fail-closed；不按 `updatedAt` 自动选 |
| 5 | 包缺 deliverable | 隔离 / 只读错误；不自动补造 |
| 6 | attempt 指向不存在 package | 保留 attempt 作失败/中断审计；不视为成功包 |

---

## 10. CurrentPreparationReadiness 实施要求

- 每次打开包时重算；
- 每次准备前重算；
- DVL2-03 启动前可复用；
- **不覆盖** `ExecutionSnapshot`；
- 不持久化为永久事实，或仅缓存且必须标 `evaluatedAt`；
- 用户面只展示白话；
- 不暴露内部 ID、原始枚举、依赖图结构。

四类能力 `unavailable` 时：

| 对象 | 状态 |
|------|------|
| Package | `lifecycleStatus=planned`，`completionStatus=none` |
| Deliverable | `included` × `planned` × `unreviewed` |
| 用户面 | 「成果包已准备；当前尚无法生成真实文件。」 |

---

## 11. UI 实施边界

### 11.1 成果计划模式

| 情形 | 行为 |
|------|------|
| 无 confirmed | 不显示「准备成果包」可执行态；提示先确认成果计划 |
| 有 confirmed、无 package | 主按钮「准备成果包」 |
| 已有 package | 主操作「查看成果包准备」或等价准确语义 |
| 能力 unavailable | 准确说明；**不**显示「开始生成成果」 |

### 11.2 旧入口

- 默认隐藏；
- 兼容/开发模式才可见；
- 标注「不会使用已确认成果计划」；
- 不与主按钮并列。

### 11.3 减负

默认只显示：一句话任务理解；成果数量；当前准备状态；最多若干条白话阻塞原因；一个主操作。详细 ID、依赖、枚举放二级区或不展示。

---

## 12. IPC 合同

| Channel | 暴露 | 作用 |
|---------|------|------|
| `actBehalf:prepareDeliverablePackage` | preload | 准备 / 幂等返回 |
| `actBehalf:getDeliverablePackage` | preload | 读包 + 派生 readiness |
| `actBehalf:listDeliverablePackagesForTask` | preload | 历史列表（默认折叠） |
| reconcile | **优先仅 main 内部** | 不默认暴露给 renderer |

### 12.1 prepare 输入

```ts
{ taskId: string }
```

main 侧必须：

- 读取 Task；
- 获取 `activeConfirmedVersionId`；
- 校验 confirmed PlanVersion；
- **不**接受 renderer 传入 draft version；
- **不**接受 renderer 指定任意 `sourcePlanVersionId`；
- 返回 package + derived readiness + outcome（`created_new` | `existing_package`）；
- **不**返回真实文件路径。

---

## 13. Electron 两阶段验收（独立进程）

必须是 **两个独立 Electron 进程**，不是同进程 reload。隔离 userData。

### Phase A

1. 隔离 userData；
2. 创建 Task；
3. 创建并确认 Plan；
4. 点击/调用准备成果包；
5. 断言 package 创建；
6. 断言 deliverable 数量与 included 项一致；
7. 断言 `currentVersionId=null`；
8. 断言 `versionIds=[]`；
9. 断言无 ArtifactRef/contentHash；
10. 保存 Phase A 机器可读结果；
11. 退出 Electron。

### Phase B

1. **同一**隔离 userData；
2. 启动**新的** Electron 进程；
3. 恢复 Task / Plan / Package；
4. 断言 `activePackageId`；
5. 重算 readiness；
6. 重复准备命中同一 package；
7. 断言无第二个有效包；
8. 断言无成果文件；
9. 保存 Phase B 与 two-phase summary；
10. 退出。

推荐驱动：`run-dvl2-02-package-acceptance.cjs` → `electron-dvl2-02-package-acceptance.cjs` + `dvl2-02-package-acceptance-harness.cjs`。

---

## 14. Owner 真机验收路径

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

## 15. 停止条件

实现过程中出现以下任一项必须停止：

- 需要修改禁止范围；
- DVL2-00 枚举无法满足；
- 必须创建 placeholder Version；
- 必须调用 `result-generation.js`；
- 必须生成真实文件；
- 无法保证一个 confirmed 只有一个有效 package；
- CAS 无法置于 write queue 内；
- reconciliation 可能自动删除用户数据；
- UI 需要暴露内部 ID 才能完成；
- Electron 两阶段无法隔离 userData；
- 测试需使用真实模型或付费额度。

---

## 16. 实施提交策略

| 阶段 | 内容 | 状态上限 |
|------|------|----------|
| 1 | 本授权包接受与授权提交（纯文档） | `implementation_authorized=true`（另批）仍可 `not_started` |
| 2 | 实现提交 | 最多 `implementation_in_progress` / `ready_for_owner_runtime_acceptance` |
| 3 | Owner runtime acceptance 纯文档提交 | 方可 `owner_runtime_accepted` / `accepted_as_implemented` / `implemented` |

实现提交 **不得**同时标 `owner_runtime_accepted`。

---

## 17. 授权包退出条件（可提交评审）

当且仅当：

- 分支方案明确；
- 允许文件明确；
- 禁止范围明确；
- Store / CAS / reconciliation 矩阵完整；
- Electron 两阶段验收明确；
- Owner 真机路径明确；
- 无真实成果边界明确；
- 停止条件明确；
- **`implementation_authorized` 仍为 `false`**。

---

## 18. 明确不做（本起草阶段）

- 不修改 `digitalme-app/**`；
- 不创建实现分支；不编码；不新增测试文件实体；
- 不改 lockfile / 不升级依赖；
- 不标 `implementation_authorized=true`；
- 不 push（由本轮独立文档提交执行，仍不 push 远端）。

---

## 19. 文档同步清单（本轮允许）

| 文件 | 动作 |
|------|------|
| 本文 | 新建 v0.1.0-draft / `authorization_drafting` / `codex_review_pending` |
| `digitalme_context.md` / `digitalme_log.md` / Cursor rule | 最小同步：authorization 起草中；实施未授权 |
| DVL2-02 冻结规格 | **仅允许**非合同索引指向本文；不得改冻结合同正文 |

---

## 20. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| **v0.1.0-draft** | 2026-07-26 | 初稿：`authorization_drafting` / `codex_review_pending`；`implementation_authorized=false`；起点 `ad3b6ee`；待 Codex / Owner 审查 |
