# Digital Me V2 — Coding Agent 选择与降级策略

- 文档编号：DIGITALME-V2-P2B-CODING-AGENT-SELECTION-POLICY
- 日期：2026-08-03
- 状态：`owner_review`
- 上位：`digitalme_v2_coding_agent_route_review.md`

---

## 1. 确定策略（必须遵守）

| 项 | 决定 |
|----|------|
| **默认首选** | **Codex CLI**（`coding-agent-cli` / `cap_coding_agent_codex`） |
| **第一备用** | **Cursor Agent**（会话编排桥；`cap_coding_agent_cursor`） |
| **第二备用** | **Claude Code** headless（`claude -p` / `--bare`） |
| **不入默认池** | OpenCode（Windows/权限模型未过门）；自研 Agent Runtime |
| **MCP** | 仅作工具扩展；不得冒充 Coding Agent 主执行器 |

---

## 2. 能力探测（任务开始前）

每个候选 Agent 在选用前必须通过 **Probe**（只读或空跑，不写用户原仓）：

1. **二进制可达**：可解析可执行入口（注意 Windows `.cmd` / `node bin`）。  
2. **鉴权健康**：一次最小非交互调用返回非「401/未登录」。  
3. **沙箱/权限旗标可用**：Codex `workspace-write`；Claude `--permission-mode`/`allowedTools` 可声明。  
4. **工作区 cwd 生效**：能在指定目录读文件。  
5. **可观测出口**：至少能拿到 exit code + 文本摘要；优先 JSON/JSONL。

探测结果写入运行期证据（非第九事实源），例如 `agent-probe.json`。

### 2.1 Codex 环境问题记账

| 现象 | 分类 | 动作 |
|------|------|------|
| DashScope / API **401** | **环境/凭证** | 标记 `probe=auth_failed`；切换备用 Agent；**不**下调 Codex 路线评级 |
| `config.toml` 枚举过期（如 `service_tier=priority`） | **环境配置** | 探测时用 `-c` 覆盖或提示 Owner 修复；不否定路线 |
| 二进制缺失 | **未安装** | 跳过该候选 |

---

## 3. 鉴权失败降级顺序

```
probe(Codex) → ok? 用 Codex
           → auth_failed/unavailable?
                probe(Cursor) → ok? 用 Cursor
                → fail → probe(Claude Code) → ok? 用 Claude
                → 全部失败 → **硬失败**（向 Owner 说明）
```

### 3.1 明确禁止

- **禁止**退化为「本地模板改文件 / 正则替换冒充 Agent」。  
- **禁止**用 fixture 文案样例冒充真实任务完成。  
- **禁止**在探测失败时静默标 `agent_claimed=passed`。

降级目标必须仍是 **另一个真实 Coding Agent**，或任务中止。

---

## 4. 任务开始后是否允许切换 Agent

| 阶段 | 是否允许切换 | 规则 |
|------|--------------|------|
| Probe / 选定后、首次写入前 | 允许 | 按降级顺序重选 |
| Agent 已写入隔离工作区后 | **默认不允许** | 避免双 Agent 混改同一基线 |
| 独立验证失败且判定为 Agent 能力问题 | **有条件允许** | 见 §5 |
| Owner 明确要求换 Agent | 允许 | 须新 Grant 记录 + 新 change 世代 |

---

## 5. 切换后如何保留上下文与基线

切换 **不得**依赖旧 Agent 会话内存。必须保留：

| 资产 | 存放 | 切换时 |
|------|------|--------|
| 用户目标 / 验收标准 | Engineering Plan Artifact | 原样引用 |
| 工作区基线 | `baseRevision` + `baseDigest` | **冻结不变**；若已脏，新建工作区从源 digest 再拷 |
| 已产生 diff | Change Proposal（或未完备草稿） | 标记 `superseded`；新 Agent 基于**干净或明确继承的**工作区 |
| 验证结果 | Verification Artifact | 保留历史；新轮次新 verification |
| 成长/项目知识 | SubjectPackage 既有对象 | Agent 无关 |

**推荐切换流程**：`cleanup 脏工作区 → 按同一 baseDigest 重建隔离区 → 注入同一 plan → 新 Agent L1 执行 → 新 change + 独立验证`。

---

## 6. 与 P2B.1 实践对齐

- P2B.1 在 Codex 探测失败后改用 Cursor Agent，符合本策略（真实备用，非伪实现）。  
- 后续实现应将「探测 → 选择 → 记录 grant/adapterId」固化进编排脚本，避免手工特判散落。

---

## 7. 停止条件（本策略本身）

- 不在本文件扩展 L2/L3。  
- 不把某一供应商 SDK 类型泄漏进 Work Runtime。  
- 不新增生产 CommandMap，直至单独批准的实现任务。
