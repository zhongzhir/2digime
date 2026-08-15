# R1 · AgentTeams 兼容 Spec（Manager/Worker 映射与契约）

- 状态：`draft_for_review`（GOAI 适配分支 `goai-agentinfra`）
- 依据：《GOAI 参赛手册》§8/§9/§10、AgentTeams（原名 HiClaw，hiclaw.io）Manager/Worker 模型、`digitalme-v2` 现有对象。
- 原则：**增量适配、核心对象不变**；先提供「等价可验证适配层 + 映射证明」，再按需接入 AgentTeams 运行时。

## 1. 目标

证明 2digime 的多 Agent 系统如何以 AgentTeams 为协同设计基点完成：角色编排、任务拆解、上下文传递、协同执行、状态追踪，并给出接口边界与迁移成本。

## 2. 角色映射（GOAI 7 Agent → AgentTeams）

| AgentTeams 角色 | 2digime Agent | 对应 V2 对象/能力 | 职责 | 边界 |
|---|---|---|---|---|
| Manager / Orchestrator | Planner + Governance | WorkRuntime·TaskService、AuthorizationGrant、审计 | 任务拆解、角色路由、共享状态、验收标准、人工监督 | 不改变用户目标；高风险动作人工确认 |
| Worker · Context | Context | ContextSnapshot、SubjectPackage、GrowthEvent 检索 | 上下文/材料/RAG 组装、证据标注 | 证据不足输出缺口，不编造 |
| Worker · Executor | Executor | Capability Adapter（OpenAI 兼容/Codex/A2A）、ArtifactWorkspace | Skill/工具/模型调用、成果生成与导出 | 本地低风险自动执行；外部提交需确认 |
| Worker · Verifier | Verifier | OutcomeCheck、质量门禁、LLM-as-Judge | 按赛事要求/证据核对成果、修订建议 | 事实不确定需标注 |
| Intake / 入口 | Intake | Task 意图识别（五类）、材料归并 | 任务输入、需求归并 | 低风险归纳可自主，方向变化需确认 |
| Memory / 成长 | Memory | GrowthEvent 追加式回流、重启重放 | 采用/修订沉淀为可复用经验与 Skill 样例 | 敏感/冲突需确认 |
| Governance | Governance | RiskGuard、PolicyCheck、Trace/审计 | 权限、审批、回滚、审计 | L0-L3 分级，越界拒绝 |

## 3. 状态流转映射（ExecutionJob 五态 → AgentTeams 协作状态）

| ExecutionJob 五态 | AgentTeams 语义 | 证据 |
|---|---|---|
| `pending` | Worker 待接收任务 | Job 事件 + 审计 |
| `running` | Worker 执行中 / Manager 追踪 | trace_id + 状态变更事件 |
| `verifying` | 结果验证 / 质量门禁 | QualityGate 报告 |
| `succeeded` / `failed` | 协作完成 / 失败升级 | 运行报告 + 重试/降级记录 |

- 状态权威仍在 V2（ExecutionJob），AgentTeams 侧只做映射与展示，不另起第二状态机。
- 协作 Proposal 状态（发起/接受/暂不接受）属于主体协作层，与任务编排状态分开表述。

## 4. 消息 / 上下文 / 状态契约

- 结构化消息：`{trace_id, task_id, agent_role, intent, payload, evidence_refs[], ts}`
- 上下文传递：ContextSnapshot（任务冻结视图）+ SubjectPackage 权威数据 + GrowthEvent 检索结果
- 共享状态：ExecutionJob + Task + CollaborationRecord；Opportunity 为可重建派生，不当作第二真相
- 人工确认边界：AuthorizationGrant（调用方/用途/数据范围/时限/撤回状态）

## 5. Skill 契约（SkillSchema）

每个 Skill 含：`name / type / purpose / inputs(schema) / outputs(schema) / call_condition / dependencies / failure_policy / permission_scope / version / evaluation_cases / open_source_boundary`。

核心 Skill：MaterialIngest、ContextAssembly、DeliverablePlanner、ArtifactDraft、QualityGate、RevisionLoop、LearningCommit、RiskGuard、OpenSourcePackager。

与 V2 能力适配器映射见初赛 Skill 清单（MaterialIngest/ContextAssembly ↔ 材料与记忆；ArtifactDraft ↔ OpenAI 兼容/Codex/A2A；QualityGate/RevisionLoop ↔ OutcomeCheck/修订）。

## 6. 工具契约（MCP 等价契约）

未接入 MCP 时，每个外部工具提供等价契约：`tool_name / entry / param_schema / return_schema / auth / error_handling(retry,idempotency,degrade) / audit_log / migration_to_mcp_cost`。

当前真实工具：OpenAI 兼容模型、Codex CLI（外部执行）、A2A 研究（本机参考 Agent）、本地文件/Git。

## 7. Trace 契约（可观测）

- 统一 `trace_id` 贯穿 Agent / Skill / Tool / LLM 调用；
- 输出：Trace（Span 语义，尽量遵循 OpenTelemetry GenAI）、结构化 Log（决策依据/失败原因/权限与审批事件，带 trace_id）、Metrics（任务耗时、Token、工具成功率、修订次数、质量门禁结果）；
- 建议后端：本地 JSONL + 可选 AgentLoop/LoongSuite/OpenTelemetry 适配（复赛给等价方案与迁移成本）。

## 8. 迁移成本说明

- 从 V2 编排层到 AgentTeams 运行时：主要成本在「角色/消息/状态映射 + Skill/工具再封装」，核心对象（SubjectPackage/ExecutionJob/Artifact/AuthorizationGrant）可复用，无需重写；
- 从等价适配层迁移到 AgentTeams：只需协议适配（消息信封/状态回写），工具调用链与 Skill 契约不变；
- 不做：为赛事复制第二套状态机、不把主体协作当成 AgentTeams 编排、不为 Demo 增加空壳 Agent。

## 9. 待确认

- 直接接入 AgentTeams 运行时，还是先交付等价适配层（推荐后者先跑通闭环再评估接入）——8-17 决策门定。
- 是否引入阿里云官方用云 Skills / Nacos / Higress / PolarDB / RocketMQ 任一作为演示基础设施（推荐项，不按数量评分）。
