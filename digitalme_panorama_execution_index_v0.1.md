# Digital Me Product Panorama 执行索引

版本：v0.1
日期：2026-07-19
状态：`active`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`
代码实现基线：`a40c5f8`（PAN-01 scaffold）
文档基线：待记 `PAN01R_SPEC_BASE`（PAN-01R 任务包冻结）
规格依据：`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`、`digitalme_phase1_task_PAN-00_strategy_spec_freeze.md`、`digitalme_phase1_task_PAN-01_product_panorama_home.md`、`digitalme_phase1_task_PAN-01R_sovereign_collaboration_loop.md`、`digitalme_product_spec_v0.2.md`（文内 v0.5 / v0.5.1 / v0.5.2）

> 本文件是当前阶段唯一执行索引。冲突时：用户体验以产品规格 v0.5（含 v0.5.2）为准；排期以 P1-PANORAMA 与本索引为准；安全底线优先于 Alpha 速度。

---

## 1. 当前主线与唯一下一任务

```text
P1-PANORAMA
→ PAN-00 accepted
→ PAN-01 statically_verified / owner_product_perception_failed / retained_as_scaffold
→ PAN-01R specified / owner_approved / frozen_for_implementation
→ PAN-02 paused_until_PAN-01R_acceptance
→ PAN-03 paused_until_PAN-01R_acceptance
→ PAN-04 paused_until_PAN-01R_acceptance
→ PAN-05 copy_drafting_allowed
→ PAN-06 planned
```

| 项 | 当前值 |
|---|---|
| 总任务状态 | `active / PAN-01R_frozen_for_implementation` |
| 当前完成 | PAN-00 `accepted`（`bc85a14`）；PAN-01 `statically_verified` / `owner_product_perception_failed` / `retained_as_scaffold`（不标 accepted；不回滚） |
| **下一实现任务** | **PAN-01R**（Digital Me 主权协作闭环） |
| 启动条件 | 已满足（Owner 已批准规格并授权直接实现） |
| 当前阻断项 | PAN-01 产品感知未通过；由 PAN-01R 提供纵向产品证据链 |
| 明确不得启动 | P1-07 修复、原 P1-08、Policies 全面迁移、Digital Org 运行时、公网协作、PAN-02/03/04（至 PAN-01R 验收前） |

---

## 2. PAN-00～PAN-06 状态表

| 任务 | 目标 | 当前状态 | 启动条件 | 完成闸门 | 完成后下一步 |
|---|---|---|---|---|---|
| PAN-00 | 战略与规格冻结；建立索引与 backlog | `accepted`（`bc85a14`） | Owner 已批准总任务 | 文档一致；Codex 最终复核 | PAN-01 |
| PAN-01 | 产品全貌首页：主体卡、四承诺、成长路线 | `statically_verified` / `owner_product_perception_failed` / `retained_as_scaffold`（不标 accepted；不回滚） | PAN-00 accepted；独立任务包已批准 | 已工程验证；Owner 产品感知未通过 | PAN-01R |
| PAN-01R | 主权协作闭环：依据×能力×授权×代表协作×结果处置 | `specified` / `owner_approved` / `frozen_for_implementation` | Owner 批准本任务包 | Codex 复核 + Owner 主路径验收；工程最多 `statically_verified` | PAN-02（验收后） |
| PAN-02 | 薄版控制权面板 | `paused_until_PAN-01R_acceptance` | PAN-01R Owner 主路径通过 | 用户能看见、关闭、撤销、恢复、找记录 | PAN-03 |
| PAN-03 | 能力获得感：三层 + 三卡 + 立即体验 | `paused_until_PAN-01R_acceptance` | PAN-02 主路径通过 | 至少一项真实小任务完成 | PAN-04 |
| PAN-04 | 本地协作沙盘与六要素授权 | `paused_until_PAN-01R_acceptance` | PAN-03 主路径通过 | 授权→模拟→采用/拒绝→记录可走通 | PAN-06（主线） |
| PAN-05 | 传播与体验包 | `planned` / `copy_drafting_allowed` | PAN-00 完成 | 文案可起草；正式录屏须基于真实 Alpha | 与主线同步，录屏后置 |
| PAN-06 | 非开发者验证与 Trusted Beta 决策 | `planned` | 01～05 / 01R 形成可体验 Alpha | 5～10 人验证 + Trusted Beta 前三硬化项 | Trusted Beta 排序 |

---

## 3. P1-07 冻结状态（必须一致）

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

| 项 | 说明 |
|---|---|
| 代码基线 | `5ab55dc` |
| 收工文档提交 | `8fb8210`（历史保留；其中「等待 Codex 复核与 Owner 运行验收」的下一门槛已被本冻结决定取代） |
| 不标 | `accepted` |
| 不占用 | Panorama 当前主线 |
| 已知缺口 1 | 真实 GUI 多类别审阅：第一组提交后，第二组未被 Owner 观察到自动呈现 |
| 已知缺口 2 | 智能构建确认交互尚未由 Owner 完整复验 |
| 恢复条件 | 仅资料损坏、越权写入、密钥泄漏，或构成 Panorama 主路径阻断时 |

---

## 4. 冻结 backlog

每项均暂停，不为 PAN-00 排详细工期。恢复须先提交最小阻断说明，经 Codex 复核后只做必要切片。

| 项 | 来源 | 当前状态 | 暂停原因 | 恢复条件 | 关联风险 |
|---|---|---|---|---|---|
| P1-07 多组审阅第二组未自动呈现 | Owner 验收 / P1-07 | `known_gap / frozen` | 非 Panorama 主路径；局部交互 | 资料损坏/越权/密钥泄漏，或阻断「构建我」主路径 | 构建审阅体验不完整 |
| P1-07 智能构建确认交互未完整复验 | Owner 验收 / P1-07 | `known_gap / frozen` | 同上 | 同上 | 取消/确认边界可能被误解 |
| Policies 全面迁移 PackageStore | 原 WP1 / P1 计划 | `paused` | Alpha 不依赖全量迁移 | Trusted Beta 或安全阻断 | 部分策略仍直写 |
| 认知页零散编辑迁移 | P1-07 非范围 | `paused` | 非闭环主路径 | Trusted Beta 或写路径冲突 | 双写路径并存 |
| Life 读取体系重构 | P1-07 后续 | `paused` | 只读聚合可先支撑首页 | 首页/控制面读路径阻断 | 读取不一致 |
| `package:load` scaffold | 工程债 | `paused` | 非用户闭环 | 加载/恢复主路径阻断 | 恢复流程脆弱 |
| MCP 全面迁移 ToolBroker | 原 WP3 | `paused` | Alpha 仅需受控执行切片 | 高风险 MCP 默认开启前 | 工具越权 |
| Package 全类型深度校验与迁移 | 原 WP1/WP6 | `paused` | Alpha 复用已接入切片 | Trusted Beta / 迁移验收 | schema 漂移 |
| 审计密码学增强 | 原审计远景 | `paused` | 现有 DecisionAudit 可支撑 Alpha 记录 | 对外宣称不可篡改前 | 过度承诺 |
| 非阻断 UI 细节 | 各任务 | `backlog` | 不因局部打磨延迟闭环 | 主路径通过后按证据排序 | 进度假象 |
| PAN-01 非阻断 UI 细节（卡片/间距/抽象文案打磨） | Owner 感知 / PAN-01 | `backlog` | 不继续打磨 scaffold；由 PAN-01R 提供产品证据 | PAN-01R 验收后按证据排序 | 用视觉代替证明 |
| 原 P1-08 | 旧阶段队列 | `paused / superseded_as_queue` | 主线切换为 P1-PANORAMA | PAN-06 后按用户证据重排 | 误启旧队列 |
| Digital Org 运行时 | 叙事母稿 / 长期架构 | `long_term / not_in_alpha` | 个人 Alpha 范围 | P1-PANORAMA 后评估 DORG-00 | 范围膨胀 |
| 公网协作、支付和结算 | 协作远景 | `out_of_alpha` | 安全与非目标 | Trusted Beta 之后单独规格 | 攻击面与合规 |

---

## 5. 两套状态（不得混用）

### 5.1 工程状态（本索引与能力表）

`planned` → `specified` → `implemented` → `statically_verified` → `runtime_verified` → `accepted/released`

可附加冻结/缺口标记；证据保留。

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

| Product Panorama Alpha | Trusted Beta |
|---|---|
| 普通用户理解并走通薄而完整闭环 | 高风险路径、异常、迁移、兼容与安全硬化 |
| 真实 / 实验 / 本地模拟严格分级 | 按用户证据升格高价值实验能力 |
| 1 个受控研究协作示范（本地模拟） | 更多真实外部能力与互操作 |
| 5～10 名非开发者认知验证 | 更接近生产的连续验证 |

---

## 7. 维护规则

1. 每次只推进一个已批准 PAN 主实现任务；PAN-05 文案可并行，不得与代码任务改同一文件。
2. 非阻断问题只进 §4 backlog，不自动进开发。
3. 恢复 backlog 须先写最小阻断说明，不可直接扩 scope。
4. 更新本索引时同步 `digitalme_capability_status_v0.1.md` 与 `digitalme_log.md`。
5. PAN-00 已于 `bc85a14` 标记 `accepted`。PAN-01 为 `statically_verified` / `owner_product_perception_failed` / `retained_as_scaffold`，不得标 `accepted`，不得回滚。PAN-01R 为实现唯一任务；实现者最多标 `statically_verified`，不得自行标 `accepted`。PAN-01R 验收前不得启动 PAN-02/03/04。
