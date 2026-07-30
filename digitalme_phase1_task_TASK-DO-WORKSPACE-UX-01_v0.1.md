# TASK-DO-WORKSPACE-UX-01 — 做事工作空间真实任务体验收敛

- **状态**：`implemented` / `ready_for_mvp_release_gate_01d` / `not_pushed`
- **分支**：`codex/mvp-release-gate-01`
- **性质**：`main_work_workspace_rebuild` / `task_materials_first_class` / `in_page_artifact_experience`
- **基线**：tip `a9afad3`（01C 收口 `1796396`）

## 目标

把做事页从「任务配置器 + 内部规划展示 + File 菜单打开」重建为：

```text
任务要求 → 任务材料 → 开始做 → 页面成果 → 继续修改 / 采用结果 / 打开本地文件
```

## 完成判据（摘要）

1. 首屏为大任务要求编辑器；无独立标题必填  
2. 「任务材料」一等输入；文件与文件夹  
3. 一次「开始做」复用 Plan + Confirm + Generation  
4. 成果正文在页内呈现；权威 `DeliverableVersion`  
5. 继续修改生成新版本；采用走现有 Accept  
6. 打开本地文件与 File 菜单共用同一 resolver；不恢复旧 open 双轨  

## 证据

- `npm run test:task-do-workspace-ux-01`
- `npm run test:task-do-workspace-ux-01-electron`
- `digitalme-app/scripts/_task-do-workspace-ux-01-evidence/`
- 报告：`TASK_DO_WORKSPACE_UX_01_IMPLEMENTATION_REPORT_20260730.md`
