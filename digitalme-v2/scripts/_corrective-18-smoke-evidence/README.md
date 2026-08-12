# 纠偏 18 工程 Electron smoke

- 任务：`2DIGIME-BUILD-01-CORRECTIVE-PRODUCT-REDESIGN-18`
- 入口：`scripts/electron-corrective-18-smoke.cjs`
- 性质：真实 renderer / preload / DigitalMeRuntime 主链（隔离 userData + 可丢弃项目）
- adapter：Fake document + hooked executor（工程隔离；**非** Owner 真机、**非**真实 Codex CLI）
- 用户动作经界面点击与自然语言输入，不以 command bus 代替主链
- `ownerAccepted=false`；`owner_runtime=not_started`

见 `runtime-report.json` 与 `shots/`。
