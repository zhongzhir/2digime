# 2DIGIME-REFOUNDATION-BASELINE-01

**文档编号：** 2DIGIME-REFOUNDATION-01A  
**性质：** 只读审计 + 文档重建宪法  
**状态：** `historical_audit_report / not_current_authority`  
**日期：** 2026-09-01  
**适用仓库：** `D:\Projects\Digital Me`  
**本轮禁止：** 产品代码修改、提交、push、打包

本文是 01A 的遗产审计报告，**不再与现行权威并列**。现行层级见 [`../../AGENTS.md`](../../AGENTS.md)：`00` 产品宪法、`01` 开发宪法、`02` 失败教训、`03` 当前计划。与四份 authority 冲突时以四份为准。

旧规划、旧 ADR、旧任务包不得自动继承。本文可继续作为盘点与资产分类的对照。

---

## 0. 现场保护

核对时间：2026-09-01。

| 项 | 事实 |
|---|---|
| 工作区 | `D:\Projects\Digital Me` |
| 当前分支 | `build/subject-learning-availability-01` |
| HEAD | `1f4a7cfa8d5b26ba66e34241c1c67659727c196b`（`fix: stabilize task switching, wait/cancel, and GitHub parse`） |
| 未提交做事 UI / 能力闭环 / Digital Self Core | **保持原样**。不清理、不提交、不推送、不打包 |
| `digitalme-v2/` | 未跟踪目录，未改动、未纳入 |
| 本轮改动范围 | 仅本文及遗产状态标记；**零产品代码** |

未提交工作树包含两类互不混淆的资产：

1. **做事 UI 修复与能力闭环**（`electron/renderer/*`、`src/work-runtime/*`、`src/capability/*` 等）——现场冻结，等待新宪法，不得当作继续沿旧架构开发的授权。
2. **DIGITAL-SELF-CORE-01 P0**（规划、ADR、依赖图、`src/subject-core/digital-self-core/`、invariant tests）——状态改为 **`frozen / absorbed_into_refoundation`**。其审计、Subject authority 设计、原型和不变量测试作为**候选资产**进入本文第 5 节；**不再沿旧架构继续 P1–P5**。

---

## 0.1 本轮阅读范围与诚实缺口

已交叉阅读并整理：

- `digitalme_context.md`（当前仓库内最高原则的幸存摘要）
- `digitalme_log.md`（2026-07 至今任务、Owner 真机、失败链）
- `README.md`、`docs/architecture/README.md`
- `docs/plans/DIGITAL-SELF-CORE-01.md`、`ADR-DIGITAL-SELF-CORE-01.md`、依赖图
- `docs/reviews/DIGITALME-CORE-STAGE-REVIEW-01.md`
- `docs/plans/GENERAL-TASK-CLOSURE-01.md`
- conversation / collaboration / capability 相关 benchmark 与架构笔记
- 当前真实代码：`src/subject-core`、`src/work-runtime`、`src/capability`、`src/execution`、`src/collaboration`、`src/subject-comm`、`src/infrastructure`、`electron/renderer`

当前工作区**找不到**以下被 context 长期引用的文件（审计以其在 `digitalme_context.md` / `digitalme_log.md` 中的摘录为准，不假装全文仍在盘上）：

- `AGENTS.md`（日志已记「项目无 AGENTS.md」）
- `digitalme_rules.md`
- `personal-context.md` / `project_sources.md`（Cursor 工作区规则引用，不在本仓库）
- `digitalme_subject_architecture_and_rd_principles_v0.1.md`
- `digitalme_product_spec_v0.2.md`
- `DigitalMe_product_baseline_reset_v0.2_2026-07-21.md`
- `digitalme_data_sovereignty_principle_20260711.md`

原则提取规则：只把 Owner 反复确认、后续未被否决的条目升为宪法；阶段性排期、页面结构和实现方案降为历史。

---

## 0.2 遗产三分法

### A. Owner 已确认、长期仍成立的产品原则

1. 2digime 是本人拥有和控制的**个人数字主体**，不是聊天机器人，不是模型套壳，不是 Owner 定制 Demo。
2. 存在的理由：在 AI 能力增强时保住并扩展人的记忆、判断、表达、能力与关系，而不是被平台和模型吸收。
3. 产品动词是 **代表我 — 做事 — 协作**；三者是同一主体的伸展，不是三个产品。
4. 双线长期成立：**数字化构建人**（真实、动态、可纠正的数字之我）是根基；**主体化数字实体**（主动产出、与人及 Agent 合作）是伸展。
5. **用户 → 2digime → Professional Agent(s)**。2digime 负责理解、编排、授权、验收与回流；专业判断和专业执行交给成熟 Agent/模型/工具。
6. **AI First**：开放语义理解与专业判断由 AI/Agent 承担；确定性代码只守安全、权限、身份、归属、持久化和必要执行合同。
7. **能力跟随**：不争最强最新，导入业界最好；禁止用自研弱能力替代成熟 AI/Agent。
8. **校准不是限制**：数字之我不通过「像我」削弱通用能力；缺本人原料时用通用知识，并区分来源。
9. **唯一主体权威**：全系统只有一个当前之我；页面、Prompt、Artifact、Task 文本、材料索引、模型回复都不是主体事实源。
10. **UI 是投影**：用户体验结果，不观看系统证明自己；内部对象不得变成用户步骤。
11. **复杂性内收**（决策 #110）：能自动的不转嫁用户；身份、授权、不可逆、高风险必须由人决定。
12. **主权**：本地优先、可迁移、可授权、可审计、可撤销；Relay 是加密邮局，不是事实源。
13. **人人可用、说人话、少决策、通用需求优先。**
14. 协作方向成立，但当前阶段**停止扩建**材料/Task/Artifact/Grant/大文件/支付/信誉/多方/P2P，直到代表我与做事真正成立。

### B. 历史阶段策略（曾正确，现不得当宪法）

- 四板块近期取舍、P1-PANORAMA、第一/第二纵向闭环的具体页面与产物清单。
- 「对话 \| 做事 \| 我 \| 能力」侧栏结构、七模块数字之我框架、成果包类型名单。
- R2 对话运行时作为验收主线；控制层六块线性集成。
- 句式分类器补丁（GROWTH-CONTEXT-CONSISTENCY-01A～E）作为修「关于我」的主路线。
- GitHub 专项失败交接、复制提示词作为通用主闭环。
- DIGITAL-SELF-CORE-01 的 P1–P5 **实现分期**与 GrowthEvent 兼容迁移方案。
- GENERAL-TASK-CLOSURE-01 作为当前执行计划。
- 「0 第二真值源已经稳定」的阶段复盘叙事。

### C. 已被否决或证明错误的设计

- 纯 Web SaaS 明文中心人设库；纯离线桌面作为终局。
- 用「像我」限制模型上限；缺原料逼用户补料。
- 关键词总路由、封闭任务类型体系、传统 workflow 状态机替代 AI 判断。
- 新增「创作」一级入口（决策 #107 不采用 B）。
- PAN-01 / PAN-01R 作为正式产品表面。
- 第三套 Profile / memory / subject-v2；双写双权威。
- 继续句式级单点修补。
- 把 Owner 个人情境升为默认产品。
- 把工程绿、mock 绿、专项绿写成产品已可用。
- 继续沿旧做事页 / 旧 job-runner 打补丁来「完成数字之我」。

### D. 仍值得重新审查的问题

见文末「Owner 决策」；最多两项。其余问题由本宪法直接冻结，不再请示。

---

# 1. PRODUCT-CONSTITUTION

## 1.1 2digime 是什么

2digime 是由本人拥有和控制、以本人为源头持续形成的**个人数字主体系统**。它能够：

- 形成一个有证据、可解释、可纠正、可撤销、持续演化的数字之我；
- 在明确授权下代表本人理解、判断、表达、行动；
- 调用外部智能能力（模型、专业 Agent、技能、工具）完成真实世界任务；
- 在授权边界内与其他主体协作。

一句话：

> **2digime 是你的数字主体：它代表你、为你做事、在授权下与世界协作，并在使用中成长为更准确的你。**

## 1.2 2digime 不是什么

不是：

- 又一个 ChatGPT 套壳或提示词产品；
- 传统 workflow / BPM / 任务管理系统；
- 按任务类型枚举的「写作机器人 + 代码机器人 + 研究机器人」拼盘；
- 数字简历、记忆列表、人设卡或静态 Profile；
- 自研 IDE、自研搜索引擎、自研深度研究产品；
- 社交匹配、多人协作平台、支付与信誉网络（长期可成为伸展，不是此刻产品）；
- 仅为当前 Owner 调教的私人 Demo。

## 1.3 为什么存在

AI 越强，人越容易被平台和模型吸收：记忆留在别人那里，判断被模型替代，行动被工具商绑定，关系变成平台流量。2digime 存在，是为了让人在数字世界里仍然有一个**属于自己的主体**：

1. 自我定义：我是谁、要成为谁、什么不可越过，由我声明和纠正；
2. 自我发展：经历、成果、选择回流成下一次更好的理解与行动；
3. 对外行动：不是我去操作一堆工具，而是我的数字主体在授权下调用专业能力；
4. 可带走：主体与成果可迁移，不绑死某一模型、某一 Agent、某一云。

没有数字之我，做事只是通用助手；没有做事，数字之我只是档案柜；没有协作，主体无法进入他人的世界。三者缺一，产品承诺就不成立。

## 1.4 「代表我 — 做事 — 协作」的关系

```text
代表我     数字之我成立：系统按我的事实、偏好、边界理解与表达
   │
   ├── 做事     同一主体把目标变成世界里的结果，并验收、采用、学习
   │
   └── 协作     同一主体在授权下与其他主体/Agent 合作，最小披露，结果回流
```

- **代表我**是根基。没有可核对的「我」，做事和协作都是替一个陌生人工作。
- **做事**是主体性的证明。不能在世界里完成目标，就只是会说话的档案。
- **协作**是主体性的延伸。在代表我与做事尚未对真人成立前，协作只保留已验证的传输与授权思想，不扩建产品面。

优先级冻结：先让「我」唯一且可纠正，再让「帮我做 X」最短闭环成立，协作产品面继续暂停。

## 1.5 数字之我如何成长

数字之我不是一次蒸馏出来的人格复制，而是对用户的持续逼近：

```text
上传 / 对话 / 做事 / 选择 / 纠正 / 采用 / 拒绝 / 授权
        → 观察（带来源、时间、范围、敏感级）
        → 候选认识（不是自动真理）
        → 确认 / 纠正 / 拒绝 / 失效
        → 当前数字之我
        → 编译本轮所需的最小上下文
        → 下一次理解、规划、执行
        → 再观察
```

硬规则：

1. 材料是证据，不等于已确认事实。
2. 模型回复、系统文案、任务成果不得冒充用户事实。
3. 疑问、假设、引用他人、一次性任务要求不得写成长期身份。
4. 用户最新明确纠正覆盖旧认识，并在所有表面同时生效。
5. 删除材料或撤销授权后，失去全部证据的认识必须失效或降级。
6. 敏感信息默认仅本机；外发必须绑定任务、范围和接收方。
7. 系统不承诺完整复制人格；必须能说明「这次用了什么、为什么、来源是什么」。

## 1.6 人、2digime、Agent 的关系

| 角色 | 是什么 | 做什么 | 不做什么 |
|---|---|---|---|
| **人（Owner）** | 唯一源头与最终权威 | 设定目标、纠正「我是谁」、授权高风险、采用结果 | 不当调试器，不管理内部状态机，不填技术参数 |
| **2digime** | 人的数字主体与编排层 | 理解语言、维护数字之我、选择与约束能力、验收、解释、回流 | 不假装自己是最强模型；不重做专业 Agent 的核心 |
| **Professional Agent / Model / Skill / Tool** | 可替换的专业能力 | 在授权范围内完成专业判断与执行 | 不得写主体事实；不得扩大授权；不得成为产品本身 |

人拥有 2digime。2digime 调用 Agent。Agent 没有独立于人的「我」。

## 1.7 主体性、所有权、迁移、授权、审计

- **主体性**：对外行动以数字之我为名义，但法律与产品上的主人永远是人。
- **所有权**：主体数据、密钥、授权记录、成果默认在人本机可控的 Subject Package 中；云与 Relay 不成为事实源。
- **迁移**：Package 可拷贝、可导出、可在另一台设备恢复；不绑定单一模型供应商。
- **授权**：最小必要、默认单次/单任务、可撤销、不可暗中扩大。文件修改、网络、账号、外发、付费必须分开展示。
- **审计**：关键行为可追溯（谁、对何数据、调用何能力、结果如何、是否被采用）。普通用户默认不看审计；需要时能打开。

## 1.8 对话 / 做事 / 协作 / 数字之我 / 设置 只是同一主体的不同表面

它们不是五个子系统，更不是五套用户定义。

| 表面 | 对用户意味着什么 | 底层实际是什么 |
|---|---|---|
| **对话** | 和我的 2digime 说话 | 人与 Intelligence 的语言通道：询问、告知、纠正、下达目标 |
| **做事** | 正在完成的一件事 | 同一个 Intelligence 正在推进的 **Goal**；执行记录与成果挂在这个 Goal 上 |
| **协作** | 和另一个主体一起做 | 同一个 Goal，对端是另一个 Subject 或专业 Agent |
| **数字之我** | 它现在怎么了解我，我如何纠正 | Current Subject 的解释与控制台，不是另一个档案库 |
| **设置** | 连接、权限、高级选项 | 密钥、能力连接、同意默认值、可替换传输；不是产品主路径 |

删除这些页面，主体与做事逻辑必须仍然独立成立。页面只投影，不持有第二份「我」或第二份「这件事做到哪了」。

---

# 2. AI-NATIVE-ARCHITECTURE-CONSTITUTION

## 2.1 冻结拓扑

```text
Human
  → Digital Self / Subject
  → 2digime Intelligence & Orchestration
  → Models / Agents / Skills / Tools / Other Subjects
  → World
```

禁止把产品做成：

```text
Human → 关键词/枚举路由器 → 某类 workflow 状态机 → 专用页面
```

## 2.2 分层职责

**Digital Self / Subject**

- 唯一「我是谁」权威。
- 证据、事件、当前认识、授权范围、主体版本。
- 按本次目的编译最小上下文。
- 确定性内核执行：确认、纠正、替代、失效、同意、撤销、冲突检测、损坏/读取失败语义。

**2digime Intelligence & Orchestration**

- 理解自然语言：这是在问、在改我、在让我做、在授权，还是在闲聊。
- 把目标保持为同一个 Goal，直到结束、放弃或被用户改写。
- 判断当前能力是否足够；选择、连接、调用、验收。
- 向用户只问真正需要人决定的问题。
- 把结果、失败和需要的下一步用普通人语言说回来。

**Models / Agents / Skills / Tools / Other Subjects**

- 可替换。Codex、Gemini、DeepSeek、某 MCP、某研究 Agent 都只是能力。
- 只获得本次授权的最小上下文。
- 其输出是候选结果或外部证据，不是主体事实。

**确定性代码只负责**

- 身份与所有权
- 密钥与权限
- 路径围栏与高风险闸门
- 持久化、幂等、损坏降级
- 执行合同（调用一次能力、收回一次结果、绑定同一 Goal）
- 审计

**确定性代码不得负责**

- 用正则或枚举决定用户想做什么
- 用固定任务类型决定走哪条产品流程
- 用 workflow 状态机替代专业判断
- 用本地启发式顶替成熟 Agent

## 2.3 明确禁止

1. **禁止关键词路由**作为产品主路径（含目标正则、句式门、品牌名 `if DeepSeek`）。
2. **禁止固定任务类型体系**（`create_document | analyze_code | modify_code | external_research | general` 这类封闭枚举不得再当路由键）。
3. **禁止传统 workflow 状态机**替代 AI 判断（含把 11 相 capabilityLoop、12 态协作、thin_v1/legacy 双轨做成永久对象）。
4. **禁止新增第三套主体存储**或双写双权威。
5. **禁止**把「没有这种任务类型」写成文章交差，冒充已经完成。
6. **禁止**为已出现的失败句式加一条特例。

允许的确定性薄约束：用户**显式**说「不要联网 / 不要改文件 / 取消」；安全围栏；授权范围校验。薄约束不是分类器。

## 2.4 换模型 / 换 Agent 为什么架构不变

能力以合同接入，不以品牌接入。2digime 问的是：完成这个 Goal 需要什么能力、当前有什么、缺口如何诚实处理。它不问「是不是 Codex」。因此替换执行器只换适配器，不换主体、不换 Goal、不换 Intelligence。

---

# 3. FAILURE-POSTMORTEM

旧版本不是「功能不够多」，而是**用确定性补丁堆出了一个无法再代表用户的系统**。下列每一项今后视为红线。

## 3.1 确定性逻辑覆盖 AI 判断

- **症状：** 对话靠句式正则分流；做事靠目标关键词判 intent；协作接受/拒绝靠风险词；搜索决策一度靠 keyword 扩面。真人换一种说法就错。
- **根因：** 把「可测试」误当成「可理解」。正则对 fixture 稳定，对开放语言脆弱。
- **当时错误处理：** 继续加高精度句式（01A–01E）、风险词表、显式意图覆盖；局部 Owner 通过后当作路线正确。
- **今后禁止：** 用分类器/关键词/枚举作为理解层。模型做开放理解，代码只校验不变量和安全边界。

## 3.2 intent / capability 封闭枚举

- **症状：** 视频、表格、邮件、本机操作等落入 `general → document`，被写成说明文章。GitHub 审计有交接，其他任务没有。
- **根因：** `TASK_INTENT_KINDS` 把世界缩成五种；能力选择绑在枚举上。
- **当时错误处理：** 补 OPTIMAL/BASELINE/LIMITED/UNAVAILABLE，再补能力发现状态机，仍承认未知任务会写成文章。
- **今后禁止：** 任务类型白名单。新增一种用户目标，不得新增 workflow 或 intent enum。

## 3.3 局部 case patch

- **症状：** 「你知道我叫什么名字吗」抽出「什么名字吗」；资料查询靠场景句式；GitHub URL 反斜杠再补一条解析。
- **根因：** 把用户抱怨的句子当成需求规格。
- **当时错误处理：** 加抽取器、加测试、把泄漏行为 characterization 成绿。Owner 最终要求停止句式修补。
- **今后禁止：** 针对已出现句式/网站/文件名增加永久分支。同一问题必须升到主体或 Intelligence 层。

## 3.4 多事实源

- **症状：** 对话、规划、执行、协作把用户理解成不同的人。页面「已经了解」，对话「一无所知」。`detected.name` 绕过确认。
- **根因：** 至少六套准权威：manifest、GrowthEvent、material-index、派生投影、Job freeze、协作直读 GrowthEvent。
- **当时错误处理：** 强制某两处读同一投影，不拆权威。阶段复盘仍写「0 第二真值源」。
- **今后禁止：** 任何模块自行定义用户。读取失败不得解释为「不了解用户」。规划与执行必须同一主体版本。

## 3.5 Task / Job / Artifact 与用户对象混淆

- **症状：** 资料查询建成 Task/成果卡；后一句话覆盖当前任务；「采用」又开 Coding Job；迟到 Job 画到另一任务。
- **根因：** 内部执行对象被当成用户目标；UI 监视异步结果时不核对 Goal 身份。
- **当时错误处理：** 逐项语义修复和 epoch 核对，正确但是补丁。对象模型仍让 meta 成为杂物间。
- **今后禁止：** 把 Job 相位、内部规划源、capabilityLoop 展示给用户。用户只看见目标、进展人话、结果、需要自己决定的事。

## 3.6 UI presenter / state 膨胀

- **症状：** `app.js` 近万行；协作 12 态；LocalCollaborationHost 近两千行双视角；大量「建好未开」UI。
- **根因：** 每修一个体验就在渲染层加状态，而不是收口投影 API。
- **当时错误处理：** 外提少量投影模块，主体仍是上帝文件；隐藏入口代替删除。
- **今后禁止：** 渲染层持有事实或工作流。没有用户新决策，不得新增确认、阶段或页面。

## 3.7 内部状态暴露用户

- **症状：** 「请判断是否正确」把验收推给 Owner；装配/候选/快照曾成为用户步骤；claimId 泄漏；PAN-01 工程绿但产品感知失败。
- **根因：** 开发者心智模型直接画成界面。
- **当时错误处理：** 改文案、撤入口、加 sanitizer；未把「内部对象≠用户步骤」写成不可违反的验收。
- **今后禁止：** 普通界面出现协议名、枚举名、adapter、MCP、HTTP、quota、内部阶段名。技术诊断仅在用户明确要求时出现。

## 3.8 测试合同固化错误设计

- **症状：** characterization 断言泄漏姓名等于「什么名字吗」；坐标点击/错误 probe 路径被写成 Owner 通过；场景句式测试保护补丁路径。
- **根因：** 测试锁的是当前行为，不是产品不变量。
- **当时错误处理：** 用更多专项测试证明补丁，而不是淘汰坏合同。
- **今后禁止：** 用测试冻结已知错误行为作为生产合同。characterization 只允许标 `legacy_must_not_port`。绿测不是产品完成。

## 3.9 mock / 专项绿但真人体验失败

- **症状：** 成果打开自动化全绿，Owner 正式页无反馈；MCP hook 绿 ≠ 官方 MCP；协作 runtime 真闭环但履行 UI 全关；PAN-01R 70/70 仍 `owner_product_perception_failed`。
- **根因：** 测的不是用户走的那条路。
- **当时错误处理：** 再写更像真人的 harness，同时继续催 Owner 复验。
- **今后禁止：** 未走正式入口的成功不得标产品完成。hook ≠ fixture ≠ 外部现场 ≠ Owner 真机。分层必须写进报告。

## 3.10 历史兼容绑架新设计

- **症状：** 旧 GrowthEvent / 打开成果多套入口 / R2 基础设施 / 「保留旧路径」导致双轨（legacy 与 thin_v1）并存。
- **根因：** 害怕破坏旧测试和旧包，就把兼容层做成第二产品。
- **当时错误处理：** 注释写「不是第二状态机」，字段仍在永久 schema 里。
- **今后禁止：** 兼容层必须可删除。迁移期禁止双写。不能安全迁移的旧数据降级或丢弃，不得污染新核。

## 3.11 自研弱能力替代成熟 AI / Agent

- **症状：** Bing HTML 当主搜索，P95 引用门槛达不到；本地启发式当协作判断；无专业能力时用写文章冒充执行。
- **根因：** 「我们也能做一点」替代「去调用会做的人」。
- **当时错误处理：** 在弱提供方上继续打质量补丁，并诚实承认没达标，但主路径未改。
- **今后禁止：** 重复开发成熟 AI 产品的核心。没有可靠能力就诚实停住或交接，不许假完成。

## 3.12 Owner 被拖入工程调试

- **症状：** 成果打开 FIX-01A/B/C/D 连环；Owner 反复点同一按钮；probe 路径错误仍安排复验；最终不得不 `owner_retest_forbidden`。
- **根因：** 把 Owner 当集成测试器，且根因判断多次错误（按钮接线 vs 2.1MB 同步 JSON）。
- **当时错误处理：** 每一轮都「再请 Owner 看一下」。
- **今后禁止：** 开发者自己的鼠标/正式入口未过，不得送 Owner。2 轮失败黄灯，3 轮失败红灯，强制回到本宪法而不是再补一刀。

---

# 4. DEVELOPMENT-DISCIPLINE

后续所有 Agent 在本仓库开发 2digime，必须遵守。违反即停。

## 4.1 每项开发必须对应真实用户主链

立项先写清：普通用户从哪句话/哪次点击开始，到哪一个可感知结果结束。说不清主链的任务不准开工。禁止「先把基础设施建完再找用户价值」。

## 4.2 新增永久对象 / 字段 / 状态的证明义务

新增任何落盘字段、枚举、相位、Store，必须书面回答：

1. 用户主链缺了它为什么不成立？
2. 它是不是已有对象能派生的？
3. 删除 UI 后它是否仍有意义？
4. 它会不会成为第二事实源？

答不出或答案是「测试需要 / 以后可能用 / 兼容旧路径」——不准加。

## 4.3 唯一事实源

| 问题 | 唯一权威 |
|---|---|
| 我是谁 | Digital Self / Subject |
| 用户要我做的那件事 | Goal（用户意图单位） |
| 实际调用过什么、做到哪 | Execution Record（执行事实，不对用户暴露相位名） |
| 产物是什么 | Artifact（内容寻址） |
| 允许做什么 | Grant / Consent |
| 密钥 | Secret Store |
| 页面上看到什么 | 上述对象的投影 |

禁止并行权威。投影可缓存，不可反写。

## 4.4 AI first

开放世界判断交给 AI/Agent。代码守门。若发现自己在写 `if (goal.match(/审计|修改|写一篇/))`，停下来改设计。

## 4.5 Buy / integrate before build

先找成熟模型、Agent、MCP、官方工具。2digime 做选择、授权、验收、回流。只有当市场上不存在且该能力构成主体性本身时，才自建。

## 4.6 最小闭环优先

先让一条真人主链从输入到结果成立，再谈完整、市场、协作网、托管目录。禁止并行开三条「将来需要」的平台。

## 4.7 真实 UI / 正式入口验收

自动化必须打到用户真实会用的入口。隐藏窗口、内部 probe、坐标点击、测试专用 IPC 不能单独作为完成证据。

## 4.8 Owner 不参与重复调试

Owner 验收的是产品感受和关键取舍。开发者必须先用正式入口走通。不得把「请再试一次」当作调试步骤。

## 4.9 2 轮失败黄灯 / 3 轮失败红灯

同一用户主链：

- 第 2 次修复后仍失败 → 黄灯：停止加补丁，重读本文件第 1–4 节，检查是否确定性逻辑又覆盖了 AI，或又引入了第二事实源。
- 第 3 次仍失败 → 红灯：禁止再改该局部。提交设计复盘，必要时回退。不准再请 Owner 复验同一按钮。

## 4.10 细节纠缠时强制重读本组文档

出现下列信号必须停工重读本文，而不是继续搜代码打补丁：

- 又要加一个 intent / phase / 特殊网站分支；
- 又要把内部字段露到文案里；
- 测试已绿但说不清用户看见什么；
- 「兼容旧行为」开始决定新设计；
- 需要 Owner 提供日志、截图对比 DOM、点精确坐标。

本组文档 = 本文。旧任务包、旧 ADR、旧测试名不是上级。

---

# 5. LEGACY-ASSET-AUDIT

评价标准：**对宪法有没有不可替代的作用**。代码多、测试多、曾经 Owner 通过，都不构成 KEEP。

图例：

- **KEEP** — 思想与实现都可进入新核（可经接口整理，但不要重写目的）
- **REUSE_BEHIND_NEW_INTERFACE** — 留下机制，换掉产品心智与调用方式
- **REFERENCE_ONLY** — 读它学习，禁止原样接线
- **DISCARD** — 不得带进新核（可留在旧树供对照）

## 5.1 Subject / Package / memory

| 资产 | 判定 | 理由 |
|---|---|---|
| Subject Package 可拷贝目录、事件追加、密钥与材料同根 | **KEEP**（形态） | 所有权与迁移的物理基础 |
| GrowthEvent + deriveAllViews + userVisibleFacts 作为生产权威 | **REFERENCE_ONLY** | 已证明多权威；不得再当「我」 |
| 蒸馏 / 候选 / JIT 确认管道 | **REUSE_BEHIND_NEW_INTERFACE** | 「观察→候选→确认」对；句式门和多入口捕获错 |
| DIGITAL-SELF-CORE 合同：唯一权威、证据、纠正优先级、Compiler、读取失败≠空白 | **KEEP**（原则与不变量） | 已被 Owner 接受的主体思想；吸收进宪法 |
| `digital-self-core` 内存实现、P1–P5 迁移计划、legacy-adapter 双轨 | **REUSE_BEHIND_NEW_INTERFACE / 计划 DISCARD** | 原型证明合同可编译；**不再沿旧主链迁移开工**。characterization 所固化的泄漏行为 **DISCARD** |
| material-index 的 `detected.name` 当事实 | **DISCARD** | 第二事实源 |

## 5.2 model gateway

`src/infrastructure/model-http.ts`：**KEEP**。薄 HTTP、错误分类、不污染 Store。  
OpenAI-compatible 适配器作为「文档能力」产品绑定：**REUSE_BEHIND_NEW_INTERFACE**。

## 5.3 file ingestion

`extract.ts`、路径围栏、预算截断、recursive-ingest：**KEEP**。  
主体摄取与任务 Snapshot 双管道、启发式字段检测：**REUSE / REFERENCE_ONLY**。统一为「材料只是证据」。

## 5.4 secret store

FileSecretStore + CipherAdapter：**KEEP**。  
env / runtime JSON 多源：**REUSE** 收口为单一 SecretAccessor。

## 5.5 authorization / audit

Grant 投影不可自行扩大、ActionReceipt、同意可撤销：**REUSE_BEHIND_NEW_INTERFACE**。  
`remote-github-audit` 作为意图正则模块：**DISCARD**。  
不存在独立全局审计 Store——新核需要真正的审计日志，但不要复制散落镜像字段。

## 5.6 capability registry / adapters

`CapabilityAdapter` 生命周期（describe / check / prepare / execute / cancel / recover）：**KEEP**。  
具体 MCP / executor / search adapter：**REUSE_BEHIND_NEW_INTERFACE**。  
Registry 按 intent 枚举选择、`capabilityLoop` 11 相、connection-store 与 Job 并行：**REFERENCE_ONLY，状态机 DISCARD**。连接持久化「确认后才写、断开先写撤销」的**安全思想** KEEP，实现重做。

## 5.7 Coding Agent

ExecutorTaskPackage、隔离工作区、路径校验、独立复测、hidden spawn：**REUSE_BEHIND_NEW_INTERFACE**。  
`coding-agent-codex` 与 `external-executor-codex` 双路径、blocker 测试矩阵、巨型 CTO 模块：**REFERENCE_ONLY**。原则「2digime 自己验收、不把对错推给用户」KEEP。

## 5.8 Search

SearchConnector 契约、外部证据不得进入主体、诚实降级：**KEEP**。  
`conversation-search` 巨石编排、Bing HTML 作为战略搜索、work 侧另一套 public-web-query：**REUSE / DISCARD 战略弱提供方**。需要成熟搜索/研究 Agent，而不是继续打磨 HTML 抓取。

## 5.9 Artifact persistence

内容与对象分离、digest 寻址、ContentStore 围栏：**KEEP**。  
把 CTO 验收 UI 字段塞进 `Artifact.acceptance`：**REUSE 剥离为投影**。

## 5.10 Relay / E2EE

SubjectEnvelope、Relay 只存密文、Ed25519/X25519/AES-GCM、ACK/inbox：**KEEP**。  
这是少数可原样作为新产品传输层的代码。业务层 opportunity/signal/proposal 产品面：**REFERENCE_ONLY**，继续暂停扩建。

## 5.11 Conversation

「主进程权威、页面只投影」、turn 幂等：**KEEP**。  
主体闲聊会话 vs `Task.meta.conversation` 双存储、renderer 正则 scrub：**DISCARD 双权威；scrub 用投影 API 替代**。

## 5.12 Work Runtime

「对话理解不等于已经执行；执行必须有可绑定的记录」：**KEEP**（原则）。  
`job-runner` / `work-converse` 上帝对象、`work-intent` 关键词、thin_v1 与 legacy 双轨：**REFERENCE_ONLY，不得作为新核骨架**。未提交的做事 UI 时间线投影可作交互参考，**不是**继续开发授权。

## 5.13 Task / Job / Artifact 模型

意图单位、执行记录、成果版本三者分离：**KEEP**（需改名心智：用户面对的是 Goal，不是 Task 工作流）。  
`Task.meta` 中的 conversation/plan/revisionLoop/runtimePath/capabilityLoop：**DISCARD 作为永久工作流附件**。需要保存的对话与计划是 Goal 的投影，不是第二状态机。

## 5.14 collaboration

Record / Grant 分离、最小披露、对端独立判断、结果带 provenance：**KEEP**（合同思想）。  
`local-collaboration` 上帝宿主、deprecated schema、12 态用户状态、履行 UI 强制关闭的半成品：**REFERENCE_ONLY / DISCARD 膨胀**。产品面继续暂停。

## 5.15 renderer / UI

信息架构（人要能说话、能看正在做的事、能看我、能改设置）：**REFERENCE_ONLY**。  
`app.js` 作为架构：**DISCARD**。新 UI 按投影重写。不得把近万行单体「慢慢拆」当作重建。

## 5.16 总表

| 域 | 判定 |
|---|---|
| Subject Package 形态 / 主权落盘 | KEEP |
| GrowthEvent 生产权威 | REFERENCE_ONLY |
| Digital Self Core 原则与不变量 | KEEP（吸收）；实现计划冻结 |
| model-http / secret-store / ContentStore | KEEP |
| extract / ingest 安全 | KEEP |
| CapabilityAdapter 合同 | KEEP |
| capabilityLoop / WorkIntent 枚举 / 关键词路由 | DISCARD |
| Coding 隔离执行合同 | REUSE_BEHIND_NEW_INTERFACE |
| Search connector | KEEP；弱自建搜索 DISCARD 战略地位 |
| Artifact 内容寻址 | KEEP |
| Relay / E2EE | KEEP |
| Conversation 双存储 | REUSE 统一 |
| job-runner / work-converse 实现 | REFERENCE_ONLY |
| Task/Job/Artifact 核心分离 | KEEP |
| Collaboration schema | KEEP；宿主与产品扩建 REFERENCE/暂停 |
| renderer 单体 | DISCARD |

---

# 6. REFOUNDATION-ARCHITECTURE

只到概念和接口，不写实现。若开始依赖大量状态表、枚举和例外分支，本方案失败。

## 6.1 最少核心

```text
                    ┌──────────┐
                    │  Human   │  目标、纠正、授权、采用
                    └────┬─────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Digital Self        │  唯一之我
              │ Subject             │  证据 / 当前认识 / 同意
              └──────────┬──────────┘
                         │ compiled slice
                         ▼
              ┌─────────────────────┐
              │ 2digime Intelligence│  理解、编排、验收、解释
              │ & Orchestration     │
              └──────────┬──────────┘
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Models         Agents         Other Subjects
      Skills         Tools
          └──────────────┬──────────────┘
                         ▼
                       World
```

四类运行时对象就够：

1. **Subject** — 我是谁（含同意与审计指针）
2. **Goal** — 用户要完成的那件事（自然语言 + 身份 + 所属主体）
3. **Execution** — 对某 Goal 的一次真实调用（能力、范围、输入摘要、输出引用、成败）
4. **Artifact** — 可打开、可版本化的结果

可选第五类，仅当跨主体时出现：

5. **Grant** — 这次允许对端看到/做到什么

不是永久对象的东西见 6.4。

## 6.2 各表面的定义

**对话是什么**  
人与 2digime 的语言通道。一句话可以是询问、补充「我」、纠正、下达 Goal、授权或闲聊。由 Intelligence 理解，而不是由入口决定。对话记录是投影，不是主体权威。

**做事是什么**  
一个尚未结束的 Goal 正在被推进：理解 →（如需）调用能力 → 验收 → 把结果挂回**同一个 Goal**。没有单独的「做事引擎」。没有「先选任务类型」。

**协作是什么**  
Goal 的对端不是本地工具，而是另一个 Subject 或外部 Agent。传输用 KEEP 的信封/Relay。授权用 Grant。产品面本阶段不扩建。

**数字之我页面是什么**  
Current Subject 的解释与控制：现在如何了解我、依据是什么、候选/冲突/已失效、我如何确认纠正删除限制外发。它不采集第二套档案。

**设置是什么**  
连接模型与能力、默认同意、高级传输、导出/迁移。设置失败不得冒充主体空白。无模型时必须诚实说不能开始，而不是假运行。

## 6.3 权威事实分别在哪里

| 事实 | 权威 | 禁止的假权威 |
|---|---|---|
| 姓名、经历、偏好、边界 | Subject | 页面、Prompt、材料检测、模型回答、任务文本 |
| 用户这句要做什么 | Intelligence 对本轮 Goal 的理解（可纠正） | intent enum、关键词 |
| 这件事有没有做完 | Goal 下的 Artifact / Execution 结果 | UI stage、Job 五态名称 |
| 有没有权改这个文件夹 | Grant / 本机授权记录 | 适配器自称 |
| 密钥 | Secret Store | 环境变量散落、日志 |
| 发给别人什么 | 实际发送的 Snapshot + 审计 | 协作 UI 文案 |

## 6.4 根本不应成为永久对象的东西

- 任务类型 / WorkIntent / expectedOutputFamily 作为路由键
- runtimePath（thin_v1 / legacy）
- capabilityLoop 相位
- 用户可见的 Job 状态机
- 句式分类器与「已出现问句」表
- 数字之我的「七模块」作为存储 schema（展示分组可以后算）
- material-index 检测字段
- CollabUserStatus 十二态
- 渲染层 optimistic 之外的业务状态
- 「为了测试需要」的第二 Store

会话草稿、编译后的上下文切片、搜索 evidence 可以是**运行态**，默认不升格为长期主体事实。

## 6.5 与 DIGITAL-SELF-CORE-01 的关系

吸收：唯一主体、证据与纠正、Compiler、敏感与同意、禁止双写、禁止句式补丁。  
冻结：按其 P1–P5 继续把旧对话/做事/协作主链迁过去。  
原因：那仍是在旧 Work Runtime 和旧枚举宇宙里插入新核，会把兼容层变成下一套绑架。新核按本章最少对象重建，旧包只读导入。

---

# 7. 复杂度压力测试

## 7.1 普通用户说「帮我做 X」，最短链路是什么？

```text
人说出 X
  → Intelligence 把 X 理解为一个 Goal（同一身份）
  → 向 Subject 编译与 X 有关的最小上下文
  → 判断：当前能力能否诚实完成
       ├ 能：调用恰好需要的 Model/Agent/Tool（可零次，若 2digime 自己能答/能做）
       └ 不能：诚实说明缺口，提出连接已有能力或交出外部方案；不写假文章
  → 结果写入该 Goal
  → 人看到结果或一个真正需要他决定的问题
```

没有：选场景、选任务类型、填规划表、进入 11 相发现状态机（除非人必须确认连接/授权）。

## 7.2 Agent 做完，结果怎么回到同一个用户目标？

每一次 Execution 创建时绑定 `goalId`。返回必须核对 `goalId`（以及界面世代，若有 UI）。对不上就只写入所属 Goal，**绝不**画到当前屏幕上的另一件事。Goal 是钉子，Job 不是。

## 7.3 需要问用户时为什么必须问？

只问四类：

1. **我是谁**的确认/纠正（高后果身份、冲突、敏感推断）
2. **授权**（写文件、外发、账号、付费、不可逆）
3. **采用**（结果是否成为「我认可的成果」或回流成长期认识）
4. **能力缺口**（不连接就无法诚实完成，且系统不能静默安装）

不问：内部选了哪个 adapter、要不要走 careful profile、规划文档是否优雅、测试是否喜欢这个枚举。没有新决策就没有新问题。

## 7.4 用户换任务为什么绝不串台？

因为用户换的是 Goal，不是「当前全局 Job」。每个 Goal 有自己的对话投影与 Execution 列表。Subject 共享（这正是代表我），工作上下文隔离。迟到结果按 `goalId` 归户。

## 7.5 换掉 Codex / Gemini / DeepSeek 后为什么架构不用改？

它们都在「Models / Agents / Skills / Tools」层，靠同一能力合同。Subject 与 Intelligence 不引用品牌。换执行器 = 换适配器注册，不换 Goal 语义。

## 7.6 新增一种任务是否需要新增 workflow / intent enum？

**不需要。** 这是本方案是否失败的试金石。若有人提出「做视频要先加 `intentKind: video`」，方案已经失败，必须回到 7.1。

## 7.7 删除 UI 后，底层主体与做事逻辑是否仍独立成立？

必须。Subject 与 Goal/Execution/Artifact 是领域。UI 只是投影。命令行或测试进程应能：记录一条认识、创建一个 Goal、调用一个能力、把 Artifact 挂回该 Goal。做不到说明 UI 又成了事实源。

## 7.8 本方案是否开始依赖状态表？

当前冻结对象只有 Subject / Goal / Execution / Artifact /（可选）Grant。若实现时重新引入 intent 表、phase 表、runtimePath，判定方案失败，强制简化。

---

# 8. 下一项最小开发任务

> **已被 01C / [`03-CURRENT-PLAN.md`](./03-CURRENT-PLAN.md) 覆盖。** 现行下一任务是 `2DIGIME-REFOUNDATION-02-DIGITAL-SELF`（Phase 1），不是本节的 Goal 闭环。Goal 闭环属于 Phase 2。以下原文仅保留为 01A 当时建议。

**不要做：** 修补现有做事页、进入 DIGITAL-SELF-CORE P1、实施 GENERAL-TASK-CLOSURE、扩建协作、提交当前工作树。

**要做：** `2DIGIME-REFOUNDATION-02` — **最短 Goal 闭环证明**（仍须另开任务，先经 Owner 接受本文）。

范围建议：

1. 在**新的薄运行时切片**（不是改 `job-runner` 上帝对象）实现：一句「帮我做 X」→ 同一 Goal → 必要时调用一个已连接能力 → 结果回到该 Goal。
2. 至少用两种截然不同的 X 验证第 7.6 条（例如：查已有资料里的一个事实 / 写一份短文），**第二次不得加枚举或新 workflow**。
3. 主体读取走唯一 Subject 合同（可先用 DIGITAL-SELF-CORE 不变量作内核，但生产旧链保持冻结，禁止双写）。
4. 验收必须打到**新的正式入口**（允许新壳；禁止把旧 `app.js` 内部态再焊进去）。
5. 证明换一个模型提供方不改领域对象。

成功标准：第 7 节七问都能用代码路径而不是用注释回答。  
失败标准：又出现 intentKind、capabilityLoop、thin_v1，或必须请 Owner 对比两轮 DOM。

---

# 9. Owner 仍需决策（最多 2 项）

宪法已冻结其余取舍。仅此两项无法从遗产单独裁定：

1. **本人事实写入门槛**  
   A. 低风险陈述可先成为候选，数字之我页随时纠正（更顺、更符合「持续逼近」）。  
   B. 任何本人事实都必须先问再写（更可控，但容易把 2digime 问成档案管理员）。  
   推荐 A，高后果/敏感/冲突仍必须问。

2. **第一刀用户入口**  
   A. 一个说话的地方同时承担问与做（终局更符合「同一主体」）。  
   B. 暂时保留「对话 / 做事」两个标签，但底层必须是同一 Subject + 同一 Goal 模型。  
   推荐：终局 A；第一刀允许 B 作为投影，**禁止**再做成两套运行时。

---

# 附录 A. 给 Owner 的七条汇报

1. **新产品一句话定义**  
   2digime 是你拥有的数字主体：它代表你、为你做事、在授权下协作，并在使用中长成更准确的你——不是聊天机器人，也不是工作流引擎。

2. **新架构一张图**  
   `Human → Digital Self/Subject → 2digime Intelligence → Models/Agents/Skills/Tools/Other Subjects → World`  
   对话/做事/协作/数字之我/设置只是投影。

3. **旧系统为什么失败（10 条）**  
   ①确定性逻辑覆盖 AI 判断 ②封闭 intent/能力枚举 ③句式与专项补丁 ④多套主体事实源 ⑤Task/Job 冒充用户对象并串台 ⑥UI 状态膨胀 ⑦内部状态赶人 ⑧测试冻住坏设计 ⑨专项绿、真人红 ⑩兼容层绑架 + 弱自研顶替专业 Agent，并把 Owner 当成调试器。

4. **值得保留**  
   Package 主权落盘、密钥、model-http、内容寻址 Artifact、摄取围栏、CapabilityAdapter 合同、隔离执行合同、Search connector、Relay/E2EE、Task/Job/Artifact 分离思想、Grant/最小披露、Digital Self 不变量。

5. **必须扔掉**  
   关键词路由与 WorkIntent 枚举、capabilityLoop 工作流、legacy/thin 双轨、GrowthEvent 多权威、material 检测当事实、app.js 上帝 UI、job-runner 作为新骨架、Bing HTML 战略搜索、句式测试合同、沿旧链继续的 DIGITAL-SELF P1–P5 与 GENERAL-TASK-CLOSURE 执行计划。

6. **下一项最小开发任务**  
   `2DIGIME-REFOUNDATION-02`：新薄切片上的最短 Goal 闭环；两种不同 X 不加新枚举；旧主链冻结。

7. **仍需 Owner 决策**  
   见第 9 节：事实写入门槛（推荐候选制）；第一刀入口（终局单通道，允许双标签投影、禁止双运行时）。

---

# 附录 B. DIGITAL-SELF-CORE-01 冻结声明

原状态 `p0_complete_awaiting_review` 终止。

新状态：`frozen / absorbed_into_refoundation`

吸收进本文的：产品定义、不变量、权威优先级、禁止双写、禁止句式补丁、Compiler 思想、characterization 所揭示的污染类型。

不再执行的：按其第 9 节进入 P1 生产存储并切换对话/做事/协作主链；在旧 Work Runtime 上继续打补丁直至「数字之我成立」。

未提交代码与测试保留在工作树，作为候选实现对照，不清理、不提交。
