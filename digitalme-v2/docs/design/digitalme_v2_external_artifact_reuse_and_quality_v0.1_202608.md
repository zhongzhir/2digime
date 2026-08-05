# Digital Me V2 — 外部成果复用与质量对照 v0.1

**状态：** `engineered_for_acceptance` / `not_a_general_benchmark_platform`  
**日期：** 2026-08  
**对应任务：** DIGITALME-V2-EXTERNAL-ARTIFACT-REUSE-AND-QUALITY-01  
**基线 HEAD（任务启动时）：** `974ce30`

## 1. 质量假设

1. 外部专业能力产出经 Artifact Verification 后，仅在 Owner **采用** 时进入既有 GrowthEvent 链。
2. 后续任务通过 ContextSnapshot 冻结的 `subjectContext` 复用已确认经验；**不是**第二知识库。
3. 「质量改善」必须同时看到：冻结选中采用事件 + 成果正文出现可核对的沿用痕迹。仅有 `reachedModel=true` 或仅有采用按钮，不得宣称质量提升。
4. 本轮用确定性 Fake Document 做 A/B 对照，隔离模型随机波动；真实模型波动记为归因不确定因素。

## 2. 质量归因边界

| 层级 | 证据位置 | 不得混称 |
|------|----------|----------|
| 模型原始输出 / 外部加工 | Job + Adapter / remoteExecution | 不等于验证通过 |
| 验证结果 | candidate verify / Job 失败原因 | 不等于用户采用 |
| 用户采用或拒绝 | GrowthEvent `decision:accept\|reject` + evidence | 不等于质量分数 |
| 后续复用内容 | ContextSnapshot freeze `selectedEventIds` / reasons | 不等于用户面文案 |
| 最终质量变化 | 验收 A/B rubric（调试证据） | 不等于确定因果 |

## 3. 复用边界

- **高相关：** 关键词充分重叠 → 注入完整采用细节（含可追溯 eventId，仅调试可见）。
- **弱相关：** 仅 1 个关键词重叠 → `weak_structure_only`，细节替换为通用结构偏好声明，**剥离具体事实标记**。
- **无关：** 不选中该采用事件；`excludedEventIds` 可核对。
- **拒绝：** `decision:reject` 永不正向注入；同 Artifact 上「先采用后拒绝」以最新决策为准，整组决策退出正向池。
- **版本：** 同 `artifact:` 标签仅保留最新 `decision:accept`；旧版本采用不继续正向生效。

## 4. 成长写入

采用后写入既有 GrowthEvent（`feedback_recorded` → 自动确认 → `experience_confirmed`）：

- 来源 Artifact / version（evidence）
- 能力类型与版本（tags：`capability:*`、`capabilityVersion:*`、`sourceKind:external_capability`）
- 适用任务范围（`requestedArtifactType` 标签 + 详情文本中的主题）
- 用户采用证据（按钮路径 + 可选说明）
- 可复用判断/结构/偏好（详情文本）

禁止：整篇外文进长期事实、External Knowledge Store、自动升格权威事实、拒绝成果正向复用。

## 5. 归因方法

验收脚本对高相关任务做 A（无采用）/ B（有采用）对照，固定：同一目标族、同一 Fake 能力、同一输出约束。

Rubric（多维，非纯字符串命中）：

- 任务相关性、结构完整性、事实一致性、是否正确使用已采用经验、是否引入无关内容、是否可直接使用。

结论分级：

- 观察到 B 具备沿用证据且 A 无 → `quality_signal_observed`（置信度 medium，因 Fake 模板也可能贡献结构）。
- 无法区分外部成果 / 偏好 / 模板 / 波动 / 既有 Subject → `quality_signal_observed / causal_attribution_uncertain`。

## 6. A/B 结果（本轮自动验收）

见 `scripts/_external-artifact-reuse-quality-evidence/stages.json`（每次 accept 重写）：

- Baseline 无采用：`usesAcceptedExperience=false`
- 采用后相关任务：freeze 含采用事件，正文含独特事实标记 → `qualityImproved=true`
- 归因：`quality_signal_observed`，likelySources 含 `accepted_external_experience`

## 7. 污染检查

- 弱相关不得泄漏独特事实标记
- 无关任务 selected 不含该采用事件
- 拒绝事件不出现在 selected

## 8. 版本处理

- 编辑产生新 head → 旧采用对 UI 为未决定；新采用写入新 version
- 选择器按 Artifact 聚合，仅最新 accept 可注入
- 对最新版本再拒绝 → 该 Artifact 决策组全部退出正向池

## 9. 静默产品原则

用户面仅：成果、采用/不采用、必要修改、后续任务结果。  
GrowthEvent / ContextSnapshot / 归因链 / 内部评分 / 能力版本 / 注入过程 **仅验收与调试证据**。

## 10. 是否值得扩展为通用质量评估模块

**暂不建议立即启动通用 Benchmark 平台。**  
本轮证明：在既有 Growth + Snapshot 上可做「可追溯复用 + 最小 A/B 信号」。通用评测需要跨成果类型量表、稳定对照集与因果设计，属于建议中的 **MVP-QUALITY-EVALUATION-01**，应另开规格，不得由本切片膨胀。

## 11. 明确不做（本轮）

第二异构 Agent、广播/发现、全局质量分、自动选 Agent、支付信誉、UI 大改、新知识库或新状态机。
