# 任务包 TASK-QUALITY-LOOP-01：复杂任务高质量完成闭环——PRD/方案文档首个验证切片

版本：v0.1.0
日期：2026-07-28
状态：`implemented` / `automated_tests_passed` / `owner_runtime_acceptance_pending` / `benchmark_framework_started` / `market_95th_percentile_not_yet_proven`
实施：`implemented`
实施分支：`codex/task-quality-loop-01`
实现提交：`313f506`（IDCOLLAB-MIN-01 状态校正）+ `ba4a521`（质量闭环核心实现）+ 文档收口提交
上位依据：
- [`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)（当前最高架构原则）
- [`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（DVL2 上位合同）
- [`digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md`](digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md)（成果生成已验收基线）
- [`digitalme_phase1_task_DVL2-03-FIX-01_placeholder_gate_repair_v0.1.md`](digitalme_phase1_task_DVL2-03-FIX-01_placeholder_gate_repair_v0.1.md)（占位门禁与修订循环）
- `digitalme_context.md` §3.3.2（DVL2-03-QUALITY-01 `implementation_mode_alignment`，本任务吸收，不另设重复流程）

> **正式边界**：本任务验证「用户给出复杂目标 → 生成 → 检查 → 修订 → 交付」的质量闭环，首个切片为 PRD/方案类文档。**不等于**：市场 95% 分位质量已证明；全任务类型通用化已完成；外部强力 Agent 已接入；Owner 真机验收已通过。**不得**提前标 `owner_runtime_accepted` / `accepted_as_implemented` / `market_95th_percentile_achieved`。冲突时：架构原则文 > DVL2-00 > 本文。

---

## 0. 任务结论

### 0.1 要解决的真实缺口

系统此前只能证明「可以生成文件」：DVL2-03 解决了真实落盘与版本谱系，DVL2-03-FIX-01 解决了占位符误杀与自动修订，但生成内容仍可能：

1. 偏离「当前实施模式」，以远期设想（区块链、联邦学习等）挤占主体（DVL2-03-QUALITY-01 记录的真实质量问题）；
2. 缺少关键章节（如验收标准）；
3. 混入与当前项目事实冲突的表述（如声称已支持视频生成）；
4. 方案探索型任务被错误收缩成当前实施计划。

### 0.2 本轮正式目标

以 PRD/方案文档为首个验证切片，实现：

```text
理解任务 → 建立成果要求 → 生成初稿 → 自动质量检查 → 发现缺陷
→ 自动修订（≤2 次） → 再检查 → 形成最终成果 → 落盘并可打开
```

设计不锁死在 PRD 文档（任务模式与成果要求按任务推断，非固定标题规则）。

### 0.3 本轮关键裁剪

1. 不建立第二套任务/成果权威存储（复用 PlanRecord / Task / DeliverablePackage / DeliverableVersion / ArtifactRef / provenance）；
2. 不复制 Knowledge Resolver；Reviewer 复用其解析结果；
3. 不引入大型 Agent 框架；Reviewer 走现有模型网关 `review` 路由；
4. 外部强力 Agent 适配器接口预留（Reviewer 为可替换步骤），本轮不以接入新厂商为完成条件；
5. 不进行全面 UI 重构；不改 TASK-UX-MIN-01 已验收行为；不重开 IDCOLLAB-MIN-01；
6. 质量评分、Reviewer 管线、授权与审计结构不进入默认用户界面。

---

## 1. 实现内容

### 1.1 新增模块

| 模块 | 职责 |
|---|---|
| `src/act-behalf/outcome-criteria.js` | `TASK_MODES`（`current_implementation` / `solution_exploration` / `strategic_planning`）；`detectTaskMode`（探索 > 战略 > 当前实施优先级的关键词规则，默认当前实施）；`buildOutcomeCriteria`（taskMode / targetAudience / intendedUse / requiredSections / projectConstraints / evidenceRequirements / implementationAlignment / completenessRequirements / usabilityRequirements / criteriaDigest）；`modeGuidanceFor`（初稿提示词注入文案） |
| `src/act-behalf/deliverable-reviewer.js` | 双层 Reviewer：确定性检查（占位复查、关键章节/标记、目标对齐、远期挤占主体、探索收缩、项目事实冲突、空话套话）+ 可选模型 Reviewer（`taskType:"review"` 路由，JSON 结构化输出，失败优雅降级为仅确定性结果）。输出 `ReviewResult{status, blockingIssues[], qualityIssues[], suggestedRevisions[], scores{goalAlignment, completeness, implementationReadiness, projectConsistency, evidenceQuality, clarity}, taskMode, criteriaDigest, reviewerDegraded, modelReviewUsed}` |

### 1.2 管线接线

1. **OutcomeCriteria 派生**：`deliverable-generation.js` 在生成前从已确认计划（understanding/expectedQuality）、任务上下文与项目标记派生；`deliverable-package-schema.js` 的 `inputSummary` 新增 `expectedQuality` 透传；
2. **初稿上下文**：`deliverable-context.js` `buildGenerationContext` 携带 `outcomeCriteria` / `modeGuidance` / `expectedQuality`；`deliverable-generators.js` `contextBlock` 将任务模式、关键内容与质量要求注入初稿与修订提示词（有界注入，非全量材料）；
3. **Reviewer 步骤**：`generateByKindWithRepair` 在既有占位门禁之后、成稿之前执行 `onDraftValidated` 钩子；Reviewer 判定 blocking 时抛 `review_content_rejected`，复用既有修订循环（`repairContext.issues` 携带 Reviewer 问题清单，`buildRepairIssueLines` 支持普通语言问题行）；
4. **修订预算**：占位门禁与质量 Reviewer 共享同一预算——初稿 + 最多 **2** 次修订（`MAX_QUALITY_REPAIR_ATTEMPTS = 2`），每次修订后重新检查；两次后仍 blocking → 不落盘、不冒充最终成果，失败证据（含 `failureEvidence.reviewResult`）持久化，用户看到普通语言说明；
5. **结果持久化**：通过版本 `version.quality.reviewer` 持久化最终 Reviewer 结果（状态、任务模式、评分、问题计数、降级标记、复核时间）；失败侧持久化在 generation attempt 的 `failureEvidence` 与 `reviewIssues`；重启后经既有 store 恢复；
6. **附带修复**：`deliverable-generation.js` 原 `project_unresolved` 分支在 `activeAttemptId` 声明前引用的 TDZ 隐患（声明前移）。

### 1.3 用户界面（克制原则）

1. 状态文案映射为建议口径：`正在形成预计交付…`（整理任务）→ `正在生成成果…`（形成初稿）→ `正在检查质量并完善成果。`（检查/完善）→ `成果已生成。`（已完成）；
2. 单项状态 `正在自动修正` → `正在完善成果`；失败提示沿用普通语言（`成果还没有达到可直接使用的质量：…`），不暴露 Reviewer 管线、评分、授权或审计结构；
3. 高级审计详情（既有折叠入口）可查看质量检查问题行；
4. 不新增默认主流程打断；普通质量问题与自动修订不要求用户确认。

## 2. 质量基准（benchmark）

`scripts/fixtures/task-quality-loop-01/benchmark-samples.json`：3 个 PRD/方案任务样本（当前实施型 / 方案探索型 / 战略规划型），每个样本含用户原始目标、必须满足条件、禁止出现的问题、最低合格标准、缺陷草稿与合格草稿、Reviewer 预期判断。

自动化测试验证：模式识别、OutcomeCriteria 形成、Reviewer 发现预设缺陷、修订次数受限（≤2）、blocking 不标完成、合格成果落盘、重启恢复。

**明确声明**：测试通过 = `benchmark_framework_started`；**不**等于达到市场 95% 分位（`market_95th_percentile_not_yet_proven`）。

## 3. 测试与结果

| 测试 | 结果 |
|---|---|
| `test:task-quality-loop-01`（新增，13 项） | 13 pass / 0 fail |
| `test:dvl2-03-placeholder-gate`（DVL2-03-FIX-01 回归） | 6 pass |
| `test:dvl2-03-generation` / `test:dvl2-03-one-click` | 6 pass / 6 pass |
| `test:dvl2-03-generation-acceptance`（Electron 两阶段，mock 模型） | Phase A 4 项落盘 + Phase B 重启恢复全过 |
| `test:dvl2-04-auto-learn` / `test:dvl2-05-context` | 6 pass / 10 pass |
| `test:dvl2-01-planner` / `test:dvl2-02-package` | 12 pass / 17 pass |
| `test:task-ux-min-01`（TASK-UX-MIN-01 回归） | 11 pass |
| `test:idcollab-min-01` / `test:idcollab-min-01.1-ui`（撤销等回归） | 13 pass / 3 pass |
| `test:learn-loop-fix-01` / `02` / `02.1`（Learning Loop / Knowledge Resolver 回归） | 10 / 8 / 11 pass |
| `test:crt-mvp-continuity` / `crt-mvp-01.1` / `crt-mvp-02` / `02.1` / `02.2` / `model-routing` / `vl1-block3` / `vl1-prompt-calibration` / `gate4-auto-flow` / `act-behalf` | 全绿（exit 0） |

## 4. Electron 真机验收场景（Owner 执行；本包不替 Owner 宣称通过）

### 场景 A：当前实施型 PRD

输入：`为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。`
预期：不要求复杂表单；过程仅见简洁状态；文档以当前架构为基础，不以区块链/联邦学习/复杂协作网络为主体；自动完成检查与修订；最终文件可打开、内容可直接用于后续实现。

### 场景 B：方案探索型

输入：`探索 Digital Me 将来如何支持多个数字主体协作，形成方案比较，不要求近期实现。`
预期：识别为方案探索；保留多路线比较；不收缩成当前实施任务；明确区分当前基础与远期方案。

### 场景 C：质量失败

受控 harness 制造无法自动修复的 blocking issue（例如持续缺失关键内容）。
预期：失败稿不显示为「已完成」；普通语言说明缺少什么；失败证据可恢复；不暴露内部堆栈或状态机。

回归命令：`npm run test:task-quality-loop-01` 及 §3 全部回归；Electron 既有验收 `npm run test:dvl2-03-generation-acceptance`。

## 5. 未完成边界与风险

1. Reviewer 模型评审质量依赖所配置 `review` 路由模型；模型不可用时降级为仅确定性检查（`reviewerDegraded`）；
2. 确定性检查为启发式规则，可能漏检或误伤（误伤时走自动修订，两次后以普通语言失败，不冒充成功）；
3. 任务模式为关键词规则，复杂混合意图可能误判；误判表现为检查口径偏严或偏松，不产生数据风险；
4. 生成过程为同步 IPC，过程态文案按结果阶段映射，尚无流式进度通道；
5. 研究、写作、编程等任务类型的 OutcomeCriteria 扩展点为同一结构，但本轮仅验证 PRD/方案切片；
6. 外部强力 Agent 适配接口未实现（Reviewer 步骤已可替换）；市场 95% 分位未证明。

## 6. 状态结论

```text
implemented /
automated_tests_passed /
owner_runtime_acceptance_pending /
benchmark_framework_started /
market_95th_percentile_not_yet_proven
```

不得 push。等待 Owner 真机验收（场景 A/B/C）。
