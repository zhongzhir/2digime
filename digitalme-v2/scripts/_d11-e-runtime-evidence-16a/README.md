# D11-E-16A 真实 Electron 运行证据

- 任务：`2DIGIME-BUILD-01-D11-E-RUNTIME-EVIDENCE-FOLLOWUP-16A`
- 入口：`scripts/electron-d11e-runtime-smoke.cjs`
- 性质：**runtime_evidence**（真实 renderer / preload / main / DigitalMeRuntime + 隔离 userData）
- adapter：Fake document + hooked external executor（工程隔离；**非** Owner 真机、**非**真实 Codex CLI）
- `ownerAccepted=false`；`owner_runtime_not_started`

## 与 fixture 的区分

| 目录 | 性质 |
| --- | --- |
| `_d11-e-legacy-cleanup-16-evidence/visual_mock_only-*.png` | 静态 fixture 界面示意 |
| `_d11-e-runtime-evidence-16a/`（本目录） | 真实主链 smoke |

## 机器可读记录

见 `runtime-report.json`：userData、Task/Job/Artifact 数量与状态、重启前后、executionAuthorization 边界、adapter、每张截图对应真实状态。
