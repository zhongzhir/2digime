# GOAI 复赛交付包结构与复现说明

- 分支：`goai-agentinfra`；目标：评审可按 README 复现完整场景链路。
- 时间线：8-25 入围公布 → 9-3 复赛提交截止（P0 任务自 8-17 预研启动）。

## 1. 交付包目录结构（目标形态）

```
2digime-goai/
├── README.md                     # 项目与快速开始
├── LICENSE                       # 开源协议
├── digitalme-v2/                 # V2 引擎（含 AgentTeams/等价适配层）
│   ├── README.md
│   ├── package.json
│   └── docs/goai/                # 本目录
├── goai/                         # 赛事运行入口（建议独立目录）
│   ├── entry/                    # AgentTeams / 等价 Orchestrator 入口
│   ├── agents/                   # Worker 定义（角色映射见 AGENTTEAMS-COMPAT-SPEC）
│   ├── skills/                   # SkillSchema + 实现
│   ├── tools/                    # 等价工具契约（MCP 迁移路径）
│   ├── scenario/                 # 固定 Demo 场景：输入材料 / 样例输入输出
│   ├── evidence/                 # Trace / Log / Metrics / 运行报告 / 质量门禁
│   └── sample/                   # Mock 样例数据
└── docs/goai/
    ├── README.md
    ├── AGENTTEAMS-COMPAT-SPEC.md # R1 映射与契约
    └── GOAI-SUBMISSION-PACKAGE.md# 本文档
```

## 2. 复赛必交物核对清单

| 必交物 | 状态 | 负责人 | 完成日 |
|---|---|---|---|
| 更新版项目方案 PPT/PDF | 初赛终版已备，复赛按反馈更新 | Owner | 8-28 |
| 可执行 AgentTeams 代码包（运行入口/依赖/配置/样例/运行证据） | 分支上开发 | Dev | 9-1 |
| 可运行 Demo / Demo 视频（完整场景链路 + 异常处理） | 分支上开发 | Dev | 9-2 |
| README / 部署 / 复现说明（红线4） | 本文件 + 根 README 推进 | Dev | 9-1 |
| Agent Identity / Skill / 接口 Schema / 开源合规披露 | 初赛已备 + 补充 Schema | Owner/Dev | 9-1 |

## 3. 复现说明（模板，随实现更新）

```
# 前置
node >= 20 / npm；模型 API Key（OpenAI 兼容，环境变量注入，不入库）

# 安装与启动
cd goai && npm install
cp .env.example .env          # 配置模型端点 / 密钥（密钥不入库）
npm run scenario:prepare      # 准备 Mock 输入材料
npm run scenario:run          # 跑通端到端场景
npm run scenario:report       # 生成 Trace/Log/Metrics/质量门禁报告

# 验证
npm run verify                # 单元 + 冒烟
```

## 4. 冲刺计划（与《赛事适配任务与一周开发计划_20260815.md》一致）

- **P0（8-17 启动，8-30 前）**：AgentTeams 接入/等价适配层骨架；固定端到端 Demo 场景；统一 trace_id 可观测。
- **P1（8-31 前）**：固定评估集 + 质量门禁报告；失败/审批/回滚/审计演示；SkillSchema + MCP 等价契约。
- **P2（9-2 前）**：开源包装与合规披露；协作收口复验；可选 RAG 向量库。

## 5. 合规披露清单（提交前逐项核）

- [ ] 开源协议（LICENSE）与开放范围
- [ ] 第三方依赖清单（package.json 全量）
- [ ] 商业 API / 闭源模型调用与替代方案、迁移成本
- [ ] 数据来源与授权边界、脱敏方式
- [ ] 私有资料 / API Key / 真实个人数据排除（.gitignore + 扫描）
- [ ] 复现步骤与评审可访问仓库地址
