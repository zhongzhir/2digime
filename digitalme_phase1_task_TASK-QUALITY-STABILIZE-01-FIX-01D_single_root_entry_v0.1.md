# TASK-QUALITY-STABILIZE-01-FIX-01D：成果打开单入口收口

版本：v0.1.0  
日期：2026-07-29  
状态：`superseded_by_ARTIFACT-OPEN-RESET-01` / formal 标签作废  
> **ARTIFACT-OPEN-RESET-01**：本文件中的 `formal_coordinate_click_passed` / `owner_dom_trace_passed` **不得再作为可用性证据**。  
实施分支：`codex/task-quality-stabilize-01-fix-artifact-single-entry`  
基线：`1ba6a68`（`codex/task-quality-stabilize-01-fix-artifact-direct-binding`）

> **不得**标 `artifact_open_validated` / `owner_runtime_accepted` / `accepted_as_implemented`。不得 push。  
> 不修改生成/质量管线；3 个审计文件、`project/`、`stash@{0}` 不动。

---

## 一、已确认事实（Owner @ `1ba6a68`）

- 全局响应速度已恢复；
- 文件、ArtifactRef、main IPC、`shell.openPath` 均已分别验证；
- 正式成果按钮仍无反应；点击后连「正在打开…」都未出现；
- 直接绑定方案在真实页面未生效。

**结论**：正式 DOM 中的成果按钮没有进入直接绑定 handler。本任务不再改绑定时机或加保险绑定，改为 **单一根捕获入口**。

---

## 二、Owner 正式 DOM（先读后改）

Harness：`scripts/electron-owner-artifact-open-dom-dump.cjs`  
userData：`%APPDATA%/digitalme-app`  
页面：正式 legacy `src/renderer/index.html`

真实「打开成果」按钮（PRD 示例）：

```html
<button type="button" class="btn btn-primary" data-action="open-deliverable-artifact" data-open-deliverable-artifact="true" data-artifact-id="aref_ms5lf9qr_562847b3" data-version-id="dver_ms5lf9qh_c11137ca" data-deliverable-id="deliverable_ms5k9964_7b9fb09e" data-task-id="abt_ms5k8vpk_fd0a2b">打开成果</button>
```

- **生成函数**：`DeliverablePlannerUi.renderGenerationPanel`（`deliverable-planner.js`）
- **正式窗口 scripts**：工作区 `help.js` / `deliverable-planner.js` / `app.js` 等（非旧副本）
- **FIX-01C 时**：同路径按钮曾带 `data-open-bound="true"`，但 Owner 仍无「正在打开…」→ 判定直接绑定未成为可靠入口；面板委托对 `open-deliverable-artifact` 又是静默 `return`，一旦直接 listener 未命中即完全无反馈。

---

## 三、修复

1. **删除**：`bindArtifactOpenButtons` / `handleArtifactOpenButtonClick` / 面板与 `open-primary`/`open-art` 打开分支 / render 后保险绑定。
2. **唯一入口**：bootstrap 时 `bindArtifactOpenRootOnce()` → `#app`（或 `body`）capture 一次 `handleArtifactOpenAtRootCapture`。
3. **匹配**：`findArtifactOpenButton` 用 `composedPath`；兼容 `open-deliverable-artifact` / `open-primary` / `open-art` / `data-open-deliverable-artifact`。
4. **按钮合同**：新渲染统一 `data-action="open-deliverable-artifact"` + `data-open-deliverable-artifact="true"` + 稳定 ID。
5. **反馈**：同步「正在打开…」→ 一次 `requestAnimationFrame` → 再读 ID / preload；缺 ID 近旁「暂时无法打开成果。」；允许仅有 `artifactId` 或 `versionId`（main 从 Store 补全）。
6. **临时 trace**：同一 `traceId` 贯穿 renderer → preload → main（`_ephemeralTrace`，不持久化）。

架构：新增永久字段/Store/IPC/main handler = 0；根成果监听 = 1；成果 renderer handler = 1。

---

## 四、正式坐标点击验收

`npm run test:artifact-open-single-entry:owner`  
（`scripts/electron-owner-artifact-open-single-entry.cjs`）

- Owner 已有 PRD / 用户故事地图 / 功能和数据字典；
- `sendInputEvent` 真实坐标点击（非 `.click()` / 非直接调 handler）；
- 100ms 内出现「正在打开…」；完整 trace；`shell.openPath === ""`；「已打开成果」；
- 重启后再通过；`rootListenerInstallCount === 1`；普通按钮不进入打开 handler。

机器可读结果（PRD 首轮摘要）：

```json
{
  "rootListenerInstallCount": 1,
  "rootCaptureEntered": true,
  "feedbackRenderedBeforeIpc": true,
  "preloadCalled": true,
  "mainHandlerEntered": true,
  "artifactResolved": true,
  "openPathResult": "",
  "rendererReceivedOk": true
}
```

静态合同：`test:task-quality-stabilize-01-fix-01` / `test:global-renderer-responsiveness-01` 通过。

---

## 五、Owner 复验

**不要重新生成。** 使用已有 PRD 点击一次：

1. 必须先出现「正在打开…」；
2. 默认应用打开；
3. 显示「已打开成果」；
4. 用户故事地图与功能和数据字典可打开；
5. 重启后仍可打开；
6. 文件菜单保持即时。

若点击后没有「正在打开…」，不得写「已修复」。

---

## 六、状态

`implemented` / `single_root_artifact_open_entry_added` / `owner_dom_trace_passed` / `formal_coordinate_click_passed` / `owner_runtime_revalidation_pending`
