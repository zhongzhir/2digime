# TASK-QUALITY-STABILIZE-01-FIX-01B：正式成果按钮端到端接线修复

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `formal_renderer_open_path_repaired` / `automated_ui_tests_passed` / `owner_runtime_revalidation_pending`  
实施分支：`codex/task-quality-stabilize-01-fix-artifact-open-ui`  
基线：`8229721`（分支 `codex/task-quality-stabilize-01-fix-01a-open-acceptance`；即上位任务描述所指 HEAD）

> **不得**标 `owner_runtime_accepted` / `artifact_open_validated` / `accepted_as_implemented`。  
> **不得** push；**不得**重新生成成果；**不得**修改质量管线；3 个审计文件与 `stash@{0}` 不动。

---

## 一、真实点击路径追踪（正式 legacy 渲染器）

以 PRD「打开成果」为样本，从 DOM 到 main 完整链路：

| 环节 | 事实 |
| --- | --- |
| 按钮 DOM | `deliverable-planner.js` `renderGenerationPanel()` 写入 `#act-generation-items` |
| 原 data-action | `open-primary`（次级格式为 `open-art`） |
| 携带的稳定 ID | `data-task-id` / `data-deliverable-id` / `data-version-id` / `data-artifact-id`（**不含**任何本地路径） |
| 事件委托 | `app.js` `wireActBehalfUi()`（经 `bindEvents → bindDo`）在 `#act-generation-items` 绑定 `handleGenerationPanelClick` |
| 命中的 renderer 函数 | `handleGenerationPanelClick` → 统一入口 `openDeliverableArtifactFromButton(btn)` |
| 是否误命中 | **否**。未命中 `openActBehalfTask`（任务/草稿）、无 `openDraft`/`openPlan`/`openLegacyArtifact` 生产分支 |
| preload 方法 | `window.digitalMe.actBehalfOpenArtifact(payload)` |
| IPC channel | `actBehalf:openArtifact`（`preload.js` ↔ `main.js` `ipcMain.handle` 名称一致） |
| main 处理 | `main.js` → `deliverable-artifact-open.openArtifactSecure`（依据 Store 解析路径） |
| main 收到的 ID | `{ taskId, deliverableId, versionId, artifactId }` 稳定 ID |
| 解析路径 | 由权威 Store（ArtifactRef→Version→Deliverable→Package）解析绝对路径，校验归属/根目录/存在/扩展名 |
| `shell.openPath` 返回 | 成功 `""` |
| renderer 反馈 | `{ok:true}` → UI 显示「已打开成果」；失败显示「暂时无法打开成果。」并带 `data-open-error-code`（「查看原因」） |

### 「已打开草稿任务。」来源

来自 `app.js` `openActBehalfTask()`（加载草稿任务时的进度文案 `setActProgress("已打开草稿任务。")`）。  
该函数由**任务列表行**（`renderActTaskListRow` 中的 `task-item-main` 按钮 → `openDoScene("act_behalf", {taskId})`）触发，与成果卡是**不同 DOM、不同 action**。  
Owner 早前看到该文案，是打开任务时留下的**旧进度残留**，并非成果按钮所致。成果按钮不调用、也不会显示该文案。

### 是否存在事件冒泡

成果卡 `#act-generation-items` **不是**任务卡子节点，二者无父子冒泡关系。为彻底杜绝任何父级/文档级处理器旁路，成果打开分支已显式 `event.stopPropagation()`。

---

## 二、修复内容

1. **唯一 action**：主按钮改为 `data-action="open-deliverable-artifact"`（`open-primary`/`open-art` 仅作向后兼容别名保留）。
2. **单一 renderer 打开函数**：新增 `openDeliverableArtifactFromButton(btn)`，baseline/enhanced/legacy/package/partial 成果差异全部交由 main 依据 Version/ArtifactRef 解析，renderer 不猜测。
3. **冒泡防护**：成果打开分支 `stopPropagation()`，不落入任务/草稿分支。
4. **即时可见反馈**：点击同步显示「正在打开…」，成功「已打开成果」（短暂后消失），失败「暂时无法打开成果。」+「查看原因」。反馈出口在成果卡统一状态位 `#act-generation-status`。
5. **文档顺序**：保持 `md → docx → html`，不优先打开 HTML。

---

## 三、正式 UI 点击测试（禁止以 IPC 代替点击）

`scripts/electron-artifact-open-ui-acceptance.cjs`（`npm run test:artifact-open-ui`）：

- 加载正式 `index.html` + **真实 `preload.js`**，等待 `app.js` 完成 `dmNavigationBound`；
- `renderGenerationPanel` 渲染 PRD / 用户故事地图 / 功能和数据字典 + 一个失败成果；
- **真实 `MouseEvent` 点击**「打开成果」按钮；
- 断言：按钮即时进入「正在打开…」→ main 收到正确 `artifactId` → `shell.openPath` 以 Store 解析路径被调用 → UI 出现「已打开成果」→ **未**出现「已打开草稿任务」；
- 三张卡分别通过；重启（`reload`）后 PRD 再次通过；
- **故意** `shell.openPath` 返回错误一次 → UI 明确显示「暂时无法打开成果。」并带错误码；
- 部分失败成果不影响已完成成果打开。

结果：**42 passed / 0 failed**。

```text
npm run test:artifact-open-ui
npm run test:task-quality-stabilize-01-fix-01     # 13 passed
npm run test:artifact-open-acceptance             # firstOpen/reopen passed
npm run test:classic-renderer-dom                 # DOM 结构不回退
```

---

## 四、架构限制自检

- 新增永久字段：**0**
- 新增 Store：**0**
- 新增 IPC 打开体系：**0**
- 仅：修复 renderer action、统一打开函数、加临时 loading 状态、加真实 UI 测试、加冒泡防护；未新建第三套 artifact-open 方法。

---

## 五、Owner 复验（未执行）

不重新生成；打开已有任务，依次点击 PRD - Digital Me 项目知识功能、用户故事地图、功能和数据字典。  
通过标准：三个按钮均即时显示「正在打开…」→ 三个真实文件分别打开 →「已打开成果」→ 不出现「已打开草稿任务」→ 不出现无反应 → 重启后 PRD 仍可打开。
