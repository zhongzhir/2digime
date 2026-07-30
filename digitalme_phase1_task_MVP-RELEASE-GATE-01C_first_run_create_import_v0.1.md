# MVP-RELEASE-GATE-01C — 首次启动创建/导入 Digital Me

- **状态**：`implemented` / `ready_for_mvp_release_gate_01d` / `not_pushed`
- **分支**：`codex/mvp-release-gate-01`
- **性质**：`first_run_main_path_rebuild` / `digital_me_creation_and_import` / `package_state_consolidation`
- **上位**：`MVP-RELEASE-GATE-01B`（classic 锁定）→ 本任务 → `01D` / `01E`

## 目标

建立首批真实用户可完成的首次使用主路径：

```text
全新 userData → 启动 → 创建或导入 Digital Me →（可选）连接模型 → 进入做事 Hub → 重启恢复
```

## 完成判据（摘要）

1. 首次启动二选一：创建新的 / 导入已有 Digital Me  
2. 创建不依赖模型；默认 Package 位于用户文档 `Digital Me\<名称>`  
3. 导入为引用原位置（不静默复制）；失败回滚；普通资料夹拒绝  
4. FirstRunState 由现有事实派生；无第二 Package Store  
5. classic 仍为唯一正式产品面；未 push  

## 证据

- 专项：`npm run test:mvp-release-gate-01c`  
- Electron：`npm run test:mvp-release-gate-01c-electron`  
- 目录：`digitalme-app/scripts/_mvp-release-gate-01c-evidence/`  
- 报告：`MVP_RELEASE_GATE_01C_IMPLEMENTATION_REPORT_20260730.md`

## 明确不做（本轮）

成果访问重建、generation interrupt heal、学习回流、四导航、广播协作、renderer-next、advanced pipeline、正式 Windows 安装器（采用可分发运行时方案 B）。
