# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- realCodex: true
- understandingPresent: true
- understandingRefsReal: true
- understandingRelevanceFixed: true
- diffMeaningful: true
- testsPassed: true
- revisionChanged: true
- adoptionRecorded: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false
- targetRoot: <TEMP>/2digime-swql-target
- targetHead: c8cdc0014d8e14913931905b2c2247e1bccb9ccc
- failureStage: （无）
- failureMessage: （无）

## Understanding relevance fix

目标相关只读定位已修复：理解结果优先命中与目标语义相关的实现路径/符号，不再把 package.json / README 等通用文件当作核心关键文件。

### 回归摘要（相对路径，无本机绝对路径）

- **A**（本仓 digitalme-v2，clampString + `src/shared/ids.ts`）：pass — `reliability=reliable`；`keyFiles` 含 `src/shared/ids.ts`；package.json/README 不作为 core。
- **B**（嵌套 derive：`deriveTaskState` / `derive.ts`）：pass — 命中 `src/work-runtime/derive.ts`（本仓同目标亦命中该相对路径）。
- **C**（无关功能但有匹配实现）：pass — 命中 `src/feature/widget.ts`；`keyFiles` 不含 package.json/README。

单元测试：`software-task-understanding` + `external-execution-closed-loop` 共 12/12 pass。

## 说明

本摘要为工程验证证据，**不是** Owner 运行时验收。`ownerAccepted` 必须为 false。
