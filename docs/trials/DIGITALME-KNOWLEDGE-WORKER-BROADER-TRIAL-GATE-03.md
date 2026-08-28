# DIGITALME-KNOWLEDGE-WORKER-BROADER-TRIAL-GATE-03

> Knowledge Worker broader real-user trial **最终完整 Gate**。  
> 产品基线：`82c9d8f53144d501832ab967b249c875c9ff1cec`（coding confirmation UI 修复，未 push）。  
> **product code changes = 0**。真实 Electron 全矩阵重跑。不边测边修、不改 Driver、不补 confirmation、不延长 wait。  
> 证据：`build/evidence/knowledge-worker-broader-trial-gate-03/`（本地保留，不入库）。  
> userData：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-ud-WKZu4e`。  
> workDir：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-work-QSgVEf`。  
> 模型 `gemini-3.6-flash`。  
> Driver：`scripts/knowledge-worker-broader-trial-gate-ui-driver.cjs`（空 FOCUS，T3A 在 C2 之前；本轮未改）。  
> 本轮最高评级：**BROADER REAL TRIAL**。不得给 EARLY USER READY。

顺序：T6 → T3A → T7 → D1 → T1 → T2 → T5 → T3B → T4 → T8 → C1 → C2。

---

## 1. Final Verdict

```
Knowledge Worker = BROADER REAL TRIAL
正式进入 BROADER REAL TRIAL
不得给 EARLY USER READY
```

门槛：同一最终 build 上 T1–T8 = 8/8 且 C1/C2 = 2/2 且 Hard Fail = 0。  
本轮独立判定：**全部满足。**

相对 Gate-02：T4 原阻塞（规划就绪、按钮不可点、无 Job、磁盘未改）在本基线长会话中已真实通过。T1–T8 / C1 / C2 无系统性回归。

本 Gate 通过后：**立即停止围绕 Trial-05 / Gate 的开发循环**，转入 broader real-user observation。

---

## 2. T1–T8

| # | Driver | 独立判定 | 权威依据 |
|---|--------|----------|----------|
| T1 | pass | **pass** | 自有 Task `task_mtcmo0d96c40eb927785`（招聘监管原文，不是炒蛋）；Job `job_mtcmogj0522c67721c4a` `cap_gemini_web_search`；`search_used=true`；`researchEvidence.decided=true`；正文含 EU AI Act / GDPR 22 / EEOC / 人事决策。231s。 |
| T2 | pass | **pass** | `historical_context_used=true`；`unrelated_cooking_leak=false`；沿用本轮招聘合规成果，未重附材料。 |
| T3 | pass | **pass** | T3A adopted `gevt_mtcmm9dw0b9bcb03cfc5`（同步时先摊开风险）；T3B `preference_in_context=true`；`risk_first_shape=true`。 |
| T4 | pass | **pass** | 见第 5 节。规划就绪 → 可见确认 → 用户真实点击 → Job / Codex 执行 → `file_changed=true` → 独立 `node --test` exit 0。50.7s。 |
| T5 | pass | **pass** | 开放目标用已有项目事实；`empty_template=false`；`historical_context_used=true`。 |
| T6 | pass | **pass** | 纯对话已回复；`created_work_task=false`；不建 Job。 |
| T7 | pass | **pass** | 纪要 grounded（184 万 / 11 天 / 审批流 / 暂不包含移动端）；`searched=false`；`used_local_tokens=true`。 |
| T8 | pass | **pass** | 自有研究 Task+Job `cap_gemini_web_search` succeeded；`search_used=true`；`decided=true`；无假完成。 |

**T1–T8 = 8/8。**

---

## 3. C1 / C2

| # | Driver | 独立判定 | 说明 |
|---|--------|----------|------|
| C1 | pass | **pass** | Job `job_mtcn1hwr435e6162e11e`：`search_used=true` 且 `historical_context_used=true`（苇舟 / 184 万 / 11 天进正文）。能力 `cap_baseline_web_search`。`research_quality.ok=true`，`decided=true`。 |
| C2 | pass | **pass** | **本轮先跑 T3A**，Subject 已 adopted `gevt_mtcmm9dw0b9bcb03cfc5`。C2 Task `task_mtcn432wb6bd26deca9e` / Job `job_mtcn4ig31ee1e65841b0`。`preference_in_context=true`；freeze `selectedIds` 含 `preference:gevt_mtcmm9dw0b9bcb03cfc5`；风险先行（11 天 / 184 万 / 暂不包含移动端）；`historical_context_used=true`；`empty_template=false`；`unrelated_cooking_leak=false`。历史项目 + durable preference + AI 自主规划同时成立。 |

**C1/C2 = 2/2。**

C2 未因本轮未先建立 preference 而误判：T3A 在 C2 之前，overview-final `activeUnderstandings` / `userVisibleFacts` 仍持有该 event。

---

## 4. Hard Fail

**0。**

未出现：假完成、错误主体事实当最新监管、高风险越权、deterministic semantic override、已有明确相关上下文却要求用户重新提供、placeholder / 空模板、最新事实无真实 evidence、durable preference 内部丢失、成功阶段结果被后续故障清空、新 Turn 写进旧 Task、confirmation 落错 Task、work converse degrade 后永久 waiting、Coding 规划就绪但正常用户无法开始执行。

T4 本轮有真实 Job、磁盘改动与独立测试 exit 0，不是 Gate-02 的「规划后无法开工」。成果摘要写「部分满足验收要求」属 verifier 呈现杂质，见第 9 节，不升格 Hard Fail。

---

## 5. T4 confirmation evidence

Gate-02 原阻塞：规划正确、`#btn-start-development` hidden、无 Job、磁盘 `lot.js` 仍空实现。本轮在**同一冻结 Driver、完整长会话**中复验 UI 修复，未使用 Driver workaround。

落盘 Task：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-ud-WKZu4e\subjects\default\runtime\tasks\task_mtcmx0aqa84cce507b20.json`

| 检查项 | 本轮结果 |
|--------|----------|
| planning ready | 规划 `source=model`，内容为补全 `formatRef` + 跑 `npm test`。DM 明确请用户确认后再改代码。 |
| confirmation button visible | Driver 在 wait 循环中点到可见开始按钮（与成功 Gate-01 / UI-FIX 同一点击路径，无加长 wait、无重试补丁）。 |
| 用户真实点击 | 会话用户 turn「确认」两次：`confirm_start` 1.0 @ 07:33:25.784Z；0.98 @ 07:33:33.078Z。 |
| confirmation 属于正确 taskId / originTurnId | Task `task_mtcmx0aqa84cce507b20`；`originTurnId` = `turn_0fc97160-dd91-41f9-8b38-e98f201a166a`（首轮用户目标，不是炒蛋、不是后续确认 turn）。 |
| Job 创建 | `job_mtcmxhz0a48d43e4dfc0` `createdAt=2026-08-28T07:33:26.460Z`（紧随第一次确认）。`jobOriginTurnId` 与 Task origin 对齐。 |
| Coding Agent 真执行 | `cap_external_executor_codex` / `external-executor-codex-cli` `lastExecutorStatus=succeeded`。 |
| 文件变化 | `lot.js`：`toUpperCase` + `padStart(4,'0')`；`file_changed=true`。 |
| 独立测试真实通过 | 磁盘 `node --test`：**exit 0**，1 pass / 0 fail。 |

规划随后 `status=confirmed` @ 07:33:33.070Z。第二次「确认」落在 Job 已创建之后，是 wait 循环在 Job 出现前后各点一次**可见**按钮，不是另开 workaround。

Driver JSON `user_confirmation_count=0` 是既有记账：`waitJobSettled` 里 `maybeConfirmPlan(page, null)` 不累加。**权威是会话「确认」turn + Job originTurnId + 磁盘测试**，与 Gate-01 成功路径一致。

---

## 6. Turn → Task → Job evidence

Driver 按 **goal 精确匹配** 取 Task，再取该 Task 的 Job。禁止 list[0] / 全局 latest。

| 单元 | Turn | Task | Job | 对齐 |
|------|------|------|-----|------|
| T7 | `turn_5bb0c322-…` | `task_mtcmmachfe90fb0e5cc9` | `job_mtcmmm8gfb41d1de8e41` | 是 |
| D1 炒蛋 | `turn_31b1e313-…` | `task_mtcmnabq5e7f9d2a3378` | `job_mtcmnnuo1831de6b5529` | 是 |
| T1 招聘 | `turn_eecfc3b2-…` | `task_mtcmo0d96c40eb927785` | `job_mtcmogj0522c67721c4a` | 是（未进炒蛋） |
| T2 | `turn_411d86c9-…` | `task_mtcmsz2q1c62477a001d` | `job_mtcmtbx1270c747246c2` | 是 |
| T5 | `turn_608cf94a-…` | `task_mtcmtxrj45e48ab8cc57` | `job_mtcmud705b6cd61ded44` | 是 |
| T3B | `turn_fa2a2fdf-…` | `task_mtcmvhv2d99c6f0313d6` | `job_mtcmvy1vdf08bd44be2f` | 是 |
| T4 | `turn_0fc97160-…` | `task_mtcmx0aqa84cce507b20` | `job_mtcmxhz0a48d43e4dfc0` | 是 |
| T8 | `turn_c109c1b4-…` | `task_mtcmy3ft30fa7c56ff32` | `job_mtcmyhq275b2ac700645` | 是 |
| C1 | `turn_329db578-…` | `task_mtcn151za35dd40c2412` | `job_mtcn1hwr435e6162e11e` | 是 |
| C2 | `turn_c97ca6f3-…` | `task_mtcn432wb6bd26deca9e` | `job_mtcn4ig31ee1e65841b0` | 是 |
| T6 | 聊天页 | 无 work Task | 无 Job | 正确 |

未出现：新 Turn 写入旧 Task、确认落到炒蛋 / 旧 Task、degrade 永久 waiting、T1 误绑。Gate-01 的 T1 误绑 / C2 永久 waiting、Gate-02 的 T4 无 Job **本轮均未复现**。

---

## 7. authoritative evidence 一致性

Driver `ok: true`，10 项 usable 均为 true。与落盘 Task / Job / freeze / 磁盘（T7 纪要、T4 `lot.js` + 独立测试）一致。

未出现「内部全对、用户交付明显错」的通过项。T4 Driver 诚实记录 `authoritative_job`、`file_changed=true`、`test_exit=0`。C2 freeze 选中本轮 adopted preference，与 overview-final 一致。

---

## 8. user burden

知识任务（研究 / 连续 / 偏好 / 开放目标 / 附件 / 组合 C1·C2）用户未选手动 capability / freeze / taskId / provider。T6 纯对话。T1/C2 不再需要理解内部路由即可拿到对题结果。

编码 T4：长会话中规划后确认按钮可点，用户点「确认」即可开工；无需理解 taskId / originTurnId / 确认 IPC。日常知识工作 + 真实改代码的组合会话，在本固定矩阵上可结束。

达到本 Gate 定义的 **broader trial 用户负担水平**。仍不是 EARLY USER READY：未测不可预先枚举任务、多项目切换、更长自然连续使用。

---

## 9. known non-blocking issues

1. **`researchEvidence.decided`**：本轮 T1 / T8 / C1 均为 `decided=true`（优于 Gate-02 的 T1 `decided=false`）。该项仍作为 observability backlog 保留：若日后再现 `decided=false` 而检索与用户综合仍成立，不单独阻塞 broader。  
2. **T4 verifier 呈现**：成果摘要「部分满足验收要求」（`claim_vs_diff=partially_satisfied` 一类聚合），磁盘独立测试 **exit 0**。属 UX / verifier 杂质，真实任务完成，**不阻塞本 Gate**。  
3. 完成后 UI 仍可能显示「尚未决定」（awaiting adopt 的 userFacingLabel），不改变 Job / 磁盘事实。

本轮未改产品、未改 Driver 迁就上述杂质。

---

## 10. 是否正式进入 BROADER REAL TRIAL

**是。**

同时满足：

- T1–T8 = 8/8  
- C1/C2 = 2/2  
- Hard Fail = 0  
- Turn→Task→Job 全部正确  
- Driver 与 authoritative persisted state 一致  
- 无系统性 semantic / context / research / Subject / ownership / Coding-confirmation 回归  
- 用户无需理解 capability / router / freeze / taskId / provider  
- product code changes = 0  

升级为：**BROADER REAL TRIAL**。  
不得给 EARLY USER READY。

---

## 11. 下一阶段建议

**立即停止围绕 Trial-05 / Gate 的开发循环。** 下一阶段正式转为 **BROADER REAL-USER OBSERVATION**。

重点：

- 更多真实知识工作者  
- 更多不可预先枚举任务  
- 更长时间连续使用  
- 多项目切换  
- 自然失败分布  
- 用户是否愿意持续使用  
- 哪些问题是真实高频价值阻碍  

不再继续围绕固定 10 个任务优化产品。T4 验收文案杂质与 `researchEvidence.decided` 观察项记入 backlog，不作为下一轮 Gate 驱动。
