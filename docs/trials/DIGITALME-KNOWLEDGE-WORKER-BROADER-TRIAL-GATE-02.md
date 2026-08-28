# DIGITALME-KNOWLEDGE-WORKER-BROADER-TRIAL-GATE-02

> Knowledge Worker broader real-user trial **final re-gate**。  
> 产品基线：`9b6f4d5d90b1bff11993c0391cfc60f1c6b8ef89`（未 push）。  
> **product code changes = 0**。真实 Electron 全矩阵重跑。不边测边修。  
> 证据：`build/evidence/knowledge-worker-broader-trial-gate-02/`（本地保留，不入库）。  
> userData：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-ud-27t7yt`。模型 `gemini-3.6-flash`。  
> Driver：`scripts/knowledge-worker-broader-trial-gate-ui-driver.cjs`（空 FOCUS，T3A 在 C2 之前）。  
> 本轮最高评级仍不为 EARLY USER READY。

---

## 1. Final Verdict

```
Knowledge Worker = LIMITED REAL TRIAL
未正式进入 BROADER REAL TRIAL
```

门槛：T1–T8 = 8/8 且 C1/C2 = 2/2 且 Hard Fail = 0。  
本轮独立判定：**T4 fail** → 不得升级。

相对 Gate-01：T1 / C2 原失败链已在本 build 上真实通过。阻塞项换成 **T4 Coding Agent 规划后未形成 Job、未改文件**。

---

## 2. T1–T8

| # | Driver | 独立判定 | 权威依据 |
|---|--------|----------|----------|
| T1 | pass | **pass** | 自有 Task `task_mtcjxtsw2f060a1d1ec1`（招聘原文，不是炒蛋）；Job `job_mtcjydsi5bfae5b3a432` `cap_gemini_web_search`；`search_used=true`；综合正文含 EU AI Act / EEOC / 人事决策；`research_quality.ok=true`。耗时 194s，非 Gate-01 的 6.2s 误绑。 |
| T2 | pass | **pass** | `historical_context_used=true`；`unrelated_cooking_leak=false`；未重新附材料。 |
| T3 | pass | **pass** | T3A `gevt_mtcju10lf99dfb65e057` adopted；T3B freeze `selectedEventIds` 含该 event；candidates 含 `preference:`；`risk_first_shape=true`；`preference_in_context=true`。 |
| T4 | fail | **fail** | Task `task_mtck650b4bf781be73b1` 正确归属编码目标；`originTurnId` 在；规划 `source=model` / `thin_v1` / draft。**无 Job**。磁盘 `lot.js` 仍返回 `''`；`test_exit=1`。UI 停在「待你确认 / 等待开始」至 Driver 420s 超时。编码 Agent 未执行。 |
| T5 | pass | **pass** | 开放目标用已有项目事实；`empty_template=false`；`historical_context_used=true`。 |
| T6 | pass | **pass** | 聊天已回复；`created_work_task=false`；不建 Job。 |
| T7 | pass | **pass** | 纪要 grounded（184 / 审批 / 苏州）；`search_used=false`。 |
| T8 | pass | **pass** | 自有研究 Task+Job `cap_gemini_web_search` succeeded；有 search evidence；无假完成。 |

**T1–T8 = 7/8**（T4 fail）。

---

## 3. C1 / C2

| # | Driver | 独立判定 | 说明 |
|---|--------|----------|------|
| C1 | pass | **pass** | Job `job_mtckphi70368d24aafe9`：`search_used=true` 且 `historical_context_used=true`（苇舟说明进 materialUse）。外部最新 evidence + 历史项目同时进入。本轮 `researchEvidence.decided=true`。 |
| C2 | pass | **pass** | **本轮先跑 T3A**，Subject 已 adopted `gevt_mtcju10lf99dfb65e057`。C2 Task `task_mtckulde37a836299b2c` 自有 Job succeeded。`preference_in_context=true`；candidates 含 `preference:`；freeze 选中该 event；正文风险先行（11 天 / 184 万 / 苏州机房）；`historical_context_used=true`；`empty_template=false`；无炒蛋污染。历史项目 + durable preference + 开放规划同时成立。 |

**C1/C2 = 2/2**。

---

## 4. Hard Fail

**0。**

未出现：假完成、错误主体事实当最新监管、高风险越权、空模板成品、已成功阶段被后续故障清空、新 Turn 写入旧 Task、确认落到错误 Task。

T4 是**该编码单元规划后未开始执行**，不是「声称已改代码」的假完成，也不是 converse degrade 后的无规划 waiting（规划为用户可见 model draft）。按任务未完成计 **T4 fail**，不升格为 Hard Fail。

---

## 5. Turn → Task → Job evidence

Driver 按 **goal 精确匹配** 取 Task，再取该 Task 的 Job。禁止 list[0] / 全局 latest。

| 单元 | Turn | Task | Job | 对齐 |
|------|------|------|-----|------|
| T7 | `turn_987e5962-…` | `task_mtcju1rj4f08787029ab` | `job_mtcjvbys572bf45cb609` | 是 |
| D1 炒蛋 | `turn_b1dcf64a-…` | `task_mtcjvzh54c2ecd2a41ac` | `job_mtcjxh7w40ee172fb089` | 是 |
| T1 招聘 | `turn_8179d3dc-…` | `task_mtcjxtsw2f060a1d1ec1` | `job_mtcjydsi5bfae5b3a432` | 是（未进炒蛋） |
| T2 | `turn_a3596e01-…` | `task_mtck1zxae83043d63d4c` | `job_mtck2jqg03700010b31f` | 是 |
| T5 | `turn_0cd1a15d-…` | `task_mtck37pu89fa86a940f9` | `job_mtck3wry1a798d2b839b` | 是 |
| T3B | `turn_cf3e9d97-…` | `task_mtck4pch15e1fec38f0a` | `job_mtck5bao1340837f7f34` | 是 |
| T4 | `turn_4fefbfdb-…` | `task_mtck650b4bf781be73b1` | **无** | Turn→Task 正确；Job 未创建 |
| T8 | `turn_3ae27dab-…` | `task_mtckff1iec85827d94e9` | `job_mtckfrv80fa74e3d19d1` | 是 |
| C1 | `turn_2dc83050-…` | `task_mtckjjal8bdf908219ee` | `job_mtckphi70368d24aafe9` | 是 |
| C2 | `turn_2bf22fca-…` | `task_mtckulde37a836299b2c` | `job_mtckwn7m169c2ae4fc9d` | 是 |
| T6 | 聊天页 | 无 work Task | 无 Job | 正确 |

Gate-01 的 T1 误绑 / C2 永久 waiting **本轮未复现**。T4 是同会话里编码路径未提交执行，不是 attribution 串台。

---

## 6. authoritative evidence 一致性

Driver `ok: false` 仅因 T4。T1/T2/T3/T5–T8/C1/C2 的 usable 与 Job / freeze / 磁盘（T7 纪要、T4 未改文件）一致。  
未出现「内部全对、用户交付明显错」的通过项。T4 Driver 诚实：`authoritative_job=null`。

---

## 7. user burden

知识任务（研究 / 连续 / 偏好 / 开放目标 / 附件 / 组合 C1·C2）用户未选手动 capability / freeze / taskId。T6 纯对话。T1/C2 不再需要理解内部路由即可拿到对题结果。

编码 T4：界面明确「待你确认」，Driver 未点成开始，用户若亲手点确认或可继续——**本 gate 以 Driver 自动化路径为准，计未完成**。日常知识工作负担已接近 broader；**含真实改代码的组合会话仍不稳定结束**。

未达「8/8 + 2/2 日常当超级助手」的 broader 门槛。

---

## 8. known non-blocking issues

1. **T1 `researchEvidence.decided=false`**，检索与用户综合仍成立（C1 本轮 `decided=true`）。  
2. **T4 验收文案 vs 磁盘**：本轮无成果，该项未触发。Gate-01 曾记录的「部分满足 vs test_exit=0」仍作为 UX backlog，本轮不修。  
3. T4 确认按钮在长会话 thin 编码上未在超时内被 Driver 点上——观察项，本 gate 不改产品、不改 Driver。

---

## 9. 是否正式进入 BROADER REAL TRIAL

**否。** 保持 **LIMITED REAL TRIAL**。

---

## 10. 下一阶段建议

1. **不要宣布 BROADER**，直到同一最终 build 上 T4（Coding Agent 真执行 + 磁盘测试）与 T1–T8/C1/C2 一起 8/8 + 2/2。  
2. T1/C2 ownership 修复在本 gate 上已站住；下一缺口是 **长会话里编码规划确认→Job** 是否稳定发生。验证时仍禁止边测边修本 gate 产品基线。  
3. 通过之前不要把内部固定题当主要产品驱动力去叠新能力；通过之后再转入更开放的真实知识工作者观察。  
4. 不要给 EARLY USER READY。
