# DIGITALME-KNOWLEDGE-WORKER-BROADER-TRIAL-GATE-01

> Knowledge Worker broader real-user trial **release gate**。  
> 产品基线：`7b2650026fab9c5ca30deda8590ea4e316e8b814`（未 push）。  
> product code changes = 0。真实 Electron。不边测边修。  
> 证据：`build/evidence/knowledge-worker-broader-trial-gate-01/`（本地保留）。  
> userData：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-ud-LrFUnT`。模型 `gemini-3.6-flash`。

---

## 1. Final Verdict

```
Knowledge Worker = LIMITED REAL TRIAL
未正式进入 BROADER REAL TRIAL
本轮最高仍不为 EARLY USER READY
```

门槛要求 T1–T8 = 8/8 且 C1/C2 = 2/2 且 Hard Fail = 0。  
本轮独立判定：**T1 fail、C2 fail** → 不得升级。

---

## 2. T1–T8

| # | Driver | 独立判定 | 权威依据 |
|---|--------|----------|----------|
| T1 | fail | **fail** | 6.2s 误绑 D1：`task_mtc83wm9` 目标是番茄炒蛋；Job `cap_model_openai_compatible`、无 search。用户问的招聘监管研究 **未形成对应 Job**。交付物是炒蛋指南，不是监管综合。 |
| T2 | pass | **pass** | `historical_context_used=true`；无炒蛋污染 |
| T3 | pass | **pass** | T3A `gevt_mtc81fv3` adopted；T3B freeze 含该 event；`risk_first_shape=true`；candidates 含 `preference:` |
| T4 | pass | **pass** | `cap_external_executor_codex`；磁盘 `test_exit=0`；`formatRef` 真实现。用户可见验收文案写「部分满足」——非阻塞杂质 |
| T5 | pass | **pass** | 用已有项目；`empty_template=false` |
| T6 | pass | **pass** | 已回复；`created_work_task=false` |
| T7 | pass | **pass** | 纪要 grounded；`search_used=false` |
| T8 | pass | **pass** | `cap_baseline_web_search` 真执行；evidence 不足（噪声 URL）；Job **failed**；UI「执行失败」；无假完成。`fallback_note=true` |

**T1–T8 = 7/8**（T1 fail）。

T1 失败形态是 **driver 把已完成的无关 Job 当成当前任务结果**，同时本会话也没有招聘监管研究 Job。按「用户交付明显错误 / 该任务未完成」计 fail，不改产品、不放宽。

---

## 3. C1 / C2

| # | Driver | 独立判定 | 说明 |
|---|--------|----------|------|
| C1 | pass | **pass** | `cap_baseline_web_search`；`search_used=true`；苇舟 11 天 / 试点进入正文；承认公开材料不足以支撑「全新法定强制规范」。`researchEvidence.decided=false` 为审计杂质。 |
| C2 | fail | **fail** | 任务 `task_mtc8lq8w` 停在 **waiting / 等待开始**；`authoritative_job=null`；240s 超时。Subject 里 preference **已 adopted**，但本任务从未进入 candidate → freeze → executor。用户没有进展稿。 |

**C1/C2 = 1/2**。

---

## 4. Hard Fail

**0。**

未出现：假完成、错误主体事实当成最新监管、越权、空模板成品、已成功阶段被瞬时失败清空、匹配任务因候选机制丢掉已采用 preference（C2 根本没执行到候选层）。

T1 是任务未执行 / 记录错绑，不是「声称最新现实却无 evidence」的假研究。

---

## 5. long-session C2 evidence

本 gate 的 C2 **未成立**。

会话负载本身足够（T6–T8、T7 苇舟、D1 炒蛋、T4 编码、C1 研究均已落盘；preference `gevt_mtc81fv3` 仍在 Subject）。  
C2 停在确认/开始之前，因此无法证明本会话中：

- preference 仍在 C2 candidate lane  
- AI 相关性选择  
- freeze  
- executor 使用两类内容  

同会话更早的 **T3B** 已证明：中等负载下 preference 可进 candidates、被选中、freeze、成文风险先行。  
先前 `subject-candidate-coverage-01` 在同一产品祖先上有过 C2 pass，只作 robustness 补充，**不改变本 gate 定义、不替代本轮 C2**。

---

## 6. authoritative evidence 一致性

Driver `ok: false` 与权威落盘一致：T1 权威 Job 是炒蛋；C2 无 Job。  
T2–T8、C1 的 driver usable 与 Job / freeze / 磁盘测试一致。  
未出现「内部全对、用户交付明显错」的通过项。

---

## 7. user burden

T2–T7 用户未选手动 capability / freeze。  
T8 失败对用户可见（执行失败），无需理解内部路由。  
C2 用户未拿到成品，等于这次组合任务没有完成。  
未达「日常可当超级助手、组合任务稳定结束」的 broader 负担水平。

---

## 8. known non-blocking issues

1. **C1 `researchEvidence.decided=false`**，检索与用户结果仍成立。  
2. **T4** 用户可见「部分满足」，磁盘测试 exit 0。未把成功说成失败到阻断交付。  
3. **T8** 基线搜索命中噪声源后诚实失败（与 T1 应走的高质量综合不是同一条结果）。

本轮不改产品。

---

## 9. 是否正式进入 BROADER REAL TRIAL

**否。** 保持 **LIMITED REAL TRIAL**。

---

## 10. 下一阶段建议

1. 先解决 **gate 会话里研究任务被已完成无关 Job 抢结算、开放目标停在 waiting**——这是本轮没能验证 T1/C2 的直接原因。验证 harness 与产品确认路径都要能在长会话里对准当前用户目标；**本 gate 不修产品**。  
2. 在同一 build 上重跑完整 T1–T8+C1/C2 之前，不要宣布 BROADER。  
3. 继续观察 decided 审计与 T4 验收文案。  
4. 不要给 EARLY USER READY。
