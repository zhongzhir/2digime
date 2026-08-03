# Digital Me V2 — 软件工程阶段计划（P2B）

- 文档编号：DIGITALME-V2-P2B-SOFTWARE-ENGINEERING-PHASE-PLAN
- 日期：2026-08-03
- 状态：`updated_for_p2b_route_review`（2026-08-03；P2B.1 夹具闭环已验证；真实任务见 P2B.2 推荐规格）
- 纪律：每阶段一个已批准任务块；实现须另获授权；**不 push**

---

## 0. 与既有阶段关系

| 阶段 | 状态 | 与软件工程 |
|------|------|------------|
| P2.0–P2.3 / P2A | 代码分析扩展验证 | L0 只读前缀；Owner 质量验收未通过 → 见 P2A 修复规格（并行小规格，另批实现） |
| **P2B 架构** | 本文档集 | 规格与契约 |
| **P2B.1** | 基础设施闭环已验证（夹具样本；非生产 apply） | 隔离工作区 + Plan/Change/Verify；L1 only |
| **P2B 路线反审查** | 见 `digitalme_v2_coding_agent_route_review.md` 等 | 主/备 Agent、自研边界、真实任务选型 |
| **P2B.2** | 规格待授权：`digitalme_v2_p2b2_recommended_task_spec.md` | 首个真实任务（质量档 UI）；仍默认提案-only |
| P2B.2+ / P2B.3 | 未启动 | L2 apply、L3 push/deploy |

---

## 1. P2B.1 最小实现切片（推荐，待 CTO 批准后启动）

### 1.1 一句话

**在隔离工作区完成一个小型、可验证的代码修改**——不应用到原仓库、不 push、不部署。

### 1.2 样例场景

1. 用户选择一个**测试仓库**（非生产敏感仓）作为材料  
2. 目标：修改一处明确 UI 文案，或修复一个小 bug  
3. Digital Me 生成 `engineering-plan`（可简化）  
4. 调用**一个** Coding Agent Adapter（实现时再选具体后端）  
5. 产出 `code-change`（必含 `patch.diff` + manifest 基线）  
6. 运行仓库**已有**测试（Verification Job）  
7. UI 展示 diff 与验证结果  
8. **不** apply 到原仓  
9. Owner 查看 Change Proposal  

### 1.3 验证级

仅 **L1**。禁止：repository_apply、git_push、deployment、生产 credential_use。

### 1.4 出口门（建议）

| 门 | 标准 |
|----|------|
| 对象纪律 | 无新永久 Store；Job 五态未扩展 |
| Agent 边界 | 写入仅发生在 workspace root 内 |
| 提案完备 | patch + baseDigest + changedFiles 齐全 |
| 验证独立 | 至少一次 `digitalme_verified` 测试 Job（非仅 agent_claimed） |
| 原仓不变 | 用户原仓库 tree 与基线一致 |
| UI | 目标 / 阶段 / diff / 风险 / 下一步；默认隐藏长日志 |

### 1.5 明确不做（P2B.1）

真实多 Agent 竞赛、自动多轮质量流水线、IDE、L2/L3、开放网络协作、Legacy 功能搬运。

---

## 2. P2B.2（草案，不启动）

- 强化 verification 矩阵（build + browser 可选）  
- Change Proposal → Owner 确认 → **L2 apply** 到原仓（仍不默认 push）  
- 基线漂移检测  

---

## 3. P2B.3（草案，不启动）

- L3：受控 branch/commit/push、发布物、部署与回滚  
- credential_use Grant  
- deployment verification bundle  

---

## 4. P2A 修复与 P2B 的排序建议

| 优先级 | 项 | 说明 |
|--------|----|------|
| 高 | P2A Owner 反馈修复 | 右键菜单、粘贴、bundle 展示、物化文件、降级质量门——规格已单列，**实现另批** |
| 中 | P2B 架构 CTO 复核 | 本文档集 |
| 后 | P2B.1 | 复核通过后再实现 |

二者不互相阻塞规格；实现上建议先修 P2A 体验，再开 P2B.1，以免「软件工程」建立在不可信分析展示上。

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 做成又一个代码生成器 | 反向审查题 1；CTO 能力与 Coding 分离 |
| Agent 偷写原仓 | Workspace 围栏 + Grant L1 上限 + 测试锁路径 |
| 验证等于 Agent 自报 | verdictSource 三分；质量门 |
| 对象/命令膨胀 | 8 对象 + 命令上限；新增须 CTO |
| Owner 确认负担回潮 | 决策点仅高风险；无固定 plan-confirm 机 |

---

## 6. 本轮交付清单

- [x] 架构 / 能力 / 权限 / bundle / 阶段计划 / P2A 修复规格  
- [x] 可编译契约骨架 + 契约测试  
- [x] 反向审查十问  
- [ ] CTO 复核通过后冻结 → 再批 P2B.1  
