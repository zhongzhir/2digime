# Digital Me Package v0.1 数据结构（讨论稿）

版本：v0.1  
状态：讨论稿  
日期：2026-06-28

## 一、设计目标

Digital Me Package 是 Digital Me 系统的最小可迁移单元。它不是完整数据库，也不是某个 AI 平台的 system prompt，而是用于描述、迁移、调用和授权一个人的数字之我的标准化数据包。

v0.1 的目标是先解决四个问题：

1. 个人数字之我的核心信息如何组织；
2. 个人记忆、偏好、风格、判断和能力如何表达；
3. 如何导出到不同 AI 平台或本地 Runtime；
4. 如何保留来源、权限、版本和审计基础。

## 二、基本原则

1. 本地优先：Package 默认由用户本人持有。
2. 平台中立：不绑定 OpenAI、Claude、Gemini、DeepSeek 或任何单一平台。
3. 分层导出：公开版、私有版、工作版、授权版可以不同。
4. 来源可追溯：蒸馏结果应保留来源索引。
5. 权限内置：Package 应包含可读的授权和使用边界。
6. 可版本化：每次生成和更新都应有版本记录。
7. 可降级使用：即使没有复杂 Runtime，也应能被普通 AI 工具读取使用。

## 三、推荐目录结构

```text
digital-me-package/
  manifest.json
  identity.json
  persona.md
  style-guide.md
  preferences.json
  decision-frameworks.json
  memory/
    memory-index.json
    long-term-memory.jsonl
    project-memory.jsonl
    relationship-memory.jsonl
  skills/
    skill-index.json
    example-skill.md
  sources/
    source-index.json
    source-notes.md
  policies/
    usage-policy.json
    authorization-policy.json
    privacy-policy.md
  prompts/
    system-prompt.md
    import-guide-chatgpt.md
    import-guide-claude.md
    import-guide-cursor.md
  audit/
    audit-schema.json
    audit-log-sample.jsonl
  README.md
```

## 四、核心文件说明

### 1. manifest.json

用于描述 Package 的基础信息。

```json
{
  "packageVersion": "0.1",
  "digitalMeId": "local:example-user",
  "ownerDisplayName": "Example User",
  "createdAt": "2026-06-28T00:00:00Z",
  "updatedAt": "2026-06-28T00:00:00Z",
  "packageType": "private",
  "language": "zh-CN",
  "generator": {
    "name": "Digital Me Builder",
    "version": "0.1"
  }
}
```

packageType 可选值：

| 类型 | 含义 |
|---|---|
| public | 公开展示版 |
| private | 本人完整使用版 |
| work | 工作场景版 |
| licensed | 授权第三方调用版 |
| legacy | 继承或身后场景版 |

### 2. identity.json

用于描述数字之我的身份信息。v0.1 不强制使用 DID，但预留 DID 字段。

```json
{
  "digitalMeId": "local:example-user",
  "displayName": "Example User",
  "identityType": "natural_person",
  "controlledBy": "self",
  "publicKey": "",
  "did": "",
  "recoveryMethods": [],
  "identityClaims": []
}
```

### 3. persona.md

用于描述该数字之我的总体人格、定位、表达方式和边界。

建议结构：

```markdown
# Persona Card

## 基本定位

## 长期目标

## 核心价值观

## 典型表达方式

## 行为边界

## 不应代表本人做出的事项
```

### 4. style-guide.md

用于描述语言风格、写作习惯、常用表达、禁用表达、篇幅偏好等。

### 5. preferences.json

用于结构化表达偏好。

```json
{
  "communication": {
    "tone": ["clear", "direct", "structured"],
    "avoid": ["empty praise", "uncertain hedging"]
  },
  "work": {
    "prefers": ["step-by-step execution", "clear acceptance criteria"],
    "avoids": ["vague plans", "unbounded exploration"]
  },
  "risk": {
    "requiresApprovalFor": ["publishing", "payment", "legal advice", "production database changes"]
  }
}
```

### 6. decision-frameworks.json

用于表达个人判断框架。

```json
{
  "frameworks": [
    {
      "id": "example-framework",
      "name": "Example Decision Framework",
      "domain": "general",
      "principles": [],
      "positiveSignals": [],
      "negativeSignals": [],
      "typicalQuestions": [],
      "sourceRefs": []
    }
  ]
}
```

### 7. memory/

记忆分层建议：

| 文件 | 内容 |
|---|---|
| memory-index.json | 记忆索引和分类 |
| long-term-memory.jsonl | 长期稳定记忆 |
| project-memory.jsonl | 项目相关记忆 |
| relationship-memory.jsonl | 人物和关系记忆 |

单条 memory 建议结构：

```json
{
  "id": "mem_001",
  "type": "project",
  "content": "The user regards Digital Me as a human-subjectivity project, not a replacement system.",
  "confidence": "high",
  "sensitivity": "private",
  "createdAt": "2026-06-28T00:00:00Z",
  "sourceRefs": ["src_001"],
  "expiresAt": null
}
```

### 8. skills/

Skill 是 Digital Me 可被外部 Agent 调用的能力单元，不等同于 Digital Me 本体。

skill-index.json：

```json
{
  "skills": [
    {
      "id": "skill_example",
      "name": "Example Skill",
      "domain": "general",
      "version": "0.1",
      "file": "example-skill.md",
      "visibility": "private",
      "requiresApproval": true
    }
  ]
}
```

Skill 文件建议结构：

```markdown
# Skill Name

## Purpose

## When To Use

## Inputs

## Process

## Output Format

## Constraints

## Approval Requirements
```

### 9. sources/

用于记录原始资料或蒸馏依据。

source-index.json：

```json
{
  "sources": [
    {
      "id": "src_001",
      "type": "document",
      "title": "Example Document",
      "createdAt": "2026-06-28T00:00:00Z",
      "hash": "",
      "location": "local",
      "sensitivity": "private"
    }
  ]
}
```

### 10. policies/

用于表达授权、隐私和使用限制。

usage-policy.json：

```json
{
  "defaultVisibility": "private",
  "allowTrainingByThirdParty": false,
  "allowCommercialUse": false,
  "requireAttribution": true,
  "requireHumanApprovalFor": [
    "publishing",
    "contracting",
    "payment",
    "legal_opinion",
    "investment_decision"
  ]
}
```

authorization-policy.json：

```json
{
  "authorizedApps": [],
  "authorizedAgents": [],
  "revokedAuthorizations": [],
  "expiresAt": null
}
```

### 11. prompts/

用于兼容现有 AI 平台。

| 文件 | 用途 |
|---|---|
| system-prompt.md | 将 Digital Me 简化为通用 system prompt |
| import-guide-chatgpt.md | ChatGPT 使用说明 |
| import-guide-claude.md | Claude Project 使用说明 |
| import-guide-cursor.md | Cursor / Codex 使用说明 |

### 12. audit/

v0.1 只定义审计格式，不要求完整审计系统。

audit-schema.json：

```json
{
  "fields": [
    "timestamp",
    "caller",
    "app",
    "model",
    "skill",
    "memoryRefs",
    "action",
    "approvalStatus",
    "outputHash"
  ]
}
```

## 五、导出层级

| 导出层级 | 内容 | 适用场景 |
|---|---|---|
| Lite | persona + style + prompt | 导入普通 AI 工具 |
| Standard | persona + memory index + skills + policies | 本地或专业 AI 工具 |
| Full | 包含完整 sources 和 memory | 本人私有备份 |
| Licensed | 受限 memory + 受限 skills + 授权策略 | 第三方调用 |

## 六、v0.1 不解决的问题

1. 不强制上链；
2. 不强制 DID；
3. 不定义收益分配合约；
4. 不包含完整原始隐私数据；
5. 不保证跨所有平台自动导入；
6. 不允许无授权模拟本人作出高风险行为。

## 七、后续演进方向

v0.2 可增加：

1. package 签名；
2. hash 校验；
3. 本地加密；
4. DID 字段启用；
5. 版本差异记录；
6. Runtime 调用日志；
7. 多角色模板。

v0.3 可增加：

1. 授权凭证；
2. 第三方应用调用协议；
3. 收益记录；
4. 链上哈希锚定；
5. Digital Me Package Registry。

## 八、协作与交易扩展（对齐业界协议栈，2026-07-08 更新）

> 更新说明：本节原为草案字段建议，现已**对齐 2026 年业界互操作事实标准并落地为实际文件**（不自造协议）。协作层对齐 **A2A（Agent2Agent v1.0，Linux Foundation）**、工具层对齐 **MCP**、交易层对齐 **AP2 + x402**、身份/存证层对齐 **W3C DID + VC 签名**。已落地：`contracts/agent-card.json`、`contracts/interaction-contract-schema.json`、`contracts/interaction-contract.sample.json`、`contracts/README.md`、`commerce/mandates/{intent,cart,payment}-mandate.sample.json`、`commerce/pricing-policy.json`、`commerce/settlement-records.jsonl`、`trust/chain-anchor.json`、`trust/signature.json`。`Interaction Contract` 现定位为**内部授权编排层**，对外编译为 A2A Agent Card 与 AP2 Mandate。下列为原始草案字段，保留以便对照：

为支持 Digital Me 与他人 / 其它 Agent 的协作、交易，建议在 v0.3+ 增加以下结构（可先作为草案字段，不必一次实现）：

### 1. contracts/

```text
contracts/
  interaction-contract-schema.json
  sample-interaction-contract.json
```

`interaction-contract-schema.json` 建议字段：

```json
{
  "contractId": "ic_001",
  "ownerDigitalMeId": "local:example-user",
  "callerId": "agent:external-researcher",
  "callerType": "agent",
  "purpose": "market-research-summary",
  "capabilityScope": {
    "allowSkills": ["skill_research_v1"],
    "allowMemoryClasses": ["public_notes", "licensed_project_memory"],
    "denyActions": ["payment", "contract_signing"]
  },
  "privacyLevel": "licensed",
  "pricing": {
    "mode": "per_call",
    "currency": "CNY",
    "unitPrice": 99
  },
  "validFrom": "2026-07-01T00:00:00Z",
  "validTo": "2026-12-31T23:59:59Z",
  "revocable": true,
  "auditRequired": true,
  "disputePolicyRef": "policies/dispute-policy.md"
}
```

### 2. commerce/

```text
commerce/
  pricing-policy.json
  settlement-records.jsonl
  revenue-sharing-policy.json
```

用于记录计费、结算、分账，不与运行时强耦合。先支持中心化账本，再扩展链上对账。

### 3. trust/

```text
trust/
  signature.json
  notarization.json
  chain-anchor.json
```

`chain-anchor.json` 可选字段（按需启用，不强制）：

```json
{
  "enabled": false,
  "network": "",
  "txHash": "",
  "anchoredAt": "",
  "anchorType": "hash_only"
}
```

## 九、关于“是否以区块链为主底座”的数据结构结论

1. **不强制上链**仍是当前正确方向；
2. Runtime 核心数据（记忆、偏好、私有来源）不应默认上链；
3. 链上仅建议保存哈希、授权凭证摘要、结算凭证等最小必要信息；
4. Package 应支持 `chain-anchor.json` 作为可插拔层，而不是主目录必填项；
5. 系统应先具备“无链可运行”的完整能力，再开启链上增强能力。
