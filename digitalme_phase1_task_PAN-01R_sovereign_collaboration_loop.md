# PAN-01R 任务包：Digital Me 主权协作闭环

版本：v0.1.0
日期：2026-07-19
状态：`specified` / `owner_approved` / `frozen_for_implementation`
所属总任务：`P1-PANORAMA：Digital Me 产品全貌 Alpha`
前置任务：PAN-01 `statically_verified` / `owner_product_perception_failed` / `retained_as_scaffold`（不标 accepted；不回滚）
建议代码基线：`a40c5f8`（分支 `codex/pan-01-product-panorama-home`）
规划基线：本文件冻结提交记为 `PAN01R_SPEC_BASE`
实现分支（规格提交后创建）：`codex/pan-01r-sovereign-collaboration-loop`
代码 Owner：Cursor
任务类型：Product Panorama Alpha / 主权协作纵向产品证据链

> **状态语义（强制）**
>
> - 本文档初始状态中的 `owner_approved` **仅**表示 Owner 已批准规格并授权启动实现；
> - **不**表示实现结果 `accepted`；
> - 实现完成后，Cursor **只能**将工程状态更新为 `statically_verified`；
> - `runtime_verified` / `accepted` 必须等待 Codex 复核与 Owner 主路径验收。

---

## 0. 本任务结论

### 0.1 战略裁定

PAN-01 **不回滚**，保留为可信只读全貌 scaffold，但不 `accepted`。统一记录为：

```text
engineering: statically_verified
owner: product_perception_failed
disposition: retained_as_scaffold
accepted: no
```

Owner 产品感知验收结论（摘要）：

1. Digital Me 看起来只是「意图理解我、未来可能代表我」的软件；
2. 「属于我」目前只是屏幕文字，没有形成所有权感知；
3. 可以编辑内容不等于真正的控制；
4. 当前能力看起来与普通 AI 相似；
5. 对未来如何协作没有实际感知。

**根因裁定**：PAN-01 展示并解释了承诺，但没有用一条真实体验证明承诺。

### 0.2 PAN-01R 要做什么

PAN-01R **不**继续打磨 PAN-01 的卡片、间距和抽象文案，而是建立一条纵向产品证据链：

```text
我的主体依据
× 我的能力
× 我的授权
× 代表我协作
× 结果归我处置
```

### 0.3 PAN-01R 完成前的调度冻结

| 项 | 状态 |
|---|---|
| PAN-02 | `paused_until_PAN-01R_acceptance` |
| PAN-03 | `paused_until_PAN-01R_acceptance` |
| PAN-04 | `paused_until_PAN-01R_acceptance` |
| PAN-01 非阻断 UI 细节 | 进入 backlog |
| **唯一下一实现任务** | **PAN-01R** |

---

## 1. 用户结果

### 1.1 一句话结果

用户亲自经历一次受控协作后，能够明确说出：

- Digital Me 依据什么理解我；
- 哪些是事实、本人确认、系统推断或发展线索；
- 它使用了我的哪些能力；
- 哪些内容经过了我的明确授权；
- 它为什么与通用 AI 的结果不同；
- 哪些边界实际影响了结果；
- 协作对象和推理服务分别获得了什么；
- 结果是否被采纳、保存或拒绝；
- 本次过程在哪里留下了记录。

### 1.2 首个场景（冻结）

**受控研究协作，本地流程模拟。**

固定性质：

- 协作请求方是本地主进程生成的「本地模拟研究伙伴」；
- 不连接真实外部伙伴；
- 不进行公网协作；
- 不发送结果给模拟伙伴；
- 不涉及 MCP、合同、支付、结算或 Digital Org；
- 智能推理可以调用用户已配置的模型服务；
- 如果模型服务是云端，授权预览必须明确说明选中的任务及主体上下文会发送给该推理服务商；
- 「本地模拟」只表示协作关系和流程在本机模拟，**不得**暗示云模型推理也一定发生在本机。

用户面状态：本体验标为 **本地模拟**（协作关系）；若使用云端模型，须同时披露推理数据去向。

### 1.3 体验入口

在「我 → 数字之我 → 全貌」首屏加入主要 CTA：

> 体验一次 Digital Me 如何代表我

要求：

- 侧栏点击「我」进入全貌时回到首屏；
- 不因历史滚动位置让核心入口不可见；
- 四承诺与成长路线保留为辅助地图；
- 不再让它们承担主要产品证明职责。

---

## 2. 冻结的五步体验

### 步骤 1：它如何理解我

显示本次可用的 3～6 条主体依据。

每条至少包含：

| 字段 | 要求 |
|---|---|
| id | main 生成的稳定 ID |
| shortText | 用户面短文本 |
| kind | 用户面类型（见下） |
| sourceLabel | 来源标签 |
| ownerConfirmed | 是否本人确认 |
| selectedByDefault | 默认是否选中 |
| usableInExperience | 是否可用于本次体验 |

用户面类型至少严格区分：

| kind（内部） | 用户面文案 |
|---|---|
| `verified_fact` | 已核实事实 |
| `owner_assertion` | 本人确认 |
| `inference` | 系统推断 |
| `direction_clue` | 发展线索 |
| `current_state` | 当前状态 |
| `boundary` | 系统/本人边界 |

默认选择规则：

- 已核实事实：可默认选中；
- 本人确认：可默认选中；
- 系统推断：默认不选中；
- 发展线索：默认不选中；
- 当前状态：只有与任务直接相关时才可默认选中；
- 边界不是「共享内容」，而是本次执行必须遵守的约束，**单独显示**；
- 不得把 inference 或 direction clue 冒充本人事实。

部分 Package 分层损坏时：

- 只使用严格读取成功的分层；
- 显示「部分主体资料无法读取」；
- 不静默重置损坏内容；
- 不从损坏内容生成摘要；
- 不把体验显示为完整健康。

没有足够主体依据时：

- 可以展示明确标注的「通用预览」；
- 不得宣称已经生成个性化 Digital Me 结果；
- 给出返回构建或查看资料状态的真实入口；
- 该路径不能通过 Owner 独特性感知验收。

### 步骤 2：收到协作请求

由主进程生成：

- `requestId`
- 请求方（本地模拟研究伙伴）
- 任务模板
- 允许使用的能力
- 可选主体依据 ID
- 结果去向
- 创建时间和过期时间

首个任务采用受控研究判断场景。

允许用户输入或选择一个研究主题，但：

- renderer 只提交有限长度的主题文本或主进程给出的模板 ID；
- 主进程做类型、长度、字符和空值校验；
- 不允许 renderer 注入 system prompt、能力、请求方、数据类别或结果状态。

推荐任务文案：

> 围绕选定主题，形成一份简短的研究判断框架，说明核心判断、依据、不确定性和下一步研究问题。

第一版不要求联网检索，不把模型常识冒充最新事实。

### 步骤 3：由我授权

授权预览必须显示：

1. 谁提出请求；
2. 要做什么；
3. 使用什么能力；
4. 使用哪些我的内容；
5. 授权多久；
6. 结果到哪里；
7. 使用哪个推理环境或模型服务；
8. 是否会发送给协作对象。

用户必须能：

- 取消任一可选主体依据；
- 缩小范围；
- 拒绝请求；
- 仅授权本次；
- 确认后执行；
- 执行中停止；
- 执行后查看记录。

固定授权规则：

- 只支持单次授权；
- authorization token 由主进程生成；
- 有短时有效期；
- 绑定 `requestId`、sender、选择后的 evidence IDs、能力和任务摘要；
- 只能消费一次；
- 过期、重复使用、sender 不一致、范围不一致均 fail-closed；
- renderer 传入的正文、类型、状态、能力定义、授权结论一律忽略或拒绝；
- 未明确确认不得执行；
- 取消不得执行；
- 拒绝不得调用模型。

### 步骤 4：Digital Me 代表我行动

必须运行两个彼此隔离的生成过程：

**A. 通用 AI 结果**

- 只获得任务；
- 不获得主体依据；
- 不获得用户风格、判断框架或个人内容；
- 只使用安全的通用系统约束。

**B. Digital Me 结果**

- 只获得本次明确授权的主体依据；
- 获得本次强制生效的边界；
- 不获得未授权内容；
- 不读取 renderer 提交的主体正文；
- 所有上下文由主进程按授权 ID 重新解析；
- 输入长度必须有明确上限。

两次调用必须逻辑隔离，不能在同一次 prompt 中先把主体内容提供给模型，再要求模型假装生成「通用结果」。

如果可以安全并行则允许并行，否则顺序执行。

运行中显示：

- 当前阶段；
- 使用的能力；
- 已授权依据数量；
- 当前推理环境；
- 停止按钮。

停止要求：

- 使用真实取消机制；
- 主进程维护 `runId` 和 sender 绑定；
- 取消后忽略迟到结果；
- 不得在取消后标完成；
- 不得允许取消后的结果被采纳；
- 审计记录固定取消状态；
- 如果底层模型调用目前无法真正中止，不得显示虚假的「已停止」；应先补足可验证取消路径，或将按钮表达为「放弃本次结果」，并保证迟到结果被丢弃。

模型未配置或不可用时：

- 明确显示「智能引擎未连接/不可用」；
- 提供真实设置入口；
- 不生成假结果；
- 不标成功。

### 步骤 5：看见差异并处置结果

结果页同时显示：

- 通用 AI 结果；
- 我的 Digital Me 结果；
- 本次授权依据；
- Digital Me 结果使用的依据引用；
- 实际生效的边界；
- 未使用或被排除的内容；
- 推理服务去向；
- 「未发送给模拟协作伙伴」。

Digital Me 结果中的依据引用：

- 使用 main 分配的短引用 ID，例如 E1/E2；
- 模型只能引用已授权 ID；
- 主进程过滤或拒绝未知引用；
- UI 使用「引用依据」或「生成时使用的依据」，不要宣称已经证明严格因果关系。

用户可以：

- 采纳为我的本地成果；
- 拒绝本次结果；
- 查看过程记录。

采纳规则：

- 优先复用现有 outputs/library 安全写入路径；
- 保存 Digital Me 结果、任务摘要、时间、所用 evidence ID、能力 ID 和审计关联 ID；
- 不保存密钥、绝对路径或未授权主体正文；
- 不自动写回主体 Package；
- 不声称 Digital Me 已自动学习；
- 成功后显示「已保存为你的本地成果」。

拒绝规则：

- 结果正文不进入成果库；
- 可记录固定拒绝原因类别；
- 审计只记录摘要或 digest；
- 不记录完整主体正文和完整输出。

---

## 3. 「属于我」和「由我控制」的产品证据

### 3.1 「属于我」不得仅由文案证明

必须让用户看到：

- 主体依据来自自己的本机 Package；
- 使用哪些依据由本人选择；
- 未选择内容不进入本次个性化执行；
- 授权只对本次有效；
- 结果不会自动发给协作对象；
- 结果是否保留由本人决定；
- 采纳结果进入本人的本地成果库；
- 本次行为留下本人可查看的记录。

### 3.2 「由我控制」不得等同于可以编辑内容

至少由这些真实动作证明：

- 预览；
- 缩小范围；
- 拒绝；
- 明确确认；
- 单次授权；
- 取消或放弃迟到结果；
- 采纳；
- 拒绝结果；
- 查看记录。

---

## 4. 主进程与安全边界

### 4.1 建议模块目录

```text
digitalme-app/src/panorama-experience/
├── subject-brief.js
├── request.js
├── authorization.js
├── execute.js
├── receipt.js
└── index.js
```

名称可按现有结构微调，但职责不得合并进会写入 Package 的路径。

### 4.2 硬性要求

1. subject brief 必须是严格只读、限量、脱敏、fail-closed 的主进程视图；
2. 不直接复用会创建 scaffold 或产生写入副作用的 `package:load`；
3. 不修改 `digital-me-package/**`；
4. 不新增主体写入；
5. 不读取或返回 SecretStore 密钥；
6. 不返回绝对路径；
7. 不向 renderer 返回 Package 正文；
8. renderer 只获得本次体验所需的短文本和安全元数据；
9. 主进程自行推导 evidence kind、能力、状态和数据去向；
10. 所有 IPC 做 sender 校验、payload allowlist、长度限制和未知字段处理；
11. renderer 不得决定成熟度、执行成功、授权成功、审计成功或采纳成功；
12. 所有成功 UI 必须绑定真实主进程结果；
13. 失败、取消、超时和迟到结果不得显示成功；
14. 不新增真实外部网络协作；
15. 模型服务调用沿用现有安全配置，不把 provider credential 传给 renderer。

### 4.3 IPC 契约（名称可由实现决定）

必须覆盖：

| 能力 | 说明 |
|---|---|
| 获取安全主体依据 | 只读 brief；无 Package 正文泄漏 |
| 创建本地模拟请求 | 主进程生成 request |
| 生成授权预览 | 六要素 + 推理去向 + 是否发送协作对象 |
| 明确确认并执行 | 消费单次 token；隔离双生成 |
| 取消/放弃运行 | 真实取消或可验证放弃；丢弃迟到结果 |
| 采纳结果 | 只接受主进程保存的成功运行结果 |
| 拒绝结果 | 不写成果正文 |
| 读取本次安全记录摘要 | 脱敏；无密钥/绝对路径/完整正文 |

---

## 5. 审计要求

优先复用现有 DecisionAudit，但不得夸大为密码学不可否认证明。

至少记录固定事件：

- `collaboration_request_created`
- `collaboration_request_rejected`
- `authorization_granted`
- `execution_started`
- `execution_cancelled`
- `execution_completed`
- `execution_failed`
- `result_adopted`
- `result_rejected`

审计要求：

- 记录 `requestId` / `runId` / `decisionId` 的安全关联；
- 记录 actor、purpose、action、dataScopes、destination、approval、outcome；
- 主体内容和输出正文只记录 digest；
- 不记录 API key；
- 不记录绝对路径；
- 不把底层异常 message 原样输出到公开日志；
- 授权或执行开始前无法写入必要审计时 fail-closed；
- 执行完成审计失败时，不得把结果标为可采纳的已完成成果；
- adopt 必须只接受主进程保存的成功运行结果，不能接受 renderer 注入的 result body。

---

## 6. PAN-01 首页最小调整

只做支持闭环所需的最小调整：

1. 首屏增加主要 CTA：「体验一次 Digital Me 如何代表我」；
2. 首屏优先显示：一条具体的主体理解、一条当前生效边界、一项真实可运行能力、进入闭环的 CTA；
3. 四承诺和成长路线保留，但降为辅助信息；
4. 修复用户口径冲突：
   - 侧栏「能力：暂无」
   - 全貌页「可用 1 项、实验 6 项」
   - 必须使用同一主进程口径或明确区分「已装载能力」与「可体验能力」；
   - 不得继续显示互相矛盾的总量结论；
5. 从侧栏点击「我」进入全貌时：页面回到首屏；CTA 可见；不破坏构建和审阅深链；不影响 PAN-01 既有 fail-closed 降级。

禁止借本任务全面重做 PAN-01 视觉系统。

---

## 7. 明确非范围

不得实现：

- PAN-02 完整控制权面板；
- PAN-03 完整能力市场或安装体系；
- PAN-04 真实外部协作运行时；
- MCP；
- ToolBroker 全面迁移；
- 真实外部 Agent/伙伴接入；
- 公网协作；
- 合同；
- 支付与结算；
- Digital Org；
- Package 导出/跨端迁移；
- 主体自动学习；
- 结果自动写回 Package；
- 认知页零散编辑迁移；
- Life 读取重构；
- `package:load` scaffold 重构；
- P1-07 已冻结缺口修复；
- 修改 `digital-me-package/**`；
- 为通过测试覆盖或恢复 Owner 真实资料。

---

## 8. 测试要求

### 8.1 hermetic：`test:pan-01r`

至少覆盖：

1. 主体依据严格分类；
2. fact / owner_assertion 默认选择规则；
3. inference / direction clue 默认不选择；
4. 部分损坏只使用可安全读取分层；
5. 损坏内容不静默重置；
6. 无足够依据不冒充个性化成功；
7. renderer 不能注入 evidence kind；
8. renderer 不能注入主体正文；
9. renderer 不能注入能力、请求方和结果；
10. 未知 evidence ID fail-closed；
11. 授权范围由最终选择生成；
12. token 过期拒绝；
13. token 重复使用拒绝；
14. sender 不一致拒绝；
15. 取消确认不调用模型；
16. 拒绝请求不调用模型；
17. 通用调用不包含主体依据；
18. Digital Me 调用只包含已授权依据；
19. 未授权依据不会进入 prompt；
20. 通用与个性化调用逻辑隔离；
21. 云模型数据去向被明确返回；
22. 未配置模型不生成假结果；
23. 取消或放弃后迟到结果被丢弃；
24. 取消后结果不可采纳；
25. 模型失败不显示完成；
26. 未知引用被过滤或拒绝；
27. audit 前置失败时不执行；
28. 完成审计失败时结果不可采纳；
29. adopt 不接受 renderer 注入正文；
30. adopt 成功进入 hermetic 成果库；
31. reject 不写成果正文；
32. 不写主体 Package；
33. 不泄漏密钥；
34. 不泄漏绝对路径；
35. request/token/run 绑定正确；
36. before/after fixture Package 字节一致。

### 8.2 Electron harness：`test:pan-01r-owner-runtime`

至少覆盖：

A. 侧栏进入「我」后首屏 CTA 可见；
B. 点击 CTA 进入步骤 1；
C. 可看见具体依据及其类型；
D. inference 默认未选择；
E. 进入协作请求；
F. 授权页显示请求方、能力、数据、期限、结果去向和推理服务；
G. 取消授权不执行；
H. 重新进入并缩小范围；
I. 确认后真实进入运行态；
J. 通用结果与 Digital Me 结果同时呈现；
K. Digital Me 结果显示已授权依据引用；
L. 结果明确显示未发送给模拟伙伴；
M. 拒绝结果不进入成果库；
N. 重新执行并采纳后进入 hermetic 本地成果库；
O. 可查看安全记录摘要；
P. 非法/迟到结果不触发成功 UI；
Q. 侧栏与全貌能力口径不矛盾。

Electron 测试使用：

- hermetic Package fixture；
- 注入的模型 stub；
- 注入的审计/成果目录；
- 不调用真实模型；
- 不触碰 Owner 真实 Package；
- 测试成功、失败、取消和迟到返回。

### 8.3 回归

至少执行：

- `npm run test:pan-01r`
- `npm run test:pan-01r-owner-runtime`
- `npm run test:pan-01`
- `npm run test:pan-01-owner-runtime`
- `npm run test:p1-03`
- `npm run test:p1-07-owner-runtime`
- `npm run test:p1-phase1`
- `npm run test:owner-runtime`
- 对所有修改 JS/CJS 执行 `node --check`
- `git diff --check`

不得默认执行 `test:p1-baseline-real`。
不得为测试恢复或覆盖真实 Package。

---

## 9. Owner 验收主路径（实现后；本任务包冻结时仅定义）

1. 从侧栏点「我」，首屏可见 CTA「体验一次 Digital Me 如何代表我」；
2. 进入步骤 1，看见具体依据与类型；推理类默认未选；
3. 进入本地模拟协作请求；
4. 授权页看见请求方、能力、数据、期限、结果去向、推理服务、是否发送协作对象；
5. 缩小范围后确认；
6. 看见通用结果与 Digital Me 结果对照；
7. Digital Me 结果引用已授权依据；标明未发送给模拟伙伴；
8. 若使用云模型，能说明推理服务去向；
9. 拒绝一次，确认成果库无正文；
10. 再跑通一次并采纳，确认进入本地成果库；
11. 可查看过程记录；
12. 取消或放弃路径不得显示成功。

验收通过前不得标 `accepted`，不得启动 PAN-02。

---

## 10. 完成定义

全部满足才可提交实现复核：

1. 五步体验可走通（本地模拟协作关系）；
2. 主体依据分类与默认选择符合冻结规则；
3. 授权 token 单次、短时、绑定完整，fail-closed；
4. 通用与 Digital Me 双生成逻辑隔离；
5. 云模型数据去向已披露；本地模拟未冒充公网协作；
6. 取消/迟到/审计失败不得成功或可采纳；
7. adopt/reject 真实生效且不写 Package；
8. PAN-01 首页仅做最小 CTA/口径/回顶调整；
9. `test:pan-01r` 与 `test:pan-01r-owner-runtime` 通过；
10. 规定回归通过；`git diff --check` 通过；
11. 未触碰 `digital-me-package/**`；
12. 工程状态仅为 `statically_verified`（**不得**标 `accepted` / `runtime_verified`）。

---

## 11. 开发节奏与 Loop 边界

允许使用有界 Loop，最多 3 轮，仅用于：

1. 实现；
2. 运行上述测试；
3. 根据失败修复；
4. 重跑相关测试；
5. 检查是否满足冻结规格。

Loop 不得用于：扩大产品范围；自动开始 PAN-02；引入真实外部协作；修改真实 Package；绕过失败测试；降低 fail-closed；将本地模拟改称真实协作。

若 3 轮后仍存在阻断：停止；保留安全状态；不伪造通过；报告精确阻断和最小下一步。

---

## 12. 分支与提交建议

1. 规格提交（本文件及关联文档）：
   - `docs(plan): freeze PAN-01R sovereign collaboration loop`
   - 完整 hash 记为 `PAN01R_SPEC_BASE`
   - 不得 squash 到 `a40c5f8`，不得 amend
2. 从 `PAN01R_SPEC_BASE` 创建实现分支：
   - `codex/pan-01r-sovereign-collaboration-loop`
3. 实现提交：
   - `feat(panorama): add sovereign collaboration experience`
4. 若实现后必须修复：新建 `fix` 提交；不 amend；不 squash；不 push
5. 不提交：zip / diff / stat / status / bundle / 测试临时目录 / Owner 真实资料 / `digital-me-package/**`

---

## 13. Cursor 完成报告模板

实现结束后报告必须包含：

1. `PAN01R_SPEC_BASE` hash、message、parent；
2. 实现 branch、commit hash、message、parent；
3. 是否 amend / squash / push；
4. 修改与新增文件；
5. 五步体验实际调用链；
6. 主体依据分类和默认选择规则；
7. 授权 token 的绑定、有效期和单次消费规则；
8. 通用结果与 Digital Me 结果如何隔离；
9. 云端模型数据去向如何披露；
10. 取消、迟到结果和审计失败的处理；
11. adopt/reject 的真实结果；
12. 所有测试命令与结果；
13. `git status`；
14. 是否触碰 `digital-me-package/**`；
15. 是否纳入交接文件；
16. Loop 使用轮数；
17. 未解决阻断；
18. PAN-01R 状态确认为 `statically_verified`、未 `accepted`；
19. PAN-02 确认未开始。

---

## 14. 与 PAN-01 / PAN-04 的关系

| 任务 | 关系 |
|---|---|
| PAN-01 | 保留 scaffold；本任务仅最小调整入口与口径；不 accepted |
| PAN-01R | 用一条真实本地模拟体验证明承诺；唯一下一任务 |
| PAN-04 | 仍为更完整本地协作沙盘；在 PAN-01R 验收前暂停；本任务交付的是 Alpha 最小纵向证据，不替代 PAN-04 全量 |

Product Panorama Alpha 与 Trusted Beta 边界不得混淆：本任务属 Alpha；不做公网协作、支付、Digital Org。
