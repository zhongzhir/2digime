# ARTIFACT-OPEN-RESET-01：成果打开能力最小重建与虚假验收清理

版本：v0.1.0  
日期：2026-07-29  
状态：`implementation_in_progress` / `owner_retest_forbidden`  
实施分支：`codex/artifact-open-reset-01`  
基线：`48bdc57`

> 这是一次**重置**，不是 FIX-01E。  
> **在开发者 `npm start` 真实鼠标验收完成前**：不得要求 Owner 复验；不得标 `developer_runtime_mouse_accepted` / `ready_for_owner_final_spotcheck`。  
> **禁止再使用**：`formal_coordinate_click_passed` / `owner_dom_trace_passed`。

---

## 一、删除的失败实现

已从 renderer 删除：

- `bindArtifactOpenButtons` / `handleArtifactOpenButtonClick`
- `bindArtifactOpenRootOnce` / `handleArtifactOpenAtRootCapture` / `findArtifactOpenButton` / `artifactOpenRootBound`
- `openDeliverableArtifactFromButton` 及按钮文字状态机
- `open-primary` / `open-art` / `open-deliverable-artifact` 打开兼容与专用 capture
- 成果打开专用 debug trace（`__dmLastArtifactOpenTrace` 等）

**成果打开专用 listener = 0；专用 frontend handler = 0。**  
保留：ArtifactRef / DeliverableVersion / main 安全路径 / `shell.openPath` / 目录校验。

---

## 二、唯一通用命令入口

正式生产路径（与「接受」相同）：

```text
#act-generation-items click（wireActBehalfUi 只装一次）
  → handleGenerationPanelClick
  → executeUiCommand(command, payload, { button })
```

- 「接受」：`data-action="accept-ver"` → `executeUiCommand("accept-ver", …)`
- 「打开成果」：`data-command="artifact.open"` → `executeUiCommand("artifact.open", …)` → preload → main → `shell.openPath`

成果卡**只声明命令与稳定 ID**，不自绑 click、不装 listener、不直接调 preload。

临时状态在卡片旁：`正在打开…` / `已打开` / `暂时无法打开`（纯 DOM，不持久化）。按钮文案保持「打开成果」，请求期间仅 `disabled`。

诊断（仅 `DIGITALME_ARTIFACT_OPEN_DIAGNOSTIC=1`）：右下角 `click → command → preload → main → openPath`。Owner 默认不显示。

兜底（更多…）：`打开所在文件夹`、`复制文件路径`（复用既有 `actBehalf:openArtifact` / `reveal`，`intent:"copyPath"`，无新 IPC）。

---

## 三、复杂度变化（相对 `48bdc57`）

| 项 | 变化 |
|----|------|
| 删除专用 listener | root capture 1 + 历史 per-button bind 路径 |
| 删除专用 handler | `findArtifactOpenButton` / `handleArtifactOpenAtRootCapture` / `openDeliverableArtifactFromButton` / `bindArtifactOpenRootOnce` 等 |
| 删除兼容 action | `open-primary` / `open-art` / `open-deliverable-artifact` 打开分支 |
| 误导 harness | 去掉 `test:artifact-open-single-entry:owner` 作为正式证据；UI harness 标为 unit-only |
| `app.js` + planner | 约 **−107 行**（`app.js`/`planner` 合计 −107） |

唯一入口：`executeUiCommand`（经 `handleGenerationPanelClick`）。  
成果打开与「接受」**共享**该入口。

---

## 四、验收纠正

以下**不得**再作为 Owner 可用性证据：jsdom、构造卡片、直接调 handler/preload/IPC、probe `openPath`、`.click()`、harness 坐标点击。

单元合同：`npm run test:task-quality-stabilize-01-fix-01`、`test:global-renderer-responsiveness-01`、`test:artifact-open-ui-unit`（unit-only）。

开发者现场（未完成前保持 `owner_retest_forbidden`）：

```bash
cd digitalme-app
set DIGITALME_ARTIFACT_OPEN_DIAGNOSTIC=1
npm start
```

真实鼠标点正式 userData 已有 PRD → 卡片旁「正在打开…」→ 默认程序打开 → 重启后再开 → 用户故事地图 / 功能和数据字典 → 截图或短视频 + 有界 `[artifact-open-cmd]` 日志。

---

## 五、状态机

当前：`implementation_in_progress` / `owner_retest_forbidden`  

通过开发者鼠标验收后才可改为：

`implemented` / `legacy_open_handlers_removed` / `shared_command_path_added` / `developer_runtime_mouse_accepted` / `ready_for_owner_final_spotcheck`
