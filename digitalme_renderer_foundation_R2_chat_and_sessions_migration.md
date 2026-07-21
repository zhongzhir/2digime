# Renderer Foundation R2：对话与会话迁移

版本：v0.1.1
日期：2026-07-21
状态：`implementation_completed` / **`retained as infrastructure`** / `not_current_mainline`（原 `awaiting_codex_implementation_review` / `awaiting_owner_runtime` **不再作为项目最高等待项**）
性质：**独立实施任务包（历史主线）**；实现代码保留为可用基础设施；**是否补写 Owner `accepted` 不阻塞新主线**
所属主线（历史）：`P1-PANORAMA` → **已被 2026-07-21 规划基线重建降级**
前置：Renderer Foundation R0 **`accepted`**（v0.1.2）；Renderer Foundation R1 **`accepted`**（v0.1.3；baseline `8d7e9b3`）
依据：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` §14 / §15 / §16；`digitalme_renderer_foundation_R1_shell_and_entry_switch.md`；历史执行索引；规格接受提交 `418d0cc`
实现分支：**`codex/r2-chat-sessions-migration`**

> **2026-07-21 规划基线重建（强制）**  
> - R2 = **`retained as infrastructure`**：停止围绕边缘问题追加修复与验收作为当前执行主线。  
> - **R3 = `paused`**，不是下一步。  
> - **当前执行计划**：[`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)  
> - **最高架构原则**：[`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
> - 下文保留 R2 实施规格与实现事实；文内「当前唯一等待项 = Codex/Owner 验收 R2」仅作**历史快照**，不得指导后续排期。

> **状态语义（基础设施口径）**
>
> - **`implementation_completed`**：R2-A～R2-F 源码与自动化测试已落地；
> - **`retained as infrastructure`**：可作为 next/legacy 对话基础设施继续存在；**不**要求继续作为产品主线验收队列；
> - **不得**因未写 `accepted` 阻塞第一纵向闭环规划；补验收属可选、非当前任务；
> - 生产默认入口仍为 **legacy**；next 仅受控 harness / 门禁进入；
> - R2.5 SQLite 保持 `planned` / `deferred`；R3 **`paused`**；PAN-02 相对新主线 **`paused`**；
> - **不得**因本文件改写 R0 / R1 / PAN-01S 族已有 `accepted` 记录。

角色（历史）：Owner（真机）＋ Codex（复核）＋ Cursor（实现）——**当前项目角色已转向第一纵向闭环文档/规格**

---

## 1. 状态与边界

| 项 | 当前值 |
|---|---|
| 任务包版本 | **v0.1.1** |
| 工程状态 | `specified` / `codex_review_passed` / `frozen_for_implementation` / `implementation_completed` / `awaiting_codex_implementation_review` / `awaiting_owner_runtime` |
| R2 实现分支 | **`codex/r2-chat-sessions-migration`** |
| 生产默认入口 | **legacy** |
| R1 | `accepted`（v0.1.3；baseline `8d7e9b3`） |
| R2-A～R2-F | **实现已完成**（待 Codex 实现复核 + Owner 真机） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked`（见 R0 §16；R2 accepted **不**自动解锁） |
| 本轮状态 | 源码实现已完成；**不得**写 `accepted` |

---

## 2. 目标（一句话）

在 `renderer-next` 中**独立重建**可用的会话列表和聊天页面，沿用 **main 权威**、**JSON sessions** 与已验收的 **displayText / modelText / attachmentRefs 分离模型**；**不复用旧隐藏 DOM**，不迁移其他业务页面，并始终可**整窗返回 legacy**。

---

## 3. 当前代码事实（只读核对 · 现状，非完成声明）

### 3.1 存储

| 项 | 事实 |
|---|---|
| 模块 | `digitalme-app/src/sessions.js` |
| 路径 | `path.join(userData, "workbench-sessions.json")` |
| Store 默认 | `{ version: 1, activeId: null, sessions: [] }` |
| 导出函数 | `sessionsPath`, `loadStore`, `listSessions`, `getSession`, `createSession`, `saveSession`, `renameSession`, `deleteSession`, `setActive` |
| 标题上限 | rename：`slice(0, 60)` |

### 3.2 消息模型（现状常量；R2 将按 §7.3 角色化修订）

| 常量（现状） | 值 |
|---|---|
| `SCHEMA_VERSION` | `2` |
| `MODEL_TEXT_MAX` | `4000` |
| `DISPLAY_TEXT_MAX` | `2000`（**单一常量；R2-A/C 必须改为角色相关策略**） |
| `FOLD_PREVIEW_CHARS` | `1600` |
| `FOLD_EXPAND_MAX` | `8000` |
| `SESSION_NAV_BLOCK_MESSAGE` | `"请先停止当前回复，再切换对话。"` |

### 3.3 现有 IPC（现状）

| IPC | preload | 备注 |
|---|---|---|
| `sessions:list/get/create/save/rename/delete/setActive` | 对应方法 | `sessions:save` 现状可透传 session 对象 |
| `chat:send` | `sendChat` | payload 含 `pkg`, `history`, `requestId`, `attachmentContext`, `scenarioHint` |
| `chat:stop` | `stopChat` | `{ requestId }` |
| `chat:progress` | `onChatProgress` | legacy 通道；**next 改用 §9.2 `chat:event`** |
| `chat:pickAttachments` | `pickAttachments` | 现状可能回传过多信息；R2 next 见 §9.5 |

### 3.4 并发（现状）

- Legacy renderer：`activeChatRequest` 单飞 + `sessionNavGuard`。
- Main：`activeChatAborts` Map；**未见**全应用单飞。
- R2 目标：main 结构化 `activeRequest` + 全应用单活动聊天请求（§10）。

### 3.5 `renderer-next`

仅空壳（stamp / ready / 返回经典界面）。无会话与聊天业务。

---

## 4. 范围内（必须做）

1. `renderer-next` 会话列表
2. 新建会话
3. 切换会话
4. 行内改名（无原生 `prompt`）
5. 自定义删除确认（无原生 `confirm`）
6. 会话右侧省略号菜单
7. 聊天消息显示（仅安全 `displayText`）
8. 发送消息（窄 `sendChat`，§9.2）
9. 流式响应（`chat:event`，§9.2）
10. 停止当前回复
11. 请求中会话导航保护
12. 当前会话恢复（`activeId`）
13. 应用重启后历史恢复
14. 关联文稿紧凑卡
15. 打开关联文稿的受控去向（§11.1 legacy handoff）
16. 关闭关联文稿并立即由 main 持久化
17. displayText / modelText / attachmentRefs 分离（§7.3 角色上限）
18. 旧历史安全降级
19. main 权威请求注册与并发门禁
20. 类型化 preload session/chat API（next **无**通用 save）
21. Playwright Electron 真实 E2E
22. 整窗返回 legacy（主动 vs 异常路径，§10.3）
23. production 默认仍为 legacy
24. hermetic sessions、隔离 userData、非真实 Package
25. sessions **串行原子写**（§9.6；属 R2-A，不得拖到 R2.5）
26. 附件 **不透明 selection token**（§9.5）

---

## 5. 范围外（明确不做）

- 「我」/ 构建 / 工作台写作研究代码 / 能力 / 设置迁移
- Package 数据迁移；SQLite；R2.5；PAN-02
- PAN-01R 生产入口；删除 legacy；iframe / webview
- 新 renderer 驱动旧隐藏 DOM；CSS 隐藏旧页冒充迁移
- 在 legacy `app.js` 继续堆新业务冒充迁移
- 大规模无关 main/preload/模型服务重构
- 自动迁移或清理真实旧会话；改变生产默认入口为 next
- 跨会话聊天并发；第二套 sessions 文件

---

## 6. 用户主路径

```text
默认打开 → legacy 正常
→（harness / Owner / E2E 门禁）整窗进入 next 对话页
→ 会话列表 + 聊天（或空状态 +「新对话」）
→ 新建 / 切换 / 行内改名 / 省略号删除
→ 发送 → chat:event 流式显示 → 可停止
→ 请求中：禁新建/切换/删除/改关联/打开文稿/主动回经典；提示先停止
→ 关联文稿仅紧凑卡；打开则 handoff 回 legacy 工作台（无活动请求时）
→ 重启后会话仍在（hermetic / 副本）
→ 无活动请求时可「返回经典界面」；崩溃/ready 失败由 main abort 后回 legacy
```

用户面禁止暴露 `requestId`、P0～P4、schemaVersion、IPC 名等内部词。

---

## 7. 数据模型（字段级合同）

### 7.1 Session（main 内部持久化）

| 字段 | 约束 |
|---|---|
| `id` | string；`s_…` |
| `title` | ≤ **60** |
| `messages` | Message[] |
| `artifacts` | 引用；不含正文 |
| `attachments` | 元数据；不含正文 |
| `createdAt` / `updatedAt` | ISO string |
| `packagePath` | 仅 main 内部；**不得**进入 `SessionViewDTO` |

当前会话：`activeId`。Store：`{ version, activeId, sessions }`。**不**引入 SQLite。

### 7.2 Message（main 内部 persistable）

| 字段 | 约束 |
|---|---|
| `schemaVersion` | 新消息 **`2`** |
| `id` | `m_…` |
| `role` | `user` \| `assistant` |
| `displayText` | UI 唯一可信源；上限见 §7.3 |
| `modelText` | ≤ **4000**；禁止直接展示；**不得**进入 `SessionViewDTO` |
| `attachmentRefs` | `{ id, name, type?, size? }[]`；无正文、无绝对路径 |
| `createdAt` | ISO string |

### 7.3 合同一：角色相关 displayText 与折叠（冻结）

| 项 | 冻结值 |
|---|---|
| 用户 `displayText` 持久化上限 | **2000** 字 |
| assistant `displayText` 持久化上限 | **8000** 字 |
| 折叠预览 | **1600** 字 |
| 展开 | 显示本条已持久化的全部 assistant `displayText`，最大 **8000** 字 |
| `modelText` | 最大 **4000**；只供模型历史；禁止直接展示 |
| 流式过程 | 可展示正在生成内容；**完成落盘**按 assistant **8000** 合同 |
| 关联文稿预览 / 受控内容展示超过 8000 | **必须**追加 §21.2 冻结的用户可见截断提示；**禁止**静默截断导致误以为完整 |
| 实现 | R2-A / R2-C 将单一 `DISPLAY_TEXT_MAX=2000` 改为**角色相关**策略 |
| 兼容 | legacy 兼容测试必须继续通过 |
| 禁止 | **不得**出现「刷新后由 8000 变 2000」 |

其余冻结：UI 只展示安全 `displayText`；附件正文不进气泡；不存完整 `requestContent`；旧 `content`/`display` 不可信；能抽原问题则只显示原问题；否则安全占位；不得用「截取前 4000 字」修旧史；损坏消息占位跳过，不得拖垮会话。关联文稿预览截断细则见 **§21.2**。

### 7.4 SessionViewDTO（next `getSession` 仅此）

**必须分离** main 内部持久化对象与 renderer 视图 DTO。

`SessionViewDTO` **不得包含**：`modelText`、`packagePath`、附件正文、artifact 正文、绝对隐私路径。

可包含：会话 id/title/时间戳；消息的 `id/role/displayText/attachmentRefs(仅安全字段)/createdAt`；关联文稿卡所需安全摘要（title/libraryId 等，无正文）。

---

## 8. 状态所有权表（实现级完整表）

列含义：权威来源｜谁可修改｜是否持久化及位置｜重启如何恢复｜renderer 是否仅副本｜主要竞态/泄漏风险｜错误后恢复。

| # | 状态 | 权威来源 | 谁可修改 | 持久化 | 重启恢复 | renderer 仅副本？ | 竞态/泄漏风险 | 错误后恢复 |
|---|---|---|---|---|---|---|---|---|
| 1 | 会话列表 | main / `sessions.js` 写队列 | 仅 main（窄 IPC 触发） | `workbench-sessions.json` | `listSessions` 读盘 | 是 | 双写、空 store 覆盖 | 见 §13#1/#24；可新建/回经典 |
| 2 | 当前会话 ID | main `activeId` | 仅 main `setCurrentSession`/create/delete 副作用 | 同上 | 读 `activeId`；无效则 null 或首条策略 | 是 | 请求中切换 | 导航门禁；失败保持原 ID |
| 3 | 会话标题 | main `session.title` | 仅 main `renameSession` | 同上 | get/list | 是 | 改名与切换竞态 | 回滚 UI；提示失败 |
| 4 | 消息历史 | main `session.messages` | 仅 main（send/stop/完成/失败路径） | 同上 | `getSession`→DTO | 是 | 流式未落盘当已存 | 完成/停止后再写；失败明示 |
| 5 | displayText | main 落盘字段 | 仅 main | 消息内；user≤2000；assistant≤8000 | normalize 后进 DTO | 是（只读展示） | 误渲 modelText | 安全占位；不静默变短 |
| 6 | model context / modelText | main | 仅 main | modelText 持久化；当轮正文否 | 仅 main 内部用于模型 | **不可见** | 泄漏到 DTO/UI | DTO 剥离；审计脱敏 |
| 7 | attachmentRefs | main | 仅 main 发送路径 | 消息内（无正文） | 随消息 | 是（仅安全字段） | 带 path | 剥离 path |
| 8 | 附件选择 token 及正文 | main 进程内 vault | 仅 main 签发/消费/清理 | token 进程内；正文内存不当盘 | 重启 token 失效；须重选 | 仅持 token | 跨窗跨会话复用、正文泄漏 | token 失败可重选；清理正文 |
| 9 | 当前关联文稿 | main session.artifacts | 仅 main clear/open 路径 | JSON | get→卡摘要 | 是（无正文） | 请求中改关联 | 请求中禁止；保存失败提示 |
| 10 | 当前请求注册表 | main `activeRequest` | 仅 main | 进程内 | 不恢复为进行中 | 只读快照 | 双请求、僵尸写 | stop/fail 清除；迟到丢弃 |
| 11 | requestId | main 生成 | 仅 main | 审计可记；非业务盘 | 否 | 是 | 伪造 complete | 校验后丢弃 |
| 12 | originSessionId | `activeRequest` | 仅 main 在 send 绑定 | 进程内 | 否 | 是 | 切页改归属 | 增量只写归属会话 |
| 13 | assistantMessageId / 流式目标 | `activeRequest` | 仅 main | 完成后随消息 | 否 | 是 | 写错气泡 | 三元组校验 |
| 14 | sequence / 已处理序号 | main 发；renderer 记本地 cursor | main 单调递增 sequence | 否 | 否 | renderer 仅本地 cursor | 乱序/重复 | 丢弃并审计 |
| 15 | 停止状态 | main `status` + abort | `stopChat` / 异常 abort | 否 | 否 | 是 | 停止失败仍导航 | 保护至 main 确认结束 |
| 16 | 会话导航保护 | main 依 activeRequest | main 拒绝窄命令 | 否 | 否 | UI 提示副本 | 绕过 IPC | 统一 main 拒绝 |
| 17 | sessions 持久化/写队列 / **sessionsRecoveryLatch** | main 串行队列 + 进程级 latch | 仅 main；latch 由整文件解析失败置位，**仅 Owner 另授**可清 | 正式路径仅成功原子写；latch 期间**禁止**写正式文件 | 正式文件仍坏则重启后**重新置 latch** | 是 | 空 store 覆盖、legacy save 绕过 | 见 §12.1 / §13#1/#21/#24 |
| 18 | rendererEntry | R1 controller | 仅 main | 偏好可持久；effective 进程内 | 默认 legacy | 是 | 循环切换 | latch + 回 legacy |
| 19 | fallback latch | R1 controller | 仅 main | 进程内 | 清进程重置 | 是 | 反复进 next | 本进程不再自动 next |
| 20 | runtime stamp / generation | main | 只读 stamp；generation 仅 main | 否 | getStamp/boundGeneration | 是 | 错代 ready | R1 握手合同 |
| 21 | 一次性 legacy 导航意图 | main | 仅 main 设置；legacy 消费清除 | 进程内（可短暂） | 重启失效 | next 不可见正文 | 含正文、未清除 | 仅 libraryId/scene；消费即清 |
| 22 | renderer 输入草稿 | renderer 本地 | renderer（仅草稿） | **默认不**持久到 sessions | 不恢复（除非另授权） | **唯一**非业务权威本地态 | 误当已发送 | 发送失败保留草稿；明示未保存 |

**冻结原则（不变）：**

- sessions 与当前请求权威在 **main**；
- renderer **不是**第二业务权威；
- renderer **不**直接读写 sessions 文件；
- 流式事件只能写入 `originSessionId` 与 `assistantMessageId`；
- renderer 切页 **不能**改变请求归属；
- 附件正文、`modelText`、绝对路径 **不**进入 renderer。

---

## 9. main / preload API（目标合同）

> 标注：`保留` / `适配` / `新增` / `废止(next)`。**不得假装已实现。**

### 9.1 Sessions（合同三：收窄写入）

| 语义 | 处置 | 说明 |
|---|---|---|
| `listSessions` | 适配 | 摘要 DTO；无绝对路径 |
| `getSession` | 适配 | **仅**返回 `SessionViewDTO`（§7.4） |
| `createSession` | 适配 | 请求中拒绝 |
| `renameSession` | 适配 | title≤60；请求中拒绝 |
| `deleteSession` | 适配 | 请求中拒绝 |
| `setCurrentSession` | 适配 | 请求中拒绝 |
| `clearLinkedArtifact` | 适配 | main 立即持久化；请求中拒绝 |
| **通用 `persistSession` / `sessions:save`** | **next 废止暴露** | next preload **不暴露**；renderer-next **不得**提交任意完整 session 对象 |

**`sessions:save` 过渡期：**

- 仅供 **legacy** 使用；
- main 按当前合法窗口 / renderer 入口限制调用来源；
- R2 `accepted` **前不得删除** legacy `sessions:save`；
- **不**新增第二套 sessions 文件；
- 当 **`sessionsRecoveryLatch` 生效**时：legacy `sessions:save` **必须由 main 拒绝**，与 next 窄写一并阻断（§12.1）；不得依赖 renderer 自觉。

消息新增、assistant 占位、流式更新、完成、停止、失败落盘：**全部由 main 执行**（或进入 main 受控写队列）。**latch 生效期间上述落盘一律不得写入正式 sessions 路径。**

next 允许的写相关窄命令仅：`createSession`、`renameSession`、`deleteSession`、`setCurrentSession`、`clearLinkedArtifact`、`sendChat`、`stopChat`。

### 9.2 Chat（合同四 + 合同五）

| 语义 | 处置 | 说明 |
|---|---|---|
| `sendChat`（next） | **新增/替换窄合同** | 见下方最小输入；**不**与 legacy 任意对象同通道猜测来源 |
| `chat:send`（legacy） | 保留兼容 | legacy 继续现有通道；next **不得**走任意透传 |
| `stopChat` | 适配 | 匹配当前 requestId |
| `chat:progress` | legacy **暂时保留** | next **不**依赖；禁止「可选补字段假装升级」 |
| `chat:event` | **新增**（next） | 类型化判别联合；见下 |
| `getActiveRequest` | 新增 | 结构化或 null |

**next `sendChat` 最小输入（冻结）：**

```text
sendChat({
  sessionId,
  inputText,
  attachmentSelectionToken?,
  linkedArtifactId?,
  scenarioHint?
})
```

冻结要求：

1. `requestId`、`assistantMessageId` **由 main 生成**；
2. main 从 sessions 权威读历史；从 Package/受控服务读主体上下文；生成 model history；组装 attachment context；
3. renderer **不得**提交：`pkg`、完整 `history`、`modelText` 数组、`requestContent`、附件正文、任意 system prompt；
4. **`scenarioHint` 合同（冻结，见 §21.1）**：main 定义的受限枚举；省略时归一为 `general_chat`；非白名单一律拒绝；不得任意字符串透传；不得拼入 system prompt / 模型正文 / 路径 / 权限判断；仅选择 main 内部预定义受控请求策略；
5. **`inputText` 合同（冻结，编码前不可再议）：**
   - 去除首尾空白后**不得为空**；
   - 用户可提交的 `inputText` 最大为 **2000 字**（与用户 `displayText` 持久化上限一致）；
   - 超限或空值：main **拒绝发送**，返回稳定、可见、可恢复的校验错误；
   - renderer 可提前提示，但 **main 必须再次校验**；
   - 拒绝时：**不**生成模型请求；**不**注册 `activeRequest`；**不**创建 assistant 占位；**保留**输入草稿；
   - **不允许**通过额外字段、附件正文或 history 绕过上限；
6. 模型调用前完成 `activeRequest` 注册；**注册失败不得发起模型请求**；
7. 用户消息与 assistant 占位由 main 按序持久化或进入受控写队列（**recovery latch 生效时禁止写入正式路径**）。

**`chat:event`（next）冻结：**

- 类型至少：`delta` | `complete` | `stopped` | `error`；
- 每事件必含：`requestId`、`sessionId`、`messageId`、`sequence`、`type`；
- `delta` 另含 `textDelta`；
- `sequence` 由 main **单调递增**；
- `complete` **不得**由 renderer 伪造；
- renderer 只接受：当前登记 requestId + 匹配 sessionId/messageId + sequence 大于已处理值；
- 重复 / 倒序 / 迟到 / 旧请求：**丢弃并脱敏审计**；
- main 是 assistant 最终文本与完成状态的权威。

### 9.3 Linked artifact

| 语义 | 处置 |
|---|---|
| `openLinkedArtifact` | 见 §11.1（整窗 legacy handoff）；请求中拒绝 |
| `clearLinkedArtifact` | main 清关联并立即原子持久化 |

### 9.4 强制约束

1. 禁止任意对象透传；禁止暴露 fs/Node/绝对隐私路径给普通 UI。
2. 输入校验；IPC sender 绑定当前合法窗口。
3. 普通 renderer 不能启用 test harness；query/hash/localStorage 不能开 harness。
4. PAN-01R test-only 门禁不变。

### 9.5 合同六：附件不透明凭证（一次性消费冻结）

next 选附件后，main 仅返回：安全名称、类型、大小、不透明 `attachmentSelectionToken`（或受控 ref）。

renderer **不得**收到：附件正文、本地绝对路径、拼接后的 `attachmentContext`。

正文只保存在 main 当轮受控内存。sessions 只存 `attachmentRefs`。不得把真实路径当普通 UI 文案。跨重启再用须重新选择（或另开持久化引用任务）。

**一次性消费语义（冻结，编码前不可再议）：**

1. attachment selection token 为**一次性** token；
2. main 仅在以下条件**全部**验证通过后消费：当前合法窗口匹配；当前会话匹配；token 未过期；token **未被消费**；
3. 参数校验失败、窗口/会话不匹配或 token 已过期时：**不**发起模型请求；**不**注册 `activeRequest`；**不**创建 assistant 占位；
4. 模型请求一旦被 main 接受并完成 `activeRequest` 注册，token **即标记为已消费**；
5. 同一 token 的重复发送**必须失败**，不得产生第二个模型请求；
6. 完成、失败、停止或超时后清理对应附件正文；
7. 应用重启后**全部** token 失效；
8. **TTL 冻结为 300 秒（见 §21.3）**；「一次性消费」与 TTL 均已关闭，不再是未决项；
9. **不允许**以「有限重试」为由重复消费同一 token；用户需重试带附件请求时，应**重新选择附件并取得新 token**。

### 9.6 合同七：sessions 原子写与串行化（R2-A，不拖 R2.5）

1. main 对 `workbench-sessions.json` 写入 **必须串行**；同一时刻仅一个写操作提交。
2. 同目录临时文件 → flush/close → **原子 rename** 替换。
3. Windows rename 失败：按 **§21.4** 有限重试（最多 4 次尝试；等待 50/150/350ms；仅 `EBUSY`/`EPERM`/`EACCES`）；**不删除**最后一个有效正式文件；**不得无限重试**。
4. 写入前对 store 做结构校验。
5. 写入失败：**不得**把 renderer 内存副本当作已保存；UI 须区分「内存中已产生变化」与「尚未成功持久化」。
6. create / rename / delete / setActive / chat 完成·停止 / 清关联：**同一写队列**；**且**写入口必须检查 `sessionsRecoveryLatch`（§12.1）；**latch 生效时不得进入正式文件 rename 流程**。
7. 不使用长期悬挂跨进程锁；本轮不引入 SQLite。
8. 测试覆盖：两连续写顺序正确；写失败保留旧文件；临时文件异常不破坏正式文件；重启读最后一次成功版本；**latch 下 next 与 legacy 均不能写正式文件**；rename 重试次数/等待/错误码见 §15.2 / §21.4。

---

## 10. 并发与导航合同

### 10.1 决策（冻结）

- 同一会话同时最多一个活动回复。
- Alpha：**全应用单活动聊天请求**。
- 跨会话并发另开任务。
- 不沿用裸 `currentRequestId` 作权威。
- main `activeRequest`：`{ requestId, originSessionId, assistantMessageId, startedAt, status }`。

### 10.2 请求中禁止 / 允许

**禁止：** 新建/切换/删除会话；改变关联文稿；打开关联文稿；第二次 `sendChat`；用户主动「返回经典界面」。

**允许：** `stopChat`。

停止完成或请求结束后再解除保护。连续 Enter/双击/重复 IPC 只产生一次请求。迟到事件丢弃并审计。`finally` 只清匹配自身 `requestId` 的活动请求。

### 10.3 合同二：返回经典界面（冻结两条路径）

**A. 用户主动点击「返回经典界面」**

- 无活动请求：main **立即**整窗回 legacy。
- 有活动请求：**阻止**；提示「请先停止当前回复，再返回经典界面。」
- 不允许 renderer 借切换窗口逃避活动请求。
- 用户停止成功且 main 确认请求结束后，方可回 legacy。

**B. next 崩溃 / ready 失败 / R1 自动回退**

- 异常路径，不依赖 renderer 按钮。
- main **必须**主动 stop/abort 当前活动聊天请求；标记 `stopped` 或 `failed`。
- 丢弃该请求后续迟到事件。
- 完成必要安全持久化后再回 legacy。
- **不得**留下后台僵尸回复继续写会话。
- 即使停止或保存失败，也必须记录脱敏错误，并避免新旧界面循环（沿用 R1 latch）。

---

## 11. UI 合同

必备：左侧列表、「新对话」、标题+`⋯`、行内改名、自定义删除、消息列表、用户/assistant 气泡、长答折叠（1600/8000）、关联紧凑卡、输入框、发送、停止、请求中提示、错误恢复入口、「返回经典界面」。

禁止：聊天页内联全文；附件全文；`prompt`/`confirm`/`alert`；CSS 藏旧页；新按钮驱动旧 DOM；向用户显示内部状态名；失控后只给「重启应用」一种恢复。

### 11.1 关联文稿「打开」去向（冻结）

R2 不迁移工作台，因此：

1. next 点「打开文稿」→ main 先完成当前会话必要持久化。
2. 若无活动请求：设置**一次性、受控**的 legacy 导航意图 → 整窗回 legacy → legacy 打开既有工作台文稿页。
3. 一次性意图仅含受控 `libraryId`/scene，**不含正文**；legacy 消费后立即清除。
4. 有活动请求：阻止并提示先停止。
5. 打开失败：仍留 next，显示可恢复提示。
6. 禁止 next 直接调旧隐藏 DOM；禁止聊天页内联正文。
7. R4 迁移工作台后再替换此过渡路径。

---

## 12. 旧历史与数据兼容

1. 默认读现有 JSON sessions；不引入 SQLite。
2. 新旧 renderer 可读同一数据；**禁止**两 renderer 同时写（整窗互斥）。
3. schema v2 原样；旧消息只做安全展示适配。
4. 不批量重写真实历史；实现/测试不读真实 sessions 正文。
5. Owner 验收用副本或新建测试会话。
6. 永久可见「新建对话」「关闭关联」。

### 12.1 损坏 sessions 恢复边界（冻结）

#### 12.1.1 损坏单会话

1. **单个会话损坏不得拖垮会话列表**。
2. 损坏会话显示安全占位与「无法打开」状态。
3. **不向 renderer 返回**损坏正文或解析堆栈。
4. 普通 R2 恢复界面中：可显示安全占位；可**新建干净会话**；可返回**安全的**经典界面（须满足 §12.1.2 写阻断）；**不得**提供普通「删除损坏会话」作为恢复动作。
5. R2 **不得**自动删除、重写、修补或规范化覆盖该真实会话。
6. 删除或修复损坏真实会话属于数据处置，须 **Owner 另行明确授权并另开任务**。
7. **正常、可解析会话**的用户主动删除功能不受影响。

#### 12.1.2 整个正式 sessions 文件损坏与 `sessionsRecoveryLatch`

1. main 一旦确认正式 `workbench-sessions.json` **整文件无法解析**，必须设置进程级 **`sessionsRecoveryLatch`**（名称可等价，语义必须明确）。
2. latch 生效期间：
   - next 的所有 sessions **写命令拒绝**；
   - legacy **`sessions:save` 也必须由 main 拒绝**；
   - `create` / `rename` / `delete` / `setActive` / `sendChat`·`stop` 后落盘 / `clearLinkedArtifact` **均不得**写入正式 sessions 路径；
   - renderer 内默认空 store、内存空列表或兼容降级结果 **不得**成为正式文件写入来源。
3. 阻断必须在 **main 统一 sessions 写入口或写队列**生效；**不得**仅依靠 renderer 自觉不保存。
4. **返回 legacy 之前**，main 必须确保 legacy **不能**通过旧 `sessions:save` 覆盖损坏原件。
5. 若 legacy 无法在只读/受限状态安全打开：**不得**强行进入 legacy；进入**稳定恢复页**；**不**循环切换；明确提示「原对话文件未改写」。
6. **损坏原件必须原样保留**（旁路备份不得顶替正式路径为空文件）。
7. 隔离恢复 store：不得使用正式 `workbench-sessions.json` 路径；不得自动顶替正式 store；必须有明确临时/隔离标识；不得误报为真实历史已恢复。
8. **清除** recovery latch、修复、替换或迁移真实文件，必须由 **Owner 另行授权**，不属于 R2 自动恢复。
9. 应用重启后若正式文件仍损坏，必须**重新进入** recovery latch，**不能**因进程重启恢复写权限。
10. 真实数据修复或迁移仍需 Owner 另行授权。

---

## 13. 错误恢复矩阵（逐场景）

列含义：用户看见｜可重试/入口｜草稿｜消息丢失风险｜脱敏审计｜导航保护解除时机｜新建干净会话｜返回经典｜经典也失败时。

| # | 场景 | 用户看见 | 可重试 | 草稿 | 消息丢失风险 | 脱敏审计 | 导航保护解除 | 新建干净会话 | 返回经典 | 经典也失败 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sessions 列表读取失败 | 「无法加载对话列表」+ 原因中性说明 | 是：重试按钮 | N/A | 否（未加载） | 读失败码、无正文 | N/A（无活动请求） | 若**整文件损坏**：置 `sessionsRecoveryLatch`，见 #24；否则可见新建 | 仅当 legacy 写入已被 latch 阻断且可安全打开 | 稳定故障页；禁循环 |
| 2 | 单个会话损坏 | 列表仍在；该项「无法打开」；**无普通删除恢复入口** | 否打开；**禁止**普通删除损坏会话 | N/A | 该会话内容不可用 | 会话 id、规范化失败类 | N/A | 是（干净会话） | 仅安全路径（latch 规则适用时遵守） | 同上 |
| 3 | 新建会话失败 | 「无法新建对话」 | 是 | 保留当前输入框草稿 | 否 | create 失败码 | 保持至无活动请求 | 再试新建 | 是 | 同上 |
| 4 | 会话改名失败 | 「无法改名」；标题回滚 | 是 | N/A | 否 | rename 失败 | 有活动请求则仍保护 | 是 | 是 | 同上 |
| 5 | 会话删除失败 | 「无法删除」；列表回滚 | 是 | N/A | 否 | delete 失败 | 同上 | 是 | 是 | 同上 |
| 6 | 切换当前会话保存失败 | 「切换前保存失败，仍留在原对话」 | 是：重试保存/切换 | 保留 | 未保存变更有风险 | save/setActive 失败 | 有活动请求仍保护 | 是 | 是 | 同上 |
| 7 | 用户消息/assistant 占位保存失败 | 「消息未能保存，未开始回复」或「占位保存失败」 | 是：可重发 | **保留** | 未落盘用户消息可能未入历史 | persist 失败阶段 | 未注册请求则无保护；已注册则保持 | 是 | 是 | 同上 |
| 8 | 流式中增量持久化失败 | 「回复显示可能不完整，正在保存」/失败说明 | 视策略重试写队列 | 保留输入 | 内存增量与盘不一致风险 | 写队列失败、requestId | 保持至请求结束 | 是 | 有活动请求则先停 | 同上 |
| 9 | 完成落盘失败 | 「回复未成功保存」；UI 标明未保存完整 | 是：重试保存 | 保留 | 已生成文本可能未入盘 | complete persist 失败 | 请求标 failed 后解除 | 是 | 确认结束后可回 | 同上 |
| 10 | 模型调用失败 | 「暂时无法回复」+ 可重试 | 是：重发 | **保留** | 无完整 assistant 或标失败 | 模型错误类、无密钥 | 请求结束后解除 | 是 | 是 | 同上 |
| 11 | 流式意外中断 | 「回复中断」；已落盘部分按合同 | 可新请求 | 保留 | 部分 | 中断原因 | 结束后解除 | 是 | 是 | 同上 |
| 12 | 停止请求失败 | 「正在停止…失败，请再试」；仍禁导航 | 是：再点停止 | 保留 | 低 | stop 失败 | **main 确认结束后**才解除 | 是 | 确认结束后 | 同上 |
| 13 | 附件 token 过期 | 「附件已失效，请重新选择」 | 是：重选 | 保留文本 | 否 | token expired | N/A | 是 | 是 | 同上 |
| 14 | 附件 token 跨窗口/跨会话 | 「无法使用该附件，请重新选择」 | 是：重选 | 保留文本 | 否 | token scope 失败 | N/A | 是 | 是 | 同上 |
| 15 | 关联文稿打开失败 | 「无法打开文稿」；仍留 next | 是 | N/A | 否 | open/handoff 失败 | 有活动请求仍保护 | 是 | 无活动请求时可回 | 同上 |
| 16 | 关闭关联保存失败 | 「未能关闭关联文稿」；卡状态回滚或明示未保存 | 是 | N/A | 关联状态可能旧 | clear persist 失败 | 同上 | 是 | 是 | 同上 |
| 17 | preload/API 版本不匹配 | 「界面组件不匹配，请返回经典界面」 | 否业务操作 | 保留尽量 | 否 | apiVersion mismatch | N/A | 若列表可用则可 | **必须**可回 | 稳定故障页 |
| 18 | next 崩溃或 ready 失败 | 自动回经典或 Error Boundary 提示 | 回经典后重进 harness（非生产） | 尽量交 main | 未保存风险 | crash/ready 超时 | main abort 后清请求 | 回经典后 | **路径 B** | latch+故障页 |
| 19 | 自动回 legacy 时 abort 失败 | 仍尝试回经典；提示「后台回复可能未完全停止」 | 有限 | — | 僵尸写风险→须丢弃迟到事件 | abort 失败 | 强制标 failed 并丢弃迟到 | 回经典后 | 继续回退 | 故障页禁循环 |
| 20 | 自动回 legacy 时安全保存失败 | 回经典；提示「有内容可能未保存」 | 回经典后处理 | — | 有 | persist-on-fallback 失败 | 请求已结束/失败 | 是 | 已在回退 | 故障页 |
| 21 | 返回 legacy 本身失败 / 或不安全 | 「无法切换到经典界面」或「原对话文件未改写」；**不**反复自动跳 | 有限次；若因整文件损坏则勿强行进 legacy | 保留 | — | navigate 失败或 latch 阻断 | 依请求状态 | 隔离策略且不覆盖正式文件 | **返回前必须确认 legacy 写入已被 latch 阻断**；无法安全返回则**稳定恢复页** | **稳定故障页**；禁循环 |
| 22 | sessions 原子 rename 持续失败 | 「无法保存对话」；保留旧正式文件 | 是：有限重试 | 保留 | 新变更未入盘 | rename 失败次数 | 有活动请求保持 | 是 | 是 | 同上 |
| 23 | 临时文件残留 | 用户通常无感；异常时「保存异常，对话文件未损坏」 | 清理可后台 | N/A | 正式文件应仍有效 | temp leftover | N/A | 是 | 是 | 同上 |
| 24 | 重启后正式 sessions 文件损坏 | 受限恢复说明；**原文件未被空 store 覆盖**；**next 与 legacy 均不能写正式文件**；重启若仍坏则**重新置 latch** | 重试读；不可静默清空；不可清 latch | N/A | 原数据保留在损坏件 | parse fail；latch 置位 | N/A | 仅隔离路径且不覆盖原件；**不得**误报已恢复真历史 | **仅**当写入已阻断且可安全只读打开；否则稳定恢复页 | 故障页；禁循环 |

---

## 14. 安全与隐私

- hermetic userData；禁真实 Package/sessions 正文。
- 附件正文永不进 renderer DOM；路径不作 UI 文案。
- `contextIsolation: true`；`nodeIntegration: false`。
- 无生产 PAN-01R 入口。

---

## 15. 测试计划

### 15.1 分类

纯函数；main 合同；hermetic JSON；组件；Playwright E2E；legacy 回归；隐私；并发；故障恢复；Owner 真机。

### 15.2 必须补充的合同测试

- assistant **8000** 持久化、展开、刷新一致
- **关联文稿预览 / 受控内容展示超过 8000 code point：截断提示与 §21.2 冻结文案完全一致；未超限不显示；7999/8000/8001 边界；emoji/代理对不被拆开；超限正文不进隐藏 DOM / SessionViewDTO / sessions 持久化**
- 用户主动回 legacy 时活动请求被阻止
- 自动回退时 main 停止活动请求且迟到事件无效
- next 无法调用通用 `sessions:save`；legacy 过渡期仍可调用（**非** recovery latch）
- **整文件损坏后：next 窄写不能写正式文件；legacy `sessions:save` 也不能写正式文件**
- **返回 legacy 不会触发空 store 覆盖；无法安全进入 legacy 时稳定恢复页且不循环**
- **重启后正式文件仍损坏时重新进入 recovery latch**
- **损坏单会话无普通删除恢复入口**
- **`inputText` 空白或超过 2000：不注册请求、不调模型、不建 assistant 占位、草稿保留**
- **`scenarioHint`：`general_chat` / `continue_chat` / `artifact_discussion` 分别通过；缺省归一为 `general_chat`；非字符串、空值、白名单外值由 main 拒绝且不调用模型；`artifact_discussion` 不能绕过会话 / 关联文稿 / token 校验**
- **附件 token 只能消费一次；TTL：299 秒仍有效、到达 300 秒即过期；过期不调模型、不注册请求、不建占位；墙上时钟变化不能延长有效期；重启后失效；重复/跨窗/跨会话不能启动模型请求**
- **sessions 原子 rename：首次成功只调用一次；`EBUSY`/`EPERM`/`EACCES` 按 50/150/350ms 最多额外重试 3 次（共 4 次尝试）；第四次仍失败后停止；非白名单错误不重试；无无限重试；全部失败后正式旧文件不变；不用空 store 或 renderer 副本重建；UI 不得把未持久化显示为成功**
- `SessionViewDTO` 不含 modelText/path/正文
- 类型化 `chat:event` 三元组 + sequence；renderer 伪造 complete 无效
- `sendChat` 无法注入 history/pkg/system prompt/requestContent
- sessions 写队列与原子替换（连续写、失败保留旧文件、临时异常、重启读成功版）
- 关联文稿经整窗 legacy handoff 打开；活动请求中打开被阻止
- legacy 兼容（含原 display 相关）继续通过
- 上述验证须核对**真实文件状态、真实 IPC 拒绝、真实请求计数、真实调用次数与状态变化**，不得只匹配静态文案

### 15.3 Playwright Electron 逐项清单（必须真实覆盖）

1. 默认仍进入 legacy。
2. 仅合法 harness 进入 next。
3. query / hash / localStorage **不能**开启 harness。
4. 新建会话。
5. 行内改名。
6. 自定义删除确认。
7. 发送消息并真实显示流式增量。
8. 完整回复落盘。
9. assistant 8000 字展开且刷新后**不**缩成 2000。
10. 关联文稿预览 / 受控内容超过 8000 Unicode code point 时显示 §21.2 冻结截断提示；7999/8000/8001 边界与 emoji 代理对安全截取；未超限不显示提示；超限正文不进隐藏 DOM / DTO / 持久化。
11. 停止回复。
12. 连续 Enter、双击、重复 IPC 只产生一个请求。
13. 请求中切换、新建、删除、改变关联、打开文稿均被阻止。
14. 请求中主动返回 legacy 被阻止。
15. 停止完成后可以返回 legacy。
16. next 崩溃 / ready 失败时 main abort 并自动回 legacy。
17. 自动回退后迟到 delta 和 complete **不能**写会话。
18. 重启后恢复最后一次成功持久化版本。
19. 旧 schema 消息安全降级。
20. 8 万字附件正文不进入聊天 DOM。
21. `SessionViewDTO` 不含 `modelText`、路径或正文。
22. 附件 token：299 秒有效、300 秒过期；跨窗口、跨会话失败；墙上时钟变化不延长 TTL；重启失效；**同一 token 不得二次消费启动模型请求**。
23. 关联文稿只显示紧凑卡。
24. 关闭关联文稿立即保存。
25. 打开关联文稿通过整窗 legacy handoff。
26. 损坏会话不拖垮列表；**普通恢复界面无删除损坏会话入口**。
27. 整个 sessions 文件损坏时**不被空 store 覆盖**；**next 窄写与 legacy `sessions:save` 均被 main 拒绝**；重启仍坏则**重新 latch**。
28. 模型失败可恢复且草稿 / 已存消息状态明确可辨；**`inputText` 空或 >2000 时不注册请求、不调模型、不建占位、草稿保留**；**`scenarioHint` 白名单三值通过、缺省归一、非法值拒绝且不调模型；`artifact_discussion` 不能绕过校验**。
29. sessions 连续写顺序正确。
30. rename：首次成功仅一次；`EBUSY`/`EPERM`/`EACCES` 按 50/150/350ms 最多共 4 次尝试；非白名单错误不重试；失败保留旧正式文件；UI 不伪报已保存。
31. 临时文件异常不破坏正式文件。
32. next 无法调用通用 `sessions:save`。
33. legacy 过渡期仍可调用 `sessions:save`（**非** recovery latch 时）。
34. renderer 伪造 `complete` 无效。
35. 返回 legacy 成功（且不会空 store 覆盖）。
36. 返回 legacy 失败或**无法安全进入**时不循环跳转并显示稳定恢复界面。
37. legacy owner-runtime 回归继续通过。
38. 生产普通路径没有 PAN-01R 测试入口。

**时限：** 单用例 ≤60 秒；R2 最小 E2E 套件 ≤10 分钟。必须通过真实用户操作与真实状态变化验证；**禁止**以静态字符串匹配冒充功能验证。

---

## 16. Owner 白话验收清单（≤12）

1. 原界面默认正常打开。
2. 受控方式下能进入新对话页。
3. 能新建、改名、删除对话。
4. 能发送消息并收到完整回复；很长回复刷新后不会变短，超长时有明确截断说明。
5. 能停止正在生成的回复；回复过程中不能误切对话，也不能在未停止时返回经典界面。
6. 关闭应用再打开，对话还在。
7. 发送带附件后正文不铺满页面。
8. 关联文稿只显示小卡片；打开时回到经典界面的文稿页（无回复进行中时）。
9. 出错后能新建对话或返回经典界面。
10. 不白屏、不在新旧界面之间来回乱跳。
11. 程序异常退回经典界面后，不会在后台继续乱写对话。
12. 原有真实数据不被破坏（验收用副本/测试会话）。

---

## 17. 实施分片与分支策略（合同十 · 冻结）

| 分片 | 内容 |
|---|---|
| **R2-A** | 类型化合同；角色 display 上限；`activeRequest`；窄 API；sessions **原子写队列**；附件 token 骨架 |
| **R2-B** | 会话列表与管理 |
| **R2-C** | 消息显示、折叠、旧历史适配（落实 8000/1600） |
| **R2-D** | 窄 sendChat、`chat:event`、停止、单飞、导航与主动回经典门禁 |
| **R2-E** | 附件 token 消费、关联卡、legacy handoff 打开 |
| **R2-F** | E2E、legacy 回归、Owner 验收 |

**分支（冻结）：**

- 单一实现分支：`codex/r2-chat-sessions-migration`
- 实现分支已由 Owner 授权并从 R2 规格接受提交创建；当前仅完成参数合同冻结。Codex 参数合同复核收口且 Owner 再次授权前，不得开始 R2-A～R2-F 编码。
- A～F 同分支**串行**；每片**独立提交**；**不用**每片短分支
- 任一片失败立即停止
- 建议复核门：A 后 Codex 合同复核；D 后 Codex 主路径复核；F 后 Owner 真机
- 不得并行 R2.5 / PAN-02；不得在 legacy `app.js` 堆新业务

---

## 18. 完成条件

- 七项核心合同落地（结论不变）；角色 display 上限与折叠一致；无「8000→2000」回退
- **完整状态所有权合同落地**（§8 二十二项）
- **完整错误恢复矩阵落地**（§13 二十四类）
- **损坏 sessions 不会被空 store 静默覆盖**；**`sessionsRecoveryLatch` 跨 next/legacy 阻断正式写**（§12.1）
- **损坏单会话无普通删除恢复入口**
- **`inputText`≤2000 与空值拒绝语义落地**；**附件 token 一次性消费落地**
- next 窄 API + `chat:event` + main 单飞 + 原子写
- JSON 兼容；DTO 无敏感字段
- 主动回经典 / 异常回退行为符合 §10.3
- **Playwright §15.3 主路径与故障路径通过**（仍 38 项，含本轮扩写）
- **返回 legacy 失败或无法安全进入不会形成循环**；具备稳定故障/恢复界面
- **输入草稿与消息持久化结果对用户可辨认**
- E2E 与 legacy 回归通过；生产默认 legacy；无生产 PAN-01R
- Codex 最终复核通过；Owner 真机验收通过（实现阶段）

---

## 19. 停止条件

- 读或批量迁移真实 sessions；两 renderer 同时写
- 附件正文进可见消息；引入 SQLite / 启动 R2.5
- 扩到「我」/构建/工作台；生产默认改 next
- 在旧 `app.js` 堆新业务；提前启动 PAN-02
- **需要自动覆盖、删除或批量修复损坏的真实 sessions**
- **无法保证整个 sessions 文件损坏时不被空 store 覆盖**
- **无法在 main 层同时阻断 next 与 legacy 对正式文件的写入**
- **无法提供稳定故障页或阻止 next/legacy 循环**
- **测试只能依赖静态字符串而不能验证真实状态 / 真实请求计数**
- E2E 无法验证用户主路径

---

## 20. 迁移、回滚与发布边界

1. 实现期生产默认 legacy；next 仅门禁进入。
2. 关键错误可整窗回 legacy（路径 A/B 见 §10.3）；**整文件损坏时须先保证 legacy 写入已阻断，否则稳定恢复页**（§12.1.2）。
3. 不删除 legacy chat；不批量迁真实 sessions。
4. R2 accepted 后是否改生产默认：另行决策。
5. R2 不自动解锁 PAN-02；仍须 R0 §16；R3 未完成前 PAN-02 继续 blocked。
6. **清除 `sessionsRecoveryLatch`、修复或替换正式 sessions 文件：须 Owner 另行授权，非 R2 自动路径。**

---

## 21. 实施前参数合同（已冻结；待 Codex 复核）

三项参数已由本提交按固定值写入；**本提交不是源码实现**。**Codex 复核通过且 Owner 再次授权前，不得开始 R2-A 编码**；不得在编码过程中临时改值；不得允许任意 `scenarioHint`、无限 TTL 或无限 rename 重试。后续若需调整，必须修改合同与测试并重新复核。

### 21.1 `scenarioHint` 最小白名单（冻结）

1. `scenarioHint` 是 **main 定义的受限枚举**；**不接受** renderer 任意字符串透传。
2. 第一版最小白名单固定为：
   - `general_chat`
   - `continue_chat`
   - `artifact_discussion`
3. 含义冻结：
   - `general_chat`：无特殊上下文的普通对话；
   - `continue_chat`：延续当前会话既有上下文；
   - `artifact_discussion`：讨论当前会话已经建立合法关联的文稿，仅允许引用 main 已验证的关联信息。
4. renderer **省略** `scenarioHint` 时，main 统一归一化为 `general_chat`。
5. **非字符串、空字符串、白名单外值，以及大小写或拼写变体**，一律由 main **拒绝**。
6. **不得**将 `scenarioHint` 直接拼入 system prompt、模型正文、文件路径或权限判断。
7. `scenarioHint` **只**用于选择 main 内部预定义的受控请求策略。
8. `artifact_discussion` **不得绕过**：attachment token 校验；当前会话匹配；linkedArtifact 合法性检查；正文读取权限；`SessionViewDTO` 数据最小化合同。
9. 后续增加枚举值必须修改合同、测试并经独立复核；**不得**由 renderer 自行扩展。

### 21.2 超过 8000 字截断提示（冻结）

最终用户可见提示（**必须原样使用**；标点、数字与含义不得在编码中临时改变）：

> 内容较长，当前仅展示前 8000 字。完整内容未写入聊天记录；需要查看时，请打开关联文稿。

同时明确：

1. 该提示**仅用于**关联文稿预览或受控内容展示的截断说明。
2. 「8000 字」按 JavaScript 字符串的 **Unicode code point** 数计数；**不按** UTF-16 code unit、字节或 token 计数。
3. 实现时**不得**使用可能拆开代理对的简单 code-unit 截断；须按 code point **安全截取**。
4. 截断后聊天 DOM 中最多存在：前 8000 个 Unicode code point；上述固定提示；必要的紧凑关联卡元数据。
5. 截断**不得**把 8000 字以后的正文写入隐藏 DOM、dataset、title、aria-label 或 renderer 缓存。
6. 完整正文**不得**写入聊天消息的 `displayText`、`SessionViewDTO` 或会话持久化记录。
7. 若内容不超过 8000 个 Unicode code point，**不显示**该截断提示。

### 21.3 attachment selection token TTL（冻结）

- TTL：**5 分钟 = 300 秒**；
- 计时起点：main **成功创建** token 的**单调时钟**时刻。

同时明确：

1. token **只**保存在 main 内存中，**不**持久化。
2. renderer 只能持有 opaque token，**不得**获得正文、真实路径或可推导凭据。
3. token 必须同时绑定：创建它的合法窗口；当前会话；已验证的附件选择结果；创建时间；消费状态。
4. main 校验时必须使用**单调时钟**计算 TTL，避免系统时间回拨延长有效期。
5. **到达 300 秒即视为过期**；不得采用无限宽限。
6. 过期 token：**不**发起模型请求；**不**注册 `activeRequest`；**不**创建 assistant 占位。
7. 一次性消费合同保持不变：所有前置验证通过 → main 接受模型请求 → `activeRequest` 注册成功 → **此时** token 立即标记为已消费。
8. 同一 token **不得**重试消费。
9. 模型完成、失败、停止、超时或应用退出后，清理相应附件正文。
10. 应用重启后全部 token 失效。
11. 用户需要重新发送带附件请求时，必须重新选择附件并取得新 token。
12. **不得**通过刷新 renderer、切换窗口、切换会话或修改参数延长 TTL。

### 21.4 sessions 原子 rename 有限重试（冻结）

- 首次 rename 失败后，最多**额外重试 3 次**；
- 因此单次写入最多执行 **4 次** rename 尝试；
- 重试等待依次为 **50ms、150ms、350ms**；
- 总额外等待上限为 **550ms**；
- **不得无限重试**。

同时明确：

1. 仅对临时性、允许重试的 rename 错误执行重试。
2. 允许重试的错误码第一版固定为：`EBUSY`、`EPERM`、`EACCES`。
3. 其他错误**立即失败**，不进入重试。
4. 每次重试必须仍针对**同一个**已经完成写入并完成必要同步的临时文件与**同一个**正式目标。
5. 重试期间**不得**重新从 renderer 获取 store，也**不得**用默认空 store 重建内容。
6. 达到最大次数仍失败时：正式旧文件保持不变；不报告保存成功；返回稳定、可恢复的持久化失败；用户界面明确区分「内存中已产生变化」和「尚未成功持久化」；不得静默丢弃草稿或伪报已保存；临时文件按既定安全合同处理，不得破坏正式文件。
7. `sessionsRecoveryLatch` 生效时**不得**进入正式文件 rename 流程。
8. rename 重试次数和等待值后续若需调整，必须修改合同和测试并重新复核。

---

## 22. 调度

| 项 | 值 |
|---|---|
| 本文件 | **v0.1.1** / `implementation_completed` / `awaiting_codex_implementation_review` / `awaiting_owner_runtime` |
| 实现分支 | **`codex/r2-chat-sessions-migration`** |
| 历史等待项（已降级，非项目下一步） | 曾为 Codex 集中复核实现 + Owner 真机验收；**2026-07-21 起** R2 = `retained as infrastructure`，项目下一步见第一纵向闭环计划 |
| R2-A～R2-F | **实现已完成**（未 `accepted`） |
| R1 | `accepted`（不变） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked` |
| 生产默认 | legacy |

---

## 23. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-21 | v0.1-draft | 初稿；`codex_review_pending`（历史） |
| 2026-07-21 | v0.1.1-draft | 第一～三轮：七项合同、所有权/恢复/E2E、安全闭环（历史） |
| 2026-07-21 | **v0.1.1** | **Codex 最终复核通过**；状态 → `specified` / `codex_review_passed` / `frozen_for_implementation` / `not_started`。实施规格冻结（历史） |
| 2026-07-21 | **v0.1.1**（参数合同） | Owner 授权创建实现分支 `codex/r2-chat-sessions-migration`；冻结 §21 三项参数（scenarioHint 白名单、8000 截断文案与 code point 口径、token TTL=300s、rename 最多 4 次/50-150-350ms/`EBUSY|EPERM|EACCES`）；补全 §15 测试合同。**仍 `not_started`**；等待 Codex 复核参数合同与 Owner 再次授权后方可编码 |
| 2026-07-21 | **v0.1.1**（实现收口） | Owner 授权连续完成 R2-A～R2-F；状态 → `implementation_completed` / `awaiting_codex_implementation_review` / `awaiting_owner_runtime`。**不得 `accepted`**；下一等待项为 Codex 实现复核与 Owner 真机验收 |
