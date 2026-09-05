# AGENTS.md

**状态：** `current_entry / not_a_product_constitution`  
**日期：** 2026-09-05

任何 2digime 的规划、架构、开发、测试、验收任务开始前，必须读取下列文件，不得用聊天记忆代替，不得等待 Owner 提醒：

1. [`docs/refoundation/00-PRODUCT-CONSTITUTION.md`](docs/refoundation/00-PRODUCT-CONSTITUTION.md)
2. [`docs/refoundation/01-DEVELOPMENT-CONSTITUTION.md`](docs/refoundation/01-DEVELOPMENT-CONSTITUTION.md)
3. [`docs/refoundation/02-FAILURE-LESSONS.md`](docs/refoundation/02-FAILURE-LESSONS.md)
4. [`docs/refoundation/03-CURRENT-PLAN.md`](docs/refoundation/03-CURRENT-PLAN.md)

若当前工作已出现 Yellow 或 Red 信号（见 02），必须重新读取 02，并同时重读 00 与 01。

本文只做入口。产品原则在 00，开发纪律在 01，失败史在 02，当前执行顺序只在 03。做事架构的克制原则以下文为准，并写入 01；仓库内没有 `docs/design/personal-context.md`，不得另建第五份原则文件。

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

新增代码前必须回答：

**CAPABILITY SUFFICIENCY GATE**

1. Can the base model already do this?
2. Can an existing Agent/Tool already do the external action?
3. Can the current runtime already carry it?
4. Is this code adding a missing capability, or replacing model intelligence?
5. Can existing code be deleted instead?

如果无法证明「现有能力不足」，不得写代码。
