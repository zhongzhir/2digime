# Digital Me Product Panorama 执行索引

版本：v0.2
日期：2026-07-19
状态：`active`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`（v0.4，三位一体重构）
代码实现基线：`9dd6fa00e3c09ab65779203045c9858681c37443`（分支 `codex/pan-01r-sovereign-collaboration-loop`；PAN-01R 最终实现）
文档基线：`35c5aead8879f818ae0e1e90836a8fee557c22c7`（`PAN01R_SPEC_BASE`，历史）；本轮战略修订见 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`
规格依据：`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`（v0.4）、`digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`、`digitalme_phase1_task_PAN-01S_minimal_product_surface.md`（当前实现任务包）、`digitalme_phase1_task_PAN-00_strategy_spec_freeze.md`、`digitalme_phase1_task_PAN-01_product_panorama_home.md`（历史）、`digitalme_phase1_task_PAN-01R_sovereign_collaboration_loop.md`（历史）、`digitalme_product_spec_v0.2.md`（文内 **v0.6.1**；PAN-01S 澄清见 v0.6.2）

> 本文件是当前阶段唯一执行索引。冲突时：用户体验以产品规格 v0.6.1 / v0.6.2 为准；排期以 P1-PANORAMA v0.4 与本索引为准；安全底线优先于 Alpha 速度。
>
> **v0.2 修订（2026-07-19，PAN-00R）**：第一阶段确立为三位一体 Alpha；PAN-01 / PAN-01R 写入正式裁定（均不 accepted）；新执行顺序生效。PAN-00R 已 **accepted**（`07b631d` + `6ae2dca` + `0fcd432`）。
>
> **v0.2.1 修订（2026-07-19，PAN-01S 规划）**：PAN-01S 独立任务包已起草并冻结（`specified` / `owner_approved_for_implementation` / `frozen_for_implementation` / `not_started`）。**当前唯一任务：Codex 复核任务包后，创建 PAN-01S 实现分支并编码。** 本规划提交不创建实现分支、不修改产品代码；PAN-02～PAN-06 未开始。

---

## 1. 当前主线与唯一下一任务

```text
P1-PANORAMA（三位一体 Alpha）
→ PAN-00 accepted
→ PAN-00R accepted
→ PAN-01 statically_verified / owner_product_perception_failed / needs_minimal_surface_reset（历史；不 accepted）
→ PAN-01R statically_verified / codex_review_passed / owner_runtime_verified / owner_product_perception_failed / retained_as_internal_collaboration_harness（历史；不 accepted）
→ PAN-01S specified / frozen_for_implementation / not_started（任务包已冻结）
→（Codex 复核后）创建实现分支并编码 ← 当前唯一任务
→ PAN-02 理解通道 Alpha（planned；未开始）
→ PAN-03 能力框架 Alpha（planned；未开始）
→ PAN-04 外部协作骨架 Alpha（planned；未开始）
→ PAN-05 成长飞轮与传播体验（planned；未开始）
→ PAN-06 非开发者验证与 Trusted Beta 排序（planned；未开始）
```

| 项 | 当前值 |
|---|---|
| 总任务状态 | `active / three_part_alpha_reframed / PAN-01S_specified` |
| 当前完成 | PAN-00 `accepted`；PAN-00R `accepted`（`07b631d` + `6ae2dca` + `0fcd432`）；PAN-01 / PAN-01R 已裁定归档（均不 accepted）；PAN-01S 任务包已冻结（尚未实现） |
| **当前唯一任务** | **Codex 复核 PAN-01S 任务包后，创建实现分支并编码** |
| 启动条件 | Codex 复核通过本任务包；在独立实现分支上编码；不得在规划提交中偷跑 |
| 当前阻断项 | 等待 Codex 复核 `digitalme_phase1_task_PAN-01S_minimal_product_surface.md` |
| 明确不得启动 | 本规划提交内的产品代码修改；PAN-02～PAN-06；P1-07 修复；原 P1-08；Policies 全面迁移；Digital Org；公网协作 |

---

## 2. PAN 任务状态表（v0.2）

| 任务 | 目标 | 当前状态 | 启动条件 | 完成闸门 | 完成后下一步 |
|---|---|---|---|---|---|
| PAN-00 | 战略与规格冻结；建立索引与 backlog | `accepted`（`bc85a14`；历史，不改写） | — | 已完成 | — |
| PAN-00R | 三位一体重构、极简产品原则冻结、队列重排（仅文档） | `accepted`（`07b631d` + `6ae2dca` + `0fcd432`；Codex 最终复核通过；Owner 确认） | — | 已完成（docs/strategy） | PAN-01S 任务包 |
| PAN-01（历史） | 产品全貌首页 | `statically_verified` / `owner_product_perception_failed` / `needs_minimal_surface_reset`（不 accepted；不回滚） | — | 已裁定归档 | 表面收口由 PAN-01S 承接 |
| PAN-01R（历史） | 主权协作闭环 | `statically_verified` / `codex_review_passed` / `owner_runtime_verified` / `owner_product_perception_failed` / `retained_as_internal_collaboration_harness`（不 accepted；证据 `9dd6fa0`、70/70、20/20） | — | 已裁定归档 | 普通用户入口由 PAN-01S 撤下；骨架保留 |
| PAN-01S | 极简产品表面与复杂度后移 | `specified` / `owner_approved_for_implementation` / `frozen_for_implementation` / `not_started` | Codex 复核任务包后创建实现分支并编码；任务包：`digitalme_phase1_task_PAN-01S_minimal_product_surface.md` | 「我」页极简收口；四承诺/成长路线迁帮助；PAN-01R 普通用户入口撤下；后台与测试保留；实现最高 `statically_verified` | PAN-02 |
| PAN-02 | 理解通道 Alpha：低负担输入、后台蒸馏、关键纠错、任务相关检索、无关沉默 | `planned`（新定义） | PAN-01S 验收通过 + 独立任务包 | 理解我 Alpha 达标（规格 §7.6 第 1 条） | PAN-03 |
| PAN-03 | 能力框架 Alpha：统一能力对象、安装/启用/调用/停止/撤销、真实能力样例 | `planned`（新定义） | PAN-02 验收通过 + 独立任务包 | 武装我 Alpha 达标（规格 §7.6 第 2 条） | PAN-04 |
| PAN-04 | 外部协作骨架 Alpha：请求、接受、最小授权、执行、处置、停止与记录 | `planned`（新定义；可复用 PAN-01R 安全骨架，不复用其失败用户表面） | PAN-03 验收通过 + 独立任务包 | 连接世界 Alpha 达标（规格 §7.6 第 3 条） | PAN-05 |
| PAN-05 | 成长飞轮与传播体验：反馈成长候选、纵向闭环、真实体验传播材料 | `planned`（新定义） | PAN-04 验收通过 | 一次「输入—能力—协作—反馈—成长」闭环走通；传播材料基于真实体验 | PAN-06 |
| PAN-06 | 非开发者验证与 Trusted Beta 排序 | `planned` | PAN-01S～05 形成可体验 Alpha | 5～10 名非开发者真实主路径验证 + Trusted Beta 硬化排序 | Trusted Beta |

### 2.1 旧任务定义处置

| 旧定义 | 处置 |
|---|---|
| 旧 PAN-02「控制权面板」 | **superseded**：控制不再单独做成密集面板；控制能力按风险上下文分散到主体、能力和协作路径；完整控制细节进入设置/高级区域 |
| 旧 PAN-03「能力获得感」 | 保留历史，不删除；当前排期口径由新 PAN-03「能力框架 Alpha」取代 |
| 旧 PAN-04「本地协作沙盘」 | 保留历史，不删除；当前排期口径由新 PAN-04「外部协作骨架 Alpha」取代（六要素授权与安全边界继续有效） |
| 旧「PAN-02/03/04 paused_until_PAN-01R_acceptance；PAN-01R 验收通过后启动旧 PAN-02」 | **已删除**；不再是当前口径 |

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
5. PAN-00 已于 `bc85a14` 标记 `accepted`（历史）。PAN-01 与 PAN-01R 按 PAN-00R 裁定归档，均**不得标 `accepted`**、不得回滚、不得删除证据。PAN-00R 已 `accepted`（`07b631d` + `6ae2dca` + `0fcd432`；docs/strategy acceptance，不是运行能力 released）。
6. **当前唯一任务**：Codex 复核 PAN-01S 任务包后，创建实现分支并编码。任务包已冻结（`digitalme_phase1_task_PAN-01S_minimal_product_surface.md`）；本规划提交**不得**修改产品代码、**不得**开始 PAN-02～PAN-06。实现完成后最高 `statically_verified`；未经 Owner 主路径验收不得 `accepted`。
