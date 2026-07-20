# Renderer Foundation R1：最小 shell 与整窗入口切换

版本：v0.1-draft  
日期：2026-07-20  
状态：`specified` / `frozen_for_implementation` / `codex_review_pending` / `not_started`  
性质：**独立实施任务包**（规格冻结候选）；**Codex 复核通过前不得创建实现分支或修改源码**  
所属主线：`P1-PANORAMA`（三位一体 Alpha）  
前置：Renderer Foundation R0 **`accepted`**（v0.1.2；决策接受）  
依据：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` §10 / §11 / §14.1 / §15  
建议实现分支名（**仅在 Codex 复核通过并获实现授权后创建**）：`codex/r1-renderer-next-shell`

> **状态语义**
>
> - `codex_review_pending`：等待 Codex 复核本任务包；
> - `not_started`：实现未开始；**实现分支不存在**；
> - **禁止**在复核通过前 `npm install`、改 `package.json`/lockfile、改 `digitalme-app` 源码、启动 Electron；
> - **禁止**启动 PAN-02；R2.5 SQLite 保持 `planned` / `deferred`；
> - 本切片**不**改变 PAN-01S 族 `accepted`；
> - 工程完成后最高 `statically_verified`；未经 Owner 真机验收不得将 R1 标为产品面「可用」或删除 legacy。

角色：Owner（验收）＋ Codex（规格复核）＋ Cursor（实现）

---

## 1. 目标（一句话）

在**不迁移任何业务页面**的前提下，建立可启动、可回滚、可测的 `renderer-next` 最小壳，并由 **main 权威**完成 legacy/next **整窗**入口切换；next 加载或 ready 握手失败时 **main 自动回退 legacy**。

---

## 2. 范围内（必须做）

1. **`renderer-next` 最小目录与构建**（Vite；独立 `index.html`）。  
2. **TypeScript** 工程基线（`tsconfig`、路径约定）。  
3. **React shell**：AppShell + 占位路由（无 chat / 我 / 构建 / 工作台业务）。  
4. **Vite**：开发模式与 **production-load**（或等价打包后加载路径）。  
5. **Error Boundary**：shell 级；可演示捕获与降级文案（用户面中性、无协议黑话）。  
6. **runtime stamp 类型化 preload facade**：暴露只读 commit/runtime 标识；`apiVersion` 起步。  
7. **main 权威 `rendererEntry`**：`legacy` | `next`；生产默认 **`legacy`**；renderer **不得**改写生产默认。  
8. **整窗切换**：两独立 HTML 入口；**禁止** iframe/webview；**禁止**一窗双状态机。  
9. **自动回退（强制）**：next **load 失败**或 **ready 握手超时/失败** → main **自动**整窗加载 legacy；记录可审计原因（无隐私正文）。ready 超时默认 **≤10s**（可在实现中微调但须写入测试）。  
10. **「返回经典界面」最小路径**（可选于 shell 占位页）：经 main 持久化必要偏好后整窗 legacy（R1 可仅实现开关 + 自动回退；完整「未迁移路由」文案可极简）。  
11. **Playwright Electron 最小 E2E**（见 §7）。  
12. **依赖版本锁定**：React / Vite / Playwright / TypeScript 等在 **兼容性 spike** 后写入本任务包修订版 + lockfile；**未锁定不得宣称 R1 完成，更不得进入 R2**。  
13. **隔离 userData** 跑 E2E；不触碰真实 Package/sessions 正文。

---

## 3. 范围外（明确不做）

- chat / 会话列表迁移  
- 「我」或构建向导  
- 工作台（写作/研究/代码）  
- SQLite / R2.5  
- Package 数据迁移  
- PAN-02 理解通道  
- 大规模 preload 重写（仅最小 facade）  
- 删除 legacy renderer  
- 新增 Spectron  
- 把生产默认改为 `next`

---

## 4. 技术约束（继承 R0）

| 项 | 约束 |
|---|---|
| 壳 | 继续 Electron |
| 新表面 | TypeScript + React + Vite（确切版本 spike 锁定） |
| E2E | Playwright Electron；单测例默认 60s；整套最小套件 ≤10 min |
| 旧 harness | owner-runtime **保留**作 legacy 回归；本轮不删除 |
| 状态权威 | Package / sessions / P0～P4 仍在 main；R1 不改业务合同 |
| 文案 | 用户面严谨、明白、中性；禁止开发黑话 |

---

## 5. 兼容性 spike（R1 实现第一步，仍属本任务）

在创建实现分支并获授权后，**先**完成 Windows 本地 spike，再写业务壳代码：

1. Vite + Electron 加载 `renderer-next`（dev 与 production-load）。  
2. Playwright 能拉起应用并读到 runtime stamp。  
3. legacy↔next 整窗切换可用。  
4. 模拟 next 失败 → 自动落 legacy。  

Spike 结论写入任务包修订（锁定版本表）后，方可扩大实现。若 spike 失败：停止扩 scope，回退文档说明，保持生产默认 legacy。

### 5.1 版本锁定表（实现时填写）

| 包 | 目标族 | 锁定版本（spike 后填） |
|---|---|---|
| react / react-dom | React | _TBD_ |
| vite | Vite | _TBD_ |
| typescript | TS | _TBD_ |
| @playwright/test 或等价 | Playwright | _TBD_ |
| 其他必要插件 | — | _TBD_ |

---

## 6. main / preload 最小契约（R1）

建议面（名称可在实现中微调，语义冻结）：

```text
runtime.getStamp() -> { ok, commit, ... }
runtime.getRendererEntry() -> { ok, entry: "legacy"|"next" }
runtime.requestRendererEntry(entry, reason) -> { ok }  // 受控；不可静默改生产默认
runtime.signalReady() -> void                         // next shell 握手
// load/ready 失败路径仅 main 内部，不依赖 renderer 自觉
```

禁止：renderer 直改生产默认；任意通道透传；暴露 Node/fs；PAN-01R 生产入口。

---

## 7. 完成定义（必须全部满足）

### 7.1 工程

- [ ] `renderer-next` 可在 Windows 本地启动（dev）。  
- [ ] production-load 或等价路径可加载 next 壳。  
- [ ] TypeScript 检查通过。  
- [ ] 版本与 lockfile 已锁定并记入本任务包。  
- [ ] 生产默认仍为 legacy。  
- [ ] 无真实 Package 写入；E2E 使用隔离 userData。  
- [ ] 未引入 Spectron；未做范围外功能。

### 7.2 Playwright Electron 最小套件

- [ ] 启动应用并校验 runtime stamp。  
- [ ] 隔离 userData。  
- [ ] legacy 入口可启动（默认）。  
- [ ] 切换至 next 整窗加载 shell 成功。  
- [ ] next shell Error Boundary 可触发/可见（受控测试钩子或故意错误夹具）。  
- [ ] next load 或 ready 失败 → **自动**落 legacy（至少一条）。  
- [ ] 可再切回 legacy（显式请求路径）。  
- [ ] 套件在超时口径内完成。

### 7.3 复核与验收

- [ ] Codex 静态复核通过。  
- [ ] Owner 真机：能看到 stamp、能切 next 看空壳、能回 legacy、失败自动回退可演示（或接受 E2E 证据 + 抽查）。  
- [ ] **不得**因 R1 将产品默认可切换为 next 面向普通用户。

---

## 8. 进入 / 停止条件

**进入（实现）：**

1. 本任务包 Codex 复核通过（`codex_review_passed`）；  
2. Owner/流程授权创建实现分支；  
3. 分支从当前主线文档基线拉出（建议名见文首）。

**停止：**

- 范围滑向 chat/我/工作台/SQLite/PAN-02；  
- 无法自动回退 legacy；  
- 一窗双状态机或 iframe 混挂；  
- 新按钮驱动旧隐藏 DOM；  
- 读取真实个人资料/sessions 正文；  
- 生产默认被改为 next 且无 Owner 授权。

---

## 9. 测试分层提醒

| 层 | R1 要求 |
|---|---|
| 单元 | 可选；契约纯函数可测 |
| Playwright Electron | **必须**（完成门槛） |
| 既有 owner-runtime | 回归 legacy 不破即可；不替代 Playwright |
| Owner 真机 | 抽查切换与回退 |

---

## 10. 交付物清单

1. `renderer-next` 源码与构建配置  
2. main/preload 最小改动（入口开关 + ready + 自动回退）  
3. Playwright E2E 脚本与 npm script  
4. lockfile 与本任务包版本表修订提交  
5. 简短实现说明（可写在 log；不写用户面黑话）

---

## 11. 明确禁止

1. Codex 复核通过前创建实现分支或改源码。  
2. 实现期并行开启 R2/PAN-02。  
3. iframe/webview 嵌 legacy。  
4. 无自动回退。  
5. 新增 Spectron。  
6. 触碰 `digital-me-package/**` 真实数据或真实 sessions 正文。  
7. amend / squash / push 作为默认流程。

---

## 12. 调度

| 项 | 值 |
|---|---|
| 本文件 | `specified` / `frozen_for_implementation` / `codex_review_pending` / `not_started` |
| 实现分支 | **不存在**（待复核通过） |
| 预估 | ≤ 一个小里程碑 |
| 完成后下一步 | R2 任务包（另文）；不自动开始 |
| PAN-02 | `planned` / `blocked` |

---

## 13. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-20 | v0.1-draft | 初稿冻结候选；继承 R0 v0.1.2；待 Codex 复核 |
