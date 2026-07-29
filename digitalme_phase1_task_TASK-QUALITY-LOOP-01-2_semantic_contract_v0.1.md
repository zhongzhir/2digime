# 任务包 TASK-QUALITY-LOOP-01.2：动态成果契约、语义覆盖生成与任务界面收敛

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `automated_tests_passed` / `semantic_contract_generation_added` / `generation_state_consolidated` / `task_ui_minimized` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`  
实施分支：`codex/task-quality-loop-01-2-semantic-contract`  
基线：`a9ff638`（`codex/task-quality-loop-01-1-fix-grounded-generation`）  
上位：[`digitalme_phase1_task_TASK-QUALITY-LOOP-01-1-FIX-01_grounded_generation_v0.1.md`](digitalme_phase1_task_TASK-QUALITY-LOOP-01-1-FIX-01_grounded_generation_v0.1.md)

> **正式边界**：自动化与实现已完成，**不等于** Owner 真机已通过。**不得**标 `accepted_as_implemented` / `owner_runtime_accepted` / `architecture_simplified` / `market_95th_percentile_achieved`。不得 push。

---

## 1. 架构复杂度内审（实施前）

| 对象 | 权威？ | 持久化 | 可计算？ | 本轮处置 |
|---|---|---|---|---|
| Task / PlanRecord / DeliverablePackage / DeliverableVersion / ArtifactRef | 是 | 是 | 否 | 保持唯一事实源 |
| OutcomeCriteria | 任务质量依据（非用户面） | 随 attempt/version.quality 摘要 | 部分可由目标派生 | **演进**为语义覆盖；不新建平行 Contract store |
| semanticContract / OutlinePlan / content blocks | 否 | **否**（运行态） | 是 | 运行时派生；块中间态不写核心库 |
| CurrentSystemSnapshot / AuthorityMap / GapStatement | 否 | digest/依据可入 attempt 诊断 | Gap = Snapshot + Criteria | **不建独立 store**；Gap 禁止成为长期权威 |
| GroundingReview | 否（并入 ReviewResult） | 作为 dimensions.grounding | 是 | 不再平行结果体系 |
| GenerationAttempt | 是（过程） | 最小证据 + recoveryActions | UI 状态可投影 | **收敛** recoveryActions[]；旧布尔兼容读 |
| ReviewResult | 是（质量摘要） | version.quality.reviewer | blocking 可过滤 | issues[] + dimensions{} |
| UserFacingTaskView | 否 | **否** | 是 | 纯投影；无新 UI store |
| failureEvidence / reviewIssues | 失败证据 | 最小集 | 部分可自 issues 重建 | 不新增平行字段 |

**强制原则**：本轮未新建第二套任务/成果 store；未把 Outline/Block 落成永久权威。

---

## 2. 实现摘要

### 2.1 动态成果契约

- `semantic-contract.js`：由目标/模式派生 `requiredSemanticCoverage[]`（问题清单，非章节名）。
- `OutcomeCriteria` schemaVersion=2：`requiredSemanticCoverage` 为主；`requiredSections=[]` 保留兼容。
- 覆盖检查**忽略标题行**，空洞「背景」标题不能过关。

### 2.2 Outline → 分块 → 语义补齐

- `semantic-generation.js`：OutlinePlan → 分块生成 → 装配 → 缺失语义只补相关块。
- 生产路径 `useSemanticBlocks: true`（main / confirmPlanAndGenerate）；fixture 测试可关闭。
- 模型不可用时走规则块，保证确定性测试。

### 2.3 Attempt / Review 收敛

- `attempt-recovery.js`：新写入 `recoveryActions[]`；旧 `groundedRebuildUsed` / `cleanRegenerationUsed` 可兼容读取与镜像写出。
- Reviewer：`missing_semantic_coverage`；Grounding 为 `dimensions.grounding`。

### 2.4 UI 极简

- `user-facing-task-view.js`：`deriveUserFacingTaskState` 投影。
- `deliverable-planner.js`：目标去重；失败态「成果还未完成」+「继续完善」；进行中隐藏重复生成；详情折叠。

---

## 3. 永久字段变更清单

| 变更 | 说明 |
|---|---|
| **新增写入** | `recoveryActions[]`（attempt / groundingAudit） |
| **新增持久摘要** | `requiredSemanticCoverage`（OutcomeCriteria v2；随质量摘要） |
| **废弃权威用法** | `requiredSections` 固定章节（仍可读兼容，默认空） |
| **兼容镜像** | `groundedRebuildUsed` / `cleanRegenerationUsed` 由 recoveryActions 派生写出 |
| **运行时不落库** | semanticContract、OutlinePlan、完整 block 中间态、UserFacingTaskView |
| **未新建 store** | 无 DeliverableContract / GapStatement / Outline store |

无法宣称 `architecture_simplified`：本轮有收敛与兼容层，但尚未删除历史布尔字段存储。

---

## 4. 测试

- `npm run test:task-quality-loop-01-2`（16 pass）
- `npm run test:task-quality-loop-01`（13）
- `npm run test:task-quality-loop-01-1`（17）
- `npm run test:task-quality-loop-01-1-fix-01`（9）
- 回归：DVL2-01/02/03/04/05、placeholder、one-click、TASK-UX、IDCOLLAB、LEARN-LOOP-FIX-01/02/02.1、act-behalf 全绿

---

## 5. Owner 真机验收

输入：`为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。`

生成：一次发起；不因固定标题缺失失败；无空字段；承认已有能力；成果可打开。  
UI：一个任务标题、一个主状态、一个主操作、成功后一个成果入口；失败只出现一次「成果还未完成」。

---

## 6. 未完成边界

1. Owner 真机未验收；  
2. 语义 marker 为启发式，需随产品演进维护；  
3. 旧布尔字段尚未物理删除；  
4. 市场 95% 分位未证明；  
5. 分块路径依赖模型服从 outline/block 协议，失败时回退整篇。

---

## 7. 状态

```text
implemented /
automated_tests_passed /
semantic_contract_generation_added /
generation_state_consolidated /
task_ui_minimized /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。报告后停止，不自行开启下一任务。
