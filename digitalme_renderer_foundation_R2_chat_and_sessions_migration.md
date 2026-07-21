# Renderer Foundation R2：对话与会话迁移

版本：v0.1-draft
日期：2026-07-21
状态：`specified` / `codex_review_pending` / `not_started`
性质：**独立实施任务包草案**；**Codex / Owner 复核通过前不得创建 R2 实现分支或修改源码**；本轮只起草任务包，**不授权实现**
所属主线：`P1-PANORAMA`（三位一体 Alpha）
前置：Renderer Foundation R0 **`accepted`**（v0.1.2）；Renderer Foundation R1 **`accepted`**（v0.1.3；baseline `8d7e9b3`）
依据：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` §14 / §15 / §16；`digitalme_renderer_foundation_R1_shell_and_entry_switch.md`；执行索引 v0.2.17+；代码基线（只读核对）`373fef9` 所在分支 `codex/r1-renderer-next-shell`
实现分支：**不存在**（建议名待复核后决定，例如 `codex/r2-chat-sessions-migration`；**当前禁止创建**）

> **状态语义**
>
> - **`specified` / `codex_review_pending` / `not_started`**：任务包已起草，等待 Codex 复核；**尚未** `frozen_for_implementation`；**尚未**获得 Owner 实现授权；
> - R1 `accepted` 仅覆盖 next 底座与整窗切换；**next 当前仍是预览空壳**；
> - 生产默认入口仍为 **legacy**；普通用户**没有**进入 next 的生产入口；
> - R2.5 SQLite 保持 `planned` / `deferred`；PAN-02 保持 `planned` / `blocked`；
> - **不得**因本草案改写 R0 / R1 / PAN-01S 族已有 `accepted` 记录；
> - 本文件描述的 API / 门禁 / UI **目标态**与现有代码并存关系见 §3；**不得假装目标 API 已实现**。

角色：Owner（验收）＋ Codex（规格复核）＋ Cursor（实现；**仅在授权后**）

---

## 1. 状态与边界

| 项 | 当前值 |
|---|---|
| 任务包版本 | **v0.1-draft** |
| 工程状态 | `specified` / `codex_review_pending` / `not_started` |
| R2 实现分支 | **不存在** |
| 生产默认入口 | **legacy** |
| R1 | `accepted`（v0.1.3；baseline `8d7e9b3`） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked`（见 R0 §16；R2 accepted **不**自动解锁） |
| 本轮授权 | **仅起草**；复核通过前不得实现 |

---

## 2. 目标（一句话）

在 `renderer-next` 中**独立重建**可用的会话列表和聊天页面，沿用 **main 权威**、**JSON sessions** 与已验收的 **displayText / modelText / attachmentRefs 分离模型**；**不复用旧隐藏 DOM**，不迁移其他业务页面，并始终可**整窗返回 legacy**。

---

## 3. 当前代码事实（只读核对 · 2026-07-21 · HEAD `373fef9`）

以下为**现状事实**，不是 R2 完成声明。实现时以源码为准；任务包合同不得凭印象改名。

### 3.1 存储

| 项 | 事实 |
|---|---|
| 模块 | `digitalme-app/src/sessions.js` |
| 路径 | `path.join(userData, "workbench-sessions.json")`（`sessionsPath(userData)`） |
| Store 默认形状 | `{ version: 1, activeId: null, sessions: [] }` |
| 导出会话字段（create） | `id`, `title`, `createdAt`, `updatedAt`, `messages`, `attachments`, `artifacts`, `packagePath` |
| 列表摘要 | `{ activeId, sessions: [{ id, title, updatedAt, createdAt, preview }] }` |
| 导出函数 | `sessionsPath`, `loadStore`, `listSessions`, `getSession`, `createSession`, `saveSession`, `renameSession`, `deleteSession`, `setActive` |
| 标题上限 | rename：`String(title\|\|"未命名").slice(0, 60)`（与 `session-overflow-menu.js` 的 `SESSION_TITLE_MAX = 60` 对齐） |
| 消息持久化 | `saveSession` 对每条 message 调用 `toPersistableMessage`；失败则 schema v2 占位 `displayText: "这条历史消息无法显示。"` |

### 3.2 消息模型（`chat-message-model.js`）

| 常量 | 值 |
|---|---|
| `SCHEMA_VERSION` | `2` |
| `MODEL_TEXT_MAX` | `4000` |
| `DISPLAY_TEXT_MAX` | `2000` |
| `LEGACY_QUESTION_MAX` | `500` |
| `FOLD_PREVIEW_CHARS` | `1600` |
| `FOLD_EXPAND_MAX` | `8000` |
| `LEGACY_ATTACH_SEP` | `"\n\n---\n以下是我附上的材料正文"` |
| `SESSION_NAV_BLOCK_MESSAGE` | `"请先停止当前回复，再切换对话。"` |

Persistable 字段：`schemaVersion`, `id`, `role`, `displayText`, `modelText`, `attachmentRefs`, `createdAt`。  
`attachmentRefs`：`{ id, name }`，可选 `type`（≤80）、`size`；**不含 path / 正文**。  
关联文稿卡：`chat-artifact-link.js`（`buildLinkCardState` / `applyLinkCardToDom`）；卡状态**不含 content**。

### 3.3 现有 IPC / preload（可复用语义）

| IPC | preload（`window.digitalMe`） | 备注 |
|---|---|---|
| `sessions:list` | `listSessions` | 保留语义 |
| `sessions:get` | `getSession` | 保留语义 |
| `sessions:create` | `createSession` | 保留语义；main 可注入 `packagePath` |
| `sessions:save` | `saveSession` | 保留语义；R2 宜收窄为受控保存 |
| `sessions:rename` | `renameSession` | `{ id, title }` |
| `sessions:delete` | `deleteSession` | 保留语义 |
| `sessions:setActive` | `setActiveSession` | 保留语义 |
| `chat:send` | `sendChat` | payload：`{ pkg, history, requestId, attachmentContext, scenarioHint }` |
| `chat:stop` | `stopChat` | `{ requestId }` |
| `chat:progress` | `onChatProgress` | main→renderer；含 `requestId` 与 phase |
| `chat:pickAttachments` | `pickAttachments` | 选文件；正文当轮提取 |
| `library:importArtifact` 等 | `importArtifactToLibrary` 等 | 关联文稿相关；R2 仅窄化聊天路径所需 |

`runtime.apiVersion` 当前为 `1`（R1 stamp facade）。R1 harness：`DIGITALME_R1_SPIKE_HARNESS` / `DIGITALME_R1_OWNER_RUNTIME`；`runtime.testRequestNext` 等 **test-only**。

### 3.4 并发与导航（现状 vs 目标）

| 层 | 现状 |
|---|---|
| Renderer（legacy `app.js`） | `activeChatRequest = { requestId, originSessionId, originMessageId, bubbleEl }`；已有请求则 `send()` 直接 return；`sessionNavGuard` 挡切换/新建/删除 |
| Main | `activeChatAborts: Map` 按 `requestId` 管理 AbortController；**未见**全应用单飞拒绝第二路 `chat:send` |
| R2 目标 | **main 结构化 `activeRequest` + 全应用单活动聊天请求**（见 §10）；不得继续依赖「仅 renderer 单飞」 |

### 3.5 `renderer-next` 现状

仅空壳：`AppShell.tsx`（stamp、effectiveEntry、ready、「返回经典界面」、Error Boundary、能力标签「预览」）。**无**会话列表、聊天、路由业务页。

### 3.6 已知技术债（R2 必须显式处理或记录）

1. Assistant 持久化经 `clampDisplayText` 上限 **2000**，与折叠展开上限 **8000** 不一致（执行索引 backlog）。
2. Legacy 流式预览截断 **1200** 与 `FOLD_PREVIEW_CHARS` **1600** 不一致。
3. Store `version: 1` 无升级分支；消息 schema 以 `schemaVersion === 2` 为准。

---

## 4. 范围内（必须做）

1. `renderer-next` **会话列表**
2. **新建会话**
3. **切换会话**
4. **行内改名**（不使用原生 `prompt`）
5. **自定义删除确认**（不使用原生 `confirm`）
6. 会话右侧 **省略号菜单**（改名 / 删除）
7. **聊天消息显示**（仅 `displayText`）
8. **发送消息**
9. **流式响应**显示
10. **停止当前回复**
11. **请求中会话导航保护**
12. **当前会话恢复**（`activeId`）
13. **应用重启后的历史恢复**
14. **关联文稿紧凑卡**
15. **打开关联文稿**的受控去向（不得在聊天页内联全文）
16. **关闭关联文稿并立即持久化**
17. **displayText / modelText / attachmentRefs 分离**
18. **旧历史安全降级**
19. **main 权威请求注册与并发门禁**
20. **类型化 preload session/chat API**
21. **Playwright Electron 真实 E2E**
22. **整窗返回 legacy**
23. **production 默认仍为 legacy**
24. **hermetic sessions**、隔离 userData、非真实 Package

---

## 5. 范围外（明确不做）

- 「我」页面；构建向导；工作台写作/研究/代码；能力页；设置迁移
- Package 数据迁移；SQLite；R2.5；PAN-02
- PAN-01R 生产入口；删除 legacy；iframe / webview
- 新 renderer 驱动旧隐藏 DOM；用 CSS 隐藏旧页面冒充迁移
- 大规模 main / preload 无关重写；对现有模型服务无关重构
- 自动迁移或清理**真实**旧会话；改变生产默认入口为 next
- 批量重写全部历史；引入跨会话聊天并发（另开任务）

---

## 6. 用户主路径

```text
默认打开 → legacy 经典界面正常
→（仅 harness / Owner / E2E 门禁）整窗进入 next 对话页
→ 看到会话列表 + 当前聊天（或空状态 +「新对话」）
→ 新建 / 切换 / 行内改名 / 省略号删除（自定义确认）
→ 输入并发送 → 流式显示回复 → 可停止
→ 请求中：禁止新建/切换/删除/改关联；提示先停止
→ 关联文稿仅紧凑卡；可打开受控去向；可关闭并立即保存
→ 重启后会话与消息仍在（hermetic / 副本验收）
→ 随时「返回经典界面」；next 失败自动回 legacy
```

用户面文案须严谨、明白、中性；禁止把 `requestId`、P0～P4、schemaVersion、IPC 名等内部词暴露给普通用户。

---

## 7. 数据模型（字段级合同）

### 7.1 Session（JSON store 内单条）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `id` | string；形如 `s_…` | 稳定主键 |
| `title` | string；展示与持久化上限 **60** | 空则「未命名」/「新对话」策略与 legacy 对齐 |
| `messages` | Message[] | 见 §7.2 |
| `artifacts` | array | 关联文稿引用；聊天页不渲染正文 |
| `attachments` | array | 会话级附件元数据（若沿用）；正文不入气泡 |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | 保存时更新；列表按此排序 |
| `packagePath` | string \| null | 可选；不得向普通 UI 泄漏绝对隐私路径文案 |

**当前会话选择：** store 级 `activeId`（`sessions:setActive` / create/save 副作用与现状对齐；R2 须类型化并校验存在性）。

**Store 外壳：** 继续 `{ version, activeId, sessions }`；R2 **不**引入 SQLite。Store `version` 与消息 `schemaVersion` 分离；消息以 **schema v2** 为权威。

### 7.2 Message（persistable）

| 字段 | 约束 |
|---|---|
| `schemaVersion` | 新消息必须为 **`2`** |
| `id` | string；形如 `m_…` |
| `role` | `"user"` \| `"assistant"` |
| `displayText` | UI 唯一可信展示源；持久化经 `clampDisplayText`；上限合同见 §7.3 |
| `modelText` | 仅供模型历史；**禁止**直接渲染；上限 `MODEL_TEXT_MAX = 4000` |
| `attachmentRefs` | `{ id, name, type?, size? }[]`；**无正文、无绝对路径必填** |
| `createdAt` | ISO string |

### 7.3 冻结展示与折叠规则

1. UI **只能**展示 `displayText`（经安全适配后的结果）。
2. `modelText` **不得**直接渲染。
3. 附件正文 **不得**复制进可见气泡。
4. 附件引用使用结构化 `attachmentRefs`（哈希或受控 id；不得依赖可读绝对路径作为 UI）。
5. 新消息持久化 **不得**保存当轮拼接后的完整 `requestContent` / 附件正文。
6. 旧 `content`、旧 `display` 等字段 **默认不可信**（KIMI `display` 永不作为 UI 源）。
7. 能可靠抽取原问题时 **只显示原问题**（可附「材料正文已隐藏」类安全说明）。
8. 不能可靠抽取时显示 **安全占位**（如「这条历史消息无法显示。」/「正文已隐藏」）。
9. **不得**以「截取前 4000 字」作为旧历史修复策略。
10. 联系方式、履历、附件正文 **不得**因恢复历史而铺满页面。
11. Assistant 长消息折叠：**预览 `FOLD_PREVIEW_CHARS = 1600`**；**展开上限 `FOLD_EXPAND_MAX = 8000`**。R2 必须统一流式预览与折叠数字，并在实现中消除与 `DISPLAY_TEXT_MAX = 2000` 冲突的产品歧义（建议：UI 展开可读至 8000；持久化 display 策略在实现分片 R2-C 写清并经 Codex 确认，禁止静默丢弃用户可见已展开内容而不说明）。
12. 损坏消息应 **跳过或安全占位**，不得导致整个会话无法打开。

---

## 8. 状态所有权表

| 状态 | 权威来源 | 谁可修改 | 持久化 | 重启恢复 | renderer 仅副本？ | 竞态风险 | 错误后恢复 |
|---|---|---|---|---|---|---|---|
| 会话列表 | main / `sessions.js` | main（经 IPC） | `workbench-sessions.json` | `sessions:list` | 是 | 双写 | 提示重试；可回 legacy |
| 当前会话 ID | main `activeId` | main `setActive`/create/save/delete | 是 | `list`/`setActive` | 是 | 请求中切换 | 导航门禁；失败保持原 ID |
| 会话标题 | main session.title | main `renameSession` | 是 | get/list | 是 | 改名中切换 | 回滚输入；提示失败 |
| 消息历史 | main session.messages | main `saveSession` + chat 完成路径 | 是 | `getSession` | 是 | 流式未落盘 | 完成/停止后再保存；失败可重试保存 |
| displayText | message 字段；适配逻辑在共享模型 | main 持久化路径；renderer 只读展示 | 是（v2） | normalize | 是 | 误渲 modelText | 安全占位 |
| model context | message.modelText；当轮 attachmentContext 仅请求内 | main 组装请求 | modelText 持久化；正文不持久化 | 历史用 modelText | 是 | 正文泄漏 | 禁止写入 display |
| attachmentRefs | message.attachmentRefs | 发送路径构建 | 是 | 是 | 是 | 带 path | 剥离 path |
| 当前关联文稿 | session.artifacts + 卡状态 | main 保存；UI 触发 clear/open | 是 | getSession | 是 | 请求中修改 | 请求中禁止；失败提示 |
| 当前请求 | **main `activeRequest`**（目标） | 仅 main | 进程内 | 不恢复为「进行中」 | renderer 持只读快照 | 双请求 | 停止或标记失败 |
| requestId | main 生成或校验 | main | 否（审计可记） | 否 | 是 | 伪造完成 | 校验后丢弃 |
| 请求所属会话 ID | `activeRequest.originSessionId` | main 在 send 时绑定 | 否 | 否 | 是 | 切换会话 | 增量只写归属会话 |
| 流式目标消息 | `activeRequest.assistantMessageId` | main / 约定消息 id | 完成后随 session | 否 | 是 | 写错气泡 | 校验三元组 |
| 停止状态 | main abort map + activeRequest.status | `chat:stop` | 否 | 否 | 是 | 停止失败 | 提示重试；仍禁导航至结束 |
| 会话导航保护 | main 依据 activeRequest | main 拒绝 IPC | 否 | 否 | UI 提示副本 | 绕过 | 统一 main 拒绝 |
| 持久化状态 | main 写盘结果 | main | 文件 | 读盘 | 是 | 写失败 | 明确错误；保留草稿 |
| rendererEntry | R1 controller | main | 偏好可持久；effective 进程内 | 默认 legacy | 是 | 循环切换 | latch + 回 legacy |
| fallback latch | R1 controller | main | 进程内 | 清进程后重置 | 是 | 重进 next | 本进程不再自动 next |
| runtime stamp | main | 只读 | 否 | getStamp | 是 | — | — |

**冻结原则：**

- sessions 权威在 **main**；renderer **不**直接读写 sessions 文件；
- 当前请求注册表权威在 **main**；
- 每个请求绑定 `originSessionId`（及 `assistantMessageId`）；
- 流式增量只能写入所属会话与所属消息；
- renderer 切换页面 **不能**改变请求归属；
- renderer 状态 **不是**第二业务权威。

---

## 9. main / preload API（目标合同）

> 下列为 R2 **目标**窄化、类型化 API。标注：`保留` = 现有 IPC 语义可复用；`适配` = 保留通道但收紧校验/类型；`新增` = 现状缺失；`废止` = R2 next 路径不得再依赖。

### 9.1 Sessions

| 语义名 | 建议绑定 | 处置 | 说明 |
|---|---|---|---|
| `listSessions` | `sessions:list` | 保留→适配 | 返回摘要 DTO；无绝对路径 |
| `getSession` | `sessions:get` | 保留→适配 | 返回经 normalize 的安全消息视图 + 原始 persist 分离策略在 main |
| `createSession` | `sessions:create` | 适配 | 请求中拒绝（§10） |
| `renameSession` | `sessions:rename` | 适配 | title ≤60；请求中拒绝 |
| `deleteSession` | `sessions:delete` | 适配 | 请求中拒绝 |
| `setCurrentSession` | `sessions:setActive` | 适配 | 请求中拒绝 |
| `persistSession` | `sessions:save` 或更窄 `sessions:persist` | 适配/可选新增 | 禁止任意对象透传；只接受校验后 DTO |

### 9.2 Chat

| 语义名 | 建议绑定 | 处置 | 说明 |
|---|---|---|---|
| `sendChat` | `chat:send` | 适配 | 必须带 `sessionId`；main 注册 `activeRequest`；拒绝并发 |
| `stopChat` | `chat:stop` | 适配 | 仅匹配当前 `requestId` |
| `subscribeChatDelta` | 基于 `chat:progress` phase=`delta` | 适配 | 事件必须含 `requestId`, `sessionId`, `messageId` |
| `subscribeChatComplete` | `chat:progress` done/stopped | 适配 | 同上 |
| `subscribeChatError` | `chat:progress` error | 适配 | 同上 |
| `getActiveRequest` | **新增**只读 IPC 或并入 entry snapshot | 新增 | 返回结构化 activeRequest 或 null |
| `pickAttachments` | `chat:pickAttachments` | 保留→适配 | 正文仅当轮；不回传绝对路径给 UI 文案 |

### 9.3 Linked artifact（聊天路径）

| 语义名 | 处置 | 说明 |
|---|---|---|
| `openLinkedArtifact` | 适配现有 library/open 路径 | 受控去向；聊天页不内联全文 |
| `clearLinkedArtifact` | 适配 | 清除后 **立即** `persist`；请求中拒绝 |

### 9.4 强制约束

1. 能复用的现有 IPC **优先适配**，不平行发明第二套文件存储。
2. **禁止**任意对象透传；**禁止**暴露 `fs`、Node、绝对隐私路径给普通 UI。
3. 所有输入校验；IPC sender 必须绑定当前合法窗口（继承 R1）。
4. 流式事件必须携带 `requestId`、`sessionId`、`messageId`。
5. renderer **不得**自行伪造请求完成。
6. 普通 renderer **不能**启用 test harness；query/hash/localStorage **不能**开启 harness。
7. PAN-01R test-only 门禁保持不变。
8. **本任务包不宣称上述目标 API 已实现。**

---

## 10. 并发与导航合同

### 10.1 决策（冻结推荐）

- **同一会话同一时刻最多一个活动回复。**
- **Alpha 阶段：全应用单活动聊天请求**（不同会话亦不可并发）。
- 若未来需要跨会话并发，**另开任务**；本 R2 不做。
- **不沿用**容易覆盖的全局裸 `currentRequestId` 作为权威。
- main 使用结构化 `activeRequest`：

```text
{
  requestId,
  originSessionId,
  assistantMessageId,
  startedAt,
  status  // e.g. running | stopping | completed | failed
}
```

### 10.2 请求中禁止 / 允许

**禁止：** 新建会话；切换会话；删除会话；改变关联文稿；第二次 `sendChat`。  
**允许：** 停止当前回复；返回 legacy（须先定义：建议允许返回，但 main 应 abort 或明确提示；默认 **先停止或随返回 abort 当前请求**，并在任务实现时写清，避免僵尸请求）。

停止完成或请求结束后再解除导航保护。  
连续 Enter、双击发送、重复 IPC **只能产生一次请求**。  
迟到 delta / complete、旧 `requestId` **全部丢弃并审计**。  
`finally` **只能**清除与自己 `requestId` 相同的活动请求。

---

## 11. UI 合同（renderer-next 对话页）

**必须具备：**

1. 左侧会话列表  
2. 「新对话」  
3. 标题 + 右侧 `⋯`  
4. `⋯` 内「改名」「删除」  
5. 行内改名（无 `prompt`）  
6. 自定义删除确认（无 `confirm`）  
7. 消息列表  
8. 用户气泡  
9. assistant 气泡  
10. 长回答折叠（1600 / 8000）  
11. 关联文稿紧凑卡  
12. 输入框  
13. 发送  
14. 停止  
15. 请求中导航提示（用户可读文案；可沿用「请先停止当前回复，再切换对话。」）  
16. 错误恢复入口（新建对话 / 重试 / 返回经典界面）  
17. 「返回经典界面」

**禁止：**

- 聊天页内联关联文稿全文；显示附件全文  
- `prompt` / `confirm` / `alert`  
- CSS 隐藏旧页面冒充迁移；新按钮触发旧 renderer DOM  
- 向普通用户显示 P0～P4、`requestId` 等内部名  
- 页面失控后**只**提供「重启应用」一种恢复方法  

能力状态标签：对话页在 R2 验收前对普通用户仍无生产入口；harness 内可标「预览」或同等冻结标签。

---

## 12. 旧历史与数据兼容

1. R2 默认读取现有 **JSON** sessions（`workbench-sessions.json`）。  
2. **不**引入 SQLite。  
3. 新旧 renderer **必须**能读取同一会话数据。  
4. **不允许**两个 renderer 同时写同一会话（整窗互斥；切换前 main 完成必要持久化）。  
5. 整窗切换前由 main 完成必要持久化。  
6. schema v2 **原样使用**。  
7. schema v1 / 旧消息只做**安全展示适配**（`legacyDisplayText` / `normalizeLoadedMessage` 合同）。  
8. **不**在首次启动时批量重写全部真实历史。  
9. 如需迁移：仅允许逐会话、备份、可回滚，且 **Owner 另行授权**。  
10. 本任务实现与测试 **不得**读取真实 sessions 正文。  
11. Owner 验收前使用 **副本** 或人工新建测试会话。  
12. 「损坏会话无法打开」：列表仍可用；该会话占位错误 + 可删除或跳过；提供新建干净会话。  
13. 「新建干净会话」：**永久可见**入口。  
14. 「关闭关联文稿」：**永久可见**入口（卡上关闭），并立即持久化。

---

## 13. 错误恢复

| 场景 | 用户看到什么 | 可重试？ | 保留输入草稿？ | 可能丢消息？ | 审计 | 返回经典 |
|---|---|---|---|---|---|---|
| 会话列表读取失败 | 明确失败说明 + 重试 + 新建/回经典 | 是 | N/A | 否（未加载） | 读失败 | 是 |
| 单个会话损坏 | 该会话打不开；列表其余可用 | 否打开 / 可删 | N/A | 该会话可能不完整 | 规范化失败 | 是 |
| 保存失败 | 保存失败，勿切换 | 是 | 是 | 未保存部分有风险 | 写失败 | 是 |
| 模型调用失败 | 错误说明；可重发 | 是 | 是 | 未完成 assistant 不落盘或标失败 | 错误码 | 是 |
| 流式中断 | 已生成部分是否保留按完成策略；提示中断 | 可重试新请求 | 是 | 部分 | 中断 | 是 |
| 停止失败 | 仍显示停止中/失败；保持导航保护直至 main 确认结束 | 是 | 是 | 低 | stop 失败 | 是 |
| 删除/改名失败 | 操作失败，界面回滚 | 是 | N/A | 否 | 否 | 是 |
| 关联文稿打开失败 | 无法打开说明 | 是 | N/A | 否 | 是 | 是 |
| 关闭关联保存失败 | 未关闭成功/未保存 | 是 | N/A | 关联状态可能旧 | 是 | 是 |
| API 版本不匹配 | 提示需更新/回经典 | 否业务 | 是 | 否 | 版本 | **必须**可回 |
| renderer-next 崩溃 | Error Boundary + 回经典 | 回经典 | 尽量保留至 main | 未保存风险 | 是 | 自动/按钮 |
| 返回 legacy 失败 | 严重错误说明；避免循环 | 有限次 | — | — | 是 | latch 防抖 |

---

## 14. 安全与隐私

- hermetic userData；E2E / 单测 **禁止**指向真实 Package / 真实 sessions 正文。  
- 8 万字级附件正文 **不得**进入聊天 DOM（main 当轮 `attachmentContext` 上限现状约 `80000`；UI 仍只显示名称/卡）。  
- 不暴露 API Key、Token、密码。  
- 保持 `contextIsolation: true`、`nodeIntegration: false`。  
- 无生产 PAN-01R 入口。  

---

## 15. 测试计划

### 15.1 分类

1. 纯函数单测（`chat-message-model`、nav guard、fold、legacy 降级）  
2. main session/chat 合同测试（校验、单飞、事件三元组）  
3. hermetic JSON sessions 测试  
4. renderer 组件测试（列表、气泡、卡、菜单）  
5. Playwright Electron E2E  
6. legacy owner-runtime 回归  
7. 隐私泄漏测试（附件正文 / 路径）  
8. 并发测试（双发、迟到事件）  
9. 故障恢复测试  
10. Owner 真机验收  

### 15.2 Playwright 必须真实覆盖

- 默认仍为 legacy  
- harness 进入 next 聊天页  
- 新建会话；行内改名；自定义删除  
- 发送与流式显示；停止回复  
- 连续发送只产生一次请求  
- 请求中切换/新建/删除被阻止  
- 重启后恢复  
- 旧历史安全降级  
- 8 万字附件正文不进入聊天 DOM  
- 关联文稿只显示紧凑卡；关闭关联立即保存  
- 损坏会话不拖垮列表  
- 模型失败可恢复  
- 返回 legacy；next 失败自动回 legacy  
- query/hash/localStorage 不能开启 test harness  

**时限：** 单用例 ≤60s；R2 最小 E2E 套件 ≤10min。禁止用静态字符串测试冒充真实用户操作。

---

## 16. Owner 白话验收清单（≤12）

1. 原界面默认正常打开。  
2. 在受控方式下能进入新对话页。  
3. 能新建、改名、删除对话。  
4. 能发送消息并收到完整回复。  
5. 能停止正在生成的回复。  
6. 回复过程中不能误切到别的对话。  
7. 关闭应用再打开，对话还在。  
8. 发送带附件的消息后，正文不会铺满页面。  
9. 关联文稿只显示一张小卡片，不是整篇正文。  
10. 出错后能新建对话，或返回经典界面。  
11. 不白屏、不在新旧界面之间来回乱跳。  
12. 原有真实数据不被破坏（验收用副本/测试会话；不批量改真实历史）。  

---

## 17. 实施分片（仅规划，不实施）

| 分片 | 内容 |
|---|---|
| **R2-A** | sessions / chat 类型化合同；main `activeRequest`；输入校验 |
| **R2-B** | 会话列表与管理（新建/切换/改名/删除/菜单） |
| **R2-C** | 消息显示、折叠统一、旧历史安全适配 |
| **R2-D** | 发送、流式、停止、单飞门禁、导航保护 |
| **R2-E** | 附件 / 关联文稿隔离与恢复 |
| **R2-F** | E2E、legacy 回归、Owner 验收 |

规则：分片可分别提交；**不得**同一轮大爆炸替换；每片保持可返回 legacy；任一片失败不得继续下一片；是否单实现分支待 Codex 复核后决定。

---

## 18. 完成条件

- 类型化 API 合同落地  
- renderer-next 聊天主路径完整  
- JSON sessions 兼容；display/model/attachment 分离  
- main 请求注册与单飞门禁  
- E2E 持续通过；legacy 回归通过  
- 生产默认仍 legacy；无生产 PAN-01R 入口  
- Codex 复核通过；Owner 真机验收通过  

---

## 19. 停止条件

- 需要读取或批量迁移真实 sessions  
- 新旧 renderer 同时写会话  
- 附件正文重新进入可见消息  
- 需要引入 SQLite / 启动 R2.5  
- 范围扩到「我」/构建/工作台/设置  
- 生产默认被改为 next  
- 继续在旧 `app.js` 堆新业务冒充迁移  
- E2E 无法真实验证用户主路径  
- PAN-02 被提前启动  

---

## 20. 迁移、回滚与发布边界

1. R2 实现期间生产默认 **legacy**。  
2. next 仅经 main 控制的开发 / Owner / E2E 门禁进入。  
3. R2 验收前普通用户无 next 入口。  
4. 任一关键错误可整窗返回 legacy。  
5. 不删除 legacy chat。  
6. 不批量迁移真实 sessions。  
7. R2 `accepted` 后是否改变生产默认：**另行决策**。  
8. R2 **不**自动解锁 PAN-02。  
9. PAN-02 仍须满足 R0 §16 全部条件（含至少 R2+R3 Owner 真机或书面豁免等）。  
10. R3「我/构建」未完成前，PAN-02 继续 `blocked`。  

---

## 21. 风险与未决问题（≤5）

1. **display 持久化 2000 vs 展开 8000**：产品上如何统一，而不造成「展开后刷新变短」？  
2. **返回 legacy 时进行中请求**：强制 abort 还是阻止返回直至停止？  
3. **`sessions:save` 任意对象透传**的收窄是否拆新 IPC，以免破坏 legacy 过渡期？  
4. **流式 progress 事件**是否在 R2 强制升级为带 `sessionId`/`messageId` 的新载荷（legacy 兼容策略）？  
5. **实现分支策略**：单分支串行分片 vs 每片短分支——待 Codex 裁定。  

---

## 22. 调度

| 项 | 值 |
|---|---|
| 本文件 | **v0.1-draft** / `specified` / `codex_review_pending` / `not_started` |
| 当前唯一等待项 | **Codex 复核本 R2 任务包** |
| 复核通过前 | **不得**创建 R2 实现分支；**不得**修改源码 |
| R1 | `accepted`（不变） |
| R2.5 | `planned` / `deferred` |
| PAN-02 | `planned` / `blocked` |
| 生产默认 | legacy |

---

## 23. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-21 | **v0.1-draft** | 初稿：基于 `373fef9` 只读代码事实起草；状态 `specified` / `codex_review_pending` / `not_started`；等待 Codex 复核 |
