# Digital Me Product Panorama 执行索引

版本：v0.2.30
日期：2026-07-27
状态：`superseded_as_current_execution_index` / **历史与基础设施状态表**
所属总任务：`P1-PANORAMA`（历史主线；**不再是当前产品执行主线**）
代码实现基线：`2f1b7bd`（committed baseline；distill-me + doing-context + identity + collaboration + 全部新增功能）；历史 `cbde807fd1e40472d66fbe8f0810a0835e8bc816`（PAN-01S 族）；R1 `8d7e9b3`；R2 分支 `codex/r2-chat-sessions-migration`（实现保留）
规格依据：见文内历史列表

> **2026-07-29 TODAY（非本索引主线）**：**TASK-QUALITY-STABILIZE-01-FIX-01C**（正式成果按钮直接绑定）已实现：`implemented` / `direct_artifact_button_binding_added` / `formal_electron_click_trace_passed` / `owner_runtime_revalidation_pending`；分支 `codex/task-quality-stabilize-01-fix-artifact-direct-binding`；基线 `0341f30`。Owner 确认 RESPONSIVENESS-01 后菜单已即时，但打开成果仍无反馈 → 改为每按钮直接绑定（非 document capture）。正式 UI click trace 48 passed。等待 Owner 复验三个「打开成果」。不得 push。
>
> **2026-07-29（前序）**：**GLOBAL-RENDERER-RESPONSIVENESS-01**（全局交互迟滞）已实现：`implemented` / `duplicate_listeners_removed` / `renderer_main_thread_work_reduced` / `automated_performance_tests_passed` / `owner_runtime_acceptance_pending`；分支 `codex/global-renderer-responsiveness-01`；基线 `6bff2ad`。根因：≈2.1MB package store 同步 parse/pretty-write 阻塞 main/OS 菜单。不得 push。
>
> **2026-07-29（前序）**：**TASK-QUALITY-STABILIZE-01-FIX-01**（成果打开链路）已实现：`implemented` / `automated_tests_passed` / `artifact_open_restored` / `owner_runtime_acceptance_pending`；分支 `codex/task-quality-stabilize-01-fix-artifact-open`；基线 `48af0b4`。不得单独标 Owner 通过。
>
> **2026-07-29（前序）**：**TASK-QUALITY-STABILIZE-01**（可靠交付主路径与后台质量增强分离）已实现完成：`implemented` / `automated_tests_passed` / `stable_delivery_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`；分支 `codex/task-quality-stabilize-01`；基线 `72f8f20`。生产默认 `stable_delivery`；旧质量环为 `advanced_shadow`。不得 push。不得标市场 95% 分位已证明。
>
> **2026-07-29（前序）**：**TASK-QUALITY-LOOP-01.2**（动态成果契约、语义覆盖生成与任务界面收敛）已实现完成：`implemented` / `automated_tests_passed` / `semantic_contract_generation_added` / `generation_state_consolidated` / `task_ui_minimized` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`；分支 `codex/task-quality-loop-01-2-semantic-contract`；基线 `a9ff638`。已被 STABILIZE-01 从生产门禁降为 shadow。不得 push。不得标 `architecture_simplified`。

> **2026-07-28 TODAY（非本索引主线）**：**TASK-QUALITY-LOOP-01**（复杂任务高质量完成闭环，PRD/方案文档首个切片）已实现完成：`implemented` / `automated_tests_passed` / `owner_runtime_acceptance_pending` / `benchmark_framework_started` / `market_95th_percentile_not_yet_proven`；分支 `codex/task-quality-loop-01`；**DVL2-03-QUALITY-01 已被其吸收**。**TASK-QUALITY-LOOP-01.1**（Grounding Review：CurrentSystemSnapshot + AuthorityMap + 7 类 grounding blocking issue）已实现完成：`implemented` / `automated_tests_passed` / `grounding_review_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`；分支 `codex/task-quality-loop-01-1-grounded-review`。均等待 Owner 真机验收。不得 push。

> **2026-07-27 TODAY-CLOSE（非本索引主线）**：以下四项已于 2026-07-27 Owner 真机验收并标 `accepted_as_implemented`：**LEARN-LOOP-FIX-02**、**LEARN-LOOP-FIX-02.1**、**DVL2-03-FIX-01**、**TASK-UX-MIN-01**（功能最小接受；UI 质量 deferred → **UI-UX-FOUNDATION-UPGRADE**）。**IDCOLLAB-MIN-01** 已校正为 `implemented` / `revocation_bug_fixed` / `owner_runtime_accepted` / `accepted_as_implemented`（2026-07-28；`minimal_identity_collaboration_loop_only` / `external_network_collaboration_not_validated` / `market_and_settlement_not_started`）。**DVL2-03** 主线已 `owner_runtime_accepted`。不得 push。

> **2026-07-27 基础设施补充（历史一行，已被 TODAY-CLOSE 取代）**：~~DVL2-03-FIX-01 ready_for_owner_runtime_acceptance~~；~~IDCOLLAB-MIN-01 MIN-01.1 曾 `ready_for_owner_runtime_reacceptance`~~（撤销修复其后已 Owner 真机复验通过，2026-07-28 状态校正为 `accepted_as_implemented`）。

> **2026-07-24 committed baseline（`2f1b7bd`）**：83 个文件，+16,427/-487 行。confirmed identity → act context 缺口已关闭；distill-me-acceptance 11/11；PAN-01S 23/23；owner-runtime 9/9；gate4-auto-flow 49/49；vl1-block1 18/18 全绿。Owner Electron 真机验收 `accepted`。依赖闭包完整，干净 checkout 可跑通。**未 push**。R3 继续 `paused`；PAN-02 继续 `planned / blocked`。
> **2026-07-21 规划基线重建（强制）**：本文件**不再**作为「当前唯一执行索引」。  
> **当前最高架构原则**：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
> **当前唯一执行计划**：[`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)（**v0.1.2 `spec_frozen`**）  
> **冻结规格**：[`digitalme_first_vertical_loop_spec_v0.1.md`](digitalme_first_vertical_loop_spec_v0.1.md)  
> **R2**：`retained as infrastructure`（停止作为当前验收主线）。**R3**：`paused`（不是下一步）。**旧 DM-Core-01A 开发指令**：`superseded`。提交 **`55ae01f`**：`retained_for_mapping_review`。
> 下文保留 P1-PANORAMA / Renderer Foundation 的历史状态事实，供查阅；冲突时以新权威文件为准。

> **v0.2.24 修订（2026-07-21，R2 实现收口 · 历史）**：R2 = `implementation_completed` / awaiting review（不得 `accepted` 作为主线门槛）。已被 v0.2.25 降级。

---

## 1. 当前主线与唯一下一任务（已被 v0.2.25 覆盖）

```text
【已降级】原 P1-PANORAMA → R2 awaiting review 队列
【当前】见 digitalme_first_vertical_loop_sprint_plan_v0.1.md
```

| 项 | 当前值（v0.2.25） |
|---|---|
| 本文件角色 | 历史状态表 + 基础设施事实；**非**当前执行计划 |
| R0 / R1 | `accepted` / **retained as infrastructure** |
| R2 | 实现保留 / **retained as infrastructure**；**停止追加边缘验收为主线** |
| R3 | **`paused`** |
| R2.5 | `planned` / `deferred` |
| PAN-02～PAN-06 | 相对新主线 **`paused`**（历史 `planned`/`blocked` 记录保留） |
| 旧 DM-Core-01A 开发指令 | **`superseded`** |
| 提交 `55ae01f`（act-behalf） | **`retained_for_mapping_review`** |
| **当前唯一任务** | **实现任务意图与本人上下文装配（第一闭环实现 · 第 1 块）**（待实现授权；见第一闭环计划 v0.1.2 / 规格 v0.1.0） |

---

## 1a. 历史主线快照（v0.2.24，只读）

```text
P1-PANORAMA（三位一体 Alpha）
→ … PAN-01S 族 accepted → R0/R1 accepted
→ R2 implementation_completed（未 accepted）← 曾为唯一等待项
→ R3 / PAN-02 …（现已暂停相对新主线）
```

| 项 | 历史值（v0.2.24） |
|---|---|
| 总任务状态 | `… / R2_implementation_completed_awaiting_review` |
| 当时唯一等待项 | Codex 复核 R2 + Owner 真机（**现已不再作为项目最高等待项**） |
| 明确不得启动（历史口径） | R3；R2.5；PAN-02～PAN-06；… |

---

## 2. PAN 任务状态表（历史保留；排期含义以第一闭环计划为准）

| 任务 | 目标 | 当前状态 | 启动条件 | 完成闸门 | 完成后下一步 |
|---|---|---|---|---|---|
| PAN-00 | 战略与规格冻结；建立索引与 backlog | `accepted`（`bc85a14`；历史，不改写） | — | 已完成 | — |
| PAN-00R | 三位一体重构、极简产品原则冻结、队列重排（仅文档） | `accepted`（`07b631d` + `6ae2dca` + `0fcd432`；Codex 最终复核通过；Owner 确认） | — | 已完成（docs/strategy） | PAN-01S 任务包 |
| PAN-01（历史） | 产品全貌首页 | `statically_verified` / `owner_product_perception_failed` / `needs_minimal_surface_reset`（不 accepted；不回滚） | — | 已裁定归档 | 表面收口由 PAN-01S 承接 |
| PAN-01R（历史） | 主权协作闭环 | `statically_verified` / `codex_review_passed` / `owner_runtime_verified` / `owner_product_perception_failed` / `retained_as_internal_collaboration_harness`（不 accepted；证据 `9dd6fa0`、70/70、20/20） | — | 已裁定归档 | 普通用户入口由 PAN-01S 撤下；骨架保留 |
| PAN-01S | 极简产品表面与复杂度后移 | **`accepted`（2026-07-20；baseline `cbde807`）** | — | Owner real Electron runtime | 收口完成；技术债进 R0 |
| PAN-01S.1 | 主体解释与渐进式构建 | **`accepted`（2026-07-20；baseline `cbde807`）** | 规格接受 `686fd7b`；前置 `98fb817` | Owner real Electron runtime | 收口完成 |
| PAN-01S.2 | 对话事故收口（历史显示 / 附件分离 / 关联文稿隔离与恢复） | **`accepted`（2026-07-20；baseline `cbde807`）** | Owner 真机事故发现 | Owner real Electron runtime | 正式独立任务包未入库；以本索引与 log 记录为准，不伪造任务包历史 |
| PAN-02 | 理解通道 Alpha：低负担输入、后台蒸馏、关键纠错、任务相关检索、无关沉默 | `planned` / **`blocked`** | 见 R0 §16：R0 决策确认 + 至少 R2/R3 Owner 真机验收（或书面豁免）+ 独立任务包冻结与启动授权；**不以 SQLite/R2.5 为前提** | 理解我 Alpha 达标（规格 §7.6 第 1 条） | PAN-03 |
| renderer foundation R0 | 架构决策与渐进迁移规格（非实现；非 PAN 主线） | **`accepted`（v0.1.2；决策接受）**；implementation = `not_started`；branch = 不存在 | 含整窗入口、自动回退 legacy、R2=JSON、R2.5 deferred、Playwright E2E、R1 收窄 | 决策已接受 | R1～R6；不重开 PAN-01S |
| renderer foundation R1 | 最小 next shell + 整窗开关 + Playwright 骨架 | **`accepted`（v0.1.3；baseline `8d7e9b3`）**；branch = `codex/r1-renderer-next-shell`；implementation = `completed` | Owner 已授权并完成 spike/修复；Codex + Owner 6/6 | Codex review passed + Owner real Electron runtime 6/6 | 起草 R2 任务包 |
| renderer foundation R2 | 对话迁移（会话列表 + 聊天；JSON sessions） | **`implementation_completed` / `retained as infrastructure` / `not_current_mainline`**（**v0.1.1**；**未要求继续 accepted 作为主线门槛**）；branch = **`codex/r2-chat-sessions-migration`** | R2-A～R2-F 已实现；自动化测试已跑；停止追加边缘验收为主线 | 可选补验收（非当前任务） | R3（**`paused`**，非下一步） |
| R2.5 SQLite ADR | sessions 运行库可行性（非主体权威） | `planned` / **`deferred`** | 量化触发 + 独立 ADR + Owner 授权；不读真实正文 | 备份/双读/回滚证明 | 可选；跳过不影响 PAN-02 |
| PAN-03 | 能力框架 Alpha | `planned`（新定义） | PAN-02 验收通过 + 独立任务包 | 武装我 Alpha 达标 | PAN-04 |
| PAN-04 | 外部协作骨架 Alpha | `planned`（新定义） | PAN-03 验收通过 + 独立任务包 | 连接世界 Alpha 达标 | PAN-05 |
| PAN-05 | 成长飞轮与传播体验 | `planned`（新定义） | PAN-04 验收通过 | 一次闭环走通 | PAN-06 |
| PAN-06 | 非开发者验证与 Trusted Beta 排序 | `planned` | PAN-01S～05 形成可体验 Alpha | 5～10 名非开发者验证 | Trusted Beta |

### 2.1 旧任务定义处置

| 旧定义 | 处置 |
|---|---|
| 旧 PAN-02「控制权面板」 | **superseded**：控制不再单独做成密集面板；控制能力按风险上下文分散到主体、能力和协作路径；完整控制细节进入设置/高级区域 |
| 旧 PAN-03「能力获得感」 | 保留历史，不删除；当前排期口径由新 PAN-03「能力框架 Alpha」取代 |
| 旧 PAN-04「本地协作沙盘」 | 保留历史，不删除；当前排期口径由新 PAN-04「外部协作骨架 Alpha」取代（六要素授权与安全边界继续有效） |
| 旧「PAN-02/03/04 paused_until_PAN-01R_acceptance；PAN-01R 验收通过后启动旧 PAN-02」 | **已删除**；不再是当前口径 |

### 2.2 PAN-01S.2 与收口修订说明

- **PAN-01S.2 accepted 覆盖：** 对话历史显示、附件上下文分离、关联文稿正文隔离和恢复入口（提交链含 `b5997b6`、`acacc6e`、`598e7e9`）。
- **会话菜单与永久构建入口：** 属 PAN-01S 收口修订（`34fb497`、`cbde807`），验收基线同为 `cbde807`。
- 上述提交均独立保留；未 amend、squash 或 push。
- 自动测试通过不是唯一 acceptance 依据；Owner 真实运行结果才是最终依据。

### 2.3 R1 accepted 范围（明确）

R1 `accepted` **仅**覆盖：TS+React+Vite 底座、独立 next 预览空壳、main 整窗切换、runtime stamp、ready generation、导航单飞、自动回退 legacy、fallback latch、Error Boundary、Playwright Electron 基线。

**未**迁移：chat、会话列表、「我」、构建、工作台、能力、设置。生产默认仍为 legacy；无普通用户 next 生产入口。**不**等于整个 renderer 重构完成；**不**启动 R2/R2.5/PAN-02。

### 2.4 R2 预告（仅概括；本索引不详细设计）

- 新 renderer 的会话列表与聊天页；
- 沿用 JSON sessions；
- 类型化 session/chat API；
- main 请求注册与并发门禁；
- displayText、model context、attachment reference 继续分离；
- 保留整窗返回 legacy。

规格已冻结；R2 实现分支已由 Owner 授权创建，三项实施前参数合同已独立冻结。Codex 参数合同复核收口且 Owner 再次授权前，不得开始 R2-A～R2-F 编码。

### 2.5 非阻断技术债（renderer foundation backlog）


不重新打开 PAN-01S：

1. assistant `displayText` 2000 字限制与 8000 字展开设计不一致；
2. 会话菜单靠近窗口底部时定位仍需完善；
3. write/research/code 尚未统一请求并发模型；
4. `app.js` / `index.html` 仍为大型 renderer 单体；
5. 其他旧功能仍有 `prompt` / `confirm` / `alert`；
6. 真实 Electron E2E 覆盖仍不足。

---

## 3. P1-07 冻结状态（必须一致）

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

| 项 | 说明 |
|---|---|
| 代码基线 | `5ab55dc` |
| 收工文档提交 | `8fb8210`（历史保留；其中「等待 Codex 复核与 Owner 运行验收」的下一门槛已被冻结决定取代） |
| 不标 | `accepted` |
| 不占用 | 当前主线 |
| 已知缺口 1 | 真实 GUI 多类别审阅：第一组提交后，第二组未被 Owner 观察到自动呈现 |
| 已知缺口 2 | 智能构建确认交互尚未由 Owner 完整复验 |
| 恢复条件 | 仅资料损坏、越权写入、密钥泄漏，或构成当前主路径阻断时 |

---

## 4. 冻结 backlog

每项均暂停，恢复须先提交最小阻断说明，经 Codex 复核后只做必要切片。

| 项 | 来源 | 当前状态 | 暂停原因 | 恢复条件 | 关联风险 |
|---|---|---|---|---|---|
| P1-07 多组审阅第二组未自动呈现 | Owner 验收 / P1-07 | `known_gap / frozen` | 非当前主路径 | 资料损坏/越权/密钥泄漏，或阻断「理解我」主路径 | 构建审阅体验不完整 |
| P1-07 智能构建确认交互未完整复验 | Owner 验收 / P1-07 | `known_gap / frozen` | 同上 | 同上 | 取消/确认边界可能被误解 |
| Policies 全面迁移 PackageStore | 原 WP1 / P1 计划 | `paused` | Alpha 不依赖全量迁移 | Trusted Beta 或安全阻断 | 部分策略仍直写 |
| 认知页零散编辑迁移 | P1-07 非范围 | `paused` | 非闭环主路径 | Trusted Beta 或写路径冲突 | 双写路径并存 |
| Life 读取体系重构 | P1-07 后续 | `paused` | 只读聚合可先支撑 | 读路径阻断 | 读取不一致 |
| `package:load` scaffold | 工程债 | `paused` | 非用户闭环 | 加载/恢复主路径阻断 | 恢复流程脆弱 |
| MCP 全面迁移 ToolBroker | 原 WP3 | `paused` | Alpha 仅需受控执行切片 | 高风险 MCP 默认开启前 | 工具越权 |
| Package 全类型深度校验与迁移 | 原 WP1/WP6 | `paused` | Alpha 复用已接入切片 | Trusted Beta / 迁移验收 | schema 漂移 |
| 审计密码学增强 | 原审计远景 | `paused` | 现有 DecisionAudit 可支撑 Alpha 记录 | 对外宣称不可篡改前 | 过度承诺 |
| 非阻断 UI 细节 | 各任务 | `backlog` | 不因局部打磨延迟闭环 | 主路径通过后按证据排序 | 进度假象 |
| **UI-UX-FOUNDATION-UPGRADE** 整体界面与交互重构 | Owner 判断 / TASK-UX-MIN-01 收口 | `backlog` / `not_started` | TASK-UX-MIN-01 功能最小已接受；不继续局部补丁 | Owner 授权独立任务包后启动 | 补丁式布局累积、视觉/交互质量不足 |
| **DVL2-03-QUALITY-01** 成果生成实施模式对齐 | Owner 判断 / DVL2-03-FIX-01 收口 | `absorbed_by_task_quality_loop_01`（2026-07-28） | 非 DVL2-03-FIX-01 阻断项 | 已由 TASK-QUALITY-LOOP-01 任务模式判断 + Reviewer 远期挤占检查吸收，不另设重复流程 | 生成内容范围偏发散、当前阶段适配不足 |
| **TASK-QUALITY-LOOP-01** 复杂任务高质量完成闭环 | Owner 指令 2026-07-28 | `implemented` / `automated_tests_passed` / `owner_runtime_acceptance_pending` / `benchmark_framework_started` / `market_95th_percentile_not_yet_proven` | PRD/方案文档首个验证切片；OutcomeCriteria + Reviewer + ≤2 次自动修订 | Owner 真机验收（场景 A/B/C） | 见任务包 §5 未完成边界与风险 |
| **TASK-QUALITY-LOOP-01.1** 成果真实性与架构一致性复核 | Owner 指令 2026-07-28 | `implemented` / `automated_tests_passed` / `grounding_review_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven` | CurrentSystemSnapshot + AuthorityMap + GroundingReview；artifact(3) 失败样本不可通过 | Owner 真机验收（场景 A/B） | 仅 Digital Me 项目当前实施型文本成果；注册表启发式需随演进维护 |
| **TASK-QUALITY-LOOP-01.2** 动态成果契约与 UI 收敛 | Owner 指令 2026-07-29 | `implemented` / `automated_tests_passed` / `semantic_contract_generation_added` / `generation_state_consolidated` / `task_ui_minimized` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven` / `demoted_to_advanced_shadow_by_stabilize_01` | OutcomeCriteria 语义覆盖 + Outline/分块 + recoveryActions + UserFacingTaskView；不写死章节 | 对照/shadow；不再作生产交付门禁 | 语义 marker 启发式；旧布尔字段尚未物理删除 |
| **TASK-QUALITY-STABILIZE-01** 可靠交付与后台增强分离 | Owner 指令 2026-07-29 | `implemented` / `automated_tests_passed` / `stable_delivery_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven` | `stable_delivery` 硬门禁立即落盘 + ≤3 次非阻断增强；`advanced_shadow` 保留旧链路 | Owner 真机验收（同 PRD 输入） | 真实模型连续 harness 需密钥环境或 Owner 真机 |
| TASK-UX 删除后成果保留真机补验 | TASK-UX-MIN-01 Owner 验收 | `known_gap / non_blocking` | 自动化已覆盖软删除语义 | Owner 补验或阻断性发现 | 用户误解删除范围 |
| TASK-UX 生成中归档保护真机补验 | TASK-UX-MIN-01 Owner 验收 | `known_gap / non_blocking` | 代码已有 generation guard | Owner 补验 | 归档误操作 |
| LEARN-LOOP 撤销后即时停止调用真机补验 | LEARN-LOOP-FIX-02.1 Owner 验收 | `known_gap / non_blocking` | IDCOLLAB revoke 路径已有 fail-closed | Owner 补验 | 撤销后仍调用旧知识 |
| PAN-01 非阻断 UI 细节（卡片/间距/抽象文案打磨） | Owner 感知 / PAN-01 | `closed_as_superseded` | PAN-01 裁定为 needs_minimal_surface_reset，不再打磨展板 | —（由 PAN-01S 收口取代） | 用视觉代替证明 |
| PAN-01R 五步页面精细化修复 | Owner 产品验收 / PAN-00R | `closed_as_superseded` | 普通用户体验撤下，保留为内部验证器 | —（新 PAN-04 复用安全骨架） | 在失败表面上继续投入 |
| 原 P1-08 | 旧阶段队列 | `paused / superseded_as_queue` | 主线为 P1-PANORAMA | PAN-06 后按用户证据重排 | 误启旧队列 |
| Digital Org 运行时 | 叙事母稿 / 长期架构 | `long_term / not_in_alpha` | 个人 Alpha 范围 | P1-PANORAMA 后评估 DORG-00 | 范围膨胀 |
| 公网协作、支付和结算 | 协作远景 | `out_of_alpha` | 安全与非目标 | Trusted Beta 之后单独规格 | 攻击面与合规 |

---

## 5. 两套状态（不得混用）

### 5.1 工程状态（本索引与能力表）

`planned` → `specified` → `implemented` → `statically_verified` → `runtime_verified` → `accepted/released`

可附加冻结/缺口/裁定标记（如 `owner_product_perception_failed`、`retained_as_internal_collaboration_harness`）；证据保留。

**工程/运行验证通过 ≠ 产品验收通过**：PAN-01R 即为 `statically_verified` + `owner_runtime_verified` 但 `owner_product_perception_failed` 的实例；两类结论必须分开记录。

### 5.2 用户面状态（仅允许）

| 用户状态 | 含义 |
|---|---|
| 可用 | 真实执行路径 + 对应运行验收 |
| 实验 | 真实执行，边界或验证有限 |
| 本地模拟 | 本机演示授权与协作，不代表公网 |
| 预览 | 可查看，不能执行 |
| 尚未开放 | 只说明方向，无操作入口 |

规则：`implemented` / `statically_verified` **不**自动等于「可用」；静态 UI/JSON 不能证明可用；失败与取消不得显示成功；本地模拟不得显示为真实公网协作。

---

## 6. Alpha / Trusted Beta 边界（摘要）

| 三位一体 Alpha | Trusted Beta |
|---|---|
| 理解我 × 武装我 × 连接世界三部分 Alpha 达标 | 高风险路径、异常、迁移、兼容与安全硬化 |
| 极简前台 + 复杂后台；个性化隐性、风险授权显性 | 按用户证据升格高价值实验能力 |
| 协作骨架（本地模拟与真实外部严格区分） | 更多真实外部能力与互操作 |
| 5～10 名非开发者真实主路径验证 | 更接近生产的连续验证 |

---

## 7. 维护规则

1. 每次只推进一个已批准 PAN 主实现任务；传播文案可并行，不得与代码任务改同一文件。
2. 非阻断问题只进 §4 backlog，不自动进开发。
3. 恢复 backlog 须先写最小阻断说明，不可直接扩 scope。
4. 更新本索引时同步 `digitalme_capability_status_v0.1.md` 与 `digitalme_log.md`。
5. PAN-00 已于 `bc85a14` 标记 `accepted`（历史）。PAN-01 与 PAN-01R 按 PAN-00R 裁定归档，均**不得标 `accepted`**、不得回滚、不得删除证据。PAN-00R 已 `accepted`（`07b631d` + `6ae2dca` + `0fcd432`；docs/strategy acceptance，不是运行能力 released）。**PAN-01S / PAN-01S.1 / PAN-01S.2 已于 2026-07-20 `accepted`**（Owner real Electron runtime；baseline `cbde807`）。**R1 已于 2026-07-21 `accepted`**（baseline `8d7e9b3`）。
6. **本文件角色（v0.2.25）**：历史状态表；**当前执行计划**见 `digitalme_first_vertical_loop_sprint_plan_v0.1.md`。R2 **retained as infrastructure**；R3 **`paused`**；不得继续把「Codex 复核 R2 / 开始 R3」写成项目下一步。**旧 DM-Core-01A 开发指令**已 `superseded`；提交 **`55ae01f`** 为 `retained_for_mapping_review`（不得笼统写成「实现不存在」）。
