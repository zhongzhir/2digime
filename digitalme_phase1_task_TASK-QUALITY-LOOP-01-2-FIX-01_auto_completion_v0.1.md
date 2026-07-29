# TASK-QUALITY-LOOP-01.2-FIX-01：自动完成闭环与单一任务界面

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `automated_tests_passed` / `auto_completion_flow_repaired` / `single_task_view_added` / `owner_runtime_acceptance_pending`  
实施分支：`codex/task-quality-loop-01-2-fix-auto-completion`  
基线：`196447b`（`codex/task-quality-loop-01-2-semantic-contract`）  
上位：[`digitalme_phase1_task_TASK-QUALITY-LOOP-01-2_semantic_contract_v0.1.md`](digitalme_phase1_task_TASK-QUALITY-LOOP-01-2_semantic_contract_v0.1.md)

> **Owner 真机结论（基线）**：`runtime_generation_failed` / `owner_runtime_not_accepted`。本修复完成自动化与 UI 收敛后，**仍须** Owner 再验；不得标 `owner_runtime_accepted` / `accepted_as_implemented` / `task_ui_minimized` / `runtime_generation_reliable`。

---

## 1. 真实失败根因（attempt `dgatt_ms5ehp8h_bfbdd34c`）

| 项 | 事实 |
|---|---|
| 失败点 | `assertGeneratedContentUsable` → `project_authority_conflict`（Reviewer 之前） |
| modelCallCount | **1** |
| recoveryActions | **[]**（未进入自动恢复） |
| failureStage | `model_generation` |
| 语义分块 | **未接线**：`main` 传入 `useSemanticBlocks`，但 `generateOneDeliverable` 未转发至 generators |
| 整篇 fallback | 不适用（语义路径未进入） |
| 终态原因 | `project_authority_conflict` 不在 `isRepairable`，一次失败即 terminal |
| UI | 失败态映射为「继续完善」 |

附加：`empty_project_context` 曾可作为内容门禁硬失败且内容修订无法消除；本轮已移出内容冲突门禁。

---

## 2. 修复摘要

1. 转发 `useSemanticBlocks`；语义失败不再无条件静默整篇回退（有界 `whole_document_fallback` 才记录）。  
2. `project_authority_conflict` / `ungrounded_project_numbers` / `internal_claim_tags_rejected` 纳入自动 local_repair →（可选）clean_regeneration。  
3. 删除普通路径「继续完善」；终态「成果未能完成」+「查看原因」。  
4. 计划 confirmed/generating 用摘要行；「预计交付」不复述完整目标；单一状态块。  
5. 新增永久字段：**0**。

---

## 3. 测试

- `test:task-quality-loop-01-2-fix-01`（6）  
- `test:task-quality-loop-01-2`（16）  
- 01 / 01.1 / FIX-01、DVL2-03、one-click、TASK-UX、IDCOLLAB、LEARN-LOOP-FIX-01 全绿  

---

## 4. 状态

```text
implemented /
automated_tests_passed /
auto_completion_flow_repaired /
single_task_view_added /
owner_runtime_acceptance_pending
```

不得 push。等待 Owner 真机再验。
