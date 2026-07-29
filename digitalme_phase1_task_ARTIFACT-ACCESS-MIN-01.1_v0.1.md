# ARTIFACT-ACCESS-MIN-01.1：原生成果菜单上下文一致性修复

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `stale_artifact_context_removed` / `native_menu_context_guarded` / `developer_runtime_accepted` / `owner_runtime_acceptance_pending`  
实施分支：`codex/artifact-access-min-01`  
实现基线：`4558bc8` 之后（本地未 push）

---

## 一、问题与目标

问题：进入「做事」首页未选中具体任务时，原生「文件」菜单仍可能操作上次任务成果，造成页面上下文与菜单动作不一致。

目标：菜单动作只允许基于**当前明确选中的任务上下文**；无明确选中时必须禁用，且不得回退到历史任务或最近成果。

---

## 二、本次收口约束（已满足）

- 新增永久字段：`0`
- 新增 Store：`0`
- 新增 IPC：`0`
- 不恢复成果卡「打开成果」按钮
- 原生菜单仍是当前过渡访问入口

---

## 三、开发验证记录

### 1) 自动化回归

命令：

```powershell
node digitalme-app/scripts/test-task-quality-stabilize-01-fix-01-artifact-open.cjs
node digitalme-app/scripts/test-global-renderer-responsiveness-01.cjs
```

结果：

- `artifact-open-fix`：`14/14` 通过
- `global-renderer-responsiveness`：`11/11` 通过

### 2) 正式窗口真实鼠标验收

命令：

```powershell
cd digitalme-app
node scripts/run-artifact-access-min-file-menu-acceptance.cjs
```

结果：

- `ok: true`
- 证据目录：`digitalme-app/scripts/_access-min-evidence/2026-07-29T08-35-23-483Z/`

---

## 四、状态边界

- 尚未 `owner_runtime_accepted`
- 尚未 `accepted_as_implemented`
- 本任务收口后停止，不开启下一任务
