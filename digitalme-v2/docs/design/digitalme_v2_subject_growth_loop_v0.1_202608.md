# Digital Me V2 — 主体成长循环（v0.1 / 2026-08）

状态：`engineered`（本轮实现与验收，未提交）  
任务：`DIGITALME-V2-SUBJECT-GROWTH-LOOP-01`  
基线 HEAD：`3fd1a17`

## 1. 现有机制复用清单

| 机制 | 标记 | 说明 |
|------|------|------|
| GrowthEvent append-only + confirm/supersede | reuse_as_is | 唯一权威入口 |
| feedback_recorded → experience_confirmed | reuse_as_is | |
| captureInput / distill / respondToLearning | extend | 信号分级、静默采纳、冲突标签 |
| importSubjectMaterial | extend | 资料默认 external_claim |
| deriveAllViews + inactive | extend | 增加过期失效 |
| selectSubjectInjection / AI-first max3 | extend | 弱相关仅结构；偏好高相关可注入 |
| Job 与学习 try/catch 隔离 | extend | growth-async 有限重试 |
| Memory/Profile/Preference/Learning Store | remove（禁止） | 未引入 |

## 2. 信号与分类

- 强 / 中 / 弱：`signal:*` tags（`growth-signal.ts`）
- 产品语义：`category:*`（identity_fact / goal / boundary / principle / preference / working_method / capability_experience / temporary_context / external_claim）
- 映射到既有 GrowthEvent 类型，不为单案例新增永久类型

## 3. 自动采纳边界

- **静默采纳**：低风险偏好/工作方法；来源明确；无 conflict；非身份/重大目标/边界/原则
- **必须确认**：身份、目标、边界、原则、冲突、高风险、低置信
- 确认可延迟到「数字之我」页；不打断主任务

## 4. 异步架构

- 主链：记录行为 → 持久化引用 → 返回成果
- `scheduleGrowthWork` / `captureInputAsync`：后台提取与写入，最多 2 次重试
- 成长失败：不改 Job/Artifact 完成态；用户面不暴露内部错误

## 5. 冲突与撤销

- 冲突检测不静默覆盖权威目标/原则/边界
- `respondToLearning` retire/revise + `subject_corrected` / supersedes
- `expiresAt:` 临时内容退出有效选择

## 6. 选择性复用

- 高相关 ≤3；弱相关仅结构/风格；无关零注入；硬边界始终适用
- 「没有可用成长内容」合法

## 7. 用户体验

- 数字之我页：已确认的重要内容、待你确认的内容、资料；可修改/停止使用/确认采用
- 不展示 GrowthEvent、confidence、队列、分类器名（文案避开内部禁止词）

## 8. 验收

```bash
npm run accept:subject-growth-loop
```

场景 A–F 见 `src/subject-core/tests/subject-growth-loop.test.ts`。  
证据：`scripts/_subject-growth-loop-evidence/`。

## 9. 下一轮建议

- 真模型蒸馏替换 Fake 启发式（保持合同）
- 延迟确认在「即将使用冲突规则」时弹出自然语言选择
- 多次一致选择的中等信号聚合（仍不建第二 Store）
