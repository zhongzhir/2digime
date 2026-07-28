# TASK-QUALITY-LOOP-01.1-FIX-01：Grounded Generation 修复

版本：v0.1.0  
日期：2026-07-28  
状态：`implemented` / `automated_tests_passed` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`  
实施分支：`codex/task-quality-loop-01-1-fix-grounded-generation`  
基线：`d5ee05f`（`codex/task-quality-loop-01-1-grounded-review`）  
上位：[`digitalme_phase1_task_TASK-QUALITY-LOOP-01-1_grounded_review_v0.1.md`](digitalme_phase1_task_TASK-QUALITY-LOOP-01-1_grounded_review_v0.1.md)

> **正式边界**：本修复只解决「Grounding Gate 正确、生成/修订不服从当前系统事实」这一断点。**不等于** Owner 真机已通过；**不得**标 `owner_runtime_accepted` / `accepted_as_implemented`。

---

## 1. 问题与根因

Owner 真机连续 3 次生成「项目知识功能 PRD」均被 Grounding Review 阻断：文档宣称项目知识缺失/初级阶段，而仓库已具备 project-knowledge-store、Knowledge Resolver、跨面调用、来源与 supersede。自动局部修订无法消除冲突，用户只能手动重试且无效。

**根因**：生成提示仅注入自然语言摘要；历史材料可覆盖现状；`current_state_incorrect` / `existing_capability_ignored` 仍走「修订原稿」；预算耗尽后无干净上下文重试。

## 2. 实现摘要

| 能力 | 实现 |
|---|---|
| 权威事实区块 | `CURRENT SYSTEM FACTS — AUTHORITATIVE` + 结构化字段（capabilityId / currentStatus / authoritativeModule / validatedBehavior / knownBoundary / sourceRef） |
| 历史材料降权 | `current_authoritative` / `historical_superseded` / `planning_only` / `unknown`；superseded 默认不注入 |
| Gap Statement | ExistingCapabilities / ActualGaps / ProposedMinimumChanges / ReusedAuthorityObjects / ExplicitNonGoals；冲突则重算，禁止进入正文 |
| grounded_rebuild | 命中四大 grounding blocking 时不带全文失败稿，只保留目标/Criteria/Snapshot/AuthorityMap/问题摘要 |
| clean regeneration | 初稿 + ≤2 次修订/重建后，允许 **1 次** 干净上下文全新生成；硬上限 `MAX_MODEL_CALLS_PER_GENERATION=16` |
| 审计 | attempt / version.quality 记录 `groundedRebuildUsed`、`cleanRegenerationUsed`；默认 UI 不展示 |

## 3. 预算

```text
初稿
→ 最多 2 次 local_repair 或 grounded_rebuild
→ 若仍 grounding blocking：1 次 clean_regeneration
→ 仍失败 → 普通语言失败，不落盘
```

## 4. 测试

- `npm run test:task-quality-loop-01-1-fix-01`（9 pass）
- `npm run test:task-quality-loop-01-1`（17 pass）
- `npm run test:task-quality-loop-01`（13 pass）
- 回归：DVL2-01/02/03/04/05、placeholder-gate、one-click、TASK-UX-MIN-01、IDCOLLAB-MIN-01、LEARN-LOOP-FIX-01/02/02.1、act-behalf 全绿

## 5. Owner 真机复验

输入：`为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。`

预期：一次发起即可完成或安全失败；成果承认已有项目知识与 Knowledge Resolver；不从零建 CRUD；验收含跨对话/跨任务/supersede；UI 无 rebuild/调用次数字样。

## 6. 未完成边界

1. Owner 真机尚未验收；  
2. Gap 探针为启发式，新增产品面需同步注册；  
3. 市场 95% 分位未证明；  
4. 不改变高风险授权规则。

## 7. 状态

```text
implemented /
automated_tests_passed /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。等待 Owner 真机验收。
