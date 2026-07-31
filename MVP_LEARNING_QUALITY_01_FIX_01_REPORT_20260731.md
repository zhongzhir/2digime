# MVP-LEARNING-QUALITY-01-FIX-01 报告（2026-07-31）

## 状态

```
accepted_as_engineered /
learning_precision_validated /
generic_quality_scope_isolation_validated /
real_model_preference_reuse_confirmed /
quality_outcome_mixed /
owner_engineering_accepted /
not_pushed
```

**不得宣称**：`all_artifact_quality_validated` · `article_quality_superiority_validated` · `closed_alpha_ready` · `mvp_ready`。

---

## 工程验收结论（摘要）

学习系统已完成工程验收。质量结果是否更优属于后续质量评估与自动改进系统职责，不继续通过修改学习链路追逐单次文章评分。

必须记录：

- 真实生产学习链路已经成功落盘
- `expression_preference` = **4**
- `boundary` = **1**
- Learn Job **`committed`**
- 无 `pending_conflict`
- 无 Task A 正文复制（`copiedTaskA: false`）
- 无错误旧事实（`badOldFact: false`）
- software / image / video / podcast 已完成**静态** scope 隔离
- 真实模型当前只验证 **document/article** 场景
- 本轮**未证明** Digital Me 每次生成结果均全面优于普通模型
- 本轮证明的是「准确学习并真实复用」，不是「每次结果必然更优」

---

## 最新真实 DeepSeek 回归

| 项 | 值 |
|---|---|
| evidenceDir | `digitalme-app/scripts/_mvp-value-validation-real-model-01-evidence/probe-c-2026-07-31T13-46-45-511Z/` |
| provider / model | deepseek / deepseek-chat |
| static tests | **17/17**（`test:mvp-learning-quality-01`） |
| dvl2-04-auto-learn | **6/6** |
| expressionCount | **4** |
| boundaryCount | **1** |
| factCount | **0** |
| Learn Job | **committed**（`learn-deliverable_learn_jobs_json`） |
| pending_conflict | **无** |
| copiedTaskA | **false** |
| badOldFact | **false** |
| reducedRepeatInstructionCount | **4** |
| observableImproveDimensions | **1** |
| valueHypothesisSupported | **false** |
| blindEval | developer self；prefer → **B_digitalme** |
| 自动结构指标 | **mixed outcome** |
| 学习精度 | **通过** |
| 文章质量全面优越性 | **未证明** |

---

## 0. 通用质量内核说明

与成果类型无关：分类 / 来源 / 撤销 / 去重 / Resolver 共用一套 memory，经 `qualityScope` 隔离。文章 A/B 仅为第一条真实验证路径。

可承载：document/article · software/code · image · video · audio/podcast · presentation · spreadsheet · research_report · mixed_media。

默认最窄合理范围（通常 `artifact_kind`）；安全类 boundary 可为 `global`。不得一次任务无依据升为全局表达偏好。

`qualityApplications` 声明未来槽位（generation_context 已用；planning / validation 等可扩展），**非**仅 prompt 文本。

新增 Store / IPC / 第二知识源 / 分模态 Store = **0**。

---

## 跨场景污染测试

静态已覆盖：文章偏好不进 software；软件验证不进 image/video；图片不进 podcast；播客可在 podcast 召回；全局 boundary 跨类型；project fact 按项目；merge 不无依据扩大。

---

## 当前验证边界

| 已验证 | 未验证 |
|---|---|
| document/article 真实 DeepSeek 学习落盘与复用精度 | software/image/video/podcast 真实模型质量 |
| 静态 scope 隔离 | 文章结果全面优于普通模型 |
| 生产 Learn Job → 落盘 → reload → Resolver | closed alpha / MVP 产品就绪 |

---

## 根因回顾（FIX-01）

「边界：」标签触发 `SENSITIVE_RE` → `pending_conflict` → 整次未 commit。已修：revisionGuidance 不二次敏感确认；敏感检测用去前缀正文；接通 `qualityScope`。

---

## 下一任务建议

**MVP-QUALITY-EVALUATION-01**（尚未开始）：跨成果类型质量评估与自动改进；学习系统提供标准，质量系统验证是否达标。

---

## push / commit

见 TODAY-CLOSE-20260731；本轮收口后 **not_pushed**。
