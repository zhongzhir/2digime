# Renderer Foundation R2：对话与会话迁移

版本：v0.1.1-draft
日期：2026-07-21
状态：`specified` / `codex_changes_requested` / `not_started`
性质：**独立实施任务包草案（第一轮有界修订）**；**Codex 再复核通过前不得创建 R2 实现分支或修改源码**；**当前未授权实现**
所属主线：`P1-PANORAMA`（三位一体 Alpha）
前置：Renderer Foundation R0 **`accepted`**（v0.1.2）；Renderer Foundation R1 **`accepted`**（v0.1.3；baseline `8d7e9b3`）
依据：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` §14 / §15 / §16；`digitalme_renderer_foundation_R1_shell_and_entry_switch.md`；执行索引；代码基线（只读核对）分支 `codex/r1-renderer-next-shell`
实现分支：**不存在**（冻结名：`codex/r2-chat-sessions-migration`；**仅在 Codex 再复核通过且 Owner 授权后**、从 R2 规格接受提交创建；**当前禁止创建**）

> **状态语义**
>
> - **`specified` / `codex_changes_requested` / `not_started`**：Codex 第一轮复核指出七项合同缺口；本版已关闭；等待 **Codex 再复核**；
> - **不得**使用 `frozen_for_implementation` / `codex_review_passed` / `implemented` / `accepted`（本轮）；
> - R1 `accepted` 仅覆盖 next 底座与整窗切换；**next 当前仍是预览空壳**；
> - 生产默认入口仍为 **legacy**；普通用户**没有**进入 next 的生产入口；
> - R2.5 SQLite 保持 `planned` / `deferred`；PAN-02 保持 `planned` / `blocked`；
> - **不得**因本修订改写 R0 / R1 / PAN-01S 族已有 `accepted` 记录；
> - 本文件描述的 API / 门禁 / UI **目标态**与现有代码并存关系见 §3；**不得假装目标 API 已实现**。

角色：Owner（验收）＋ Codex（规格复核）＋ Cursor（实现；**仅在授权后**）

---

## 1. 状态与边界

| 项 | 当前值 |
|---|---|
| 任务包版本 | **v0.1.1-draft** |
| 工程状态 | `specified` / `codex_changes_requested` / `not_started` |
| R2 实现分支 | **不存在**（冻结名见文首；当前禁止创建） |
| 生产默认入口 | **legacy** |
| R1 | `accepted`（v0.1.3；baseline `8d7e9b3`） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked`（见 R0 §16；R2 accepted **不**自动解锁） |
| 本轮授权 | **仅规格修订**；再复核通过前不得实现 |

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
| 超过 8000 | **必须**追加用户可见截断提示；**禁止**静默截断导致误以为完整 |
| 实现 | R2-A / R2-C 将单一 `DISPLAY_TEXT_MAX=2000` 改为**角色相关**策略 |
| 兼容 | legacy 兼容测试必须继续通过 |
| 禁止 | **不得**出现「刷新后由 8000 变 2000」 |

其余冻结：UI 只展示安全 `displayText`；附件正文不进气泡；不存完整 `requestContent`；旧 `content`/`display` 不可信；能抽原问题则只显示原问题；否则安全占位；不得用「截取前 4000 字」修旧史；损坏消息占位跳过，不得拖垮会话。

### 7.4 SessionViewDTO（next `getSession` 仅此）

**必须分离** main 内部持久化对象与 renderer 视图 DTO。

`SessionViewDTO` **不得包含**：`modelText`、`packagePath`、附件正文、artifact 正文、绝对隐私路径。

可包含：会话 id/title/时间戳；消息的 `id/role/displayText/attachmentRefs(仅安全字段)/createdAt`；关联文稿卡所需安全摘要（title/libraryId 等，无正文）。

---

## 8. 状态所有权表（摘要 + 冻结原则）

| 状态 | 权威 | 谁可改 | 持久化 | renderer |
|---|---|---|---|---|
| 会话列表 / activeId / 标题 / 消息 | main | 仅 main（窄命令触发） | JSON 原子写队列 | 仅副本 |
| displayText | main 落盘权威 | main | 是 | 只读展示 |
| modelText / attachment 正文 | main | main | modelText 是；正文否 | **不可见** |
| attachmentSelectionToken | main | main 签发/消费 | 进程内 | 仅持 token |
| activeRequest | main | main | 进程内 | 只读快照 |
| chat:event 流 | main | main 发；renderer 不得伪造 complete | 否 | 按序消费 |
| rendererEntry / latch / stamp | R1 main | main | 见 R1 | 只读 |

**原则：** sessions 与请求注册权威在 main；renderer 不直读写文件；流式只写入归属 session/message；renderer 不是第二业务权威。

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
- **不**新增第二套 sessions 文件。

消息新增、assistant 占位、流式更新、完成、停止、失败落盘：**全部由 main 执行**（或进入 main 受控写队列）。

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
4. `scenarioHint` **白名单**；`inputText` 有明确长度与空值校验；
5. 模型调用前完成 `activeRequest` 注册；**注册失败不得发起模型请求**；
6. 用户消息与 assistant 占位由 main 按序持久化或进入受控写队列。

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

### 9.5 合同六：附件不透明凭证

next 选附件后，main 仅返回：安全名称、类型、大小、不透明 `attachmentSelectionToken`（或受控 ref）。

renderer **不得**收到：附件正文、本地绝对路径、拼接后的 `attachmentContext`。

正文只保存在 main 当轮受控内存。token 必须：绑定当前窗口；绑定当前会话；有过期时间；一次性或明确消费规则；应用重启后旧 token 失效。

`sendChat` 时 main 凭 token 取上下文；完成/失败/停止/超时后清理正文。sessions 只存 `attachmentRefs`。跨重启再用须重新选择（或另开持久化引用任务）。不得把真实路径当普通 UI 文案。

### 9.6 合同七：sessions 原子写与串行化（R2-A，不拖 R2.5）

1. main 对 `workbench-sessions.json` 写入 **必须串行**；同一时刻仅一个写操作提交。
2. 同目录临时文件 → flush/close → **原子 rename** 替换。
3. Windows rename 失败：有限次数重试；**不删除**最后一个有效正式文件。
4. 写入前对 store 做结构校验。
5. 写入失败：**不得**把 renderer 内存副本当作已保存。
6. create / rename / delete / setActive / chat 完成·停止 / 清关联：**同一写队列**。
7. 不使用长期悬挂跨进程锁；本轮不引入 SQLite。
8. 测试覆盖：两连续写顺序正确；写失败保留旧文件；临时文件异常不破坏正式文件；重启读最后一次成功版本。

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
6. 损坏会话不拖垮列表；永久可见「新建对话」「关闭关联」。

---

## 13. 错误恢复（含合同二补充）

| 场景 | 用户看见 | 要点 |
|---|---|---|
| 列表/单会话损坏/保存失败 | 明确失败 + 重试/新建/回经典 | 不假装已保存 |
| 模型失败/流式中断/停止失败 | 可恢复说明；导航保护至 main 确认结束 | 草稿尽量保留 |
| 主动回经典但有活动请求 | 「请先停止当前回复，再返回经典界面。」 | 不切换 |
| 自动回退 | 回经典；无僵尸写 | main abort + 丢弃迟到事件 |
| 关联打开失败 | 留 next 可恢复提示 | 无 DOM 驱动 |
| 附件 token 无效/过期/跨窗跨会话 | 发送失败说明；可重选 | 无正文泄漏 |
| API 版本不匹配 / next 崩溃 | 回经典入口 | latch 防循环 |
| sessions 原子写失败 | 保存失败；保留旧文件 | 见 §9.6 |

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

- assistant **8000** 持久化、展开、刷新一致；超过 8000 有明确截断提示
- 用户主动回 legacy 时活动请求被阻止
- 自动回退时 main 停止活动请求且迟到事件无效
- next 无法调用通用 `sessions:save`；legacy 过渡期仍可调用
- `SessionViewDTO` 不含 modelText/path/正文
- 类型化 `chat:event` 三元组 + sequence；renderer 伪造 complete 无效
- `sendChat` 无法注入 history/pkg/system prompt/requestContent
- 附件正文不进 renderer；token 过期/跨窗口/跨会话失败
- sessions 写队列与原子替换（连续写、失败保留旧文件、临时异常、重启读成功版）
- 关联文稿经整窗 legacy handoff 打开；活动请求中打开被阻止
- legacy 兼容（含原 display 相关）继续通过

### 15.3 Playwright 覆盖（含原清单 + 上列关键项）

默认 legacy；harness 进 next；CRUD；发送/流式/停止；单飞；导航挡；主动回经典挡；自动回退 abort；重启恢复；旧历史；附件/token；关联卡与 handoff；损坏会话；模型失败；禁 query 开 harness。

时限：单用例 ≤60s；最小套件 ≤10min。禁止静态字符串冒充真操作。

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
- 仅 Codex 再复核通过 **且** Owner 授权后，从 **R2 规格接受提交** 创建
- A～F 同分支**串行**；每片**独立提交**；**不用**每片短分支
- 任一片失败立即停止
- 建议复核门：A 后 Codex 合同复核；D 后 Codex 主路径复核；F 后 Owner 真机
- 不得并行 R2.5 / PAN-02；不得在 legacy `app.js` 堆新业务

---

## 18. 完成条件

- 七项合同落地；角色 display 上限与折叠一致；无「8000→2000」回退
- next 窄 API + `chat:event` + main 单飞 + 原子写
- JSON 兼容；DTO 无敏感字段；附件 token 生效
- 主动回经典 / 异常回退行为符合 §10.3
- E2E 与 legacy 回归通过；生产默认 legacy；无生产 PAN-01R
- Codex 再复核通过；Owner 真机验收通过（实现阶段）

---

## 19. 停止条件

- 读或批量迁移真实 sessions；两 renderer 同时写
- 附件正文进可见消息；引入 SQLite / 启动 R2.5
- 扩到「我」/构建/工作台；生产默认改 next
- 在旧 `app.js` 堆新业务；E2E 无法验证主路径；提前启动 PAN-02

---

## 20. 迁移、回滚与发布边界

1. 实现期生产默认 legacy；next 仅门禁进入。
2. 关键错误可整窗回 legacy（路径 A/B 见 §10.3）。
3. 不删除 legacy chat；不批量迁真实 sessions。
4. R2 accepted 后是否改生产默认：另行决策。
5. R2 不自动解锁 PAN-02；仍须 R0 §16；R3 未完成前 PAN-02 继续 blocked。

---

## 21. 风险与未决问题（≤3；非实施前阻断合同）

原五项核心未决已全部关闭（见修订记录）。剩余非阻断：

1. `scenarioHint` 白名单的具体枚举值（R2-A 给出最小集即可，不得借此重开透传）。
2. 超过 8000 字截断提示的最终用户文案措辞（须有明确提示；用词可微调）。
3. 附件 token 的具体 TTL 秒数与重试次数上限（须有过期与有限重试；具体数字 R2-A 锁定并写入测试）。

**无**实施前未关闭的核心合同缺口。

---

## 22. 调度

| 项 | 值 |
|---|---|
| 本文件 | **v0.1.1-draft** / `specified` / `codex_changes_requested` / `not_started` |
| 当前唯一等待项 | **Codex 再复核**本 R2 任务包 |
| 再复核通过前 | **不得**创建实现分支；**不得**修改源码 |
| R1 | `accepted`（不变） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked` |
| 生产默认 | legacy |

---

## 23. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-21 | v0.1-draft | 初稿；`codex_review_pending`（历史） |
| 2026-07-21 | **v0.1.1-draft** | Codex 第一轮有界修订：关闭七项合同——①角色 display 2000/8000+折叠；②主动回经典先停 / 异常回退 main abort；③next 不暴露通用 save，legacy 过渡保留；④next 强制 `chat:event`；⑤窄 sendChat，main 组装请求；⑥附件不透明 token；⑦sessions 串行原子写（R2-A）。分支策略：单分支 `codex/r2-chat-sessions-migration`，A～F 独立提交。关联打开：legacy handoff。状态 → `specified` / `codex_changes_requested` / `not_started`。等待 Codex 再复核 |
