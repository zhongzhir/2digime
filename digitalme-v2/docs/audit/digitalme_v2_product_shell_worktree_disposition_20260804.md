# Digital Me V2 — 产品壳工作树处置裁决（2026-08-04）

- **任务**：`DIGITALME-V2-ARCHITECTURE-FREEZE-AND-WORKTREE-DISPOSITION-01`
- **基线**：`v2/foundation` @ `9db81ef`
- **架构冻结文**：[`../design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md`](../design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md)（`owner_accepted` / `frozen_for_sequencing`）
- **本任务**：裁决 + 调整可提交切片；**不提交**；不启动采用闭环 / Collaboration
- **验证（本机 2026-08-04）**：`build` / `test`（127 pass / 1 skip）/ `accept:subject-mvp` / `accept:product-shell` / `accept:conversation-shell` **全部通过**

分类：`A` 提交 · `B` 调整后提交 · `C` 撤回（本切片勿暂存；必要时 restore）· `D` 仅证据/文档 · `E` 隔离无关

---

## 1. 当前工作树逐文件裁决

### 1.1 digitalme-v2 — 建议纳入产品壳单一切片（A/B）

| 路径 | 裁决 | 说明 |
|------|------|------|
| `digitalme-v2/electron/main.cjs` | **B** | 默认主体目录；removeMaterial 白名单；conversation list/append/clear |
| `digitalme-v2/electron/preload.cjs` | **B** | 命令暴露 + conversation API |
| `digitalme-v2/electron/renderer/index.html` | **B** | 三主入口 + 帮助/设置；对话；默认文档；无协作空入口 |
| `digitalme-v2/electron/renderer/app.js` | **B** | 任务隔离、状态投影、资料移除、对话→capture、清空、帮助；已删死 collab 引用 |
| `digitalme-v2/electron/renderer/styles.css` | **B** | 宽屏布局、对话/帮助样式 |
| `digitalme-v2/src/runtime/commands.ts` | **A** | removeMaterial；overview.materials；getTask 字段 |
| `digitalme-v2/src/runtime/command-bus.ts` | **A** | removeMaterial 接线 |
| `digitalme-v2/src/runtime/digitalme-runtime.ts` | **A** | removeSubjectMaterial |
| `digitalme-v2/src/runtime/tests/command-bus.test.ts` | **A** | 命令数 20 |
| `digitalme-v2/src/smoke.ts` | **A** | 命令数断言 |
| `digitalme-v2/src/subject-core/subject-service.ts` | **A** | list/remove materials；引用失效 |
| `digitalme-v2/src/subject-core/tests/subject-material-remove.test.ts` | **A** | 移除真实验收 |
| `digitalme-v2/src/work-runtime/derive.ts` | **A** | 失败/已取消用户面标签 |
| `digitalme-v2/src/work-runtime/job-runner.ts` | **A** | getTask/listTasks 标签 |
| `digitalme-v2/package.json` | **B** | accept:product-shell / accept:conversation-shell |
| `digitalme-v2/scripts/run-product-shell-acceptance.cjs` | **B** | 静态+Electron |
| `digitalme-v2/scripts/electron-product-shell-acceptance.cjs` | **B** | 三入口/帮助/布局/隔离 |
| `digitalme-v2/scripts/run-conversation-shell-acceptance.cjs` | **B** | 对话壳入口 |
| `digitalme-v2/scripts/electron-conversation-shell-acceptance.cjs` | **B** | 对话不建 Task、capture、移除 |
| `digitalme-v2/scripts/run-subject-ux-acceptance.cjs` | **B** | 委托 product-shell |
| `digitalme-v2/.gitignore` | **B** | 忽略产品壳/对话验收证据目录 |
| `digitalme-v2/docs/design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md` | **A** | 架构冻结 |
| `digitalme-v2/docs/audit/digitalme_v2_validated_product_capability_recovery_audit_20260804.md` | **D**（可随文档提交） | 样本审计 |
| `digitalme-v2/docs/audit/digitalme_v2_product_shell_worktree_disposition_20260804.md` | **A** | 本文 |
| `docs/design/digitalme_mvp_core_workflow_v2_design_v0.1_20260802.md` | **B** | absorbed / parallel_implementation_stopped |

### 1.2 digitalme-v2 — 隔离（E）

| 路径 | 裁决 | 说明 |
|------|------|------|
| `digitalme-v2/scripts/_mvp-p2b2-quality-grade-ui-evidence/` | **E** | P2B 证据 |
| `digitalme-v2/scripts/_mvp-p2b3-bundle-copy-fix-evidence/` | **E** | P2B 证据 |
| `digitalme-v2/scripts/_mvp-p2b4-document-materialize-evidence/` | **E** | P2B 证据 |
| `digitalme-v2/scripts/_mvp-p2c1-quality-recovery-evidence/` | **E** | P2C1 证据 |
| `digitalme-v2/scripts/run-p2c1-quality-recovery-once.cjs` | **E** | P2C1 |
| `digitalme-v2/scripts/probe-p22-json-modes.cjs` | **E** | probe |
| `digitalme-v2/scripts/probe-p22-model-once.cjs` | **E** | probe |
| `digitalme-v2/scripts/security-false-positive-audit.cjs` | **E** | 无关审计脚本 |
| `_mvp-product-shell-acceptance-evidence/` / `_mvp-conversation-shell-acceptance-evidence/` | **D**（gitignore） | 验收产物，不提交 |

### 1.3 digitalme-app — 全部隔离（E）

| 路径 | 裁决 |
|------|------|
| `digitalme-app/scripts/_mvp-release-gate-01e-evidence/*`（已修改） | **E** |
| `digitalme-app/scripts/test-mvp-release-gate-01e-fix-04.cjs` | **E** |
| `digitalme-app/scripts/test-mvp-release-gate-01e-fix-05.cjs` | **E** |
| `digitalme-app/src/act-behalf/deliverable-generation.js` | **E** |
| `digitalme-app/src/renderer/app.js` | **E** |
| `digitalme-app/src/renderer/do-workspace.js` | **E** |
| `digitalme-app/project/` | **E** |
| `digitalme-app/scripts/_inspect-*.cjs` | **E** |
| `digitalme-app/scripts/_probe-lifecycle-model-once.cjs` | **E** |
| `digitalme-app/scripts/electron-mvp-*.cjs` | **E** |
| `digitalme-app/scripts/electron-probe-b-product-text-generation.cjs` | **E** |
| `digitalme-app/scripts/probe-a-model-connectivity.cjs` | **E** |
| `digitalme-app/scripts/run-real-model-value-validation.ps1` | **E** |
| `digitalme-app/scripts/run-value-validation-probes.cjs` | **E** |
| `digitalme-app/scripts/test-mvp-generation-lifecycle-fix-01.cjs` | **E** |
| `digitalme-app/scripts/validate-mvp-portable-rebuild-01.cjs` | **E** |

### 1.4 根目录 / docs — 隔离或仅文档（E/D）

| 路径 | 裁决 |
|------|------|
| `CRT_RUNTIME_AUDIT_20260726.md` | **E/D** |
| `LEARN_DVL_PRD_FAILURE_AUDIT_20260727.md` | **E/D** |
| `LEARN_LOOP_FORENSIC_AUDIT_20260727.md` | **E/D** |
| `MVP_*_REPORT_*.md` / `MVP_RELEASE_GATE_01A_AUDIT_*.md` 等根报告 | **E/D** |
| `digitalme_phase1_task_MVP-CORE-WORKFLOW-V2_v0.1.md` | **E** |
| `digitalme_phase1_task_MVP-GENERATION-LIFECYCLE-FIX-01_v0.1.md` | **E** |
| `digitalme_phase1_task_MVP-PORTABLE-REBUILD-AND-OWNER-ACCEPTANCE-01_v0.1.md` | **E** |
| `digitalme_rules.md` | **E** |
| `docs/audit/`（根下，非 v2 docs） | **E** |
| `docs/design/digitalme_broadcast_*` | **E** |
| `docs/design/digitalme_mvp_value_chain_operating_principles_*` | **E** |
| `docs/design/digitalme_v2_change_and_verification_bundles.md` 等工程设计 | **E** |
| `docs/product/*` | **E** |
| `docs/design/digitalme_mvp_core_workflow_v2_design_v0.1_20260802.md` | **B**（见 §1.1） |

### 1.5 撤回（C）

本切片**无**必须对已跟踪产品壳核心文件执行 `git restore` 的项。  
提交时策略：**仅 stage §1.1**；其余一律不 add = 等效隔离。  
Collaboration 业务实现：工作树中**无**待撤回的独立业务实现文件；**禁止新增**。

---

## 2. 建议提交文件清单（精确 stage 白名单）

```text
digitalme-v2/.gitignore
digitalme-v2/electron/main.cjs
digitalme-v2/electron/preload.cjs
digitalme-v2/electron/renderer/app.js
digitalme-v2/electron/renderer/index.html
digitalme-v2/electron/renderer/styles.css
digitalme-v2/package.json
digitalme-v2/scripts/run-subject-ux-acceptance.cjs
digitalme-v2/scripts/run-product-shell-acceptance.cjs
digitalme-v2/scripts/electron-product-shell-acceptance.cjs
digitalme-v2/scripts/run-conversation-shell-acceptance.cjs
digitalme-v2/scripts/electron-conversation-shell-acceptance.cjs
digitalme-v2/src/runtime/command-bus.ts
digitalme-v2/src/runtime/commands.ts
digitalme-v2/src/runtime/digitalme-runtime.ts
digitalme-v2/src/runtime/tests/command-bus.test.ts
digitalme-v2/src/smoke.ts
digitalme-v2/src/subject-core/subject-service.ts
digitalme-v2/src/subject-core/tests/subject-material-remove.test.ts
digitalme-v2/src/work-runtime/derive.ts
digitalme-v2/src/work-runtime/job-runner.ts
digitalme-v2/docs/design/digitalme_v2_product_architecture_consolidation_v0.1_20260804.md
digitalme-v2/docs/audit/digitalme_v2_product_shell_worktree_disposition_20260804.md
digitalme-v2/docs/audit/digitalme_v2_validated_product_capability_recovery_audit_20260804.md
docs/design/digitalme_mvp_core_workflow_v2_design_v0.1_20260802.md
```

建议 message：

```text
feat(v2): product shell slice — chat/work/subject, help, materials remove
```

---

## 3. 建议撤回清单

- 无强制 restore 列表。
- 若误 stage：立即 unstage §1.2–1.4 全部路径。

---

## 4. 隔离清单（摘要）

- 全部 `digitalme-app/**`
- P2B/P2C1 evidence + probe/security 脚本
- 根目录历史报告与未绑定任务包
- 非本切片 `docs/design|product`（Workflow V2 设计文除外）
- Collaboration 业务（不存在于待提文件；禁止新增）

---

## 5. 重点审计对照

| 重点项 | 结果 |
|--------|------|
| 对话入口 | 一级入口；验收绿 |
| conversation.ndjson | list/append/clear；壳层 transcript |
| 导航 | 对话 \| 做事 \| 数字之我；设置+帮助辅助 |
| 宽屏布局 | 保留 |
| 任务/成果隔离 | 验收覆盖 |
| 任务状态与取消 | 真实 Job 投影 |
| 资料列表与移除 | 引用失效；验收绿 |
| 协作空入口 | **已删除** |
| 成果类型 | 默认 document，无用户双选 |
| capture 接线 | 对话/Task/初始一句话/材料 |
| 帮助 | 轻量页 |
| P2C1 / digitalme-app | **E 隔离** |

补充检查：对话不创建 Task；转为任务后才进 Task/Artifact；transcript 不参与主体派生；无第二主体事实源；无第二套 Job 状态机。

---

## 6. 风险

1. CommandBus 已满 20；transcript 走壳 IPC，勿再挤领域命令。  
2. 提交必须严格白名单，防混入 app/P2C1/根报告。  
3. 对话本地应答非终局质量承诺。  
4. 协作入口暂隐须诚实说明，勿写成「不做协作」。  
5. Artifact 采用/否定仍缺 — 属下一切片，勿误标完成。

---

## 7. 提交后目标 HEAD 状态（预期，未执行）

```text
branch: v2/foundation
parent: 9db81ef
expected: 单一 commit（§2 白名单）
不含: digitalme-app / P2C1 / Collaboration 业务 / 采用闭环
```

---

## 8. 下一切片准备

| 顺序（冻结） | 准备度 |
|--------------|--------|
| 1 工作树收口 | **本任务完成裁决与验证；待显式 commit** |
| 2 Artifact 采用/否定闭环 | 合同 sourceKind 已备；UI/命令未做；可开任务 |
| 3 Collaboration MVP | 最小验收已写入冻结文；不得本切片启动 |
| 4 三线整体闭环 | 依赖 2–3 |
| 5 对话/帮助/视觉/能力入口完善 | 后置 |

---

## 9. 精确提交可行性

**可以精确提交**：验证已绿；白名单明确。  
本任务按授权**停止，不执行 commit**。
