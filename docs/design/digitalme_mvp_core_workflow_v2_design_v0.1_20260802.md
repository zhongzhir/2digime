# Digital Me · MVP Core Workflow V2 设计与调用链删减方案

- **版本**：v0.1
- **状态**：`legacy_workflow_reliability_design_absorbed_into_v2_constraints` / `parallel_implementation_stopped`
- **登记**：2026-08-04 · `DIGITALME-V2-ARCHITECTURE-FREEZE-AND-WORKTREE-DISPOSITION-01`
- **权威承接**：[`digitalme-v2/docs/design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md`](../../digitalme-v2/docs/design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md) §C.5
- **日期**：2026-08-02（原文）
- **任务**：[`digitalme_phase1_task_MVP-CORE-WORKFLOW-V2_v0.1.md`](../../digitalme_phase1_task_MVP-CORE-WORKFLOW-V2_v0.1.md)
- **分支**：`codex/mvp-core-workflow-v2`（历史）
- **基线**：`ce7feac`

> **处置说明**：可靠性约束已吸收进 V2（唯一执行入口、材料快照冻结、UI 只投影 Job、失败/重试、成果不串线等）。**禁止**迁入 `task.workflowV2`、第二套状态机、`actBehalf:*`、legacy renderer 编排或旧 Package 结构。并行实现已停止。

---

## 0. 为什么不继续修补

| 证据 | 结论 |
|---|---|
| `144d0d7` Owner 两次「开始做」均死在 `plan_materials_stale`，未达模型 | 多段编排 + digest 派生 flag 不可信 |
| `ce7feac` 修复 digest/粘滞 stale 后 Owner 再次失败 | 局部修复不能重建主路径可信度 |
| harness / 同类输入 / packaged smoke 通过 ≠ Owner 真机通过 | 验证面与真实主链脱节 |
| 「开始做」路径上多次 `actBehalf:save`、plan、confirm、package | 任一节点可吞错、可改 digest、可与 UI phase 分叉 |

**裁决**：重写唯一文档任务执行主链路；旧编排器保留代码但**正式 UI 不再调用**。

---

## 1. 新旧调用链对比

### 1.1 旧链（废止为正式主链）

```text
UI「开始做」
  → actBehalf:save（建任务）
  → persistActReferenceMaterials → actBehalf:save + syncTaskPlanMaterialsAlignment
  → actBehalf:planGenerate（可选模型 / rule fallback）
  → actBehalf:save（plan 后再 persist；digest 翻转高发点）
  → actBehalf:confirmPlanAndGenerate
       → materialsStale / digest 门闸
       → confirm draft / CAS
       → prepareDeliverablePackage
       → generateDeliverablePackage
            → generateOneDeliverable × N
                 → callModel
                 →（同步或紧耦合）quality / learn
  ↔ UI workspacePhase 独立维护（可与 task.status 不一致）
  ↔ 失败常被 map 成「暂时无法开始这项工作」
```

问题摘要：多入口、多次 persist、双事实源（flag vs digest；UI phase vs task.status）、通用错误吞没。

### 1.2 新链（唯一正式主链）

```text
UI「开始做」
  → 唯一 IPC：actBehalf:runDocumentWorkflowV2
       → 唯一编排器：document-workflow-v2.runDocumentWorkflowV2
            1. 读取 task.goal + 当前材料引用（不重跑 plan/confirm）
            2. snapshotting：冻结材料快照 → 唯一 snapshotId / materialsDigest
               · 重试且材料未变 → 复用原 snapshot，不新建
               · 单材料解析失败 → 记录 skippedMaterials，继续
            3. 原子写入 status=generating（绑定 snapshotId）
            4. 唯一生成入口：generateDocumentFromSnapshot
               · 复用 Package / SecretStore / callModel / artifact-fs
               · 写入唯一成果文件
            5. 原子写入 status=completed + artifact 指针
            6. 异步（fire-and-forget）：quality / reviewer / learn
               · 失败只写旁路 job，不得改 completed
  ← UI 只投影 task.workflowV2 / task.status；无独立 phase 权威
  ← 失败投影 failure.{stage,errorCode,safeMessage,retryable}
```

---

## 2. 删除或绕开的入口

| 入口 | 处置 | 说明 |
|---|---|---|
| `handleStartDoWork` 内 `planGenerate` + `confirmPlanAndGenerate` | **绕开** | 改为只调 `runDocumentWorkflowV2` |
| `actBehalf:planGenerate` | 正式 UI **停用** | IPC 可保留供遗留脚本；renderer 正式路径禁止 invoke |
| `actBehalf:confirmPlanAndGenerate` | 正式 UI **停用** | 同上 |
| `actBehalf:prepareDeliverablePackage` | 正式 UI **停用** | V2 不经 package prepare |
| `actBehalf:generateDeliverablePackage` | 正式 UI **停用** | 仅编排器内部旧实现可被抽取复用内核，不经此 IPC |
| `actBehalf:generateDeliverable` | 正式主链 **停用** | 改稿/重生若保留，后续另开任务；本任务不接正式「开始做」 |
| `actBehalf:autoGenerate` / `generateResult` | 保持遗留 | 已无正式 UI；不得重新接入 |
| `#btn-act-form-plan` / `#btn-act-generate-from-plan` | 保持 hidden | 若仍有 listener，改为提示「请使用开始做」或 no-op |
| `syncTaskPlanMaterialsAlignment` 对 V2 任务 | **不调用** | V2 不维护 `materialsStale` |
| renderer `workspacePhase` 作为权威 | **废除权威地位** | 仅允许派生显示缓存，刷新必须以 store 为准 |

**不急于物理删除**旧模块文件；验收前以「正式 UI 零调用」为硬门槛。

---

## 3. 权威状态与数据对象

### 3.1 权威状态机（任务级，唯一）

```text
draft → snapshotting → generating → completed
                                  ↘ failed
```

| 状态 | 含义 | 用户面 |
|---|---|---|
| `draft` | 已有目标/材料，尚未进入 V2 执行 | 可「开始做」 |
| `snapshotting` | 正在冻结材料快照 | 进行中 · 整理材料 |
| `generating` | 快照已冻结，正在调用模型写成果 | 进行中 · 生成成果 |
| `completed` | 唯一成果文件已落盘，指针已原子写入 | 显示成果 · 可打开 · 可采用 |
| `failed` | 带结构化 failure；snapshot 可保留供重试 | 显示真实阶段与可重试说明 |

**禁止**：`plan_confirmed` / `materialsStale` / UI `workspacePhase` 成为第二权威。

### 3.2 核心对象

#### `task.workflowV2`（权威执行块）

```json
{
  "schemaVersion": 1,
  "status": "draft|snapshotting|generating|completed|failed",
  "activeSnapshotId": "snap_…",
  "artifact": {
    "artifactId": "art_…",
    "relativePath": "workflow-v2-artifacts/…/final.md",
    "contentType": "text/markdown",
    "bytes": 0,
    "completedAt": "ISO-8601"
  },
  "failure": {
    "stage": "snapshotting|generating|persist_artifact|finalize",
    "errorCode": "machine_code",
    "safeMessage": "用户可读中性说明",
    "retryable": true,
    "at": "ISO-8601"
  },
  "accept": {
    "accepted": false,
    "acceptedAt": null
  },
  "asyncSideJobs": {
    "quality": "pending|running|done|failed|skipped",
    "learn": "pending|running|done|failed|skipped"
  }
}
```

#### `MaterialSnapshot`（冻结后不可变）

```json
{
  "snapshotId": "snap_…",
  "taskId": "abt_…",
  "materialsDigest": "sha256:…",
  "goal": "冻结时的任务目标原文",
  "title": "…",
  "createdAt": "ISO-8601",
  "materials": [
    {
      "id": "…",
      "name": "…",
      "sourcePath": "…",
      "kind": "file|folder",
      "ok": true,
      "skipped": false,
      "skipReason": null,
      "charCount": 0,
      "contentHash": "sha256:…",
      "text": "…",
      "fileCount": null
    }
  ],
  "skippedMaterials": []
}
```

规则：

1. **生成开始后**不得再 persist 任务材料，不得重算 `materialsDigest`。
2. 重试：若当前材料 digest == `activeSnapshot.materialsDigest` → **复用**该 snapshot。
3. 材料变化 → 新建 snapshot，旧 snapshot 只读保留。
4. 单材料失败：`ok:false` / `skipped:true`，写入 `skippedMaterials`，不中止整任务（除非全部材料失败且目标为空到无法生成——该情况 `failed` + `retryable`）。

### 3.3 复用边界

| 复用 | 不复用 |
|---|---|
| Package / `loadPackageForActBehalf` | `deliverablePlanner.generatePlanSuggestion` 产品路径 |
| SecretStore / `callModel` / 模型路由 | `confirmPlanAndGenerate` 编排 |
| `generateDocument` 文本生成内核（可抽取） | `prepareDeliverablePackage` 多 deliverable 包 |
| `deliverable-artifact-fs` 或等价本地写文件 | `materialsStale` / plannedDigest 对齐机 |
| 任务 store 读写原语 | UI 独立 phase 权威 |

第一版产出：**单一 document 成果**（markdown 主文件）；不生成 PPT/HTML/图片包。

### 3.4 旧任务迁移

- 不迁移 `deliverablePlanning` / plan versions / package 复杂状态。
- 首次「开始做」：只读 `goal` / `title` / `referenceMaterials`（或材料路径），创建 V2 snapshot。
- 旧字段保留落盘，V2 路径忽略其门闸含义。

---

## 4. 模块落点（实现指引）

| 模块 | 路径（拟） | 职责 |
|---|---|---|
| 编排器 | `src/act-behalf/document-workflow-v2.js` | 唯一状态机与事务边界 |
| Snapshot store | `src/act-behalf/workflow-v2-snapshot-store.js` | 快照落盘与按 digest 复用 |
| 生成适配 | `src/act-behalf/workflow-v2-generate.js` | 从 snapshot 调 callModel + 写唯一成果 |
| 失败规范化 | 同编排器内 | `stage/errorCode/safeMessage/retryable` |
| IPC | `main.js` → `actBehalf:runDocumentWorkflowV2` | 唯一执行入口 |
| Preload | `preload.js` | 暴露唯一 API |
| UI | `renderer/app.js` `handleStartDoWork` | 只调 V2；投影权威状态 |
| 异步旁路 | `workflow-v2-async-sidejobs.js` | quality/learn；失败不回写 completed |
| 验证 | `scripts/electron-mvp-core-workflow-v2-packaged-10x.cjs` 等 | Owner 原任务等价 + 10× packaged + 故障注入 |

---

## 5. 错误与用户面

| stage | 示例 errorCode | safeMessage 原则 |
|---|---|---|
| `snapshotting` | `material_all_unreadable` | 说明材料整理失败，可重试或更换材料 |
| `generating` | `model_unreachable` / `model_empty` | 说明生成阶段失败，可直接重试（复用快照） |
| `persist_artifact` | `artifact_write_failed` | 说明成果写入失败 |
| `finalize` | `status_commit_failed` | 说明收尾记录失败（若文件已在，需可恢复） |

**禁止**默认文案：「暂时无法开始这项工作。任务要求和材料已经保留，请重试。」作为唯一兜底掩盖真实 stage。

---

## 6. 验证方案（实现后执行）

### A. Owner 原任务等价

- 任务：`abt_msbp6c0d_c1811f` 同款目标
- 材料：原 PPTX + 23 文件目录
- userData：Owner 等价副本（隔离目录，不污染真机）

### B. Packaged 10×

- 真实 packaged exe
- 连续 10 次：成功 ≥10/10；每次 `reachedModel=true`；同 snapshot 不重复生成；无永久卡住
- 故障注入：强制 snapshotting / generating 失败 → UI 显示对应 stage → 直接重试成功

### C. 闭环

生成 → 页内显示 → 打开本地成果 → 采用 → 重启后状态与成果仍在

### D. 候选

仅当 A–C 全部通过后重建 Owner 安装候选；报告明确是否建议 Owner 再次验收。

---

## 7. 提交顺序

1. **本设计 + 任务规格**（本提交）
2. 编排器 + store + IPC（无 UI 切换）
3. 正式 UI 切到 V2 + 旧入口停用
4. Owner 等价 + packaged 10× + 故障注入证据
5. 重建候选 + 最终报告（含是否建议 Owner 验收）

不 push。不邀请 Owner 中间测试。
