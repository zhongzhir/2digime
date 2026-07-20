# Digital Me Product Panorama 执行索引

版本：v0.2.10
日期：2026-07-20
状态：`active`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`（v0.4，三位一体重构）
代码实现基线：`cbde807fd1e40472d66fbe8f0810a0835e8bc816`（分支 `codex/pan-01s2-chat-incident-close`；PAN-01S 族 Owner 验收 accepted）
文档基线：`35c5aead8879f818ae0e1e90836a8fee557c22c7`（`PAN01R_SPEC_BASE`，历史）；本轮战略修订见 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`
规格依据：`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`（v0.4）、`digitalme_renderer_foundation_R0_decision_and_migration_plan.md`（v0.1.1-draft）、`digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`、`digitalme_phase1_task_PAN-01S_minimal_product_surface.md`、`digitalme_phase1_task_PAN-01S.1_subject_clarity_progressive_build.md`、`digitalme_phase1_task_PAN-00_strategy_spec_freeze.md`、`digitalme_phase1_task_PAN-01_product_panorama_home.md`（历史）、`digitalme_phase1_task_PAN-01R_sovereign_collaboration_loop.md`（历史）、`digitalme_product_spec_v0.2.md`（文内 **v0.6.3**）

> 本文件是当前阶段唯一执行索引。冲突时：用户体验以产品规格 **v0.6.3** 为准；排期以 P1-PANORAMA v0.4 与本索引为准；安全底线优先于 Alpha 速度。
>
> **v0.2 修订（2026-07-19，PAN-00R）**：第一阶段确立为三位一体 Alpha；PAN-01 / PAN-01R 写入正式裁定（均不 accepted）；新执行顺序生效。PAN-00R 已 **accepted**（`07b631d` + `6ae2dca` + `0fcd432`）。
>
> **v0.2.1～v0.2.6（2026-07-19）**：PAN-01S 规划→实现→Owner 要求修订→PAN-01S.1 实现；当时等待 Owner 验收（历史过程）。
>
> **v0.2.7 修订（2026-07-20，Owner 真机验收）**：**PAN-01S / PAN-01S.1 / PAN-01S.2 = `accepted`**（Owner real Electron runtime；baseline `cbde807`）。**PAN-02** = `planned` / `blocked`。**renderer foundation R0** = `planned` / `not_started`。
>
> **v0.2.8 修订（2026-07-20，执行顺序修正）**：确认下一唯一任务为 **起草并冻结 Renderer Foundation R0 独立决策/任务包**（仅规格起草授权；不授权实现或创建分支）。PAN-02 保持 `planned` / `blocked`，须待 R0 边界决策后由 Owner/Codex 另行决定启动顺序。不改变 PAN-01S 族 accepted 结论。
>
> **v0.2.9 修订（2026-07-20，R0 决策稿起草）**：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md`（v0.1-draft；`fc56259`）已入库。R0 = **`spec_drafted` / `codex_review_pending`**（历史）。
>
> **v0.2.10 修订（2026-07-20，R0 修订 1）**：关闭 Codex 第一轮架构歧义（整窗入口、SQLite→R2.5 deferred、Playwright E2E、R1 收窄）。R0 = **`spec_revision_1` / `codex_review_changes_requested`**（v0.1.1-draft；**不** accepted）。implementation = `not_started`；无实现分支。下一动作：Codex 再复核；**不得**开始 R1。PAN-02 仍 `planned` / `blocked`。PAN-01S 族 accepted 不变。

---

## 1. 当前主线与唯一下一任务

```text
P1-PANORAMA（三位一体 Alpha）
→ PAN-00 accepted
→ PAN-00R accepted
→ PAN-01 statically_verified / owner_product_perception_failed / needs_minimal_surface_reset（历史；不 accepted）
→ PAN-01R statically_verified / … / retained_as_internal_collaboration_harness（历史；不 accepted；无生产入口）
→ PAN-01S accepted（2026-07-20；baseline cbde807）
→ PAN-01S.1 accepted（2026-07-20；baseline cbde807）
→ PAN-01S.2 accepted（2026-07-20；baseline cbde807；对话事故收口）
→ renderer foundation R0（spec_revision_1 / codex_review_changes_requested；implementation not_started）← 当前唯一任务：Codex 再复核
→ PAN-02 理解通道 Alpha（planned / blocked；见 R0 §16；不以 SQLite 为前提）
→ …
```

| 项 | 当前值 |
|---|---|
| 总任务状态 | `active / three_part_alpha_reframed / PAN-01S_family_accepted` |
| 当前完成 | PAN-00 / PAN-00R `accepted`；PAN-01 / PAN-01R 已裁定（不 accepted）；**PAN-01S / S.1 / S.2 `accepted`** |
| **当前唯一任务** | **Codex 再复核 Renderer Foundation R0**（`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` v0.1.1-draft）。R0 = `spec_revision_1` / `codex_review_changes_requested`（**不** accepted）。R0 implementation = `not_started`；实现分支不存在。**不得**开始 R1。PAN-02 保持 `planned` / `blocked`。 |
| Acceptance basis | Owner real Electron runtime；baseline `cbde807`；date 2026-07-20（**不因本修订改变**） |
| 明确不得启动 | R0/R1 实现或重构分支；未经批准的 PAN-02 任务包/实现；PAN-03～PAN-06；P1-07 修复；Digital Org；公网协作；重开 PAN-01S |

---

## 2. PAN 任务状态表（v0.2.7）

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
| renderer foundation R0 | 架构决策与渐进迁移规格（非实现；非 PAN 主线） | **`spec_revision_1` / `codex_review_changes_requested`**；implementation = `not_started`；branch = 不存在 | 任务包 v0.1.1-draft：整窗入口；R2=JSON；R2.5 SQLite deferred；Playwright E2E；R1 收窄 | Codex 再复核 → Owner 答复决策问题 → 另立 R1 实现任务包 | R1～R6；**不得**标本轮 accepted；不重开 PAN-01S |
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

### 2.3 非阻断技术债（renderer foundation backlog）

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
5. PAN-00 已于 `bc85a14` 标记 `accepted`（历史）。PAN-01 与 PAN-01R 按 PAN-00R 裁定归档，均**不得标 `accepted`**、不得回滚、不得删除证据。PAN-00R 已 `accepted`（`07b631d` + `6ae2dca` + `0fcd432`；docs/strategy acceptance，不是运行能力 released）。**PAN-01S / PAN-01S.1 / PAN-01S.2 已于 2026-07-20 `accepted`**（Owner real Electron runtime；baseline `cbde807`）。
6. **当前唯一任务**：**Codex 再复核** Renderer Foundation R0（`spec_revision_1` / `codex_review_changes_requested`；implementation `not_started`；无实现分支）。**不得**开始 R1；**不得**标 R0 accepted。**PAN-02** 保持 `planned` / `blocked`（解锁见 R0 §16；不以 SQLite 为前提）。**不得**重开 PAN-01S。非阻断技术债见 §2.3。
