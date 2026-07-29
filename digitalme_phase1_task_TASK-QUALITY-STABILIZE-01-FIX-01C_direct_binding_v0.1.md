# TASK-QUALITY-STABILIZE-01-FIX-01C：正式成果按钮直接绑定

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `direct_artifact_button_binding_added` / `formal_electron_click_trace_passed` / `owner_runtime_revalidation_pending`  
实施分支：`codex/task-quality-stabilize-01-fix-artifact-direct-binding`  
基线：`0341f30`（`codex/global-renderer-responsiveness-01`）

> **不得**标 `artifact_open_validated` / `owner_runtime_accepted` / `accepted_as_implemented`。不得 push。  
> 不修改生成/质量管线；3 个审计文件、`project/`、`stash@{0}` 不动。

---

## 一、已确认事实（Owner @ 0341f30）

- 文件菜单/关闭/普通按钮/任务切换已恢复即时（RESPONSIVENESS-01 有效）；
- 三个「打开成果」仍无任何反馈，未出现「正在打开…」；
- 文件、ArtifactRef、main IPC、`shell.openPath` 已分别可用。

**结论**：正式成果按钮 click handler 未执行。本任务只修 renderer 按钮绑定。

---

## 二、为何旧局部委托不可靠

`#act-generation-items` 气泡委托在自动化里可工作，但 Owner 正式页仍无反馈。可能因素包括：重绘时序、祖先 `hidden` 面板、或委托路径在真实交互中未命中。  
本轮**不再依赖父容器委托打开成果**，改为渲染后对每个按钮 **直接 `addEventListener`**。

未采用 document/window capture（与暂停的旧 capture 方案区分）。

---

## 三、修复

1. **`bindArtifactOpenButtons(container)`**  
   扫描 `[data-action="open-deliverable-artifact"]`；`dataset.openBound === "true"` 跳过；`click` → `handleArtifactOpenButtonClick`（`event.currentTarget`）。
2. **每次** `renderGenerationPanel` 结束后调用绑定（planner 钩子 + `refreshActGenerationPanel` 保险）。
3. **按钮合同**：新输出统一 `open-deliverable-artifact` + 稳定 ID；不再输出 `open-primary` / `open-art`。
4. **反馈**：先于 IPC 设「正在打开…」；成功按钮文案「已打开成果」约 1s 恢复；失败近旁「暂时无法打开成果。」；**不写**底部 progress。
5. **有界日志**：`console.info("[artifact-open]", { phase, artifactId, ... })`。
6. **委托清理**：`handleGenerationPanelClick` 对 `open-deliverable-artifact` **直接 return**；仅保留 `open-primary`/`open-art` 历史兼容。
7. **CSS**：成果打开按钮 `pointer-events: auto` + 局部 z-index，避免被无意覆盖。
8. **快速连点**：`data-opening` + 400ms `data-open-cooldown`。

---

## 四、正式 Electron click trace

`npm run test:artifact-open-ui` → **48 passed / 0 failed**

示例 TRACE_SUMMARY：

```json
{
  "buttonFound": true,
  "buttonEnabled": true,
  "topElementIsButton": true,
  "directHandlerEntered": true,
  "loadingFeedbackShown": true,
  "preloadCalled": true,
  "mainReturnedOk": true,
  "successFeedbackShown": true
}
```

覆盖：PRD / 用户故事地图 / 功能和数据字典；重绘后再点；缺 artifactId 失败；main 错误失败；快速连点不双发；重启后 PRD。

---

## 五、架构

- 新增永久字段 = **0**
- 新增 Store = **0**
- 新增 IPC = **0**
- 新增全局 listener = **0**

---

## 六、Owner 复验

不重新生成。打开已有任务，依次点 PRD、用户故事地图、功能和数据字典。  
通过：立即「正在打开…」→ 文件打开 →「已打开成果」→ 无「已打开草稿任务」→ 全局响应仍即时 → 重启后仍可打开。
