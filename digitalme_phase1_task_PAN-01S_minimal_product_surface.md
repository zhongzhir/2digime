# PAN-01S 任务包：极简产品表面与复杂度后移

版本：v0.1.1
日期：2026-07-19
状态：`accepted`（2026-07-20；Owner real Electron runtime；baseline `cbde807fd1e40472d66fbe8f0810a0835e8bc816`）
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`（v0.4，三位一体重构）
前置任务：PAN-00R `accepted`（`07b631d` + `6ae2dca` + `0fcd432`）
规划基线：`488d733`（PAN-01S 任务包初稿冻结）；规格修复基线：`2aec151`（v0.1.1 歧义关闭）；规格接受：`269fa10`
PAN-01R 代码血缘基线：`9dd6fa0`（PAN-01R 最终实现；含 PAN-01 scaffold；**不是**本任务 checkout 起点）
实现分支：`codex/pan-01s-minimal-product-surface` → 收口延续 `codex/pan-01s2-chat-incident-close`
代码 Owner：Cursor（实现阶段）
任务类型：Product Panorama Alpha / 极简产品表面收口（UI 与导航；无新业务能力）
规格依据：产品规格 **v0.6.3**（§2.0 极简原则、§2.0.1 相关性门、§3.1 / §3.1.1 极简 IA 与默认「我」细则）；`digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md`

> **状态语义（强制）**
>
> - `statically_verified` 表示工程实现与规定测试已通过；**不**自动等于 `accepted`；
> - `owner_changes_requested`（2026-07-19，历史）：Owner 曾判定产品表达未通过；修订由 **PAN-01S.1** 承接；
> - **`accepted`（2026-07-20）**：Owner 在真实 Electron 环境验收通过；acceptance basis = Owner real Electron runtime；accepted baseline = `cbde807`；自动测试通过不是唯一依据；
> - 会话菜单与永久构建入口属于本任务收口修订，验收基线同为 `cbde807`；相关提交独立保留：`34fb497`、`cbde807`（未 amend / squash / push）。

> **v0.1.1 修订（2026-07-19，Codex 第一轮）**：冻结唯一主操作优先级 P0→P4（互斥、顺序求值）；冻结 PAN-01R「无生产入口」；删除模糊「未完成构建」条件；补冲突案例与组合测试。
>
> **规格接受（2026-07-19，Codex 最终复核通过）**：实现规格通过；允许从接受提交创建实现分支；状态曾为 `codex_review_passed` / `not_started`。
>
> **实现（2026-07-19）**：极简「我」入口、P0→P4、帮助迁移、侧栏收口、PAN-01R 无生产入口；当时最高 `statically_verified`。
>
> **Owner 验收未通过（2026-07-19，历史）**：视觉减法方向正确，但主体解释与构建渐进性不足；进入 PAN-01S.1 修订。
>
> **Owner 真机验收通过（2026-07-20）**：与 PAN-01S.1 / PAN-01S.2 一并 `accepted`；见 `digitalme_log.md` 与执行索引 v0.2.7。
---

## 0. 任务定位

PAN-01S **不是**重新设计整个 Digital Me，也**不是**实现新的理解、能力或协作功能。

它只负责：

1. 撤下已被 Owner 判定失败的密集产品展板（PAN-01 首屏与 PAN-01R 普通用户 CTA）；
2. 让普通用户默认界面恢复安静、清晰和可继续使用；
3. 将产品理念和内部机制后移到帮助、高级设置或内部测试；
4. 保留 PAN-01 / PAN-01R 已完成的可信后台和工程测试；
5. 为 PAN-02「理解通道 Alpha」提供干净的产品表面。

PAN-01S **不**证明 Digital Me 已经理解用户，**不**证明外部协作已经成熟，**不**通过新文案制造主体感。

### 0.1 一句话目标

> 普通用户点击「我」后，只看到一个属于自己的、安静的 Digital Me 入口，能够继续完善或查看自己；不会看到四个承诺、成长路线、能力计数、工程状态、授权链路和开发解释堆满首屏。

### 0.2 与相邻任务的边界

| 任务 | 关系 |
|---|---|
| PAN-01 | 工程 scaffold 保留；默认表面由本任务收口；不 accepted |
| PAN-01R | **无生产入口**；后台安全骨架与 hermetic 测试保留为内部 test harness；不 accepted |
| PAN-02 | **不得偷跑**；相关性检索、49KB 全量注入替换、蒸馏改进不在本任务 |
| PAN-03 / PAN-04 | 能力框架与外部协作骨架不在本任务 |

---

## 1. 核心产品原则（服从规格 v0.6.3）

本任务必须引用并服从：

- 后台复杂，前台极简；
- 用户体验结果，不观看系统证明自己；
- 个性化默认隐性发生；
- 授权只在风险边界上显性发生；
- 日常无感，风险有感；
- 能力无负担，权力有控制；
- 依据、来源和审计按需展开；
- 普通用户界面不展示工程状态和系统设计说明；
- **相关性门属于 PAN-02，不在 PAN-01S 实现**；
- 主体写入、外部授权和真实行动安全骨架**不得削弱**。

---

## 2. 冻结的默认「我」页面

侧栏点击「我」后，默认进入**极简主体入口**（非全貌展板、非构建页、非 PAN-01R 体验）。

### 2.1 首屏允许出现

1. 本人的 Digital Me 名称（由主进程可信身份派生；无可用名称时用中性占位，如「我的 Digital Me」）；
2. 一句简短、诚实的当前说明（不超过两行；避免产品口号）；
3. **一个**主要操作；
4. **最多一个**次要操作（可不出现）；
5. 仅在确实需要本人处理时出现的一条简短提醒。

建议结构：

```text
[主体名称]的 Digital Me

[简短说明：不超过两行]

[主操作按钮]
[次操作按钮 · 可选]
[提醒 · 仅必要时]
```

### 2.2 主操作优先级（冻结 · 互斥 · 按顺序求值）

主进程按 **P0 → P4** 顺序求值，**命中第一项后停止**。不允许组合多个主操作；次操作最多一个，且**不能绕过**主状态。

| 优先级 | 条件（主进程可信判定） | 主操作文案 | 路由 |
|---|---|---|---|
| **P0** | 主体读取异常：`read_error`、`content_degraded`、结构损坏，或其它不能安全给出正常主体结论的状态 | `查看问题` | 既有设置／问题处理入口；若 `navTarget` 不存在则**不导航**（不得由 renderer 猜测） |
| **P1** | Package 尚未建立：主进程明确判定 `missing` / `uninitialized`，且**不是**读取损坏 | `继续构建` | 既有构建入口 |
| **P2** | 有待本人确认或待审阅：`awaiting_review` / `pending_confirmation` | `继续确认` | 既有待审阅深链（优先于普通待处理材料） |
| **P3** | 有可操作的待处理材料：`suggested`、`failed-retryable` 或其它现有明确定义的可操作 inbox 状态；**不**把 `processing` 计为可操作待办 | `继续完善` | 既有构建入口 |
| **P4** | 主体正常且无以上待办 | `查看我的信息` | 既有数字之我详情 |

> **废止**：v0.1 中「有待处理材料或未完成构建」等可重叠条件表（historical / superseded）。「未完成构建」不得作为未定义模糊条件继续保留；须落实为 P1 的 `missing` / `uninitialized`，或 P2／P3 的现有明确状态。

#### 2.2.1 附加规则

1. 按 P0 → P4 顺序命中第一项后停止；
2. 次操作最多一个，不能绕过主状态（例如不得用次操作跳过 P0／P2）；
3. `privacy unknown` 不得生成虚假访问结论；如主体仍可读，可作为简短提醒，不擅自冒充 P0 以外的成功结论；
4. `processing` 不能诱发重复提交或再次构建；可只显示简短提醒；主操作仍按优先级表（通常落在 P4，除非另有更高优先级）；
5. 未知状态、未知 `navTarget`、字段缺失必须 **fail-closed**；
6. 主进程输出最终字段（只读契约；优先复用 SubjectOverview / panorama；不足时允许主进程**最小扩展现有只读契约**，**不得新增平行 IPC**）：
   - `primaryAction`
   - `primaryActionLabel`
   - `primaryNavTarget`
   - optional `secondaryAction`
   - optional `reminder`
7. renderer **只**渲染和执行白名单导航，**不**重新推导优先级；
8. 不得显示虚假的「属于你」「状态正常」等结论（尤其 P0／隐私未知时）。

次操作（可选，且服从主状态）：

- `开始工作` → 既有对话或做事入口（仅当主状态允许且不绕过风险／异常）；
- 或 `查看详情` → 数字之我详情（当主操作已是构建／审阅／问题时）。

#### 2.2.2 冲突案例（冻结结果）

| 组合 | 命中 | 主操作 |
|---|---|---|
| `awaiting_review` + `suggested` | P2 | `继续确认` |
| `read_error` + `awaiting_review` | P0 | `查看问题` |
| `missing` + `suggested` | P1 | `继续构建` |
| `processing` only + 主体可读 | P4 | `查看我的信息`（可附简短处理提醒；不得诱发再次构建） |
| 未知状态／未知 `navTarget`／字段缺失 | fail-closed | 不导航、不假成功 |

状态必须由**主进程**可信数据派生；renderer **不得**制造成功状态或覆盖 `navTarget` / 状态结论。

### 2.3 默认「我」页面禁止出现

普通用户首屏**不得**出现：

- 四个承诺卡片；
- 五步成长路线；
- 「这是我 / 属于我 / 由我管 / 代表我协作」的产品说明墙；
- 「构建我 / 看见我 / 武装我 / 授权我 / 代表我协作」步骤墙；
- 能力可用 / 实验 / 预览数量；
- 边界规则数量；
- Package 版本、格式版本、恢复状态；
- DecisionAudit、PolicyEngine、ToolBroker 等内部名词；
- 工程状态、PAN 编号、evidence IDs；
- 数据分类统计；
- 长篇 fail-closed 技术说明；
- 「体验一次 Digital Me 如何代表我」CTA；
- PAN-01R 五步体验面板；
- Package、模型、能力和品牌句的侧栏常驻摘要；
- 为填充空白而添加的解释性文案。

**不以**折叠卡片、横向卡片、缩小字号等方式继续保留信息墙；应真正从默认产品表面撤下。

---

## 3. 主操作行为与导航规则

PAN-01S **不**新增构建或写入业务，只复用既有真实入口。

要求：

1. 不能跳转到不存在的功能；
2. **不能因为 inbox 有待处理材料而劫持侧栏「我」的默认入口**——默认始终极简主体入口；只有用户点击主操作后才进入构建或审阅；
3. 深链进入审阅仍须正常工作；
4. 从构建 / 审阅 / 详情返回「我」时，回到极简主体入口；
5. renderer 不能传入或覆盖状态结论；
6. 未知 `navTarget` **fail-closed**（不导航、不假装成功）。

---

## 4. 读取失败与异常状态

极简不等于掩盖问题。异常主操作统一服从 §2.2 优先级（P0／P1），不得另起一套互相矛盾的按钮文案。

- **P0（读取异常）**：只给一条简短可理解说明 + 主操作 `查看问题`；**不**显示虚假的「属于你」「仅本人访问」「状态正常」等结论；若问题入口 `navTarget` 不存在则不导航；
- **P1（尚未建立）**：说明方向如「你的 Digital Me 还没有完成建立。」；主操作 `继续构建`；
- 技术细节、具体损坏层、路径、版本和诊断进入设置／高级；
- 不在首屏输出长段状态解释；
- 不泄漏绝对路径、文件正文或密钥；
- `privacy unknown`：不得伪造访问结论；可读时仅作提醒。

文案方向（须通用、简短、诚实；不硬编码 Owner 个案）：

- `你的 Digital Me 还没有完成建立。`
- `部分个人信息暂时无法读取。`
- `有一项内容需要你确认。`
- `有材料正在处理。`（仅提醒；不诱发再次构建）
---

## 5. 四个承诺与成长路线 → 帮助

必须让四个承诺和成长路线离开默认「我」页面。

### 5.1 落点（冻结）

**优先复用**现有应用内帮助弹窗：`digitalme-app/src/renderer/help.js`（`DigitalMeHelp`）+ `app.js` 的「说明」入口。

在「我」主题（`topics.me`）中新增可展开章节 / tab，例如：

- `理念` 或 `认识 Digital Me`：四个承诺、成长路线、数字主权简述、授权与数据去向、当前 Alpha 边界。

要求：

- 用户**主动打开**帮助后才看到；
- 不新增大型首页、不建立复杂帮助导航；
- 不为本任务重写全部用户手册（`digitalme_user_guide_v0.1.md` 可后置同步，非阻断）；
- 帮助文字不属于主操作流程；不在普通页面重复展示。

若现有帮助结构确无法容纳，只允许新增**一个**轻量帮助页面；须在实现报告中说明理由。

---

## 6. PAN-01R 处置（冻结 · 无生产入口）

PAN-01S 阶段强制：

1. PAN-01R 在普通生产 UI 中**没有**入口；
2. 设置、高级、帮助中也**不**增加 PAN-01R 入口；
3. **不**保留隐藏按钮；
4. **不**保留可猜测 URL / hash / query 路由；
5. **不**通过 localStorage、renderer 参数或普通 IPC payload 开启；
6. **不**在 production preload API 暴露「打开 PAN-01R」的测试能力；
7. **保留**后台模块、主进程安全契约、hermetic 测试和历史代码；
8. 内部 Electron 验证如仍需要 UI，**只能**由显式 test harness 在隔离测试进程中启用；
9. test-only 开关必须：
   - 默认 `false`；
   - 由主进程测试启动环境设置；
   - renderer **不能**自行打开；
   - 打包／普通启动不能发现或启用；
   - 不触碰真实 userData 或 Package；
10. 如果维持旧五步 DOM 只是为了测试，生产运行时**不得**渲染或挂接普通用户事件入口；
11. 新 PAN-04 是否重新提供协作用户体验，届时另行规格，**不**由 PAN-01S 预留生产入口。

> **口径修正（v0.1.1）**
> - 「高级／开发者区域包含协作回路验证器」→ **superseded**：PAN-01R 当前仅保留为内部测试设施，**不**进入 PAN-01S 生产设置或高级界面；未来新 PAN-04 另行决定协作诊断入口。
> - 「Alpha 普通用户界面可以完全没有 PAN-01R 入口」→ **superseded**：**PAN-01S Alpha 生产界面必须没有 PAN-01R 入口。**

另：

- 普通用户界面**撤下**「体验一次 Digital Me 如何代表我」；
- 默认「我」页面不得进入 PAN-01R 五步体验；
- **不删除** PAN-01R 后台：授权 preview/token、取消与迟到结果处理、DecisionAudit、adopt/reject、推理环境绑定、receipt、双结果隔离；
- 不继续打磨 PAN-01R 五步普通用户页面；
- 若旧 `test:pan-01r-owner-runtime` 依赖普通 CTA：迁为显式 test-only 隔离 harness；不得为了旧测试保留失败产品表面。
---

## 7. 侧栏收口（冻结）

默认侧栏只保留：

- 主要导航（对话 / 做事 / 我 / 能力 等既有主导航）；
- 确有必要且需要用户立即处理的阻断性状态。

迁移：

| 现有常驻 | 去向 |
|---|---|
| Package 名称、版本、健康与恢复 | 设置／高级 |
| 模型连接技术状态 | 设置；若模型不可用并阻断当前任务，在**当前任务上下文**中提示 |
| 已武装能力摘要 | 能力页 |
| 品牌句 | 删除，或仅用于启动／帮助，**不常驻**侧栏 |

禁止用图标 tooltip 继续常驻全部信息。

---

## 8. 能力与状态信息

PAN-01S **不**重做能力页。

默认「我」页面：

- 不展示能力数量、实验／可用／预览统计、可安装能力推荐；
- 可以有一个去工作或能力页的简短入口，但不能形成能力展板。

能力框架由 **PAN-03** 完成。

---

## 9. 帮助与高级的边界

| 层 | 职责 |
|---|---|
| 普通用户默认界面 | 只解决当前任务；不解释系统架构 |
| 帮助 | 解释产品理念和用户可理解的机制（含四承诺／成长路线）；**不含** PAN-01R 入口 |
| 设置 | 资料位置、模型连接、版本／恢复／迁移、普通配置；**不含** PAN-01R 入口 |
| 高级／开发者 | Package 健康细节、DecisionAudit、推理环境、证据分类、调试信息；**不含** PAN-01R／协作回路验证入口（PAN-01R 仅内部 test harness；未来新 PAN-04 另行决定协作诊断入口） |

不得把「后移」理解为全部堆进同一个超长设置弹窗。本任务只移动明确涉及的现有内容，**不**重构完整设置 IA。

---

## 10. 保留的安全边界

不得削弱：

- PackageStore；
- 主进程状态派生；
- fail-closed；
- 主体写入 preview → confirmation → commit；
- PolicyEngine；
- DecisionAudit；
- 授权 token；
- 停止与取消；
- 外部行动确认；
- 密钥与路径脱敏；
- Package 只读路径；
- 失败／取消不得显示成功。

极简是减少认知负担，不是减少真实控制。

---

## 11. 实现范围

### 11.1 预期允许修改

- `digitalme-app/src/renderer/index.html`
- `digitalme-app/src/renderer/app.js`
- `digitalme-app/src/renderer/styles.css`
- `digitalme-app/src/renderer/help.js`（帮助章节）
- 必要时：`digitalme-app/src/subject-overview/panorama.js`
- 必要时：`digitalme-app/src/subject-overview/constants.js`
- 必要的 preload/main 接线——**必须说明为何现有 SubjectOverview / panorama 字段不足**
- PAN-01 / PAN-01R / PAN-01S UI 测试与 owner-runtime harness
- `digitalme-app/package.json` 测试脚本
- 任务与状态文档

### 11.2 优先原则

- **优先不新增 IPC**；若只读状态已经存在，必须复用；
- 不得为了极简页面重写 SubjectOverview 或 Package 读取体系；
- 不得触碰或覆盖真实 `digital-me-package/**`；
- 不得修改蒸馏算法、检索、prompt 全量注入路径（属 PAN-02）。

---

## 12. 测试策略

### 12.1 必须新增

- `test:pan-01s`
- `test:pan-01s-owner-runtime`

至少覆盖：

| # | 断言 |
|---|---|
| A | 点击侧栏「我」默认进入极简主体入口 |
| B | 首屏不出现四个承诺 |
| C | 首屏不出现成长路线 |
| D | 首屏不出现 PAN-01R CTA 或五步体验 |
| E | 首屏不出现能力／边界／版本／工程统计墙 |
| F | 只有一个清晰主操作，最多一个次操作 |
| G | 主操作依据 §2.2 P0→P4 真实状态进入既有构建、审阅、问题或详情 |
| H | inbox 不劫持默认「我」入口 |
| I | 深链审阅仍可用 |
| J | 帮助中可找到四个承诺和成长路线 |
| K | 侧栏不常驻 Package／模型／能力／品牌四项 |
| L | Package `missing`／`uninitialized` 时主操作为 `继续构建`，不伪造所有权、隐私或健康结论 |
| M | identity／分层损坏／`read_error`／`content_degraded` 时主操作为 `查看问题` 并 fail-closed |
| N | 未知 navTarget fail-closed |
| O | renderer 不能注入状态或重算优先级 |
| P | 进入页面前后 Package 字节不变 |
| Q | 不泄漏绝对路径、密钥或主体正文 |
| R | PAN-01R 后台 hermetic 测试仍通过（含既有约 70 项安全断言） |
| S | 生产普通启动：DOM、导航、帮助、设置与 preload API 均无 PAN-01R 开启入口 |
| T | test-only 内部验证入口不能在生产环境开启；默认 false；仅隔离 harness |
| U | `awaiting_review` + `suggested` → `继续确认` |
| V | `read_error` + `awaiting_review` → `查看问题` |
| W | `missing` + `suggested` → `继续构建` |
| X | `processing` only + 主体可读 → `查看我的信息`（可附提醒；不诱发再次构建） |
| Y | 未知状态 → fail-closed；不导航、不假成功 |
| Z | renderer 传 query／hash／localStorage／IPC payload 不能开启内部 harness |
### 12.2 回归最低要求

- `test:pan-01s` / `test:pan-01s-owner-runtime`
- `test:pan-01` / `test:pan-01r`
- `test:p1-03` / `test:p1-07-owner-runtime` / `test:p1-phase1` / `test:owner-runtime`
- `node --check` / `git diff --check`

### 12.3 旧测试处理

- 旧 PAN-01 测试若要求四承诺／成长路线留在首屏 → 更新为历史或改测帮助落点；
- 旧 PAN-01R owner-runtime 若依赖普通 CTA → 迁为显式 test-only 内部 harness；
- **不删除** PAN-01／PAN-01R 的安全断言；
- 不为了让旧 UI 测试继续通过而保留失败界面；
- 测试必须服从 v0.6.3 / 本任务包 v0.1.1，而不是让产品服从旧测试。

### 12.4 不得默认运行

- `test:p1-baseline-real`
- 任何会恢复或覆盖真实 Package 的测试

所有新增测试使用 hermetic fixture 或隔离 userData。

---

## 13. 明确非目标

不包含：

- 相关性检索实现、prompt 重构、49KB 全量注入替换、蒸馏算法改进；
- 新的材料输入方式；**PAN-02**；
- 新能力框架；**PAN-03**；
- 真实外部协作；**PAN-04**；
- 成长回流实现；**PAN-05**；
- 新 Package 写入、Policies 迁移、Life 读取重构、Package 编辑器；
- 新市场传播页面、Digital Org、公网协作、支付结算；
- 大规模 CSS 设计系统重写、设置中心完整重构；
- 删除 PAN-01R 后台安全骨架；
- 修复 P1-07 已冻结缺口。

---

## 14. Owner 验收步骤（实现后）

1. 冷启动后点击侧栏「我」：确认极简入口，无承诺墙／路线墙／PAN-01R CTA／统计墙；
2. 有待办时：主操作进入真实构建或审阅，且默认入口未被 inbox 劫持；
3. 无待办时：主操作可查看本人信息；
4. 打开「说明／帮助」：能找到四个承诺与成长路线；
5. 侧栏底部：无 Package／模型／能力／品牌常驻摘要；
6. （如可）Package 缺失或损坏 fixture：无虚假所有权／隐私结论，仅简短提示；
7. 确认生产界面（含设置／高级／帮助／preload）无法发现或开启 PAN-01R；
8. 确认未触碰真实 Package。

实现者完成后最高状态：`statically_verified`。Owner 主路径验收通过后方可 `accepted`。

---

## 15. 完成定义（实现阶段）

同时满足：

1. §2～§7 冻结表面已落地；
2. §12 测试全部通过；
3. 安全边界未削弱；
4. 未触碰真实 Package；
5. 未启动 PAN-02 实现；
6. Codex 静态复核通过；
7. Owner 主路径验收通过（方可考虑 accepted）。

---

## 16. 调度

| 项 | 值 |
|---|---|
| 本轮 | **`accepted`（2026-07-20）**；Owner real Electron runtime；baseline `cbde807` |
| **下一门槛** | **PAN-02** = `planned` / `blocked`；**renderer foundation R0** = `planned` / `not_started` |
| 实现 / 收口分支 | `codex/pan-01s-minimal-product-surface` → `codex/pan-01s2-chat-incident-close` |
| PAN-02～PAN-06 | `planned`；PAN-02 当前 **blocked**，不得自行开始 |

---

## 17. Acceptance 记录（2026-07-20）

- **状态：** `accepted`
- **Acceptance basis：** Owner real Electron runtime
- **Accepted baseline：** `cbde807fd1e40472d66fbe8f0810a0835e8bc816`
- **Accepted date：** 2026-07-20
- **一并 accepted：** PAN-01S.1、PAN-01S.2（对话事故收口）
- **收口修订范围（同基线）：** 会话省略号菜单、行内改名、自定义删除确认、永久「继续了解我」构建入口
- **未发生：** amend、squash、push；未启动 PAN-02；未开始 renderer 重构
