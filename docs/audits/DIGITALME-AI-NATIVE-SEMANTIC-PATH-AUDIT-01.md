# DIGITALME-AI-NATIVE-SEMANTIC-PATH-AUDIT-01

> AI Native 语义路径审计。0 product code changes。不修测试、不加关键词、不改 Trial。
>
> 主开发基线：`build/subject-learning-availability-01` @ `eef1eb4fe6c52e72224ba26d0706fa46e6db110c`  
> Trial-04：`trial/user-value-trial-04` @ `844507c0b2ee1f7bdd718625b4f69b7dc1b00e80`  
> 真实走查：Electron UI → converse / conversation.reply → 规划 → 确认 → 执行。未改现有 evidence。
>
> 本 worktree 无根目录 `AGENTS.md`、无 `docs/design/personal-context.md`。产品原则以 `README.md` 与 `docs/architecture/README.md` 为准：Digital Me 是 Owner-controlled **control layer**，模型是能力，不是身份真值。

审计原则：规则用于安全、授权、数据主权、主体边界和必要执行合同；不得替代模型的自然语言理解。

---

## A. Executive Verdict

**T2 根因：** 做事链从未把「是否需要现实世界信息」交给模型做能力决策。规划模型已经在自然语言规划里写明「搜集真实来源」，但 `confirm_start` 的执行族合同只有 `modify_code | create_document | analyze_code`，没有 research/search。最终 `intentKind=create_document`，`selectForNeed` 选中通用文档模型。`decideSearchNeed` 只挂在对话页，不进入做事页。

**T4 根因：** 用户明确的长期写作偏好在模型蒸馏失败后，被合同启发式写成 `knowledge_gap_noted`（临时缺口）。该类型依法不能 confirm、不能注入。`SubjectContextPackage` 把它放进 `excludedEventIds`。下一轮周报模型看不到这条偏好。不是「没捕获」，是捕获后被错误系统类型永久降级。

**T5 根因：** 开放目标没有跨任务材料/成果召回。快照 `items=[]`，主体包为空。文档 prompt 在无材料时要求「仅依据目标撰写」。模型按空上下文写出通用模板。审查检查的是成果形式完成，不检查「是否使用了已有相关项目上下文」。

**是否有共同根因：有。**

当前架构把 **语义决定权** 放在 control layer 的窄合同（执行族枚举、合同蒸馏默认类型、仅当前 `contextRefs` 的快照）上；模型主要负责 **生成文本**（规划正文、成文、对话回复）。AI 的正确理解要么无法编码进执行合同（T2），要么失败后被启发式默认类型替换（T4），要么根本看不到可选用的上下文（T5）。

**是否存在「AI output 被 deterministic control 降级」的系统性问题：是。**  
不是偶发三个 bug，而是同一 ownership 边界：control layer 同时承担「约束 AI」和「替 AI 理解任务」。前者必要（安全/授权/真值），后者越权。

---

## B. 三条真实链路图

### B1. T2 — Research intent

真实输入（做事页，非对话页）：

> 调研 2026 年企业采用 AI Agent 辅助软件开发的实际收益与风险，给出带来源依据的摘要，不要编造链接。

任务 `task_mtaukoby68247931b832`，Job `job_mtaum11i4f90ab0ba8cc`，能力 `cap_model_openai_compatible`。Gemini search / baseline search 当时均为 `available`，未被调用。

| # | 节点 | 文件 / 函数 | 输入 | 输出 | authority |
|---|------|-------------|------|------|-----------|
| 1 | UI input | `electron/renderer/app.js` `submitWorkNaturalLanguage` | 用户原文 | `work.converse` | 用户 |
| 2 | 建任务（模型尚未看到目标） | `job-runner.ts` `createConversationTask` → `deriveWorkIntentSync` | 原文；无材料 | **`modify_code`**（命中「开发」） | **deterministic regex** |
| 3 | 第一轮模型 | `work-converse.ts` `CONVERSE_SYSTEM_PROMPT` + chat | 原始目标 | `intent=add_goal_info`；规划写「搜集权威数据与真实案例、严禁编造链接」 | AI 理解成立 |
| 4 | 低风险自动确认 | `app.js` `maybeAutoProgressLowRiskDocument` → 发送「确认」 | 无文件夹、非高风险 | 第二次 converse | deterministic UX |
| 5 | confirm_start 模型 | 同一 prompt：`executionIntentKind` 仅三值 | 规划已是调研 | 合法输出只能是 `create_document`↔`document` | **schema 压制 AI** |
| 6 | 校验 | `validateConfirmedPlanExecutionIntent` | 三值枚举 | `external_research` 直接非法 | deterministic |
| 7 | 执行 | `startConversationTaskExecution` → `submitTask` | `intentKind=create_document` | 覆盖任务上的 `modify_code` | renderer + job-runner |
| 8 | 能力选择 | `registry.ts` `selectForNeed` | `create_document` + family=document | 第一个 document 适配器 = 通用模型。search 仅在 `intent===external_research` 时进入 | deterministic |
| 9 | 执行/成文 | `prompt-assemble.ts` `assembleDocumentPrompt` | 空材料 | 模型作文；诚实写了无外部链接 | AI 生成，无搜索工具 |

**原始 AI 判断 vs 最终系统判断**

| | 内容 |
|--|------|
| AI（规划正文，source=model） | 这是调研；要真实来源；要交叉核实；不要编造链接 |
| 系统最终 | `intentKind=create_document`，`capabilityId=cap_model_openai_compatible`，`professional_attempt_outcome=not_attempted` |

**第一个语义失真点：**  
`work-converse.ts` 的 confirm_start 执行族合同（`CONFIRMED_PLAN_EXECUTION_KINDS`）不能表达 research/search。模型已经在 `planUpdate` 里正确理解，但该理解不能成为能力选择输入。

更早的抢先误判：`deriveWorkIntentSync` 把「软件开发」收成 `modify_code`。该误判被步骤 5 覆盖，不是最终产品结果，但证明做事链在模型开口前就用 regex 占了 intent 位。

`decideSearchNeed`（`conversation-search.ts`）在本链 **零调用**。它只服务 `electron/main.cjs` `shell:conversationReply`。

---

### B2. T4 — Subject preference

第一步（对话页）：

> 以后给我的周报先写结论，再展开依据。

证据：`conversation.ndjson` turn `turn_mtauupy9_yw59op`；`growth_capture_status=ok_learned`；事件 `gevt_mtauwabu6e19a629dd3b`，`type=knowledge_gap_noted`，`distill:contract_fallback`，`model_reason:contract:knowledge_gap_noted`。对话回复失败（「暂时无法回复」），捕获仍异步完成。

第二步（做事页，不重复偏好）：

> 和上次一样写一份周报。

任务 `task_mtauw5o4b7e809cf9785`。Freeze：`selectedEventIds=[]`，该事件在 `excludedEventIds`。成文是标准周报框架，结论不先行。`confirmedExperienceCount=0`。

| # | 节点 | 文件 / 函数 | 输入 | 输出 | authority |
|---|------|-------------|------|------|-----------|
| 1 | UI | `app.js` → `conversation.reply` | 原文 | `shell:conversationReply` | 用户 |
| 2 | 对话模型（回复） | `main.cjs`：`runClosureSearch` / `chatComplete` | 原文 | **回复失败**；无助手正文 | 模型调用失败（RELIABILITY） |
| 3 | 捕获调度 | `scheduleConversationGrowthCapture` | 仅 userText | `subject.captureInput` sourceKind=conversation | 异步、不阻塞回复 |
| 4 | 模型蒸馏 | `structured-distill.ts` `modelDistillProposals` | 原文 800 字内；prompt 含「不得把一次性要求写成长期偏好」 | 本轮无可用提案（空/非合同/质量门丢弃）。无原始 JSON 落盘 | AI 未成为类型 authority |
| 5 | 合同回退 | `contractDistillProposals` → `distillCandidatesFromText` | 同句 | 启发式要求「先给结论\|结论先行」；用户写的是「先写结论」→ **零命中** → 对话空结果默认 `knowledge_gap_noted` | **keyword default 成为类型真值** |
| 6 | 事件合同 | `growth-event.ts` | knowledge_gap | **禁止 confirm 进权威注入** | 必要 enforcement（类型一旦错就单向死） |
| 7 | derive-all | `knowledge-gaps.json` | 该事件 | 进入缺口视图，不进 preferences | deterministic |
| 8 | 上下文包 | `selectSubjectInjection`：「knowledge_gap / candidate / inactive 永不注入」 | freeze | `excludedEventIds` 含该 id | deterministic |
| 9 | 第二任务 | `assembleDocumentPrompt` | 空 experiences；空材料 | 通用周报；自称无业务记录 | AI 未见偏好 |

只读复现（不改产品代码）：

- 原文「先写结论」→ `knowledge_gap_noted` / `temporary_context`
- 仅把「先写结论」换成「结论先行」→ `preference_observed` /「偏好：结论先行」

**原始 AI 判断 vs 最终系统判断**

| | 内容 |
|--|------|
| 对话模型 | 无成功回复，无法取原始语义判断 |
| 蒸馏模型 | 调用了，但未留下可审提案；标签证明走了 contract_fallback |
| 合同启发式 | 当作「还不确定：需要更多了解」 |
| 系统最终 | 临时缺口，排除出 SubjectContextPackage |

**第一个语义失真点：**  
`structuredDistillToEvents` 在模型蒸馏无可用提案时，把 `distillCandidatesFromText` 的默认 `knowledge_gap_noted` 写成系统事实。语义从「可能未解析」变成「这是临时缺口」。不是确认层的问题——确认层正确地拒绝注入 knowledge_gap。

不要用再加「以后/先写」关键词来修。那只会继续让启发式当语义权威。

---

### B3. T5 — Open goal / context

真实输入（做事页，未添加文件夹）：

> 帮我把这个项目下一阶段推进方案整理出来。

任务 `task_mtauwxrf46bca7c07d51`。同一 subject 上当时已有：T1 `product-notes.md` 与成文、T2 调研成文、T3 `mini-n` 代码项目、T4 周报。快照 `snap_mtaux94y2851981a7cae`：`items=[]`，主体 freeze 与 T4 周报相同（空 selected，排除两条 gap）。

| # | 节点 | 文件 / 函数 | 输入 | 输出 | authority |
|---|------|-------------|------|------|-----------|
| 1 | UI | `work.converse` | 只给最终目标；无 contextRefs | 新任务 | 用户 |
| 2 | intent | `deriveWorkIntentSync` | 「方案」命中 WRITE_DOC | `create_document` | deterministic |
| 3 | 规划模型 | `work-converse.ts` | 无材料 brief；无主体事实 | 泛化推进方案；边界「暂不改代码」 | AI 在空上下文中规划 |
| 4 | 候选召回 | 无跨任务 artifact/material discovery | 本任务 `contextRefs=[]` | **候选集为空** | 装配范围由确定性定义 |
| 5 | 选择 / 注入 | `selectSubjectContext` + snapshot builder | 无 confirmed；无当前材料 | selected=[] | 选择器无物可选 |
| 6 | prompt | `prompt-assemble.ts` | 「本次未提供可用材料,请仅依据目标撰写」 | 通用模板成文 | default prompt 许可空转 |
| 7 | review | `generic-cto-review.ts` `collectGenericCtoEvidence` | goal + 正文 + 空 materials | 形式完成 / 可采用信号 | 不检查「是否用了已有项目上下文」 |

分类：**context 没有被找到**（发现层从未把 T1 材料、T3 项目、既有成果列为候选）。不是选了没注入，也不是注入后被 prompt 删掉。模型没有机会「看到却不用」。

「这个项目」在用户语义上指向当前工作语境；系统把项目范围严格限制为 **本任务已授权 contextRefs**（`digitalme-runtime.ts` 注释：不得用主体库全部资料污染无关任务）。该约束保护数据边界，但也切断了开放目标所需的相关上下文发现。两者被绑在同一条规则上。

---

## C. Decision Ownership Table

| Decision | AI judgment | deterministic judgment | final authority | override happened? |
| -------- | ----------- | ---------------------- | --------------- | ------------------ |
| research need | 规划正文：要真实来源、交叉核实。做事链 **没有** `decideSearchNeed` | 执行族无 research；search 选择绑定 `external_research` | deterministic 执行族 + registry | **是**：AI 规划被 create_document 覆盖 |
| work intent | 规划理解为调研报告 | 建任务时 regex「开发」→ modify_code；确认时三值枚举 → create_document | confirm_start 枚举覆盖 regex | **是**（两次，方向不同） |
| capability need | 无独立「需要 search」模型输出进入选择器 | `selectForNeed(create_document)` → 通用模型 | registry | 搜索能力存在但不可达 |
| subject semantic type | 蒸馏模型本轮无可用提案 | 空命中默认 knowledge_gap_noted；「先写结论」≠ 合同词表「先给结论/结论先行」 | contract fallback | **是**：缺省类型变成系统事实 |
| preference persistence | 若类型正确，低风险偏好可 silent_adopt | knowledge_gap 禁止 confirm | growth-event 类型门 | 类型错则永不能持久为偏好 |
| context relevance | 未对历史材料/成果做相关性判断 | 只注入 confirmed + 本任务 contextRefs；gap/candidate 永不注入 | selectSubjectInjection + snapshot | T5：发现层未启动，选择器无候选 |
| execution/review | 成文模型按所给上下文写 | review 看目标/规划/正文/材料证据，不看「是否漏用已有项目」 | generic CTO review | T2/T5 形式完成掩盖语义错配 |

---

## D. Root Cause Classification

| 样例 | 类型 | 说明 |
|------|------|------|
| T2 | AI output overridden | 规划模型已理解调研；执行族 schema 不能编码该理解 |
| T2 | AI capability not invoked | `decideSearchNeed` / professional search 不在做事链 |
| T2 | deterministic default took precedence | 无 research 值时默认 document 能力 |
| T4 | wrong schema mapping | 模型蒸馏失败 → 合同默认 knowledge_gap；近义说法未映射为 preference |
| T4 | AI capability not invoked（回复） | 对话回复失败；捕获仍用无助手上下文的原文 |
| T5 | wrong context assembly | 无跨任务召回；空快照 +「仅依据目标撰写」 |
| T5 | execution/review mismatch | 审查不检验「开放目标是否用了已有相关上下文」 |

---

## E. Necessary vs Suppressive Rules

### A. 必须保留的 deterministic enforcement

- 文件/命令写范围与 Owner 确认（`requiresExecutionConfirm`、规划版本门）
- 密钥与授权不进用户面
- 外部搜索结果不得自动写成 Owner 事实
- `knowledge_gap_noted` 不得 confirm 进权威注入（防止把不确定写成身份）
- 不可逆/高风险动作不自动推进（`looksHighRiskGoal`）
- 不得虚假声称已改文件、已联网、已完整阅读未读材料
- 主体归属：外部能力结果不自动成为本人事实

这些是安全/主权/真值，不是语义理解。

### B. 可以保留但不应拥有语义最终决定权

- 能力 **availability** 检查（有没有 search / AtomCode）
- search empty/timeout → baseline 的 **执行失败回退**（已有单测；本轮 UI 未打到）
- schema **normalization**（近义字段映射到既有合同）——只应在模型已给出语义之后规范化，不得在模型缺席时发明类型
- result validation / CTO review
- 无材料时禁止编造具体事实（诚实失败）——但不应改写成「请用通用模板交差」

### C. 已经压制 AI 能力的历史逻辑（有执行证据）

- `deriveWorkIntentSync` 关键词表把「软件开发」收成修改代码（T2）
- `CONFIRMED_PLAN_EXECUTION_KINDS` 三值枚举 **没有** `external_research`，且 prompt 写死「只出报告 → create_document」（T2）
- 做事链不调用 `decideSearchNeed`；对话链才调用（同一用户目标，两条语义世界）
- `selectForNeed` 仅当 `intent===external_research` 才选 search
- 合同蒸馏用关键词对「先给结论/结论先行」；漏「先写结论」后默认 `knowledge_gap_noted`（T4）
- `modelDistill` 失败时 contract fallback **仍写事件**，把缺省类型当系统事实（T4）
- 快照只含本任务 contextRefs，无「相关历史成果/材料」候选（T5）
- 文档 prompt：无材料则「仅依据目标撰写」（T5 通用模板的许可证）
- 低风险文档自动发送「确认」，把三值枚举变成实际路由器（T2/T5）

---

## F. Unified Fix Feasibility

**建议进入 `DIGITALME-AI-NATIVE-SEMANTIC-CONTROL-01`。**

满足统一修复的三个条件：

1. **共同根因明确：** control layer 用窄枚举/启发式/空默认拥有语义终裁；模型只填文本。T2/T4/T5 是同一边界的三个表现（能力语义、主体类型、上下文集合）。
2. **修复本质是恢复 AI 语义 authority，不是加 case：**  
   - 做事链在能力选择前，让模型判断「是否需要现实世界信息 / 何种执行族」，执行合同必须能表达 research，而不是把报告默认成 document。  
   - 蒸馏：模型对类型的判断在质量门之后仍应保留；模型失败时不得用 knowledge_gap 冒充语义结论（可记「未解析」，不得写成缺口事实）。  
   - 开放目标：在数据主权边界内，让模型从 **候选**（当前任务材料、近期相关成果、已确认偏好）里选相关性，而不是只把空集合交给生成模型。
3. **deterministic enforcement 继续负责：** 写文件确认、密钥、外部事实不进身份、knowledge_gap 不能偷偷变成 confirmed 身份、不得假完成。

**不要做：** 给「调研」「先写结论」「这个项目」加关键词；第二套 router；新 Store/schema 分类体系；针对 T2/T4/T5 的 prompt 特判。

**预计涉及模块（实施阶段，本轮不动代码）：**

- `work-converse.ts` 执行族合同与 prompt（让 research 成为可表达的瞬时判断）
- `job-runner.ts` / `registry.ts`：intent → search 选择跟模型判断对齐
- `structured-distill.ts` + `candidate-distill.ts`：失败语义 ≠ knowledge_gap 真值
- 上下文装配：候选发现与选择分离；主权过滤留在确定性层
- `generic-cto-review.ts`：审查「是否使用了已提供/应召回的相关上下文」

**最小验证（实施后，仍走真实 Electron UI）：**

1. 做事页重放 T2 原句 → 必须出现 professional 或 baseline search 的真实调用（或诚实失败+fallback），不得只靠文档模型。
2. 对话页重放 T4 原句（含「先写结论」近义，不要求特定词）→ 事件类型为可注入的偏好/工作方法，下一轮「和上次一样写周报」freeze 含该条且成文结论先行。
3. 做事页重放 T5 原句（不手动贴材料）→ 成文能指认本会话已有项目/材料，或明确询问「你指哪个项目」，不得交通用软件项目模板还标 succeeded。

本轮 **不实施**。

---

## 证据索引（只读，未修改）

- Trial 报告：`docs/trials/DIGITALME-REAL-USER-VALUE-TRIAL-04.md`
- 走查：`build/evidence/real-user-value-trial-04/`
- 运行时 userData：`C:\Users\46554\AppData\Local\Temp\dmv2-trial04-ud-9PqprE`
  - T2 task/job/snapshot、T4 conversation.ndjson + `gevt_mtauwabu6e19a629dd3b`、T4/T5 freeze 文本哈希 `b198851edb55fb4833e3c66897feb6b13867aa604d39b0908918d76305acd0d2`
- 只读诊断：对 Trial 原句调用 `dist/` 中 `deriveWorkIntentSync` / `distillCandidatesFromText`（不入库）
