# Digital Me 总任务 P1-PANORAMA：产品全貌 Alpha（三位一体重构）

版本：v0.4
日期：2026-07-19
状态：`active / three_part_alpha_reframed / PAN-01S_family_accepted`
任务类型：阶段策略调整 / 产品纵向闭环 / 市场认知启动
文档基线：`cbde807`（PAN-01S 族 Owner 验收 accepted）；战略修订依据 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`
历史基线：`5ab55dc`（代码）+ `8fb8210`（P1-07_DOCS_BASE）；P1-07 保持 `statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama`，不因此标记 accepted

> **v0.4 修订（2026-07-19，PAN-00R）**：以「第一阶段三位一体 Alpha」（理解我 × 武装我 × 连接世界）取代「在首页完整展示产品全貌」的旧理解；冻结极简产品原则与 AI 使用主体信息新原则；记录 PAN-01 / PAN-01R 正式裁定；重排 PAN 执行队列。v0.3.2 及更早的「产品全貌首页 / 10～15 分钟看完所有产品构造」相关要求已历史化，见 §15 历史记录。

---

## 0. 任务定位

P1-PANORAMA 不是继续增加一个局部功能，也不是降低技术、安全和可信标准。

它要改变当前阶段的交付组织方式：

> 利用已经建立的可信底座，让普通用户通过几条简洁、真实、可完成的路径，自然体验到一个初级数字主体——它逐渐理解我、能获得能力帮我工作、受我修正和约束、风险与对外行动由我决定、能够与世界交互、会从经历和反馈中成长。

**旧理解（已废止）**：曾要求「产品全貌首页」在一个页面上展示四个承诺、成长路线与主体全貌，并让用户在 10～15 分钟内看完所有产品构造。PAN-01/PAN-01R 的 Owner 产品感知验收证明该路径失败：密集信息展板与强制显式引用不能产生「这是我的数字主体」的真实感知。

**新定义（v0.4 冻结）**：产品全貌 = 用户通过纵向真实体验建立认识，不是信息密集总览页。

---

## 1. 第一阶段三位一体 Alpha（最高定义）

Digital Me 第一阶段必须同时完成三个组成部分的 Alpha：

### 1.1 理解我

- 正常、低负担地输入本人资料和日常表达；
- 系统在后台完成正确蒸馏；
- 区分事实、本人主张、推断、当前状态和边界；
- 用户只处理少量关键纠错与确认；
- 任务相关信息能够被准确检索；
- 与任务无关的主体信息保持沉默；
- 不用密集页面向用户证明系统理解了什么。

### 1.2 武装我

- 建立统一能力框架；
- 至少有真实可体验的能力样例；
- 能力可以继续安装、扩展、替换和撤销；
- 主体信息只在相关时帮助能力产生更符合本人的结果；
- AI 的能力上限不被现有蒸馏结果限制。

### 1.3 连接世界

- 建立外部请求、授权、执行、停止、结果处置和记录的协作骨架；
- 第一阶段不要求全面公网协作，但必须让用户感知未来如何代表本人；
- 外部行动必须受本人授权和边界约束；
- 交互结果与反馈能够形成成长候选；
- 外部输入不得直接改写主体。

### 1.4 三者的产品意义

- 只有「理解我」：只是数字档案或资料库；
- 「理解我 + 武装我」：是个性化 Agent；
- 「理解我 + 武装我 + 连接世界」：才形成产品与技术意义上的初级数字主体；
- 法律身份、社会承认、规模互操作属于后续阶段，第一阶段不得过度宣称。

---

## 2. 阶段目标与第一阶段闭环

### 2.1 第一阶段闭环（冻结）

```text
用户输入自己
→ 后台蒸馏并形成可修正的自我
→ 调用可扩展能力
→ 经本人授权参与外部协作
→ 获得结果与反馈
→ 形成事实、经验、能力表现或发展线索候选
→ 经正确分类及必要确认后推动 Digital Me 成长
→ 改善下一次工作与协作
```

### 2.2 成长回流规则

- 已真实发生的本人行动和结果：可成为 fact 候选；
- 外部反馈：先作为外部观察、current_state 或 inference；
- 系统归纳出的规律：默认 inference；
- 本人立场、长期意图、人格与边界的改变：必须由本人确认；
- 能力调用和结果反馈可以推动能力熟练度与推荐；
- 外部伙伴、模型或工具不得直接写入「我是谁」；
- 所有主体写入仍遵守既有 preview → confirmation → PackageStore commit 骨架。

### 2.3 产品成功画面

用户在真实使用中（而非阅读说明后）能够自然回答：

1. 它是否逐渐理解我；
2. 哪些内容是本人确认，哪些只是系统推断；
3. 它当前能为我做什么、如何增加或撤销能力；
4. 外部请求由谁发起、想做什么、我如何批准或拒绝；
5. 结果去了哪里、我如何采纳或丢弃；
6. 它如何从我的使用和反馈中成长。

用户不需要理解 Package、MCP、IPC、change set、Agent Card 等内部名词。

---

## 3. AI 使用主体信息原则（冻结）

Digital Me **不采用**「从蒸馏内容出发，回答上限受蒸馏内容限制」的逻辑，也**不采用**「先生成通用答案，再机械贴入个人引用」的逻辑。

冻结为：

> **AI 负责能力上限；Digital Me 负责方向、真实性、边界、连续性和本人特征。**

不同信息的作用：

- verified fact：事实锚点，不得改变或冲突；
- confirmed owner assertion：立场和意图约束，允许分析与推演，但不得冒充本人改变立场；
- preference / style / pattern：软引导，用于取舍、重点、风格和表达，不作为必须显式引用的事实；
- inference / direction clue：低权重假设，不确定时不使用或询问；
- boundary / authorization：硬约束；
- 与任务无关的信息：不得进入本次生成。

处理过程与禁止事项详见 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md` §3 与产品规格 v0.6。

---

## 4. 极简产品原则与信息架构

### 4.1 极简产品原则（冻结，详见产品规格 v0.6 §2）

1. 后台复杂，前台极简；
2. 用户体验结果，不观看系统证明自己；
3. 个性化默认隐性发生；
4. 授权只在风险边界上显性发生；
5. 审计、来源和依据可按需展开，但不占据主界面；
6. 日常无感，风险有感；
7. 能力无负担，权力有控制；
8. 有重要异常、冲突或外部行动时才打断用户；
9. 普通用户界面不得展示产品规格、工程状态或系统设计说明；
10. 页面文字应大幅减少，保留呼吸感和明确主操作。

### 4.2 前台 / 后台 / 帮助 / 高级分层

| 层 | 承载 |
|---|---|
| 默认产品界面 | 正在做的事、极简主体身份、一个明确下一步、可直接使用的能力、少量需本人决定的事项、最近完成的工作或成长（如有价值） |
| 后台 | 蒸馏、分类、相关性检索、主体一致性检查、授权 token、审计、版本、结果和反馈回流 |
| 帮助 / 用户手册 | 四个承诺、五步成长路线、数字主权理念、主体资料分类、授权与协作机制、数据去向说明、产品能力边界、Digital Me 与普通 AI 的区别 |
| 高级 / 开发者工具 | Package 版本和健康细节、证据来源与分类、DecisionAudit、完整授权记录、推理环境、调试信息（**不含** PAN-01R 入口；见产品规格 v0.6.3 §3.1.1） |

**四个承诺（这是我 · 属于我 · 由我管 · 代表我协作）与五步成长路线保留为叙事与帮助内容，不作为默认首页主体。**

### 4.3 极简工作表面 IA（方向；细则见产品规格 v0.6）

默认界面围绕「正在做的事 + 极简身份 + 明确下一步」组织；控制能力按风险上下文分散到主体、能力和协作路径，不再单独做成密集面板；完整控制细节进入设置/高级区域。

---

## 5. PAN-01 / PAN-01R 正式裁定（2026-07-19）

### 5.1 PAN-01

```text
engineering: statically_verified
owner: product_perception_failed
disposition: needs_minimal_surface_reset
accepted: no
```

- 可信只读聚合和 fail-closed 逻辑保留；
- 「产品全貌首页」作为密集信息展板失败；
- 四个承诺和成长路线不得继续作为普通用户首屏主体（迁入帮助）；
- 不继续打磨卡片和解释文案；
- 后续由 PAN-01S 完成极简产品表面收口。

### 5.2 PAN-01R

```text
engineering: statically_verified
codex: review_passed
owner_runtime: verified
owner_product: product_perception_failed
disposition: retained_as_internal_collaboration_harness
accepted: no
```

- 工程与运行验证通过（`9dd6fa0`；70/70；20/20；Codex 第二轮复核通过；Owner 走通主要路径）；
- 产品感知失败：授权依据相关性不足、强制显式引用不真不准、内部链路铺在页面上、输出被不相关主体资料拖累；
- 「体验一次 Digital Me 如何代表我」不得继续作为普通用户体验；**PAN-01S Alpha 生产界面必须没有 PAN-01R 入口**（含设置／高级／帮助；仅内部 test harness）；
- 底层授权、取消、审计、adopt/reject、推理环境绑定等保留为内部测试设施与未来外部协作（新 PAN-04）基础设施；**不**进入 PAN-01S 生产设置或高级界面；未来新 PAN-04 另行决定协作诊断入口；
- 不删除代码、不回滚提交、不标 accepted。

---

## 6. 子任务队列（v0.4 重排）

### 6.1 执行顺序

```text
PAN-00 accepted
→ PAN-00R accepted（三位一体重构；`07b631d` + `6ae2dca`）
→ PAN-01S accepted（2026-07-20；baseline `cbde807`）
→ PAN-01S.1 accepted（2026-07-20；baseline `cbde807`）
→ PAN-01S.2 accepted（2026-07-20；baseline `cbde807`）
→ renderer foundation R0 **accepted**（v0.1.2；决策接受）
→ renderer foundation R1 **accepted**（v0.1.3；baseline `8d7e9b3`；Owner 6/6）
→ renderer foundation R2（v0.1-draft；specified / codex_review_pending / not_started）
→ PAN-02 理解通道 Alpha（planned / blocked）
→ PAN-03 能力框架 Alpha
→ PAN-04 外部协作骨架 Alpha
→ PAN-05 成长飞轮与传播体验
→ PAN-06 非开发者验证与 Trusted Beta 排序
```

### 6.2 任务定义

**PAN-00：战略与规格切换**——历史 `accepted`（`bc85a14`），不改写历史事实。

**PAN-00R：三位一体重构与极简产品原则冻结**——`accepted`（战略 / 规格 / 队列；证据 `07b631d` + `6ae2dca`；Codex 最终复核通过；Owner 确认）。不代表 PAN-01S～PAN-06 已实现。任务包：`digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`。

**PAN-01（历史）**——产品全貌首页；裁定见 §5.1；保留历史工程证据。

**PAN-01R（历史）**——主权协作闭环；裁定见 §5.2；保留历史工程证据。

**PAN-01S：极简产品表面与复杂度后移**（**`accepted`**，2026-07-20；baseline `cbde807`）

独立任务包：`digitalme_phase1_task_PAN-01S_minimal_product_surface.md`（v0.1.1）。
实现 / 收口分支：`codex/pan-01s-minimal-product-surface` → `codex/pan-01s2-chat-incident-close`。

已完成并经 Owner 真机验收：

- 清理「我」页面默认表面为极简主体入口（主操作 P0→P4 唯一优先级；含永久「继续了解我」）；
- 四个承诺和成长路线迁入帮助；
- **生产界面没有 PAN-01R 入口**（含设置／高级／帮助）；
- 协作验证保留为内部／test-only 隔离 harness；
- 侧栏不常驻 Package／模型／能力／品牌；
- 会话省略号菜单、行内改名、自定义删除确认（收口修订，同基线）；
- 保留 PAN-01/PAN-01R 后台与测试；
- **不**实现新的蒸馏、能力或公网协作。

**PAN-01S.1：主体解释与渐进式构建**（**`accepted`**，2026-07-20；baseline `cbde807`）— 见独立任务包。

**PAN-01S.2：对话事故收口**（**`accepted`**，2026-07-20；baseline `cbde807`）— 对话历史显示、附件上下文分离、关联文稿正文隔离与恢复入口。正式独立任务包未入库；以执行索引与 `digitalme_log.md` 记录为准。

**PAN-02：理解通道 Alpha**——低负担输入；后台蒸馏；关键纠错；任务相关检索；无关主体信息保持沉默；不把每条蒸馏过程暴露给普通用户。当前 **`planned` / `blocked`**（待 R0 边界决策后由 Owner/Codex 另行决定；任务包与实现均不得在 R0 决策完成前自行启动）。

**PAN-03：能力框架 Alpha**——统一能力对象；安装、启用、调用、停止、撤销；至少有真实能力样例；能力可继续扩展；主体增强不限制 AI 通用能力上限。

**PAN-04：外部协作骨架 Alpha**——外部请求；是否接受；最小必要授权；调用能力；结果处置；停止和记录；本地模拟与真实外部服务严格区分；PAN-01R 安全骨架可复用，但不得复用其失败的用户表面。

**PAN-05：成长飞轮与传播体验**——外部结果与反馈形成成长候选；不自动改写主体；打通一次「输入—能力—协作—反馈—成长」纵向闭环；传播材料只能基于真实产品体验；不用四承诺页面替代产品证明。

**PAN-06：非开发者验证与 Trusted Beta 排序**——5～10 名非开发者走真实主路径；验证自我输入、做事差异、外部协作感知和极简程度；决定 Trusted Beta 的准确性、安全、迁移、互操作和产品硬化顺序。

### 6.3 旧任务定义处置

- 旧 PAN-02「控制权面板」：**superseded**——控制不再单独做成密集面板；控制能力按风险上下文分散到主体、能力和协作路径；完整控制细节进入设置/高级区域；
- 旧 PAN-03「能力获得感」、旧 PAN-04「本地协作沙盘」：保留历史，不删除；由 §6.2 新定义取代当前排期口径。

### 6.4 当前调度

- **当前唯一等待项**：等待 Codex 复核 Renderer Foundation R2 任务包（`digitalme_renderer_foundation_R2_chat_and_sessions_migration.md` **v0.1-draft**）；
- PAN-01S / PAN-01S.1 / PAN-01S.2：`accepted`（2026-07-20；Owner real Electron runtime；baseline `cbde807`）；
- renderer foundation R0：`accepted`（v0.1.2；决策接受；implementation not_started）；
- renderer foundation R1：`accepted`（**v0.1.3**；baseline `8d7e9b3`；implementation `completed`；分支 `codex/r1-renderer-next-shell`）；
- renderer foundation R2：`specified` / `codex_review_pending` / `not_started`（**v0.1-draft**；实现分支**不存在**；复核通过前不得实现）；
- R2.5 SQLite：`planned` / `deferred`；
- PAN-02～PAN-06 保持 `planned`；PAN-02 当前 **blocked**（见 R0 §16）；不得开始 R2 实现 / R2.5 / PAN-02。

---

## 7. 面向公众的核心概念（保留，帮助/叙事内容）

### 7.1 推荐定义

> **Digital Me 是属于个人自己的数字主体。它承载你的身份、记忆、判断、意图和边界，可以持续获得新的 AI 能力，并只在你授权的范围内替你行动、代表你协作。**

### 7.2 四句公众表达（帮助与传播材料使用；不作为默认首页主体）

1. Digital Me 是属于你自己的数字主体；
2. 它持续理解你，但事实、推断和发展方向由你决定；
3. 它可以不断获得新的 AI 能力，替你完成数字世界中的任务；
4. 它只有在你授权的范围内，才会代表你与人或其它 AI 协作。

### 7.3 与相邻产品的区别

| 产品形态 | 核心关系 |
|---|---|
| ChatGPT 等通用助手 | 人使用一个通用 AI |
| Agent | 人委派一个任务执行体 |
| 数字员工 | 组织配置一个岗位角色 |
| 数字分身 | 重点复现形象、声音或表达 |
| **Digital Me** | **人在数字世界中的主体层，拥有自己的身份、记忆、意图、边界、能力和协作权** |

### 7.4 禁止的市场表达

不得把 Alpha 宣传为：已经独立存在的数字生命；可以完全替代真人；已经接入开放 Agent 网络；已经能自动接单、签约、付款或交易；已实现密码学不可篡改身份；已形成完整数字孪生；已具备所有页面所展示能力的发布级安全性。

市场教育必须区分「当前真实可用」「实验能力」「本地模拟」「远景方向」。

### 7.5 数字主权叙事与 Digital Org

以「个人数字主权」作为公共叙事总纲；母稿见 `digitalme_digital_sovereignty_narrative_v0.1.md`。Digital Org 纳入长期产品架构，但本轮仍以个人 Alpha 为范围，不建设组织版产品；P1-PANORAMA 完成后再评估 `DORG-00`。

---

## 8. 实施策略

### 8.1 纵向切片优先

每个实现任务必须说明它服务三位一体的哪一部分与闭环的哪一步。禁止按「先完成所有存储、所有策略、所有审计，再做产品面」的顺序推进。

优先复用：SubjectOverview、PackageStore 只读聚合与版本信息、PolicyEngine、DecisionAudit、ToolBroker、Writing、ResearchNotebook、现有能力扩展页、现有 contracts 数据结构、PAN-01R 安全骨架（授权 token、取消、审计、adopt/reject、推理环境绑定）。

### 8.2 Alpha 状态必须诚实

所有用户面能力必须来自以下状态之一：

| 状态 | 含义 |
|---|---|
| 可用 | 已有真实路径并通过对应运行验收 |
| 实验 | 真实执行，但边界或稳定性仍有限 |
| 本地模拟 | 仅用于展示完整授权与协作流程 |
| 预览 | 可查看设计或草案，不能执行 |
| 尚未开放 | 只说明方向，不提供操作 |

禁止使用一个静态绿色状态把 `implemented` 冒充为「可用」。

### 8.3 最小安全边界

- 不开放公网协作入口；不自动对外发布；不自动签约、付款、交易或承诺；
- 不把真实 Package 复制到公共服务；不向 renderer 返回密钥；
- 不绕开 PolicyEngine 执行高风险动作；不绕开 PackageStore 修改已迁移的主体资产；
- 不让模型或 renderer 决定 dataKind、授权结果或可信审计内容；
- 不以「演示需要」为由触碰或覆盖 Owner 的真实 Package；
- 本地协作模拟必须醒目标注。

### 8.4 细节控制

每个子任务原则上只允许一轮实现、一轮静态复核、一轮 Owner 主路径体验；阻断性安全、资料损坏、主路径不可用问题必须修复；普通布局、文案微调、低概率异常和非主路径问题进入 backlog。不得因单个局部任务反复多轮打磨而阻断三位一体闭环形成。

---

## 9. 验收标准（v0.4）

### 9.1 用户感知验收

至少 5 名非开发者完成任务式试用（PAN-06），其中至少 4 人能够在真实使用后：

1. 说清 Digital Me 与普通 AI 助手的主要区别；
2. 完成一次低负担的自我输入，并确认或纠正一条关键蒸馏结果；
3. 区分本人确认与系统推断；
4. 体验至少一种真实能力，并感到结果比通用 AI 更符合本人（或明确知道为何没有个性化）；
5. 完成一次外部协作请求的批准或拒绝，说出授权约束了什么；
6. 找到停止、撤销、记录和恢复入口；
7. 正确理解哪些功能是真实执行、哪些是本地模拟；
8. 觉得界面简洁、没有被系统内部信息打扰。

### 9.2 产品闭环验收

- 「输入自己 → 后台蒸馏 → 调用能力 → 授权协作 → 结果与反馈 → 成长候选」可连续走通；
- 过程不要求用户理解技术术语；
- 每一步都有清晰当前状态和下一步；
- 用户取消不会被显示为成功；本地模拟不会被显示为真实公网协作；
- 结果可采用或拒绝；重要行动有用户可读记录；
- 外部输入不直接改写主体；主体写入经 preview → confirmation → commit。

### 9.3 技术最低验收

- 不破坏 P1-01～P1-07 已有 hermetic 回归；
- 不触碰或覆盖真实 `digital-me-package/**`；
- 不绕开现有 SecretStore、PackageStore、PolicyEngine 和 DecisionAudit 的已接入路径；
- 新 IPC 有 sender 与 payload 最小校验；
- Alpha 演示数据与真实 Package 明确隔离；
- 关键页面有 Electron 主路径 smoke test；
- 取消、拒绝、停止和恢复至少各覆盖一条真实事件路径；
- 不把静态状态冒充运行健康；
- 不产生密钥、正文、绝对路径等敏感日志泄漏。

### 9.4 市场认知验收

- 传播资产基于真实产品体验完成（一页介绍、演示、对照页、FAQ、体验邀请、反馈问卷）；
- 至少 5 名早期用户完成体验；
- 收集并整理「最常见误解」和「最强价值感知」；
- 根据反馈明确 Trusted Beta 的前三个硬化任务。

---

## 10. 本任务完成定义（v0.4）

P1-PANORAMA 只有在以下条件同时满足时才能标记完成：

1. 三位一体三个组成部分均达到 Alpha：理解我（低负担输入 + 正确蒸馏 + 关键纠错 + 相关检索 + 无关沉默）、武装我（统一能力框架 + 真实能力样例 + 可扩展撤销）、连接世界（协作骨架 + 授权边界 + 结果处置 + 记录）；
2. 第一阶段闭环（§2.1）至少一条纵向路径连续真实走通；
3. 极简产品原则在默认界面落实：四承诺与成长路线在帮助中而非首屏；普通用户界面无工程状态与系统设计说明；
4. 可用、实验、本地模拟、预览和尚未开放严格区分，且与工程状态分开；
5. 成长回流规则落实：外部输入不直接改写主体；
6. 传播资产基于真实 Alpha 完成；
7. 至少 5 名非开发者参与试用，至少 4 人通过 §9.1 认知验收；
8. 已依据反馈形成 Trusted Beta 的前三个硬化任务；
9. 未发生真实 Package 损坏、越权行动或敏感信息泄漏；
10. Owner 完成产品验收，Codex 完成架构与范围复核。

---

## 11. P1-07 与旧任务处理（保留）

### 11.1 P1-07

P1-07 保持：

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

- 不标 accepted；不继续占用当前主线；
- 已知的多组审阅与智能构建验收问题记入 backlog；
- 只有资料损坏、越权写入、密钥泄漏或主路径完全不可用才立即修复。

### 11.2 暂停项

在三位一体 Alpha 完成前，暂停：Policies 全面迁移 PackageStore、认知页零散编辑迁移、Life 读取体系重构、`package:load` scaffold、MCP 全面迁移 ToolBroker、Package 全类型深度校验与迁移、审计密码学增强、非阻断性 UI 细节反复打磨、原 P1-08 计划任务。

如某暂停项是当前 PAN 任务的真实阻断依赖，必须先提交最小依赖说明，经 Codex 复核后只实现必要切片。

---

## 12. 风险与控制

| 风险 | 控制方式 |
|---|---|
| 极简被误解为砍掉可信底座 | 后台复杂性（蒸馏、审计、授权、版本）保留并继续加深；只是不进默认界面 |
| 为证明理解我又做密集展示页 | 理解我以「结果更像我 + 关键纠错」体现，不以页面证明 |
| 主体资料继续拖累输出质量 | 相关性门强制：无关信息不进入生成；无相关信息时不强行个性化 |
| 协作骨架复用失败的用户表面 | PAN-04 只复用 PAN-01R 安全骨架，不复用五步展示页 |
| 市场传播过度承诺 | 使用状态标签和禁止表达清单；不宣称法律身份与社会承认 |
| 又陷入局部反复打磨 | 非阻断问题进入 backlog；每子任务限制复核和验收轮次 |
| Owner 个例固化为通用产品 | 默认文案和场景以普通知识工作者可理解为准 |

---

## 13. 工作机制

### 13.1 角色

- **Owner**：确认战略调整、公众表达、真实产品取舍；参与非开发者试用；
- **Codex**：维护总任务、拆分子任务、架构与安全复核、控制范围、汇总用户证据；
- **Cursor/实现者**：只执行已经批准的单个 PAN 子任务，不自行扩大范围。

### 13.2 开发闸门

```text
PAN-00 accepted
→ PAN-00R accepted
→ PAN-01S / PAN-01S.1 / PAN-01S.2 accepted（2026-07-20；baseline `cbde807`）
→ renderer foundation R0 accepted（v0.1.2）
→ renderer foundation R1 accepted（v0.1.3；baseline `8d7e9b3`）
→ renderer foundation R2（v0.1-draft；specified / codex_review_pending / not_started）
→ PAN-02（planned / blocked）→ PAN-03 → PAN-04 → PAN-05 → PAN-06
```

每次只启动一个主实现任务。PAN-05 传播文案可并行起草，但不得与代码任务修改同一文件。**当前唯一等待项**：Codex 复核 R2 任务包；R2 = `specified` / `codex_review_pending` / `not_started`；复核通过前不得创建实现分支或修改源码。PAN-02 保持 `planned` / `blocked`。

### 13.3 子任务完成报告

每个 PAN 子任务必须报告：用户获得了什么新感知；三位一体与闭环推进了哪一步；哪些是真实能力，哪些是模拟或预览；修改文件和提交；主路径测试；是否触碰真实 Package；非阻断 backlog；下一唯一任务。

---

## 14. 非目标

P1-PANORAMA 不包含：

- 真实公网 Agent 发现与调用；自动匹配、自动接单；
- 支付、结算、出租、收益分配；DID 或区块链实现；
- 无人值守对外发布；自动签约、付款或正式承诺；
- Web/移动端完整产品；完整能力市场；
- Digital Org 多成员、角色审批和机构数据授权运行时；
- 音视频、声纹、相貌和具身输出；完整 Package 编辑器；
- 所有旧写路径全面迁移；发布级红队和规模化云架构；
- 以 UI 展示代替真实能力状态；
- 法律身份、社会承认与规模互操作的宣称。

---

## 15. 历史记录（保留，不作为当前口径）

### 15.1 v0.3.2 及更早的旧口径（已由 v0.4 取代）

以下为历史记录，均已 superseded：

- 「让第一次使用 Digital Me 的普通用户在 10～15 分钟内看见并体验完整产品构造」——已废止；产品全貌改为纵向真实体验；
- 「产品全貌首页：数字主体卡 + 四个承诺 + 五步成长路线」作为默认首屏主体——已废止；四承诺与成长路线迁入帮助；
- 旧六步闭环表述「构建我 → 看见我 → 武装我 → 授权我 → 代表我协作 → 结果回流并成长」——由 §2.1 第一阶段闭环取代（「看见我」不再是独立展示步骤）；
- 旧 PAN-02「控制权面板」——superseded，见 §6.3；
- 「PAN-02/03/04 paused_until_PAN-01R_acceptance；PAN-01R 验收通过后启动旧 PAN-02」——已废止；新队列见 §6.1；
- 首个示范场景「受控研究协作」的五步展示页——历史工程规格保留于 PAN-01R 任务包，不再作为普通用户体验。

### 15.2 Owner 已确认决策（历史沿革）

2026-07-18，Owner 确认启动 P1-PANORAMA（决策 #58），接受 P1-07 冻结、状态五态分级、市场教育同步、Digital Org 不入 Alpha 等（详见 context 决策 #58～#59）。PAN-00 已 **accepted**（验收提交 `bc85a14`）。

2026-07-19：PAN-01 实现并 `statically_verified`，Owner 产品感知验收未通过；批准 PAN-01R 并完成实现与两轮 Codex 复核修复（最终 HEAD `9dd6fa0`；70/70；20/20）；Owner 运行验证通过但产品感知验收未通过。

2026-07-19（PAN-00R）：Owner 确立第一阶段三位一体最高定义、极简产品原则、AI 使用主体信息新原则、PAN-01/PAN-01R 正式裁定与新执行队列（本文 v0.4；决策 #67～#71）。随后 Codex 第一轮文档修复（`6ae2dca`）与最终复核通过；Owner 确认；**PAN-00R `accepted`**（决策 #72）。

2026-07-19（PAN-01S 规划）：独立任务包初稿冻结（`488d733`）；决策 #73。

2026-07-19（PAN-01S Codex 第一轮）：任务包 → v0.1.1；规格 → v0.6.3；关闭主操作优先级与 PAN-01R 生产入口歧义；当时状态含 `codex_review_changes_requested`（历史过程）。

2026-07-19（PAN-01S 规格接受）：Codex 最终复核通过；状态 → `codex_review_passed` / `not_started`。

2026-07-19（PAN-01S 实现）：分支 `codex/pan-01s-minimal-product-surface`；状态 → `statically_verified`（**不** accepted）。

2026-07-19（PAN-01S.1 规格接受）：Owner 对 PAN-01S 验收未通过 → `owner_changes_requested`；任务包冻结；提交 `686fd7b`。

2026-07-19（PAN-01S.1 实现）：parent `686fd7b`；状态曾为 → `statically_verified` / `implemented`（**不** accepted）。**已被 2026-07-20 acceptance superseded。**

2026-07-20（PAN-01S 族 Owner 真机验收）：**PAN-01S / PAN-01S.1 / PAN-01S.2 = `accepted`**；acceptance basis = Owner real Electron runtime；baseline `cbde807`。

2026-07-20（执行顺序修正）：当时将**当前唯一任务**改为起草并冻结 Renderer Foundation R0（历史）。

2026-07-20（R1 实施规格接受 · 今日收尾）：R1 → **v0.1.1** / `codex_review_passed` / `frozen_for_implementation` / `not_started`。**当时唯一等待项**：Owner 授权创建实现分支并启动 spike。PAN-02 仍 `planned` / `blocked`。（历史）

2026-07-21（R1 Owner 验收收口）：R1 → **v0.1.3 / `accepted`**；baseline **`8d7e9b3`**；Codex review passed + Owner real Electron runtime 6/6。（历史）

2026-07-21（R2 任务包起草）：R2 → **v0.1-draft** / `specified` / `codex_review_pending` / `not_started`。实现分支不存在。**当前唯一等待项**：Codex 复核 R2 任务包。R2.5 `planned` / `deferred`；PAN-02 `planned` / `blocked`。

> **PAN-01**：可信只读聚合保留；`needs_minimal_surface_reset`；不 accepted。
>
> **PAN-01R**：工程与运行验证通过；`retained_as_internal_collaboration_harness`；不 accepted。
