# TASK-QUALITY-STABILIZE-01-FIX-01A：验收 probe 修复与 UI 打开闭环

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `automated_tests_passed` / `acceptance_probe_repaired` / `artifact_open_owner_revalidation_pending`  
实施分支：`codex/task-quality-stabilize-01-fix-01a-open-acceptance`  
基线：`dce5b29`（`codex/task-quality-stabilize-01-fix-artifact-open`）

> **撤回** FIX-01 中「Electron open+reopen ok」作为 Owner 通过依据。  
> **不得**标 `owner_runtime_accepted` / `electron_open_reopen_validated` / `accepted_as_implemented`。不得 push。

---

## 1. 原错误

```text
Cannot find module './src/act-behalf/deliverable-package-store'
Require stack:
…\digitalme-app\scripts\tmp-open-artifact-probe.cjs
```

原因：一次性 probe 使用 `require("./src/...")`，以 `scripts/` 为模块基准，且依赖错误 cwd。

## 2. 修正

正式 harness：`scripts/electron-artifact-open-acceptance.cjs`

```js
function fromAppRoot(...parts) {
  return path.resolve(__dirname, "..", ...parts);
}
```

- 隔离 Electron + 临时 userData  
- `main().catch` → stderr + 非零退出，无窗口/无 dialog  
- Owner 模式复制既有 PRD 成果后打开（不改正式 Store）  
- 机器可读结果 JSON

## 3. Owner PRD 验收结果（自动化）

```json
{
  "artifactResolved": true,
  "fileExists": true,
  "openPathResult": "",
  "firstOpen": "passed",
  "reopenAfterRestart": "passed"
}
```

artifact：`aref_ms5kbhjs_767bad99` / `dver_ms5kbhjc_79d46814`

## 4. 正式 UI

点击「打开成果」→「正在打开…」→ 成功短暂显示「已打开成果」→ 自动消失；失败一次「暂时无法打开成果。」

## 5. 命令

```text
npm run test:artifact-open-acceptance
npm run test:artifact-open-acceptance:owner
npm run test:task-quality-stabilize-01-fix-01
```
