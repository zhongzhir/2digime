# Digital Me V2 — AI-first 执行简化（v0.1 / 2026-08）

状态：`engineered`（本轮实现与验收）  
任务：`DIGITALME-V2-AI-FIRST-EXECUTION-SIMPLIFICATION-01`  
范围：默认做事路径改为 AI 主导 + 最小主体上下文 + 轻量结果检查 + 最多一次修订 + 异步学习。

## 1. 旧任务链审计（普通「做事」）

| 步骤 | 分类 | 说明 |
|------|------|------|
| 主体检索 / getDerived | required（best-effort） | 失败不得阻断成果 |
| ContextSnapshot 构建 | required | 材料 + 实际注入冻结；允许很小 |
| 偏好/经验注入 | optional → 高相关≤3 | 弱相关默认 **remove**；身份/原则仅 careful/high_risk |
| Task Brief 双写目标 | remove（已收） | 不再「概要 + 目标」重复 |
| 主模型调用 | required | 默认一次 |
| 远端 Artifact Verification | high_risk_only / remote | 本地文档不强制复杂验证链 |
| Outcome Check | required（轻量） | pass / targeted_revision_required / blocked |
| 针对性修订 | optional ≤1 | 只带缺陷；不回灌全部主体 |
| 学习 / GrowthEvent | async | 失败不改 Artifact 完成态 |
| 回写与恢复 | required | 既有 Job 五态；无第二状态机 |

**阻塞主结果的非必要项（已处理）**：强制弱相关注入、强制身份填充、学习失败连带任务失败、为证明「用了 Digital Me」而塞满 Snapshot。

## 2. 三档执行（仅内部）

- `standard`：一次生成 + 轻量检查 + 可选一次修订  
- `careful`：用户明确高质量/复杂 → 额外匹配身份/方向/原则  
- `high_risk`：法律/资金/公开发布等 → 既有授权与独立验证仍有效；用户面不出现档位名  

## 3. 对照证据

确定性 Fake 路径下三任务 A/B（legacy vs ai_first）见：

`scripts/_ai-first-execution-evidence/ab-comparison.json`

指标：模型调用次数、注入条目数、耗时差。真实模型成本需 Owner 在有凭证环境复跑；本轮不宣称通用质量评测台。

## 4. 明确不做

通用质量评分平台、多 Agent 默认评审、每任务强制记忆/学习成功、无限修订、新 Memory Store、新任务状态机、UI 扩张、第二外部 Agent。

## 5. 验收入口

```bash
npm run accept:ai-first-execution
```
