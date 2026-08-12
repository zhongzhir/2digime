# SINGLE-RUNTIME-PATH-20 工程证据

- task: `2DIGIME-BUILD-01-SINGLE-RUNTIME-PATH-20`
- baseline: `e079ee5` → 本 corrective commit
- ownerAccepted: **false**
- 未启动第三次 Owner 真机验收

## 已完成

1. **旧入口封死**：drafting 无模型规划不再显示「开始处理」；`#btn-submit` 不再直提 `work.submitTask`；`JobRunner` 对无 `confirmedPlanVersion` 的 `modify_code` 抛 `plan_confirmation_required`（不探测 Codex）。
2. **唯一主链**：NL → `work.converse`（先落盘 Task）→ 模型规划 →「确认规划并开始开发」→ `work.submitTask`。
3. **规划语义**：可见规划仅 `source=model`；`seed_internal` 不展示、不可确认；解析失败用「规划生成失败，可重试」，不用「没听懂」。
4. **Codex 黑窗**：Windows 直启 `codex.exe`（native）；Electron 父链 probe+exec 证据见 `codex-electron-parent-silent.json`（`verdict=electron_parent_no_visible_console`，`mode=native`）。
5. **UI 局部**：真实 `main.cjs` 自动化已验证无规划阶段无「开始处理」（`checks.no_start_submit_before_plan` + `shots/01-compose.png`）。

## 全链 UI 脚本

- `scripts/electron-single-runtime-path-20-real-main.cjs`（require 真实 `electron/main.cjs`，真实模型+真实 Codex，禁止 hooked）
- 代理会话内长跑在 NL 发送后进程被中断；**请 CTO 本机独立重跑该脚本**完成 1–10 场景核对。

## 标签

- `single_runtime_path_correction_implemented`
- `dual_workflow_start_submit_sealed`
- `electron_parent_codex_silent_verified`
- `ownerAccepted=false`
- `third_owner_runtime_not_started`
