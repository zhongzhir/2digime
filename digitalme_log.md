# Digital Me 工作日志

版本：v0.1
状态：持续更新

---

## 2026-07-31 TODAY-CLOSE · MVP-LEARNING-QUALITY-01 工程验收收口

### 状态

`accepted_as_engineered` / `learning_precision_validated` / `generic_quality_scope_isolation_validated` / `real_model_preference_reuse_confirmed` / `quality_outcome_mixed` / `owner_engineering_accepted` / `not_pushed`

分支：`codex/mvp-release-gate-01`。任务包：`digitalme_phase1_task_MVP-LEARNING-QUALITY-01_v0.1.md`。报告：`MVP_LEARNING_QUALITY_01_FIX_01_REPORT_20260731.md`。

### 已验证

- 真实生产学习链路落盘：expression=4，boundary=1，Learn Job `committed`，无 pending_conflict
- 静态：`test:mvp-learning-quality-01` 17/17；`test:dvl2-04-auto-learn` 6/6
- 无 Task A 正文复制；无错误旧事实
- software / image / video / podcast **静态** scope 隔离
- document/article **真实** DeepSeek 回归（证据 `probe-c-2026-07-31T13-46-45-511Z`）
- 通用 `qualityScope` / `resolveQualityExperiences`；新增 Store/IPC/知识源 = 0

### 明确未证明

- 文章结果全面优于普通模型（`valueHypothesisSupported=false`；observableImproveDimensions=1；mixed）
- 跨模态真实质量验证
- closed alpha / MVP 产品就绪

### 长期结论

1. 用户修改并采用后，质量经验可分类、落盘、重载并在匹配任务复用。  
2. 非文章专用：可通过 qualityScope 承载多成果类型。  
3. 不得把一次采用成果的全部特征自动升为长期全局偏好。  
4. 学习精度通过 ≠ 每次生成更优；后者交给后续 **MVP-QUALITY-EVALUATION-01**（未启动）。

不得 push。今日停止新增功能 / 调参 / 真实模型回归。

---

## 2026-07-29 ARTIFACT-ACCESS-MIN-01.1 原生成果菜单上下文一致性修复

状态：`implemented` / `stale_artifact_context_removed` / `native_menu_context_guarded` / `developer_runtime_accepted` / `owner_runtime_acceptance_pending`。

验证命令与结果：

- `node digitalme-app/scripts/test-task-quality-stabilize-01-fix-01-artifact-open.cjs` → `14/14` 通过
- `node digitalme-app/scripts/test-global-renderer-responsiveness-01.cjs` → `11/11` 通过
- `node digitalme-app/scripts/run-artifact-access-min-file-menu-acceptance.cjs`（正式窗口真实鼠标）→ `ok: true`

证据目录：`digitalme-app/scripts/_access-min-evidence/2026-07-29T08-35-23-483Z/`。

约束确认：新增永久字段 `0`；新增 Store `0`；新增 IPC `0`；不恢复成果卡「打开成果」按钮；原生菜单仍为当前过渡访问入口；尚未 `owner_runtime_accepted`；尚未 `accepted_as_implemented`。不得 push。

---

## 2026-07-29 ARTIFACT-ACCESS-MIN-01 开发侧文件菜单验收通过

正式 `electron .` + Owner userData；OS 真实鼠标点击「文件 → 打开当前成果 / 打开成果所在文件夹」；截图见 `digitalme-app/scripts/_access-min-evidence/LATEST/`；重启后再跑通过。状态升为 `developer_runtime_accepted` / `ready_for_owner_spotcheck`。不得 push。

---

## 2026-07-29 ARTIFACT-ACCESS-MIN-01 原生文件菜单访问 · 实施中（禁止 Owner 复验）

### 结论

成果文件与 main 安全打开可用；失败在 renderer 叠加事件体系。本任务撤销 FIX-01A～D / RESET 打开前端，保留 RESPONSIVENESS；入口改为「文件」菜单。

### 状态

`implementation_in_progress` / `owner_retest_forbidden`  
分支：`codex/artifact-access-min-01`。不得 push。开发者须 `npm start` → 文件 → 打开当前成果 / 打开成果所在文件夹 实测后再升状态。

---

## 2026-07-29 ARTIFACT-OPEN-RESET-01 成果打开最小重建 · 实施中（禁止 Owner 复验）

### 性质

重置，非 FIX-01E。删除 root capture / 直接绑定 / 多套打开兼容；改为与「接受」共享 `#act-generation-items` → `executeUiCommand("artifact.open")`。

### 状态

`implementation_in_progress` / `owner_retest_forbidden`  
分支：`codex/artifact-open-reset-01`；基线 `48bdc57`。  
废除误导标签：`formal_coordinate_click_passed` / `owner_dom_trace_passed`。  
开发者须 `npm start` + 真实鼠标验收后方可升为 `developer_runtime_mouse_accepted`。不得 push。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01-FIX-01D 成果打开单入口收口 · 实施完成（待 Owner 复验）

### 事实

Owner @ `1ba6a68`：直接绑定后正式页仍无「正在打开…」。正式 DOM dump 确认按钮由 `renderGenerationPanel` 输出且带稳定 ID；正式窗口加载工作区 `app.js` / `deliverable-planner.js`。

### 修复

删除 `bindArtifactOpenButtons` / `handleArtifactOpenButtonClick` / 面板与历史 open 分支；bootstrap 时在 `#app` 安装一次 capture；`composedPath` 匹配；反馈先于 rAF/IPC。

### 验证

Owner userData 坐标点击 harness（PRD / 用户故事地图 / 功能和数据字典 + 重启）通过；`rootListenerInstallCount=1`；`shell.openPath=""`。静态合同与 UI acceptance 通过。

### 状态

`implemented` / `single_root_artifact_open_entry_added` / `owner_dom_trace_passed` / `formal_coordinate_click_passed` / `owner_runtime_revalidation_pending`  
分支：`codex/task-quality-stabilize-01-fix-artifact-single-entry`。不得 push；不得标 `artifact_open_validated`。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01-FIX-01C 正式成果按钮直接绑定 · 实施完成（待 Owner 复验）

### 事实

Owner @ `0341f30`：菜单/普通按钮已即时，但三个「打开成果」仍无「正在打开…」。判定正式 click handler 未执行。

### 修复

`bindArtifactOpenButtons`：渲染后对每个 `open-deliverable-artifact` 直接绑定（`currentTarget`）；`handleGenerationPanelClick` 不再处理新打开 action；反馈先于 IPC；有界日志；CSS 可点防护；正式 Electron click trace 48 passed。无全局 listener / 新 IPC / 新 Store / 新永久字段。

### 状态

```text
implemented / direct_artifact_button_binding_added /
formal_electron_click_trace_passed / owner_runtime_revalidation_pending
```

不得 push；不得标 artifact_open_validated。

---

## 2026-07-29 GLOBAL-RENDERER-RESPONSIVENESS-01 全局交互迟滞 · 实施完成（待 Owner 验收）

### 事实

Owner 正式版 `6bff2ad`：打开成果无反馈、普通按钮慢、「文件」菜单延迟 2–3 秒。根因是 main 同步读写约 2.1MB `deliverable-packages.json`（pretty JSON stringify + 重复 loadStore），非单按钮接线。FIX-01C 已暂停（未提交 capture 方案已 discard）。

### 修复

三 store 内存缓存 + 紧凑 JSON 持久化；`wireActBehalfUi`/`bindEvents`/task-list UI 幂等；增强面板刷新节流 250–400ms；打开反馈卡片局部化；清除「已打开草稿任务」粘滞文案。未加 document capture。

### 状态

```text
implemented / duplicate_listeners_removed /
renderer_main_thread_work_reduced /
automated_performance_tests_passed /
owner_runtime_acceptance_pending
```

不得 push；不得标 performance_regression_fixed。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01-FIX-01B 正式成果按钮端到端接线 · 实施完成（待 Owner 复验）

### 事实

追踪正式 legacy 渲染器 PRD「打开成果」全链路：DOM(`#act-generation-items`) → `handleGenerationPanelClick` → preload `actBehalfOpenArtifact` → IPC `actBehalf:openArtifact` → main `openArtifactSecure` → Store 解析 → `shell.openPath`(返回 `""`) → `{ok:true}` → UI「已打开成果」。原 action `open-primary`；**未**误命中 `openActBehalfTask`。「已打开草稿任务。」来自 `openActBehalfTask`（任务列表行触发），与成果卡不同 DOM/不同 action，系旧进度残留；成果卡与任务卡无父子冒泡关系。

### 修复

主按钮唯一 action `open-deliverable-artifact`（`open-primary`/`open-art` 兼容别名）；抽出单一 `openDeliverableArtifactFromButton(btn)`；成果打开分支 `stopPropagation()`；即时「正在打开…」/「已打开成果」/「暂时无法打开成果。」反馈于 `#act-generation-status`；顺序保持 md→docx→html。新增真实按钮点击 Electron UI 测试 `scripts/electron-artifact-open-ui-acceptance.cjs`（**42 passed / 0 failed**，含故意失败与重启复点）。

### 架构

新增永久字段=0；新增 Store=0；新增 IPC 打开体系=0。

### 状态

```text
implemented / formal_renderer_open_path_repaired /
automated_ui_tests_passed / owner_runtime_revalidation_pending
```

不得 push；不得标 owner_runtime_accepted。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01-FIX-01A 打开验收 probe 修复 · 实施完成（待 Owner 复验）

### 事实

Owner 截图显示 `tmp-open-artifact-probe.cjs` 因 `require("./src/...")` 相对路径错误崩溃。FIX-01「Electron open+reopen ok」不得作为 Owner 通过依据。

### 修复

正式 `electron-artifact-open-acceptance.cjs` 使用 `__dirname`→app root；隔离 userData；Owner PRD 复制后 openPath=""；UI 成功短暂「已打开成果」。

### 状态

```text
implemented / automated_tests_passed / acceptance_probe_repaired /
artifact_open_owner_revalidation_pending
```

不得 push。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01-FIX-01 成果打开链路修复 · 实施完成（待 Owner 真机验收）

### 事实

Owner 真机：基础成果已落盘且 UI 显示正式成果卡，但「打开成果」无反应。核验确认文件存在；原主打开目标为 HTML 优先；打开失败反馈不足。

### 修复

权威 `openArtifactSecure`；renderer 只传稳定 ID；文档优先打开 md；按钮「正在打开…」与一句用户面错误。

### 状态

```text
implemented / automated_tests_passed / artifact_open_restored /
owner_runtime_acceptance_pending
```

不得 push。

---

## 2026-07-29 TASK-QUALITY-STABILIZE-01 可靠交付与后台增强分离 · 实施完成（待 Owner 真机验收）

### 裁决

连续真机验收表明 Grounding/Reviewer/Semantic/Outline/Repair 等机制存在且自动化通过，但真实用户多次拿不到成果；质量管线已成为交付阻断器。停止继续叠加门禁/重试。

### 架构

生产默认 `stable_delivery`：硬门禁 → 立即落盘 → 后台 ≤3 次模型增强；失败保留基础。旧复杂链路为 `advanced_shadow` / `experimental_advanced_quality_pipeline`。

### 状态

```text
implemented / automated_tests_passed / stable_delivery_added /
owner_runtime_acceptance_pending / market_95th_percentile_not_proven
```

真实模型连续 harness：自动环境 SKIP（需 `DIGITALME_STABLE_REAL=1`），改由 Owner 真机。不得 push。

---

## 2026-07-29 TASK-QUALITY-LOOP-01.2-FIX-01 自动完成与单一界面 · 实施完成（待 Owner 真机验收）

### 根因（真机 attempt）

`project_authority_conflict` 在 Reviewer 前硬失败且不在可修复集合；`useSemanticBlocks` 未转发；UI 给出「继续完善」。

### 修复

权威冲突自动修订；语义分块接线；有界整篇 fallback；删除「继续完善」；单一「成果未能完成」状态；计划摘要态。新增永久字段 0。

### 状态

```text
implemented / automated_tests_passed / auto_completion_flow_repaired /
single_task_view_added / owner_runtime_acceptance_pending
```

Owner 真机尚未通过。不得 push。

---

## 2026-07-29 TASK-QUALITY-LOOP-01.2 动态成果契约与 UI 收敛 · 实施完成（待 Owner 真机验收）

### 本次目标

建立「用户目标 → 动态语义契约 → Outline → 语义覆盖 → 分块生成/局部修复 → Reviewer → 单一状态出口」；不写死 PRD 章节；收敛 GenerationAttempt / ReviewResult；去掉任务页重复目标与多重错误提示。

### 本次完成（分支 `codex/task-quality-loop-01-2-semantic-contract`；基线 `a9ff638`）

1. **语义契约**：`semantic-contract.js` + OutcomeCriteria v2 `requiredSemanticCoverage`（非固定章节）；
2. **分块生成**：`semantic-generation.js` OutlinePlan → blocks → 语义缺口补齐（运行态；不新建 store）；
3. **Attempt 收敛**：`recoveryActions[]` 统一写入；旧布尔字段兼容读；
4. **UI 投影**：`deriveUserFacingTaskState`；planner 目标去重、失败态「成果还未完成」+「继续完善」；
5. `test:task-quality-loop-01-2` 全绿；01 / 01.1 / FIX-01 与 DVL2 / TASK-UX / IDCOLLAB / Learning Loop / Knowledge Resolver / act-behalf 回归全绿。

### 状态

```text
implemented /
automated_tests_passed /
semantic_contract_generation_added /
generation_state_consolidated /
task_ui_minimized /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。**Owner 真机尚未通过。**不得标 `architecture_simplified`（旧字段尚未物理删除）。

---

## 2026-07-28 TASK-QUALITY-LOOP-01.1-FIX-01 Grounded Generation 修复 · 实施完成（待 Owner 真机验收）

### 本次目标

修复 Owner 真机连续 3 次项目知识 PRD 被 Grounding Gate 阻断、自动修订无效、用户只能手动重试的问题：让生成阶段服从当前系统事实。

### 本次完成（分支 `codex/task-quality-loop-01-1-fix-grounded-generation`；基线 `d5ee05f`）

1. **权威事实区块**：`CURRENT SYSTEM FACTS — AUTHORITATIVE` + 结构化字段注入初稿/重建/干净重试；
2. **历史材料降权**：superseded 不进当前事实；planning_only 标注不得覆盖已验收状态；
3. **Gap Statement**：ExistingCapabilities / ActualGaps 等五元组，冲突则重算，禁止把已有能力写成缺口；
4. **grounded_rebuild**：四大 grounding blocking 时不带全文失败稿；
5. **clean regeneration**：初稿 + ≤2 次修订/重建后允许 1 次干净上下文全新生成；模型调用硬上限 16；
6. 审计字段 `groundedRebuildUsed` / `cleanRegenerationUsed` 持久化；默认 UI 不展示内部机制；
7. `test:task-quality-loop-01-1-fix-01` 9 项全绿；01.1 / 01 与 DVL2 / TASK-UX / IDCOLLAB / Learning Loop / act-behalf 回归全绿。

### 状态

```text
implemented /
automated_tests_passed /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。**Owner 真机尚未通过。**

---

## 2026-07-28 TASK-QUALITY-LOOP-01.1 成果真实性与架构一致性复核（Grounding Review）· 实施完成（待 Owner 真机验收）

### 本次目标

解决 Owner 真机暴露的关键问题：Reviewer 能识别格式缺陷，却不能可靠判断文档是否准确理解当前系统、是否重复建设已有能力、是否与权威对象冲突。失败样本 `artifact(3)`（项目知识功能 PRD）必须在新 Reviewer 下无法直接通过。

### 本次完成（分支 `codex/task-quality-loop-01-1-grounded-review`；`45353e3` 实现 + `2d15531` 测试）

1. **CurrentSystemSnapshot**：能力注册表以真实模块文件验证（未确认标 `unknown` 不补全）；按任务关键词只提取相关能力；持久化检测（JSON present / SQLite absent-deferred / 云同步 absent / 外部 Agent 适配 absent）；已知边界携带 sourceRef；有界事实块注入初稿提示词；
2. **AuthorityMap**：8 个权威对象（PlanRecord/Task/ArtifactRef/ProjectKnowledge/KnowledgeItem/Authorization/LearningRecord/Provenance），重定义别名正则 + 引用豁免语；
3. **GroundingReview**（确定性，模型降级不跳过；仅 Digital Me 项目 + 当前实施型 + 文本类）：新增 `current_state_incorrect` / `existing_capability_ignored` / `duplicate_authority_source` / `unsupported_architecture_assumption` / `acceptance_only_tests_crud` / `owner_decision_overreach` / `unsubstantiated_estimate` / `grounding_revision_guidance`；`ReviewResult.grounding` 持久化到版本与失败证据，重启可恢复；
4. 修订提示携带遗漏能力/正确权威对象/不支持假设/验收改写方向/应移除 Owner 决策项；修订预算不变（≤2 次，共用）；
5. fixture：失败样本 artifact(3) 全文（预期 7 类 ruleId + 3 个重复实体）+ 合格样本（预期通过）；
6. 新增 `test:task-quality-loop-01-1` 17 项全绿；回归：TASK-QUALITY-LOOP-01 13 项、DVL2 全系列（含 Electron 两阶段 acceptance）、TASK-UX-MIN-01、IDCOLLAB-MIN-01(+MIN-01.1)、LEARN-LOOP 全系列、act-behalf 全绿；
7. 默认 UI 无新增内容；grounding 失败用户文案：`成果与当前项目状态存在冲突…请补充或更新相关项目资料后重试。`

### 第一次生成失败调查（有界；真实 userData 证据）

第一次运行三稿连续被占位门禁拦截（`unfilled_field_label` ×2/稿，9269→8775→8763 字），两次修订预算耗尽后安全失败未落盘；用户再次发起后一次成稿、Reviewer pass（模型评审未降级）。**根因 = 模型输出波动，占位门禁正确拦截；非 Reviewer 误伤/超时/降级/格式失败。** 不附带修复；「预算耗尽后自动全新重试」列为后续候选（涉预算合同变更，需 Owner 决策）。

### 状态

```text
implemented /
automated_tests_passed /
grounding_review_added /
owner_runtime_acceptance_pending /
market_95th_percentile_not_proven
```

不得 push。等待 Owner 真机验收（场景 A 重新生成项目知识 PRD / 场景 B 受控失败样本，见任务包 §5）。

---

## 2026-07-28 TASK-QUALITY-LOOP-01 复杂任务高质量完成闭环 · 实施完成（待 Owner 真机验收）

### 本次目标

验证更高一级产品能力：用户给出复杂目标后，Digital Me 选择合适方法，完成生成、检查、修订与交付，给出达到可直接采用水平的成果。首个验证切片为 PRD/方案文档。结果优先、内部复杂外部克制、低打扰。

### 前置：IDCOLLAB-MIN-01 状态校正（Commit `313f506`）

按 Owner 指令将残留的 `ready_for_owner_acceptance` / `ready_for_owner_runtime_reacceptance` / `not_started` 统一校正为 `implemented` / `revocation_bug_fixed` / `owner_runtime_accepted` / `accepted_as_implemented`，边界 `minimal_identity_collaboration_loop_only` / `external_network_collaboration_not_validated` / `market_and_settlement_not_started`。涉及：任务包头部、context（5 处）、panorama index（2 处）、project-knowledge-store 种子 claim。不重开任务、不重新实现、不扩展外部协作。

### 本次完成（Commit `ba4a521`，分支 `codex/task-quality-loop-01`）

1. 新增 `outcome-criteria.js`：任务模式判断（`current_implementation` / `solution_exploration` / `strategic_planning`）与内部 `OutcomeCriteria` 结构；初稿提示词按模式注入成果要求；
2. 新增 `deliverable-reviewer.js`：双层 Reviewer（确定性检查：占位复查/关键章节/目标对齐/远期挤占主体/探索收缩/项目事实冲突/空话套话 + 可选模型评审走 `review` 路由，失败优雅降级）；结构化 `ReviewResult`（status/blockingIssues/qualityIssues/suggestedRevisions/scores）；
3. 管线接线：Reviewer 挂在占位门禁之后、成稿之前；blocking → `review_content_rejected` 复用既有修订循环；占位与质量**共享**修订预算 ≤2 次；两次仍失败 → 不落盘、失败证据（含 reviewResult）持久化、普通语言说明；
4. 持久化：通过版本 `version.quality.reviewer`；失败侧 attempt `failureEvidence.reviewResult` + `reviewIssues`；重启恢复经既有 store；
5. `inputSummary` 透传 `expectedQuality`；附带修复 generation `project_unresolved` 分支 TDZ 隐患；
6. UI 克制：状态文案 `正在生成…` / `正在检查质量并完善成果。` / `成果已生成。`；单项 `正在完善成果`；不展示评分/管线/授权/审计结构；
7. benchmark fixture：3 个 PRD/方案样本（当前实施/方案探索/战略规划），含缺陷与合格草稿及 Reviewer 预期判断；
8. 新增 `test:task-quality-loop-01` 13 项全绿；回归：DVL2-03（generation/one-click/placeholder-gate/Electron 两阶段 acceptance）、DVL2-04/05、DVL2-01/02、TASK-UX-MIN-01、IDCOLLAB-MIN-01(+MIN-01.1)、LEARN-LOOP-FIX-01/02/02.1、CRT 全系列、model-routing、vl1-block3、vl1-prompt-calibration、gate4-auto-flow、act-behalf 全绿。

### 状态

```text
implemented /
automated_tests_passed /
owner_runtime_acceptance_pending /
benchmark_framework_started /
market_95th_percentile_not_yet_proven
```

不得 push。等待 Owner 真机验收（场景 A 当前实施型 PRD / 场景 B 方案探索 / 场景 C 质量失败，见任务包 §4）。

---

## 2026-07-27 TODAY-CLOSE-20260727 · 今日工作收口

Owner 真机验收日期：**2026-07-27**。文档收口 commit 见 Git 记录；**不得 push**。

### 今日完成

- 统一知识解析进入**对话**和**做事**链路（LEARN-LOOP-FIX-02）
- 最小低打扰学习循环通过 Owner 真机验收（LEARN-LOOP-FIX-02.1）
- 成果生成占位门禁误杀修复并通过真机验收（DVL2-03-FIX-01）
- 做事任务管理最小闭环通过真机验收（TASK-UX-MIN-01）

### 今日确认的能力

- 项目知识可跨新对话与新任务调用；来源可见
- 低风险无冲突知识可自动学习；修正可替代旧知识；冲突内容不静默覆盖
- PRD 可稳定生成、落盘和打开（占位门禁精修 + 最多 2 次自动修订）
- 任务可搜索、改名、归档、恢复和删除；列表内滚动与分批加载

### 今日未解决（非阻断 / 后续候选）

- 完整自主学习；模型参数学习
- 独立研究/写作产品面的统一验证
- 撤销学习的 Owner 真机补验
- 生成中归档保护的 Owner 真机补验（TASK-UX-MIN-01）
- 删除任务后成果文件保留的 Owner 真机补验（TASK-UX-MIN-01）
- 成果内容的当前实施模式对齐 → **DVL2-03-QUALITY-01**（`implementation_mode_alignment`）
- 整体 UI/UX 升级 → **UI-UX-FOUNDATION-UPGRADE**

### 四项任务最终状态

| 任务 | 状态 |
|---|---|
| LEARN-LOOP-FIX-02 | `unified_knowledge_resolution_validated` / `chat_and_task_cross_surface_application_validated` / `owner_runtime_accepted` / `accepted_as_implemented` |
| LEARN-LOOP-FIX-02.1 | `minimal_low_friction_learning_cycle_validated` / `owner_runtime_accepted` / `accepted_as_implemented` |
| DVL2-03-FIX-01 | `implemented` / `owner_runtime_accepted` / `accepted_as_implemented` |
| TASK-UX-MIN-01 | `task_management_minimal_loop_validated` / `owner_runtime_accepted` / `accepted_as_implemented` / `functional_minimum_accepted` / `visual_and_interaction_quality_deferred` |

---

## 2026-07-27 LEARN-LOOP-FIX-02 · 统一知识解析 · Owner 验收收口

### 实施摘要

- `knowledge-resolver.js` 统一入口；对话 `chat:send`、R2、成果生成、写作/PPT、研究已接入
- 学习候选 → 确认/自动采纳 → 跨面对召回 → supersession

### Owner 真机验收（2026-07-27）

已通过：对话与做事统一 Resolver；跨新对话/新任务调用；来源可见；修正 supersession；冲突需选择。

未验证：独立研究/写作产品面（不得写 `all_surfaces_validated`）。

### 状态

```text
unified_knowledge_resolution_validated /
chat_and_task_cross_surface_application_validated /
owner_runtime_accepted /
accepted_as_implemented
```

---

## 2026-07-27 LEARN-LOOP-FIX-02.1 · 低打扰自动学习 · Owner 验收收口

### 实施摘要

- `evaluateLearningAdoption()`：低风险无冲突 → `auto_adopted`；冲突/高风险 → 确认

### Owner 真机验收（2026-07-27）

已通过：自动采纳不弹确认；修正替代旧知识；冲突才确认。自动采纳不得写成 `owner_confirmed`。

非阻断回归：撤销后即时停止调用的真机补验。

### 状态

```text
minimal_low_friction_learning_cycle_validated /
owner_runtime_accepted /
accepted_as_implemented
```

---

## 2026-07-27 TASK-UX-MIN-01 · 做事任务管理最小闭环 · Owner 验收收口

### 实施摘要

- 改名、归档、恢复、软删除、搜索、固定高度列表、20 条分批加载
- 分支 `codex/task-ux-min-01-task-management`；提交 `e6ab2eb`～`9b9e051`

### Owner 真机验收（2026-07-27）

已通过：列表滚动、搜索、改名、归档、恢复、删除确认、生成中删除保护、选中回退、重启保持。

非阻断回归：删除后成果保留；生成中不能归档。

UI 质量：`functional_minimum_accepted`；整体升级债务 **UI-UX-FOUNDATION-UPGRADE**。

### 状态

```text
task_management_minimal_loop_validated /
owner_runtime_accepted /
accepted_as_implemented /
functional_minimum_accepted /
visual_and_interaction_quality_deferred
```

---

## 2026-07-27 LEARN-LOOP-FIX-01 项目知识权威闭环 · 实施完成

### 背景

`LEARN-LOOP-FORENSIC-01` 证实学习闭环对 **Digital Me 项目事实** 未通过：零任务材料、泛探索记忆误注入、情境误分类、Reviewer 缺口。

### 准确状态（修正此前过度宣称）

- **已实现**：输入记录、学习事件、接受后 enqueue、冲突提问 UI；
- **未通过（审计前）**：项目知识沉淀、跨任务权威应用、「越用越懂项目」；
- **本任务修复**：`ProjectContextSet`、`ProjectKnowledgeClaim`、权威检索、情境 `project_document_generation`、项目 Reviewer、学习候选分类。

### 测试

- `test:learn-loop-fix-01`：10 pass；
- 回归：DVL2-03、DVL2-05、CRT-MVP-02、CRT continuity、IDCOLLAB-MIN-01 全绿。

### 状态

```text
implemented / codex_verified / ready_for_owner_runtime_acceptance
```

不得 push。不得标 `project_learning_loop_validated`，待 Owner 真机回归（任务：开始起草 Digital Me 项目的开发计划）。

---

## 2026-07-27 DVL2-03-FIX-01 占位门禁精修与失败自恢复

### 背景

`DVL2-03-FAILURE-AUDIT-01` 证实 PRD 多次失败为写前占位门禁误杀（`/项目名称/`、`/占位/` 等过宽正则）+ 模型模板输出；非 Knowledge Resolver / 授权问题。

### 实施

- 结构化占位分析：区分 blocking / warning / explanatory；仅 blocking 阻止写盘
- 自动修订：最多 2 次；独立 attemptId；持久化 failureEvidence
- 用户面：自动修正提示 + 可行动失败摘要 + 高级审计详情
- 结构化文档 temperature 0.3（仅 artifact 路径）

### 测试

- `test:dvl2-03-placeholder-gate`：6 pass
- 回归：DVL2-03 generation/one-click、LEARN-LOOP-FIX-02、IDCOLLAB-MIN-01、DVL2-05 全绿

### 状态

```text
implemented / owner_runtime_accepted / accepted_as_implemented
```

Owner 真机验收：2026-07-27。正常 PRD 已生成、落盘并打开。不得 push。

---

## 2026-07-27 IDCOLLAB-MIN-01.1 · 撤销即时生效与界面极简 · 修复记录

### 背景

Owner 真机验收未通过：撤销后同进程仍可重新生成；主界面身份/授权信息过载。

1. **授权**：`prepare` 不再在 revoke 后自动 re-grant；`grantTaskAuthorization` 对同 task+planVersion 的 revoked 记录返回 `revoked_blocked`；生成/接受/学习/prepare 统一 `resolveActiveTaskAuthorization` 每次读 Store。
2. **UI**：主界面只保留一句摘要；计划高级字段与身份/授权收入折叠「更多设置 / 详情 / 高级审计」；撤销后立即禁用按钮并显示横幅。
3. **测试**：新增即时 revoke、UI 极简合同测试；回归全绿。

### 状态

```text
implemented / codex_verified / ready_for_owner_runtime_reacceptance
```

不得 push。等待 Owner 重新验收。

---

## 2026-07-27 IDCOLLAB-MIN-01 最小行动授权与参与方语义接线 · 实施完成

### 本次目标

按 Owner 已确认决策，实现单主体做事链的最小身份上下文、本地授权主表、快照锁定、revoke fail-closed，以及高级详情最小入口；不改变普通用户一次点击生成主流程。

### Owner 已确认决策（不得再上抛）

1. `representedSubjectId = Owner 本人`；
2. 独立轻量本地 `AuthorizationRecord` 主表；
3. revoke = 受控 harness + 高级详情「撤销本次授权」。

### 本次完成

1. 新增 `action-identity-schema.js` / `action-identity.js` / `authorization-store.js`；
2. 接线 Task / PlanVersion / DeliverablePackage / DeliverableVersion / Learning；
3. `planConfirmed` 时锁定身份快照并授予任务级授权；prepare 路径对缺字段旧确认计划幂等回填；
4. 生成 / 重新生成 / 接受 / 学习写回 fail-closed 校验授权；
5. preload/IPC：`actBehalf:getActionIdentity`、`actBehalf:revokeAuthorization`；
6. 高级详情展示身份摘要 +「撤销本次授权」；
7. 合同测试覆盖 A–H（含伪造 owner、revoke、legacy、重启）；
8. 回归：`test:dvl2-03-one-click` / `generation` / `dvl2-04-auto-learn` 全绿。

### 状态结论

```text
implemented / codex_verified / ready_for_owner_runtime_acceptance
```

### 重要边界

1. **不得**提前标 `owner_runtime_accepted` / `accepted_as_implemented`；
2. **不得**开启外部协作 / Collaboration Runtime / Digital Org；
3. **不得** push；
4. `CRT_RUNTIME_AUDIT_20260726.md` 未纳入提交；stash 保留。

### 待办事项

1. Owner 真机验收 IDCOLLAB-MIN-01（场景 A–H）；
2. 不得开始下一阶段身份协作功能；
3. 不得 push。

---

## 2026-07-27 IDCOLLAB-MIN-01 最小行动授权与参与方语义接线规格收口

### 本次目标

在不修改应用实现代码、不开放外部协作运行时的前提下，为现有 DVL2 做事链补齐最小主体、参与方、授权与责任语义，并形成可供 Owner 接受的实施前规格。

### 本次完成

1. 新增任务包 `digitalme_phase1_task_IDCOLLAB-MIN-01_action_identity_and_authorization_v0.1.md`；
2. 定义 `SubjectRef`、`ParticipantRef`、`ExecutorRef`、`AuthorizationRef`、`ActionIdentityContext` 与 `responsibilityBoundary`；
3. 明确与 `Task / PlanVersion / DeliverablePackage / DeliverableVersion / ArtifactRef / Learning Record / CRT` 的分工与接线；
4. 定义 legacy 兼容策略：读取时推断，强制标记 `identityContextSource=legacy_default_inference`；
5. 完成独立 Codex 复核并收敛到 v0.1.2；
6. 同步 `digitalme_context.md` 与 `digitalme_panorama_execution_index_v0.1.md`。

### 独立复核后的关键收敛

1. **不建**独立 Participant Store；
2. `AuthorizationRef` 不单独承担全部授权事实，后续实施应采用本地权威主表或同等记录；
3. `representedSubject` / `actingRole` 与 `displayName` 变化区分处理，避免不必要重确认；
4. legacy 推断不得冒充原始事实；
5. CRT 与身份/授权系统职责分开，避免重复建设。

### 状态结论

`IDCOLLAB-MIN-01` 当前状态：

```text
specified / codex_review_passed / ready_for_owner_acceptance / not_started
```

### 重要边界

1. **不得**修改应用代码；
2. **不得**开启公网协作、Digital Org、支付、A2A 远程协议运行时；
3. **不得**重做 DID / VC 基础设施；
4. **不得** push；
5. 当前未跟踪文件 `CRT_RUNTIME_AUDIT_20260726.md` 不属于本任务。

### 待办事项

1. 等待 Owner 接受并冻结 `IDCOLLAB-MIN-01`；
2. 不得 push。

---

## 2026-07-27 DVL2-03 Owner 真机验收收口

### 本次目标

验收 DVL2-03 真实交付物生成闭环：确认计划→成果包→真实文件→版本/ArtifactRef/hash→接受/否定/重新生成→重启恢复→接受后学习。

### 验收方法

1. 自动化测试 122 项全部通过（DVL2-03 generation/one-click/acceptance + CRT-MVP 全系列 + auto-learn + context-authority + act-behalf + dvl2-02）；
2. Electron 两阶段验收：Phase A（4 项成果真实落盘）+ Phase B（重启恢复 + 重新生成新版本）；
3. 代码审查：核实执行入口、文件写入、版本谱系、学习回流、CRT 接线、降级路径。

### 本次完成

1. 新增验收收口文档 `digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md`；
2. 同步 `digitalme_context.md` 文首指针、§3.2 文件表、执行指针；
3. 同步 `digitalme_panorama_execution_index_v0.1.md`；
4. DVL2-03 状态：`owner_runtime_accepted` / `accepted_as_implemented` / `implemented`。

### 重要边界

1. 图片在无外部能力时准确失败，不伪造；
2. DOCX / PPTX 未实现真实引擎；
3. `authorizationRefs` 为空（身份协作最小接线未到位）；
4. **不得** push；
5. 不开始 IDCOLLAB-MIN-01。

### 待办事项

1. 等待 CTO 下发 `IDCOLLAB-MIN-01` 规格任务；
2. 不得 push。

---

## 2026-07-27 CRT-MVP-02 系列 Owner 真机验收收口

### 本次目标

将 CRT-MVP-02 / 02.1 / 02.2 标记为 `owner_runtime_accepted`（Owner 最终冒烟通过）。

### Owner 真机冒烟结果（2026-07-27）

1. 附件变化拦截：**通过**
2. 正式成果无内部方括号标签：**通过**
3. 开放探索保留 AI 创造力且未改写为 DID/区块链平台：**通过**
4. 文本框右键菜单：**通过**

### 本次完成

1. 新增任务包 `digitalme_phase1_task_CRT-MVP-02_subject_context_engine_v0.1.md`（系列验收收口）；
2. 更新 CRT v0.2.2 规格 §12 验收状态为 CRT-MVP-02 系列 `owner_runtime_accepted`；
3. 更新 `digitalme_context.md`（文首指针、§3.2 表、决策 #108、执行指针）；
4. Judgment Candidate：以自动化 J1 + `.codex-qa/crt-mvp-02.2/acceptance.json` 为验证依据；
5. 记录非阻断观察：探索成果偶发「已有用户体系 / 现有用户社群」——后续应改为「未来用户体系 / 目标用户 / 后续种子用户」。

### 重要边界

1. **不等于**完整 Active Judgment 已实现；
2. **不**将 CRT v0.2 以外后续阶段标完成；
3. DVL2-03 仍待独立 Owner 真机验收；
4. **不得** push。

### 待办事项

1. 后续生成质量优化（探索「用户体系」措辞）可另开任务；
2. 不得 push。

---

## 2026-07-26 DVL2 接受成果 → 自动学习（事件记录已实现；项目知识应用待 LEARN-LOOP-FIX-01 验收）

### 本次目标

「接受此版本」后后台自动学习；无冲突零感知；高门槛冲突一条问题；清理 DVL2 旧 VL1 成果/学习面板。

### 本次完成

1. `deliverable-learn-store` + `deliverable-auto-learn`：extract→classify→consolidate→conflict→commit→audit；
2. `reviewDeliverableVersion(accepted)` 立即返回并异步 enqueue；失败不影响接受；幂等可重试；
3. 冲突 UI：做事页 `#act-learn-conflict`（保持原来的 / 按新的更新 / 仅本次使用）；
4. DVL2 路径隐藏 `#act-result-gen-panel` / `#act-learn-panel`；去掉「成果计划已准备，尚未开始执行」；
5. 测试：`test:dvl2-04-auto-learn` 6 pass；回归 DVL2-01/02/03/one-click；
6. 状态：仍挂在 DVL2-03 分支待 Owner 验收；**未**标 `owner_runtime_accepted`。

### 待办事项

1. Owner 真机验收接受→学习静默与冲突提问；
2. 「我」页审计/撤销 UI 可后续；
3. 不得 push。

---

## 2026-07-26 DVL2-03 一次点击生成 · UX 修复（待 Owner 再验收）

### 本次目标

Owner 真机发现多步内部流程暴露为用户操作；改为「定义成果 → 一次点击生成成果 → 使用成果」。

### 本次完成

1. 新增 `actBehalf:confirmPlanAndGenerate`：main 内串联 save/reuse → confirm → prepare/reuse package → generate；
2. 普通 UI 删除：确认成果计划 / 准备成果包 / 查看成果包准备 / 成果包已准备 / 生成此项；
3. 唯一主按钮：生成成果 / 重新生成成果 / 生成新版本 / 正在生成…；
4. 生成后操作合并为：打开成果 · 接受 · 重新生成 · 更多…；
5. 核心测试：`test:dvl2-03-one-click`；回归 DVL2-01/02/03；
6. 原则同步：引用 `digitalme_owner_cto_ai_collaboration_principles_v0.1.md` 至 context / log / cursor rule；
7. 状态仍为：`implementation_complete_pending_owner_acceptance` / `ready_for_owner_runtime_acceptance`。

### 待办事项

1. Owner 真机再验收一次点击主路径；
2. 通过后再标 `owner_runtime_accepted`；
3. 不得 push。

---

## 2026-07-26 DVL2-03 真实成果生成 · 待 Owner 真机验收

### 本次目标

压缩流程一次实现 DVL2-03：四类成果真实落盘（document / presentation / webpage / image）；停在 `ready_for_owner_runtime_acceptance`。

### 本次完成

1. 分支：`codex/dvl2-03-real-deliverable-generation`（自 `b755c06`，含 DVL2-02 runtime `ceb6c83`）；
2. 实现 commit：`7047113`（`feat(deliverables): implement real deliverable generation`）；
3. 产物目录：`<userData>/deliverable-artifacts/...`；Version / ArtifactRef / contentHash；
4. 主按钮「生成成果」；打开文件 / 目录；接受/否定绑定版本；重新生成新版本；
5. 测试：`test:dvl2-03-generation` 6 pass；`test:dvl2-03-generation-acceptance` Phase A/B pass（4 类 ready）；
6. 回归：`test:dvl2-02-package`、`test:dvl2-01-planner` 通过；
7. 状态：`implementation_complete_pending_owner_acceptance` / `ready_for_owner_runtime_acceptance`；**未**标 `implemented`。

### 重要信息

1. 自动测试使用 mock 模型与 mock 图片，不消耗付费额度；
2. 生产图片能力未配置时单项准确失败，不阻塞其他类型；
3. 未新增 npm 依赖（复用 pptxgenjs + 本地 MD→HTML + 可选 DOCX）；
4. two-phase summary：`.codex-qa/dvl2-03-generation-acceptance/two-phase-summary.json`

### 待办事项

1. Owner 真机验收（真实模型）；
2. 通过后再标 `owner_runtime_accepted` / `accepted_as_implemented`；
3. 不得 push。

---

## 2026-07-26 DVL2-03A 一页式任务包起草（待 Codex 集中评审）

### 本次目标

起草 DVL2-03A「首个真实文档成果垂直切片」；压缩规格与实施授权于同一文档；不实施；不创建实现分支。

### 本次完成

1. 新增 `digitalme_phase1_task_DVL2-03A_first_real_document_artifact_v0.1.md`（`v0.1.0-draft`）；
2. 冻结意图：document → 真实 Markdown + HTML；正式输入 `packageId`；复用 `invokeModelRoute`/`callModel`；
3. 状态保持：`spec_and_authorization_drafting` / `codex_review_pending`；`implementation_authorized=false`；
4. 同步 context / log / Cursor rule。

### 待办事项

1. Codex 一次集中评审；
2. Owner 一次同时：`owner_accepted` + `frozen_for_implementation` + `implementation_authorized`；
3. 获授权前不得编码。

### 重要信息

1. 上位：DVL2-02 runtime 收口 `ceb6c83`；实现 `20c8832`。
2. 不再单独建立 implementation authorization 文档。

---

## 2026-07-26 DVL2-02 Owner 真机验收通过 · 收口为 implemented

### 本次目标

记录 Owner 真机验收通过；将 DVL2-02 收口为 `owner_runtime_accepted` / `accepted_as_implemented` / `implemented`。不实施真实成果生成。

### 本次完成

1. 授权包状态更新为完整验收链（含 `implemented`）；
2. 明确：仅成果包与执行准备；无 Word/PPT/HTML/图片；无 Version/ArtifactRef/contentHash；
3. 同步 context / Cursor rule；下一步指向 DVL2-03A 起草（压缩流程）。

### 待办事项

1. 起草 DVL2-03A 一页式任务包；
2. Codex 一次集中评审；Owner 一次规格接受 + 实施授权；
3. 不得抢跑 DVL2-03A 实现；不得 push。

### 重要信息

1. 实现 commit 仍为 `20c8832`；证据 `866f2b2`。
2. DVL2-02 `implemented` ≠ 真实成果生成已实现。

---

## 2026-07-26 DVL2-02 实现完成 · 待 Owner 真机验收

### 本次目标

按 Owner `implementation_authorized` 完成 DVL2-02 成果包准备实现；合同测试 + 两独立 Electron 进程验收；停在 `ready_for_owner_runtime_acceptance`。

### 本次完成

1. 实现 commit：`20c8832`（`feat(act-behalf): implement DVL2-02 package preparation`）；
2. Store：`<userData>/deliverable-packages.json`；CAS + write queue；幂等 package；reconciliation；
3. IPC：`prepareDeliverablePackage` / `getDeliverablePackage` / `listDeliverablePackagesForTask`（prepare 仅 `{taskId}`）；
4. UI：「准备成果包」/「查看成果包准备」；无「开始生成成果」；无真实文件生成；
5. 测试：`npm run test:dvl2-02-package`（17 pass）；`npm run test:dvl2-02-package-acceptance`（Phase A/B pass）；
6. 回归：`test:dvl2-01-planner`、`test:act-behalf`、`test:bootstrap-submit`、`test:classic-renderer-dom` 通过；
7. 状态：曾为 `ready_for_owner_runtime_acceptance`；**本日志后一节已 Owner 真机收口**。

### 待办事项

1. ~~Owner 真机验收 DVL2-02；~~（已完成）
2. ~~通过后方可标 `owner_runtime_accepted` / `accepted_as_implemented`；~~（已完成）
3. 不得启动 DVL2-03 全量；不得 push。

### 重要信息

1. two-phase summary：`.codex-qa/dvl2-02-package-acceptance/two-phase-summary.json`
2. 无真实模型、无付费额度、无 DeliverableVersion / ArtifactRef / contentHash、无禁止路径变化。

---

## 2026-07-26 DVL2-02 Owner 实施授权 · 开始实现

### 本次目标

记录 Owner 授予 `implementation_authorized`；在分支 `codex/dvl2-02-deliverable-package-preparation`（起点 `ad3b6ee`）按冻结规格实现。不得 push。

### 本次完成

1. 创建实现分支并 cherry-pick 授权包提交；
2. 授权包 → `owner_implementation_authorized`；`implementation_authorized=true`；实施 `implementation_in_progress`；
3. 最小同步 context / log / Cursor rule。

### 待办事项

1. ~~完成实现、合同测试与两阶段 Electron 验收；~~（已完成，见上节）
2. 停在 `ready_for_owner_runtime_acceptance`；等待 Owner 真机验收。

### 重要信息

1. **不得** push；**不得**扩大到 DVL2-03；**不得**生成真实成果。
2. 实现提交与 Owner runtime acceptance 分离。

---

## 2026-07-26 DVL2-02 implementation authorization · Codex 最终复核通过

### 本次目标

聚焦复核 DVL2-02 实施授权包五门禁与两项补充合同；同轮补齐文档级实施要求；标记 Codex 授权复核通过。不进入实现；不 push。

### 本次完成

1. 五 Gate + Attempt/IPC 补充合同核验：无 Blocker；
2. 同轮补齐：`expectedRevision`、`degraded_consistency`、IPC main 权威清单、Electron 无真实模型/无付费、不完整 attempt 不得显示成功；
3. 授权包 → **v0.1.0** / `authorization_specified` / `codex_review_passed` / `ready_for_owner_implementation_authorization`；
4. 实施仍 `not_started`；`implementation_authorized=false`；冻结实施授权基线 `0a52606`；
5. 最小同步 context / log / Cursor rule。

### 待办事项

1. 等待 Owner 授予 `implementation_authorized`；
2. 获授权前不得创建实现分支、不得编码。

### 重要信息

1. **未修改 `digitalme-app/**`**、未改 DVL2-02 冻结合同正文。
2. **未创建实现分支**。
3. **不 push**。

---

## 2026-07-26 DVL2-02 implementation authorization 草案起草

### 本次目标

起草 DVL2-02 实施授权包，供 Owner / Codex 审查实现范围、分支、文件、测试与验收。不是实施授权；不创建实现分支；不编码；不 push。

### 本次完成

1. 新建 `digitalme_phase1_task_DVL2-02_implementation_authorization_v0.1.md`（v0.1.0-draft；`authorization_drafting` / `codex_review_pending`；`implementation_authorized=false`）；
2. 推荐实现分支 `codex/dvl2-02-deliverable-package-preparation`，起点 `ad3b6ee`；
3. 明确允许/禁止文件、Store/CAS/reconciliation/Attempt 矩阵、IPC、UI、两阶段 Electron 与 Owner 真机路径、停止条件；
4. 最小同步 context / log / Cursor rule；DVL2-02 冻结规格仅增加非合同索引。

### 待办事项

1. Codex / Owner 审查授权草案；
2. 获 `implementation_authorized` 前不得建分支、不得改 `digitalme-app/**`。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. **未创建实现分支**。
3. **不 push**。

---

## 2026-07-26 DVL2-02 Owner 规格接受与冻结 · v0.1.1

### 本次目标

Owner 接受 DVL2-02 规格并冻结为 v0.1.1；进入 implementation_authorization 前的实施准备。纯文档提交。不修改实现；不标实施授权；不 push。

### 本次完成

1. DVL2-02 → **v0.1.1** / `specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation`；
2. 实施仍 `not_started`；`implementation_authorized=false`；规格冻结基线 `578648f31d86594cc2bd56ede2e367122cfa98f8`；
3. 写入 Owner 接受范围 / 不代表范围、冻结合同摘要、implementation_authorization 门禁；
4. 最小同步 context / log / Cursor rule；
5. DVL2-01 继续已收口；DVL2-03 仍 `not_started` / `not_authorized`。

### 待办事项

1. 另行完成 implementation_authorization 评审（分支方案、允许/禁止文件、测试矩阵、Owner 验收路径等）；
2. 获授权前不得修改 `digitalme-app/**`。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. **未标** `implementation_authorized` / `implementation_in_progress` / `implemented`。
3. **不 push**。

---

## 2026-07-26 DVL2-02 Codex 规格复核通过 · 等待 Owner 规格接受

### 本次目标

将 DVL2-02 第一轮修订收口为 Codex 规格复核通过；纯文档提交。不修改实现；不创建实现分支；不 push。

### 本次完成

1. DVL2-02 → `spec_drafting` / `codex_review_passed` / `ready_for_owner_spec_acceptance`；实施 `not_started`；`implementation_authorized=false`；
2. 修订记录追加 Codex final review 结论；保留第一轮曾为 `codex_review_changes_requested` 的事实；
3. 追加 `PackagePreparationAttempt` 实现期一致性测试要求（非新领域范围）；
4. 最小同步 context / log / Cursor rule；
5. DVL2-01 继续已收口；DVL2-03 仍 `not_started` / `not_authorized`。

### 待办事项

1. 等待 Owner 规格接受；
2. 接受并冻结后另批实施授权；获授权前禁止编码。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. **未标** `owner_accepted` / `frozen_for_implementation` / `implementation_authorized`。
3. **不 push**。

---

## 2026-07-26 DVL2-02 规格第一轮文档修订 · codex_review_changes_requested

### 本次目标

按 Codex 第一轮复核意见修订 DVL2-02 规格草案；最小同步规划索引。不修改实现；不 commit；不 push。

### 本次完成

1. 删除 placeholder / metadata-only `DeliverableVersion`；DVL2-02 仅创建 Package + Deliverable；`currentVersionId = null`；
2. 明确 `PackagePreparationAttempt` 边界；generation attempt 归属 DVL2-03；
3. `activePackageId` 迁入 `Task.deliverableExecution` 并冻结不变量；
4. 补齐 archived / soft_deleted / degraded 幂等；拆分 `ExecutionSnapshot` 与 `CurrentPreparationReadiness`；
5. 旧执行入口默认隐藏；DVL2-03 唯一正式输入改为 `packageId`；
6. 状态 → `spec_drafting` / `codex_review_changes_requested`；实施仍 `not_started`。

### 待办事项

1. Codex 再复核关闭 `changes_requested`；
2. Owner 接受后方可冻结；另批实施授权前禁止编码。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. **未 commit、未 push**。

---

## 2026-07-26 DVL2-02 成果包与执行准备 · 规格起草

### 本次目标

在基线 `690e1fc` 上起草 DVL2-02 任务包草案；只读审计代码与上位合同；最小同步规划索引；纯文档提交。不修改实现；不创建实现分支；不 push。

### 本次完成

1. 新建 `digitalme_phase1_task_DVL2-02_deliverable_package_and_execution_preparation_v0.1.md`（v0.1.0-draft；`spec_drafting` / `codex_review_pending`；实施 `not_started`）；
2. 明确：真实创建 DeliverablePackage、幂等准备、`activePackageId`、与主体 `package-store` 隔离、Attempt 引入、状态对齐 DVL2-00（不以 `blocked` 污染包枚举）；
3. 落实执行入口「准备成果包」与减负默认层；
4. 最小同步 context / log / Cursor rule。

### 待办事项

1. Codex 复核 DVL2-02 草案；
2. Owner 接受或改判 §14 推荐后，方可冻结与另批实施授权；
3. 获授权前禁止编码与真实生成。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. DVL2-01 状态不变。
3. **不 push**。

---

## 2026-07-26 DVL2-01 Owner 真机验收收口

### 本次目标

将 DVL2-01 Owner 真机验收结论写入权威文档并独立提交；不修改实现；不启动 DVL2-02；不 push。

### 本次完成

1. DVL2-01 → `owner_runtime_accepted` / `accepted_as_implemented`；实施 `implemented`；
2. 实现基线固定为 `6e7c38401466c08660890080e763430bf1f3a44d`；
3. 明确 `implemented` 仅覆盖成果规划器，不含真实成果生成 / 成果包交付 / 按计划执行；
4. 写入 Owner 验收记录与两项非阻断 P1（执行入口衔接、计划确认减负 / 渐进披露 / 默认接受）；
5. 最小同步 context / log / Cursor rule；DVL2-02 仍为 `not_started` / `not_authorized`。

### 待办事项

1. 等待 DVL2-02 任务起草与独立实施授权；
2. 后续阶段处理 P1：执行入口须绑定 `activeConfirmedVersionId`；计划确认减负；
3. 不得把「开始」旧链路误解为已按确认计划执行。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。
3. **不 push**。

---

## 2026-07-26 DVL2-01 CTO 最终实现复核通过 · 待 Owner 真机验收提交

### 本次目标

同步 DVL2-01 实现复核状态；完成最终自动验证；创建待 Owner 真机验收的实现提交。不 push；不标 implemented / completed。

### 本次完成

1. DVL2-01 → `codex_review_passed` / `ready_for_owner_runtime_acceptance`；实施仍为 `implementation_in_progress`；
2. 两轮集中修复与 CTO 最终实现复核记录已写入任务包；
3. 最小同步 context / log / Cursor rule；
4. 最终验证：`test:dvl2-01-planner`、两阶段 Electron 验收；
5. 创建实现提交（待本条之后的 commit）；**不 push**。

### 待办事项

1. Owner 真机验收 DVL2-01；
2. 验收前不得标 `implemented` / `completed` / `owner_verified` / `accepted_as_implemented`；
3. 不得启动 DVL2-02；不得生成真实成果文件。

### 重要信息

1. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。
2. DVL2-02 **未开始**。
3. **不 push**。

---

## 2026-07-26 DVL2-01 Owner 接受与规格冻结

### 本次目标

Owner 正式接受 DVL2-01 v0.1.1；将规格冻结为成果规划器实施合同；独立提交；不开始实现。

### 本次完成

1. Owner 接受 DVL2-01；
2. CTO 四轮规格复核完成；
3. 任务、计划、版本、readiness、双存储一致性和删除语义已冻结；
4. DVL2-01 → **v0.1.1** / `specified` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation` / `not_started`；
5. 本轮无代码修改；尚未授权实现；DVL2-02 未启动。

### 待办事项

1. 等待 DVL2-01 implementation authorization；
2. 授权前不得修改 `digitalme-app/**`；
3. 不得提前生成真实成果或实施 DVL2-02。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. 接受与冻结 **不等于** `implementation_authorized`。
3. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。
4. **不 push**。

---

## 2026-07-26 DVL2-01 CTO 最终技术复核通过 · 等待 Owner 接受

### 本次目标

仅状态收口：记录 CTO 最终技术复核通过，等待 Owner 接受。不改产品/数据合同、实现边界或代码映射正文。

### 本次完成

1. DVL2-01 → **v0.1.1** / `specified` / `codex_review_passed` / `ready_for_owner_acceptance` / `not_started`；
2. 修订记录整理三轮复核摘要与最终结论；
3. 同步 context / log / Cursor rule：已复核通过、等待 Owner 接受；仍为纯规格；不得开始编码；DVL2-02 未开始。

### 待办事项

1. Owner 接受 DVL2-01；
2. 接受前不得 `owner_accepted` / `frozen_for_implementation` / `implementation_authorized`；
3. 不得开始 DVL2-01 实现或 DVL2-02。

### 重要信息

1. **未修改合同正文与 `digitalme-app/**`**。
2. **不提交**；先返回状态收口报告。
3. DVL2-00 继续 `frozen`；R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。

---

## 2026-07-26 DVL2-01 第四轮最终最小修订（codex_changes_requested）

### 本次目标

关闭 Task Store / Plan Store 跨存储一致性与 archive/soft-delete/purge 语义；补齐完整候选路径。不编码、不提交。

### 本次完成

1. 冻结两文件确定性提交顺序、失败矩阵、reconciliation、指针不变量与 fail-closed；
2. 区分 archive / soft delete / permanent purge；废除「删除即一并物理清理」笼统写法；
3. 标明现有 `deleteTask` 为物理删除依赖与有界处理；
4. 候选新增/修改/测试文件改为完整仓库相对路径；
5. 最小同步 context / log / Cursor rule。

### 待办事项

1. 继续 Codex 复核；
2. 不得冻结实施或授权编码；
3. 不得开始实现。

### 重要信息

1. **未修改 `digitalme-app/**` 与 DVL2-00**。
2. **不提交**。
3. 状态仍为 `codex_changes_requested` / `not_started`。

---

## 2026-07-26 DVL2-01 第三轮最小修订（codex_changes_requested）

### 本次目标

关闭 Task/Plan 所有权、goal 同步、能力快照与当前 readiness、legacy 有界策略、规划隐私与精确实施清单。不编码、不提交。

### 本次完成

1. 冻结 ActBehalfTask 为任务权威；DeliverablePlan 为 task 下版本化对象；
2. 冻结 task goal / understanding goal 同步矩阵；
3. 拆分 PlanningAvailabilitySnapshot 与 CurrentExecutionReadiness；
4. 冻结 legacy 有界实施与精确候选文件路径；
5. 冻结规划调用隐私边界；
6. 明确 DVL2-02 必须从 confirmed plan version 创建 DeliverablePackage；
7. 最小同步 context / log / Cursor rule。

### 待办事项

1. 继续 Codex 复核；
2. 不得冻结实施或授权编码；
3. 不得开始实现。

### 重要信息

1. **未修改 `digitalme-app/**` 与 DVL2-00**。
2. **不提交**。
3. 状态仍为 `codex_changes_requested` / `not_started`。

---

## 2026-07-26 DVL2-01 第二轮有界修订（codex_changes_requested）

### 本次目标

按 CTO 第二轮意见修订 DVL2-01 草案：拆分合同支持与运行可用性、冻结 PlanRecord/Version、澄清规划模型边界、增加 readiness/图校验/确认矩阵，并完成只读代码映射。不编码、不提交。

### 本次完成

1. 状态 → `v0.1-draft` / `specified` / `codex_changes_requested` / `not_started`；
2. 废除单一 `implementationAvailability=supported_now` 用法；
3. 冻结 PlanRecord 指针与 v1/v2 确认语义；
4. 明确 model-assisted planning ≠ 成果生成；
5. 增加 executionReadiness、依赖图校验、确认规则矩阵；
6. 写入 digitalme-app 只读代码映射与候选文件清单；
7. 最小同步 context / log / Cursor rule。

### 待办事项

1. 继续 Codex 复核；
2. 不得标 `frozen_for_implementation` / `implementation_authorized`；
3. 不得开始编码。

### 重要信息

1. **未修改 `digitalme-app/**` 与 DVL2-00**。
2. **不提交**。
3. 当前基线四类合同内产物 = `in_current_product_scope` + `unavailable`。

---

## 2026-07-26 DVL2-01 成果规划器实施任务包起草

### 本次目标

起草 DVL2-01 成果规划器实施规格草案，供 Codex 复核；不开始实现。

### 本次完成

1. 新建 [`digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md`](digitalme_phase1_task_DVL2-01_deliverable_planner_v0.1.md)；
2. 状态：`v0.1-draft` / `specified` / `codex_review_pending` / `not_started`；
3. 覆盖输入/输出合同、PlannedDeliverable、PlanStatus、追问、自动规划规则、持久化、UI、降级、验收与测试；
4. 最小同步 context / log / Cursor rule；
5. 本轮无代码修改；未授权实施。

### 待办事项

1. Codex 复核 DVL2-01 草案；
2. 复核通过前不得标 `frozen_for_implementation` / `implementation_authorized`；
3. 不得创建实现分支或开始编码。

### 重要信息

1. **未修改 `digitalme-app/**`**。
2. **不提交**；先返回 CTO 复核材料。
3. 上位合同 DVL2-00 v0.1.1 保持冻结，未改合同正文。
4. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。

---

## 2026-07-26 DVL2-00 Owner 接受与规格冻结

### 本次目标

Owner 正式接受 DVL2-00 v0.1.1；将规格冻结为 DVL2-01～05 的实施合同；独立提交；不开始 DVL2-01。

### 本次完成

1. Owner 接受四项产品裁决（C+A、七模块、对外介绍成果包、文档/PPT/HTML/图片）；
2. CTO 三轮合同复核通过；
3. DVL2-00 → **v0.1.1** / `specified` / `owner_decisions_recorded` / `codex_review_passed` / `owner_accepted` / `frozen_for_implementation` / `not_started`；
4. 同步 context / log / Cursor rule：合同已冻结；下一步仅起草 DVL2-01 任务包；
5. 本轮无代码修改；未授权 DVL2-01 实现。

### 待办事项

1. 起草 DVL2-01 成果规划器实施任务包（纯文档）；
2. DVL2-01 须另经 Codex 复核与 Owner 实施授权后，方可编码；
3. 不得新建实现分支或开始 DVL2-01～05 编码。

### 重要信息

1. **未修改 `digitalme-app/**` 与任何源码**。
2. 本次接受 **不等于** 授权整体 DVL2-01～05 编码；**不得**标 `implementation_authorized`。
3. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。
4. **不 push**。

---

## 2026-07-26 DVL2-00 CTO 最终技术复核通过 · 等待 Owner 接受

### 本次目标

仅状态收口：记录 CTO 最终技术复核通过，等待 Owner 接受。不改产品/数据合同正文。

### 本次完成

1. DVL2-00 → **v0.1.1** / `specified` / `owner_decisions_recorded` / `codex_review_passed` / `ready_for_owner_acceptance` / `not_started`；
2. 修订记录补齐 R1/R2/R3 与最终结论；
3. 同步 context / log / Cursor rule：已复核通过、等待 Owner 接受；DVL2-01 未创建、未授权；仍为纯文档。

### 待办事项

1. Owner 接受 DVL2-00；
2. 接受前不得 `frozen_for_implementation` / `accepted` / `implementation_authorized`；
3. 不得创建或开始 DVL2-01。

### 重要信息

1. **未修改合同正文与 `digitalme-app/**`**。
2. **不提交**；先返回 diff 摘要。
3. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。

---

## 2026-07-26 DVL2-00 第三轮最小合同修订（codex_changes_requested）

### 本次目标

关闭 CTO 第三轮五项合同歧义；保持草案状态，不标冻结/接受。

### 本次完成

1. 成果包拆分 `lifecycleStatus` × `completionStatus` 及确定性派生表；
2. 四层身份正式命名并禁止裸 `Package` 指成果包；
3. 单项拆分 `planDisposition` × `generationStatus` × `reviewStatus`；
4. 冻结 `currentVersionId` 不变量与外部文件变化规则；
5. context / Cursor rule 状态已正确，本轮未改。

### 重要信息

1. **纯文档，未修改 `digitalme-app/**`**；未创建 DVL2-01。
2. 状态仍：`v0.1-draft` / `specified` / `owner_decisions_recorded` / `codex_changes_requested` / `not_started`。
3. **不提交**；等待 CTO 最终复核。

---

## 2026-07-26 DVL2-00 第二轮有界修订（codex_changes_requested）

### 本次目标

1. 按 CTO 第二轮意见关闭 14 项合同歧义；
2. 保持 DVL2-00 为草案，不得标冻结/接受/实现授权。

### 本次完成

1. 修订 `digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`：状态 → `codex_changes_requested`；
2. 关闭：单项 partially_ready 默认删除、取消/中断/迟到结果、整体派生优先级、计划确认≠风险授权、ArtifactRef、四层身份、provenance 最小字段、七模块主归属、SubjectCandidate、四类最低门槛、材料不自动入主体、默认私有、图片失败隔离、DVL2-01 只读可用性；
3. 同步 context / log / Cursor rule 状态指针（仍为草案）。

### 待办事项

1. CTO 再复核；
2. 通过前不得 `frozen_for_implementation` / `accepted` / `implementation_authorized`；
3. 不得创建 DVL2-01 或编码。

### 重要信息

1. **纯文档，未修改 `digitalme-app/**`**。
2. 旧第一纵向闭环计划仍 `completed` / `superseded`。
3. **不提交**；等待 CTO 复核。

---

## 2026-07-26 DVL2-00 产品与数据合同规格起草

### 本次目标

1. 将 Owner 已批准的 BUG1 #4 / #6 四项正式裁决写入权威文档；
2. 起草第二纵向闭环 DVL2-00 产品与数据合同规格草案；
3. 同步执行指针：当前下一任务 = DVL2-00 规格起草（仍待 CTO 复核）。

### 本次完成

1. Owner 四项裁决入库（决策 #107）：
   - #4 = C + A（自动规划 + 用户轻量修正；不采用 B）；
   - #6 = 七模块渐进式构建；
   - 首验场景 = 项目对外介绍成果包；
   - 第一轮真实产物 = 文档 / PPT / HTML / 封面图（视频音频本轮不实现）。
2. 新建 `digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`（`v0.1-draft` / `specified` / 初稿曾为 `codex_review_pending` / `not_started`；已被第二轮修订为 `codex_changes_requested`）；
3. 更新 `digitalme_context.md` 文首与决策索引；第一纵向执行计划标 `completed` / `superseded_as_current_execution_plan`；
4. 最小更新 Cursor rule 当前任务指针。

### 待办事项

1. CTO 复核 DVL2-00 草案（见上方第二轮修订条目）；
2. Owner 接受后，方可讨论是否标 `frozen_for_implementation` 并另立 DVL2-01；
3. **在此之前不得编码、不得创建 DVL2-01 实现。**

### 重要信息

1. **本轮纯文档，未修改任何运行代码**（含 `digitalme-app/**`）。
2. DVL2-00 **尚未** `accepted` / `implementation_authorized`。
3. R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`。
4. **不直接提交**；等待 CTO 复核后再决定是否提交。
5. **不 push**。

---

## 2026-07-26 BASELINE-CLEAN-01 仓库卫生与权威状态同步

### 本次目标

1. 在不修改任何运行代码的前提下，完成仓库基线卫生与权威文档状态同步；
2. 防止新会话把已完成的第一纵向闭环误判为待实施任务。

### 本次完成

1. 当前 HEAD 基线确认为 `9d4f943`（本清理提交之前）；历史 QA、handoff、zip、bundle、patch 等已移出或经 `.gitignore` 忽略；
2. `.gitignore` 收口：忽略各层 `.codex-qa/`、`outputs/`、测试账户/凭据交换/邀请临时数据、根目录生成的 patch/bundle/zip/stat/status/test log/diff/控制台输出，以及一次性脚本 `digitalme-app/scripts/verify-vl1-fix-no-user-supplement.cjs`；
3. `参考/`、`运营/` 仅通过 `.git/info/exclude` 本地排除，**不写入** `.gitignore`；
4. VL1-FIX 任务包入库并升至 `accepted` / v0.2.0（实现 `928aa1a`；文档收口 `e8b6572`）；身份协作评审入库为 `accepted_as_planning_input`；
5. `digitalme_context.md` 文首与执行指针同步：第一纵向闭环 = `accepted` / `completed`；BUG1-FIX 八项技术修 = `accepted`；当前唯一产品待决 = BUG1 #4 / #6；
6. **未修改**任何运行代码（含 `digitalme-app/**` 源码）。

### 待办事项

1. Owner/CTO 对 BUG1 #4（多模态成果与 95 分位交付；候选 A/B/C 未冻结）与 BUG1 #6（渐进式构建框架）作产品裁决。

### 重要信息

1. **不增加新的产品决策编号**；本条仅为仓库卫生与权威状态同步。
2. R3 继续 `paused`；R2.5 继续 `deferred`；PAN-02 继续 `blocked`。
3. **不 push**。

---

## 2026-07-26（BUG1-FIX 任务包入库 + #4 #6 研究 + #4 多模态方向）

### 本次目标

1. 任务包现场抽检 + 入库（完成 BUG1-FIX 全部闭环）；
2. 研究 BUG1 #4（做事流程到 95 分位产出物）和 #6（构建框架 7 模块）的同类产品最佳实践 + 标准产品设计规则；
3. Owner 重新定义 #4 范围（多模态产物），给方案候选。

### 本次完成

1. 任务包现场抽检：8 条技术修（#1/#2/#3/#5/#7/#8/#9/#10）Owner 已走通真机验证（截图、acceptance.json 齐备，目录 `.codex-qa/bug1-fix/`），回归矩阵 5 套全过：
   - `test:owner-runtime` 5/5
   - `test:visual-acceptance` 7 组合 + 长回复折叠展开重开全 PASS
   - `test:doing-context-acceptance` PASS
   - `test:pan-01s-owner-runtime` 9/9
   - `test:vl1-block1` 18/18
2. 任务包入库：Mavis 代办 commit `52e16ab docs(plan): mark BUG1-FIX 任务包 accepted after spotcheck`，1 文件 184 行（新建），零冲突。任务包 v0.2.0，状态由 `implemented_pending_owner_spotcheck` 升至 `accepted`。
3. #4 / #6 研究：
   - 搜索 6+ 篇竞品资料（ChatGPT、Claude Opus、Writers Studio、PARA、PKM、Zettelkasten、GTD、AI Agent task delivery、Phoenix QA 等）；
   - #4 给三方案：草稿到发布流 / 任务交付流 / 可追问交付流；推荐 A + C 混合；
   - #6 给三方案：PARA 变体 / PKM 完整版 / 渐进式构建；推荐 C（与 PAN-01S.1 B0-B5 思路一致）。
4. Owner 重新定义 #4：明确「做事」不只文字，要覆盖文字 / 图 / 视频 / 音频 / 代码 / 网页 / 数据等多模态产物。设计原则沿用决策 #37（不自研，对接业界最好）+ #28（校准不限制）+ §7.8（能力可装可卸、密钥只在 main）。重新给三候选：A「做事页加产物类型选择」/ B「新增创作入口」/ C「场景自动分流」；**待 Owner 拍板**。

### 待办事项

1. Owner 选定 #4 候选方案（A / B / C）；
2. Mavis 出"#4-多模态-产物类型选择 任务包 v0.1"（或对应 B/C 方案的任务包），转给 Cursor/Codex 实施；
3. #6 候选 C 同样起草任务包（渐进式构建 7 模块）；
4. 两条新任务包实施 + 验收 + 文档同步。

### 重要信息

1. **第一段正式收口已完成**（决策 #103 + commit `e8b6572`）。
2. **BUG1 八条技术修已 committed**（决策 #104 + commit `9e498a3` … `940f5fa` + docs `a5f77a7`）。
3. **任务包已入库**（决策 #105 + commit `52e16ab`）。
4. **#4 多模态方向已记录**（决策 #106，待 Owner 拍板方案）。
5. **R3 / R2.5 / PAN-02 仍 `paused` / `deferred` / `blocked`**，不动。
6. **不 push 远端**（Owner 已确认无远端，本机 commit 即可）。

---

## 2026-07-25（BUG1-FIX · D 盘 e8b6572 重做）

### 本次目标

1. 在 D 盘 e8b6572 基线上从头重做 BUG1 技术修（弃用云盘 working copy）；
2. 按 P0→P1 分 commit 落地并跑真实 Electron 验收；
3. 同步决策 #104 与日志。

### 本次完成

1. P0：布局 stamp 入侧栏（`9e498a3`）、折叠高度（`d503e91`）、送到做事+成果闭环（`3abf3a3`）；
2. P1：「我」主 tab（`cc8315b`/`a02dfa1`）、身份独立侧栏（`88389fe`）、能力四类（`8c49bfd`）、设置四类（`81f7e54`）、按任务分工路由 UI（`940f5fa`）；
3. 验收产物：`.codex-qa/bug1-fix/p0-*` 与 `p1-*`；#4/#6 跳过。

### 待办事项

1. Owner 真机 spot-check BUG1 列表项；
2. #4（95 分位产出）/#6（构建框架）另起任务包；
3. 不 push 远端。

### 重要信息

1. 云盘 BUG1 产物弃用；以 D 盘 commits 为准。

---

## 2026-07-25（第一段正式收口 · VL1-FIX 真机验收）

### 本次目标

1. 验证 VL1-FIX 修复（`result-generation.js` 三个 prompt 校准 vs 限制）实际生效；
2. 收口第一纵向闭环主线。

### 本次完成

1. Owner 真机任务「评估 AI 主权协作的当前主流产品图景」07:56 result_saved，VL1-FIX 真机验收通过：
   - 成果末段不再出现「由于本人信息中未提供…需要用户自行补充」
   - 模型用 AI 通用能力答出具体产品名（PersonalAI / LocalAI / OpenDiamond / SingularityNET / Ocean Protocol / 欧盟 AI 公地 / 中国数据要素 X）
   - 本人事实（「基于你的治理观念」）与通用知识显式区分
   - 残留的「建议搜 2025-2026 年真实项目替换」是模型对自身输出留的不确定性标记（`uncertainty ≥ medium` 当无引用时），不是 prompt 限制，属合理校准
2. context.md 决策 #103 + §3 第 28 条起草（第一段正式收口）。
3. 任务包 `digitalme_phase1_task_VL1-FIX_calibrate_not_limit_prompts_v0.1.md` 实施闭环：起草 → Cursor/Codex 实现 → 自动化 11/11 → 真机验收。

### 待办事项

1. Cursor/Codex 提交 `fix(vl1): calibrate-not-limit generation prompts` commit 固化（6 文件改动：1 源码 + 1 测试 + 1 配置 + 4 文档）；
2. commit 后第一段基线 = `2f1b7bd` + 待 commit；
3. 第二条纵向闭环规划（待 Owner 决定方向）。

### 重要信息

1. **第一段正式收口**：校准 vs 限制原则落地，AI 不再被蒸馏结果限制。
2. **R3 / R2.5 / PAN-02 仍 `paused` / `planned` / `blocked`**，不动。
3. **不 push 远端**——本地 commit 即可（Owner 已确认无远端）。

---

## 2026-07-25（VL1-FIX · 校准 vs 限制 prompt 实现）

### 本次目标

1. 处理 Owner 真机「用户需要补料」触线；
2. 把生成 prompt 从「限制」改写为「校准」；
3. 把「校准 vs 限制」原则写入规格与决策 log。

### 本次完成

1. 重写 `result-generation.js` 研究 / 邮件 / 视频音频三个 system prompt：AI 通用能力为上限；数字之我仅提供方向/真实性/风格/价值观/安全/边界校准；缺原料用通用知识答、不限制输出、不让用户补料；
2. 导出 `PROMPT_TEMPLATES`（internal test-only）；新增 `scripts/test-vl1-prompt-calibration.cjs` + `npm run test:vl1-prompt-calibration`；
3. 规格 → v0.1.1（§3.4）；sprint plan → v0.1.11（任务 #10）；context 决策 #102 + §3 第 27 条；任务包 VL1-FIX。

### 待办事项

1. Owner 真机重跑研究类任务（如「评估 AI 主权协作的当前主流产品图景」）确认无「用户需要补料」；
2. 可并行复验真机验收第 4 步（候选单条删除粒度）；
3. VL1-FIX 真机通过前，第一纵向闭环不得标 `accepted`。

### 重要信息

1. **VL1-FIX 真机确认前，第一纵向闭环不能标 accepted**。
2. 产物 JSON 字段未变；未改外搜 / distill-me / UI。

---

## 2026-07-24 committed baseline 2f1b7bd · accepted / committed

### 基线提交

- **HEAD**：`2f1b7bd feat(distill-me): wire confirmed identity into act context`
- **previous**：`248189d feat(r2): add recoverable dialogue retry acceptance`
- **push**：not_done
- **范围**：83 个文件，+16,427/-487 行

### 已接受状态

| 项 | 状态 |
|---|---|
| Owner Electron 真机验收 | accepted |
| distill-me 产品功能 | accepted |
| confirmed identity → act context | accepted |
| PAN-01S | accepted |
| P1 doing-context | accepted |
| R0 / R1 / R2 | accepted（R2 retained as infrastructure） |
| distill-me-acceptance | 11/11 全绿 |
| dependency closure | confirmed |

### 提交闭包内容

- `src/doing-context.js`：`assembleDoingContext` 读取 `distill-me-identity-facts.json`，过滤 `confirmed` + `edited` 状态，保留 `confirmedAt`/`sourceRefs`/`evidenceRefs`/`version`
- `scripts/distill-me-acceptance-harness.cjs`：第 217 行 predicate 修复为箭头函数；`confirmed-content-enters-act-context` 从硬编码抛错替换为真实 `assembleDoingContext` 验证
- `scripts/test-pan-01s-minimal-surface.cjs`：2 处过期断言修复（panorama experience 下线后契约同步）
- 全部新增源码：`distill-me.js`、`identity/`（5 文件）、`collaboration/`（2 文件）、`cli/`（4 文件）、`mcp-server/`（2 文件）、`editor-extension/`（8 文件）、`model-routing.js`、`subject-overview/credentials.js`
- 已跟踪修改：`main.js`（IPC handlers）、`preload.js`（API surface）、`renderer/app.js`（UI）、`package.json`（测试脚本）、`act-behalf/*`（5 文件）、`security/config-secrets.js`、`subject-overview/constants.js`
- 全部测试脚本（26 个 `.cjs` 文件）及相关规划文档（14 个 `.md` 文件）

### 已排除

非源码交接件（`.zip`/`.bundle`/`.txt` 产物）、`.codex-qa/` 截图目录、`outputs/`、`dm-account-b/`、`cred-export.json`、`invite.json`、根目录临时文件

### 回归测试

- `test:distill-me-acceptance` 11/11
- `test:distill-me` 1/1
- `test:doing-context-acceptance` 1/1
- `test:pan-01s-owner-runtime` 9/9
- `test:pan-01s` 23/23
- `test:gate4-auto-flow` 49/49
- `test:vl1-block1` 18/18

### 状态

- R3：`paused`
- PAN-02：`planned / blocked`
- 生产默认入口：legacy
- 未 push

---

## 2026-07-23 能力上限与下限原则纠正

### Owner 反馈

Owner 明确纠正此前将“像我”与通用能力收缩绑定的判断：Digital Me 不应因为用户蒸馏结果而限制大模型能力。

### 正式产品原则

- Digital Me 的能力上限 = 所接入大模型的能力上限；
- Digital Me 的能力下限 = 所接入大模型的能力下限；
- 如果加入 Digital Me 后通用任务表现变弱，应视为设计、编排、检索、复核或工具链缺陷；
- 个人蒸馏结果是主体性增强层，不是能力阉割层；
- 两种使用方式均须支持：生成前将价值观、经验、风格和边界叠加进任务；生成后对大模型结果按上述维度校对后再输出；
- “像我”负责方向、真实性、边界、连续性和本人特征；AI 负责完整通用能力。

### 同步文件

- `digitalme_subject_architecture_and_rd_principles_v0.1.md` §3.1
- `digitalme_product_spec_v0.2.md` §2.0.1
- `DigitalMe_doing_product_logic_v0.2_2026-07-22.md` §1.1
- `digitalme_context.md` 决策 #26

---

## 2026-07-22 跨账户协作验证通过

### 凭据跨账户交换

- `src/identity/credential-exchange.js` — 凭据导出/导入，导出文件包含签发者完整公钥，导入方用文件中的公钥验证签名（不依赖本地身份）
- 账户 A 导出 `cred_mrw12gin_66ucte` → 账户 B 导入并验证签名通过，issuer 正确显示账户 A 的 DID
- 已撤销凭据拒绝导出，过期凭据导入标记无效
- 测试：34 passed

### 协作跨账户交换

- `src/collaboration/exchange.js` — 协作邀请/接受/更新同步，邀请文件包含 from 的 DID 和公钥，更新按时间戳幂等合并，状态只向前流转
- 账户 A 导出邀请 → 账户 B 接受（状态 `accepted`）→ 双向更新同步（A→B、B→A）
- 测试：39 passed

### 全部测试结果

**23 套测试 496 断言 0 失败**。

---

### 开发计划

基于 v0.2 身份与协作规划，制定 `DigitalMe_identity_collaboration_dev_plan_v0.1_2026-07-22.md`，按 P0 → P1 → P2 顺序实施。

### ID-01：身份标识生成与展示

- `src/identity/index.js` — Ed25519 密钥生成、DID 派生、identity.json 持久化、签名/验证
- "我"中显示身份标识，可复制，随 Package 持久化
- 测试：9 passed

### ID-02：角色身份管理

- `src/identity/role-view.js` — 角色选择、角色视图配置、角色切换，数据持久化到 role-view.json
- 默认角色：创始人/投资人/写作者/研究者
- 测试：30 passed

### ID-03：凭据升级为 VC 格式

- `src/identity/vc.js` — W3C VC 2.0 格式 + Ed25519 签名，本地验证，过期自动失效
- 测试：30 passed

### ID-04：凭据出示流程

- `src/identity/credential-flow.js` — 凭据生成/出示/撤销/审计日志，数据持久化到 credentials.json
- 测试：39 passed

### ID-05：主体协作闭环验证

- `src/collaboration/index.js` — 协作创建/交互/交付物/批准/反馈/确认写回/撤销，数据持久化到 collaborations.json
- 协作状态流转：invited → active → delivered → completed / revoked
- 测试：48 passed

### 全部测试结果

**21 套测试 423 断言 0 失败**：id-01(9) · id-02(30) · id-03(30) · id-04(39) · id-05(48) · act-behalf(4) · gate4-auto-flow(49) · classic-renderer-dom(10) · vl1-block1(18) · vl1-granularity(11) · vl1-block2(23) · vl1-block3(19) · vl1-block4(10) · p1-02(31) · p1-07(39) · email-draft(14) · video-audio(15) · mcp-server(11) · cli(12) · cli-enhanced(15) · editor-extension(16)。

### 下一任务

Owner Electron 真机验收身份与协作功能；P2（协作服务面扩展）。

---

## 2026-07-22 身份与协作规划 v0.2（基于评审全面修订）

### 评审反馈

`digitalme_重要事项与建议_身份协作评审.md` 指出 v0.1 的关键缺陷：身份协作权重不足、五种身份未区分、协作定义不完整、自主性边界不清、"像我"定义抽象、缺少主体协作闭环、缺少第一性对象、验收指标不全面。

### v0.2 修订要点

1. **身份与协作提升为产品核心**：新增"认识我 → 确认我当前以什么身份做什么 → 代表我与其他主体协作 → 将过程、结果和反馈回流到我"闭环，Builder/Runtime/Package 共同服务于主体闭环（来源层/主体层/行动层/协作层/网络层）。

2. **五种身份边界**：明确区分源身份/内在主体身份/角色身份/对外服务身份/任务会话身份，不再用一个"身份"概念覆盖所有场景。

3. **自主性三层边界**：认知自主（独立学习推理）/行动自主（授权范围内执行）/身份自主（不擅自改写根本身份），保留"数字之我走上独立道路"的战略想象，同时形成可验收的产品边界。

4. **"像我"场景化定义**：受场景、角色、证据和授权约束的身份一致性，不是泛化的仿真人格评分。

5. **主体协作闭环**：完整的八步协作过程（发现→任务→授权→执行→交付→反馈→关系→结束），并提供第一条身份—协作产品闭环作为验证对象。

6. **第一性对象**：Subject Identity、Role View、Intent、Authorization Grant、Interaction Contract、Evidence/Lineage 作为第一性对象，DID/Agent Card/MCP/AP2 是协议工件。

7. **八项验收指标**：身份清晰度/授权正确率/身份一致性/协作完成度/证据完整度/撤回有效性/演化可控性/普通人可用性。

### 任务拆分更新

- **P0**：战略定稿（一句话定义、五种身份边界、自主性三层、主体协作闭环产品级定义）
- **P1**：最小主体体验（身份与能力页面、角色选择、任务级授权、受控协作、交付与责任记录、反馈写回）
- **P2**：协作服务面扩展（对外展示、多次授权、关系记忆、跨主体匹配、结算市场）
- **Task ID-01～05**：身份标识、角色身份管理、凭据 VC 升级、凭据出示流程、主体协作闭环验证

### 下一任务

Owner 审核 v0.2 规划，确认后按 P0 → P1 → P2 → Task ID-01～05 顺序实施。

---

### 修复历史任务恢复

`openActBehalfTask` 之前只恢复任务表单数据，不显示结果。修复：
- 检测 `task.result` 为字符串时，显示到初稿文本框并启用编辑按钮
- 恢复 `task.emailDraft`（邮件任务的结构化预览）
- 恢复 `task.videoAudioScript`（视频/音频任务的分镜预览）

### 任务类型引导

生成完成后根据任务类型显示不同的下一步提示：
- **邮件**："点击「准备发送」进入发送确认"
- **视频/音频**："点击「导出脚本」获取可在剪映/Descript 中使用的文件"
- **编程**："点击「复制代码」复制到剪贴板，或「查看依据」了解生成过程"（新增"复制代码"按钮）
- **通用**："支持导出、重新生成、查看依据等操作"

### 测试结果

全部测试通过：act-behalf(4) · gate4-auto-flow(49) · classic-renderer-dom(10) · email-draft(14) · video-audio(15)。

---

### 修复历史任务点击

`openActBehalfTask` 之前只加载任务表单数据，不显示结果。对于 autoGenerate 任务（`task.result` 是字符串），结果不会显示。修复：检测到 `task.result` 为字符串时，直接显示到初稿文本框，启用保存/采用/否定按钮。

### 文案优化

- "直接生成初稿" → "开始"（更普遍适用，不限于写作任务）
- 页面说明增加任务类型说明："支持写作、研究、编程、邮件、视频脚本等任务类型，系统自动识别并路由到合适的后台能力"
- 结果状态文本改为"已生成。你可以继续编辑，或点击「采用」让 Digital Me 从中学习。支持导出、重新生成、查看依据等操作。"

### 测试结果

全部测试通过：act-behalf(4) · gate4-auto-flow(49) · classic-renderer-dom(10) · email-draft(14) · video-audio(15)。

---

### Phase 3-1: 编辑器插件

`src/editor-extension/` — VS Code/Cursor 扩展，程序员在 IDE 中直接使用 Digital Me 个性化上下文。

- **启动连接**：onStartupFinished 激活后通过 stdio 连接 `dm-mcp`
- **Context View**：7 个 `dm://` 资源（persona/style-guide/boundaries/memory/frameworks/identity/life-summary）树形展示
- **Credential View**：凭据列表（受众、有效期、Package 指纹）
- **3 个命令**：`Digital Me: Get Context`、`Digital Me: Generate`、`Digital Me: Generate Credential`
- TypeScript 编译到 `dist/`，独立运行不依赖 Electron

### Phase 3-2: CLI 增强

`src/cli/commands/` — 新增三个命令：

- `dm run <file> [--exec]` — 运行前审查 + 可选实际执行（超时保护、输出截断）
- `dm project` — 项目结构分析（package.json/README/配置文件/语言分布）
- `dm review <file>` — 三栏代码审查（问题/建议/改进方案），使用用户表达风格和边界

### Phase 3-3: 视频/音频协作

视频/音频任务自动识别（"视频/音频/脚本/分镜"等关键词），生成结构化分镜脚本（标题/时长/场景/画面/旁白/创意方向/制作建议），导出 Markdown/纯文本/JSON，适配剪映/Descript 等外部工具。

### 测试结果

全部 16 套测试 **297 断言 0 失败**：editor-extension(16) · cli-enhanced(15) · video-audio(15) · mcp-server(11) · cli(12) · email-draft(14) · act-behalf(4) · gate4-auto-flow(49) · vl1-block1(18) · vl1-granularity(11) · vl1-block2(23) · vl1-block3(19) · vl1-block4(10) · p1-02(31) · p1-07(39) · classic-renderer-dom(10)。

### 全部三个阶段完成

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 统一入口 + 写作/研究/文件处理独立完成 + 编程代码初稿 | ✅ |
| Phase 2 | MCP Server + CLI 终端工具 + 邮件起草 | ✅ |
| Phase 3 | 编辑器插件 + CLI 增强 + 视频/音频协作 | ✅ |

### 下一任务

Owner Electron 真机验收全部功能。

---

### Phase 2-1: MCP Server

`src/mcp-server/index.js` — 暴露 Digital Me 个性化上下文给外部工具（Cursor/VS Code）。

- **7 个 Resources**：`dm://persona`、`dm://style-guide`、`dm://boundaries`、`dm://memory`、`dm://frameworks`、`dm://identity`、`dm://life-summary`
- **3 个 Tools**：`dm_get_context(goal)`、`dm_generate(goal, type)`、`dm_credential(audience, validityDays)`
- 零 Electron 依赖，独立运行，`npm i -g ./src/mcp-server` 后 `dm-mcp` 命令接入 Cursor

### Phase 2-2: CLI 终端工具

`src/cli/index.js` — 程序员在终端里与 Digital Me 协作。

- `dm status` — Package 状态
- `dm context [goal]` — 个性化上下文
- `dm generate <goal> [--fake]` — 生成内容
- `dm credential generate/list/show/revoke` — 凭据管理

### Phase 2-3: 邮件起草

邮件任务自动识别（"邮件/email/发信"关键词），生成结构化邮件（收件人/主题/正文/附件），R3 确认后发送（占位）。

### 测试结果

全部 13 套测试 **255 断言 0 失败**：mcp-server(11) · cli(12) · email-draft(14) · act-behalf(4) · gate4-auto-flow(49) · vl1-block1(18) · vl1-granularity(11) · vl1-block2(23) · vl1-block3(19) · vl1-block4(10) · p1-02(31) · p1-07(39) · classic-renderer-dom(10)。

### 下一任务

Owner Electron 真机验收 7 条路径；Phase 3（编辑器插件 + CLI + 视频/音频协作）。

---

### 产品逻辑确认

Owner 确认：每个做事的能力要么独立达成 95 分位，要么通过与其它工具的协作达成同样目标。编程等能力不能独立达成 95 分位，必须通过协作路径（MCP/插件/CLI 集成到程序员已有环境）。

### 实现改动

- **导航改名**：左侧导航"工作台" → "做事"
- **移除模板选择器**：新建任务直接打开空白任务表单，不弹模板选择
- **统一任务界面**：所有任务使用同一个 act-behalf 界面，系统自动判断任务类型路由到合适后台能力
- **历史任务修复**：任务列表按钮改为 `openDoScene("act_behalf", { taskId })`，正确进入任务详情页
- **移除 TASK_TEMPLATES**：不再区分写作/研究/编程模板，统一入口

### 测试结果

全部 10 套测试 **214 断言 0 失败**，DOM 结构 10/10 通过。

### 下一任务

Owner Electron 真机验收 7 条路径；身份与协作按 ID-01～ID-04 拆分实现。

---

### 工作台结构重构

Owner 指出："做事"与写作/研究/编程的关系不清晰，并列展示导致用户困惑。

**方案**：统一任务流 + 模板快捷入口。

- `DO_SCENES` 移除 `write`/`research`/`code` 独立场景（保留 `act_behalf` 和筹备中场景）
- 工作台首页（do-hub）改为任务列表 + "新建任务"按钮
- "新建任务"弹出模板选择：写作 | 研究 | 编程 | 自定义
- 模板选择后进入 act-behalf 流程并预填角色/期望成果
- 旧场景入口重定向到 act-behalf + 模板参数

### 身份与协作规划

完成市场研究（W3C DID/VC、AT Protocol、Solid、OpenAI Memory、Claude Personalization、MCP/A2A），输出 `DigitalMe_identity_collaboration_plan_v0.1_2026-07-22.md`：

- **唯一数字身份**：三层确认、`did:dme:` 标识、本地密钥对
- **对外凭据**：完整/精简/零知识三类、签发-出示-验证-撤销
- **协作分期**：零期（本人可见）→ 一期（凭据出示）→ 二期（被雇佣）→ 三期（协作网络）
- **技术路线**：轻量实现，不碰区块链/resolver

### 测试结果

全部 10 套测试 **214 断言 0 失败**。

### 下一任务

Owner Electron 真机验收 7 条路径；身份与协作按 ID-01～ID-04 拆分实现。

---

### 身份与协作规划

完成市场研究（W3C DID/VC、AT Protocol、Solid、OpenAI Memory、Claude Personalization、MCP/A2A），输出 `DigitalMe_identity_collaboration_plan_v0.1_2026-07-22.md`：

- **唯一数字身份**：三层确认（本人事实/系统推断/自我声明）、`did:dme:` 标识、本地密钥对、可迁移可验证
- **对外凭据**：完整/精简/零知识三类、签发-出示-验证-撤销流程
- **协作分期**：零期（本人可见）→ 一期（凭据出示）→ 二期（被雇佣）→ 三期（协作网络）
- **技术路线**：第一阶段轻量实现（Ed25519 + JSON-LD VC + 本地存储），不碰区块链/resolver
- **MVP**：身份标识 + 凭据生成/出示/撤销 + 审计日志

### UI 细节修复

- 标签层级克制：高级/候选/依据等标题从 h3/h4 降级为 muted span，不超过"任务标题/任务目标/成果"层级
- 按钮反馈：保存/采用/否定按钮点击后显示"已保存/已采用/已否定"2 秒

### 下一任务

修复剩余细节 + Owner 真机验收 7 条路径；身份与协作按 ID-01～ID-04 拆分实现。

---

### 产品基线重置 v0.2

Owner 审核 v0.1 后指出两个补强项：1）做事能力面缺编程/演示/多媒体等知识工作者高频任务及 95 分位约束；2）唯一数字身份对外协作——若只有对话+做事，digitalme 跟通用 Agent 没区别。

v0.2 基线新增 §2.4 能力覆盖完整性与 95 分位约束（七大门类）、§5.4 唯一数字身份与对外协作（三层确认/凭据出示/零一二三分期）、§15 门 2 新增第 7 条原型路径。v0.1 改 superseded notice。主路径原型新增路径 7"身份与凭据"。

### Gate 4 实现（G4-01 ~ G4-05）

G4-01：`subject-context-assembly.js` 新增 `autoSelectCandidates`；`main.js` 新增 `actBehalf:autoGenerate` IPC；`preload.js` 新增 bridge。

G4-02：渲染器"研究与表达"标题/标签/按钮改为"做事"/"任务目标"/"生成成果"；`panorama-experience` IPC/preload 引用删除；`task-intent.js` DEFAULT_ROLE 更新。

G4-03：`main.js` `autoGenerate` 扩展为完整链路；渲染器新增"直接生成初稿"按钮 + `handleAutoGenerate`。

G4-04：`scripts/test-gate4-auto-flow.cjs`（7 测试 49 断言），`package.json` 注册 `test:gate4-auto-flow`。

G4-05：`subject-overview/credentials.js`（生成/出示/撤销凭据），`main.js` + `preload.js` 新增 3 个 IPC 通道。

### UI 重构（Owner 反馈驱动）

- **结果区域重构**：默认只显示"成果"卡片（标题 + 初稿 + 操作按钮），四栏证据布局移入 `act-backstage-panel` 默认隐藏，"查看依据"按钮切换。
- **布局修复**："直接生成初稿"按钮移到目标输入框正下方；上下文候选改为默认折叠。
- **DOM 修复**：修复 HTML 闭合标签错误（`do-placeholder` 等脱离 `view-do`）。
- **语法修复**：修复字符串未转义双引号导致的 app.js 语法错误。

### 测试结果

全部 10 套测试 **214 断言 0 失败**：act-behalf(4) · vl1-block1(18) · vl1-granularity(11) · vl1-block2(23) · vl1-block3(19) · vl1-block4(10) · p1-02(31) · p1-07(39) · classic-renderer-dom(10) · gate4-auto-flow(49)。

### 待修细节（明日继续）

Owner 确认逻辑基本正确，仍有细节待修。

### 下一任务

Owner Electron 真机验收走通 7 条路径；修复剩余细节；通过后进入普通用户验证。

---

## 2026-07-21 Gate 4 全部实现（G4-01 ~ G4-05）

### 做了什么

G4-01 IPC重构+autoSelect：`subject-context-assembly.js` 新增 `autoSelectCandidates`，`main.js` 新增 `actBehalf:autoGenerate` IPC handler（完整链路：自动选上下文 → auto-confirm → 调用模型 → 返回结果），`preload.js` 新增 bridge。

G4-02 移除研究与表达入口：渲染器 "研究与表达" 标题/标签/按钮文案改为 "做事"/"任务目标"/"生成成果"；`panorama-experience` IPC/preload 引用删除；`task-intent.js` DEFAULT_ROLE 更新。

G4-03 直接生成初稿：`main.js` `autoGenerate` IPC 扩展为完整生成链路；渲染器新增 "直接生成初稿" 按钮 + `handleAutoGenerate` 处理函数。

G4-04 新测试：`scripts/test-gate4-auto-flow.cjs`（7 测试 49 断言覆盖 autoSelect 全链路），`package.json` 注册 `test:gate4-auto-flow`。

G4-05 凭据最小实现：`subject-overview/credentials.js`（生成/出示/撤销凭据），`main.js` + `preload.js` 新增 3 个 IPC 通道。

### 测试结果

全部 10 套测试 **214 测试 0 失败**：act-behalf(4) · vl1-block1(18) · vl1-granularity(11) · vl1-block2(23) · vl1-block3(19) · vl1-block4(10) · p1-02(31) · p1-07(39) · classic-renderer-dom(10) · gate4-auto-flow(49)。

### 下一任务

Owner 真机验收（npm start Electron），验证 7 条路径可通过：零资料写作·已有"我"写作·查看依据重写·短期/长期学习·发送前确认·管理长期理解·身份凭据。

---

## 2026-07-21 Gate 4 规格冻结与代码迁移

### 做了什么

完成基线 v0.2 §15 门 4：`DigitalMe_gate4_spec_migration_v0.1_2026-07-21.md`。包含代码迁移清单（39 保/4 删/8 改）、新第一闭环规格（产品合同/状态机/13 新IPC/风险矩阵/能力矩阵/14 验收项）、5 块实现任务拆分（G4-01～05）。

### 下一任务

Owner 审核 Gate 4 文档，通过后向 Cursor 下发 G4-01。

---

## 2026-07-21 产品基线重置 v0.2 与原型路径 7

### 做了什么

Owner 在 PAN-01S 对话中指出两次重大产品错误：1）把上下文装配/候选选择暴露为普通用户前置流程；2）把"体现数字之我"机械理解为堆叠来源和系统理解。由此触发产品基线重置。

v0.1 基线（CTO 产品裁决稿）：判废"研究与表达"独立入口和候选确认主路径；确立十条产品原则；重新定义默认主循环；对齐 OpenAI/Claude/Google 最佳实践；定义恢复开发前四道门。

Owner 审核指出的两个补强项：1）做事能力面缺编程/演示/多媒体等知识工作者高频任务及 95 分位约束；2）唯一数字身份对外协作——若只有对话+做事，digitalme 跟通用 Agent 没区别。

v0.2 基线：新增 §2.4 能力覆盖完整性与 95 分位约束，新增 §5.4 唯一数字身份与对外协作（三层确认/凭据/分期），§15 门 2 新增第 7 条原型路径。v0.1 改 superseded。主路径原型新增路径 7："身份与凭据"。

### 下一任务

主路径原型完善（七条已就绪）→ 普通用户验证 → 规格冻结 → 下发实现任务。

---

## 2026-07-21 Owner 真机验收第 4 步候选删除粒度修复

### 做了什么

Owner 真机验收第 4 步发现：删除单条可见 bullet 时整块列表消失。根因是列表型来源（如 life 摘要）被 `splitChunks` 合成多行 claim。限量修复：装配层识别 `-`/`*`/`•`/编号列表并逐条生成独立 claim；标题不作为事实候选；普通段落仍按原粒度；降级路径复用同一拆分；新增 `test:vl1-claim-granularity`。未改 Package，未改单 id 删除事件。第一闭环未 `accepted`。

### 下一任务

**等待 Owner 重新执行真机验收第 4 步**

---

## 2026-07-21 Owner 真机验收第 1 步布局阻断修复

### 做了什么

Owner 真机验收第 1 步（进入「工作台 / 研究与表达」）发现阻断性布局错误：多余 `</div>` 提前闭合 `#app`，将 `#do-act-behalf` 等踢出主壳。限量修复：删除该结束标签；为 `.do-act-behalf` 补齐纵向 flex 壳与主栏局部 `overflow:auto`；新增 Electron 解析的经典 renderer DOM 结构回归。未使用全局 `overflow:hidden`。未将第一闭环标为 `accepted`。

### 下一任务

**等待 Owner 重新执行真机验收第 1 步**

---

## 2026-07-21 第 4 块限量修正：apply 审计一致性与 Package 读取失败阻断

### 做了什么

1. apply 前持久化 `pendingApply`（proposalId/previewId/changeSetId/baseVersion/candidateIds）；Package 已提交但任务 applied 审计失败时，按 PackageStore changeSet `status===committed` 幂等恢复为 applied，不得凭 revision 猜测。  
2. Package 内容无法安全读取时不调用模型，提案记 failed 并返回 `package_unreadable`。  
不开始正式验收。第 4 块仍为 `implemented_pending_codex_review`。

### 下一任务

**第一闭环正式验收与 Owner 真机验收**（仅登记，不实施）

---

## 2026-07-21 第一闭环实现 · 第 4 块：Experience Proposal 与主体回流

### 做了什么

从已采用成果生成 Experience Proposal；Owner 逐项审阅/修改/排除；经真实 `feedback:preview` 预览后再显式 `feedback:apply` 写入 Package；任务内保存提案与审计。adopted 不自动写 Package。聚焦测试 `test:vl1-block4`。第 1–3 块 → `accepted`；第 4 块 → `implemented_pending_codex_review`。

### 下一任务

**第一闭环正式验收与 Owner 真机验收**（仅登记，不实施）

---

## 2026-07-21 第 3 块限量修正：Skill/tool invocation 匹配边界

### 做了什么

删除「无匹配时回退到最后一个 tool invocation」；Skill/tool 必须严格匹配当前 goal 与已确认 Subject Context version；tool 仅允许 `research.webSearch`；renderer 当前有效性判断补上 context version。不开始第 4 块。聚焦测试 `test:vl1-block3`（含回归 block1/2/act-behalf）。第 3 块仍为 `implemented_pending_codex_review`。

### 下一任务

等待第 3 块 Codex 复核；**不得自行开始第 4 块**。

---

## 2026-07-21 第一闭环实现 · 第 3 块：有来源约束的研究与表达成果

### 做了什么

实现证据四栏与受来源约束的模型生成；成果编辑/revision/采用/否定；持久化与重启恢复；扩展 task-save-boundary 保护 results。不写 Package、不调用 feedback、不新增外搜。聚焦测试 `test:vl1-block3`。第 2 块 → `accepted`；第 3 块 → `implemented_pending_codex_review`。

### 下一任务

**第一闭环实现 · 第 4 块：Experience Proposal 与主体回流**

---

## 2026-07-21 第一闭环实现 · 第 2 块：真实 Skill 与只读外部调研调用

### 做了什么

接通 `psk_preset_general_research` 与 `research.webSearch`/`searchWeb`；在已确认 Subject Context 后允许 Owner 启动只读外部调研；持久化 Capability Invocation 与 discoveredSources；重启恢复与 running→interrupted；不写 Package、不调用 feedback:apply、不生成最终研究成果。聚焦测试 `test:vl1-block2`。第 1 块标为 `accepted`；第 2 块 `implemented_pending_codex_review`。

### 下一任务

**第一闭环实现 · 第 3 块：有来源约束的研究与表达成果**

---

## 2026-07-21 第一闭环实现 · 第 1 块验收修正：确认边界与目标一致性

### 做了什么

主进程确认不再信任 renderer 提交的完整 Subject Context Draft；候选以 preview 保存或主进程重装为准；`keepClaimIds` 校验；全 sourceRefs 模型推测防护；goal 不一致返回 `context_stale_for_goal`；已确认任务改 goal 时快照失效为 prior。聚焦测试 `test:vl1-block1` + `test:act-behalf`。

### 下一任务

**第一闭环实现 · 第 2 块：真实 Skill 与只读外部调研调用**

---

## 2026-07-21 第一闭环实现 · 第 1 块：任务意图与本人上下文装配

### 做了什么

实现 Task Intent 最小字段与 Subject Context 按 goal 相关性排序、确认/删除/补充、快照保存与重启恢复；工作台入口更名为「研究与表达」；扩展 `act-behalf-tasks.json` schema v2；兼容旧 `55ae01f` 任务读取。`55ae01f` 状态更新为 `partially_reused_as_first_vertical_loop_scaffold`。聚焦测试 `test:vl1-block1` + `test:act-behalf`。

### 明确未做

未接 Skill / searchWeb / 研究执行 / 四栏成果 / Experience Proposal / Package 回写 / R3。

### 下一任务

**第一闭环实现 · 第 2 块：真实 Skill 与只读外部调研调用**

---

## 2026-07-21 第一纵向闭环：仓库映射与规格冻结

### 做了什么

纯文档：只读核查 act-behalf / Package / Skill / research web-search / feedback / retrieval 真实调用路径；新建 `digitalme_first_vertical_loop_spec_v0.1.md`（`spec_frozen`）；执行计划升至 v0.1.2。纠正固定比例摘录≠任务相关、模型自述≠唯一审计证据。冻结 Skill=通用调研、外搜=research.webSearch；完成 `55ae01f` 逐项复用裁定。同步 context 决策 #96、能力表、cursor rule、执行索引指针。

### 明确未做

未改运行代码；未改 `55ae01f` 实现；未开始 Skill/MCP/Proposal 编码；未启动 R3；未 push。

### 下一任务

**实现任务意图与本人上下文装配（第一闭环实现 · 第 1 块）**（待实现授权）。

---

## 2026-07-21 Codex 有条件通过跟进：DM-Core-01A 双对象澄清与四合同字段核验

### 做了什么

纯文档：区分 **① 旧 DM-Core-01A 开发指令（`superseded`）** 与 **② 提交 `55ae01f`（`retained_for_mapping_review`）**；在第一闭环计划 v0.1.1 写入能力边界与四合同逐字段状态；同步废止说明、架构原则、context 决策 #95、能力表、执行索引、cursor rule。

### 明确未做

未修改 `55ae01f` 实现或任何运行代码；未开始第一闭环编码；未 push。

### 下一任务

仍为：**限定范围的仓库实现映射与第一闭环规格冻结**（仅文档）。

---

## 2026-07-21 数字主体规划基线重建（文档）

### 做了什么

Owner 与 Codex 系统复盘后，将新规划结论写入权威文件（纯文档，无运行代码变更）：

1. 新建 `digitalme_subject_architecture_and_rd_principles_v0.1.md`（最高产品定义、四项价值、数字主体五段循环、能力/身份/验收/治理）；
2. 新建 `digitalme_first_vertical_loop_sprint_plan_v0.1.md`（第一纵向闭环短冲刺、四合同映射表、任务顺序；**当前唯一执行计划**）；
3. 更新 `digitalme_context.md`（文首主线、§3.2、§7.1、决策 #94）；
4. 将 `digitalme_panorama_execution_index_v0.1.md` 标为 `superseded_as_current_execution_index`（v0.2.25）；
5. 同步产品规格文首与排期注记、能力状态表、P1-PANORAMA 总任务包、R0/R1/R2 任务包文首、Cursor R2 历史指令、`.cursor/rules/product-development-process.mdc`、PAN-00 策略冻结表中的执行计划指针。

### 旧计划状态

| 项 | 标记 |
|----|------|
| R0 / R1 | completed / retained as infrastructure |
| R2 | retained as infrastructure（停止验收主线） |
| R3 | paused |
| PAN-02～06 | paused（相对新主线） |
| Skill/MCP/Agent/身份并列 7 任务块 | superseded |
| 旧 DM-Core-01A | superseded（**仅指开发指令**）/ 提交 `55ae01f` = retained_for_mapping_review |
| 大规模模块化建设路径 | archived as approach |

### 明确未做

未改运行代码；未启动 R3；未执行/扩展 DM-Core-01A；未开始第一闭环实现编码；未 push。

### 下一任务

**限定范围的仓库实现映射与第一闭环规格冻结**（仅文档；不得直接编码）。

---

## 2026-07-21 Renderer Foundation R2 实现分支创建与参数合同冻结

### 做了什么

Owner 授权后创建分支 `codex/r2-chat-sessions-migration`（起点 `418d0cc`）。纯文档冻结三项实施前参数：`scenarioHint` 白名单三值与缺省归一；8000 截断原样文案与 Unicode code point 口径；token TTL=300s（单调时钟）；rename 最多 4 次 / 50-150-350ms / `EBUSY|EPERM|EACCES`。补全 §15 测试合同（本轮不写测试代码）。R2 仍 **v0.1.1** / `not_started`；R2-A～R2-F 未开始。

同步：context（决策 #93）、执行索引 v0.2.23、能力表、cursor rule、总任务包、R1 调度（最小）。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未安装依赖；未启动应用/测试/构建；未读真实 Package/sessions/userData；未开始 R2-A～R2-F / R2.5 / PAN-02；未 push。

### 下一等待项

**等待 Codex 复核参数合同**；通过且 Owner 再次授权前不得开始 R2-A 编码。

---

## 2026-07-21 Renderer Foundation R2 实施规格接受

### 做了什么

纯文档：Codex 最终复核通过后，将 R2 任务包从 **v0.1.1-draft** / `codex_changes_requested` 升为 **v0.1.1** / `specified` / `codex_review_passed` / `frozen_for_implementation` / `not_started`。§8「#15 停止状态」现场仅一行（无重复可删）。七项合同、22 项所有权、24 类恢复、38 项 E2E 保持。三项实施前参数门继续保留（不阻止规格接受；挡 R2-A 编码）。

同步：context（决策 #92）、执行索引 v0.2.22、能力表、cursor rule、总任务包、R1 调度（最小）。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未创建 R2 实现分支；未启动应用或测试；未读真实 Package/sessions；未开始 R2-A～R2-F / R2.5 / PAN-02；未 push。

### 下一等待项

**等待 Owner 是否授权创建** R2 实现分支 `codex/r2-chat-sessions-migration`。未获授权前不得创建分支或开始实现。

---

## 2026-07-21 Renderer Foundation R2 第三轮最小安全闭环

### 做了什么

纯文档：在 **v0.1.1-draft** / `codex_changes_requested` 下关闭三歧义——`sessionsRecoveryLatch` 跨 next/legacy 写阻断；损坏单会话无普通删除；`inputText`≤2000 + token 一次性消费。七项合同与 22/24/38 结构保持。

同步：context（#91）、执行索引 v0.2.21、能力表、cursor rule、总任务包、R1 调度（最小）。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未建 R2 分支；未启动应用或测试；未读真实 Package/sessions；未 push。

### 下一等待项

**等待 Codex 最终复核** R2 任务包。

---

## 2026-07-21 Renderer Foundation R2 第二轮有界文档补全

### 做了什么

纯文档：在 **v0.1.1-draft** / `specified` / `codex_changes_requested` / `not_started` 下补全 §8 状态所有权（22 项×7 维）、§12.1 损坏 sessions 边界、§13 错误恢复（24 类）、§15.3 Playwright（38 项），并强化完成/停止条件。**七项核心合同未改。**

同步：context（#90）、执行索引 v0.2.20、能力表、cursor rule、总任务包、R1 调度引用（最小）。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未创建 R2 分支；未启动应用或测试；未读真实 Package/sessions；未开始实现；未 push。

### 下一等待项

**等待 Codex 再复核** R2 任务包。

---

## 2026-07-21 Renderer Foundation R2 第一轮有界修订

### 做了什么

纯文档：R2 任务包 → **v0.1.1-draft** / `specified` / `codex_changes_requested` / `not_started`。关闭 Codex 第一轮七项合同（display 角色上限、回经典双路径、窄 sessions 写、`chat:event`、窄 sendChat、附件 token、原子写；单分支分片；关联 legacy handoff）。

同步：context（决策 #89）、执行索引 v0.2.19、能力表、cursor rule、总任务包、R1 调度引用。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未创建 R2 实现分支；未启动应用或测试；未读真实 Package/sessions；未开始 R2/R2.5/PAN-02；未 amend/squash/push。

### 下一等待项

**等待 Codex 再复核**本 R2 任务包；复核通过前不得实现。

---

## 2026-07-21 Renderer Foundation R2 对话迁移任务包起草

### 做了什么

纯文档规格：新建 `digitalme_renderer_foundation_R2_chat_and_sessions_migration.md`（**v0.1-draft**）。

| 项 | 值 |
|---|---|
| 状态 | `specified` / `codex_review_pending` / `not_started` |
| 实现分支 | **不存在** |
| 前置 | R1 `accepted`（baseline `8d7e9b3`） |
| 生产默认 | legacy |

同步：context（决策 #88）、执行索引 v0.2.18、能力表、cursor rule、总任务包调度段。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未创建 R2 实现分支；未启动应用或测试；未读真实 Package/sessions；未开始 R2 实现 / R2.5 / PAN-02；未 push。

### 下一等待项

**等待 Codex 复核**本 R2 任务包；复核通过前不得实现。

---

## 2026-07-21 Renderer Foundation R1 Owner 验收收口

### 做了什么

纯文档收口：将 R1 任务包 **v0.1.3** 标为 **`accepted`**。

| 项 | 值 |
|---|---|
| 验收日期 | 2026-07-21 |
| 验收方式 | Owner real Electron runtime |
| accepted baseline | **`8d7e9b3`** |
| Codex 技术复核 | 通过 |
| Owner 验收 | **6/6 通过** |
| implementation | `completed` |
| 分支 | `codex/r1-renderer-next-shell` |

Owner 6/6：默认经典界面；新预览正常；运行标识且就绪 ok；返回经典界面；失败自动回经典；无白屏/卡死/反复跳转。

同步：context（决策 #87）、执行索引、能力表、cursor rule、总任务包调度段。

### accepted 范围（明确）

仅 R1 基础能力：TS+React+Vite 底座、独立 next、整窗切换、runtime stamp、ready generation、导航单飞、自动回退、latch、Error Boundary、Playwright 基线。next 仍为预览空壳；业务页未迁移；生产默认 legacy；无普通用户 next 入口。

### 明确未做

未改源码/测试/配置/依赖/lockfile；未创建新分支；未启动应用或测试；未起草 R2 任务包；未启动 R2 / R2.5 / PAN-02；未 push。

### 下一任务

起草并冻结 Renderer Foundation R2 对话迁移独立任务包，交 Codex/Owner 复核；未获授权前不得创建 R2 实现分支或修改源码。R2 = `planned` / `not_started`。

---

## 2026-07-21 Renderer Foundation R1 spike 边界小修

### 做了什么

Codex 再复核后关闭 3 项边界：

1. Error Boundary：harness 子组件在 render 阶段 throw，由 `getDerivedStateFromError` 捕获。
2. Vite：`isNextPageUrl` 按解析后的 origin（协议/主机/端口）比对；E2E 使用非 5173 动态端口。
3. ready 超时回调：捕获同步异常与 Promise rejection；legacy 回退失败不产生 unhandledRejection。

状态保持：`implemented` / `spike_partial_verified` / `codex_changes_requested`（v0.1.3）。

### 边界

未继续正式 shell；未启动 R2 / R2.5 / PAN-02；未 amend；未 push。

### 下一等待项

等待 Codex 再复核。

---

## 2026-07-21 Renderer Foundation R1 spike 有界修复

### 做了什么

按 Codex 复核关闭 5 项：

1. next 加载前完成 generation + ready armed，避免 early ready 被判 `ready_late`。
2. `signalReady` 必须显式有限整数 generation；缺失/非法 → `generation_required` / `generation_invalid`。
3. main 导航单飞门禁；连续 `testRequestNext` 第二次 → `navigation_in_progress`。
4. 增补 Vite dev 真实加载 E2E，以及 Error Boundary 仅 harness 可触发。
5. `test-results/` 入 `.gitignore`；`test:r1-spike` 含 typecheck；新增依赖去掉 `^` 精确锁定。

任务包 → **v0.1.3** / `implemented` / `spike_partial_verified` / `codex_changes_requested`。

### 边界

未继续正式 shell；未启动 R2 / R2.5 / PAN-02；未 amend `a613f9b`；未 push。

### 下一等待项

**等待 Codex 再复核**本修复提交。

---

## 2026-07-21 Renderer Foundation R1 兼容性 spike

### 做了什么

Owner 授权后，在分支 `codex/r1-renderer-next-shell` 完成 **R1 兼容性 spike**（非业务 shell）：

1. 文档空白清理提交后拉出实现分支。
2. 锁定：react/react-dom **18.3.1**、vite **5.4.11**、typescript **5.7.3**、@vitejs/plugin-react **4.3.4**、@playwright/test **1.49.1**；Electron **32.3.3**（既有）。
3. 新建最小 `renderer-next`（Vite + React + TS 占位壳 + runtime stamp）。
4. main 权威入口：默认 legacy；`DIGITALME_R1_SPIKE_HARNESS` 门禁可进 next；普通 renderer 仅 next→legacy；ready generation 一次性消费；失败自动回 legacy + 本进程 latch。
5. Playwright Electron 4/4；入口单测 4/4；legacy bootstrap-submit + owner-runtime 冒烟通过。
6. 任务包 → **v0.1.2** / `implemented` / `empirically_verified` / `codex_review_pending`。

### 边界（明确未做）

未迁移 chat / 会话 /「我」/ 构建 / 工作台；未引入 SQLite；未开始 R2 / R2.5 / PAN-02；未改生产默认入口；未向普通用户暴露 next；未读改真实 Package / sessions / userData；未 push。

### 下一等待项

**等待 Codex 复核**本 spike。复核前不得继续正式 R1 shell 扩展。

---

## 2026-07-20 Renderer Foundation R1 实施规格接受 · 今日收尾

### 做了什么

纯文档状态同步：Codex 再复核通过后，将 R1 任务包冻结为 **v0.1.1**：

| 项 | 值 |
|---|---|
| 版本 | **v0.1.1**（自 v0.1.1-draft） |
| 状态 | `specified` / `codex_review_passed` / `frozen_for_implementation` / `not_started` |
| 含义 | **实施规格已冻结**；**不是**实现完成或产品验收 |
| implementation | **`not_started`** |
| 实现分支 | **不存在** |
| Owner 实现授权 | **未获得** |
| 版本锁定表 | **全部 TBD** |

同步：context（决策 #84）、执行索引、能力表、cursor rule；总任务包「当前唯一任务」最小同步（若涉及）。

### 明确未做（今日收尾）

未创建实现分支；未装依赖；未改源码/测试/配置/lockfile；未启动 Electron；未跑产品测试；未开始 R2 / R2.5 / PAN-02；未 push。

### 下一等待项

**等待 Owner 后续明确授权**创建 `codex/r1-renderer-next-shell`（从本规格接受提交）并启动兼容性 spike。

### 不变状态

- R0：`accepted`
- PAN-01S / S.1 / S.2：`accepted`
- PAN-02：`planned` / `blocked`

---

## 2026-07-20 Renderer Foundation R1 有界修订 · codex_changes_requested

### 做了什么

纯文档：按 Codex 复核修订 `digitalme_renderer_foundation_R1_shell_and_entry_switch.md` → **v0.1.1-draft**。

1. 入口权限：普通 renderer 仅 next→legacy；legacy→next 仅 main 开发/E2E；无生产 next 入口；禁 IPC 改持久化默认。
2. 失败状态：本进程 fallback latch；effectiveEntry=legacy；保留偏好并记失败，下次可重试；长期隔离不做。
3. ready 握手：窗口/页面/generation 绑定；一次性；迟到无效；timer 清理。
4. Electron/测试：contextIsolation、禁 nodeIntegration、production 本地产物、dev URL 门禁、故障注入门禁、E2E 隔离。
5. 状态改为 **`specified` / `codex_changes_requested` / `not_started`**（去掉 `frozen_for_implementation`）。

### 状态

| 项 | 值 |
|---|---|
| R1 | `specified` / **`codex_changes_requested`** / `not_started` |
| 实现分支 | **不存在**；**未授权** |
| R0 | `accepted`（不变） |
| PAN-02 | `planned` / `blocked` |

### 下一门槛

**Codex 再复核**本修订。通过前不得实现。

---

## 2026-07-20 Renderer Foundation R1 任务包起草 · codex_review_pending

### 做了什么

新建独立实施任务包：

- **`digitalme_renderer_foundation_R1_shell_and_entry_switch.md`**（v0.1-draft）

冻结 R1 最小范围：renderer-next shell、TS+React+Vite、main 权威整窗入口、ready 握手、load/ready 失败自动回 legacy、Playwright 最小 E2E、版本 spike 锁定。明确不含 chat/我/工作台/SQLite/PAN-02/大规模 preload 重写。

同步 context（决策 #82）、执行索引、能力表、cursor rule。

### 状态

| 项 | 值 |
|---|---|
| R0 | `accepted`（v0.1.2；不变） |
| R1 | `specified` / `frozen_for_implementation` / **`codex_review_pending`** / `not_started`（历史口径；已被上方有界修订条目覆盖为 `codex_changes_requested`，并去掉 `frozen_for_implementation`） |
| R1 实现分支 | **不存在** |
| PAN-02 | `planned` / `blocked` |

### 明确未做

未创建实现分支；未改源码/依赖；未启动应用或 PAN-02。

### 下一门槛

**Codex 复核 R1 任务包**。通过前不得实现。

---

## 2026-07-20 Renderer Foundation R0 决策 accepted

### 做了什么

纯文档：将 R0 标为 **`accepted`**（决策/规格接受；**不是**代码实现完成），任务包 → **v0.1.2**。

1. 修正 `digitalme_context.md` 两处句末多余 `>`（L7 / 覆盖段）。
2. 补充冻结：**next 加载失败或 ready 握手失败时，由 main 自动整窗回退 legacy**（§11.2；架构图与 R1 完成条件同步）。
3. Owner 五项决策记为已接受（§18）。
4. 同步执行索引 / 能力表 / cursor rule / context（决策 #81）。

### 状态

| 项 | 值 |
|---|---|
| R0 | **`accepted`**（v0.1.2；决策接受） |
| R0 implementation | `not_started`；分支不存在 |
| PAN-01S 族 | `accepted`（不变） |
| PAN-02 | `planned` / `blocked` |

### 下一门槛

起草并冻结 **R1 独立实施任务包** → Codex 复核；**复核通过前不得创建 R1 实现分支或修改源码**。

---

## 2026-07-20 Renderer Foundation R0 修订 1 · 关闭 Codex 第一轮架构歧义

### 做了什么

纯文档修订 `digitalme_renderer_foundation_R0_decision_and_migration_plan.md` → **v0.1.1-draft**（保留初稿提交 `fc56259`，不 amend）：

1. **迁移拓扑**：R1/R2 整窗入口切换；legacy/next 两独立 HTML；启动时 main flag；禁 iframe/webview；禁一窗双状态机；禁新按钮驱动旧隐藏 DOM；「返回经典界面」先经 main 持久化再整窗加载 legacy。
2. **SQLite**：拆至 **R2.5** `planned` / `deferred`；R2 继续 JSON sessions；量化触发 + 独立 ADR + Owner 授权；PAN-02 不以 SQLite 为前提。
3. **E2E**：Playwright Electron 为主；保留 owner-runtime 作 legacy 回归；禁 Spectron；单测例 60s / 套件 10 min 口径；版本由 R1 spike 锁定。
4. **R1 收窄**：仅 shell / Vite / Error Boundary / stamp facade / 整窗开关 / 最小 Playwright / 回滚；不含 chat/我/工作台/SQLite/PAN-02/大规模 preload 重写。
5. Owner 五项问题按上列调整。

同步：context（决策 #80）、执行索引、能力表、cursor rule。

### 状态

| 项 | 值 |
|---|---|
| R0 | **`spec_revision_1` / `codex_review_changes_requested`**（**不** accepted） |
| R0 implementation | `not_started`；分支不存在 |
| R2.5 SQLite | `planned` / `deferred` |
| PAN-01S 族 | `accepted`（不变） |
| PAN-02 | `planned` / `blocked` |

### 明确未做

未改源码/测试/配置/依赖；未装依赖；未建实现分支；未启动 R1/PAN-02/应用；未 amend/push；未读真实 Package/sessions。

### 下一门槛

**Codex 再复核** → Owner 答复 §18 →（通过后）另立 R1 任务包。**不得**自行开始 R1。

---

## 2026-07-20 Renderer Foundation R0 决策/任务包起草 · spec_drafted

### 做了什么

在分支 `codex/pan-01s2-chat-incident-close`（起草基线 HEAD `27e90a9`）只读核对现场与架构边界后，新建正式任务包：

- **`digitalme_renderer_foundation_R0_decision_and_migration_plan.md`**（v0.1-draft）

内容覆盖：方案 C 冻结候选、main/preload/renderer/PackageStore 边界、技术选型（Electron + TS + React + Vite；SQLite 仅运行索引）、状态所有权、chat 三层模型、preload 契约原则、strangler 切片 R1～R6、E2E 门槛、PAN-02 解锁条件、Owner 决策问题（≤5）、禁止事项与验收清单。

同步更新：`digitalme_context.md`、`digitalme_panorama_execution_index_v0.1.md`（→ v0.2.9）、`digitalme_capability_status_v0.1.md`、`.cursor/rules/product-development-process.mdc`。

### 状态

| 项 | 值 |
|---|---|
| R0 决策/任务包 | **`spec_drafted` / `codex_review_pending`**（**不** accepted） |
| R0 implementation | `not_started` |
| R0 implementation branch | **不存在** |
| PAN-01S / S.1 / S.2 | `accepted`（不变；baseline `cbde807`） |
| PAN-02 | `planned` / `blocked` |

### 明确未做

- 未修改任何源码、测试、配置或依赖；
- 未创建实现分支；未 npm install；未启动 Electron；
- 未读取真实 Package / sessions / 个人资料；
- 未开始 R1 或 PAN-02；未 amend / push。

### 下一门槛

**Codex 复核本 R0 决策包** → Owner 答复任务包 §18 决策问题 →（通过后）另立 R1 实现任务包。**不得**自行开始 R1。

---

## 2026-07-20 PAN-01S / PAN-01S.1 / PAN-01S.2 Owner 真机验收 · accepted

### 做了什么

Owner 在真实 Electron 环境对最终运行版本 **`cbde807fd1e40472d66fbe8f0810a0835e8bc816`** 逐项验收通过，正式收口：

| 任务 | 最终状态 | 依据 |
|---|---|---|
| **PAN-01S** | **`accepted`** | Owner real Electron runtime；含会话省略号菜单、行内改名、自定义删除确认、永久「继续了解我」构建入口等收口修订 |
| **PAN-01S.1** | **`accepted`** | Owner real Electron runtime；主体解释与渐进构建主路径 |
| **PAN-01S.2** | **`accepted`** | Owner real Electron runtime；覆盖对话历史显示、附件上下文分离、关联文稿正文隔离与恢复入口（正式独立任务包未入库；本条与执行索引记录为准，不伪造任务包历史） |

**Acceptance basis：** Owner real Electron runtime（自动测试通过**不**作为唯一依据）。
**Accepted baseline：** `cbde807`
**Accepted date：** 2026-07-20

独立保留提交（未 amend / squash / push）：`b5997b6`、`acacc6e`、`598e7e9`、`34fb497`、`cbde807`。

### 非阻断技术债 → renderer foundation backlog

不重新打开 PAN-01S。记入 **renderer foundation R0**：`planned` / `not_started`。

1. assistant `displayText` 2000 字限制与 8000 字展开设计不一致；
2. 会话菜单靠近窗口底部时定位仍需完善；
3. write/research/code 尚未统一请求并发模型；
4. `app.js` / `index.html` 仍为大型 renderer 单体；
5. 其他旧功能仍有 `prompt` / `confirm` / `alert`；
6. 真实 Electron E2E 覆盖仍不足。

### 下一门槛

- **（已被上方 R0 决策稿条目覆盖）** 当时：起草并冻结 Renderer Foundation R0 独立决策/任务包。
- **PAN-02**：`planned` / `blocked`（待 R0 边界确认等门槛；**不得**自行开始）
- R0 不是重开 PAN-01S，而是处理已登记技术债并建立后续开发边界。

未触碰 Package / sessions；未启动应用或重跑测试；未 push。

---

## 2026-07-20 执行顺序修正 · R0 优先于 PAN-02

### 做了什么

纯文档：将「当前唯一任务」从「起草 PAN-02 任务包」修正为「起草并冻结 Renderer Foundation R0 独立决策/任务包」。不改变 PAN-01S / S.1 / S.2 `accepted`（baseline `cbde807`）。不授权 R0 实现或创建分支；不启动 PAN-02。

### 状态

- PAN-01S / S.1 / S.2：`accepted`（不变）
- R0：`planned` / `not_started`（仅规格起草授权）
- PAN-02：`planned` / `blocked`

---

## 2026-07-20 有界 UI 修订 · 会话省略号菜单 + 「我」永久构建入口

> **2026-07-20 acceptance superseded：** 下文「不得标 PAN-01S / PAN-01S.1 accepted」为修订当时口径；Owner 真机验收后已由上方「Owner 真机验收 · accepted」条目（基线 `cbde807`）取代。

### 状态边界（本轮 · 历史过程）

- **PAN-01S.2 对话事故**：Owner 真机验收通过；对话正文铺屏问题已关闭。
- 本轮是后续 UI 修订，**当时**不得把 PAN-01S / PAN-01S.1 整体标记 `accepted`（现已 superseded）。
- 「我」页面构建入口缺失仍属 Owner 验收问题；本轮恢复永久 `me-build` 入口。
- 未开始 PAN-02；未触碰 Package / 真实 sessions；不 amend、不 push。

### 做了什么

1. 会话列表：常驻「改名/删除」→ 右侧「⋯」溢出菜单（可键盘聚焦；外点 / Escape / 切换 / 滚动关闭）。
2. 「我」极简面：P0～P4 始终至少有一个「继续了解我」→ `me-build`；P0 保留「恢复我的信息」；me-build 主操作去重为同一文案。

### 下一步

（历史）当时：Codex 复核与 Owner 真机验收本轮 UI。现已由上方 acceptance 条目承接。

---

## 2026-07-19 PAN-01S.1 实现 · statically_verified

> **2026-07-20 acceptance superseded：** 当时状态 `statically_verified` / `implemented`（不 accepted）及「等待 Owner 验收」口径，已由 2026-07-20 Owner 真机验收（基线 `cbde807`）升格为 **PAN-01S.1 `accepted`**。

### 做了什么

在分支 `codex/pan-01s-minimal-product-surface`（parent 规格接受 `686fd7b`）实现主体解释与渐进式构建：

1. 默认「我」：稳定主体解释 + 当前状态说明 + 单一主操作（P0～P4 文案矩阵）；
2. 渐进式构建 B0～B5：一次只呈现当前一步；中途离开可恢复真实进度；
3. 自我评测、材料建议、已授权文件夹用后退出主路径，管理能力后移可达；
4. 构建完成后展示真实变化并回到「我」，不长期保留完成卡片；
5. 保留 P0～P4 优先级与 PAN-01R 生产隔离；
6. 更新 `test:pan-01s`（21/21）与相关 harness；规定回归全绿。

### 状态

PAN-01S.1：`statically_verified` / `implemented`（**不** accepted）
PAN-01S：`statically_verified` / `owner_changes_requested`（**不** accepted）
PAN-02：`planned` / `not_started`

未触碰 Package；未标 accepted；未开始 PAN-02；未 push。

### 下一步

> **2026-07-20 acceptance superseded：** 等待 Owner 验收的口径已由 `cbde807` Owner 真机验收取代；PAN-01S / S.1 / S.2 现为 `accepted`。

**（历史）Owner 验收 PAN-01S.1；不得标 PAN-01S accepted；不得开始 PAN-02。**

---

## 2026-07-19 PAN-01S.1 规格接受 · 允许修订实现

### 做了什么

docs-only：冻结并接受 `digitalme_phase1_task_PAN-01S.1_subject_clarity_progressive_build.md`。

Owner 对 PAN-01S（`98fb817`）验收未通过：主体解释不足、构建为常驻控制台、评测/材料建议/文件夹占主路径。PAN-01R 入口与帮助迁移通过。

裁定：PAN-01S → `statically_verified` / `owner_changes_requested`（**不** accepted）。PAN-01S.1 只修表达与渐进构建，不启动 PAN-02。

同步：能力表、执行索引 v0.2.5、context 决策 #76、cursor rule、PAN-01S 任务包状态。

### 状态

（历史）当时：PAN-01S.1 `not_started`；现已由上方「实现」条目承接为 `statically_verified`。

### 下一步

（历史）当时：实现 PAN-01S.1；现等待 Owner 验收。

---

## 2026-07-19 PAN-01S 实现 · statically_verified

### 做了什么

在分支 `codex/pan-01s-minimal-product-surface`（parent 规格接受 `269fa10`）实现极简产品表面：

1. 默认「我」收口为名称 + 短说明 + 单一主操作（P0→P4 主进程派生）；
2. 撤下四承诺墙、成长路线墙、PAN-01R CTA/五步生产入口、统计墙；
3. 四承诺与成长路线迁入帮助「认识 Digital Me」；
4. 侧栏移除 Package／模型／能力／品牌常驻摘要；
5. 生产 preload / IPC 不暴露 PAN-01R 体验链；仅 test harness（env）可开；
6. 新增 `test:pan-01s`（19/19）与 `test:pan-01s-owner-runtime`（6/6）；规定回归通过。

### 状态

（历史）当时：`statically_verified`；现已加 `owner_changes_requested`，由上方 PAN-01S.1 承接。

### 下一步

（历史）当时等待 Owner 验收；现由 PAN-01S.1 修订承接。

---

## 2026-07-19 PAN-01S 规格接受 · 允许进入实现

### 做了什么

docs-only 最小规格接受收尾（Codex 最终复核通过后）：

1. 任务包状态统一为 `specified` / `owner_approved_for_implementation` / `frozen_for_implementation` / `codex_review_passed` / `not_started`；
2. 澄清 `9dd6fa0` 为 PAN-01R 代码血缘基线，实现分支须从本规格接受提交创建，不得 checkout 回 `9dd6fa0`；
3. context 顶部界面需求源规格版本纠正为 **v0.6.3**；决策 #75；
4. 同步执行索引 v0.2.3、能力表、总任务、cursor rule。

`codex_review_changes_requested` 仅保留为历史过程（第一轮歧义关闭）；当前状态不再写为 changes_requested。不标实现 accepted；当时仍为 `not_started`。

本轮 **docs-only**：未修改 `digitalme-app/**`；未触碰真实 Package；未提交交接件。

### 状态

（历史）当时：`codex_review_passed` / `not_started`；现已由上方「实现」条目承接为 `statically_verified`。

### 下一步

（历史）当时下一任务为创建实现分支；现已由上方「实现」条目承接。

---

## 2026-07-19 PAN-01S Codex 第一轮 · 关闭状态与 harness 歧义

### 做了什么

docs-only 最小规格修复（任务包 v0.1 → **v0.1.1**；规格 v0.6.2 → **v0.6.3**）：

1. 冻结唯一主操作优先级 **P0→P4**（互斥、顺序求值）；废止模糊「未完成构建」；补冲突案例与组合测试 U–Z；
2. 冻结 PAN-01R **无生产入口**（普通 UI／设置／高级／帮助／preload 均无）；仅隔离 test harness；废止「高级区含协作回路验证器」「可以完全没有入口」歧义口径。

同步：执行索引、能力表、context 决策 #74、总任务摘要。

### 状态

PAN-01S：`specified` / `owner_approved_for_implementation` / `frozen_for_implementation` / `codex_review_changes_requested` / `not_started`
（历史过程状态；现已由上方「规格接受」条目承接为 `codex_review_passed`）

本轮 **docs-only**：未创建实现分支；未修改 `digitalme-app/**`；未触碰真实 Package；未提交交接件。

### 下一步

（历史）当时下一任务为 Codex 最终复核后开实现分支；现已由上方「规格接受」条目承接。

---

## 2026-07-19 PAN-01S 规划 · 独立任务包冻结

### 做了什么

起草并冻结 `digitalme_phase1_task_PAN-01S_minimal_product_surface.md`（v0.1）：

- 默认「我」极简主体入口（名称 + ≤2 行说明 + 一主操作 ± 一次操作）；
- 四承诺／成长路线迁入现有帮助弹窗；
- 撤下普通用户 PAN-01R CTA；后台与测试保留；
- 侧栏不常驻 Package／模型／能力／品牌；
- 异常 fail-closed；测试 A–T；非目标含 PAN-02 不得偷跑。

同步：总任务 → `PAN-01S_specified`；执行索引 v0.2.1；规格 → **v0.6.2**（§3.1.1 澄清，非战略改写）；context 决策 #73；能力表；cursor rule。

### 状态

PAN-01S：`specified` / `owner_approved_for_implementation` / `frozen_for_implementation` / `not_started`
（`owner_approved_for_implementation` ≠ 实现 accepted）

P1-PANORAMA：`active` / `three_part_alpha_reframed` / `PAN-01S_specified`

本轮 **docs-only**：未创建实现分支；未修改 `digitalme-app/**`；未触碰真实 Package；未提交交接件。

### 下一步

（历史）当时下一任务为 Codex 复核后开实现分支；现由上方「Codex 第一轮」条目承接。

### 证据

- 战略修订：`07b631d`
- Codex 第一轮最小文档修复：`6ae2dca`
- Codex 最终复核：通过
- Owner 战略决策：已确认

### 结论

PAN-00R 标为 **`accepted`**（docs/strategy acceptance；任务包 v0.1.2）。不代表 PAN-01S～PAN-06 已实现。

### 下一步

（历史）当时下一任务为起草并冻结 PAN-01S 独立任务包；现已由上方「PAN-01S 规划」条目承接。

---

## 2026-07-19 PAN-00R Codex 第一轮最小文档修复 · statically_verified / codex_review_changes_requested

### 修正

1. 产品规格：删除「凡生成默认注入 Package」；改为「像我按相关性贯穿」
2. 产品规格 §3.1：删除侧栏底部 Package／模型／能力／品牌强制常驻
3. 工具调用：停止易发现；细节按需展开（不削弱停止/取消/高风险确认）
4. context §4.4：49KB 全量注入标为 v0.6 前旧实现，待 PAN-02 替换；本次不改代码

### 文档

- 规格 → **v0.6.1**；PAN-00R 任务包 → **v0.1.1**

### 状态

`statically_verified` / `codex_review_changes_requested`（**不**标 accepted）。PAN-01S / PAN-02 未开始。

---

## 2026-07-19 PAN-00R 战略修订 · 三位一体重构与极简产品原则冻结（仅文档）

### Owner 决策（含义摘要，非原话复制）

1. **第一阶段三位一体**：第一阶段必须同时完成「理解我 × 武装我 × 连接世界」三部分 Alpha，取代「在首页完整展示产品全貌」的旧理解；三者齐备才是初级数字主体，第一阶段不得宣称法律身份与社会承认。
2. **极简产品原则**：后台复杂、前台极简；个性化隐性、风险授权显性；四承诺与成长路线迁入帮助；普通用户界面不得展示工程状态与系统设计说明；「产品全貌」重定义为纵向真实体验路径。
3. **AI 使用主体信息新原则**：AI 负责能力上限，Digital Me 负责方向、真实性、边界、连续性和本人特征；相关性门强制；禁止强制显式引用与低相关材料塞 prompt。
4. **PAN-01 裁定**：`statically_verified / owner_product_perception_failed / needs_minimal_surface_reset`；不 accepted；不回滚；由 PAN-01S 收口。
5. **PAN-01R 裁定**：`statically_verified / codex_review_passed / owner_runtime_verified / owner_product_perception_failed / retained_as_internal_collaboration_harness`（证据 `9dd6fa0`、70/70、20/20）；不 accepted；普通用户入口由 PAN-01S 撤下；底层安全骨架保留为高级/开发者协作回路验证器。
6. **成长回流**：外部结果与反馈形成成长候选，但不得直接改写主体；立场、意图、人格与边界改变须本人确认。

### 队列变更

旧队列（PAN-01R 验收通过后启动旧 PAN-02 控制权面板 → 旧 PAN-03 → 旧 PAN-04）**被新三位一体队列取代**：

```text
PAN-00 accepted → PAN-00R statically_verified → PAN-01S task_package_pending → PAN-01S
→ PAN-02 理解通道 Alpha → PAN-03 能力框架 Alpha → PAN-04 外部协作骨架 Alpha
→ PAN-05 成长飞轮与传播体验 → PAN-06 非开发者验证与 Trusted Beta 排序
```

旧 PAN-02「控制权面板」标 superseded；旧 PAN-03/04 保留历史、由新定义取代排期口径。

### 文档变更

- 新增 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`（v0.1）
- 总任务 v0.3.2 → **v0.4**（三位一体重构；状态 `active / three_part_alpha_reframed / PAN-01S_pending_spec`）
- 产品规格文内 v0.5 → **v0.6**（§2.0 极简原则；§2.0.1 主体信息分层；§3.1 极简 IA；§7.6 三位一体 DoD；§7.5 历史化）
- 执行索引文内 v0.1 → **v0.2**（基线 `9dd6fa0`；新队列；PAN-01/PAN-01R 裁定）
- context §2.8 / §3 / §4.4 / §7.1 更新；决策 **#67～#71**
- 能力表更新 P1-PANORAMA / PAN-01 / PAN-01R；新增 PAN-00R、PAN-01S
- PAN-01 任务包加最终处置块；PAN-01R 任务包 v0.1.2 → **v0.1.3**（最终处置）
- `.cursor/rules/product-development-process.mdc` 当前任务指针更新

### 状态与下一步

PAN-00R：`statically_verified`（仅文档收口；**不标 accepted**；待 Codex 文档复核与 Owner 确认）。
**唯一下一任务：起草并冻结 PAN-01S 独立任务包**（极简产品表面与复杂度后移）。PAN-00R 接受前不创建 PAN-01S 实现分支、不修改产品代码、不开始 PAN-02～PAN-06。不恢复 P1-07。

---

## 2026-07-19 PAN-01R Codex 第二轮最小收口 · statically_verified / codex_review_changes_requested

### 修复

1. DecisionAudit preflight 使用 ok + verify.healthy
2. completed-before-cancel → abandoned
3. request reject 先审计后改状态
4. 执行前推理环境 digest 校验（消费 token 前）

### 验证

test:pan-01r 70/70；owner-runtime 20/20；回归通过

### 状态

statically_verified / codex_review_changes_requested（不标 accepted）。PAN-02 未开始。

---
## 2026-07-19 PAN-01R Codex 第一轮复核修复 · statically_verified / codex_review_changes_requested

### 修复

1. **identityClaims**：永不升格为 `verified_fact`；按 dataKind 分类；未确认断言默认不选中。
2. **依据平衡**：分桶收集后确定性选取 3～6 条，事实过多时仍保留其他类别。
3. **previewId**：授权预览冻结范围；确认仅提交 `previewId` + `confirmed:true`；生产 IPC 不接受 renderer tokenId。
4. **范围**：selected 必须是 request.optionalEvidenceIds 子集；越权 → `scope_expansion_rejected`。
5. **personalized**：仅 verified_fact 或已确认 owner_assertion；inference-only / zero-evidence 不得冒充 Digital Me 可采纳。
6. **停止竞态**：cancelRequested；runId 到达后立即 cancelRun。
7. **grounding**：未知引用 → `grounding_invalid`；有主体无引用 → `grounding_missing`；结果页展示 E1 对应正文/边界/未授权摘要。
8. **推理环境**：local_loopback / remote_endpoint / unknown；digest 绑定；变化则拒绝执行。
9. **adopt/reject**：adopt 后审计失败返回 committed+warning；reject 先审计；sender 绑定 receipt。

### 验证

- `test:pan-01r`：56/56；`test:pan-01r-owner-runtime`：19/19（含 R–Y）
- 回归：pan-01、p1-03、p1-07-owner-runtime、p1-phase1、owner-runtime 通过
- `git diff --check a40c5f8..HEAD`：须在本修复提交后无输出

### 状态

`statically_verified` / `codex_review_changes_requested`（**不**标 accepted）。PAN-02 未开始。

---

## 2026-07-19 PAN-01R 主权协作闭环 · statically_verified

### 实现摘要

1. 新增 `digitalme-app/src/panorama-experience/`（subject-brief / request / authorization / execute / receipt）。
2. 五步体验：理解我 → 本地模拟请求 → 授权 → 双隔离生成 → 对照处置；首屏 CTA「体验一次 Digital Me 如何代表我」。
3. 单次短时授权 token；取消经 progress 事件绑定 runId；迟到结果丢弃且不可采纳。
4. 云端模型数据去向在授权预览披露；协作关系标本地模拟；不发送给模拟伙伴。
5. adopt 写入本地成果库；reject 不写正文；不写主体 Package；不泄漏密钥/绝对路径。
6. 侧栏「已装载扩展」与全貌「可体验能力」口径区分。

### 验证

- `test:pan-01r`：36/36
- `test:pan-01r-owner-runtime`：通过（含 CTA 可见）
- `test:pan-01` / `test:pan-01-owner-runtime` / `test:p1-03` / `test:p1-07-owner-runtime` / `test:p1-phase1` / `test:owner-runtime`：通过
- `node --check` 与 `git diff --check`：通过

### 状态

`statically_verified`（**不**标 accepted / runtime_verified）。PAN-02 未开始。

---

## 2026-07-19 PAN-01R 规格冻结 · specified / owner_approved / frozen_for_implementation

### 决策与范围

1. **PAN-01 裁定**：`statically_verified` / `owner_product_perception_failed` / `retained_as_scaffold`；不标 accepted；不回滚。
2. **根因**：展示并解释了承诺，但没有用一条真实体验证明承诺。
3. **PAN-01R**：建立纵向产品证据链——主体依据 × 能力 × 授权 × 代表协作 × 结果处置；首个场景为受控研究协作（本地流程模拟）。
4. **调度**：PAN-02/03/04 = `paused_until_PAN-01R_acceptance`；PAN-01 非阻断 UI 细节进 backlog；唯一下一任务 = PAN-01R。
5. **状态语义**：`owner_approved` 仅表示规格与启动授权；实现后 Cursor 最多标 `statically_verified`；`runtime_verified` / `accepted` 待 Codex 与 Owner。
6. **规格**：产品规格加法勘误 **v0.5.2**——产品全貌不能只靠静态说明，必须由纵向主权闭环提供产品证据。
7. **边界**：「本地模拟」= 协作关系与流程本机模拟；若使用云端模型，授权预览必须披露推理服务数据去向；不得写成真实外部协作。

### 文档

- 新增 `digitalme_phase1_task_PAN-01R_sovereign_collaboration_loop.md`
- 同步执行索引、总任务、PAN-01 任务包、能力表、context、产品规格

### 状态

PAN-01R：`specified` / `owner_approved` / `frozen_for_implementation`。PAN-02 未开始。规格提交记为 `PAN01R_SPEC_BASE` 后直接开实现分支。

---

## 2026-07-18 PAN-01 Codex 第二轮最小复核修复 · statically_verified

### 修复

1. **身份读取失败**：区分隐私配置与访问结论；`accessLabel` 不得再为「当前仅本人可访问」；可保留「隐私配置：默认私有 · 未公开」。
2. **分层/内容损坏**：`content_degraded` 时「这是我」「看见我」降为预览；`currentCondition` 固定为「部分主体资料损坏或无法读取」；不无差别降级「属于我」「由我管」。

### 验证

- `test:pan-01`：24/24；`test:pan-01-owner-runtime`：9/9；阶段回归通过。

### 状态

仍为 `statically_verified`（不标 accepted/runtime_verified）。PAN-02 未开始。

---

## 2026-07-18 PAN-01 Codex 第一轮复核修复 · statically_verified

### 复核发现的三类真实性问题

1. Hero 在 privacy unknown / 主体读取异常时仍可能声称「本机私有 · 资料由你保管」；renderer 缺省成功文案。
2. 四承诺证据偏静态：「属于我」「由我管」未随 Package/边界真实状态变化。
3. `owner_assertion` 总数被误用为「本人确认的发展意图」；资料版本入口只打开设置顶部。

### 修复后的状态派生规则（摘要）

| 场景 | Hero / 承诺 |
|---|---|
| Package 缺失 | statusLine=本机资料尚未就绪；这是我/属于我→预览；下一步→构建 |
| manifest/identity 损坏 | subjectReadStatus=read_error；不声称本机私有/资料由你保管；这是我降级 |
| privacyStatus=unknown | privacyLabel/accessLabel=隐私状态尚无法确认；Hero 不含本机私有 |
| 可读且隐私可确认 | 允许「本机私有 · 资料由你保管」 |
| 发展意图 | 仅 mind_hooks/interests/capability_signals → 发展方向线索；owner_assertion 不得→confirmed_intent |
| 由我管 | 动态反映边界存在/缺失/损坏与已启用数量；策略底座与边界状态分开 |

资料版本：`settings-package-versions` 与「查看资料版本」按钮均滚动并聚焦 `#settings-pkg-versions`。

### 验证

- `test:pan-01`：22/22
- `test:pan-01-owner-runtime`：9/9（真实侧栏默认入口与 CTA；无内部函数兜底）
- `test:p1-03`：22/22；`test:p1-07-owner-runtime`：13/13；`test:p1-phase1`：通过

### 状态

仍为 `statically_verified`（**不**标 accepted / runtime_verified）。PAN-02 未开始。等待 Codex 再复核与 Owner 主路径验收。

---

## 2026-07-18 PAN-01 产品全貌首页 · statically_verified

### 决策与范围

在规划基线 `52b0d14`（PAN01_PLAN_BASE）上创建分支 `codex/pan-01-product-panorama-home`，只读升级「数字之我 → 首页」为「全貌」。

| 项 | 结果 |
|---|---|
| 结构 | 未新增第三套「我」页；复用构建 / 数字之我 |
| 默认入口 | 侧栏「我」→ 数字之我 → 全貌；inbox 待处理不劫持 |
| 四承诺初始态 | 这是我=可用（Package 缺失降级）；属于我/由我管=实验；代表我协作=尚未开放 |
| 五步初始态 | 构建我=实验；看见我=可用；武装我=实验；授权我=预览；代表我协作=尚未开放 |
| 状态契约 | 主进程生成 userStatus / userStatusLabel / currentCondition / limitation / navTarget；白名单导航 |
| 写入 | 无新增主体/意图/边界写入；未修 P1-07；未触碰 `digital-me-package/**` |

### 验证

- `npm run test:pan-01`：12/12
- `npm run test:pan-01-owner-runtime`：7/7（Loop 1 轮修复 harness 等待后通过）
- `npm run test:p1-03`：22/22
- `npm run test:p1-07-owner-runtime`：13/13
- `npm run test:p1-phase1`：通过
- `node --check` 已改 JS；`git diff --check` 通过

### 状态

`statically_verified`（**不得**标 accepted）。等待 Codex 复核与 Owner 主路径验收；验收前不启动 PAN-02。

---

## 2026-07-18 PAN-00 accepted · PAN-01 任务包批准

### 决策

1. **PAN-00** 正式标记 `accepted`（Codex 最终复核通过）。
2. 验收提交：`bc85a14` — `docs(plan): normalize Panorama status language`（状态语言统一；主规划提交为 `9b5de05`）。
3. 建立并批准独立任务包：`digitalme_phase1_task_PAN-01_product_panorama_home.md`。
4. 总任务状态：`active / PAN-01_specified`；当前唯一实现任务为 **PAN-01**。

### PAN-01 产品决定（已冻结）

| 项 | 决定 |
|---|---|
| 结构 | 不新增第三套「我」页面；复用「构建 / 数字之我」 |
| 改名 | 现有「数字之我 → 首页」升级为「全貌」 |
| 默认入口 | 侧栏「我」→ 数字之我 → 全貌；inbox 待处理不得劫持 |
| 只读 | 不新增主体/意图/边界写入；不修 P1-07；不触碰真实 Package |
| 用户面五态 | 可用 · 实验 · 本地模拟 · 预览 · 尚未开放（主进程生成） |

### 明确不做

不开始 PAN-02；不标 PAN-01 accepted（实现后最高 `statically_verified`，待 Codex/Owner 验收）。

---

## 2026-07-18 战略切换：启动 P1-PANORAMA（PAN-00）

### 决策

正式启动 **P1-PANORAMA：Digital Me 产品全貌 Alpha**；完成 **PAN-00** 战略切换与规格冻结（纯文档，不修改产品代码）。

### 原因

执行过早进入局部精细化（写入迁移、交互细节），用户尚未形成产品全貌；「主体性、用户掌控、能力扩展、代表协作」未在一条体验中连续出现；市场教育与真实用户验证启动过晚；Trusted Beta 深度硬化缺少真实用户证据排序依据。

### 基线

| 项 | 值 |
|---|---|
| 代码实现基线 | `5ab55dc` |
| P1-07 收工文档提交（P1-07_DOCS_BASE） | `8fb8210` — `docs(p1-07): record owner acceptance handoff` |
| PAN-00 分支 | `codex/pan-00-strategy-spec-freeze`（父提交为 `8fb8210`；不与之 squash） |
| 建议基线写法 | `5ab55dc + 8fb8210（仅 P1-07 收工文档）` |

### P1-07 冻结

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

已知缺口：

1. 真实 GUI 多类别审阅第一组提交后，第二组未被 Owner 观察到自动呈现；
2. 智能构建确认交互尚未由 Owner 完整复验。

不标 `accepted`；不占用 Panorama 主线；不改 P1-07 代码/测试。2026-07-17 收工纪要保留；其中「等待 Codex 复核与 Owner 运行验收」的旧下一门槛已被本冻结决定取代。

### Alpha / Trusted Beta

- **Product Panorama Alpha**：证明普通用户可理解并走通薄而完整闭环；
- **Trusted Beta**：按用户证据继续高风险路径、异常、迁移、兼容与安全硬化。
原 `digitalme_phase1_subject_upgrade_plan_v0.1.md` 降为 Trusted Beta 依据，不再作当前顺序执行计划。

### 数字主权与 Digital Org

- 数字主权为目标与核心公共叙事；「数据」= 广义数字资产与产出物；不采用机械化个人数据变现；
- Digital Me 是基础设施与支撑方，不宣称已完成制度变革；
- Digital Org 入长期架构，可共享主权内核；多成员/审批/机构授权/价值分配运行时不进当前个人 Alpha；P1-PANORAMA 后再评估 `DORG-00`。
母稿：`digitalme_digital_sovereignty_narrative_v0.1.md`。

### 工程状态 / 用户面状态

工程状态继续走 planned→…→accepted/released。用户面只允许：可用 · 实验 · 本地模拟 · 预览 · 尚未开放。`implemented`/`statically_verified` 不自动等于「可用」。

### 下一任务（已被上文「PAN-00 accepted」条覆盖）

当时下一任务为建立 PAN-01 任务包；现已批准并可实现。

### PAN-00 范围确认

本决策对应文档与规则变更；**不修改** `digitalme-app/src/**`、测试、依赖或 `digital-me-package/**`；不纳入交接 zip/stat/status/bundle。

---

## 2026-07-17 收工纪要（P1-07）

> **状态标注（2026-07-18）**：本节为历史收工记录。P1-07 已按决策冻结为 `frozen_for_panorama`；文中「续作入口 / 等待运行验收」**不再作为当前任务**，已知缺口见上节与执行索引。

今日 P1-07 工作暂停于此。下一日续作以本段与任务包 `digitalme_phase1_task_P1-07_life_identity_package_store.md` 为准。

### 当前基准

| 项 | 值 |
|---|---|
| 分支 | `codex/p1-07-life-identity-package-store` |
| 最新提交 | `5ab55dc` — fix(ui): close P1-07 review cancellation and queue transitions |
| 任务状态 | `statically_verified`（**不得**标 accepted） |
| 本地交接包 | `digitalme-source-5ab55dc.zip` |
| 交接摘要 | `p1-07-5ab55dc-stat.txt`、`p1-07-5ab55dc-status.txt` |

### 本日提交链（P1-07）

`813e509`（Codex 第一轮）→ `b4dc2e2` / `dcfd936`（Codex 第二轮结构）→ `c24f60e`（Owner 验收第一轮：审阅布局与写入状态）→ `5ab55dc`（Owner 验收第二轮：取消/队列/revision fail-closed）

### 自动化证据（`5ab55dc`）

- `test:p1-07` 39/39
- `test:p1-07-owner-runtime` 13/13
- `test:p1-phase1`、`test:p1-06`、`test:owner-runtime` 通过
- 未触碰 `digital-me-package/**`；未 push

### 续作入口（按序 · 已被 2026-07-18 冻结决定取代）

1. Codex 复核 `5ab55dc`（审阅取消、多组队列、revision fail-closed、Electron A–E）
2. Owner **运行**验收（临时测试资料；禁止恢复/覆盖本机真实 Package）
3. 通过后 Life Graph 切片方可标 `accepted`；**勿**在本任务内启动 P1-08、Policies、MCP/ToolBroker 扩展、认知页零散编辑

### 本地未纳入 git

根目录及 `digitalme-app/` 下历史交接 zip / stat / status / bundle 文件均为本地产物，勿提交。

---

## 2026-07-17（P1-07 · Owner 验收第二轮：审阅取消与队列流转 · statically_verified）

### c24f60e 后续复核发现

- 多 materialKind 审阅：第一组 commit 后第二组已加载，但被 `goSelfView("cognition")` 切页隐藏
- identity/persona 确认弹窗取消后 inbox 仍 `awaiting_review`，未恢复 `suggested`
- 智能构建全部取消后仍无条件调用 `applyMindHooks`，可能产生额外 PackageStore commit
- Electron 测试未覆盖「第一组 commit 后第二组仍可见」

### 修复

- `completeCurrentReviewCommitted` 返回 `{ hasNext, completed, ok }`；有下一组时留在构建 lane，不跳转认知页，保持 `#builder-review` 可见并聚焦
- 统一 `cancelCurrentReviewWithoutWrite()`：确认取消与「放弃」均恢复 `suggested`、清理审阅队列与 `distillResult`
- 智能构建批处理移除自动 `applyMindHooks`；观念线索仍由既有明确入口触发
- `isValidPackageRevision`：`Number.isInteger(value) && value >= 0`；`packageCommitSucceeded` / `finalizePendingReviewAsWritten` fail-closed
- custody 写入仍不要求 Package revision，不得伪装 PackageStore commit

### 验证

- `test:p1-07` 39/39；`test:p1-07-owner-runtime` 13/13（含 A–E 新场景）；`test:p1-phase1` 通过
- 未触碰真实 Package；状态仍为 `statically_verified`，等待 Codex 复核与 Owner 再验收

---

## 2026-07-17（P1-07 · Owner 验收修复：审阅布局与写入状态 · statically_verified）

### Owner 验收发现

- 审阅区 buried 在「更多方式」/页面底部，不可发现
- 提取完成后即标记 `written`，与真实 Package commit 脱节
- 智能构建取消后仍可能显示「已写入」
- 版本区无变化是因为没有真实 commit

### 修复

- 「审阅后写入」移至待处理材料主操作区；审阅区 DOM 上移至待处理列表之后、自我评测之前
- inbox 新增 `awaiting_review`；仅 PackageStore commit 成功且 revision 有效时标记 `written`
- `autoWriteDistillResult` / `runMaterialPipeline` 返回 `committed/cancelled/skipped/revision`
- 审阅队列按 materialKind 顺序处理；放弃恢复 `suggested`
- 版本区：无 commit 时「尚无可恢复版本」；刷新显示时间戳
- 新增 `npm run test:p1-07-owner-runtime`（8/8 Electron 行为测试）

### 验证

- `test:p1-07` 38/38；`test:p1-07-owner-runtime` 8/8；`test:p1-phase1` 通过
- 未触碰真实 Package

---

## 2026-07-17（P1-07 · Codex 第二轮复核修复 · statically_verified）

### 结论

- 分支：`codex/p1-07-life-identity-package-store`（不 amend `b4dc2e2`）
- 状态：仍为 `statically_verified`（不标 accepted）
- JSON/JSONL 严格结构校验：facet/slice/`source-index`/`identityClaims`/JSONL 行必须为合法结构；错误类型不得静默重置为空数组
- identity preview IPC 不再接受 `sourceMeta`；来源 id 由主进程 `crypto.randomUUID` 生成；测试可用 `injectSourceMeta`
- 归档失败日志仅记录固定码 `archive_failed`，不输出 message/路径
- 未改 `digital-me-package/**`、未开始 P1-08

### 验证

- `npm run test:p1-07`：38/38
- `npm run test:p1-06` / `test:p1-phase1`：通过
- `node --check` 与 `git diff --check` 通过
- 未触碰真实 Package

---

## 2026-07-17（P1-07 · Codex 第一轮复核修复 · statically_verified）

### 结论

- 分支：`codex/p1-07-life-identity-package-store`（不 amend `813e509`）
- 状态：仍为 `statically_verified`（不标 accepted）
- 分类改为由最终 ops 生成 `dataKinds` / `pathDataKinds`（支持数组）/ `fieldKinds`；`affectedPaths` 与 `pathDataKinds` 精确对应
- 删除全局 `confirmAsFact`，改为白名单 `factConfirmedFields: events|facts|outcomes`；智能构建发送空列表
- 严格读取：损坏 JSON/JSONL → `package_content_invalid`，禁止静默清空重写；events/inferences 优先 `append_jsonl`
- 禁止 source-only commit：无实质 op → `empty_write`；sourceRef 补充视为实质变更（有测试）
- change set 严格绑定 actor / lifeIdentityMeta / materialKind / expiresAt / pathKinds
- `runIdentityCommitAndArchive`：commit 失败不归档；成功归档真实 claims/facts；archive 失败仅 warning，不重试 commit
- 未改 `digital-me-package/**`、Policies、认知页迁移、外部协作

### 验证

- `npm run test:p1-07`：30/30
- `npm run test:p1-06`：通过
- `npm run test:p1-phase1`：通过
- `node --check`（package-write / life / main / materials / renderer / test）与 `git diff --check` 通过
- 未触碰真实 Package

---

## 2026-07-17（P1-07 · Life/identity 写回迁入 PackageStore · statically_verified）

### 结论

- 分支：`codex/p1-07-life-identity-package-store`
- 状态：`statically_verified`（等待 Codex 复核与 Owner 临时测试资料验收；不标 accepted）
- 新增 `src/life/package-write.js`：`previewLifeIdentityWrite` / `commitLifeIdentityWrite`
- `builder:previewWrite` / `builder:write` identity 经 PackageStore；`writeLifeBack` / `materials.writeIdentityBack` 直写已阻断
- 主进程推导 dataKinds；智能构建 identity 取消自动直写，须预览确认且默认不升级 fact/owner_assertion
- `archiveIdentityRun` 仅在 commit 成功后执行；失败返回 `archiveWarning`，不回滚已成功 commit
- 未改 Policies / MCP / ToolBroker / 认知页零散编辑 / `digital-me-package/**`

### 验证

- `npm run test:p1-07`：27/27
- `npm run test:p1-06`：14/14
- `npm run test:p1-phase1`：通过
- `npm run test:p1-baseline-real`：本机资料漂移失败（预期可接受）
- `node --check` 与 `git diff --check` 通过

---

## 2026-07-17（P1-07 · 任务包建立，planned）

### 结论

- 新增正式任务包：`digitalme_phase1_task_P1-07_life_identity_package_store.md`
- 状态：`planned`（仅文档；未实现业务代码；不得标 statically_verified / accepted）
- 范围：`life.writeLifeBack` 与 `builder:write` identity → preview→确认→PackageStore commit；保留 `fact` / `owner_assertion` / `inference` / `current_state` 及来源、actor、reason、revision、rollback
- 明确不包含：Policies、MCP、ToolBroker、外部协作、Life 读取重构、`package:load` scaffold、真实 Package 基线修改
- 任务包含：测试矩阵、数据类别映射表、现有直接写路径清单、Owner 沙盒验收、风险与回滚
- 已同步：`digitalme_phase1_subject_upgrade_plan_v0.1.md`、`digitalme_capability_status_v0.1.md`
- 等待 Codex 复核任务包后再开实现

---

## 2026-07-17（测试 · Phase1 hermetic，真实 Package 基线拆出）

### 结论

- `npm run test:p1-phase1` 改为仅 hermetic 回归：用确定性临时 Package fixture，不读取、不依赖本机 `digital-me-package/**`
- P1-04 #19、P1-05 #13、P1-06 #13 改为临时 fixture 指纹校验，并在结束后清理临时目录
- 真实 Package 相对 P1-00 基线校验拆为独立命令：`npm run test:p1-baseline-real`（本机资料漂移可失败，不阻断功能回归）
- 未修改生产资料与 SecretStore / PackageStore / Builder / ToolBroker 业务实现

### 验证

- `npm run test:p1-04`：25/25；`npm run test:p1-06`：14/14；`npm run test:p1-phase1`：通过（hermetic）
- `npm run test:p1-baseline-real`：本机资料相对 P1-00 已漂移则失败（预期可接受，不阻断 phase1）
- `node --check` 相关测试脚本；`git diff --check`

---

## 2026-07-17（设置 · 临时资料收窄为高级测试工具）

### 结论

- 将「创建临时演示资料」收窄为设置页「高级 / 测试工具」中的「创建临时测试资料」
- 点击须二次确认：会切换当前资料目录；不修改常规资料；临时内容不自动合并回常规资料
- 临时目录状态下显示「当前正在使用临时测试资料」，并提供「恢复常规资料目录」（二次确认）
- 创建与恢复后刷新首页、版本信息与 SubjectOverview；防重复点击
- 未改动 SecretStore / PackageStore 核心、Builder、ToolBroker；未修改 `digital-me-package/**`

### 验证

- `npm run test:settings-temp-package`（结构 / 确认 / 取消 / 警告 / 恢复 / 防抖）
- `npm run test:p1-03` / `test:p1-06` / `test:p1-phase1`
- `node --check`（main / preload / renderer / sandbox-package-state）；`git diff --check`
- 说明：真实 Package 基线已拆至 `test:p1-baseline-real`；本机资料漂移不再阻断 hermetic `test:p1-phase1`

---

## 2026-07-17（P1-06 · Owner 临时资料验收通过）

### 结论

- 编号：`P1-06`
- 分支：`codex/p1-06-builder-package-store-impl`
- 状态：`accepted`
- 实现提交：`0e8ba88`；文档空白清理：`81ba8f1`
- 任务包：`digitalme_phase1_task_P1-06_builder_package_store.md`

### Owner 沙盒验收（仅临时演示资料；未触碰真实 Package）

| 项目 | 结果 |
|---|---|
| 创建临时演示资料 | 通过 |
| 提交一份测试材料 | 通过 |
| 启动 Builder | 通过 |
| 预览阶段 Package 字节未变化 | 通过 |
| 确认写入后显示新 revision | 通过 |
| 重启应用后 revision 与内容一致 | 通过 |
| 执行撤销/恢复 | 通过 |
| 恢复产生新 revision | 通过 |
| 来源、数据类别与修改范围可见 | 通过 |

### 边界

- 仅 Builder 观念/人格写入已迁 PackageStore；
- identity、Life、Policies 仍未迁移；
- 不包含 Policies、MCP、外部协作。

### 下一步

- 下一唯一主任务：`P1-07 Life/identity 写入路径迁移到 PackageStore`；
- 明确不包含 Policies、MCP、外部协作。

---

## 2026-07-17（P1-06 · Builder → PackageStore）

### 结论

- 编号：`P1-06`
- 分支：`codex/p1-06-builder-package-store` / `codex/p1-06-builder-package-store-impl`
- 状态：其后已由 Owner 临时资料验收升为 `accepted`（见上条）
- 任务包：`digitalme_phase1_task_P1-06_builder_package_store.md`

### 实现摘要

1. 新增 `src/builder/package-write.js`：`previewPersonaWrite` / `commitPersonaWrite`；
2. `builder.writeBack` 阻断直接写；`builder:previewWrite` + `builder:write`（persona 仅 `changeSetId` + 确认）；
3. 智能构建与审阅写入：先预览（字节不变）再 Owner 确认后 commit；展示 revision / 可恢复版本 / 修改范围；
4. `dataKind=inference`，保留 `actor` / `reason` / `sourceRefs`；过期 changeSet 拒绝；
5. **未迁移**：Life / Policies / identity、`package:load` scaffold、离线 distill 工具、MCP、外部协作、真实 Package 基线。

### 验证

- `npm run test:p1-06`：14/14
- `npm run test:p1-phase1`（含 P1-01～P1-06）

---

## 2026-07-17（P1-05 · 真实 IPC 停止路径）

### 结论

- 编号：`P1-05`
- 状态：仍为 `statically_verified`（不标记 `accepted`）
- 新增 `test-p1-05-stop-ipc.cjs`：模拟 `l0:external-agent-started` → `l0:stopExternalAgent`，长运行 Node 子进程须 `execution_canceled` 且无 `execution_timed_out`
- Owner 复验前须完全退出并重启应用，避免旧 Electron/renderer 缓存

---

## 2026-07-17（UI · 引导按钮与问号绑定失效）

### 结论

- 根因：`bindMe` 对页面中不存在的 `btn-me-goto-*` 调用 `addEventListener` 抛错，后续 `bindHelpAndTips` 与引导按钮绑定未执行；`onExternalAgentStarted` 也曾排在 `bindEvents` 之后。
- 修复：各 `bind*` 隔离错误；引导按钮改为 document 委托；问号支持悬浮/点击/focus，无文案显示「暂无说明」；监听在 init 最早注册。

### 验证

- `npm run test:bootstrap-submit`（含真实页面绑定韧性测试）通过
- 复验前须完全退出并重启 Digital Me，避免旧 renderer 缓存

---

## 2026-07-17（构建页 · 引导材料提交反馈）

### 结论

- 分支：`codex/p1-05-tool-broker`
- 修复「提交履历类文件 / 提交判断类文件」点击无反馈

### 修订摘要

1. 点击后立即显示「正在打开文件选择…」；
2. 取消选择显示「未选择文件」；
3. 选择成功显示数量与文件名，入库后刷新待处理列表；
4. 打开对话框或入库失败显示明确错误；
5. 新增 `test:bootstrap-submit` 行为测试并纳入 `test:p1-phase1`。

---

## 2026-07-17（P1-05 Owner 验收修订 · 停止立即生效）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 状态：仍为 `statically_verified`（主动取消测试已通过；不标记 `accepted`）

### 修订摘要

1. 主进程在 `l0:runExternalAgent` 登记后立即发送 `l0:external-agent-started`（含 `operationId`），不再依赖长耗时 IPC 返回；
2. renderer 保存主进程签发的 `operationId`；停止仅调用 `l0:stopExternalAgent`；
3. 点击停止后禁用发送/重复停止，等待回收结果；成功为 `execution_canceled`，无法确认则提示残留风险；
4. 新增真实长运行取消回归（spawn 后取消 → 非 timeout）。

---

## 2026-07-17（P1-05 第四轮 Codex 复核修订 · TOCTOU）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 保留提交：`34270b3`、`ef46099`、`28bfa46`、`545c276`（不 amend）
- 状态：仍为 `statically_verified`；交 Codex 再复核；**不**安排 Owner 验收；不标记 `accepted`

### 修订摘要

1. `executePreparedPlan` 在最终 `spawn` 前重新校验真实路径、size、mtime、SHA-256、Node.js VersionInfo 契约与 Authenticode；
2. 重新计算的 fingerprint 须与已确认计划一致，否则 `spawn=0`、`executable_changed_before_spawn`，并写入脱敏审计（`denied` + reasonCodes）；
3. `pinnedIdentity` / renderer / requestId 不能绕过该边界；
4. 故障注入：准备/确认后替换为普通文件或篡改 `cmd.exe`，均拒绝且无实际 spawn。

### 验证

- `npm run test:p1-05`：18/18；`npm run test:p1-phase1` 通过；
- `node --check` 相关模块通过；`git diff --check` 无错误空白。

### 下一步

停止实现；保持 `statically_verified`，交后续安全复核。

---

## 2026-07-17（P1-05 第三轮 Codex 复核修订）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 保留提交：`34270b3`、`ef46099`、`28bfa46`（不 amend）
- 状态：仍为 `statically_verified`；交 Codex **第四轮**安全复核；**不**安排 Owner 验收

### 修订摘要

1. 移除 `generic_pe_task_passthrough`；`local_cli` 仅承认代码所有契约 `local_cli_nodejs_v1`（expected OriginalFilename / InternalName / CompanyName / FileDescription，以及 Authenticode Status=Valid 且 signer 含 OpenJS Foundation）；
2. `pinnedIdentity` 仅在契约校验通过后写入，首次配置与 prepare 均走同一代码所有校验，禁止自证；
3. 真实回归：复制 `cmd.exe` 并篡改 VersionInfo 中 cmd/Cmd/CMD 标识为普通名后提交 `/c echo …>marker` → 计划阶段拒绝、`spawn=0`、marker 不存在；
4. 保留 operationId/sender、orphanRisk、退出二次确认与输出审计修复不回退。

### 验证

- `npm run test:p1-05`：17/17；`npm run test:p1-phase1` 通过；
- `node --check` 关键模块通过；
- Package 基线 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 下一步

停止实现；提交 Codex 第四轮安全复核。

---

## 2026-07-17（P1-05 第二轮 Codex 复核修订）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 保留提交：`34270b3`、`ef46099`（不 amend）
- 状态：仍为 `statically_verified`；交 Codex **第三轮**安全复核；**不**安排 Owner 验收

### 修订摘要

1. 以代码所有正向 Tool Profile（`local_cli_task_passthrough_v1`）校验 PE VersionInfo 身份，不再把路径 basename 黑名单当信任边界；
2. 复制 `cmd.exe` 改名为普通 `.exe` 后提交 `/c echo …>marker`：计划阶段 `profile_identity_mismatch`，`spawn=0`、marker 不存在；
3. `abortOne` / 停止 IPC 校验真实 `webContents.id`；跨 sender、未知 operationId、重复停止不影响其他任务；
4. 主进程签发 `operationId`；renderer 单独 requestId 不能取得他方控制权；
5. `orphanRisk=true` 时界面与返回文案明确提示残留风险，不显示干净的「已停止」；DecisionAudit 保留状态；
6. `before-quit` 检查 `abortAllAndWait`；timeout/remaining/orphanRisk 时弹窗二次确认，禁止静默 `app.exit(0)`。

### 验证

- `npm run test:p1-05`：17/17；`npm run test:p1-phase1` 通过；
- `node --check` 关键模块通过；
- Package 基线 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 下一步

停止实现；提交 Codex 第三轮安全复核。

---

## 2026-07-17（P1-05 第一轮 Codex 复核修订）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 基线提交：`34270b3`（保留，不 amend）
- 状态：仍为 `statically_verified`；交 Codex **第二轮**安全复核；**不**安排 Owner 验收

### 修订摘要

1. 禁止将 `cmd.exe` / PowerShell / pwsh / wscript / cscript / mshta 等 shell/脚本宿主注册为 `local_cli`；参数契约固定为代码所有的 `["{{task}}"]`；
2. 真实测试：注册/篡改 `cmd.exe` 并提交 `/c echo ...>marker` 在计划阶段拒绝，`spawn=0`、文件不存在；
3. `taskkill` 使用 `System32\\taskkill.exe` 绝对路径 + 最小环境；校验退出与进程存活；无法证明终止时 `orphanRisk=true`；
4. 故障注入：taskkill 路径劫持、失败、目标仍存活；
5. 应用退出 / 窗口销毁时 abort 并限时等待委派；`requestId` 绑定真实 sender，拒绝重复；
6. stdout/stderr 共用保留上限；持续统计完整字节与流式 SHA-256；审计区分 `full_stream` 与 `retained_prefix`，不得把截断前缀冒充完整摘要。

### 验证

- `npm run test:p1-phase1`（含 P1-01～P1-05）通过；
- `node --check` 关键模块通过；`git diff --check` 无错误空白；
- Package 基线 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 下一步

停止实现；提交 Codex 第二轮安全复核。

---

## 2026-07-17（P1-05 · ToolBroker 与外部 CLI 最小隔离切片）

### 结论

- 编号：`P1-05`
- 分支：`codex/p1-05-tool-broker`
- 状态：`statically_verified`（自动测试与故障注入完成；交 Codex 安全复核；**不**直接安排 Owner 验收）
- 范围：ToolBroker v1 + 注册工具 `local_cli`；与 P1-04 策略/确认/审计链绑定
- 未做：MCP 迁移、外部协作骨架、OS 沙箱、真实 Package 改写、Builder/Life/Policies 写路径迁移

### 实现摘要

- 新增 `src/tool-broker/`（schema / registry / paths / environment / executor / index）；
- 执行仅 `spawn(executable, args, { shell: false })`；拒绝 `.bat`/`.cmd`/脚本关联；绝对路径可执行文件指纹（realpath + size/mtime/sha256）；
- 最小环境：白名单键 + 显式空 `PATH` 钉死，阻断宿主 PATH 劫持；哨兵密钥不进入子进程；
- 工作目录必须落在已保存授权根内；拒绝逃逸、symlink、UNC/云同步启发式路径；
- 超时、输出截断、取消/进程树回收；确认摘要标明「受限执行，不是安全沙箱」；
- 设置页收窄为可执行文件绝对路径 + 授权工作目录 + 启用开关；升级后默认仍关闭；
- Policy `p1-05-v1`：`requestDigest`/票据绑定 `toolId` / `definitionVersion` / `executableFingerprint` / `planDigest` / env 键名 / 超时。

### 验证

- `npm run test:p1-05`：14/14（含真实 child_process 超时/取消/元字符/环境/截断）；
- `npm run test:p1-04`：25/25；P1-01～P1-03 回归通过；
- P1-00 Package 基线逐文件不变，清单 SHA-256：`3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 仍未解决（须在复核材料中明示）

- 不是 OS 级沙箱；已授权工具自身的恶意行为无法被本切片阻止；
- MCP / 网络访问 / 按工具注入密钥未做；
- Windows 仍可能注入少量固定配置文件变量（HOMEPATH 等）；任意宿主密钥不会被复制，PATH 已钉空；
- Builder/Life/Policies 等 Package 写路径仍未迁入 PackageStore。

### 下一步

停止实现；提交 Codex 安全复核。通过后再安排 Owner 仅用系统临时本地目录的沙盒验收。

---

## 2026-07-17（P1-04 accepted · PolicyEngine 与 DecisionAudit 真实验收完成）

### 结论

- 编号：`P1-04`
- 分支：`codex/p1-04-policy-decision-audit`
- 实现提交：`9929e8b`、`0e19106`、`6fc6046`
- 状态：`accepted`
- 能力状态：PolicyEngine 与 DecisionAudit 外部 CLI 切片提升为 `runtime_verified`；External CLI 仍为 `implemented`、实验性且未沙箱化

### 技术复核证据

- `npm run test:p1-04`：25/25；P1-01～P1-03 全量回归通过；语法检查与 `git diff --check` 通过；
- 三轮 Codex 安全复核完成；账本删除、篡改、半行、meta 方向错误、跨代连接错误、sender/decision/config 漂移均按 fail-closed 处理；
- P1-00 Package 基线逐文件一致，清单 SHA-256：`3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### Owner 验收证据

- 确认摘要可理解：通过；
- 取消后执行体未启动且存在取消记录：通过；
- 成功执行与完整事件链：通过；
- 失败执行与失败记录：通过；
- 新旧代次可查看且全局完整性正常：通过；
- 应用重启后记录与完整性状态一致：通过；
- 验收结束后外部执行体已关闭。

### 边界与下一步

- 该验收只证明一个外部 CLI 切片的策略确认与可信记录链，不证明任意外部程序已安全沙箱化；现有 `shell: true`、完整 `process.env`、任意命令与工作目录风险仍必须由下一任务收敛；
- 下一唯一主任务：`P1-05 ToolBroker 与外部 CLI 最小隔离切片`，任务包 `digitalme_phase1_task_P1-05_tool_broker.md`；MCP 迁移和外部协作骨架不得并行启动。

---

## 2026-07-17（P1-04 第三轮修订 · meta 恢复方向与跨代连接）

### 结论

- 编号：`P1-04`
- 分支：`codex/p1-04-policy-decision-audit`
- 状态：`statically_verified`（第三轮 Codex 复核要求已落地；待再复核，暂缓 Owner 沙盒验收）
- 保留提交：`9929e8b`、`0e19106`；本轮另起提交，不 amend、不 push

### 修订摘要

- DecisionAudit：meta 恢复改为仅允许向前；meta 高于账本、截断、同序不同 hash、有 meta 却无 ledger 一律 `audit_unhealthy`；不得静默回退代次；
- 跨代校验：`generation > 1` 的首条必须为合法 `generation_rotated`，并核对 `fromGeneration` / `toGeneration` / `previousGenerationLastHash`；
- 首次 `decisionId` 始终由主进程签发；rotate/cancel 票据绑定真实 `webContents.id`；重复 revoke 不重复写取消记录；
- 边界说明：meta 与 ledger 均缺失时，无法区分“从未创建”与“全部删除后连带丢失 meta”；**只要 meta 仍在，账本删除必须检出**。

### 验证

- `npm run test:p1-04`：25/25；P1-01～P1-03 回归通过；
- P1-00 Package 基线清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 下一步

交 Codex 第三轮复核。

---

## 2026-07-16（P1-04 · PolicyEngine 与可信决策记录切片）

### 结论

- 编号：`P1-04`
- 分支：`codex/p1-04-policy-decision-audit`
- 状态：`statically_verified`（Codex 复核要求修订已完成；待再复核，暂缓 Owner 沙盒验收）
- 范围：PolicyEngine v1、一次性确认票据、DecisionAudit v1、外部命令执行体强制切片
- 未做：ToolBroker、MCP 隔离、沙箱、Builder/Life/Policies 写路径、外部协作

### 实现摘要

- 新增 `src/policy-engine/`（schema、digest、判定、confirmation-store）与 `src/decision-audit/`（JSONL + hash chain）；
- 新增 `src/orchestration/external-agent-flow.js` 编排请求→确认→审计→执行；
- `l0:runExternalAgent` 不再信任 renderer `writeAuthorized`；两阶段 `l0:requestExternalAgent` + 票据执行；
- preload 移除 `l0AuditAppend` / `l0AuditClear`；暴露受控 `decisionAuditList/Verify/RequestRotate/Rotate`；
- 设置页与编程页行动记录改为只读 DecisionAudit；旧代次可查看；「开启新记录代次」须主进程票据确认。

### 验证

- `npm run test:p1-04`：19/19；P1-01 21/21 + 泄露扫描、P1-02 31/31、P1-03 21/21 回归通过；
- 故障注入：账本篡改/半行阻断、meta 损坏/缺失/落后恢复、配置漂移阻断、取消失效、rotate 绕过失败、P1-00 Package 逐文件基线复验均通过；
- P1-00 Package 基线清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`；本次按基线报告逐路径比较文件集合、大小与 SHA-256，P1-04 未写入 Package。

### 下一步

交 Codex 再复核；通过后再安排 Owner 沙盒验收（无敏感资料、安全演示命令）→ 方可标记 `accepted`。

---

## 2026-07-16（P1-03 accepted · 主体首页与设置弹窗验收完成）

### 结论

- 编号：`P1-03`
- 分支：`codex/p1-03-subject-home`
- 状态：`accepted`
- 实现与修订提交：`47147e8`、`2802026`、`4a595eb`
- 能力状态：Subject home 提升为 `runtime_verified`；不等同于整个应用已发布

### Owner 验收

- 主体名称与归属、默认私有与未公开、v0.1 未版本化提示通过；
- 事实/本人声明/系统推断、统计来源与“至少 N 条”可区分；
- 能力状态、边界与协作状态、资料版本入口及重启一致性通过；
- 设置弹窗正文独立滚动，保存/取消可达，背景不滚动，重新打开回到顶部。

### 技术证据与边界

- Codex 复核未发现阻断项；
- 最终回归：P1-03 21/21、P1-02 31/31、P1-01 21/21 + 泄露扫描；
- `digital-me-package/**` 无差异；清单 SHA-256 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`；
- Builder/Life/Policies 写路径、PolicyEngine、可信 AuditService、ToolBroker 与真实外部协作仍未完成。

### 下一步

第一批 P1-00～P1-03 已收口。下一唯一主任务为 `P1-04 PolicyEngine 与可信决策记录最小强制切片`，任务包 `digitalme_phase1_task_P1-04_policy_decision_audit.md`；其验收后再进入 ToolBroker 与协作骨架。

---

## 2026-07-16（P1-03 修订 · 严格只读与统计语义）

### 结论

- 状态：仍为 `statically_verified`；不进行 Owner 验收；
- overview 改用 `package-store/read-only.js`，不构造普通 `PackageStore`；
- 构造、inspect、版本枚举和恢复状态检查均不创建旁路目录；
- 七类计数改为 canonical source / breakdown / partial 语义；
- 写作状态改为「受限」，Feedback 保持「可用」。

### 验证

- `npm run test:p1-03`：20/20；
- P1-02：31/31；P1-01：21/21 + 泄露扫描；
- 无旁路仓连续读取两次仍不存在；已有旁路仓读取前后完整树、mtime 与内容一致；
- JavaScript 语法、`git diff --check` 与 Package 基线复验通过；
- Package 清单 SHA-256：`3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

---

## 2026-07-16（P1-02 accepted · Owner 沙盒验收完成）

### 结论

- 编号：`P1-02`
- 分支：`codex/p1-02-package-store`
- 状态：`accepted`
- 自动验证：`npm run test:p1-02` 31/31；`npm run test:p1-01` 21/21 + 泄露扫描；语法与 `git diff --check` 通过
- Package 基线：56 文件 / 2,077,665 字节；清单 SHA-256 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

### Owner 验收证据

1. 临时演示资料创建通过，未触碰真实 Package；
2. Feedback 预览未写入；确认后形成新版本；
3. 应用重启后版本仍在，设置页可从磁盘发现最近可恢复版本；
4. 恢复操作通过，恢复本身形成新 revision，测试修正内容已撤销；
5. 验收结束后已恢复真实资料目录配置。

Owner 未记录界面显示的具体 revision 数字，但“重启后版本仍在 + 重启后恢复入口可用 + 内容成功撤销”已覆盖所需运行链路，不影响接受结论。

### 边界与下一步

- 本次只证明 Feedback 切片；不得宣称 Builder、Life、Policies 等主体写入已统一治理；
- PackageStore 与 Feedback 状态提升为 `runtime_verified`；
- 下一唯一主任务：`P1-03 主体首页信息架构与数据契约`，任务包 `digitalme_phase1_task_P1-03_subject_home.md`。

---

## 2026-07-16（P1-03 · 主体首页与 SubjectOverview v1）

### 任务

- 编号：`P1-03`（主体首页信息架构与数据契约）
- 分支：`codex/p1-03-subject-home`
- 基线提交：`6fa0881`
- 状态：`statically_verified`（交 Codex 复核；Owner 只读验收暂缓）

### 处理

1. 新增 `subject-overview/` 只读聚合：`buildSubjectOverviewV1`（契约 v1）；
2. IPC `subject:getOverview` + preload `getSubjectOverview`；
3. 「我 → 数字之我 → 首页」呈现主体抬头、七类分层、版本恢复入口、能力五态、边界与协作状态；
4. 读取不调用 migrate/scaffold/recover；`assessRecoverabilityReadOnly` 评估恢复状态；
5. renderer 全量 `textContent` 渲染，不拼接主体正文。

### 验证

- `npm run test:p1-03`：12/12
- `npm run test:p1-02`：31/31；`npm run test:p1-01`：21/21 + 泄露扫描
- 语法检查、`git diff --check`、Package 基线 hash 未变

---

## 2026-07-16（P1-02 修订 · 版本界面恢复错误真实呈现）

### 任务

- 编号：`P1-02`（Owner 验收阻断：listVersions 吞 recover 错误仍返回 ok）
- 分支：`codex/p1-02-package-store`
- 状态：仍为 `statically_verified`（不标 accepted；交 Codex 复核）

### 处理

1. 新增 `version-panel.js`：`buildVersionPanelInfo(store)` 先 `recover()`，失败则 fail-closed；
2. `recover_ambiguous` / `package_locked` / 其他恢复失败分别映射 `statusCode` 与中文提示；
3. 任何 recovery issue 时 `previousVersionId`/`previousRevision` 为 `null`，保留 live/backup/journal 证据；
4. renderer 仅在 `statusCode === "ok"` 启用「恢复到上一个版本」，recovery 时标「暂不可恢复」；
5. 测试 28–29：无 journal 歧义、持锁不可恢复；测试 27 改用 panel 断言正常路径。

### 验证

- `npm run test:p1-02`：31/31
- `npm run test:p1-01`：21/21 + 泄露扫描
- 语法检查、`git diff --check`、Package 基线 hash 未变

---

## 2026-07-16（P1-02 修订 · 重启后可恢复的资料版本入口）

### 任务

- 编号：`P1-02`（Owner 验收阻断：重启后不可撤销；保留既有提交）
- 分支：`codex/p1-02-package-store`
- 状态：仍为 `statically_verified`（不标 accepted；先 Codex 复核再沙盒验收）

### 处理

1. 设置页新增「资料版本」：显示当前 revision、最近可恢复版本、「恢复到上一个版本」；
2. 版本列表与恢复均从磁盘 PackageStore 读取，不依赖 renderer 内存；
3. 恢复前二次确认，并说明会生成新 revision、不删除历史；
4. renderer 仅提交主进程返回的 `versionId`；
5. 补齐「提交 → 新实例模拟重启 → listVersions → rollback」自动测试；
6. `strategy.md` / `journal.js` 表述与空白清理。

### 验证

- `npm run test:p1-02`、`npm run test:p1-01`、语法检查、`git diff --check`、Package 基线

---

## 2026-07-16（P1-02 修订 · 消除锁/journal 替换窗口）

### 任务

- 编号：`P1-02`（Codex 二次复核阻断项；保留 `ff36102`、`fa84677`）
- 分支：`codex/p1-02-package-store`
- 状态：仍为 `statically_verified`（暂缓 Owner 沙盒验收）

### 处理

1. **锁**：`lock.json` 持锁期不再 rename/replace；heartbeat 写 `lock-heartbeats/` 旁路；过期仅 PID 死亡后原子接管。
2. **journal**：单调 `journals/journal-NNNNNNNNNN.json`；publishing→rename；崩溃保留上一完整 generation；可提升完整 publishing。
3. **无 journal**：live+backup → `recover_ambiguous`（不再 noop）；仅唯一已校验候选可自动恢复。
4. **测试**：heartbeat 窗口 child 抢锁、journal 崩溃/提升、无 journal 歧义、无 bak/tmp 残留。

### 验证

- `npm run test:p1-02`：28/28
- `npm run test:p1-01`：21/21 + 泄露扫描
- Package 清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

---

## 2026-07-16（P1-02 修订 · 锁/摘要/恢复/快照 fail-closed）

### 任务

- 编号：`P1-02`（Codex 初复核「需要修改」后的修订；保留 `ff36102`）
- 分支：`codex/p1-02-package-store`
- 状态：仍为 `statically_verified`（暂缓 Owner 沙盒验收）

### 处理

1. **跨进程锁**：actor 与 operationToken 分离；`open("wx")` 独占创建；同/异 actor 第二进程均阻断；stale 仅租约过期且 PID 死亡后原子 rename 接管；recover/commit/rollback 均持锁。
2. **摘要 fail-closed**：readdir/stat/read 失败抛错；symlink/reparse 拒绝；禁止静默跳过。
3. **recover**：swapping 用 `expectedRootSha256` / `backupRootSha256` / revision 判定；不匹配保留 journal；损坏 live 无 backup → `recover_ambiguous`。
4. **不可变快照**：`.publishing-vN-<token>` 校验后 rename；已有 vN 只比对一致性；中途失败不删原快照。
5. **元数据原子写**：bak+rename 替换；禁止删旧后 copy；失败还原旧文件。
6. **边界**：严格 manifest 字段；changeset 禁止写 `manifest.json`。

### 验证

- `npm run test:p1-02`：23/23（含 child_process 抢锁、同 actor 阻断、不可读目录、symlink、损坏恢复、快照中途失败、元数据替换失败）
- `npm run test:p1-01`：21/21 + 泄露扫描
- Package 清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

---

## 2026-07-16（P1-02 PackageStore 最小版本提交 · Cursor 实现）

### 任务

- 编号：`P1-02`
- 代码 Owner：Cursor
- 分支：`codex/p1-02-package-store`
- 状态：`statically_verified`（未经 Owner 沙盒验收与 Codex 复核，不得 accepted）

### 本次完成

1. 新建 `digitalme-app/src/package-store/`：schema v0.2、内容根摘要（SHA-256）、锁、journal、change set、快照、同卷目录切换、rollback、recover；
2. Windows/WPS 策略写入 `package-store/strategy.md`：旁路完整 staging + 两步 rename + journal，失败恢复到唯一明确旧版；
3. Feedback 唯一切片：preview 只建候选 change set；apply 仅 commit 已预览 id；数据类 `owner_assertion`；
4. 沙盒：设置页「创建临时演示资料」+ 版本提示/撤销；不触碰真实 `digital-me-package/**`；
5. 自动测试 `npm run test:p1-02`（16 项）与 P1-01 回归通过；Package 基线 hash 未变。

### 明确未完成（不得夸大）

- Builder、`life:applyMindHooks`、Life 全写面、Policies、`package:load` scaffold、离线 scripts 等**仍直接写 Package**；
- 未宣称“所有主体写入已统一治理”。

### 验证

- `npm run test:p1-02`：16/16
- `npm run test:p1-01`：21/21 + 泄露扫描
- Package 清单 SHA-256：`3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`
- Git：`digital-me-package/**` 相对 `151d798` 无差异

### 下一步

Owner 沙盒验收 + Codex 复核 → `accepted` → 再决定是否迁移 Builder/Life/Policies。

---

## 2026-07-16（P1-01 正式验收通过）

### 结论

- 任务：`P1-01 SecretStore 与敏感配置迁移`
- 状态：`accepted`
- 实现提交：`363e58d`
- 修订提交：`94f7e13`、`9d3ecc4`
- Codex：三次架构与安全复核通过
- Owner：真实模型人工验收通过

### 验收证据

- 自动测试：`npm run test:p1-01`，21/21 通过；源码与临时迁移产物泄露扫描通过；
- 重启后设置页显示“已安全保存”，输入框不回显密钥；
- 普通对话成功；密钥框空白保存后仍可调用；
- 替换密钥成功；清除密钥后正确阻止调用；
- 截图中的一次调用失败由无效模型标识 `deepseek-v4-flash quick` 引起，改回服务端有效标识 `deepseek-v4-flash` 后恢复，与 SecretStore 无关；
- Package 基线未变，清单 SHA-256：`3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

### 保留边界

- 扩展进程继承完整 `process.env`、工具隔离和完整密钥撤销产品面留给后续 ToolBroker；
- P1-01 的能力状态升为 `runtime_verified`，不等同于整个应用已可公开发布。

### 下一步

唯一主任务切换到 `P1-02 Package schema + PackageStore 最小版本提交`，任务包：`digitalme_phase1_task_P1-02_package_store.md`。

---

## 2026-07-16（P1-01 修订 · 备份清理 fail-closed）

### 任务

- 编号：`P1-01`（第二次修订，保留 `363e58d`、`94f7e13`）
- 分支：`codex/p1-01-secret-store`
- 状态：仍为 `statically_verified`（Codex 第二次复核阻断项已修；待再复核）

### 处理

- 成功路径增加严格清理屏障：删除临时/遗留明文备份 → 枚举 `migrate-tmp.*.bak` → 验证无残留后才可 `completed`。
- 删除、枚举或残留验证失败：不写脱敏 `completed` 配置；提交前失败时原 `config.json` 字节不变；返回 `plaintext_backup_cleanup_failed`；启动时显示安全警告。
- 已完成迁移但发现旧明文备份且无法删除：不得再报 `completed`，报告残留风险（`residualRisk`）。
- 新增测试：注入 `unlink` / `readdir` 失败及残留备份场景。

### 验证

- `npm run test:p1-01`：21 项 + 泄露扫描通过
- Package 清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

---

## 2026-07-16（P1-01 修订 · 关闭迁移恢复缺口）

### 任务

- 编号：`P1-01`（修订，保留实现提交 `363e58d`）
- 代码 Owner：Cursor
- 分支：`codex/p1-01-secret-store`
- 状态：仍为 `statically_verified`（Codex 此前「需要修改」；本修订后待再复核；**暂不**做 Owner 真实密钥验收）

### Codex 复核项与处理

1. **明文备份泄露**：成功路径仅用临时 `config.json.migrate-tmp.*.bak`；校验 SecretStore 后清除临时/遗留明文备份，再原子写入脱敏配置；不再永久保留 `pre-secret-migration.bak`。
2. **损坏配置保护**：`loadRawConfig`/`readRawConfig` 仅在文件缺失时返回默认；JSON 损坏、权限或读取失败阻断迁移、可操作警告、不覆盖原文件。
3. **扩展 env 短值**：取消长度启发式；所有非空 env（含 `LOG_LEVEL=info`）迁入 SecretStore 并可注入扩展。
4. **测试与扫描**：补齐成功无明文残留、损坏/不可读不覆盖、短 env、SecretStore 写失败、回读校验失败、脱敏写入失败等；泄露扫描增加临时 userData 迁移产物明文扫描（不用真实 userData/密钥）。

### 验证

- `npm run test:p1-01`：18 项 + 泄露扫描（含迁移产物）通过
- `node --check`：本次修改的 JS 全部通过
- Package 清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

### 下一步

Codex 再复核 → 通过后再安排 Owner 真实密钥验收 → 方可 `accepted`。

---

## 2026-07-16（P1-01 SecretStore 与敏感配置迁移 · Cursor 实现）

### 任务

- 编号：`P1-01`
- 代码 Owner：Cursor
- 分支：`codex/p1-01-secret-store`
- 状态：`statically_verified`（未标记 accepted；待 Owner 真实模型验收与 Codex 复核）

### 本次完成

1. 新增主进程 `SecretStore`（Electron `safeStorage` 适配器可注入；拒绝 Base64 冒充加密）；
2. 分离 PublicConfig / RuntimeConfig；`config:get` 仅返回 `apiKeyConfigured` 与空 `apiKey`；
3. 启动时幂等迁移旧 `config.json` 明文密钥；失败保留旧明文并提示；成功后删除明文（修订后不再保留永久明文备份）；
4. 扩展 `env` 不再落盘明文；连接时主进程按扩展 id 临时装配；
5. 设置页：已保存提示、空白保留、清除确认；不回显密钥；
6. 自动测试与泄露扫描通过；P1-00 Package 清单 hash 复验一致。

### 验证

- `npm run test:p1-01`（初版）通过；修订后见上方条目
- `node --check` 全部 App JS 通过
- Package 清单 SHA-256 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`

### 已知未解决

1. `extension-manager` 仍继承完整 `process.env`（属后续 ToolBroker，本任务未宣称解决）；
2. 扩展密钥完整撤销 UI 仅有窄 IPC `secrets:clearExtensionEnv`，产品面后续可加深；
3. 未做 Owner 真实模型联调（Codex 要求修订完成前暂缓）。

### 下一步

见上方「P1-01 修订」条目。
---

## 2026-07-16（P1-00 工程与 Package 基线冻结 · Cursor 实现）

### 任务

- 编号：`P1-00`
- 代码 Owner：Cursor
- 状态：`accepted`（自动验证、Owner 范围确认、首次提交与 Codex 复核均完成）

### 本次完成

1. 处理根目录无效空 `.git` 重解析点占位后，在工作区根初始化 Git（无 commit、无 remote）；
2. 新增 `.gitignore`（排除 `node_modules`、密钥/本地配置、快照与诊断、原始素材、Office 临时文件等）；
3. 新增只读基线脚本与验证：`scripts/p1-00-*.mjs`；
4. 生成脱敏 Package 基线报告与能力状态表；
5. 在工作区外创建 Package 安全快照（含清单与恢复说明）；
6. 标记工程版本通道为 `0.1-alpha`（`digitalme_version.txt`）；
7. 运行 `p1-00-verify-all`：App JS 语法、Package JSON/JSONL、双次基线 hash、快照一致性、git status 敏感路径、Package 未改动 — 全部通过。

### 关键证据（脱敏）

- Package：56 文件 / 2,077,665 字节；清单 SHA-256 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`
- 执行前后逐文件 SHA-256：一致（0 mismatches）
- source index：79；hash 全空；悬空 sourceRefs：94；无法解析位置：7；签名：placeholder
- 快照绝对路径见 `build/reports/p1-00-snapshot-pointer.json`

### Owner 确认（同日续）

1. **不纳入** `digital-me-package/`；**排除**根目录 `.docx`/`.doc`；
2. 快照位置维持不变；
3. `.gitignore` 已按上述更新。

### 未执行

1. 推送远程（需先有 GitHub 仓库；本地首次提交可先完成）；
2. 用快照执行恢复覆盖（本任务明确不做）；
3. 默认关闭 MCP/CLI（禁止改 App 行为，留给后续安全任务）。

### 下一步

1. 本地首次提交已完成：`151d798`（85 个文件；不含 Package 与根目录 doc/docx）；
2. 尚无 remote、未推送；远程仓库不是继续本地开发的前提；
3. P1-00 经 Codex 复核通过；下一任务为 `P1-01 SecretStore 与敏感配置迁移`，任务包见 `digitalme_phase1_task_P1-01_secret_store.md`。

---

## 2026-07-16（正式架构审计后收敛 · 第一阶段升级计划）

### 决策 #57

- 正式审计结论：**架构方向有条件通过，生产就绪不通过**；当前定义为具备真实闭环的单机 Alpha。
- 第一阶段目标统一为：**主体属性与产品感知 + 安全可信可管 + 已有能力真实可用 + 外部协作最小骨架与用户认知**。
- 停止用新增能力、UI 存在和协议文件证明进展；改用来源、版本、回滚、权限强制、连续真实任务和对照评测证明。
- 原 v0.3.13 L0/审计/CLI 保留为实现基础，但状态降为“待安全硬化的原型”。

### 本次完成

1. 新增正式审计：`digitalme_architecture_audit_20260716.md`；
2. 新增当前唯一执行计划：`digitalme_phase1_subject_upgrade_plan_v0.1.md`；
3. 更新 context：新增 §2.7 当前阶段、§5.4.1 固定协作机制、重排 §7.1 优先级；
4. 更新产品规格至 v0.4：主体首页、信任中心、主体安全交互、已有能力硬化、协作最小产品面与 DoD；
5. 更新端主权架构：六个强制内核与协作默认私有边界；
6. 将 MVP 文件标记为历史基线，并补充可信主体前置门槛。

### 工作机制

- **Codex**：技术负责人，负责规划、规格、任务包、架构/安全复核、测试与下一步路由；
- **Owner**：确认真实产品取舍，执行 GUI、账号、密钥、控制台和人工体验验收；
- **Cursor 或 Codex**：单任务代码 Owner，按任务包实现和自动测试，同一文件范围不并行修改；
- 完成标准：实现者自动验证 + Codex 复核 + Owner 人工验收 + 文档落档。

### 下一步唯一入口

按顺序启动第一批任务：

1. `P1-00` 工程与 Package 基线冻结；
2. `P1-01` SecretStore 与敏感配置迁移；
3. `P1-02` Package schema + PackageStore 最小版本提交；
4. `P1-03` 主体首页信息架构与数据契约。

第一批验收后再启动 PolicyEngine、可信审计、ToolBroker 与协作骨架。

`P1-00` 已接受（基线 `151d798`）。`P1-01` 任务包见 `digitalme_phase1_task_P1-01_secret_store.md`，实现状态见本日志上方 P1-01 条目。

---

## 2026-07-15（L0 控制权加深 · v0.3.13）

### 决策 #56

- 编程上「像我」不作为主验收；**控制权交回用户**（授权 · 确认 · 轨迹 · 审计 · 回流）优先。
- 审计账本本机落库，编程侧栏 + 设置可读；写作 / 研究统一注入控制说明、展示能力轨迹、记审计。
- 外部执行体：本机命令注册 + 用户确认后调度（精简 Agent Card）；**不做**完整远程协议市场与自研 IDE。

---

## 2026-07-15（编程 UX + 指导手册 · v0.3.12）

### 决策 #55

- 编程中栏：消息区内滚动，输入框固定并与交互列同宽对齐（对标常见对话产品习惯）。
- 授权文案改白话 + 「?」短提示；应用内「说明」加编程专章；启动书面手册 `digitalme_user_guide_v0.1.md`（产品约定：新场景必须说明+短提示）。
- 右侧改为**成果台**（文件 / 预览链接 / 说明摘要），纯文本框不足以展示编程结果；内嵌预览与本地静态服分期加深。

---

## 2026-07-15（做事能力四层版图 · v0.3.11）

### 决策 #54

- **L0 主体编排 / L1 场景 / L2 Skill / L3 工具**：指挥其它 Agent 的缺口在 L0，不是加长职业场景墙。
- 自媒体/营销/运维等降为开箱包；一级场景少而稳。
- **扩展性四条**：新手脚、新办法、新交付面才加场景、新 Agent 由 L0 调度。
- **L0 最小 DoD**：像我注入 · 授权分级 · 轨迹可见 · 成果回流；不做对外市场。
- 落地切片：Skill 引入自动准备推荐工具；编程场景骨架；办公（邮件/日历）进高级工具目录。

---

## 2026-07-14 收工纪要

今日规格止于 **v0.3.10**。文档与实现已对齐，明日开场以前述决策与规格为准，勿回退「流程配方」用户面说法。

### 本日交付（摘要）

| 版本 | 要点 |
|------|------|
| v0.3.7–0.3.8 | 写作空白稿优先；研究三栏 + 对话 threads 持久化 |
| v0.3.4–0.3.6 / 收口 | 研究检索 Agent、材料、标记完成、引导注入、发送按钮比例 |
| **v0.3.9** | 写作「采用为成果」；能力页 Skill 区 + 工具能力分层；弃用难懂配方话术 |
| **v0.3.10** | 场景页 Skill **仅下拉引入**；新建/删除只在「能力 → Skill」 |

### 可选接手（已由 v0.3.11 接走或登记）

1. ~~Skill 引入后自动准备 `recommendedExtensions`~~ → **v0.3.11 已做**。
2. 能力页新建 Skill 体验（当前为简洁 prompt，可改为表单）→ 仍可选。
3. 写作/研究其它验收缺口（若试用中再登记）。

### 决策索引（当日）

#49 对标法 · #50 写作空白稿 · #51 研究三栏 · #52 Skill/工具能力分层 · #53 场景仅引入

---

## 2026-07-14（场景 Skill 条简化 · v0.3.10）

### 决策 #53

- 写作 / 研究 Skill 区去掉「去能力管理」「存为 Skill」及管理向文案。
- **引入** = 下拉选用某一 Skill（写入场景 activeSkill，影响后续回答方式）；选「未引入」恢复默认。
- 新建 / 删除 / 「引入到场景」仅在「能力 → Skill」。

---

## 2026-07-14（写作采用为成果 + 能力页 Skill 区 · v0.3.9）

### 决策 #52

- Skill 与工具能力（MCP）分层：能力页统一管理；场景只选用。
- 弃用「流程配方 / 办事配方」用户面说法，恢复 **Skill** + 一句白话说明。
- 写作交互区补「采用为成果」写入右侧正文；发送按钮比例对齐研究。

---

## 2026-07-14（研究收口与引导注入）

- 完成标志：「标记完成」/「重开为进行中」（progress=write）。
- 参考材料添加有显式反馈；检索摘录去噪；下一步引导只注入输入框不自动发送。
- 研究 Skill：改回答方式而非课题；自建入口收口至能力页（见 #53）。
- 发送按钮高度与输入框对齐。

---

## 2026-07-14（研究三栏 + 会话持久化 · v0.3.8）

### 决策

- **#51**：研究主界面对齐写作式三栏；对话写入 threads；「开始新研究」取消自动粘连到上次课题。

### 根因

- 状态条常显上一课题：因 `activeId` 自动恢复，列表却藏在「更多」里。
- 离开再回丢对话：`researchMessages` 仅内存，打开课题时被清空。

---

## 2026-07-14（写作空白稿优先 · v0.3.7）

### 决策

- **#50**：写作主路径改为空白稿优先；模板折叠次要；无文稿发送自动建 `general` 文稿。

### 变更

- 左栏：新建文稿 + 文稿库置顶；按文种模板默认收起。
- 中间可直接描述要写什么；右侧空白可编。

---

## 2026-07-14（对标法 + 研究 85% 路线 + 成果稿布局）

### 决策

- **#49**：功能开发采用对标法（审视→对标→量化→适配→规格→实施→验收）；研究 85% 路线写入规格 §5.3.2。
- **第三方优先**：检索/读网页/Agent 有成熟 MCP·Skill·Agent 则导入；Digital Me 负责主体层（像我、授权、审计）与动态能力管理。

### 研究 v0.3.4–v0.3.6（已交付）

- **v0.3.4**：Brave 主选 + DuckDuckGo 兜底；进入研究自动准备 fetch；「调研并回答」检索入库 + 工具轨迹。
- **v0.3.5**：四步 Agent 循环（`research/agent-loop.js`：澄清→检索→读源→成果）；预置 Skill（通用调研/快速简报/深度核对）。
- **v0.3.6**：有材料 grounded 校验（导出/送写作/对话后提示）；本地文件作材料；主路径「结论与依据」可展开。

### UI

成果稿区：可拖动分栏调整高度；「展开编辑」放大成果稿便于审核修改；记住用户比例。

---

## 2026-07-14（研究简化补强：下一步引导 + 成果稿 + 时间基准）

### 起因（用户反馈）

简化后默认页只剩输入框，用户「不知如何推进」；「当前稿」作用不清；模型时间推断错误（凭空推「未来 24 个月 = 2025 中–2027 中」）。

### 本次完成

1. **时间基准**：系统提示注入「今天是 …」日期锚点（`buildSystemPrompt`），涉及「今年/未来 N 个月/最新」以此为准。
2. **下一步引导**：默认页在输入框上方加轻量「下一步」建议条，随状态变化（起步：理清问题/该找材料/先给初步分析；已有答复：追问/换角度/采用为成果/加材料或核对）；点击即执行，非满屏 chip 墙。
3. **「当前稿」改名「成果稿」**：明确「你想留下、用于导出的那一版」；答复按钮「存为当前稿」→「采用为成果」，可累积汇入。

### 验收

零材料输入问题 → 得答复 → 点「下一步」的追问/换角度可继续 → 「采用为成果」汇入成果稿 → 复制/导出；时间相关问题不再出现错误年份。

---

## 2026-07-14（研究/写作主路径简化 · A 方案 · v0.3.3）

### 本次目标

研究默认同页问答与导出；材料与严格核对渐进披露；「到写作改稿」可选；写作减载。

### 对标

Perplexity 类：问一句即得带引用答复、同页可用；NotebookLM 类：来源核对放进阶「更多」，不作第一道墙。

### 验收

1. 零材料：输入问题 → 得答复 → 同页导出，无阻断；导出含「初步/待核实」声明。
2. 「更多」内可加材料、对照核对；有材料后状态为「有依据」。
3. 「到写作改稿」在「更多」内，非必经。
4. 对话链接可一键添加为参考材料（fetch 可用时可抓摘要）。

---

## 2026-07-14（研究 · 送到写作路径简化）

### 本次完成

1. 研究页「送到写作」从三处入口合并为右侧唯一成文区；
2. 有材料 →「送到写作（研究成文）」；无材料 →「送出计划稿」（确认后送出）；
3. 对话回复仅保留「复制 / 存为整理」；帮助与规格 §5.3 同步。

### 验收

理清问题 → 存为整理 → 右侧「送出计划稿」应确认后进入写作；添加材料后按钮变为「送到写作（研究成文）」。

---

## 2026-07-14（写作 / 研究精修一轮）

### 本次目标

两个已点亮场景可用性收口：文案对齐、无材料不成文门闩、中文映射、写作改稿防协议泄漏。

### 本次完成

1. 研究：去掉「起步」空指引；正式「送到写作」无材料拦截；结论支持度 / 整理类型中文化；进度「材料」统一；
2. 写作：快捷意图与新建提示去技术用语；改稿回复剥离工具协议泄漏；导出按钮白话；
3. 帮助页补充研究主路径说明。

### 验收清单

**写作**：模板新建 → 改简洁/润色（输入为白话）→ 保存 → 导出 Word / 文本。
**研究**：理清问题 → 无材料点正式「送到写作」应拦截 → 添加材料 → 结论与依据为中文 → 存为整理 → 送到写作。

---

### 本次确认（原则，升为强制）

1. **用户面文案**：严谨明白，面向用户与使用场景；禁止把讨论腔、开发技术名词、口语化用词带入默认产品。
2. **Owner 想法 = 提议与线索**：可能错误或非最优；AI 须审视 → 对标最佳实践 → 按 Digital Me 修正 → 规格/决策 → 实施 → 检测与审计。

### 规范落点

- `digitalme_product_spec_v0.2.md` §2.12 强化、新增 §2.14；§2.1 速查表补充禁止项
- `digitalme_context.md` §5.4 强化；决策 **#47**
- `.cursor/rules/product-development-process.mdc` 重写为 alwaysApply（文案 + 开发流程）

### 同日工程摘要（研究）

1. v0.3.2 ResearchNotebook 收敛（材料优先；无材料可起步规划，有材料再整理）；
2. 修复：起步区无按钮、「理清问题」等静默无响应、核对文案露出内部字段、DSML 协议泄漏到对话；
3. 对话成果：复制 / 存为整理 / 送到写作。

### 下次建议

研究路径再走通一轮验收（无材料起步 → 添加材料 → 整理 → 送到写作）；继续清理用户面残留内部用语。

---

## 2026-07-13（研究对标纠偏 · ResearchNotebook · v0.3.2）

### 本次目标

承认 v0.3.1 六阶段向导偏离业界主路径；落地协作规范与来源集优先的研究定义，并收敛实现。

### 本次完成

1. Cursor 规则：对标→适配→规格→开发；Owner 意见视为假设；
2. 规格 **v0.3.2** / 决策 #46；§5.3 重写为 ResearchNotebook；
3. 数据模型兼容迁移（materials→sources，草稿/框架→artifacts）；
4. 研究页收敛：来源主栏、来源动作、综合物、可选进度、主张–证据；无来源不能送到写作。

---

## 2026-07-13（研究课题流水线 + 本人 Skill · v0.3.1）

### 本次目标

研究不再复用写作模板；落地课题流水线与跨场景本人 Skill 最小闭环。

### 本次完成

1. 规格 **v0.3.1** / 决策 #45；
2. ResearchProject 存储与独立研究页（阶段条）；
3. 质检三件套与方法包入口；
4. 本人 Skill 存为/启用（写作·研究）。

> 注：流水线主路径已由 v0.3.2 纠偏为来源集优先。

---

## 2026-07-13（对话标准体验 + 工作台命名 · 跟进）

### 本次完成

1. 侧栏「做事」改为「工作台」；对话去掉右侧深预览与「我现在能做什么」；
2. 助手回复增加「复制」「送到工作台」；
3. 写作模板说明：新建为提纲骨架（非空白）；研究报告骨架文案加厚。

---

### 本次目标

采纳 IA 重构：对话减压；做事按场景；写作合并为唯一交付面；取消独立「产物」顶栏与跨栏导送。

### 本次完成

1. 规格升 **v0.3**（§2–§5 IA）；决策 #44；
2. 侧栏：对话 | 做事 | 我 | 能力；
3. 做事目录：写作/研究点亮，编程/视频/音频/定时/学习筹备中；
4. 写作三栏：文稿库 + 改稿对话 + 正文导出；
5. 对话「留为文稿」进入做事·写作同一条；去掉送入/打开跨栏流程。

### 验收建议

1. 对话轻问答 → 有长文时「留为文稿」→ 应进入做事·写作且为同一条；
2. 做事 → 写作：模板新建后同页改稿并导出 Word；
3. 做事 → 研究可用；筹备中场景仅说明、不假可用。

---

## 2026-07-13（成稿 ↔ 产物库双向打通 · v0.2.17）

### 本次目标

把「对话成稿」做成可交付闭环：工作台 ↔ 产物库可来回改、可覆盖存回；模板新建直达成稿，缩短「能做事」路径。

### 本次完成

1. 成稿可关联产物库条目：`送入` / `存回` / `另存为新产物` / `在产物库打开`；
2. 产物「在工作台打开成稿」：挂回右侧预览（全文），而非只塞输入框；
3. 成稿标题与正文可直接编辑；产物标题可改；
4. 模板新建默认打开到工作台成稿预览；
5. 规格 **v0.2.17**。

### 仍远的「能做事」（下次主刀）

本闭环解决交付物存放，尚不足以替代专业工作台。建议下一刀：

1. **任务式执行**：从场景/模板到多步工具调用直到成稿就绪（少来回追问）；
2. **编程等能力跟随导入**（Claude Code/Codex 类，跟随不自研）；
3. 高风险动作确认与工具轨迹可读化加深。

### 验收建议

1. 工作台成稿 → 送入产物库 → 在产物打开 →「在工作台打开成稿」→ 改字 → 存回，确认为同一条；
2. 产物页点「研究报告」模板 → 应回到工作台并看到骨架成稿。

---

## 2026-07-13（线 B 能力跟随起步 · v0.2.16）

### 本次目标

主精力转向线 B：写作等开箱场景可在对话中真正用上推荐能力；并对内展示「我现在能做什么」。

### 本次完成

1. 场景包扩展：`recommendedExtensions` + `systemHint`；点击后自动启用并连接（免密钥项）；
2. `chat:send` 注入当前场景约定；
3. 对内能力面：工作台折叠面板 +「数字之我 · 概览」卡片（工具就绪态 / 场景 / 可写产物）；
4. 规格与战略优先级更新为 **v0.2.16**。

### 验收建议

1. 工作台点「写作表达」→ 提示能力已准备 → 附链接或本地主题发送 → 观察是否调用网页/文件能力并出成稿；
2. 打开「我现在能做什么」与概览卡片，确认就绪状态一致。

### 待办事项（下次）

1. 产物库与场景更深联动（模板一键）；
2. 编程等更多场景跟随导入；
3. Agent Card 人读版与对外展示仍分期。

---

## 2026-07-13（材料列表 · 文案原则 · 评测选项化 · v0.2.15）

### 本次目标

1. 降低待处理材料列表占位；2. 用户面文案严谨明白并写入原则；3. 自评减少开放题负担。

### 决策

1. **列表**：待处理全部展示为紧凑行（操作在行尾）；已写入默认折叠，不占主视野。
2. **文案**：写入规格 §2 第 12 条——禁止研讨腔、口语化、技术化直出界面。
3. **评测**：开放题非必须；v0.3 以单选/多选/高低分为主，理由改为可选一句。

### 本次完成

1. 待处理材料紧凑行 + 已写入折叠；可读文件夹同行布局；
2. 构建页/帮助/缺口/归类标签改写为用户面用语；
3. `intake-questions.json` → **v0.3**，渲染支持 single/multi/scale/open；
4. 规格 **v0.2.15**；问卷文档同步。

### 待办事项（下次）

1. 线 B：能力跟随落地；
2. 试用反馈：选项化后「像你」主观评分是否下降。

---

## 2026-07-13（履历 + 评测冷启动 · v0.2.14）

### 本次目标

用「履历 + 评测」搭起数字之我大致框架；评估并精修评测/问卷代表性与信息量。

### 评估结论（v0.1 → v0.2）

- 旧问卷：大五过薄、Schwartz 未落地、情境理由强调不足、访谈过长、无履历时缺人生骨架、门槛「≥3 任意题」过松。
- 精修后：结构仍对齐 Big Five / Schwartz / SJT / GDMS，但用白话短题；对「大致框架」信息量够用，后续靠材料加深。

### 本次完成

1. 题库 `intake-questions.json` → **v0.2**（大五+可选补一句、价值 Top3/底线、决策习惯、情境起步≥3、人生骨架、表达与边界）；
2. 构建页「起步双材料」引导 + 快捷投入/去填评测；
3. 评测进度提示与最低完成门槛；蒸馏文案与 followup 写入；
4. 覆盖度薄包缺口改为履历+评测；帮助 tip / FAQ 同步；
5. `digitalme_intake_questionnaire.md` 升 v0.2；规格 **v0.2.14**。

### 待办事项（下次）

1. 线 B：能力跟随落地；
2. 试用：冷启动双材料路径完成率与「像我」主观评分。

---

## 2026-07-13（页内说明与悬浮提示 · v0.2.13）

### 本次目标

降低「构建 / 数字之我」理解门槛：页内帮助说明 + 关键点悬浮提示；其它栏目同步轻量入口。

### 本次完成

1. 「我 / 工作台 / 产物 / 能力」页头增加「说明」按钮；
2. 帮助弹窗（白话）：一分钟看懂、构建原理、数字之我、常见问题；
3. 关键点「?」与按钮悬浮提示（投递箱、智能构建、覆盖度、自动采纳、时间线、边界等）；
4. 规格 **v0.2.13**。

### 待办事项（下次）

1. 线 B：能力跟随落地；
2. 按试用反馈补更多 tip / 帮助条目。

---

## 2026-07-13（线 A 加深 · v0.2.12）

### 本次目标

智能构建质量（误分类 / 截断 / 像我校验）+ 认知页校对体验。

### 本次完成

1. **归类冲突**：规则 vs 模型不一致时保守处理（custody 优先，其余强制待定），队列标「归类待确认」。
2. **截断**：智能构建改为头尾采样；队列写入 `processMeta`（截断模式/字数/段数）；进度与列表可见。
3. **像我校验（最小切片）**：蒸馏后按原文词面重合过滤疑似编造条目（非完整 Reviewer Agent）。
4. **认知校对**：近 48h「本批自动采纳」可撤销；低把握推断行内改正；关系人候选置顶；成就/机构可跳转时间线。
5. 规格 **v0.2.12**。

### 待办事项（下次）

1. **线 B**：能力跟随落地（场景包 + 精选能力导入）；
2. 像我校验加深：对照原文的 LLM 质检 Agent；
3. 投递箱后置：同文拆段、增量扫描、邮件/微信渠道。

---

## 2026-07-13（构建体验精修 · v0.2.11）

### 本次目标

落实线 A 下一项：「我 · 构建」体验精修（文案、主按钮层级、进度摘要少刷屏、结束后一键进数字之我）。

### 本次完成

1. **主路径清晰**：①投入文件 → ②智能构建（主按钮）；「仅整理 / 审阅」收入「更多方式」。
2. **队列可见**：投递箱顶部显示共/待处理/可构建/待定/已写入摘要。
3. **进度摘要**：标题 + 当前一步 + 计数；明细折叠，避免刷屏。
4. **完成后 CTA**：绿色横幅「查看数字之我」，滚动定位并聚焦。
5. 规格升至 **v0.2.11**；文案副标题改为「投材料养我 · 在数字之我查看与校对」。

### 待办事项（下次）

1. **线 A 加深**：智能构建质量（误分类、截断、像我校验）；认知页校对体验；
2. **线 B**：能力跟随落地 / v0.3 产物场景包；
3. 投递箱后置：同文拆段、增量扫描、邮件/微信渠道。

---

## 2026-07-13（四板块推进共识入库）

### 本次目标

评估「数字之我构建 / 能力跟随 / 协作雏形 / 快速启动」思考，将有价值且可行部分写入战略与规划。

### 本次完成

1. `digitalme_context.md`：新增 §2.0.1 四板块、§2.6 构建精修指标、§7.11 能力跟随、§7.12 协作服务面、§7.13 冷启动取舍；结论 #19–#22；决策 #36–#39；更新 §7.1 优先级。
2. 同步 `digital-me-project-positioning-draft.md`（原则 11–13、§十二/十五）、`digitalme_narrative_ai_era_autonomy.md`（开篇节奏）、`digitalme_mvp_scope_v0.1.md`（Out of Scope 补强）。

### 当前关键结论

- **采纳**：构建三低成本+准确一致；能力跟随导入；协作展示→可雇佣分期；关系导入与认领式预生成。
- **有限采纳**：名人/digitalhe 示范包。
- **暂缓**：Soulmate/恋爱匹配作增长主路径。

---

## 2026-07-12（双线指导思想入库）

### 本次目标

将「数字化构建人 / 主体化数字实体并支撑双世界存在发展」确立为系统推进建设的指导思想。

### 本次完成

1. `digitalme_context.md` 新增 §2.0「系统建设双线指导思想」；决策 #34。
2. 同步 `digital-me-project-positioning-draft.md` 战略原则第 10 条、`digitalme_narrative_ai_era_autonomy.md` 开篇说明。

### 当前关键结论

A（真实动态之我 + 自我管理/发展条件）为根基；B（主体性实体 + 主动产出与协作体验）为伸展；立项须标明服务哪条线。

---

## 2026-07-12（人模型富化 + 认知面板）

### 本次目标

1. 将材料从「归档」升级为可调用的人模型（通用 PersonEnrichment，非单一点状特例）；
2. 在「我」增加自我认知面板与分析简报入口。

### 本次完成

1. `builder.js`：PersonEnrichment 契约 + 材料信号词典（活动/履历/成果/论述/凭证）；文件名种子富化举一反三。
2. `life.js`：写回 outcomes / domains / org_touchpoints / people / capability_signals / mind_hooks / inferences；扩展 prompt 摘要与认知快照。
3. `retrieval.js`：人生切片纳入工作台检索。
4. 「我 · 认知」UI：观念 / 成就 / 社会关系 / 能力边界 + 生成自我认知简报（产物库）。
5. 规格同步至 v0.2.8；决策 #33。

### 当前关键结论

收录材料的终点是**可授权、可调用的自我模型**，不是个人文件柜；关系严格区分「关系人」与「机构触点」。

---

## 2026-07-08（第 1 次记录）

### 本次目标

1. 补强 Digital Me 与他人/其它 Agent 的交互定义、架构与功能规划；
2. 明确“区块链是否作为主技术底座”的阶段结论；
3. 建立项目上下文与持续日志机制。

### 本次完成

1. 更新 `digital-me-project-positioning-draft.md`：
   - 新增交互定义（Owner / Human Peer / External Agent / Platform）；
   - 新增 Interaction Contract 最小可信交互单元；
   - 扩展阶段路线（v0.6-v0.8）覆盖协作协议、交易闭环、网络试点；
   - 明确区块链为可插拔增强层而非主运行底座。
2. 更新 `digital-me-package-v0.1-data-structure-draft.md`：
   - 新增 `contracts/`、`commerce/`、`trust/` 数据结构建议；
   - 新增协作与交易相关 JSON 字段草案；
   - 明确链上锚定为按需可选能力。
3. 更新 `aivestor-to-digital-me-capability-abstraction-draft.md`：
   - 新增协作能力、交易能力、网络能力的分层规划；
   - 新增 MVP 功能清单（授权控制台、交互网关、计量结算账本）。
4. 新增 `digitalme_context.md`：
   - 沉淀项目背景、目标计划、主要结论、人与 AI 协作机制、风险与下一步。
5. 新增 `digitalme_log.md`：
   - 建立持续记录模板与首条工作记录。

### 当前关键结论

1. 进入系统开发是可行的，但前提是先锁定协议、权限、结算与合规边界；
2. 区块链不应作为主技术底座，当前更适合作为确权存证与清结算增强层；
3. MVP 应优先验证“可控协作 + 可审计交易”闭环，而非先做大规模网络。

### 待办事项（高优先级）

1. 明确 MVP 场景（优先 1-2 个）；
2. 定义角色与权限矩阵（Owner / Caller / Platform / Auditor）；
3. 固化 Interaction Contract 字段与版本策略；
4. 定义计量计费模型与结算周期；
5. 补齐安全合规基线（隐私、内容责任、关键动作审批）。

### 待确认问题

1. 初始目标用户优先级：创始人 / 投资人 / 顾问 / 写作者；
2. 部署形态：本地优先 + 云同步，还是先云托管；
3. 商业模式优先级：按次调用、订阅授权、成果分成；
4. 链上策略：不上链、仅哈希锚定、凭证上链、结算上链。

### 重要信息

1. 高风险动作默认必须人工确认；
2. 默认最小化数据暴露，不输出完整私有记忆；
3. 任何外部调用都应可审计、可撤销、可追责。

### 用户已确认（同日补充）

1. MVP 场景：创始人协作与决策助理；
2. 部署策略：本地优先 + 云同步；
3. 区块链定位：可选哈希锚定，不作为主底座；
4. 商业模式：按次调用计费；
5. 高风险控制：一律人工确认。

---

## 2026-07-08（第 2 次记录）

### 本次目标

1. 根据用户澄清修正 MVP 方向：商业场景不清晰、不作为驱动力，核心是"蒸馏 + 动起来"；
2. 将新思路落入项目上下文与 MVP 范围文档。

### 用户澄清要点

1. **商业应用暂无清晰场景**：协作与交易是从个人主权、数据主权出发的架构性准备。像"机构付费获得个人数据授权用于模型训练"这类场景理论可行，但无先例、有认知与习惯障碍，只做条件规划，不做预测；
2. **MVP 主目标**：把人蒸馏进 Digital Me，成为明确的自己的数字之我，并让它在数字世界中动起来；
3. **两种"动起来"方式**：
   - 映射循环：持续收集人的数据（行为、成果、生理、情感等），成为人及人的工作生活的映射（数字孪生）；
   - 应用循环：人主动应用 Digital Me 吸收信息、产出产物；
4. **功能策略**：Digital Me 不自己开发功能，以 AI 为底座，可安装任意市场可用能力，灵活适应任何数字任务；
5. **相对独立性**：Digital Me 具备按预定规则对外界信息进行反馈调整的能力，是超越于人的相对独立存在（受规则与授权约束）。

### 本次完成

1. 更新 `digitalme_context.md`：
   - 新增 MVP 核心目标（三循环：映射、应用、反馈）；
   - 运行层架构补充 Data Ingestion Pipeline、Capability Installer、Feedback Rules Engine；
   - 主要结论补充"商业场景不作为 MVP 驱动力""能力安装而非功能自研"；
   - 调整阶段计划与已确认决策，交易能力降为架构预留；
2. 新增 `digitalme_mvp_scope_v0.1.md`：
   - 定义 MVP 三循环目标、In Scope / Out of Scope、验收标准草案、待明确问题。

### 待办事项（高优先级）

1. 确定映射循环首批数据源（文件夹、日历、笔记、聊天等）；
2. 确定能力安装技术路线（MCP / Skill 文件 / 兼容两者）；
3. 确定反馈规则表达形式与安全边界；
4. 确定 Runtime 宿主形态（桌面应用 / CLI 服务 / 依托现有 Agent 框架）；
5. 基于 MVP 范围文档拆解开发任务与技术选型清单。

### 重要信息

1. 用户明确表示当前思考尚不成熟，按现有想法推进，允许后续修正；
2. 交易/协作相关设计全部标注为"架构预留"，避免占用近期开发资源。

### 用户已确认技术方向（同日补充）

1. 首批数据源：本地文件夹 + 聊天/对话记录 + 日历与邮件；
2. 能力安装：MCP 优先，兼容 Skill 文件；
3. 反馈规则：自然语言编写，系统编译为结构化 policy；
4. Runtime 宿主：先依托现有 Agent 框架验证，后独立化。

### 补充结论："输出像我"的技术路径（同日）

1. 采用四层组合：蒸馏文件（骨架）+ 素材向量化（血肉）+ 示例检索（语感）+ 反馈回流（进化），MVP 阶段无需微调即可达到较高还原度；
2. 向量索引定位为可重建的衍生物，存本地缓存，不进 Package 核心；
3. 微调（LoRA 等）保真度最高但绑定模型、与平台中立冲突，暂不采用；
4. 已建立 `source-materials/` 原始素材库目录（books/articles/conversations/projects/media/misc），用户著作放入 `books/`。

---

## 2026-07-08（第 3 次记录）

### 本次目标

1. 根据用户决策调整产品路线：不再"先借框架验证"，直接开发独立容器产品。

### 决策与理由

1. 用户判断：Cursor 验证结果基本可确定，既然迟早要有自己的容器，直接从相对完整形态的产品开始，产品感觉也更直观；
2. 补充论证：产品核心部件（数据采集循环、反馈规则引擎、审计账本、授权管理）在借用框架中本就无法实现，"先借后建"只是推迟必然要做的事；
3. 代价共识：交付周期从"几天验证"变为"数周得到首版产品"，因此采用"架构完整、功能切片"策略。

### 已确认

1. 产品形态：本地桌面应用（Digital Me App）；
2. 首版切片：优先"蒸馏 + 应用"循环，映射循环与反馈循环分批点亮；
3. Cursor 角色：从运行宿主调整为开发工具；
4. 既有规划全部复用：Package v0.1 为内核数据规格，source-materials/ 为素材接入点，"四层像我"为输出引擎设计。

### 本次完成

1. 更新 `digitalme_mvp_scope_v0.1.md`：产品形态决策、Digital Me App v0.1 功能清单（Builder、像我引擎、任务工作台、MCP 能力安装、基础审计、分层导出）、建议技术栈、开发准备任务；
2. 更新 `digitalme_context.md`：已确认决策新增产品路线条目。

### 待办事项（高优先级）

1. 确定技术栈（桌面壳 Tauri/Electron、本地存储、向量方案）并搭建应用骨架；
2. 等待用户将著作放入 `source-materials/books/`，实现 Builder 并完成首次蒸馏；
3. 实现"像我"引擎与任务工作台，以用户日常任务实测；
4. 反馈规则编译（自然语言 → policy JSON）预研。

---

## 2026-07-08（第 4 次记录）

### 本次目标

1. 用户确认"开始"，进入实际开发：处理已放入的著作素材，完成首次蒸馏，搭建桌面应用骨架。

### 本次完成

1. **素材提取**：编写 `scripts/extract-docx.mjs`（纯 Node 解析 docx zip，规避中文路径与控制台编码问题），从 `source-materials/books/` 的著作提取全文至 `build/book-renxing.txt`，共 52.07 万字。
   - 书名：《中国的政治与经济……当代中国现状与智能时代前瞻》（三稿修改版 202606 V1.0）；
   - 结构：引言 + 四章（政治经济理论框架 / 中国的政治经济 / 实证研究 / 智能时代人类的政治与经济）。
2. **通读与理解**：采样通读引言、第一章理论框架、第四章智能时代章节，把握作者的知识结构、思维方式与表达风格。
3. **首次蒸馏**：生成第一版 `digital-me-package/`，含 manifest、identity、persona、style-guide、preferences、decision-frameworks、memory（10 条长期记忆）、skills（政治经济分析）、sources（登记著作）、policies、prompts（system-prompt）、README。全部 JSON 校验通过。
4. **应用骨架**：搭建 `digitalme-app/`（Electron + 原生前端，依赖最小化）。已实现：加载 Package、组装"像我"系统提示词、任务工作台对话、OpenAI 兼容模型网关、本地设置保存。
5. 素材库 `source-materials/` 已投入使用（著作在 books/）。

### 蒸馏结论

1. 单一著作即可较可靠地蒸馏出表达风格、判断框架与核心立场（政治经济、智能时代、开放审视三套框架）；
2. 待补充维度：日常偏好、人际关系、非政治经济领域判断、口语化表达——需更多素材类型进入后续蒸馏。

### 待办事项（高优先级）

1. 用户在 App 设置中填入模型 API Key，实测"像我"对话效果，给出修正反馈；
2. 在云盘同步排除下 `npm install` 并运行 App（node_modules 较大，注意同步冲突）；
3. 将手工蒸馏流程沉淀为 App 内的 Builder（自动化）；
4. 接入素材向量化 + 原文示例检索，提升风格还原度；
5. 补充更多素材（文章、对话记录、项目资料）扩展记忆与判断维度。

### 重要信息

1. 著作原文为高敏感私有素材，仅本地持有，默认不随 Package 对外导出；
2. `manifest.json` / `identity.json` 中的 ownerDisplayName 仍为占位符"（本人姓名待填）"，待用户填写；
3. App 的 API Key 仅存本机 userData，不进云盘。

---

## 2026-07-08（第 5 次记录）

### 本次目标

1. 填入本人姓名；
2. 把手工蒸馏逻辑做进 App 的 Builder（自动处理下一份素材）；
3. 回答素材类型与"无书之人"的蒸馏方案问题。

### 本次完成

1. 姓名落定：manifest / identity / persona 中的 ownerDisplayName 更新为"张元林"。
2. **Builder 落地**（`digitalme-app/src/builder.js` + main/preload/renderer 接线）：
   - 通用文本提取：.docx（纯 Node 解 zip）/ .txt / .md；
   - 分块（默认 12000 字/段）；
   - 逐段调用模型 + 结构化蒸馏提示词，输出 styleObservations / personaNotes / decisionFrameworks / memories；
   - 客户端聚合去重；
   - Package 回写：记忆追加到 long-term-memory.jsonl（自动生成 id、登记 sourceRefs）、框架去重后并入 decision-frameworks.json、风格/人格观察以"增量蒸馏观察"区块追加、来源登记到 source-index.json；
   - UI：任务工作台 / 蒸馏 Builder 双视图，导入→进度→审阅→确认写入闭环。
   - 核心逻辑已用书稿实测：提取 52 万字、分块 45 段、解析/聚合正常。

### 待办事项

1. 用户提供更多素材，用 Builder 实测端到端蒸馏与写入；
2. 接入向量化 + 示例检索；
3. 蒸馏结果逐条勾选写入 / 冲突合并；
4. 设计"无书之人"的结构化问卷与测评（见下）。

### 重要信息

1. 大部头会产生数十次模型调用，Builder 更适合中小素材；著作已手工蒸馏，无需再跑；
2. 风格/人格观察以增量区块追加，便于后续人工整理，避免自动覆盖既有精炼内容。

### 待办：素材类型与无书之人蒸馏方案（本次已向用户答复，后续落成文档）

1. 有效素材类型清单（写作类 / 对话类 / 决策类 / 行为类 / 关系类 / 生理情感类）；
2. 无完整著作者的结构化采集：分领域问卷 + 情境测评 + 半结构化访谈 + 作品反推，形成 `digitalme_intake_questionnaire`（待建）。

---

## 2026-07-08（第 6 次记录）

### 本次目标

落成初次采集问卷，并在 Builder 中加入"问卷采集"入口，让无现成素材者也能完成初次蒸馏。

### 本次完成

1. 新增 `digitalme_intake_questionnaire.md`：四层采集方法论（标准化测评 / 情境判断 / 半结构化访谈 / 作品行为反推），引用大五 IPIP、Schwartz 价值观、GDMS 决策风格，强调多源交叉验证与自我报告偏差。
2. 新增 `digitalme-app/src/intake-questions.json`：结构化题库（自评 5 + 情境 7 + 访谈 11）。
3. Builder 扩展：
   - 主进程重构出 `distillFromText` 共享管线，`builder:distill`（文件）与 `intake:distill`（问卷）复用；
   - 新增 `intake:questions` / `intake:distill` IPC 与 preload 暴露；
   - 渲染层新增"导入素材 / 问卷采集"模式切换、问卷作答界面（量表按钮 + 开放文本）、复用审阅→写入闭环；
   - 问卷回答格式化为 Q&A 文本后进入同一蒸馏流程，来源登记为"初次采集问卷"。
4. 验证：题库解析与 Q&A 格式化逻辑本地测试通过。

### 待办事项

1. 用户用问卷或新素材实测端到端蒸馏与写入；
2. 向量化 + 示例检索；
3. 蒸馏结果逐条勾选写入 / 冲突合并；
4. 情境题按用户领域定制化；边界类回答（"绝不要替我做的事"）自动写入 policies。

### 重要信息

1. 问卷可只填部分（渲染层要求至少 3 题）；所有回答本地私有，仅蒸馏结果入 Package；
2. 边界类问题（i_boundary）目前进入 memory/persona，后续可专门映射到授权与高风险边界策略。

---

## 2026-07-08（第 7 次记录）

### 本次目标

用户在 articles/ 加入约 82 个文件，进一步蒸馏；用户确认对话已能引用其观点。

### 本次完成

1. 生成 `build/articles-inventory.md`：82 个文件分类（68 可直接蒸馏 docx/txt/md、5 旧 .doc、7 pdf/pptx/html、1 媒体）。内容维度：文化产业投资、区块链/数字资产/版权金融/WEB3.0、人工智能与公共权力、党建与区块链、读书笔记、个人随笔。
2. 新增批量蒸馏脚本 `scripts/distill-batch.mjs`：复用 builder.js + 读取应用内 DeepSeek 配置，支持 build/distill-list.txt 选单或 --limit，自动跳过已登记来源，逐文件写回并登记 source。
3. 用 5 个多样化样本实测：数字资产 / 人工智能与公共权力 / 读书《哲学的故事》/ 春日乡聚有感 / 德性修养。累计写入：记忆+37、框架+8、风格观察+41、人格观察+41。source-index 现 6 条。
4. 修复 Builder 写入 bug：批量追加记忆时多加换行导致空行（52 行中 5 空行）。已改为按文件是否以换行结尾判断，并清理历史空行。当前记忆 47 条全部有效。
5. 抽查蒸馏质量：成功捕捉书里缺失的个人情感维度（家乡、王阳明、离乡回乡）与哲学思辨维度（道德泛化、理性与道德并重）。

### 待办事项

1. 是否全量蒸馏 articles 剩余约 63 个 docx（待用户确认，会消耗 DeepSeek 额度与时间）；
2. .doc / .pdf / .pptx / 音频 需转换或转写后再蒸馏；
3. 蒸馏结果人工整理：persona/style-guide 的"增量观察"区块条目较多，需提炼；框架有语义重复，需合并；
4. 向量化 + 示例检索；
5. 规划 Digital Me 输出能力扩展（见下）与"自建系统作为输入"的方案（见下）。

### 重要信息

1. 应用配置模型为 deepseek-v4-flash；批量脚本按需消耗额度，DeepSeek 单价低，全量成本可控；
2. 增量观察为追加式，不覆盖手工精炼内容，便于事后整理。

---

### 2026-07-08（第 8 次记录）：语义整合，建立"核心层 + 检索底料"双层结构

#### 本次目标

1. 将上一轮全量蒸馏产生的"高召回、低精度"内容（914 条记忆、170 个框架、~93KB persona 观察、~91KB style 观察）浓缩为高质量核心层；
2. 原始条目不丢弃，转为检索底料，为后续 RAG 做准备。

#### 本次完成

1. 新增 `scripts/consolidate.mjs`：备份 → 迁移原始为底料 → 调用 DeepSeek 做去重合并/结构化合成 → 写回原文件名（应用即读核心层，无需改代码）；
2. 判断框架：170 → **16 个核心框架**（`decision-frameworks.json` 228KB→20KB），原始存 `decision-frameworks-raw.json`；
3. 记忆：914 → 分 14 批去重（一次整合得 192 条）→ 跨批终合 → **30 条主题化核心记忆**（`memory/long-term-memory.jsonl`），原始 914 条存 `memory/raw-memory.jsonl`；
4. persona.md：93KB 观察堆叠 → **10.7KB 结构化人格卡**（保留原章节，增量观察归并入相应章节，含个人背景/价值观/表达方式/边界/待补充维度）；
5. style-guide.md：初次合成返回空白，已用 `scripts/consolidate-style.mjs`（带空返回重试与写入前非空校验）重跑 → **6.3KB 可操作风格指南**；
6. 修复 persona.md 中模型输出带来的 3 处坏字节（创/形/脉），全部产物 JSON/JSONL 校验通过、无残留替换符；
7. 原始四件套快照留存于 `digital-me-package/_raw/`。

#### 规模对比

- 核心层（对话时注入）：persona 10.7KB + style 6.3KB + frameworks 19.9KB(16) + core-memory 11.9KB(30) ≈ **49KB**；
- 检索底料（保留待 RAG）：frameworks-raw 223.5KB(170) + raw-memory 288KB(914)。

#### 待办事项

1. 接入向量化 + 检索注入（RAG）：对话时从 raw-memory / frameworks-raw 动态召回相关条目，补充核心层；
2. 应用侧可增加"核心层 vs 检索层"来源标注，便于回溯；
3. 核心记忆 30 条偏精简，后续可视对话效果适度上调（如 60–80 条）；
4. 蒸馏结果逐条勾选写入 / 冲突合并的交互；情境题按领域定制；边界类回答自动写入 policies。

#### 重要信息

1. 应用 `buildSystemPrompt` 读取的仍是 persona.md / style-guide.md / decision-frameworks.json / memory/long-term-memory.jsonl，因此整合后对话自动使用精简核心层，无需改动应用代码；
2. `_raw/` 与 `*-raw` 文件为可回滚的原始底料，勿删。

---

### 2026-07-08（第 9 次记录）：对齐业界互操作协议栈（A2A / MCP / AP2 / DID）

#### 本次目标

1. 调研智能体协作/交易协议的 2026 年最新格局与成熟度；
2. 将结论写入产品规划与架构设计（避免应用推广时返工）；
3. 把 Package 的交互契约/交易草案改造为对齐 A2A Agent Card 与 AP2 Mandate 的实际文件。

#### 调研结论（截至 2026-07）

1. 协议已收敛为 **Linux Foundation 治理的分层事实标准**：MCP（工具层，成熟）/ A2A（协作层，v1.0.1 生产可用，150+ 组织，IBM ACP 已并入）/ AP2+x402（交易层，60+ 伙伴，FIDO 标准化中）/ W3C DID（身份层）；
2. 信任基元是 **W3C 可验证凭证（VC）+ 密码学签名**，链只是 AP2/x402 的可选扩展——印证本项目"链非主底座"结论；
3. `Interaction Contract` 定位澄清为**内部授权编排层**，对外编译为 A2A Agent Card / AP2 Mandate / DID 锚定。

#### 本次完成

1. `digital-me-project-positioning-draft.md`：新增「十二点六、对齐业界互操作协议栈」（分层表 + 机制映射 + Interaction Contract 定位澄清 + 对 MVP 要求）；更新路线里程碑 v0.6/v0.7 与「十六、核心判断」的协作/交易/信任条目；
2. `digitalme_context.md`：新增「4.5 对齐业界互操作协议栈」；更新风险 #2（已由标准对齐化解）；新增已确认决策 #9；
3. `digital-me-package-v0.1-data-structure-draft.md`：第八节加更新说明，标注已落地对齐文件；
4. Package 新增/对齐实际文件（全部 JSON/JSONL 校验通过）：
   - `contracts/agent-card.json`（A2A v1.0 Agent Card 雏形，仅暴露最小能力面）
   - `contracts/interaction-contract-schema.json` + `interaction-contract.sample.json`（内部编排层，示例为机构付费调用场景）
   - `contracts/README.md`（对齐说明与"编译"关系）
   - `commerce/mandates/{intent,cart,payment}-mandate.sample.json`（AP2 三段 Mandate 链，W3C VC 表达）
   - `commerce/pricing-policy.json`、`commerce/settlement-records.jsonl`
   - `trust/chain-anchor.json`（可插拔链上锚定，默认关闭）、`trust/signature.json`（签名索引占位）
   - `manifest.json` 增加 `interop` 声明块（enabled 均为 false，架构就绪未启用）。

#### 待办事项

1. Runtime 阶段实现 Interaction Contract → Agent Card / Mandate 的"编译器"与对外网关；
2. 生成本人 DID 与密钥对，对 Agent Card / Package 做真实 JWS 签名；
3. 持续跟踪标准演进（A2A 版本、AP2 在 FIDO 的标准化进度、ANP/DID 融合）；
4. 接入 RAG（上一条主线待办）。

#### 重要信息

1. MVP 不实现 A2A/AP2 运行时，但数据结构已对齐真实 schema，未来接入近零重写；
2. 所有 `.sample.json` 的 proof/signature/hash/txHash 均为占位。

---

### 2026-07-08（第 10 次记录）：接入 RAG 检索注入（本地词法检索）

#### 本次目标

1. 让对话在常驻核心层之上，按当前问题动态召回整合前的原始底料（914 记忆 + 170 框架）；
2. 保持提示精简但深度按需。

#### 本次完成

1. 新增 `digitalme-app/src/retrieval.js`：本地、无外部依赖的中文友好词法检索——
   - 语料：`memory/raw-memory.jsonl` + `decision-frameworks-raw.json`；
   - 分词：CJK 字符 bigram + ASCII 词；打分：TF-IDF-lite + 长度归一化；
   - 结果按 mtime 缓存；默认召回 6 条记忆 + 3 个框架，低于阈值不注入；
   - `renderContext()` 渲染为「相关背景（按当前问题从原始底料检索）」区块；
2. `main.js` 的 `chat:send` 接入：取最近一条用户消息 → 检索 → 追加到 system prompt 之后；失败静默降级（不影响对话）；
3. 真实问题实测：AI 治理/不平等、区块链稳定币文化出海等问题召回高度相关；语法与模块加载校验通过。

#### 设计取舍

1. v0.1 用词法检索而非向量嵌入：本地优先、平台中立、零依赖、离线可用；升级路径是把 `scoreDoc()` 换成嵌入余弦，索引结构兼容；
2. 词法对"语义相近但用词不同"的问题召回偏弱（如"长期经济增长"），但对口的核心框架本就在常驻核心层，RAG 仅补充深度，不影响正确性。

#### 待办事项

1. 可选升级为嵌入向量检索（需本地或 API 嵌入模型）；
2. UI 层可surface"本次参考了 N 条相关记忆"以增强可追溯（当前为后端透明注入，chat:send 仍返回字符串以不破坏渲染层）；
3. 下一主线：Runtime 的 Interaction Contract → Agent Card/Mandate 编译器（做 MCP 时同样先解释概念）。

#### 重要信息

1. RAG = Retrieval-Augmented Generation：先检索相关资料、再让模型据此生成，兼顾"精简提示"与"深度知识"，且知识来自本人底料而非模型臆造。

---

### 2026-07-08（第 11 次记录）：今日收尾与状态快照

#### 今日三项主要进展

1. **语义整合**（第 8 记录）：全量蒸馏结果浓缩为"核心层 + 原始底料"双层——核心层 30 记忆 / 16 框架 / 结构化 persona(10.7KB)+style(6.3KB)，约 49KB 常驻注入；原始 914 记忆 / 170 框架留存为检索底料；
2. **协议栈对齐**（第 9 记录）：协作/交易对齐 A2A / MCP / AP2 / DID 业界标准，写入定位说明与 context，Package 落地 `contracts/`、`commerce/`、`trust/` 对齐文件；
3. **RAG 检索注入**（第 10 记录）：本地词法检索按问题动态召回底料，接入对话管道。

#### 文档同步确认

- `digitalme_context.md`：已更新 4.4（整合+RAG 落地进展）、4.5（协议栈）、第 7 节（刷新优先级，新增 7.0 已完成 / 7.1 近期优先级）、风险 #2、决策 #9；
- `digitalme_log.md`：第 8–11 记录完整；
- 项目无 AGENTS.md（无需维护）。

#### 当前状态快照

- **能对话**：Digital Me App 可加载 Package、调用 DeepSeek、按人格+风格+框架+核心记忆+RAG 底料作答；
- **能蒸馏**：Builder 支持文件导入与问卷采集两条入口；
- **架构就绪未启用**：协作/交易/身份的标准对齐字段（enabled=false）。

#### 下一步（详见 context 7.1）

对话质量打磨与 RAG 调参 → 反馈回流 → MCP（数字员工手脚）→ 映射循环（数据采集）→ Runtime 编译器（Agent Card/Mandate）。

---

### 2026-07-08（第 12 次记录）：协议采用规模调研与接入次序留档

#### 本次完成

1. 调研 MCP / A2A / AP2 采用数据，写入 `digitalme_context.md` 新增「4.6 采用规模与接入次序」（标注日期与来源口径）：
   - MCP 约 9,600 可连接服务器、SDK 月下载约 4.2 亿；A2A 150+ 组织生产环境；AP2 60+ 伙伴；
   - 关键洞察：A2A 被主流框架/云平台原生支持，实际可协作面≈整个主流 Agent 生态，非 150 家名单；
   - 诚实注意事项：无权威全网 Agent 计数；宽口径 MCP 目录过半失效；"支持协议"≠"愿协作"；
2. 明确接入次序决策：**先 MCP → 再 A2A → 最后 AP2**，与 7.1 优先级一致。

#### 重要信息

1. 采用数据为 2026 H1 快照，日后需按来源复核（官方 registry、Linux Foundation 新闻稿等）。

---

### 2026-07-09（第 13 次记录）：清洗蒸馏乱码 + 写入前校验

#### 本次完成

1. `scripts/clean-corruption.mjs`：对 `raw-memory` / `core-memory` / `decision-frameworks*` 做上下文修复 + 删除不可修复条目；清洗前 217 处 `` → 清洗后 **0**（丢弃 raw-memory 3 条、frameworks-raw 6 个；备份于 `_raw/corruption-backup-2026-07-09/`）；
2. `builder.js`：新增 `hasReplacementChar` / `sanitizeDistillResult`；解析、聚合、写入各环节过滤乱码；
3. `main.js` 蒸馏循环：单 chunk 最多重试 3 次（空结果或含乱码时）；
4. `retrieval.js`：检索索引跳过仍含乱码的条目。

#### 重要信息

乱码主因是批量蒸馏时 API 返回/解析偶发丢字（非原始 docx 普遍乱码）。对话停顿偏长主因：每次请求注入约 **52KB** system prompt（核心层全量）+ RAG 追加 + **无流式输出**（须等整段返回）。

---

### 2026-07-09（第 14 次记录）：反馈回流最小版上线

#### 本次完成

1. 新增 `digitalme-app/src/feedback.js`：启发式归类（风格/记忆/边界/人格）→ 预览写入计划 → 确认后写回 Package；
2. 工作台：每条 AI 回复下增加 **「修正」** 按钮；弹窗两步（填写纠正 → 预览归类与写入内容 → 确认写入）；
3. 写回目标：`style-guide.md`（风格）、`memory/long-term-memory.jsonl`（观点/记忆）、`persona.md`（边界或人格）；带来源 `feedback` 与上下文（原问题+回复摘要）。

#### 使用方式

对不满意的 AI 回复点「修正」，写明「哪里不对/应该怎样」→ 预览 → 确认写入；**下次对话**自动加载新内容（无需重蒸馏）。

---

### 2026-07-09（第 15 次记录）：任务产出首项——演讲 PPT 生成

#### 本次目标

从「只能对话给提纲」进入「能交付可用成果」；首项场景：演讲 PPT。

#### 本次完成

1. 依赖 `pptxgenjs`；新增 `src/outputs/pptx.js`（JSON 幻灯片规划 → .pptx，含封面/内容页/结束页与演讲者备注）；
2. IPC：`output:planPpt`（带完整 Digital Me 上下文 + RAG）、`output:savePpt`（保存对话框）；
3. UI：侧栏 **「任务产出」** → 演讲 PPT 表单 → 预览 → 导出 PPTX；支持「从最近对话导入背景」；
4. 更新 `digitalme_context.md` 7.1 / 7.7。

#### 使用方式

侧栏「任务产出」→ 填主题（必填）→「生成幻灯片结构」→ 预览 →「导出 PPTX 文件」。可先在工作台对话生成提纲，再点「从最近对话导入背景」。

#### 待办

研究报告/备忘录等产出模板；能力扩展接入对话；PPT 版式美化；产出审计日志。

---

### 2026-07-09（第 16 次记录）：PPT 现状入档 + 能力扩展骨架

#### 本次目标

1. 将演讲 PPT v0.1 试用结论记入 `digitalme_context.md`，作为后续好用性/易用性升级任务；
2. 启动「能力扩展」（MCP Client）骨架：配置、连接、列工具、试调用。

#### 本次完成

1. **`digitalme_context.md`**：7.7 增补「演讲 PPT：现状与升级任务」（白底黑字、无模板、优先级：像我/内容 > 美化）；7.8 能力扩展命名与分工；7.1/7.5 用语统一为「能力扩展」；修复 7.6 章节标题；
2. **依赖**：`@modelcontextprotocol/sdk`；
3. **`extension-manager.mjs`**：stdio 连接、listTools、callTool、disconnectAll；
4. **IPC**：`extensions:getConfig` / `saveConfig` / `getStatus` / `connect` / `disconnect` / `listTools` / `callTool`；配置写入 `config.json` 的 `capabilityExtensions`；退出前 `disconnectAll`；
5. **UI**：侧栏 **「能力扩展」** → 扩展列表（连接/断开/查看工具/移除）→ 添加扩展表单 → 工具试调用面板；默认示例为官方 filesystem 服务（`文档/DigitalMe`）。

#### 使用方式

侧栏「能力扩展」→ 可选「保存配置」固化列表 → 点「连接」（首次会通过 npx 拉取 MCP 服务）→「查看工具」→ 选工具填 JSON 参数 →「试调用」。

#### 待办

1. 能力扩展接入对话（模型自动选工具）；
2. PPT 主题包 / 版式蒸馏 / 配图；
3. 能力扩展市场与一键安装（远期）。

---

### 2026-07-09（第 17 次记录）：能力扩展「应用商店」引导

#### 本次目标

解决「空列表 + 用户不知道去哪找 MCP」：做成精选商店 + 场景引导，让用户能真正武装 Digital Me。

#### 本次完成

1. 新增 `src/capabilities/catalog.js`：精选 7 项（本地文件、知识记忆、Brave 搜索、网页抓取、GitHub、SQLite、分步思考）+ 分类 + 引导文案 + 发现更多链接；
2. UI：引导步骤、分类 Tab、商店卡片（推荐/难度/场景说明）、启用弹窗（路径浏览 / API Key）、已启用列表；手动添加收进「高级」；
3. IPC：`getCatalog` / `enable` / `disable` / `pickDirectory` / `pickFile`；连接前自动创建 filesystem 目录；stderr 回传改善「Connection closed」排查；
4. 迁移旧 id `filesystem-demo` → `filesystem`；更新 `digitalme_context.md` 7.8。

#### 使用方式

侧栏「能力扩展」→ 看引导 → 在「新手推荐」点「启用」→（如需）填路径或密钥 →「连接」→「查看工具」。

#### 待办

对话内自动选用已连接扩展；远程目录同步；更多精选项与可信来源审核。

---

### 2026-07-09（第 18 次记录）：能力扩展定为体验优先主线

#### 重要信息

用户确认：能力扩展是体验感与获得感最强的触点之一，应花大力气设计功能与使用体验并持续优化。已写入 `digitalme_context.md` 7.8 产品原则 + 决策第 10 条；近期优先级第 4 项升为「体验优先，持续重投入」。

#### 后续体验优化方向（备忘）

启用即连或自动重连；消解「已启用未连接」认知负担；连接成功后的能力示例；对话内自动用工具；失败自助修复文案。

---

### 2026-07-09（第 19 次记录）：去技术摩擦战略 + 网页抓取零门槛

#### 重要信息

确认：MCP 安装配置门槛高是严重体验问题；**可以且必须大幅改进**——把协议细节藏进产品层。战略写入 `digitalme_context.md` 7.8（A 精选收敛 → B 安装器/状态机 → C 内置核心能力 → D 托管分发）及决策第 11 条。

#### 本次完成

1. 「网页抓取」改为 `npx mcp-fetch-server`（不再依赖 uvx）；已启用的旧配置自动迁移；
2. 启用成功后**自动连接**；
3. 引导文案改为强调「不用懂 MCP」。

#### 待办

应用内缓存扩展包；启动自动重连；内置读文件/抓网页；对话自动选工具。

---

### 2026-07-09（第 20 次记录）：人人可用为首要原则

#### 重要信息

用户确认并升格为**首要原则**：做让所有人（而非仅懂技术的人）都能用的产品；技术细节藏到后面；界面简单易懂；减少用户决策负担。已写入 `digitalme_context.md` §3 第 9 条、§3.1 交互体验总则、决策第 12 条；适用于全产品面。

---

### 2026-07-09（第 21 次记录）：API Key 类扩展归入高级

#### 重要信息

用户确认：需到原网站取得 API Key / 认证设置的能力，要么后台完成，要么不推荐给普通用户；所有需技术知识才能设置的功能归入高级。

#### 本次完成

1. 目录增加 `audience: general | advanced`；
2. **推荐区**仅保留：本地文件、网页抓取、知识记忆、分步思考（零配置）；
3. **高级扩展**折叠区：Brave 搜索、GitHub、SQLite + 手动添加 MCP；
4. 启用弹窗对高级项增加明确提示；原则写入 §3.1「认证后置」与决策第 13 条。

---

### 2026-07-09（第 22 次记录）：代理层愿景 + MCPB 调研 + 代码工具分路径

#### 重要信息

1. **代理层**：Digital Me 代用户完成 OAuth/API 对接，体验目标对齐「邮箱登录网站」——点连接 → 浏览器授权 → 回来即用，不见 Key/Token/MCP；
2. **用户分层**：无代码需求者少碰 GitHub 等；有代码/自动化需求者长期最重要，降摩擦持续进行；
3. **v0.3 待办**：MCPB 一键导入调研；GitHub OAuth 作认证代理最小试点。

已写入 `digitalme_context.md` 7.8 新小节与决策第 14 条。

---

### 2026-07-09（本我复现与全数据覆盖原则确立）

#### 本次目标

1. 将用户对 Digital Me 定位与蒸馏主线的战略共识落成文档，作为后续产品与算法迭代的固定参照。

#### 本次完成

1. 确立 **§2.4 本我复现与全数据覆盖原则**，写入 `digitalme_context.md`：
   - **定位**：尽可能复现人的真实状态，数字化重新武装后投身于数字世界；
   - **主线**：从可记录数据中蒸馏综合特征（风格、立场、框架、记忆、偏好、行为模式等）是本我复现的关键，当前以文本为主战场，须持续完善；
   - **远景**：处理与人有关的一切可记录可传递数据，无论单条价值量大小；终局为全量信息投入即得思想、意识与行为高度相似的数字之人；
   - **产品约束**：方向确定，实现分期；每阶段交付可用产品，按可行性、投入产出比、技术成熟度排序推进；
   - 与映射循环、Data Ingestion Pipeline、四层「像我」路径、问卷采集的架构关系已对齐；
   - v0.1 实现差距（仅 docx/txt/md）已诚实标注。
2. §4.4 增补与本我复现主线的交叉引用；§8 已确认决策新增第 15 条。

#### 待办事项

1. 落成「有效素材类型清单」文档（写作 / 对话 / 决策 / 行为 / 关系 / 生理情感）及各类型的适配与蒸馏策略；
2. 蒸馏主线近期：PPT/PDF 文本提取、录音转写接入、批量蒸馏工作成果类素材；
3. 蒸馏算法迭代：多源交叉验证、行为反推、矛盾信号处理；
4. Data Ingestion Pipeline 架构设计与首期切片（行为 / 日程类低摩擦信号）。

#### 重要信息

1. **方向与分期分离**：全数据覆盖是确定方向，不等于 v0.2 就要做完全部格式；优先高价值、高成熟度素材；
2. **蒸馏 ≠ 存储**：终局不是把全部原始数据塞进 Package，而是从全量数据中提取、校验、融合可复用的人格信号，原始素材本地持有、可追溯；
3. 用户明确：这不是纯试验，必须是可使用的产品——与 §2.4 产品可行性约束一致。

---

### 2026-07-09（分流管道与多模态呈现远景）

#### 本次目标

1. 将用户对「按数据类型分流处理 + 多模态输出」的理想架构落成文档扩展（今日仅文档，不写代码）。

#### 本次完成

1. 新增 **§2.5 分流管道、数字定义与多模态呈现**，写入 `digitalme_context.md`：
   - **输入理想态**：数据读入 → 格式适配 → 按类型分流至六条管道（认知蒸馏 / 行为信号 / 关系互动 / 生理状态 / 情感状态 / 形体与感官），各自生成不同数字定义，再融合为完整 Package；
   - **输出理想态**：从当前认知层（观点、价值观、风格、文本/文件）扩展至声音、相貌、动作、影音、感官/具身；典型场景含游戏、虚拟场景任务、数字医学；
   - **对称性**：形体管道输入既是数字定义来源，也是多模态输出素材；认知 + 形体 + 生理情感合一，方接近终局；
   - 含管道—定义对照表、输出层表、架构流程图；v0.1 差距逐项标注。
2. §4.2 Data Ingestion Pipeline、§4.4、§7.5 增补与 §2.5 的交叉引用；§8 已确认决策新增第 16 条。

#### 待办事项

1. Package v0.2 数据结构：为生理、形体、行为等数字定义预留 schema 占位（空模块 + manifest 声明），避免远期返工；
2. 认知管道近期：PPT/PDF 文本提取接入（蒸馏主线第一个格式扩展）；
3. 素材类型清单文档：六类输入与六条管道的映射细则。

#### 重要信息

1. **今日范围**：仅文档架构扩展；格式接入（PPT/PDF 等）留待下一工作会话；
2. 数字医学、游戏具身等输出场景属远期，须单独评估合规与伦理边界（尤其医疗决策、生物特征授权）。

---

### 2026-07-09（Package schema 占位 + PPT/PDF 格式接入）

#### 本次目标

1. 为分流管道数字定义预留 Package schema 占位；
2. 在 Builder 中实际接入 PPT/PDF 文本提取。

#### 本次完成

1. **Package schema 占位**：
   - 新增 `digital-me-package/definitions/`：`behavior-profile.json`、`relational-profile.json`、`physiological-profile.json`、`affective-profile.json`、`embodied-profile.json` + README；
   - `manifest.json` 新增 `digitalDefinitions` 区块（认知 active，其余 placeholder）；
   - `digital-me-package/README.md` 目录表补充 definitions/。
2. **格式扩展（系统代码）**：
   - `builder.js`：重构 zip 解析（docx/pptx 共用）；pptx 提取幻灯片正文 + 演讲备注；pdf 经 `pdf-parse` v2（`PDFParse`）提取文本；`extractText` 改为 async；
   - 更新 `main.js` 文件选择器、`index.html` 按钮文案、`distill-batch.mjs`、`inventory.mjs`；
   - 新增 `scripts/test-extract.mjs` 冒烟测试；pptx/pdf/docx 样本均通过。
3. `digitalme_context.md` §2.4 实现差距已更新。

#### 待办事项

1. 素材类型清单文档（六类输入与六条管道映射细则）；
2. 批量蒸馏 articles 中 3 个 pptx + 3 个 pdf；
3. 行为/关系/生理/情感/形体管道的首期数据采集设计。

#### 重要信息

1. pptx 纯 Node 解析（与 docx 同策略，无额外 unzip 依赖）；pdf 依赖 `pdf-parse`（含 pdfjs）；
2. 扫描版 pdf 无法提取文字，错误提示引导 OCR；大体积 pptx（如 50MB+）可提取但耗时较长。

---

### 2026-07-10（业界 harness 启示入库 + 营销叙事）

#### 本次目标

1. 将 Claude Science 对照后的可借鉴点，按产品规划用语写入上下文，并修正「学科专家 ≈ 数据管道」的不当类比；
2. 按营销口径撰写 Digital Me 自立与成长叙事长文（2000 字以上）。

#### 本次完成

1. **`digitalme_context.md` 新增 §7.9**：
   - 澄清：Digital Me 按**数据来源/形式**做输入侧分流，统一于同一数字之我；学科工作台按**学术门类**规范输入与输出——用法与目的不同；可借鉴质检等 harness，不可映射为管道分类；
   - 规划用语表：Runtime Harness 优先、产物证据链、质检 Agent、**本人 Skill + 共享 Skill**（与 MCP 同级）、开箱场景包做实做丰富、项目工作区、责任边界话术；
   - §8 决策第 17 条。
2. **新增** `digitalme_narrative_ai_era_autonomy.md`：营销口径改写，强调趋势对齐 + 自立抗衡冲击 + 成长愿景与分期规划（约 2600 字）。

#### 待办事项

1. 开箱场景包首版内容设计（创始人/写作/投研等）；
2. 本人 Skill 存储格式与 Capability Installer 统一入口的方案；
3. 蒸馏质检 / 输出质检 Agent 的最小切片。

#### 重要信息

1. 用户确认：Skill 自建与复用价值与 MCP 相似，须作为一等能力面；开箱领域要照顾用户心理、降低门槛。

---

### 2026-07-10（主体层 × 能力层定位入库）

#### 本次目标

1. 将「Digital Me 与大模型/工作台/专业模型的分层协同」及能力半径区分，写入 context / log / autonomy 三份文档。

#### 本次完成

1. **`digitalme_context.md`**：
   - 新增 **§7.10 主体层与能力层**：定位公式、核心能力与能力半径（暂时）对照表、三类对象协同、四种接口、防抢活分工、发展空间说明；
   - §3 主要结论新增第 10 条；§8 已确认决策新增第 **18** 条。
2. **`digitalme_narrative_ai_era_autonomy.md`** 升为 v0.2：不限字数重写，突出自立抗衡冲击 + **主体层×能力层战略分界与协同** + 成长愿景与分期；明确「不与大模型公司同台竞品化，由此留出发展空间」。
3. 本日志条目。

#### 重要信息

1. 用户判定：该定位及关系描述**非常重要**——把 Digital Me 与大模型公司的核心能力与能力半径（暂时）区分开，留出可能的发展空间；
2. 「暂时」写入正式表述：边界可随生态修订，但战略主线不是成为大模型公司。

---

### 2026-07-10（产品功能与界面规格 v0.2）

#### 本次目标

1. 停止零星需求驱动；对照 Claude/ChatGPT 工作台基线，落成正式产品规格，作为后续开发唯一需求源。

#### 本次完成

1. **新建** `digitalme_product_spec_v0.2.md`：
   - §0 文档地位与准入规则（规格驱动、无规格不排期）；
   - §1–2 问题诊断、对标、产品原则；
   - §3 目标 IA（工作台/产物/蒸馏/我的数字之我/能力与技能/设置）；
   - §4 任务工作台完整规格（附件、多会话、流式、画布、工具轨迹、快捷意图、依据）；
   - §5 Deliverable 模型与产物目录分期；
   - §6 其余表面；§7 v0.2 / v0.3 / v1.0 DoD；§8 实现映射与建议顺序；
   - 本轮**不改 App 代码**。
2. **`digitalme_context.md`**：文首需求源指针；§3.2 规格指针；§3 结论第 11 条；§8 决策第 **19** 条。

#### 待办事项（下一会话按规格开工）

1. v0.2 DoD：附件 → 流式/停止 → 多会话 → 工具轨迹可见 → Markdown 画布 + md/docx 导出 → 产物库/报告类；
2. 开箱场景包内容设计（≥3，属 v0.3）。

#### 重要信息

1. 用户明确：不能再走到哪里算哪里；须完整规划、对标最高标准，不能由个人经验与零星需求驱动；
2. 交互标杆 Claude/ChatGPT；差异化保持主体层 IA。

---

### 2026-07-10（普通人语言 + 暖色人感 + 启动 v0.2 DoD）

#### 本次目标

1. 将「普通人通用语言」「暖色人感界面」写入产品规格与 context；
2. 开始实现 v0.2 DoD（附件、流式、多会话、工具轨迹、Markdown 画布导出）。

#### 本次完成

1. `digitalme_product_spec_v0.2.md` §2 增补原则 2–3 与文案/视觉速查（v0.2.1）；
2. `digitalme_context.md` 结论第 12 条、决策第 20 条；
3. App 落地 v0.2 DoD：
   - 暖色奶油/陶土主题（`styles.css`）；
   - 工作台：附件、流式+停止、多会话本地持久化、场景语言工具轨迹、Markdown 画布 + `.md`/`.docx` 导出；
   - 设置文案改为「智能引擎/连接密钥」等通用语言；
4. 应用已重启，可人工验收 DoD 清单。

#### 待办事项

1. 人工走通：附加材料 → 流式/停止 → 切换会话 → 长文进成稿预览 → 导出 md/docx；
2. v0.3：产物库模板与 PPT 等交付物。

---

### 2026-07-10（端主权 × 云边平台架构定稿）

#### 本次目标

1. 就「百万用户/百万日活应选何种系统架构」形成可执行结论；
2. 单独成文并在 context / log 建立索引。

#### 本次完成

1. 新增 [`digitalme_architecture_edge_sovereign_v0.1.md`](digitalme_architecture_edge_sovereign_v0.1.md)：
   - 确认 **端主权客户端 + 云边平台 + 外置能力层**；
   - 否决纯 Web SaaS 明文中心人设、否决纯离线终局；
   - 多端职责、云模块优先级、安全基线、规模化分期、对当前 Electron 代码库的落地指引；
2. `digitalme_context.md`：文首指针、结论第 13 条、§3.2 文档表、§4 部署拓扑指向、决策 #3 细化、决策 #21。

#### 重要信息

1. 用户明确同意该架构建议，并要求单独架构文件 + context/log 索引；
2. 当前 Electron「像网页」仅为渲染技术，不是网站产品形态。

#### 待办事项

1. 工程上启动 UI 与 Runtime 解耦边界（Package Store / Runtime Core / Gateway Client 等），为日后 Web 薄客户端铺路；
2. v1.x 再排：账号 + 加密同步 + 可选官方模型网关（不阻塞当前 v0.2 桌面交付）。

---

### 2026-07-10（日终：v0.2 试用反馈修复 + 收工）

#### 本次目标

1. 收束当日试用中暴露的工作台问题；
2. 更新 log / context，便于下次续作。

#### 本次完成（晚间续作摘要）

1. **附件 PDF**：正文写入用户消息+系统提示；读入状态可见；禁止谎称无法读取；
2. **对话 vs 成稿**：用户面「画布」→「成稿预览」；问答必须留在主对话；禁止把下载说明/文件列表误判为成稿；
3. **真实落盘**：成稿自动保存至 `文档\DigitalMe\成稿\`（`.md` + `.docx`）；禁止模型谎称已保存；可「打开成稿文件夹」；
4. **WPS 友好导出**：docx 默认宋体正文 / 微软雅黑标题，无需安装 Microsoft Word；
5. **架构**：`digitalme_architecture_edge_sovereign_v0.1.md` 已定稿并索引（见上条日志）。

#### 重要信息

1. 当日试用材料：`张元林简历2025(1).pdf`；「2025年7月」更新日期为模型幻觉，附件原文无此句；项目表中 2026 来自原文；
2. 本机已有可用成稿示例：`文档\DigitalMe\成稿\` 下详细版 / 1-2 页版 `.docx`。

#### 待办事项（下次）

1. 继续人工验收 v0.2 DoD（附件→流式→会话→成稿预览→WPS 打开 docx）；
2. 扫描件 PDF / OCR 仍未做（无文字层时需提示）；
3. UI 与 Runtime 解耦；v0.3 产物库与 PPT；
4. 成稿预览内嵌简易排版预览（可选，降低对导出依赖）。

---

### 2026-07-11（第 24 次记录）：个人数据主权战略原则入档（Digital Me）

#### 本次目标

1. 将「个人数据主权 = 自我定义权 + 自我发展权」及对抗算法黑洞的研讨结论，记入 Digital Me 战略/产品规划合适位置，作为后续开发指导思想。

#### 本次完成

1. 新建 `digitalme_data_sovereignty_principle_20260711.md`：原则陈述、研讨结论、六条产品开发约束、与既有文档关系、使用方式；
2. `digitalme_context.md`：§3 第 15 条、§3.2 文档指针、决策 #23；最后更新改为 2026-07-11；
3. `digital-me-project-positioning-draft.md`：§三原则第 9 条；§六补强「目标函数归人」；
4. `digitalme_narrative_ai_era_autonomy.md`：§三补一段推荐算法冲击与主权锁叙事；文档关系表增加指针；
5. 纠正此前误写入 Aivestor 仓库的同主题文档：Aivestor 侧回滚交叉引用，权威落点以本项目为准。

#### 重要信息

1. 固化表述：抵抗被自动算法吸入黑洞的有效武器；保持人之为人的理性之锁；
2. 主权必要非充分：须人管理目标函数 + 发展型用户假设；默认发展向，禁止为增长退化为时长最大化；
3. 后续画像/推荐/匹配相关设计，评审时对照该原则文档第 1、3 节。

#### 待办事项（下次）

1. ~~继续人工验收 v0.2 DoD~~ → **2026-07-11 用户确认通过**；
2. 意图层最小旋钮（目标 / 模式 / 禁忌 / 时间预算）可在后续产品规格中分期落地。

---

### 2026-07-11（v0.2 验收通过 → 启动 v0.3 产物库）

#### 本次目标

1. 记录 v0.2 人工验收通过；
2. 启动 v0.3：产物库 + 成稿打通 + 开箱场景包。

#### 本次完成

1. 用户确认 v0.2 验收清单通过（含蒸馏批量、成稿分流修复后的复验前提）；
2. 新增 `digitalme-app/src/outputs/library.js`：产物本地库、模板（报告/请示/方案/备忘录/PPT）、开箱场景包 ×3；
3. 「产物」页改为：模板新建 + 列表/详情精修 + md/docx 导出；PPT 收进模板入口；
4. 工作台成稿预览增加「送入产物库」；场景包芯片联动输入框。

#### 待办事项

1. 人工点验：模板新建 → 编辑导出；成稿送入产物库；场景包预填；
2. v0.3 余量：表格/邮件、审阅逐条勾选、从成稿一键生成 PPT；
3. UI/Runtime 解耦（架构分期）。

---

### 2026-07-11（v0.3 点验通过 + 能力页减负）

#### 本次目标

1. 记录 v0.3 首刀点验 1–3 通过；
2. 消除能力页「推荐 / 已启用」重复与文案过密。

#### 本次完成

1. 用户确认：产物模板新建、成稿送入产物库、开箱场景预填 — **通过**；
2. 能力页改版：
   - 「可添加」只列出**尚未启用**项（一行说明 + 启用）；
   - 「已武装」专管连接/断开/停用；
   - 去掉 why/scenario/难度标签堆叠；使用说明改为默认折叠。

#### 待办事项

1. v0.3 余量：表格/邮件、成稿→PPT、蒸馏审阅勾选；
2. UI/Runtime 解耦。

---

### 2026-07-11（能力页通过 → 成稿 PPT + 表格 CSV）

#### 本次目标

1. 记录能力页减负通过；
2. 落地 v0.3 余量两项：成稿→PPT、表格 CSV。

#### 本次完成

1. 能力页改版用户确认通过；
2. 成稿预览 / 产物详情增加「生成 PPT」（以正文为依据规划幻灯片）；
3. 产物模板新增「结构化表格」；支持导出 CSV（UTF-8 BOM，WPS/Excel 可开）。

#### 待办事项

1. 点验：成稿→生成 PPT→导出 pptx；表格模板→导出 CSV；
2. 蒸馏审阅逐条勾选；邮件草稿（可选）；
3. UI/Runtime 解耦。

---

### 2026-07-11（成稿 PPT / CSV 通过 → 蒸馏审阅勾选）

#### 本次目标

1. 记录成稿→PPT、表格 CSV 点验通过；
2. 落地蒸馏审阅逐条勾选写入。

#### 本次完成

1. 用户确认 CSV 仅导出表格数据为预期行为；成稿 PPT / CSV 切片可继续；
2. 蒸馏审阅：每条可勾选；分组全选/全不选；仅写入已勾选项；按钮显示勾选条数。

#### 待办事项

1. 点验：蒸馏 → 取消部分勾选 → 写入，核对 Package 只增勾选内容；
2. 邮件草稿（可选）；冲突提示（v1.0）；
3. UI/Runtime 解耦。

---

### 2026-07-11（素材指引：人格蒸馏 ≠ 身份档案）

#### 本次目标

1. 回应用户：导师登记表被误蒸馏为风格/价值观；
2. 明确「什么可丢进 Digital Me、什么无用/有风险、数字化边界」。

#### 本次完成

1. 确认问题根因：当前仅有认知蒸馏管道，身份/履历类材料被误当写作素材；
2. 落成 `digitalme_material_guidance_v0.1.md`（A 人格 / B 事实档案 / C 禁入表达）；
3. `digitalme_context.md` 决策 #25。

#### 待办事项

1. 蒸馏页常驻白话指引；导入时选材料类型并分流；
2. 身份事实写入 identity/履历，而非 style/persona；
3. 邮件草稿（可选）；UI/Runtime 解耦。

---

### 2026-07-11（工程落地：人格 / 身份事实 / 仅保管）

#### 本次目标

按三项分类落实蒸馏导入分流。

#### 本次完成

1. 蒸馏页：类型选择 + 白话指引；按钮文案随类型变化；
2. 人格：原蒸馏 + 勾选写入；
3. 身份：专用提取提示词 → 审阅 → 写入 `identity.json` / `identity-facts.md`；
4. 仅保管：不调模型蒸馏，登记本机保管库（不注入对话）。

#### 待办事项

1. 点验：同一登记表分别用「人格」与「身份事实」对比结果；保管库不污染 Package 风格；
2. 禁区 policies；保管库浏览页（可选）；
3. 邮件草稿；UI/Runtime 解耦。

---

### 2026-07-11（社会事实文案纠偏 + 人生轨迹结构）

#### 本次目标

1. 社会事实路径进度文案去掉「蒸馏」；
2. 纠正「提取履历」重心 → 角色/时间社会事实；
3. 落成人生轨迹与社会全貌信息结构。

#### 本次完成

1. 进度/按钮/选项文案改为「社会事实」「登记」；
2. 提取提示词强调任职角色，避免整表抄履历；
3. `digitalme_life_graph_v0.1.md`：时间主线 + 维度表（含补充项）；决策 #26。

#### 待办事项

1. Package：`life/events` + roles 等表雏形；
2. 点验导师登记表 → 应出现「MBA 导师」类事实而非长履历清单；
3. 禁区 policies；邮件草稿；UI/Runtime 解耦。

---

### 2026-07-11（落地人生轨迹 life/）

#### 本次目标

社会事实写入升级为事件主线 + 维度表。

#### 本次完成

1. `life.js`：`events.jsonl`、roles/relations/outcomes/interests；
2. 提取 JSON 改为 `events[]`；审阅按人生事件勾选；
3. 写入回填角色表，并短摘要注入对话上下文；manifest 增加 lifeGraph。

#### 待办事项

1. 点验：导师登记表 → 事件含「MBA 导师」+ `life/roles.json` 有条目；
2. 资产分表 / 时间线浏览 UI；禁区 policies；
3. 邮件草稿；UI/Runtime 解耦。

---

### 2026-07-11（通用文案闸门 + 通用需求优先）

#### 本次目标

1. 纠正产品默认文案中的研讨个案口吻；
2. 将「通用场景文案」「通用需求优先 / AI 可反对」写入规格与协作规范。

#### 本次完成

1. 蒸馏页引导与三项说明改为通用材料说法；PPT 占位符去个案化；
2. `digitalme_product_spec_v0.2.md` → v0.2.4（§2 第 10–11 条）；
3. `digitalme_context.md` §3.1 / §5.4 / 决策 #27；素材指引与人生轨迹文档同步。

#### 待办事项

1. 点验社会事实写入与文案观感；
2. 资产分表 / 时间线 UI；禁区 policies；
3. 邮件草稿；UI/Runtime 解耦。

---

### 2026-07-11（日终汇总）

> 本日收工记录：汇总进展、技术参数、产品功能与文档决策，便于下一日续作。

#### 一、产品功能（用户可见）

| 能力 | 说明 | 状态 |
|------|------|------|
| 成稿 → PPT | 成稿预览 / 产物详情「生成 PPT」，以正文为 `brief.context` 规划幻灯片并导出 pptx | ✅ 已落地；用户点验通过（CSV 行为已确认） |
| 表格 → CSV | 产物模板「结构化表格」；导出 UTF-8 BOM CSV（仅 Markdown 表格行） | ✅ |
| 蒸馏审阅勾选 | 人格蒸馏结果逐条勾选；分组全选/全不选；仅写入勾选 | ✅ |
| 材料三项分流 | 导入前选：**人格蒸馏 / 社会事实 / 仅保管** | ✅ |
| 社会事实路径 | 进度文案不用「蒸馏」；审阅按人生事件勾选；写入轨迹 | ✅ 用户实测已写入（事件/角色/关系等） |
| 仅保管 | 本机 `userData/materials/custody-index.json`；不调蒸馏模型；不注入对话 | ✅ |
| 通用文案闸门 | 蒸馏页/占位符去掉个案口吻；面向普通用户场景 | ✅ |

#### 二、技术参数与实现要点

**应用**

- 路径：`digitalme-app/`（Electron）
- 关键模块：`src/materials.js`（三项分流与保管库）、`src/life.js`（人生轨迹写入）、`src/builder.js`（人格蒸馏 + 社会事实提取提示词）、`src/outputs/library.js`（产物库/CSV）、`src/renderer/app.js` + `index.html`（UI）

**社会事实提取（模型输出）**

```json
{
  "events": [
    {
      "when": "",
      "what": "",
      "roleLabels": [],
      "org": "",
      "actors": [],
      "outcome": "",
      "facets": ["roles"],
      "confidence": "high|medium|low"
    }
  ],
  "facts": []
}
```

- 兼容旧字段 `claims[]` → 自动升为 events
- 写入：`life.writeLifeBack` → `life/events.jsonl` + 维度表 upsert；并同步简要角色到 `identity.json`；可选短句进 `identity-facts.md`
- 对话注入：`package:load` 带 `lifeSummary`（roles 摘要，默认最多约 12 条）并入 system prompt

**Package 人生轨迹目录（`digital-me-package/life/`）**

| 文件 | 用途 |
|------|------|
| `events.jsonl` | 时间主线（每行一事件） |
| `roles.json` | 角色任职切片 |
| `relations.json` | 社会关系切片 |
| `outcomes.json` | 成绩/结果切片 |
| `interests.json` | 兴趣切片 |
| `README.md` | 模块说明 |

- `manifest.json` → `digitalDefinitions.lifeGraph.status: active`

**仅保管**

- 位置：Electron `userData/materials/custody-index.json`
- 标记：`injectIntoPersona=false`，`injectIntoChat=false`

**产物 CSV**

- `library.markdownTableToCsv`：只提取 `|` 表格行；带 BOM，便于 WPS/Excel

#### 三、文档与决策（本日新增/升版）

| 文档 | 要点 |
|------|------|
| `digitalme_material_guidance_v0.1.md` | 材料三去处 + 数字化边界；产品示例须通用 |
| `digitalme_life_graph_v0.1.md` | 时间主线 + 维度表结构；工程分期 |
| `digitalme_product_spec_v0.2.md` | **v0.2.4**：§0.1 产品身份；§2 第 10–11 条通用文案/通用需求优先 |
| `digitalme_context.md` | 文首产品身份；§3.1 / §5.4 协作规范；决策 **#25–#28** |

**关键决策摘要**

- #25 素材三去处与数字化边界
- #26 人生轨迹结构
- #27 通用文案 + 通用需求优先（AI 可反对非普遍需求）
- #28 **通用产品而非个人 Demo**（Owner Package 仅为验证样本）

#### 四、战略共识（本日澄清）

1. 能进 Digital Me ≠ 一律人格蒸馏；社会任职类材料走轨迹，不走文风。
2. 数字化目标是可授权自我模型；须保留禁区与仅保管。
3. 开发目标是**大量真实用户的通用产品**，不是个人定制 Demo。
4. 默认文案按普通用户场景写；协作中须评估需求普遍性。

#### 五、下一日待办（建议）

1. 社会事实 / 人生轨迹：时间线浏览 UI；资产分表（默认高敏）；禁区写入 policies
2. 保管库浏览与删除（可选）
3. 邮件草稿（v0.3 余量，可选）
4. UI / Runtime 解耦（架构主线）
5. 持续用「陌生用户是否明白」抽查默认文案

#### 六、重要信息

1. 本日用户实测：社会事实写入成功（示例反馈：事件 +4、角色 +4、关系 +4、补充短句 +3）。
2. CSV「只含表格数据」为预期行为，已向用户说明。
3. 收工：2026-07-11 晚；续作以上一日终汇总第五节为准。

---

## 2026-07-12（人生轨迹时间线 + 表达禁区）

### 本次目标

1. 落地人生轨迹时间线浏览 UI；
2. 落地极简表达禁区 policies，并注入对话。

### 本次完成

1. 规格升版 `digitalme_product_spec_v0.2.md` → **v0.2.5**：IA 增「人生轨迹」；新增 §6.5。
2. `life.js`：`listEvents` / `getLifeGraph`；IPC `life:getGraph`。
3. 侧栏「人生轨迹」：时间线 + 角色/关系/成绩/兴趣 Tab；事件详情。
4. `policies.js` + `policies/boundaries.json`：添加/删除禁区；`package:load` 注入 `boundariesSummary`。
5. `manifest.json` 登记 `boundaries`；素材指引 / 人生轨迹文档同步状态。

### 待办事项

1. 资产分表（默认高敏）；事件编辑/删除；
2. 禁区「不随导出」在分层导出时真正过滤；
3. 保管库浏览与删除；UI/Runtime 解耦；
4. 反馈「边界」类是否双写 policies（现仍可写 persona.md）。

### 重要信息

1. 决策对齐建议顺序：时间线主、禁区极简同步；资产分表后置。
2. 规格条款：§3.1 / §6.5（v0.2.5）。

---

## 2026-07-12（「我」栏目：人的定义 → 产品落地）

### 本次目标

1. 沉淀人的定义七层与采集口径；
2. 规格升 v0.2.6；侧栏收拢为「我」；
3. 真时间轴增删改；关系错误实现下线；禁区系统默认。

### 本次完成

1. 新增 `digitalme_person_definition_v0.1.md`；
2. `digitalme_product_spec_v0.2.md` → **v0.2.6**；life_graph / context 决策 #30 / 本日志；
3. App：「我」壳 + 时间轴编辑 IPC + 观念与表达迁入 + 禁区系统默认与确认。

### 待办事项

1. ego–alter 关系 UI（有数据源后）；
2. 观念层条目深编辑；资产分表；导出层禁区过滤。

### 重要信息

1. 大方向未偏；补的是完整性、精确度、友好度、操作性。
2. 规格：§3.1 / §6.1 / §6.5（v0.2.6）。

---

## 2026-07-12（事实入口迁时间线 + 投递箱路线）

### 本次目标

纠正「观念与表达」下挂人生事实的逻辑错位；明确「一扔就建」为下一主线。

### 本次完成

1. 时间线页增加「从材料登记人生事实」；观念与表达仅观念/问卷/保管；
2. `digitalme_person_definition_v0.1.md` §7 投递箱分期；决策 #31；规格补丁。

### 待办事项

1. **下一主线**：材料投递箱（统一丢入 → 系统建议分流 → 确认）；
2. 文件夹映射；邮件/微信等授权渠道（后置）。

---

## 2026-07-12（投递箱 B1 + 可读范围 C1）

### 本次目标

按 `digitalme_inbox_access_plan_v0.1.md` 落地投递箱与可读范围。

### 本次完成

1. 规划文档与规格 v0.2.7、决策 #32；
2. App：「我 · 材料」入队/整理建议/确认处理；可读范围授权文件夹扫描入队。

### 待办事项

1. 同文拆段；启动自动增量；邮件/微信渠道；手机投递。

---

## 2026-07-12（少决策智能构建 +「我」二分 IA）

### 本次目标

1. 推进线 A：少决策养我（智能构建、自动采纳中高把握）；
2. 解决大批量过慢/不可中断、过程日志污染结果页；
3. 理顺「构建 vs 数字之我」信息架构；收工落档。

### 本次完成

1. **少决策构建**
   - 「智能构建」：整理 → 分批（约 20 份）→ 自动写入；中高把握推断/关系人自动确认；低把握可选看；
   - 超长正文截断、异常超大/乱码跳过；每文件限段；**可中断**；
   - 观念线索「一键写入」路径；
2. **过程与结果分离**
   - 处理过程日志不再挂在概览等结果分项外（修 `#builder-progress` 误置）；
3. **IA（规格 v0.2.10）**
   - 侧栏恢复为：工作台 · 产物 · 我 · 能力；
   - 「我」内一级二分：**构建**（进料与加工）| **数字之我**（成品与校对）；
   - 构建含：投递箱、可读范围、问卷与测试、高级导入；数字之我含概览/认知/时间线/角色/观念成品预览/边界；
4. **冒烟**：智能构建基本功能成立；用户确认框架可行，文案/形状/内容后续精修；
5. **v0.2 工作台 DoD**：用户此前已验收通过（测得不细，记为通过）。

### 待办事项（下次优先）

1. **构建体验精修**：文案、主按钮层级、进度摘要（少刷屏）、结束后一键进「数字之我」；
2. **线 A 加深**：智能构建质量（误分类、截断策略、像我校验）；认知页校对体验；
3. **线 B**：v0.3 产物/场景包等（不阻塞当前养我飞轮精修）；
4. 投递箱后置：同文拆段、增量扫描、邮件/微信渠道。

### 重要信息

1. 定位确认：**构建 = 进料与加工；数字之我 = 成品与校对**；
2. 人中心 Agent 窗口暂时、门槛靠本我密度×信任×飞轮，不靠功能清单（战略讨论已对齐，未改航向）；
3. 正式对外发布仍待产品硬化；轻云/开源分发可后置，当前继续桌面验证。

---

## 2026-07-24（R2 对话运行时：失败重试与回归收口）

### 本次目标

1. 在已保留的新版对话运行时中补齐失败后的可恢复操作；
2. 以真实 Electron 重新验证会话、流式、停止、重载、成果关联和主体上下文边界；
3. 形成可机器读取的 R2 聚合验收记录。

### 本次完成

1. 新版 React 对话页增加明确的「重试」动作；仅在 main 返回失败终态后出现，重试仍沿用 main/core 的会话、请求、模型与附件链路；
2. 修复极早失败事件在 renderer 确认接收前可能丢失的时序：活动请求引用在确认前同步就绪，main 仍是请求和终态唯一权威；
3. 新增 `test:r2-dialogue`，在隔离 userData 和临时 Package 下汇总九项真实验收：新 Shell 打开、发送流式、停止与重试、会话持久化、切换保护、显示/模型分离、成果关联卡、reload 恢复、主体上下文回归；结果写入 `.codex-qa/r2-dialogue/acceptance.json`；
4. 验证结果：R2 聚合 **9/9**、R2 contracts **19/19**、R2 Electron **16/16**；R1 **8/8**、PAN-01S **9/9**、doing-context **6/6**；renderer 控制台烟测未发现业务 `console.error` 或页面异常；
5. 提交：`5d88dc4`（R1 reload 就绪状态）与 `248189d`（R2 可恢复重试与验收）。未读取、修改或污染真实 `digital-me-package`。

### 当前边界与待办

1. R2 仍是**保留基础设施**，不是当前产品主线；不据此启动 R3、R2.5、PAN-02、外部 Agent 或协作市场；
2. 生产默认入口继续为 legacy；新版对话仅在受控入口下验证；
3. 自动化通过不替代 Owner 全功能 Electron 真机验收，下一项仍为既定 Owner 验收路径；
4. 完整工作树仍保留候选基线的既有未提交修改；全局 `git diff --check` 的尾随空格来自既有 `app.js` 与文档改动，本轮 R2 文件的差异检查通过。

---

## 日志模板（后续复制）

### YYYY-MM-DD（第 N 次记录）

#### 本次目标

1.
2.

#### 本次完成

1.
2.

#### 待办事项

1.
2.

#### 待确认问题

1.
2.

#### 重要信息

1.
2.
