# Digital Me V2 — Coding Agent 接入路线反审查

- 文档编号：DIGITALME-V2-P2B-CODING-AGENT-ROUTE-REVIEW
- 日期：2026-08-03
- 状态：`owner_review`
- 基线：`v2/foundation`；P2B.1 基础设施闭环已验证
- 约束：只做路线与策略；不调用真实 Coding Agent；不修改生产代码

---

## 0. 审查目的

在不重复建设 Coding Agent 的前提下，比较可替换后端，形成「默认 / 备用 / 探测 / 降级」策略输入。  
**Codex 当前 DashScope 401 记为环境问题**，不得据此否定 Codex 路线，也不得阻断其他 Agent。

---

## 1. 比较矩阵（摘要）

评分：高 / 中 / 低 / 待验证（相对 Digital Me L1 编排需求）。

| 维度 | Cursor Agent | Codex CLI | Claude Code | OpenCode | MCP/CLI/Runtime 组合 |
|------|--------------|-----------|-------------|----------|----------------------|
| 能力上限 | 高（IDE 级） | 高 | 高 | 中–高 | 取决于组合 |
| 任务连续性 | 高（会话/Task） | 中（resume） | 高（session resume） | 中（session；Windows 有坑） | 中（自管） |
| 非交互调用 | 中（编排侧需会话桥） | **高**（`codex exec`） | **高**（`claude -p`/`--bare`） | 中–高（`run`；Win 不稳） | 高（可设计） |
| 结构化 I/O | 中 | 高（JSONL） | 高（json/stream-json） | 中–高（`--format json`） | 可设计为高 |
| diff/files/logs | 中（靠工作区 git） | 高（配合沙箱+工作区） | 高 | 中 | 可统一由 DM 采集 |
| 中断/重试/恢复 | 中–高 | 中（resume） | 高 | 中 | 自研成本高 |
| 权限隔离 | 中（靠提示+路径） | **高**（sandbox） | 高（allowedTools/permission-mode） | 中（非交互常自动批准） | 可高 |
| Windows 兼容 | **高**（本机已跑通） | 高（已装；shim/stdin 需注意） | 中–高 | **低–中**（安装/headless 问题多） | 取决于组件 |
| 凭证管理 | Cursor 账户 | 本机 `~/.codex`；**401=环境** | Anthropic key/OAuth | 多供应商 | 分散 |
| 成本/限速 | 套餐相关 | 供应商相关 | 明确预算旗标可用 | 供应商相关 | 叠加 |
| 供应商锁定 | 中–高 | 中（OpenAI 生态） | 中–高 | 低–中（开源） | 设计得好可低 |
| 可替换性 | 中（会话形态） | **高**（CLI 契约） | **高** | 中 | **最高**（若契约稳） |
| 可观测性 | 中 | 高 | 高 | 中 | 可统一 |
| 维护成本 | 低（已用） | 低–中 | 中 | 中–高 | **高** |

---

## 2. 分路线结论

### 2.1 Cursor Agent

- **优势**：本机 P2B.1 已完成真实 L1 闭环；与 Cursor 工作流一致；Windows 无额外安装摩擦。  
- **劣势**：作为 Digital Me 产品内默认后端时，非交互/结构化出口弱于专用 CLI；不宜把 Cursor 专有会话 API 写进 Work Runtime。  
- **定位**：**近期可执行备用（及本机默认可跑通路径）**，不是长期唯一后端。

### 2.2 Codex CLI

- **优势**：`codex exec` + `workspace-write` 与 L1 Grant 对齐；JSONL / last-message；已有 `coding-agent-codex` 适配雏形。  
- **环境记录（非路线否定）**：本机 `service_tier`/`models cache` 配置变体过期 + DashScope **401 Incorrect API key** → 探测失败。属 **Owner 环境/凭证问题**。  
- **定位**：**产品默认首选路线**（鉴权探测通过后）。

### 2.3 Claude Code

- **优势**：官方 headless（`-p`、`--bare`、JSON、allowedTools、预算上限）；适合无人值守。  
- **劣势**：Anthropic 凭证与策略需单独接入；Windows 需验证沙箱与权限旗标。  
- **定位**：**次备 / 能力对冲**（Codex 与 Cursor 均不可用且探测通过时）。

### 2.4 OpenCode

- **优势**：开源、多供应商、有 `run`/`serve`。  
- **劣势**：Windows 安装与 headless「Session not found」类问题仍活跃；非交互权限模型偏「全自动批准」，与 Digital Me Grant 纪律摩擦大。  
- **定位**：**观察名单**，P2B.2 不作为默认或第一备用。

### 2.5 MCP / CLI / Agent Runtime 组合

- **优势**：长期可插拔；工具面可复用 MCP。  
- **劣势**：若在 P2B 早期自研「又一个 Agent Runtime」，会重复建设 Coding Agent；维护成本最高。  
- **定位**：**集成层模式**——Digital Me 只做统一 Adapter + 编排；MCP 作为工具扩展，不替代 Coding Agent 主执行器。

---

## 3. 反审查红线检查

| 检查项 | 结论 |
|--------|------|
| 是否正在重复建设 Coding Agent？ | **否（若守边界）**：只做 Adapter + Workspace + Plan/Change/Verify；不写自研 planner/coder 循环 |
| 是否把供应商特性写入 Work Runtime？ | **风险存在**：禁止 `if (codex)` / Cursor 会话字段进入 Job/Store；一律 Adapter 边界 |
| Agent 更换后能否保留知识/计划/验证/成果？ | **能**：事实在 SubjectPackage Artifact（plan/change/verification）与工作区 digest；不在 Agent 会话里 |
| 是否有统一 Adapter 契约？ | **有雏形**：`software-engineering-contract.ts` + CodingAgentInput/Output；实现须坚持，禁止逐工具特判进 Runtime |

---

## 4. 对 P2B.2 的输入

1. 默认首选：**Codex CLI**（探测通过）。  
2. 备用：**Cursor Agent** → **Claude Code**。  
3. OpenCode / 自研 Runtime：**不做默认**。  
4. MCP：工具扩展，非主 Agent。  
5. Codex 401：**环境 backlog**，不改路线评级为「不可行」。
