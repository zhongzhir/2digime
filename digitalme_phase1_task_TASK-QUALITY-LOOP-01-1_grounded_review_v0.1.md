# 任务包 TASK-QUALITY-LOOP-01.1：成果真实性与架构一致性复核（Grounding Review）

版本：v0.1.0
日期：2026-07-28
状态：`implemented` / `automated_tests_passed` / `grounding_review_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`
实施：`implemented`
实施分支：`codex/task-quality-loop-01-1-grounded-review`
实现提交：`45353e3`（核心实现）+ `2d15531`（fixture 与测试）+ 文档收口提交
上位依据：
- [`digitalme_phase1_task_TASK-QUALITY-LOOP-01_quality_reviewed_deliverable_loop_v0.1.md`](digitalme_phase1_task_TASK-QUALITY-LOOP-01_quality_reviewed_deliverable_loop_v0.1.md)（质量闭环首轮）
- [`digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`](digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md)（DVL2 上位合同）
- 失败样本：Owner 真机产出 `artifact(3)`（项目知识功能 PRD，`dver_ms44280t_b4944033`）

> **正式边界**：本任务只解决一个问题——Reviewer 此前能识别格式缺陷，却不能可靠判断文档是否准确理解当前系统、是否重复建设已有能力、是否与权威对象冲突。**不等于**：全类型成果 grounding 已完成；模型评审质量已保证；Owner 真机验收已通过。**不得**标 `accepted_as_implemented` / `artifact_quality_validated` / `market_95th_percentile_achieved`。

---

## 1. 失败样本与问题定性

失败样本 `artifact(3)`（项目知识功能 PRD）存在八类问题：错误判断项目知识机制缺失/初级；未识别 project-knowledge-store、Knowledge Resolver、跨面调用、来源与 supersede；未经证实假设已有 SQLite 后端与 Project/Fact/Asset/Plan/Outcome 表；重新定义与 PlanRecord/Task/ArtifactRef/provenance/项目知识重叠的数据对象；把项目知识重设计为近似项目管理系统；验收仅验证 CRUD；普通技术选择升级为 Owner 决策；无依据 `9–15 人日` 工期。

**本任务要求该文档在新 Reviewer 下无法直接通过——已实现**（fixture `grounding-samples.json` failure 样本，7 类 grounding ruleId 全部命中）。

## 2. 实现内容

### 2.1 CurrentSystemSnapshot（`src/act-behalf/current-system-snapshot.js`）

- 能力注册表（项目知识存储 / Knowledge Resolver / 低打扰学习闭环 / 成果生成管线 / 任务管理 / 身份授权 / 质量闭环 / SecretStore+PolicyEngine），每项**以真实模块文件存在为确认依据**（`fs.existsSync`），无法确认标记 `unknown`、绝不自动补全；
- 按任务目标关键词过滤，**只收集相关能力**；
- 持久化机制检测：JSON 文件存储（present）、SQLite（absent，R2.5 deferred）、云同步（absent）、外部 Agent 适配层（absent）；
- 已知边界（视频/音频未真实生成、外部协作未验证、市场结算未启动、SQLite deferred、R3 paused），均携带 sourceRef；
- `snapshotDigest`；`renderSnapshotFacts` 产出有界「当前系统现状」事实块注入初稿提示词（≤10 行）。

### 2.2 AuthorityMap（`src/act-behalf/authority-map.js`）

- 8 个权威对象：PlanRecord / Task / ArtifactRef / ProjectKnowledge / KnowledgeItem / Authorization / LearningRecord / Provenance；含 authoritativeStore、authoritativeType、referencedBy、duplicationRisk、notes、实现文件验证；
- 每个对象配置「重定义别名」正则（如 `executionPlans`、`keyOutcomes`、`facts 列表`、`新建一套任务存储`）与「引用豁免语」（引用已有/复用现有/沿用现有/不新建/权威存储…）。

### 2.3 GroundingReview（`src/act-behalf/grounding-review.js`）

仅对 `current_implementation` 且 Digital Me 项目任务的文本类成果运行（Reviewer 内确定性层，模型降级时绝不跳过）。新增 blocking issue：

| ruleId | 检查 |
|---|---|
| `current_state_incorrect` | 宣称已具备能力缺失/初级阶段（对照快照 present 能力域名词） |
| `existing_capability_ignored` | 相关已具备能力在文中零提及（列出缺失能力与依据文件） |
| `duplicate_authority_source` | 以新命名重定义权威对象且无引用豁免语（按对象去重） |
| `unsupported_architecture_assumption` | 断言既有 SQLite/数据表/云同步/外部 Agent 适配层（对照持久化检测） |
| `acceptance_only_tests_crud` | 验收仅 CRUD（创建/查询/导出…）且无跨流程用户结果（新对话/新任务/supersede/不串用/重启） |
| `owner_decision_overreach` | 普通技术选择（界面入口/配额/存储/备份/关联时机/规模/同步机制…）升级为 Owner 决策；战略/主权/方向类豁免 |
| `unsubstantiated_estimate` | 无依据工期/容量数字（人日/工时/工期），标注待验证假设或有依据者豁免 |
| `grounding_revision_guidance` | 携带重组方向（现有基础→实际缺口→最小新增能力→与现有对象关系→用户结果→验收），随其他 grounding issue 附带 |

`ReviewResult.grounding`：currentStateAccuracy / authorityConsistency / duplicationRisk / acceptanceValueAlignment / unsupportedAssumptions[] / duplicateAuthorityObjects[] / missingCurrentCapabilities[] / ownerDecisionOverreach[]。

### 2.4 流程接线（`deliverable-generation.js` / `deliverable-context.js` / `deliverable-generators.js`）

- 流程：理解任务 → OutcomeCriteria → **CurrentSystemSnapshot + AuthorityMap** → 初稿（注入有界系统现状事实块）→ 占位检查 → **GroundingReview + ProductQualityReview** → 自动修订 → 再核对 → 最终成果；
- 修订预算不变：初稿 + ≤2 次修订，grounding issue 与其他 blocking issue 共用；
- 修订提示携带：被遗漏能力、正确权威对象、不得复制对象、不受支持假设、验收改写方向、应移除的 Owner 决策项（经 `toRepairIssues` 普通语言问题行）；
- 持久化：`version.quality.reviewer.grounding`（成功）；attempt `failureEvidence.reviewResult.grounding`（失败）；重启经既有 store 恢复；
- 最终失败用户文案（grounding 类）：`成果与当前项目状态存在冲突（…），系统暂时无法可靠完成。请补充或更新相关项目资料后重试。`

### 2.5 用户界面

默认 UI **无新增内容**：仍只有「正在生成…/正在检查质量并完善成果/成果已生成」及失败普通语言。不显示 AuthorityMap / CurrentSystemSnapshot / grounding 评分 / ruleId（仅高级审计详情可见问题行）。

## 3. 第一次生成失败调查（有界，真实 userData 证据）

Owner 真机：第一次生成失败、第二次成功。持久化记录（`deliverable-packages.json` → generationAttempts）：

| attempt | 时间（UTC) | 结果 | 证据 |
|---|---|---|---|
| `dgatt_ms43xgg5…` pass0 | 03:39:40→03:40:48 | superseded / repair_initiated | `placeholder_content_rejected` @ prewrite_validation；`unfilled_field_label` ×2；9269 字 |
| `dgatt_ms43yx7j…` pass1 | 03:40:48→03:41:32 | superseded / repair_initiated | 同上；8775 字 |
| `dgatt_ms43zvl0…` pass2 | 03:41:32→03:42:16 | **failed** | 同上；8763 字；预算耗尽安全失败，未落盘 |
| `dgatt_ms4410sv…`（用户再次发起）pass0 | 03:42:26→03:43:22 | succeeded | Reviewer pass（modelReviewUsed=true，未降级） |

**结论**：根因明确——第一次运行的模型连续三稿产出「字段标签后空值」，占位门禁（DVL2-03-FIX-01）正确拦截，修订提示未能消除，两次修订预算耗尽后按设计安全失败并给出普通语言。**非** Reviewer 误伤、**非**模型评审超时/降级、**非**输出格式失败、**非**关键词误伤。第二次模型一次成稿。

**是否附带修复**：否。修订提示已携带具体行号与「缺事实写待 Owner 决策」指引，失败属模型输出波动；把「预算耗尽后自动全新重试」列入后续候选（涉及修订预算合同变更，需 Owner 决策），本轮不扩大。

## 4. 测试与结果

| 测试 | 结果 |
|---|---|
| `test:task-quality-loop-01-1`（新增，17 项；覆盖指令第十四节 1–18） | 17 pass / 0 fail |
| `test:task-quality-loop-01`（上轮 13 项回归） | 13 pass |
| DVL2：placeholder-gate / generation / one-click / dvl2-04 / dvl2-05 / dvl2-01 / dvl2-02 | 6 / 6 / 6 / 6 / 10 / 12 / 17 pass |
| `test:dvl2-03-generation-acceptance`（Electron 两阶段） | Phase A+B 全过 |
| `test:task-ux-min-01` / `test:idcollab-min-01` / `test:idcollab-min-01.1-ui` | 11 / 13 / 3 pass |
| `test:learn-loop-fix-01` / `02` / `02.1` / `test:act-behalf` | 10 / 8 / 11 / 4 pass |

fixture：`grounding-samples.json` = 失败样本（artifact(3) 全文，预期 7 类 ruleId + 3 个重复实体）+ 合格样本（预期通过，覆盖指令第十一节 9 项要求）。

## 5. Owner 真机验收场景

### 场景 A：重新生成项目知识 PRD

输入：`为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。`
预期：明确已有 project knowledge 与 Knowledge Resolver；不建第二套项目知识系统；不假设 SQLite；说明现有对象与新增能力关系；验收以跨对话/跨任务/一致性/防串用为中心；普通技术选择有推荐默认；无无依据工期。

### 场景 B：受控失败样本

以 `artifact(3)` 作为候选初稿进入 Reviewer（可用 fixture 驱动 `reviewDeliverableContent`）。
预期：识别为不可直接实施；至少命中当前状态错误、重复权威对象、CRUD 验收；自动修订；修订失败时不落盘为最终成果。

回归命令：`npm run test:task-quality-loop-01-1`、`npm run test:task-quality-loop-01` 及 §4 全部回归；Electron 既有验收 `npm run test:dvl2-03-generation-acceptance`。

## 6. 未完成边界与风险

1. GroundingReview 仅覆盖 Digital Me 项目自身 + 当前实施型 + 文本类成果；非本项目任务不启用（快照不适用于外部主题）；
2. 能力/权威注册表为启发式，新增能力需同步注册（遗漏表现为不检查，不会误判为缺失）；
3. 别名/豁免语存在漏检与误伤空间；误伤经自动修订消化，两次后普通语言失败；
4. 快照基于本仓库文件系统，打包形态（asar）内文件可读；若模块被重命名需更新注册表；
5. 第一次失败调查候选项（预算耗尽后自动全新重试）未实施，需 Owner 决策；
6. 模型评审对 grounding 的增量价值未验证（本轮 grounding 为确定性层）；
7. 市场 95% 分位未证明；最终成果质量未经 Owner 真机验证。

## 7. 状态结论

```text
implemented /
automated_tests_passed /
grounding_review_added /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。等待 Owner 真机验收（场景 A/B）。
