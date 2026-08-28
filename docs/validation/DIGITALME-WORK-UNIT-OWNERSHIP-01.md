# DIGITALME-WORK-UNIT-OWNERSHIP-01

> 长会话工作单元身份：User Turn → Task → Job 必须显式关联。  
> 产品基线：`7b2650026fab9c5ca30deda8590ea4e316e8b814`  
> 审计：`docs/audits/DIGITALME-WORK-DISPATCH-PATH-AUDIT-01.md`（`b9ec952`）  
> 不 push。不改 research / Subject / candidate coverage / context continuity / capability selection。

---

## Before ownership

审计类别 **D（state ownership）** 为主，叠加 A（dispatch）与局部 B（driver attribution）。

权威对象是分裂的：

| 对象 | 名义权威 | 实际绑定 |
|------|----------|----------|
| User Turn | `Task.meta.conversation.turns` | 发送时 renderer `activeTaskId \|\| converseDraftTaskId` |
| Task | `taskStore` | compose 仍可能带上旧 taskId |
| Job | `jobStore` per task | Driver 用 `listTasks[0]` / 全局 latest Job |
| 确认 | 自然语言「确认」 | 当时 UI 上最显眼的 Task，不是 originating Turn |
| waiting | 该 Task 无 Job | 首轮 converse 降级后没有同 Task 恢复 |

因此：

- **T1**：招聘监管原文未进入任何 Task；确认写进已完成的「番茄炒蛋」；Driver 用 list[0] 已成功 Job 在数秒内误判 settled。
- **C2**：开放目标已建成自己的 Task；首轮 `work.converse` 降级 → `seed_internal` → 无用户可见规划 → 无第二轮绑定该 Task 的恢复 → 永久 `waiting`。
- **T5** 同类首轮 degrade 靠用户再发「确认」碰巧救活，recovery owner 不是该 Task。

禁止项未做：延长 wait、driver 自动补确认、latestTask 加判断、T1/C2 特判、招聘关键词路由、waiting 定时转 Job、第二套 Task 真值源。

---

## After ownership

```
User Turn（稳定 turnId）
  → Work Decision（workUnit: new | continue | confirm | recover）
    → Task（若需要做事；meta.workUnit.originTurnId）
      → Job（若进入执行；job.taskId + job.originTurnId）
        → Result
```

`latestJob` / `list[0]` 只用于 UI 排序与「该 Task 自己的 Job 集合」内取最新一条。不得作为跨 Task 归属。

---

## Authoritative Turn → Task → Job

复用现有 `Task.meta.conversation.turns[].turnId` 与 `Job.taskId`。只增加最小关联字段：

| 字段 | 位置 | 作用 |
|------|------|------|
| `workUnit` | `work.converse` 输入 | `new` 忽略泄漏 taskId；`confirm` 必须带 taskId；`recover` 重放原 user turn |
| `originatingTurnId` | converse / submitTask 输入 | 确认与执行绑定原 Turn |
| `Task.meta.workUnit.originTurnId` | Task 持久化 | 本工作单元的首轮用户 Turn |
| `Task.meta.workUnit.converseRecovery` | Task 持久化 | `recovered` / `exhausted`，exhausted 时无 Job → `attention` |
| `Job.originTurnId` | Job 持久化 | 从 Task.originTurnId 写入；证明 Job ← Turn |

绑定规则（`resolveConverseBinding`）：

- `workUnit=new` 或无 taskId → 创建新 Task（T1：compose 不再写入炒蛋）。
- `workUnit=confirm` 无 taskId，或目标 Task 已 `succeeded`+artifact → `stale_confirmation`，不改写旧 Task。
- `workUnit=recover` 必须带 taskId；用原 user turn 正文重试，不追加新 user turn。

确认按钮 `data-task-id` / `data-origin-turn-id` 从规划卡渲染传到 `work.converse` / `work.submitTask`。无 dataset 则拒绝发送「确认」，不回退 `activeTaskId`。

迟到 converse 结果：发送时 `uiEpoch` 与返回时不一致，或 `res.taskId !== activeTaskId`，丢弃 UI 落笔。`job.updated` 仍只更新 `event.taskId === activeTaskId`。

---

## Degradation recovery

区分：

- A. 模型判断无需继续（业务）
- B. 正常规划 / 下一步
- C. 技术性 degrade / transient failure

C 不能变成业务态。`chatWithTransientAttempts` 同一轮最多 3 次。首轮 `createdTask && degraded && chat 存在` 时，runtime 对**同一个 taskId + originTurnId** 再跑 `workUnit=recover`。chat 为 null（模型未配置）不 recover。

恢复成功：该 Task 继续，`converseRecovery.status=recovered`，用户无需再发「确认」。  
最终失败：`exhausted`，无 Job 时 `deriveTaskState` → **attention**（受阻），不是永久 waiting。不创建错误 Job，不切换 Task。

---

## T1 evidence

单测 `src/work-runtime/tests/work-unit-ownership-01.test.ts`「T1: 新研究目标不写入已完成炒蛋 Task」：

- 炒蛋 Turn → 自己的 Task → Job（`job.taskId` / `job.originTurnId` 对齐）。
- 带泄漏 `taskId=炒蛋` 的招聘输入 + `workUnit=new` → **新 Task**；炒蛋 conversation 不含「招聘/筛简历」。
- 对已完成炒蛋 `workUnit=confirm` 与 `submitTask(existingTaskId=炒蛋)` 均拒绝。

Electron（`build/evidence/work-unit-ownership-01/`，长会话先完成 D1 炒蛋再发招聘）：

- 招聘 Task `task_mtcfoyg74f58311cfd12`，goal 为招聘原文，**不是**炒蛋 `task_mtcfn4skc95dd055ccd4`。
- Job `job_mtcfpjeu155cc6dbba1c`：`taskId` 与 `originTurnId=turn_9cb14772-4efd-410f-816c-764734fb01bd` 对齐。
- Driver 按 goal 精确匹配，settled 392s（搜索能力），不是审计里 6.2s 误判炒蛋 Job。
- `t1.json`：`final_result_usable=true`。

Driver：`taskMatchingGoal(listed, initial_user_input)` 精确匹配 goal；无匹配则诚实无 Job。禁止 list[0]。

---

## C2 degrade / recovery evidence

单测「C2/T5: 首轮瞬时 degrade 在同一 Task/Turn 恢复」：

- chat 前 3 次抛错（一轮 attempts 用尽）→ runtime recover 同 Task。
- 返回 `degraded=false`、`recoveryStatus=recovered`、用户可见 model 规划。
- 仍只有 **一条** 原始 user turn；不需要用户再发「确认」。

单测「degrade 最终无法恢复」：无 converseChat → `exhausted` + `state=attention` + 零 Job。

Electron C2（同会话，`c2.json`）：

- 自己的 Task `task_mtcg2brnedd2a7758a26`，Job `job_mtcg3bys67394f229e47` succeeded，`originTurnId` 对齐。
- `settled.ok=true`，state=`completed`，**不是永久 waiting**。
- 本轮模型首轮未 degrade（瞬时失败由单测强制注入）。Gate `final_result_usable=false` 是因为本 FOCUS 未跑 T3A，`preference_in_context=false`——属于偏好质量，不是 dispatch 失败。

---

## Stale callback isolation

单测「迟到确认不能改写后一 Task」：

- 完成 Task A，创建 Task B。
- 对 A 的 `confirm` 抛 `已经完成`。
- B 仍只有自己的一条 user turn「任务B」。

Renderer：compose 清 start 按钮绑定；确认不回退 `activeTaskId`；旧 Task 的 `job.updated` 不写入当前选中的另一 Task。

---

## Long-session sequential evidence

单测「连续 5 个工作单元」：五个不同 goal，各自 Turn / Task / Job id 唯一，且 `job.taskId`、`job.originTurnId` 与该单元 converse 返回值一致。

Electron 同会话连续工作单元（各 goal → 独立 Task/Job/originTurn）：

| 单元 | Task | Job | originTurnId |
|------|------|-----|----------------|
| T7 附件 | `task_mtcfm7akb789499b7166` | `job_mtcfmsdy8d7848883f0a` | `turn_c5fdcbf9-…` |
| D1 炒蛋 | `task_mtcfn4skc95dd055ccd4` | `job_mtcfoh7b6f66b1267efe` | `turn_f20aaf84-…` |
| T1 招聘 | `task_mtcfoyg74f58311cfd12` | `job_mtcfpjeu155cc6dbba1c` | `turn_9cb14772-…` |
| T2 连续 | `task_mtcfxd60f304e99fabb5` | `job_mtcfyeth5374e0007c7a` | `turn_92b33d21-…` |
| T5 开放 | `task_mtcfzf153b0d27cc168f` | `job_mtcg0kkw5be74d106571` | `turn_4c7a43dd-…` |
| C2 进展稿 | `task_mtcg2brnedd2a7758a26` | `job_mtcg3bys67394f229e47` | `turn_c308e8c6-…` |

T6 聊天页：`created_work_task=false`，`tasks_after=[]`。

---

## Driver attribution change

`scripts/lib/trial-authoritative-evidence.cjs`：

- `taskMatchingGoal(listed, goal)` — 精确 goal，失败返回 null（不回退 list[0]）。
- `latestJobForTask(pkgDir, taskId)` — 仅该 Task 的 Job；空 taskId → null，不是全局 latest。

`scripts/knowledge-worker-broader-trial-gate-ui-driver.cjs` 的 `waitJobSettled` / `attachAuthoritativeEvidence` 按 `record.initial_user_input` 找 Task。产品没建对应 Job 时 Driver 判定没有 Job。

覆盖：`scripts/tests/trial-authoritative-evidence.test.cjs`（`taskMatchingGoal` / `latestJobForTask` 不得回退 list[0]）。

---

## Regression

本任务只修 ownership / dispatch lifecycle。

| 项 | 期望 | 本轮 |
|----|------|------|
| T6 纯对话 | Turn 有身份，不强制 Task/Job | 单测 discuss 零 Job；chat 页仍不走 `work.converse` |
| work.converse 既有契约 | 未确认零 Job；模型不可用零 Job | `work-converse.test.ts` 全过 |
| Job 状态机 / snapshot | 同 Task 单活跃 Job | `work-runtime.test.ts` 全过 |
| context continuity | 不改 selection / freeze 逻辑 | `context-continuity-01.test.ts` 全过 |

Electron 本轮 FOCUS=`T6,T7,D1,T1,T2,T5,C2`（`build/evidence/work-unit-ownership-01/`）：

- T1 / T2 / T5 / T6 / T7 的 Gate usable = true。
- C2 Gate usable = false（无 T3A 偏好，非 ownership）。
- 未重跑 T3 / T4 / T8 / C1；`work-converse` / `work-runtime` / `context-continuity-01` 单测全过。T5 首轮未再依赖二次「确认」（`user_confirmation_count=0` 且自有 Job）。

---

## 未做

- 关键词路由、T1/C2 特判、sleep 等 race
- 第二套 conversation store / globalCurrentWork
- 改 research prompt、Subject acquisition、candidate coverage
