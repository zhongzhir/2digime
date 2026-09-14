# 01 — DEVELOPMENT CONSTITUTION

**状态：** `current_authority`  
**层级：** 00 之下；与 02 并列约束实现  
**日期：** 2026-09-08
**性质：** AI Native 架构原则 + 开发纪律 + Owner / CTO / Agent 分工。

---

## 1. AI Native 架构

冻结拓扑：

```text
Human
  → Digital Self / Subject
  → 2digime Intelligence & Orchestration
  → Models / Agents / Skills / Tools / Other Subjects
  → World
```

禁止做成：`Human → 关键词/枚举路由器 → workflow 状态机 → 专用页面`。

**Digital Self** 是唯一「我是谁」。确定性内核执行确认、纠正、替代、失效、同意、撤销、冲突检测、损坏语义。模型可以参与开放理解，不得直接写主体状态。

**Intelligence** 理解自然语言、保持同一个 Goal、把真实能力状态交给模型、只问人必须决定的问题、用普通人语言回报。需要什么能力、用哪个模型/Agent/Tool、失败后怎么办，由大模型自主判断。系统不得用 router / score / workflow 代替这些判断。

**Models / Agents / Skills / Tools** 可替换，只获得本次授权的最小上下文。输出是候选结果或外部证据，不是主体事实。换掉 Codex / Gemini / DeepSeek，架构不得改。

确定性代码只负责：身份与所有权、密钥与权限、路径围栏、高风险闸门、持久化与幂等、执行合同、审计。

确定性代码不得负责：用正则或枚举决定用户想做什么；用固定任务类型决定产品流程；用 workflow 状态机替代专业判断；用本地启发式顶替成熟 Agent。

新增一种用户目标，原则上不需要新增 intent enum 或 workflow。

来源：01A §2、`digitalme_rules.md` §4–§6、conversation-search 架构「不再扩 regex」。归宿：本文。  
推翻：`TASK_INTENT_KINDS`、关键词路由、capabilityLoop 作为永久对象。

### 1.1 克制原则 / Capability Sufficiency First

写代码前先证明现有能力不够。仓库入口见 `AGENTS.md`；详细约束以本节为准。不另建 `personal-context.md` 或第五份原则文件。

**兔机米不是一个受 Digital Self 约束的大模型，而是大模型完整能力的主体化、持续化、增强层。**

做事能力达到市场同类约 95 分位是门槛，默认 Integrate-first。长期核心是 Digital Self / AI Capability / Digital Subject Network（属于我 · 能做事 · 连接世界），不是自研通用 AI 能力。协作是 Subject Network 的一种应用。

顺序：

1. 大模型本身是否已经能完成？
2. 现有 Agent / Tool / Skill 是否已经能完成真实动作？
3. 当前 runtime 是否已经足够承载？
4. 如果已经能完成，禁止新增代码、规则、router、score、状态机、review、adapter 包装。
5. 优先删除已有重复逻辑，而不是继续叠加。

原则：能删不加；能复用不造；能让模型判断就不要用代码替模型判断；宁愿少写，不要多写。**能接不造。少写优于多写。**

runtime 只保留模型无法自己知道、且系统必须保证的机械事实：权限 / 隐私 / 安全；工具真实成功失败；文件是否真的产生；配置是否真实可用；timeout / cancellation；必要真实性边界。

系统只允许在大模型之上增加：**数字之我、安全、授权。** 系统绝不替模型选文件、摘要、判断格式、决定能不能干、判断任务类型、规划步骤、选择工具、决定重试或换方案。

禁止：为单个失败 case 加关键词规则；用 regex / score / topic classifier 模拟模型语义判断；为「更可控」增加第二套 planner/reviewer/state machine；用 harness 词命中反向约束模型表达；因为 Coding Agent 自己更容易实现而重写模型本来已有能力。禁止自研搜索 / Coding Agent / Computer Use / Office 智能 / 基础生成能力去和大模型厂商或 Codex / Cursor / Claude Code 比。

新增代码前必须先过 **Build-vs-Integrate Gate**：

1. 大模型本身是不是已经会？
2. 成熟 Agent / Skill / Tool 是否已经做到高水平？
3. 当前系统是不是已经存在，只是没有暴露？
4. 当前用户电脑 / OS / 软件是否已经拥有？
5. 是否只是缺授权或连接？
6. 是否真的必须由 2digime 新写代码？

如果 1–5 中任何一种能够解决：默认不自研。只有明确证明现有成熟能力无法满足数字之我、安全、授权、或兔机米核心差异化，才允许新增产品代码。

同时回答 **CAPABILITY SUFFICIENCY GATE**：

1. Can the base model already do this?
2. Can an existing Agent/Tool already do the external action?
3. Can the current runtime already carry it?
4. Is this code adding a missing capability, or replacing model intelligence?
5. Can existing code be deleted instead?

如果无法证明「现有能力不足」，不得写代码。

Talk 主链默认收敛为：User → model → 模型决定是否调用工具 → 工具执行真实动作 → runtime 返回真实结果 → 同一模型继续推理 → 模型交付最终答案。runtime 不替模型做语义理解、换题判断、freshness 分类、能力排序、重试策略、失败策略、是否继续旧任务、内容是否「像完成」。

### 1.2 超级助手 L1 做事路径（机械，非任务类型路由）

同一 Talk turn 内由模型自主选择，禁止 keyword router / 任务类别 enum：

- **MODEL DIRECT：** 写作、总结、分析、规划、简单文件修改等，模型直接完成；必要时 read/write/search；不得仅为「看起来专业」而 delegate。
- **SPECIALIST：** 模型判断需要专业能力时 `delegate` 成熟 Agent/Tool（例：`cap_acquired_coding_runtime`）；不得「编程一定用 Coding Agent」。
- **MULTI-CAPABILITY：** 允许 tool A → 看结果 → tool B → capability C → final；顺序由模型决定。runtime 只提供工具事实、权限、deadline、actualSuccess。

模型给出 final assistant response 后，系统必须可靠落 Thread、返回 renderer、让用户看见最终结果；不得在已有最终答复后无意义空转 tool loop。普通低风险内部执行自行完成；仅当真实路径涉及支付、凭证/账号授权、对外发送/发布、删除或不可逆修改、超出现有授权时才请求 Owner——不为此新建完整 policy engine。

能力合同保持通用（id / description / availability 含 ready·acquirable·unavailable / 授权 / execute / result）。禁止按 video/image/audio/digital-human/coding 为 Talk 核心加 special case。`acquireCapability(candidates)` 必须可被任意能力复用，不得锁死在 Coding。

---

## 2. Owner / CTO / Agent 分工

来源：`digitalme_rules.md` §1/§10/§11/§13（主）、`digitalme_context.md` §5.4（辅）、personal-context 角色（仓库无原文，按其在 Cursor/ChatGPT 任务中的引用：开始前读最高原则、Owner 意见是线索）。归宿：本文。

**Owner**

- 确认愿景、价值与真实需求。
- 判断成果是否真正有用。
- 决定重大、不可逆或高风险事项。
- 在少量关键节点做真实体验验收。
- 不负责补齐产品、技术或架构细节，不当调试器。

**CTO（规划与架构责任）**

- 把原则性意图翻译成产品、架构与路线。
- 主动研究需求、市场能力、竞品与可复用工具。
- 提出真正合适的方案供选择，而不是等待 Owner 指路。
- 必要时纠正 Owner 判断，说明理由、代价和替代方案。
- 普通产品与工程细节自行决定，不把专业责任反推给 Owner。
- 对 Cursor / Codex 及其他 Agent 的结果独立复核。

**Agent（单任务实现者）**

- 按 03 的当前任务编码与测试。
- 同一任务一个代码 Owner。
- 开始前读取 AGENTS.md 指向的四份文件。
- 出现 Yellow / Red 必须停补丁、重读 00/01/02。

产品成败不得依赖 Owner 具备产品经理或工程师能力。  
「能够运行」不等于「值得成为产品能力」。

历史「Codex 为默认技术负责人、Cursor 为实现者」（context §5.4.1）是当时工具分工，不写入永久职称。职责按上表，工具可替换。

---

## 3. 开发纪律

### 3.1 每项开发对应真实用户主链

立项先写清：普通用户从哪句话或哪次点击开始，到哪一个可感知结果结束。说不清不准开工。

来源：`digitalme_rules.md` §2、01A §4.1。

### 3.2 新增永久对象 / 字段 / 状态的证明义务

必须回答：用户主链缺了它为何不成立；是否可派生；删除 UI 后是否仍有意义；会不会成为第二事实源。答「测试需要 / 以后可能用 / 兼容旧路径」——不准加。

来源：`digitalme_rules.md` §6、01A §4.2。

### 3.3 唯一事实源

| 问题 | 权威 |
|---|---|
| 我是谁 | Digital Self / Subject |
| 用户要做的那件事 | Goal |
| 实际调用过什么 | Execution Record |
| 产物 | Artifact |
| 允许做什么 | Grant / Consent |
| 密钥 | Secret Store |
| 页面看见什么 | 上述对象的投影 |

禁止并行权威。投影可缓存，不可反写。工作区、日志、Agent Session 不得变成隐形权威。

来源：`digitalme_rules.md` §5–§6、ADR、01A §4.3。

### 3.4 AI first

开放世界判断交给 AI/Agent。若发现自己在写 `if (goal.match(/审计|写一篇/))`，停下来改设计。

### 3.5 Buy / integrate before build

先找成熟模型、Agent、MCP、Skill、Computer Use、官方工具与本地已有软件。2digime 做数字之我、授权、真实执行事实与回流。不得把能力内化误解为重写 Cursor / Codex / Claude Code / Git / 测试框架 / 搜索引擎 / Office 套件。当外部能力已达约 95 分位，停止自研该基础能力。

来源：决策 #37、rules §4、01A §4.5、2026-09-06 Owner/CTO。

### 3.6 最小闭环优先

先让一条真人主链成立。禁止并行开三条「将来需要」的平台。

### 3.7 真实 UI / 正式入口验收

自动化必须打到用户真实会用的入口。hook ≠ fixture ≠ 外部现场 ≠ Owner 真机。未走正式入口不得标产品完成。

来源：rules §9、01A §4.7、CORE-STAGE-REVIEW。

### 3.8 Owner 不参与重复调试

开发者须先用正式入口走通。不得把「请再试一次」当调试步骤。普通工程细节不升级为 Owner 决策。

来源：rules §1/§9、01A §4.8、成果打开 FIX 链。

### 3.9 验证节奏 / 测试战略

测试目标不是证明「规则都被执行」。测试目标是证明：

1. 用户目标真实完成；
2. 大模型原生能力没有被系统削弱；
3. 外部动作真实发生；
4. 数字之我真正提升了结果；
5. 安全 / 授权边界真实有效。

分层：

| 层 | 用途 | 节奏 |
|---|---|---|
| Level 1 | targeted mechanical tests | 分钟级，日常默认 |
| Level 2 | 少量真实模型 smoke | 改到模型/执行主链时 |
| Level 3 | milestone 真实任务验收 | 阶段门 |
| Level 4 | Release Candidate 真人验收 | 仅 Release 前 |

禁止每个小修复都跑几十轮模型矩阵 / 全规则回归。禁止使用模型措辞关键词作为主要产品正确性判定。日常：自动测试 + 必要的真实样本。不因测试全绿宣布 Owner 验收通过。真实用户体验优先于内部验收结论。

来源：rules §9、2026-09-06 Owner/CTO。Yellow / Red 细则在 02。

### 3.10 汇报

向 Owner 汇报控制在结论、关键风险、需要决策的事项、下一步。不堆状态字段和过程日志。没有决策就明确说没有。

来源：rules §10。

### 3.11 方案提出

重大方向至少两条真可行路线、明确推荐、说明锁定与停止条件。不得只问 Owner「你想怎么做」。发现会伤害产品时必须反对并给替代方案。

来源：rules §11、context §5.4「允许反对」。

### 3.12 用户体验

用户主要感到：被正确理解、成果能用、结果属于自己、长期一致、重要风险受控。默认隐藏 Job ID、Adapter、状态机、原始日志。不得把内部机制堆在界面上证明系统在工作。没有新决策，不得新增确认、按钮或阶段。

来源：rules §7、context §5.4.2、01A §3.6–3.7。

历史句「后台可保留复杂状态机」不得解释为允许用状态机替代 AI 判断。后台可以有运行态；永久产品对象仍受 §3.2–3.3 约束。归宿：本文澄清；冲突见 03。

### 3.13 通用需求优先

Owner 意见是假设与线索，不得直接当规格。偏个人特例应反对升为默认。不得因当前 Package 主人把默认产品绑死。

来源：context §5.4、决策 #27–#28。此即 personal-context 在仓库中可核验的重叠部分。

**问题完备性义务（2026-09-14，决策 #111）**：本条强化而非替换上文。AI 对问题解决的完备性负责，而不仅对执行正确性负责。规划或实现前必须：校验问题框架本身；识别被遗漏的重要行动者、生命周期与 UX/数据/安全/隐私/权利/信任/运营/经济/互操作/失败处理等必须维度；对标成熟产品与已有能力；提出最小完备方案。Owner 给出的条目是关注点与线索，不推定为完整需求。只在方向、主权、不可逆架构、外部成本、法律权利或必须现在决定的移动策略上请示 Owner。

来源：`docs/governance/DIGITALME-PROBLEM-FIRST-COMPLETENESS-PRINCIPLE.md`、context §5.4、决策 #111。

### 3.14 细节纠缠时强制重读

出现下列信号必须停工重读 00/01/02：又要加 intent/phase/特殊网站分支；又要把内部字段露到文案；测试已绿但说不清用户看见什么；「兼容旧行为」开始决定新设计；需要 Owner 提供日志或点精确坐标。

---

## 4. 不吸收进本文的历史开发策略

| 条目 | 来源 | 处理 |
|---|---|---|
| 模块轮动演进、单模块不得连升两阶段 | rules §14 | 被 03 的 Phase 1→2→3 顺序覆盖；轮动作为历史策略 |
| 广播近期实现条件 | rules §16 | 长期假设留 00；当前不实现，见 03 |
| 规格文件 v0.6 为唯一需求源 | context §3.11 | 规格文件当前不在本工作区；需求权威改为 00+03 |
| 任务包先于编码的全套旧模板 | context §5.4.1 | 精神保留（写清允许/禁止/验收）；旧任务包格式不强制 |
