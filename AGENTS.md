# AGENTS.md

**状态：** `current_entry / not_a_product_constitution`  
**日期：** 2026-09-08

任何 2digime 的规划、架构、开发、测试、验收、运营、推广任务开始前，必须读取下列文件，不得用聊天记忆代替，不得等待 Owner 提醒：

1. [`docs/refoundation/00-PRODUCT-CONSTITUTION.md`](docs/refoundation/00-PRODUCT-CONSTITUTION.md)
2. [`docs/refoundation/01-DEVELOPMENT-CONSTITUTION.md`](docs/refoundation/01-DEVELOPMENT-CONSTITUTION.md)
3. [`docs/refoundation/02-FAILURE-LESSONS.md`](docs/refoundation/02-FAILURE-LESSONS.md)
4. [`docs/refoundation/03-CURRENT-PLAN.md`](docs/refoundation/03-CURRENT-PLAN.md)

若当前工作已出现 Yellow 或 Red 信号（见 02），必须重新读取 02，并同时重读 00 与 01。

本文只做入口。产品原则在 00，开发纪律在 01，失败史在 02，当前执行顺序只在 03。下列开发行为不可违反，每项任务必须先读完本段再写代码。仓库内没有 `docs/design/personal-context.md`，不得另建第五份原则文件。

---

## 不可违反的开发行为

1. **能接不造。** 能用成熟大模型 / Agent / Skill / MCP / Tool / Computer Use / 本地软件 / 外部服务，不自研替代。
2. **少写优于多写。** 能删不加；能复用不造。
3. **Capability Sufficiency First。** 写代码前先证明现有能力不够。
4. **Build-vs-Integrate Gate。** 1–5 任一能解决，默认不自研（问题清单见下）。
5. **系统只允许在大模型之上增加三类东西：** 数字之我、安全、授权。
6. **系统绝不替大模型做语义或技术判断。** 尤其禁止：选文件、摘要、判断格式、决定能不能干、判断任务类型、规划步骤、选择工具、决定重试或换方案、keyword router、score、classifier、semantic reviewer。

兔机米不是通用大模型厂商的竞争对手。禁止自研搜索、Coding Agent、Computer Use、Office 智能、音视频图片基础生成，去和 Codex / Cursor / Claude Code / 大模型厂商比。

做事能力达到市场同类约 95 分位是门槛，不是护城河；默认用接入与编排实现。长期核心是 Digital Self / AI Capability / Digital Subject Network（属于我 · 能做事 · 连接世界）。数字之我增强模型，不削弱、不隐藏、不锁死用户。选择算法在用户自己的数字主体，不在中心平台。

**超级助手（现行产品定位摘要）：** 2digime 是属于人的数字之我，也是人的超级助手。主人原则上只表达诉求；技术实现、工具选择、安装配置、能力调度、普通失败恢复由 2digime 自行完成。只有资金、隐私、授权、重要资源、对外承诺、不可逆/高风险，或只能由主人作出的价值判断，才请求主人决定。分层：L1 通用超级助手（当前实施）→ L2 自我扩展（最小基础）→ L3 资源组织 → L4 网络化 → L5 主动型数字管家。详情见 00 §1 / §1.1、01 §1.2、03。

---

## 克制原则 / Capability Sufficiency First

写代码前先证明现有能力不够。

顺序：

1. 大模型本身是否已经能完成？
2. 现有 Agent / Tool / Skill 是否已经能完成真实动作？
3. 当前 runtime 是否已经足够承载？
4. 如果已经能完成，禁止新增代码、规则、router、score、状态机、review、adapter 包装。
5. 优先删除已有重复逻辑，而不是继续叠加。

原则：

- 能删不加；
- 能复用不造；
- 能让模型判断就不要用代码替模型判断；
- 宁愿少写，不要多写。

runtime 只保留模型无法自己知道、且系统必须保证的机械事实：

- 权限 / 隐私 / 安全；
- 工具真实成功失败；
- 文件是否真的产生；
- 配置是否真实可用；
- timeout / cancellation；
- 必要真实性边界。

禁止：

- 为单个失败 case 加关键词规则；
- 用 regex / score / topic classifier 模拟模型语义判断；
- 为「更可控」增加第二套 planner/reviewer/state machine；
- 用 harness 词命中反向约束模型表达；
- 因为 Coding Agent 自己更容易实现而重写模型本来已有能力。

---

## Build-vs-Integrate Gate

新增能力、在写代码之前必须回答：

1. 大模型本身是不是已经会？
2. 成熟 Agent / Skill / Tool 是否已经做到高水平？
3. 当前系统是不是已经存在，只是没有暴露？
4. 当前用户电脑 / OS / 软件是否已经拥有？
5. 是否只是缺授权或连接？
6. 是否真的必须由 2digime 新写代码？

如果 1–5 中任何一种能够解决：默认不自研。

只有明确证明现有成熟能力无法满足 **数字之我 / 安全 / 授权 / 或兔机米核心差异化**，才允许新增产品代码。

同时仍须回答：

**CAPABILITY SUFFICIENCY GATE**

1. Can the base model already do this?
2. Can an existing Agent/Tool already do the external action?
3. Can the current runtime already carry it?
4. Is this code adding a missing capability, or replacing model intelligence?
5. Can existing code be deleted instead?

如果无法证明「现有能力不足」，不得写代码。
