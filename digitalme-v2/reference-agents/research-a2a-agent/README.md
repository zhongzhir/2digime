# Research A2A Agent（产品级参考对手方）

独立于 Digital Me Runtime 的 A2A 1.0 参考专业 Agent。

## 独立性

- 独立进程、独立配置、独立生命周期
- 自有 Agent Card 与 Task Store（SDK `InMemoryTaskStore`）
- **不**读取 Digital Me SubjectPackage / SecretStore / Artifact Store / Job Store
- 只消费 A2A Task 消息中明确给出的授权材料

## 启动

```bash
cd digitalme-v2/reference-agents/research-a2a-agent
npm install
npm start
```

环境变量（对手方自有凭证，不走 Digital Me SecretStore）：

- `DIGITALME_RESEARCH_AGENT_API_KEY` / `RESEARCH_AGENT_API_KEY`
- `DIGITALME_RESEARCH_AGENT_BASE_URL` / `RESEARCH_AGENT_BASE_URL`
- `DIGITALME_RESEARCH_AGENT_MODEL` / `RESEARCH_AGENT_MODEL`
- `RESEARCH_A2A_HOST`（默认 `127.0.0.1`）
- `RESEARCH_A2A_PORT`（默认 `43111`）

## 端点

- Agent Card: `http://127.0.0.1:43111/.well-known/agent-card.json`
- A2A JSON-RPC: `http://127.0.0.1:43111/`
- 控制面健康检查: `http://127.0.0.1:43112/health`
- 私有对照 API（非产品 UI）: `POST /private/v1/analyze`

## 技能

`project_risk_brief` — 根据授权材料生成结构化项目风险摘要。
