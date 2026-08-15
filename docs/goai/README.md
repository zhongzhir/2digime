# GOAI 赛事适配入口（2digime）

GOAI Agent Infra 赛道复赛交付材料说明。本目录位于分支 `goai-agentinfra`，不修改 `main` 既定计划。

## 目录

- [`AGENTTEAMS-COMPAT-SPEC.md`](AGENTTEAMS-COMPAT-SPEC.md) — R1：AgentTeams（Manager/Worker）兼容 Spec：角色映射、状态流转、消息/上下文/Skill/工具/Trace 契约与迁移成本。
- [`GOAI-SUBMISSION-PACKAGE.md`](GOAI-SUBMISSION-PACKAGE.md) — 复赛交付包结构与复现说明（README/依赖/配置/样例/证据/合规披露）。
- 方案与清单（随初赛终版维护于本地参赛目录，本仓库维护工程侧证据）。

## 当前状态（2026-08-15）

- ✅ V2 真实运行证据：真实模型做事、Codex CLI 外部执行、A2A 研究、成长回流、双机公网协作通路（8-09 归档）。
- ⬜ AgentTeams 运行时接入 / 等价适配层：P0 冲刺任务，见 `GOAI-SUBMISSION-PACKAGE.md` 冲刺计划。
- ⬜ 统一可观测 Trace / 固定评估集 / 端到端 Demo：P0/P1 冲刺任务。

## 诚实边界

- 主体协作层证据 ≠ AgentTeams 任务编排证据，两者分开表述。
- 支付、信誉、多方协作、远程履约不宣称已完成。
