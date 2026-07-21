# Renderer Foundation R1：最小 shell 与整窗入口切换

版本：v0.1.3
日期：2026-07-21
状态：`implemented` / `spike_partial_verified` / `codex_changes_requested`
性质：**独立实施任务包**；**实施规格已冻结（v0.1.1）**；兼容性 spike 已实现；Codex 指出有界缺陷后进入修复轮；**正式 R1 shell 完成度仍待修复复核通过后决定**；**不得**标 `empirically_verified` / `statically_verified` / `runtime_verified` / `accepted` / `released`
所属主线：`P1-PANORAMA`（三位一体 Alpha）
前置：Renderer Foundation R0 **`accepted`**（v0.1.2；决策接受）
依据：`digitalme_renderer_foundation_R0_decision_and_migration_plan.md` §10 / §11 / §14.1 / §15
实现分支：`codex/r1-renderer-next-shell`（Owner 已于 2026-07-21 授权）

> **状态语义**
>
> - **`implemented` / `spike_partial_verified` / `codex_changes_requested`**：spike 主体已落地，但 Codex 复核要求关闭 ready 竞态、显式 generation、导航单飞、Vite dev / Error Boundary 实证与工程收尾；**在修复复核通过前不得使用 `empirically_verified`**；
> - **正式 R1 shell**（完整 AppShell 占位路由与后续表面）**不得**在本修复轮继续扩展；
> - 生产默认入口仍为 **legacy**；普通用户路径无进入 next 的入口；
> - **禁止**启动 PAN-02；R2.5 SQLite 保持 `planned` / `deferred`；
> - 本切片**不**改变 PAN-01S 族 `accepted`；R0 **`accepted` 不变**；
> - 未经 Owner 真机验收不得将 R1 标为产品面「可用」或删除 legacy。

角色：Owner（验收）＋ Codex（规格/实现复核）＋ Cursor（实现）

---

## 1. 目标（一句话）

在**不迁移任何业务页面**的前提下，建立可启动、可回滚、可测的 `renderer-next` 最小壳，并由 **main 权威**完成 legacy/next **整窗**入口切换；next 加载或 ready 握手失败时 **main 自动回退 legacy**，且具备防循环 latch 与加固握手。

---

## 2. 范围内（必须做）

1. **`renderer-next` 最小目录与构建**（Vite；独立 `index.html`）。
2. **TypeScript** 工程基线（`tsconfig`、路径约定）。
3. **React shell**：AppShell + 占位路由（无 chat / 我 / 构建 / 工作台业务）。
4. **Vite**：开发模式与 **production-load**（见 §6.4）。
5. **Error Boundary**：shell 级；故障注入仅经 main/test harness 门禁（见 §6.4）。
6. **runtime stamp 类型化 preload facade**：只读 commit/runtime 标识；`apiVersion` 起步。
7. **main 权威入口模型**：区分**持久化偏好**、**本进程 effectiveEntry**、**fallback latch**（见 §6.1–§6.2）。生产持久化默认 **`legacy`**。
8. **整窗切换**：两独立 HTML 入口；**禁止** iframe/webview；**禁止**一窗双状态机。
9. **自动回退 + latch（强制）**：next load/ready 失败 → main 自动整窗 legacy，并设置本进程 fallback latch（见 §6.2）。ready 超时默认 **≤10s**。
10. **「返回经典界面」**：普通 next UI 仅可请求 **next → legacy**（见 §6.1）。
11. **Playwright Electron 最小 E2E**（见 §7）；隔离 userData、独立进程、非真实 Package 路径。
12. **依赖版本锁定**：spike 后写入本任务包 + lockfile；未锁定不得宣称完成或进入 R2。
13. **Electron 安全基线**：`contextIsolation: true`、`nodeIntegration: false`（见 §6.4）。

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
- 向普通用户暴露进入 next 的生产入口
- 连续失败的长期隔离策略（留后续任务；本轮不扩展）
- 由任意 renderer IPC 改写持久化默认入口

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

## 5. 兼容性 spike（仅在 Owner 授权创建实现分支后）

**Owner 明确授权**创建 `codex/r1-renderer-next-shell` 之后，**第一步仅为**本兼容性 spike（不得跳过直接做业务壳）：

1. Vite + Electron 加载 `renderer-next`（显式 dev 与 production-load）。
2. Playwright 拉起应用并读到 runtime stamp。
3. **仅经 main/E2E 门禁**进入 next；普通路径只能 next→legacy。
4. 模拟 next 失败 → 自动 legacy + latch（同进程不再自动进 next）。

Spike 结论写入版本表后方可扩大实现。失败则停止扩 scope，保持生产默认 legacy。

### 5.1 版本锁定表（spike 锁定 · Windows / Electron 实证）

| 包 | 目标族 | 锁定版本 |
|---|---|---|
| react / react-dom | React | **18.3.1** / **18.3.1** |
| vite | Vite | **5.4.11** |
| typescript | TS | **5.7.3** |
| @vitejs/plugin-react | Vite React 插件 | **4.3.4** |
| @playwright/test | Playwright | **1.49.1** |
| electron（既有） | Electron | **32.3.3**（host 实证） |

**兼容性结果（2026-07-21，Windows）**：Node **v24.14.0**；npm **11.9.0**；Electron **32.3.3**。Vite production build 成功；Electron production-load 本地 `renderer-next/dist`；Vite dev URL 仅 `DIGITALME_VITE_DEV=1`（E2E 真实启动验证）；Playwright Electron 7/7；入口/latch/generation/单飞单测 8/8；legacy 冒烟通过。`package.json` 对本轮新增依赖使用**精确版本**（无 `^`）。

---

## 6. 启动安全契约（本轮冻结 · Codex 修订点）

### 6.1 入口切换权限

| 调用方 | 允许 | 禁止 |
|---|---|---|
| **普通 renderer**（含 next shell UI） | 仅请求 **`next → legacy`**（「返回经典界面」） | 请求 `legacy → next`；改写持久化默认值；任意 IPC 参数冒充开发开关 |
| **main 控制的开发 / E2E 开关** | 本进程内切换至 `next`（显式 env/配置/测试门禁） | 把该能力暴露为生产用户入口 |
| **生产普通用户面** | 始终以 legacy 为默认有效入口 | **R1 不向普通用户暴露进入 next 的生产入口** |

补充规则：

1. `runtime.requestRendererEntry(entry, reason)` **权限收窄**：从普通 preload 面调用时，**仅当** `entry === "legacy"` 且当前 `effectiveEntry === "next"` 时成功；其它方向由 main **拒绝**。
2. `legacy → next` **只能**由 main 在开发模式或 E2E harness 门禁下发起（非普通 renderer IPC 参数可伪造）。
3. **任何** renderer IPC **不得**改写**持久化**默认 `rendererEntry`（含「下次启动用 next」类偏好的用户可达写入；R1 生产路径不提供该写入）。
4. 查询 API 可返回：`preferredEntry`（持久化偏好，只读）、`effectiveEntry`（本进程实际）、`fallbackLatched`（布尔）。

### 6.2 失败后状态（load / ready 失败）

next **加载失败**或 **ready 握手超时/失败**时，main **必须**：

| 字段 / 动作 | 冻结结论 |
|---|---|
| 立即动作 | 整窗加载 **legacy** |
| `effectiveEntry` | **`legacy`** |
| **fallback latch（本进程）** | **置位**；本进程内**禁止再次自动进入 next**，避免失败↔重试循环 |
| 持久化 next 偏好 | **保留**（若曾由开发/E2E 写入测试偏好）；**记录失败**（类别 + 时间；无隐私正文）；**下次冷启动仍可按偏好重试**一次加载 next（成功则清除本次失败记录语义；再失败再次 latch） |
| 长期隔离 | **不做**；连续失败熔断/冷却留给后续任务 |

说明：生产默认持久化偏好仍为 `legacy`，故普通用户冷启动不会进 next；latch 主要保护「显式尝试 next」的开发/E2E/未来受控路径。

### 6.3 ready 握手加固

`runtime.signalReady()` **不是**无条件 IPC。冻结：

1. **只接受**同时满足：当前 **BrowserWindow**、当前 **next** 页面、当前 **navigation generation**（或等价世代令牌，由 main 在每次加载 next 时颁发）。
2. **一次性消费**：成功接受后，同世代再次 `signalReady` 无效。
3. **无效信号**（一律忽略）：旧页面、**legacy** 页面、超时后的迟到信号、世代不匹配、窗口已销毁。
4. **timer**：在握手成功、自动回退、窗口关闭、导航取消时**可靠清理**；禁止泄漏导致误回退或重复回退。

建议面（语义冻结；名称可微调）：

```text
runtime.getStamp() -> { ok, commit, ... }
runtime.getRendererEntry() -> {
  ok,
  preferredEntry: "legacy"|"next",   // 持久化偏好；只读
  effectiveEntry: "legacy"|"next",   // 本进程实际
  fallbackLatched: boolean
}
runtime.requestRendererEntry(entry, reason) -> { ok, code? }
  // 普通 renderer：仅 next→legacy
runtime.signalReady(generation) -> { ok }  // 或由 preload 绑定世代；无世代则失败
```

### 6.4 Electron 与测试钩子安全边界

| 项 | 冻结 |
|---|---|
| `contextIsolation` | **`true`** |
| `nodeIntegration` | **`false`** |
| production 加载 | **只加载本地构建产物**（`file:` / 应用内路径）；**禁止**生产指向任意远程 URL |
| Vite dev URL | **仅**显式开发模式（明确 env/cli）；生产构建路径不得启用 |
| Error Boundary 故障注入 | **仅** main / test harness 门禁开启；**禁止**生产 renderer、query、hash、`localStorage` 自行开启 |
| E2E | **隔离 userData**；**独立进程**；**非真实 Package 路径**；不读真实 sessions 正文 |

---

## 7. 完成定义（必须全部满足）

### 7.1 工程

- [x] `renderer-next` 可在 Windows 本地启动（显式 dev 配置已具备；本轮实证以 production-load 为主）。
- [x] production-load 仅加载本地构建产物。
- [x] TypeScript 检查通过；版本与 lockfile 已锁。
- [x] 生产默认 / 普通用户路径仍为 legacy；无生产「进入 next」入口。
- [x] §6.1–§6.4 契约有测试或可审计实现对应（spike 最小集）。
- [x] 无真实 Package 写入；E2E 隔离 userData + 独立进程 + 非真实 Package 路径。
- [x] 未引入 Spectron；未做范围外功能。

### 7.2 Playwright Electron 最小套件

- [x] 启动并校验 runtime stamp。
- [x] 隔离 userData；非真实 Package 路径。
- [x] 默认 legacy 可启动。
- [x] **经 E2E/main 门禁**进入 next 成功。
- [x] 普通 `requestRendererEntry("next")` 被拒绝（若从 next 外调用）。
- [x] next→legacy 请求成功。
- [x] Error Boundary 注入仅 harness 可开；生产路径不可用 query/hash/localStorage 开启。
- [x] next load 或 ready 失败 → 自动 legacy + **latch**（同进程再自动进 next 被拒）。
- [x] 迟到/错误世代 `signalReady` 无效。
- [x] 套件在超时口径内完成。

### 7.3 复核与验收

- [x] Codex 规格再复核通过（本文件 v0.1.1 冻结）。
- [x] **Owner 明确授权**创建实现分支并启动 spike（2026-07-21）。
- [ ] Owner 真机抽查（实现完成后）：默认 legacy、失败回退、无生产 next 入口。
- [x] **不得**因 R1 将 next 暴露给普通用户作为默认或主入口。
- [x] **不得**将本规格冻结误标为 `accepted` / `statically_verified` / `runtime_verified` / `released`（本轮仅 `implemented` / `empirically_verified` / `codex_review_pending`）。

---

## 8. 进入 / 停止条件

### 8.1 规格进入条件（相对实现）

| 条件 | 当前 |
|---|---|
| Codex 规格复核 | **已满足**（`codex_review_passed`，v0.1.1） |
| 规格冻结 | **已满足**（`frozen_for_implementation`；v0.1.1） |
| Owner 实现授权 | **已满足（2026-07-21）** |
| 实现分支 | **`codex/r1-renderer-next-shell`** |
| implementation | **spike `implemented` / `empirically_verified`；等待 `codex_review_pending`** |

### 8.2 开始编码的进入条件（全部满足后方可）

1. 上表 Codex 复核与规格冻结已满足（已满足）；
2. **Owner 明确授权**创建 `codex/r1-renderer-next-shell`（已满足）；
3. 授权后第一步仅为 §5 兼容性 spike（本轮已完成）；扩大正式 shell 前须 Codex 复核。

### 8.3 停止条件

- 范围滑向 chat/我/工作台/SQLite/PAN-02；
- 缺少 latch 或握手加固导致循环/误切；
- 一窗双状态机或 iframe 混挂；
- 生产暴露 next 入口或 renderer 可改持久化默认；
- 关闭 contextIsolation / 开启 nodeIntegration；
- 读取真实个人资料/sessions 正文；
- 未经 Owner 授权自行开分支或装依赖。

---

## 9. 测试分层提醒

| 层 | R1 要求 |
|---|---|
| 单元 | 入口权限 / generation / latch 纯逻辑建议单测 |
| Playwright Electron | **必须** |
| 既有 owner-runtime | legacy 回归不破即可 |
| Owner 真机 | 抽查默认与回退 |

---

## 10. 交付物清单

1. `renderer-next` 源码与构建配置
2. main/preload：入口权限、latch、握手世代、自动回退
3. Playwright E2E（含失败 latch 与拒绝升级）
4. lockfile 与版本表
5. 实现说明（log；无用户面黑话）

---

## 11. 明确禁止

1. 将本规格冻结误认为已获 Owner 实现授权或已开始实现。
2. 未经 Owner 授权创建实现分支、`npm install`、改源码/lockfile、启动 Electron。
3. 普通 renderer 请求 `legacy → next`。
4. renderer IPC 改写持久化默认入口。
5. 无条件 `signalReady`。
6. 失败后无 latch 导致循环自动进 next。
7. iframe/webview 嵌 legacy；一窗双状态机。
8. 生产加载 Vite dev URL；query/hash/localStorage 开故障注入。
9. 新增 Spectron；触碰真实 Package/sessions 正文。
10. 启动 PAN-02 / R2 / R2.5；amend / squash / push 作为默认。
11. 将 R1 标为 `accepted` / `implemented` / `statically_verified` / `runtime_verified` / `released`（本轮规格接受不得使用这些标签）。

---

## 12. 调度

| 项 | 值 |
|---|---|
| 本文件 | **`implemented` / `spike_partial_verified` / `codex_changes_requested`**（v0.1.3） |
| 含义 | spike 主体成立；Codex 有界修复进行中；**正式 shell 不得扩展** |
| implementation | **spike `implemented`**（修复轮；非正式 shell 完成） |
| 实现分支 | **`codex/r1-renderer-next-shell`** |
| Owner 实现授权 | **已获得（2026-07-21）** |
| 版本锁定表 | **已填写**（package.json 精确版本 + lockfile） |
| 本轮停止点 | 有界修复提交后**立即停止**；等待 Codex 再复核；**不得**继续正式 R1 shell |
| 完成后下一步 | Codex 复核通过后再决定正式 shell 范围；R2 任务包另文；不自动开始 |
| PAN-02 | `planned` / `blocked` |
| R0 | `accepted`（不变） |
| PAN-01S 族 | `accepted`（不变） |

---

## 13. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-20 | v0.1-draft | 初稿（`2a60c27`）；曾含过早的 `frozen_for_implementation`（历史） |
| 2026-07-20 | v0.1.1-draft | Codex 第一轮修订（`6107b36`）：入口权限、失败 latch、ready 世代、Electron/测试边界；当时 `codex_changes_requested`（历史） |
| 2026-07-20 | **v0.1.1** | **Codex 再复核通过**；四项启动安全契约已冻结；状态 → `specified` / `codex_review_passed` / `frozen_for_implementation` / `not_started`。**实施规格冻结**；实现尚未授权、尚未开始；版本表保持 TBD |
| 2026-07-21 | **v0.1.2** | Owner 授权后完成兼容性 spike：锁定依赖版本；main 入口门禁/latch/generation；`renderer-next` production-load；Playwright Electron 最小 E2E。状态曾标 `implemented` / `empirically_verified` / `codex_review_pending`（历史） |
| 2026-07-21 | **v0.1.3** | Codex 有界修复轮：ready 竞态、显式 generation、导航单飞、Vite/Error Boundary E2E、工程收尾；随后再修 Error Boundary 真实 render throw、Vite origin 对齐、timeout Promise 捕获。状态保持 `implemented` / `spike_partial_verified` / `codex_changes_requested` |
