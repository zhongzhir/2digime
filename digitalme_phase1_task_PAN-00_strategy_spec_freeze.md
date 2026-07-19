# PAN-00 任务包：战略切换与规格冻结

版本：v0.2
日期：2026-07-18
状态：`accepted`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`
建议实现基线：`5ab55dc`（代码）+ `8fb8210`（P1-07_DOCS_BASE，仅 P1-07 收工文档）
验收提交：`bc85a14`（含状态语言修正；Codex 最终复核通过）
任务类型：文档治理 / 规格升版 / 阶段切换
代码 Owner：Cursor

---

## 0.1 验收记录（2026-07-18）

- Codex 最终复核通过；Owner 确认战略冻结结果。
- 状态语言统一提交：`bc85a14` — `docs(plan): normalize Panorama status language`。
- 本任务正式标记 **`accepted`**。
- 下一实现任务：**PAN-01**（独立任务包 `digitalme_phase1_task_PAN-01_product_panorama_home.md` 已批准）。

> **历史注记（2026-07-19）**：本任务包为历史 accepted 记录，内容不改写。其中的阶段定义、任务队列与「下一实现任务」均为 2026-07-18 当时口径；后续由 **PAN-00R 战略修订**补充（三位一体 Alpha、极简产品原则与新队列，见 `digitalme_phase1_task_PAN-00R_three_part_alpha_reset.md` 与执行索引 v0.2）。

---

## 0. 本任务结论

PAN-00 正式把第一阶段的当前主线从“按底层工作包逐项硬化”切换为“以真实但有边界的纵向闭环，尽快呈现 Digital Me 产品全貌”。

本任务只完成战略与规格治理，不修改产品代码，不修复 P1-07，不提前实现 PAN-01～PAN-06。

完成后，项目必须只有一个明确的当前产品主线：

```text
P1-PANORAMA
→ PAN-01 产品全貌首页
→ PAN-02 控制权面板
→ PAN-03 能力获得感
→ PAN-04 本地协作沙盘
→ PAN-05 传播与体验包
→ PAN-06 非开发者验证与 Trusted Beta 决策
```

旧任务的成果、测试和风险记录继续有效，但除非构成安全或 Panorama 主路径阻断，不再自动占用当前开发主线。

---

## 1. 背景与要解决的问题

P1-01～P1-07 已经建立 SecretStore、PackageStore、Subject Home、PolicyEngine、DecisionAudit、ToolBroker 以及 Builder 主写回等可信基础，但项目执行逐渐形成以下偏差：

- 用户主要感知资料构建与局部审阅，尚未形成产品全貌；
- “主体性、用户掌控、能力扩展、代表协作”没有在一条体验中连续出现；
- 工程精力过早集中于局部异常和交互细节；
- 产品理念、市场教育与真实用户验证启动过晚；
- Trusted Beta 的深度硬化优先级尚未获得真实用户证据。

PAN-00 不否定可信底座，而是改变其使用方式：以现有底座支撑一条薄而完整的 Alpha 纵向闭环，再根据用户证据决定硬化顺序。

---

## 2. 冻结后的阶段目标

### 2.1 Alpha 唯一目标

> 让第一次使用 Digital Me 的普通用户在 10～15 分钟内看见并体验：建立自己的数字之我、确认它属于自己、给它增加能力、授权它完成任务、让它参与一次受控协作，并看见结果如何回到自己。

### 2.2 四个产品承诺

1. **这是我**：事实、本人声明、系统推断、当前状态和发展意图分得清；
2. **属于我**：主体资料、版本、恢复、迁移和私有状态由本人掌握；
3. **由我管**：数据使用、能力、外部行动和授权可查看、批准、限制、停止和撤销；
4. **代表我协作**：Digital Me 只在本人批准的范围内代表本人参与协作。

### 2.3 完整体验链

```text
构建我 → 看见我 → 武装我 → 授权我 → 代表我协作 → 结果回流并成长
```

PAN-01～PAN-04 的每项实现必须说明服务其中哪一步，不得再以底层模块完成数量代替产品完成度。

---

## 3. 规格层级与唯一真源

PAN-00 完成后，文档层级冻结如下：

| 层级 | 文档 | 地位 |
|---|---|---|
| 战略与逻辑架构 | `digitalme_context.md` | 项目长期目标、双线、主权原则和架构方向 |
| 当前总任务 | `digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md` | 当前阶段目标、范围、子任务和总体验闭环 |
| 界面与功能 | `digitalme_product_spec_v0.2.md`（文件名暂不改，文内升至 v0.5） | 用户看见什么、能做什么、何为做完的唯一需求源 |
| 当前执行索引 | `digitalme_panorama_execution_index_v0.1.md` | PAN 顺序、状态、阻断项、backlog 与启动闸门 |
| 可信硬化依据 | `digitalme_phase1_subject_upgrade_plan_v0.1.md` | 降级为 Trusted Beta 技术硬化与风险依据，不再是当前任务队列 |
| 工程能力证据 | `digitalme_capability_status_v0.1.md` | 记录实现与验证证据，不决定用户面状态 |
| 公共叙事母稿 | `digitalme_digital_sovereignty_narrative_v0.1.md` | 数字主权、广义数字资产与 Digital Org 的持续内容源 |
| 决策记录 | `digitalme_log.md` | 记录战略切换及后续决策，不取代规格 |

冲突处理顺序：

1. 用户体验与功能范围冲突，以升版后的产品规格为准；
2. 当前阶段排期冲突，以 P1-PANORAMA 与执行索引为准；
3. 安全底线与 Alpha 速度冲突，安全底线优先；
4. 长期架构与 Alpha 薄实现冲突，不破坏长期边界，但允许使用诚实标注的预览或本地模拟；
5. 旧任务文字与本任务冲突，以本任务和后续批准的 PAN 子任务为准。

---

## 4. 必须执行的文档变更

### 4.1 新增文档

在仓库根目录加入并纳入提交：

1. `digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`；
2. `digitalme_phase1_task_PAN-00_strategy_spec_freeze.md`；
3. `digitalme_panorama_execution_index_v0.1.md`；
4. `digitalme_digital_sovereignty_narrative_v0.1.md`。

前两份任务文档不得被 Cursor 自行重写战略结论，只允许修正与仓库事实不符的提交号、文件名或状态，并在完成报告中逐项说明。

### 4.2 更新 `digitalme_context.md`

必须：

- 文首将当前产品主线指向 P1-PANORAMA；
- 在阶段计划中加入“Product Panorama Alpha / Trusted Beta”双层交付；
- 将原“四板块推进共识”中的“数字之我构建为当前主战场”改为历史策略或长期板块，不再代表当前排期；
- 明确当前用纵向闭环同时推进 A“数字化构建人”和 B“主体化数字实体”；
- 加入数字主权为核心公共叙事、广义数字资产口径和 Digital Org 长期方向；
- 明确 Digital Org 不进入本轮个人 Alpha 实现；
- 在决策记录中写入本次战略切换，日期使用实际执行日期。

不得删除仍有效的长期架构内容。

### 4.3 更新 `digitalme_product_spec_v0.2.md`

保持文件名不变，文内版本由 v0.4 升至 **v0.5**，避免当前任务进行全仓链接重命名。

必须在文首关联列表和修订记录中加入 P1-PANORAMA，并新增一个独立的“Product Panorama Alpha 冻结规格”章节。该章节至少冻结：

- 四个产品承诺；
- 六步完整体验链；
- 产品全貌首页；
- 薄版控制权面板；
- 能力页三层：已拥有 / 可获得 / 开发者设置；
- 写作、研究、受控执行三张能力卡及“立即体验”；
- 本地协作沙盘及六要素授权；
- 结果采用或拒绝与记录回流；
- 用户面状态标签；
- Alpha 的非目标和最小安全边界；
- PAN-01～PAN-04 的连续主路径验收。

不得借升版重写已有对话、写作、研究等详细规格；只处理与 Panorama 直接冲突的状态、入口和导航描述。

### 4.4 更新 `digitalme_phase1_subject_upgrade_plan_v0.1.md`

保持文件名以保存引用稳定性，在文首加入醒目的状态声明：

```text
状态：部分完成；不再作为当前顺序执行计划
当前主线：P1-PANORAMA
后续用途：Trusted Beta 技术硬化、风险与依赖依据
```

旧 WP 内容保留，不把未完成项伪装为取消或完成。增加一节说明：

- 已完成能力继续复用；
- 未完成硬化项进入 Trusted Beta 候选池；
- 只有安全底线或 Panorama 主路径阻断可以前置；
- P1-PANORAMA 后由 PAN-06 按用户证据重新排序。

### 4.5 更新 `digitalme_capability_status_v0.1.md`

必须：

- 保留工程状态及证据；
- 将 P1-07 精确改为冻结状态；
- 增加“工程状态不等于用户面状态”的说明；
- 建立工程状态到用户状态的非自动映射规则；
- 新增 P1-PANORAMA 与 PAN-00 条目；
- 不将任何 `implemented` 自动升格为用户面“可用”。

P1-07 固定为：

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

已知缺口至少记录：

- 真实 GUI 多类别审阅第一组提交后，第二组未被 Owner 观察到自动呈现；
- 智能构建的确认交互尚未由 Owner 完整复验；
- 不标 accepted；
- 不继续占用 Panorama 主线；
- 仅资料损坏、越权、密钥泄漏或 Panorama 主路径阻断时恢复处理。

### 4.6 更新 P1-07 任务包

`digitalme_phase1_task_P1-07_life_identity_package_store.md` 文首状态改为与上节完全一致，并增加“冻结决定”小节。不得修改 P1-07 代码或既有测试来制造 accepted 结果。

### 4.7 更新 `digitalme_log.md`

新增一条结构化决策记录，至少包含：

- 决策：启动 P1-PANORAMA；
- 原因：过早进入局部精细化，产品全貌和市场认知不足；
- 当前基线：`5ab55dc`；
- P1-07 冻结状态和已知缺口；
- Alpha 与 Trusted Beta 分离；
- 数字主权公共叙事与广义数字资产口径；
- Digital Org 进入长期架构但不进入当前实现；
- 下一实现任务只能是 PAN-01；
- PAN-00 不修改产品代码。

### 4.8 更新 Cursor 规则

在 `.cursor/rules/product-development-process.mdc` 加入一段 Panorama 阶段规则：

- 每次只执行一个已批准 PAN 主任务；
- 非阻断问题进入 backlog；
- 不因局部修饰延迟完整闭环；
- 用户面能力必须使用冻结状态标签；
- 本地模拟不得写成真实外部协作；
- 若需恢复暂停工作，先提交最小阻断说明，不可直接扩 scope。

---

## 5. Alpha 与 Trusted Beta 的边界

| Product Panorama Alpha | Trusted Beta |
|---|---|
| 证明普通用户能看懂完整产品 | 证明高风险路径在更广场景稳定可信 |
| 薄而完整的纵向闭环 | 深入的安全、迁移、异常与兼容硬化 |
| 真实能力、实验能力、本地模拟严格分级 | 将高价值实验能力逐步升为真实可用 |
| 1 个受控研究协作示范 | 更多真实外部能力与协议互操作 |
| 5～10 名非开发者认知验证 | 更连续、更复杂、更接近生产的验证 |
| 允许非阻断细节进入 backlog | 按用户证据和风险排序偿还技术债 |

不得以“Alpha”名义绕过 SecretStore、PackageStore、PolicyEngine、DecisionAudit 的已接入安全路径，也不得把本地模拟宣传为真实网络协作。

---

## 6. 两套状态不得混用

### 6.1 工程状态

用于代码与验证证据：

```text
planned → specified → implemented → statically_verified → runtime_verified → accepted/released
```

允许附加冻结或缺口标记，但不得删掉证据。

### 6.2 用户面状态

所有 Panorama 用户界面只能使用：

| 用户状态 | 含义 |
|---|---|
| 可用 | 存在真实执行路径，并通过对应运行验收 |
| 实验 | 真实执行，但边界、稳定性或验证范围有限 |
| 本地模拟 | 只在本机演示授权与协作闭环，不代表公网行为 |
| 预览 | 可以查看设计、草案或即将发生的操作，不能完成执行 |
| 尚未开放 | 只说明方向，不提供可操作入口 |

规则：

- 工程 `implemented` 不自动等于用户“可用”；
- `statically_verified` 通常最多支持“实验”，仍须结合风险与运行证据判断；
- 静态卡片、按钮或 JSON 文件不能证明能力可用；
- 页面必须显示当前真实状态，失败和取消不得显示成功；
- 状态只能由主进程真实信息或明确的产品常量生成，不信任 renderer 自报运行健康。

---

## 7. 当前任务索引与冻结 backlog

PAN-00 新建的 `digitalme_panorama_execution_index_v0.1.md` 至少包含下表：

| 任务 | 初始状态 | 启动条件 | 完成后下一步 |
|---|---|---|---|
| PAN-00 | `in_progress`，提交后 `statically_verified` | Owner 已批准总任务 | Codex 复核后 PAN-01 |
| PAN-01 | `specified_in_master / not_started` | PAN-00 复核通过并建立独立任务包 | PAN-02 |
| PAN-02 | `planned / not_started` | PAN-01 主路径通过 | PAN-03 |
| PAN-03 | `planned / not_started` | PAN-02 主路径通过 | PAN-04 |
| PAN-04 | `planned / not_started` | PAN-03 主路径通过 | PAN-06 |
| PAN-05 | `planned / copy_drafting_allowed` | PAN-00 完成 | 与 01～04 同步，但正式录屏后置 |
| PAN-06 | `planned / not_started` | 01～05 形成可体验 Alpha | Trusted Beta 排序 |

冻结 backlog 至少包括：

- P1-07 两项 Owner 验收缺口；
- Policies 全面迁移 PackageStore；
- 认知页零散编辑迁移；
- Life 读取体系重构；
- `package:load` scaffold；
- MCP 全面迁移 ToolBroker；
- Package 全类型深度校验与迁移；
- 审计密码学增强；
- 非阻断 UI 细节；
- 原 P1-08；
- Digital Org 运行时；
- 公网协作、支付和结算。

每个 backlog 项至少带：来源、当前状态、为何暂停、恢复条件、关联风险。PAN-00 不为 backlog 排详细实现工期。

---

## 8. 当前安全底线

任何 PAN 子任务均不得：

- 触碰或覆盖 Owner 真实 `digital-me-package/**` 作为默认测试；
- 把密钥返回 renderer、写入普通配置或日志；
- 绕开 PackageStore 修改已迁移主体资产；
- 绕开 PolicyEngine 执行已纳管高风险动作；
- 让 renderer 或模型决定可信 `dataKind`、授权结论或审计事实；
- 开放公网自动协作、自动发布、签约、付款或交易；
- 把本地模拟冒充真实外部调用；
- 以静态 UI 冒充真实能力；
- 把 Digital Org 扩入当前个人 Alpha 实现。

---

## 9. 本任务明确不包含

- 修改 `digitalme-app/src/**`；
- 修改 `digitalme-app/scripts/**`；
- 修改 `digitalme-app/package.json` 或 lockfile；
- 修改 `digital-me-package/**`；
- P1-07 修复或验收；
- PAN-01～PAN-06 的 UI、IPC、数据结构或运行时实现；
- 新增 npm 依赖；
- 运行真实 Package 基线测试；
- push、创建 remote、合并分支；
- 将 P1-PANORAMA、Digital Org 或数字主权远景宣传为已经实现。

---

## 10. 实施步骤

1. 在当前分支确认 `HEAD`、工作区和未跟踪交接文件；
2. 从 `5ab55dc` 创建分支 `codex/pan-00-strategy-spec-freeze`；
3. 将四份新增文档加入仓库；
4. 按 §4 更新现有文档；
5. 用全仓搜索排查“当前主战场”“当前执行计划”“下一任务 P1-08”“P1-07 accepted”等冲突口径；
6. 只修订会造成当前执行歧义的内容，保留历史记录；
7. 执行文档一致性和 diff 检查；
8. 提交一个独立 PAN-00 文档提交；
9. 停止，交给 Codex 复核；不得开始 PAN-01。

---

## 11. 验证要求

PAN-00 是文档任务，不以运行全部产品测试证明完成。至少执行：

```bash
git diff --check
git status --short
git diff --stat
git diff --name-only <PAN-00基线>..HEAD
```

并用 `rg` 验证：

- P1-PANORAMA 已成为当前主线；
- Product Panorama Alpha 与 Trusted Beta 已明确分开；
- P1-07 冻结状态在能力表、任务包、执行索引和 log 中一致；
- 用户面状态枚举只包含五种冻结状态；
- PAN-01 是唯一下一实现任务；
- Digital Org 被列为长期方向且明确不属于当前实现；
- 没有产品代码、测试脚本、Package、依赖文件进入变更。

若 Markdown 格式检查工具已经存在，可运行；不得为 PAN-00 新增格式工具或依赖。

---

## 12. 验收标准

### 12.1 文档一致性

- 当前主线只指向 P1-PANORAMA；
- 产品规格升至 v0.5 并成为 Panorama 用户体验唯一需求源；
- 原第一阶段升级计划明确降级为 Trusted Beta 硬化依据；
- 总任务、规格、执行索引、能力表和 log 不存在相互矛盾的下一任务；
- 历史记录保留，不通过删除历史制造一致。

### 12.2 范围与状态

- P1-07 保持未 accepted 并带精确冻结标记；
- PAN-01～PAN-06 均有清楚状态和启动闸门；
- Alpha 和 Trusted Beta 的完成定义分开；
- 工程状态与用户面状态分开；
- backlog 有恢复条件，不再自动进入开发。

### 12.3 产品与叙事

- 四个承诺和六步体验链成为当前产品骨架；
- 数字主权是公共叙事总纲，但没有超出法律和产品现实的宣称；
- “数据”采用广义数字资产与产出物口径，不采用机械个人数据变现逻辑；
- Digital Org 进入长期架构，不进入当前 Alpha 实现。

### 12.4 工程边界

- 变更只包含批准的 Markdown 与 Cursor 规则；
- 没有修改产品代码、测试、依赖或真实 Package；
- 工作区中的交接 bundle、zip、stat 文件未纳入提交；
- 未 amend `5ab55dc`，未 push。

---

## 13. 提交要求

建议提交信息：

```text
docs(plan): switch phase one to Product Panorama Alpha
```

提交后状态建议：

```text
PAN-00: statically_verified
P1-PANORAMA: active / PAN-01_pending_spec
```

不得由 Cursor 标记 PAN-00 `accepted`。Codex 完成一致性复核、Owner 确认战略冻结结果后，才可标 accepted 并建立 PAN-01 独立任务包。

---

## 14. Cursor 完成报告格式

```markdown
## PAN-00 完成报告

### 分支与提交
- branch：
- commit：
- message：
- amend：否
- push：否

### 新增文件
- ...

### 修改文件
- ...

### 冻结结果
- 当前主线：
- 产品规格版本：
- P1-07 状态：
- 唯一下一实现任务：
- Product Panorama Alpha / Trusted Beta：
- Digital Org 边界：

### 一致性检查
- git diff --check：
- 冲突口径 rg：
- 变更文件范围：
- 是否修改产品代码/测试/依赖：
- 是否触碰 digital-me-package/**：
- 是否纳入交接文件：

### 仍需 Codex / Owner 决定
- ...
```

完成报告后停止，不开始 PAN-01，不修 P1-07，不做产品代码。
