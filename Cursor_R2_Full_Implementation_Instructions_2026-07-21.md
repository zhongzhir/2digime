# Digital Me：R2 对话与会话迁移完整实施指令

> **历史指令（2026-07-21）**：本文件记录当时 Owner 授权完成整个 R2 的实施命令。  
> **2026-07-21 规划基线重建后**：R2 = **`retained as infrastructure`**；**不得**再把本指令当作当前执行主线；**不得**据此开始 R3；项目下一步见 [`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)。  
> 下文保留为历史证据，状态字段仅描述当时授权范围。

日期：2026-07-21  
执行对象：Cursor（历史）  
项目目录：`D:\Projects\Digital Me`  
目标分支：`codex/r2-chat-sessions-migration`  
预期起始 HEAD：`6982d4f4fcaab6277381b2d746d58e868f81c71c`

## 一、Owner 授权与本轮完成定义

Owner 现授权在 `codex/r2-chat-sessions-migration` 分支**连续开始并完成整个 R2**。

本次授权覆盖 R2-A～R2-F，以及为了满足已冻结 R2 合同和测试所必需的同范围源码调整、内部重构、测试、构建与缺陷修复。不得再因完成某个分片、某次提交或普通实现选择而暂停等待 Owner/Codex；A～F 在同一轮连续推进，直至形成可运行、可测试、可供 Owner 真机验收的完整 R2。

本轮主要产出必须是：

1. 可运行的 `renderer-next` 对话与会话功能；
2. main 权威、窄 preload API、可靠 sessions 持久化和附件隔离；
3. 自动化测试、真实 Electron E2E、构建结果；
4. 可直接执行的 Owner 真机验收步骤；
5. 清晰、可回滚的实现提交。

文档只做解除编码歧义和里程碑收口所需的最小同步。不得把时间消耗在重复改写多份状态文档或润色历史措辞上。

R2 完成的用户结果是：在受控入口进入新界面后，用户能够创建、切换、改名、删除和恢复会话；发送、流式接收和停止回复；请求中受到一致导航保护；附件正文不污染 DOM、DTO 或 sessions；关联文稿只显示紧凑卡并可受控打开；关闭与重启后会话可靠恢复；随时可安全返回 legacy；生产默认入口仍为 legacy。

## 二、权威实施依据

以仓库当前版本的以下文件为权威：

- `digitalme_renderer_foundation_R2_chat_and_sessions_migration.md`（v0.1.1）
- `digitalme_renderer_foundation_R1_shell_and_entry_switch.md`
- `digitalme_renderer_foundation_R0_decision_and_migration_plan.md`
- 当前源码与既有测试

四组实施前参数已经 Codex 复核通过，不得重新讨论或临时改值：

1. `scenarioHint`：`general_chat` / `continue_chat` / `artifact_discussion`；省略归一为 `general_chat`；其他值由 main 拒绝。
2. 8000 字提示原文：`内容较长，当前仅展示前 8000 字。完整内容未写入聊天记录；需要查看时，请打开关联文稿。`；按 Unicode code point 安全计数和截取。
3. attachment token：TTL 300 秒，main 单调时钟计时，到达 300 秒即过期，一次性消费，重启失效。
4. sessions rename：最多 4 次尝试，等待 50/150/350ms，仅重试 `EBUSY` / `EPERM` / `EACCES`。

若本指令与冻结 R2 合同存在实现细节冲突，以冻结 R2 合同的数据安全、权限、失败语义和用户可观察行为为准；本指令改变的是**推进方式**，不是安全合同。

## 三、开始前现场核对

进入项目目录，只读执行：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --name-only
git log --oneline --decorate -12
```

必须确认：

- 当前分支为 `codex/r2-chat-sessions-migration`；
- HEAD 为 `6982d4f4fcaab6277381b2d746d58e868f81c71c`；
- 没有已跟踪未提交修改；
- 既有未跟踪交接件可以保留，但不得读取、移动、删除、提交；
- 不存在其他正在运行且会修改本仓库的任务。

任一关键项不符，立即停止并报告现场差异。不得 `reset`、`stash`、`clean`、覆盖或删除用户内容。

随后只读确认：

- 实际 package manager、scripts、Node/Electron/Vite/React 配置；
- R1 已有 `renderer-next`、main、preload、sessions、聊天消息模型及测试的真实位置；
- R2 合同所述现状与源码是否存在命名或结构偏差。

允许因真实源码结构调整内部实现方案，但不得改变冻结行为合同。

## 四、执行方式：连续完成，不逐片等待

R2-A～R2-F 按依赖顺序实施。可以为降低返工在相邻分片间交叉补测试，但不得跳过基础安全合同直接堆 UI。

每个分片完成后：

1. 运行与本片相关的类型检查和测试；
2. 检查 diff 边界；
3. 创建一个清晰的独立提交作为回滚点；
4. **立即继续下一片，不等待回复或授权**。

建议提交信息：

```text
feat(r2): establish chat and session contracts
feat(r2): add next session management
feat(r2): render safe chat history
feat(r2): implement authoritative chat lifecycle
feat(r2): add attachment and artifact handoff
test(r2): verify chat and session migration
```

可以根据真实代码边界小幅调整提交数量和文字，但应保持提交单一、可审查、可回滚。不得 amend、squash、rebase、push。

普通编译错误、测试失败、同一目标内的接口调整和局部重构不是停止条件，应直接定位和修复。局部补丁两轮仍未解决时，回到根因重新设计该局部，不继续叠加补丁。

## 五、R2-A：main 权威基础与可靠持久化

必须完成：

1. 建立 TypeScript 类型化的 session/chat DTO 和窄 preload API；`renderer-next` 不得获得 Node/fs 或任意完整 session 写入口。
2. `SessionViewDTO` 只包含 UI 必需字段；不得含 `modelText`、附件正文、绝对路径或其他敏感上下文。
3. 将单一 display 上限改为角色相关策略：user `displayText` 最大 2000；assistant 最大 8000；折叠预览 1600；刷新后不得从 8000 缩回 2000。
4. main 建立结构化全应用单飞 `activeRequest`：`requestId`、`originSessionId`、`assistantMessageId`、`startedAt`、`status`；main 生成请求和消息 ID。
5. `sendChat` 只接收受控意图：`sessionId`、`inputText`、可选 opaque attachment token、可选合法 linked artifact id、可选白名单 `scenarioHint`。renderer 不得提交 pkg、history、modelText、requestContent、附件正文、system prompt。
6. main 校验空白和超过 2000 code point 的 input；拒绝时不调用模型、不注册请求、不建 assistant 占位，并保留 UI 草稿。
7. 创建 attachment token 的 main 内存骨架，绑定窗口、会话、已验证选择结果、单调创建时间和消费状态；renderer 只得到安全元数据与 opaque token。
8. 所有 sessions 修改进入同一串行写队列：同目录临时文件 → flush/close → 原子 rename；落实冻结的 Windows 有限重试。
9. 写入前验证 store；失败保留旧正式文件，不用 renderer 副本或默认空 store 重建；UI 明确区分内存变化与未持久化。
10. `sessionsRecoveryLatch` 生效时，next 与 legacy 的正式 sessions 写入口都必须被 main 阻断，不得进入 rename。

先用单元/集成测试验证上述真实行为和文件结果，再继续 UI。

## 六、R2-B：会话列表与管理

在 `renderer-next` 实现：

- 会话列表、当前会话与空状态；
- 新建和切换；
- 标题右侧 `⋯` 菜单；
- 行内改名，Enter 保存、Esc 取消、最长 60；
- 自定义删除确认；
- activeId 恢复和重启恢复；
- 所有操作只调用窄 API，成功以 main 持久化结果为准；
- 保存失败不得伪报成功，并提供可恢复提示；
- 请求活动期间，main 与 UI 双层拒绝新建、切换、删除。

不得使用原生 `prompt`/`confirm`，不得复用 legacy 隐藏 DOM，生产默认仍为 legacy。

## 七、R2-C：安全消息显示与历史兼容

必须完成：

- UI 只渲染 `displayText`；绝不渲染 `modelText`、旧 KIMI `display`、附件正文或任意隐藏全文；
- user 2000、assistant 8000、预览 1600、展开显示已持久化全文；
- Unicode code point 安全截断，不拆 emoji/代理对；
- 固定 8000 字提示只用于关联文稿预览/受控内容展示，未超限不显示；
- 8000 字以后的正文不进入隐藏 DOM、dataset、title、aria-label、renderer 缓存、DTO 或 sessions；
- 旧 schema 历史可可靠抽取原问题时只显示原问题，否则安全占位；不得用截取旧附件正文前几千字冒充修复；
- 损坏单条消息不拖垮会话；损坏单会话不拖垮列表；不得提供会破坏原数据的普通删除恢复捷径。

## 八、R2-D：真实聊天生命周期

必须完成 main 权威的真实发送、流式、停止与导航门禁：

- `chat:event` 至少支持 `delta` / `complete` / `stopped` / `error`；每个事件含 requestId、sessionId、messageId、单调 sequence、type；
- renderer 只接受匹配活动请求三元组且 sequence 更新的事件；重复、倒序、迟到和旧请求事件丢弃并脱敏审计；
- main 是 assistant 最终文本与完成状态权威，renderer 不能伪造 complete；
- 连续 Enter、双击发送、重复 IPC 只产生一个模型请求；
- 请求中禁止第二次发送、新建/切换/删除会话、改变或打开关联文稿、主动返回 legacy；唯一正常可用动作是停止；
- 停止完成或请求结束后才解除门禁；`finally` 只清匹配自己的 activeRequest；
- 主动返回 legacy：有请求时阻止并使用冻结文案；无请求时立即整窗返回；
- next 崩溃/ready 失败：main 主动 abort，标记 stopped/failed，完成必要安全持久化后回 legacy，迟到事件不得写入；
- 回 legacy 不安全或失败时进入稳定恢复页，禁止新旧界面循环。

流式响应必须调用真实 main 模型路径。自动化测试可用 hermetic fake/model seam，但不得把生产功能实现成静态假响应。

## 九、R2-E：附件与关联文稿

必须完成：

- 附件选择后 renderer 仅收到安全名称、类型、大小和 opaque token；正文、绝对路径、拼接上下文始终留在 main；
- token TTL、单调时钟、窗口/会话绑定、一次性消费和清理完全符合冻结合同；
- 所有前置校验通过且 `activeRequest` 注册成功时才消费；任何拒绝均不调模型、不建占位；
- 同 token 不得重放，重试带附件请求需重新选择附件；
- sessions 只保存安全 `attachmentRefs`；
- 关联文稿在聊天中只显示紧凑卡，不含正文；
- 活动请求中禁止打开或清除关联；
- 清除关联由 main 原子持久化，失败时 UI 回滚或明确未保存；
- 打开关联文稿采用冻结的整窗 legacy handoff；失败留在 next 并可恢复，不得以内联全文替代。

## 十、R2-F：测试、回归、构建与验收准备

必须落实 R2 §15 的测试合同，以真实行为、调用次数、状态变化、DOM/DTO 内容和磁盘文件结果验证，不得只匹配静态文案。

至少完成：

1. 类型检查、lint（若仓库已有）、相关单元/集成测试全部通过；
2. R2 §15.2 合同测试全部通过；
3. R2 §15.3 的 38 项 Playwright Electron 清单全部实现并通过；若同一真实 E2E 可覆盖多项，可以合并用例，但报告必须逐项映射；
4. 默认 legacy、合法 harness 进入 next、非法 query/hash/localStorage 不可开启 harness；
5. 会话 CRUD、流式、停止、重启恢复、长答刷新一致、附件/DTO/DOM 隔离；
6. 并发重复、迟到事件、伪造 complete、token 299/300 秒边界和重放；
7. sessions 原子写顺序、rename 次数/错误码、正式旧文件保持、recovery latch 横跨 next/legacy；
8. next 崩溃、自动回退、回退失败/不安全时稳定恢复且无循环；
9. legacy owner-runtime 与既有聊天消息兼容回归；
10. production build 通过，普通生产路径没有 PAN-01R/R1/R2 测试入口。

测试必须使用隔离的临时 userData、测试 sessions 和测试 Package。不得读取、复制、扫描或迁移 Owner 的真实 Package、sessions、userData 或附件正文。

若完整套件中存在与本轮无关的既有失败：先复跑并定位；不得为变绿而删除测试、放宽冻结断言或扩大代码修改。记录清晰证据后继续完成所有可完成项，并在最终报告中单列。R2 自身合同测试或关键 E2E 未通过，则不得宣称 R2 完成。

## 十一、允许与禁止

本轮允许：

- 修改 R2 范围内的 main、preload、renderer-next、共享类型、sessions/chat 模块及测试；
- 对同范围旧代码做最小适配，保持 legacy 兼容；
- 添加不改变外部安全边界的测试辅助 seam；
- 安装仓库 lockfile 已声明的依赖；如现有依赖已足够，不新增依赖；
- 运行应用、测试、构建和 hermetic Electron E2E；
- 在当前分支创建多个独立提交。

本轮禁止：

- 开始 R3、“我”/构建、工作台、能力、身份、授权、交易；
- 开始 R2.5、SQLite 或 PAN-02；
- 改生产默认入口为 next、删除 legacy 或在 legacy `app.js` 堆新业务；
- 读取或修改真实 Package、sessions、userData；
- 自动覆盖、删除、迁移或批量修复损坏的真实 sessions；
- 引入云服务、遥测、外部发布、真实付款或外发消息；
- 放宽附件、路径、DTO、持久化、权限或 recovery latch 合同；
- 通过隐藏 DOM、静态假 UI 或纯字符串测试冒充完成；
- 修改无关文件、提交既有未跟踪交接件；
- push、合并、rebase、amend、squash。

## 十二、真正需要停止的条件

仅在以下情况停止并报告，不自行扩大权限：

1. 开始现场与预期分支、HEAD 或已跟踪工作树不一致；
2. 必须读取/迁移/覆盖真实用户数据才能继续；
3. 必须改变冻结产品行为、四组参数、安全合同或生产默认入口；
4. 必须引入改变安全边界的新依赖、云服务或不可逆迁移；
5. 无法保证损坏 sessions 不被空 store 覆盖，或无法在 main 同时阻断 next/legacy 正式写；
6. 无法防止附件正文/私密路径进入 renderer、DTO、DOM、日志或 sessions；
7. 无法提供稳定回退/恢复路径，可能形成界面循环或后台僵尸写；
8. 发现现有架构无法在 R2 边界内合理修复，必须扩大到 R2.5/R3/PAN-02。

普通代码问题、测试失败、接口命名偏差和同范围重构不属于停止条件。

## 十三、完成后集中检查

完成代码与测试后执行仓库真实存在的对应命令，并至少包括：

```powershell
git diff --check
git status --short
git diff --stat 6982d4f4fcaab6277381b2d746d58e868f81c71c..HEAD
git diff --name-only 6982d4f4fcaab6277381b2d746d58e868f81c71c..HEAD
git log --oneline --decorate -20
```

检查：

- 只有 R2 范围文件；
- 无真实数据、构建产物、临时 userData、附件正文或既有交接件进入提交；
- 无密钥、token、绝对隐私路径或大段敏感正文；
- 所有提交均在目标分支且未 push；
- 工作树无已跟踪未提交修改；
- 没有命令仍在后台运行。

在代码完成后，只对必要状态文档做一次最小收口，准确记录：

- R1：`accepted`；
- R2：实现已完成、等待 Codex 实现复核与 Owner 真机验收（在两者通过前不得写 `accepted`）；
- R2-A～R2-F：实际完成状态；
- R2.5：`planned` / `deferred`；
- PAN-02：`planned` / `blocked`；
- 生产默认入口：legacy；
- 下一等待项：Codex 集中复核与 Owner 真机验收。

不要为了状态同步改写七八份重复文档。优先更新 R2 任务包和执行索引；只有仓库规则明确强制时才同步其他权威状态文件。

## 十四、最终报告

全部完成后一次性返回完整报告：

1. 分支、起始 HEAD、最终 HEAD；
2. 提交列表（hash、message、每个提交的范围）；
3. 修改文件清单和主要架构变化；
4. R2-A～R2-F 各自完成情况；
5. main `activeRequest`、窄 sendChat、chat:event 的最终实现；
6. SessionViewDTO 与 displayText 角色上限；
7. sessions 串行原子写、rename 重试、失败与 recovery latch 结果；
8. attachment token TTL、绑定、消费和清理；
9. 关联文稿卡、清除持久化与 legacy handoff；
10. 旧历史、损坏消息/会话/整文件的恢复行为；
11. 运行的所有检查、测试、E2E、构建命令及逐项结果；
12. R2 §15.3 38 项 E2E 的逐项通过映射；
13. legacy 回归和生产默认入口结果；
14. `git diff --check` 与 `git status --short`；
15. 是否读取或修改真实 Package/sessions/userData；
16. 是否新增依赖或修改 package/lockfile；若有，说明必要性；
17. 是否修改 R2 外源码；若有，逐项说明为什么属于必要适配；
18. 是否 commit、是否 push；
19. 已知限制、非阻断遗留项；
20. 当前是否仍有命令运行；
21. Owner 真机验收步骤（不超过 12 项）；
22. 下一等待项。

报告后停止，等待 Codex 集中复核和 Owner 真机验收。不得开始 R3、R2.5 或 PAN-02。

