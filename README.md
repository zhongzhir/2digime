# 2digime

> build digital me.

2digime 为知识工作者构建「数字之我」：沉淀用户身份、记忆、目标与边界，集成 Agent、Skill、工具适配与上下文能力，完成复杂知识任务，并在授权边界内支持数字主体间的可信协作。

面向创始人 / 投资人 / 研发负责人 / 独立开发者 / 小团队等，处理跨文件、跨网页、跨仓库、跨历史决策的复杂知识任务。

- 三层产品版图：① 构建与成长（数字之我）② 最佳做事能力集成 ③ 数字主体间协作
- 技术主线：`digitalme-v2`（Electron + SubjectPackage，V2 产品壳）
- 多 Agent：以 AgentTeams（Manager/Worker）为协同设计基点，Planner / Context / Executor / Verifier / Intake / Memory / Governance 七类职能 Agent
- 协作：SubjectTransport（Local / Relay / P2P-Hybrid），Relay = 加密邮局，非事实源；2026-08-09 已完成两套独立主体公网双机协作通路验证（E2EE / 机会发现 / 离线转发 / 网络恢复 / 协作提案同步）

## 仓库结构

```
digitalme-v2/        V2 产品壳主线（Electron + SubjectPackage + WorkRuntime + Collaboration）
digitalme-app/       历史平行实现线（DVL2 多模态交付面；与 V2 零混写）
docs/               架构 / 设计 / 审计 / 复盘
scripts/            构建、证据脚本
docs/goai/          GOAI 赛事适配材料（分支 goai-agentinfra）
```

## 快速开始（digitalme-v2）

```bash
cd digitalme-v2
npm install
npm run electron:version     # 版本自检
npm run dev                  # 编译 + 预检 + 启动 UI
npm run verify               # build + smoke + tests + preflight
```

详见 [`digitalme-v2/README.md`](digitalme-v2/README.md)。

## 状态与诚实边界

- 自动化通过 ≠ Owner 验收 ≠ 市场质量。
- 不宣称 AgentTeams 运行时已接入、不宣称远程履约 / 支付 / 信誉 / 多方协作已完成。
- GOAI 赛事适配在独立分支 `goai-agentinfra` 上进行，不修改 `main` 既定计划。

## 许可证

[Apache License 2.0](LICENSE)
