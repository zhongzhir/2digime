# Digital Me Product Panorama 执行索引

版本：v0.1
日期：2026-07-18
状态：`active`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`
代码实现基线：`5ab55dc`
文档基线：`8fb8210`（P1-07_DOCS_BASE，仅 P1-07 收工文档）
规格依据：`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`、`digitalme_phase1_task_PAN-00_strategy_spec_freeze.md`、`digitalme_product_spec_v0.2.md`（文内 v0.5）

> 本文件是当前阶段唯一执行索引。冲突时：用户体验以产品规格 v0.5 为准；排期以 P1-PANORAMA 与本索引为准；安全底线优先于 Alpha 速度。

---

## 1. 当前主线与唯一下一任务

```text
P1-PANORAMA
→ PAN-00 战略切换与规格冻结     （本提交后：statically_verified）
→ PAN-01 产品全貌首页           （唯一下一实现任务；尚未建立独立任务包，不得开始编码）
→ PAN-02 控制权面板
→ PAN-03 能力获得感
→ PAN-04 本地协作沙盘
→ PAN-05 传播与体验包
→ PAN-06 非开发者验证与 Trusted Beta 决策
```

| 项 | 当前值 |
|---|---|
| 总任务状态 | `active / PAN-01_pending_spec` |
| 当前完成 | PAN-00 文档冻结（待 Codex 复核，不标 accepted） |
| **唯一下一实现任务** | **PAN-01：产品全貌首页** |
| 启动条件 | PAN-00 经 Codex 复核；建立独立 PAN-01 任务包 |
| 当前阻断项 | 无产品代码阻断；等待 Codex 复核与 PAN-01 任务包 |
| 明确不得启动 | P1-07 修复、原 P1-08、Policies 全面迁移、Digital Org 运行时、公网协作 |

---

## 2. PAN-00～PAN-06 状态表

| 任务 | 目标 | 当前状态 | 启动条件 | 完成闸门 | 完成后下一步 |
|---|---|---|---|---|---|
| PAN-00 | 战略与规格冻结；建立索引与 backlog | `statically_verified`（本提交后；不标 accepted） | Owner 已批准总任务 | 文档一致；无代码变更；Codex 复核 | 建立 PAN-01 任务包 |
| PAN-01 | 产品全貌首页：主体卡、四承诺、成长路线 | `specified_in_master / not_started` | PAN-00 复核通过并建立独立任务包 | 陌生用户能看见「这是我 / 属于我」主路径 | PAN-02 |
| PAN-02 | 薄版控制权面板 | `planned / not_started` | PAN-01 主路径通过 | 用户能看见、关闭、撤销、恢复、找记录 | PAN-03 |
| PAN-03 | 能力获得感：三层 + 三卡 + 立即体验 | `planned / not_started` | PAN-02 主路径通过 | 至少一项真实小任务完成 | PAN-04 |
| PAN-04 | 本地协作沙盘与六要素授权 | `planned / not_started` | PAN-03 主路径通过 | 授权→模拟→采用/拒绝→记录可走通 | PAN-06（主线） |
| PAN-05 | 传播与体验包 | `planned / copy_drafting_allowed` | PAN-00 完成 | 文案可起草；正式录屏须基于真实 Alpha | 与 01～04 同步，录屏后置 |
| PAN-06 | 非开发者验证与 Trusted Beta 决策 | `planned / not_started` | 01～05 形成可体验 Alpha | 5～10 人验证 + Trusted Beta 前三硬化项 | Trusted Beta 排序 |

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
5. PAN-00 不标 `accepted`，直至 Codex 复核与 Owner 确认战略冻结。
