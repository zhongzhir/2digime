# Digital Me V2 — 软件工程：自研 vs 集成边界

- 文档编号：DIGITALME-V2-P2B-BUILD-VS-INTEGRATE
- 日期：2026-08-03
- 状态：`owner_review`
- 上位：架构规格 + 路线反审查 + 选择策略

---

## 1. Digital Me **必须自研**的管理能力

这些构成「数字主体做 CTO/编排」的差异化，**不得外包给 Coding Agent**：

| 能力 | 说明 |
|------|------|
| 目标理解与工程计划 | 拆阶段、验收标准、Owner 决策点（默认尽量为 0） |
| 隔离工作区与路径围栏 | 原仓只读、副本可写、防逃逸、基线 digest |
| AuthorizationGrant / L0–L3 | Agent 默认 ⊆ L1；apply/push/deploy 不交给 Agent |
| Change / Verification 完备性门 | patch、changed-files、基线、三分判定 |
| **独立验证执行** | tsc/测试/静态检查由 Digital Me 重跑，不采信自报 |
| Artifact 成果形态与展示纪律 | bundle roles、质量档、用户面中性文案 |
| 编排与降级策略 | 选 Agent、探测、切换、硬失败 |
| 成长回流（受控） | 仅确认后的工程经验；非 Agent 会话原文 |

---

## 2. **应直接复用**的外部能力

| 能力 | 复用来源 |
|------|----------|
| 代码理解与局部改写 | Coding Agent（Codex / Cursor / Claude Code…） |
| 模型补全/推理 | 既有 openai-compatible 通道（CTO 计划侧） |
| 仓库 diff / 基线 | 工作区内 git |
| 测试与类型检查运行器 | 项目自带 `tsc` / `npm test` 等 |
| 可选工具面 | MCP Server（只读或 L1 声明工具） |

原则：**买/接执行力，自研判断力与门禁。**

---

## 3. **近期不应自研**的部分

| 项 | 原因 |
|----|------|
| 通用 Coding Agent Runtime（规划–工具循环–记忆） | 与 Cursor/Codex/Claude 重复建设 |
| IDE / 完整 LSP 宿主 | 超出第二闭环；维护成本爆炸 |
| 供应商专有协议深耦合进 Work Runtime | 破坏可替换性 |
| 多 Agent 竞赛编排 | P2B.1/2 不做 |
| 自动 push/deploy 流水线 | L3；未批准 |
| OpenCode 深度定制壳 | Windows/权限未过门 |
| 本地伪 Agent（模板改文件） | 违反选择策略；质量欺诈 |

---

## 4. 通向「通用软件工程能力」的**最低公共契约**

Agent 可替换的充要条件（实现检查表）：

```
CodingAgentAdapter {
  probe() -> { ok, reason: auth|missing|sandbox|other }
  run(CodingAgentInput) -> {
    claimedSummary,
    exitCode,
    logsRef,
    // 真实改动只允许落在 workspace.rootPath
  }
}

CodingAgentInput {
  goal, acceptanceCriteria[],
  workspace: { id, rootPath, baseRevision, baseDigest },
  planRef?, grantId, permissionCeiling: 'L1'
}

// Digital Me 侧强制（Adapter 外）:
assertNoWriteOutsideWorkspace()
collectPatchAndChangedFiles()
runIndependentVerification() -> verdictSource ∈ {agent_claimed, digitalme_verified, owner_accepted}
forbid(repository_apply|git_push|deployment) unless Grant ≥ required level
```

**持久化只认 Artifact + 既有 8 对象**；工作区句柄为运行期设施，**不是第九事实源**。

---

## 5. 重点检查结论

| 问题 | 结论 |
|------|------|
| 是否重复建设 Coding Agent？ | 规格上否；实现若把「启发式成功判定 / 夹具静态文案」当通用能力，则**滑向伪自研**——须收敛进 Adapter 与可配置验收 |
| 供应商特性进 Work Runtime？ | 禁止；仅 Adapter 文件可含 `codex.cmd` / `claude -p` |
| 换 Agent 后知识是否保留？ | 是——Plan/Change/Verification Artifacts + digest |
| 统一契约 vs 特判？ | 必须以 `software-engineering-contract` 为唯一交叉点 |

---

## 6. 一句话边界

> **Digital Me = 懂目标、定计划、管权限、独立验收、保留成果；Coding Agent = 可替换的 L1 码工。**
