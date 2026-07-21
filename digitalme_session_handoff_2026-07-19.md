# Digital Me 新会话衔接文档

日期：2026-07-19  
角色关系：Owner（用户）＋ ChatGPT/Codex（规划、架构与复核）＋ Cursor（本地仓库实现）

> **2026-07-21 规划基线重建**：本文为 **2026-07-19 历史衔接**，**不再**作为当前状态或下一任务权威。  
> **当前最高架构原则**：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
> **当前唯一执行计划**：[`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)  
> **下一项**：实现任务意图与本人上下文装配（第一闭环实现 · 第 1 块；待授权）。R3 `paused`；`55ae01f` = `retained_for_mapping_review`。

---

## 1. 新会话开场指令

请继续承担 Digital Me 项目的 Codex 角色，与我（Owner）和 Cursor 协作。先阅读本衔接文档，以其中的当前状态、战略决策、工程边界和下一任务为准；不要回到旧 P1 队列，不要自行开始 PAN-02，不要 push。

本地仓库：

```text
C:\Users\46554\WPSDrive\421507599\WPS云盘\Digital Me
```

当前应等待 Cursor 完成 PAN-01S 实现并提交完成报告与交接件，然后进行 Codex 静态复核和 Owner 产品验收。

---

## 2. 产品最高定义

Digital Me 第一阶段不是“完整展示一套产品构造”，而是形成三位一体的 Alpha：

```text
理解我 × 武装我 × 连接世界
```

- 只有“理解我”：数字档案或个人资料库。
- “理解我＋武装我”：个性化 Agent。
- “理解我＋武装我＋连接世界”：初级数字主体，能够借助能力代表本人参与数字世界，并通过真实交互形成成长飞轮。

法律身份、社会承认和规模化互操作属于后续阶段，不得在 Alpha 过度宣称。

产品价值最终由用户体验证明：用户低负担输入信息，后台完成有效蒸馏；用户在写作、研究、编程和做事过程中自然发现 Agent 具有自己的事实、观点、风格、规范、边界与成长，而不是观看系统在页面上证明“我如何理解你”。

---

## 3. 已冻结的产品原则

### 3.1 极简表面

- 后台复杂，前台极简。
- 用户体验结果，不观看系统证明。
- 个性化默认隐性；风险、授权和外部行动显性。
- 普通页面不展示工程状态、系统链路、证据编号和大段机制说明。
- 四个承诺、成长路线、数字主权等理念进入帮助／用户手册，不作为首页信息墙。
- 能力使用应无负担；权力和高风险动作必须可控。
- 非阻断 UI 偏好进入 backlog，不反复打磨阻塞阶段推进。

### 3.2 AI 如何使用主体信息

核心规则：

> AI 负责能力上限；Digital Me 负责方向、真实性、边界、连续性和本人特征。

生成必须经过相关性门：

- verified fact：事实锚点；
- confirmed owner assertion：本人确认的观点／立场约束；
- preference：软引导；
- inference：低权重假设；
- boundary：硬约束；
- 无关主体信息：不得进入本次生成。

没有相关主体信息时，保持通用 AI 的高质量输出，不强行个性化，不全量注入 Package，不机械添加个人引用，不因资料不足降低输出质量。用户默认只看自然结果；来源和依据按风险与需要展开。

### 3.3 主体与外部反馈

- 外部伙伴、模型或工具不得直接改写“我是谁”。
- 外部观察和反馈先成为 current_state、inference 或候选。
- 本人真实行动结果可以成为 fact 候选。
- 立场、长期意图、人格和边界变化必须由本人确认。
- 主体写入继续遵守 preview → confirmation → PackageStore commit。

---

## 4. 关键历史裁定

### PAN-01

- 目标：产品全貌首页。
- 最终代码基线：`a40c5f8`。
- 状态：`statically_verified / owner_product_perception_failed / needs_minimal_surface_reset`。
- 工程验证通过，但产品感知失败；不 accepted，不回滚。
- 可信只读聚合和 fail-closed 逻辑保留。

### PAN-01R

- 目标：主权协作体验。
- 最终实现：`9dd6fa0`。
- 测试：`test:pan-01r` 70/70；owner runtime 20/20。
- 状态：`statically_verified / codex_review_passed / owner_runtime_verified / owner_product_perception_failed / retained_as_internal_collaboration_harness`。
- 工程与安全链路有效，但普通用户体验失败；不 accepted。
- 授权 token、取消、审计、adopt/reject、推理环境绑定等后台骨架保留，供内部测试和未来 PAN-04 使用。
- PAN-01S 生产环境必须没有 PAN-01R 入口；未来用户协作体验由 PAN-04 重新规格。

### PAN-00R

- 战略重构提交：`07b631d`。
- Codex 文档修复：`6ae2dca`。
- 验收收尾：`0fcd432`。
- 状态：`accepted`，仅表示 docs/strategy acceptance，不表示产品能力 released。

---

## 5. 当前任务：PAN-01S

任务：极简产品表面与复杂度后移。

规划提交：

- 初稿：`488d733` — `docs(plan): freeze PAN-01S minimal product surface`
- Codex 第一轮规格修复：`2aec151` — `docs(plan): close PAN-01S state and harness ambiguity`

Codex 已完成最终复核：PAN-01S v0.1.1 规格通过，可以进入实现。

Cursor 已收到完整执行命令，要求：

1. 先创建一个独立 docs-only 规格接受提交；
2. 从该接受提交创建分支：
   `codex/pan-01s-minimal-product-surface`；
3. 实现 PAN-01S；
4. 提交信息：
   `feat(ui): reduce Digital Me to a minimal subject surface`；
5. 最多使用 2 轮有界 Loop；
6. 完成后停止，不开始 PAN-02，不标 accepted，不 push。

### 5.1 规格接受提交必须顺手修正

- `digitalme_context.md` 顶部产品规格 v0.6.1 → v0.6.3；
- 删除 PAN-01S 任务包重复的 `## 13. 明确非目标` 标题；
- 将 `9dd6fa0` 澄清为代码血缘基线；实现分支必须从最新规格接受提交创建；
- 当前状态更新为：
  `specified / owner_approved_for_implementation / frozen_for_implementation / codex_review_passed / not_started`；
- `codex_review_changes_requested` 仅保留在历史记录。

### 5.2 默认“我”页面

只允许：

- 主体名称；
- 不超过两行的自然说明；
- 一个主操作；
- 最多一个次操作；
- 必要时一条简短提醒。

必须从默认表面真正删除：

- 四个承诺墙；
- 成长路线墙；
- PAN-01R CTA 和五步体验；
- 能力、边界、版本、数据分类和工程统计墙；
- Package／模型／能力／品牌的侧栏常驻摘要；
- PAN 编号、证据编号和内部技术名词；
- 长篇状态或 fail-closed 说明。

四个承诺与成长路线迁入现有“说明／帮助”。

### 5.3 主操作唯一优先级

状态必须由主进程可信数据派生。按顺序求值，命中即停：

| 优先级 | 条件 | 主操作 |
|---|---|---|
| P0 | `read_error`、`content_degraded`、结构损坏或不能安全给出正常结论 | 查看问题 |
| P1 | `missing` / `uninitialized`，且不是读取损坏 | 继续构建 |
| P2 | `awaiting_review` / `pending_confirmation` | 继续确认 |
| P3 | `suggested`、`failed-retryable` 等明确可操作 inbox 状态；不含 `processing` | 继续完善 |
| P4 | 主体可读且无 P0～P3 | 查看我的信息 |

冲突结果：

- awaiting_review + suggested → P2；
- read_error + awaiting_review → P0；
- missing + suggested → P1；
- processing only + 主体可读 → P4，可附处理中提醒；
- 未知状态、字段缺失、未知 navTarget → fail-closed，不导航、不假成功。

renderer 只渲染主进程结果并执行白名单导航，不得重新推导或覆盖状态。

### 5.4 PAN-01R 无生产入口

生产环境下不得通过以下任何方式发现或开启 PAN-01R：

- 普通 UI、设置、高级、帮助；
- 隐藏按钮或可猜测路由；
- URL/hash/query/localStorage；
- renderer 参数或普通 IPC payload；
- production preload API。

test-only harness：默认 false，只能由主进程隔离测试环境启用，renderer 不能开启，使用隔离 userData 和 hermetic fixture，不触碰真实 Package。

---

## 6. PAN-01S 必测范围

新增：

- `test:pan-01s`
- `test:pan-01s-owner-runtime`

必须覆盖：极简入口、P0～P4、冲突组合、inbox 不劫持、帮助迁移、侧栏收口、异常降级、renderer 不可伪造、Package 前后字节不变、无敏感信息泄漏、生产无 PAN-01R 入口、test-only 隔离。

最低回归：

- `test:pan-01`
- `test:pan-01-owner-runtime`
- `test:pan-01r`
- `test:p1-03`
- `test:p1-07-owner-runtime`
- `test:p1-phase1`
- `test:owner-runtime`
- 修改文件的 `node --check`
- `git diff --check`

不得默认运行 `test:p1-baseline-real`，不得恢复或覆盖真实 Package。

---

## 7. 全局工程硬边界

- 不触碰或覆盖 `digital-me-package/**`。
- 测试使用 hermetic fixture 和隔离 userData。
- renderer 不决定 dataKind、授权结论、可信状态或审计内容。
- 主体写入、授权和外部行动是不可妥协的骨架。
- 不提交 zip/diff/stat/status/bundle 交接文件。
- 未设置 remote；不得 push。
- 不 amend，不 squash，保留提交链。
- 已跟踪工作区异常时停止；不 reset、不 checkout 覆盖、不 stash Owner 修改。
- 不为通过旧测试保留已经失败的产品界面，应迁移测试。
- 当前阶段实行“先感知，再收紧”，但主体写入、授权、外部行动的安全原则从一开始即不可妥协。

---

## 8. 当前明确非目标

PAN-01S 不包含：

- PAN-02 理解通道；
- 相关性检索和 49KB 全量注入替换；
- prompt 或蒸馏算法重构；
- PAN-03 能力框架；
- PAN-04 真实外部协作；
- PAN-05 成长回流；
- Policies 全面迁移；
- Life 读取重构；
- P1-07 冻结缺口修复；
- Digital Org、公网协作、支付结算；
- 大规模 CSS、renderer 或设置中心重写。

---

## 9. PAN-01S 之后的队列

```text
PAN-01S 极简产品表面
→ PAN-02 理解通道 Alpha
→ PAN-03 能力框架 Alpha
→ PAN-04 外部协作骨架 Alpha
→ PAN-05 成长飞轮与传播体验
→ PAN-06 非开发者验证与 Trusted Beta 排序
```

PAN-02～PAN-06 当前均为 `planned / not_started`。

不得在 PAN-01S 完成、Codex 复核和 Owner 主路径验收前启动 PAN-02。

---

## 10. 新会话下一步

如果 Cursor 尚未返回 PAN-01S 完成报告：等待其完成，不另发相互冲突的实现命令。

如果 Cursor 已返回完成报告：要求并核对以下交接件：

- 聚焦源码 zip；
- 从 `PAN01S_SPEC_ACCEPT` 到实现 HEAD 的代码 diff；
- docs diff；
- stat；
- status；
- 必要时 git bundle。

Codex 复核优先级：

1. 普通用户页面是否真正极简，而非把旧内容折叠或换位置；
2. P0～P4 是否确由主进程求值，renderer 是否只能消费白名单结果；
3. inbox 是否不再劫持默认“我”；
4. PAN-01R 是否从生产 UI、路由和 preload 真正退出；
5. test-only harness 是否与生产彻底隔离；
6. 是否未触碰真实 Package、未偷跑 PAN-02；
7. 是否避免非阻断性细节反复打磨。

复核通过后，再给 Owner 一份短而明确的主路径验收清单。只有 Owner 真实体验通过，PAN-01S 才可考虑 `accepted`。

---

## 11. 重要提交链摘要

```text
5ab55dc  P1-07 最后一次 Owner 验收修复
8fb8210  P1-07 收工文档基线
9b5de05  PAN-00 战略切换
bc85a14  PAN-00 状态语言修正 / accepted 依据
52b0d14  PAN-01 规划
01d56d0  PAN-01 实现
a6c8382  PAN-01 fail-closed 修复
a40c5f8  PAN-01 分层损坏降级
35c5aea  PAN-01R 规格冻结
88eaca5  Cursor 规则对齐
a47e041  PAN-01R 实现
385b921  PAN-01R 基线回填
860430d  PAN-01R 授权与依据修复
9dd6fa0  PAN-01R 审计与取消竞态收口
07b631d  PAN-00R 三位一体战略重构
6ae2dca  PAN-00R 个性化与极简规则修复
0fcd432  PAN-00R accepted
488d733  PAN-01S 独立任务包初稿
2aec151  PAN-01S 状态优先级与 harness 歧义关闭
```

后续应补记：

- `PAN01S_SPEC_ACCEPT` 实际 hash；
- PAN-01S 实现 commit；
- Codex 复核结论；
- Owner 产品验收结论。

