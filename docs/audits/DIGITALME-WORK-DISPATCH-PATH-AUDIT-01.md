# DIGITALME-WORK-DISPATCH-PATH-AUDIT-01

> 工作分发路径审计。只读诊断。**product code changes = 0**。不修 T1/C2，不加 retry/sleep，不改 prompt / intent / research / Subject / Job router。
>
> 产品基线：`7b2650026fab9c5ca30deda8590ea4e316e8b814`  
> 最新 Gate 文档：`5ec252461a8824bbfe21a05a2be13ac64f3d026d`  
> 证据：`build/evidence/knowledge-worker-broader-trial-gate-01/`  
> 权威落盘：Gate 会话 userData `subjects/default/runtime/tasks|jobs`（会话 id `dmv2-kwgate-ud-LrFUnT`）  
> Driver（未入库）：`scripts/knowledge-worker-broader-trial-gate-ui-driver.cjs`

本轮不问 research result quality，不问 Subject candidate coverage。T1/C2 都在那些层之前失败。

核心问题：**用户刚刚说的这件事，系统是否可靠地成为一个新的、正确归属的工作单元？**

---

## 1. Executive Verdict

**类别：D（State ownership flaw）为主因，叠加 A（product dispatch）与局部 B（driver attribution）。C（async race）是放大器，不是独立根因。**

产品没有「这一次用户发送 → 这一次工作单元」的身份。权威对象是分裂的：

| 对象 | 权威源 | 实际绑定 |
|---|---|---|
| conversation turn | `Task.meta.conversation.turns`（按 taskId 追加） | 发送时的 renderer `activeTaskId \|\| converseDraftTaskId`，**不是**「刚才那句输入」 |
| work request | 同上 + `work.converse` 的 `text` | compose 框里的原文可以从未进入 converse |
| Job | `jobStore` per task | 仅 `submitTask` 创建；converse **永不创建 Job** |
| active Job | 不存在全局指针；`latestJob(jobsForTask)` 是 **per-task** | Driver 把 `work.listTasks[0]` 当成当前任务 |
| waiting | `deriveTaskState`：该 Task **无 Job**（或 latest `queued`） | 不是独立持久态，也没有 wake-up |
| completion | Job `succeeded` + artifact | Driver 只要 list[0] 上已有 succeeded Job 就结算 |

因此系统不能保证「当前最新一个 Job 就是用户刚说的任务」。T1 恰好踩中了这条错误等式。

**T1 与 C2 有共同根因，失败跳不同。**

共同层：

1. `work.converse` 在本会话中反复 `degraded`（用户面：「理解能力需要的模型连接不可用」）。降级 = **零效果**：无用户可见规划、无 `startAuthorized`、无 Job。
2. 降级后没有与「这一轮用户目标」绑定的恢复路径。后续「确认」只是又一次 converse，taskId 取当时 renderer 指针。
3. 首轮失败后 `seed_internal` 规划对 UI 不可见 → 「确认规划并开始开发」通常不出现 → 任务可以永久 `waiting`。

不同跳：

- **T1**：招聘原文 **从未进入任何 Task 的 conversation store**。Driver 点到的「确认」写进了上一任务「番茄炒蛋」。Driver 又用 list[0] 的已成功 Job 在 6.2s 内误判 settled。
- **C2**：开放目标 **已经建成自己的 Task**，首轮 converse 降级，内部 seed 规划，**从未再发出第二轮「确认」**，无 Job，诚实超时。

成功对照（T2 / T5 / C1）证明：同一长会话里，只要「用户目标」进入自己的 Task，并且在模型通道恢复后有一轮绑在 **该 Task** 上的 `confirm_start`，就能 `submitTask` 并完成。T5 甚至也经历了首轮降级，靠第二轮「确认」救回。C2 没有这第二轮。T1 的第二轮打到了别人身上。

---

## 2. T1 完整时间线

**UI 输入原文（Driver）：**

> 欧美招人用生成式模型筛简历，监管最近有没有实质变化？我们产品会碰到人事决策，接下来半年合规上该先盯哪些。

**会话：** 同一 Electron 长会话。前序 D1 已完成。

### 2.1 产品落盘（权威）

落盘 Task 全集（Gate 结束时仍是这 9 个）**没有**招聘监管这条 goal。`runtime/tasks/` 与 `runtime/jobs/` 均无对应文件。全库检索「招聘 / 筛简历」= 0。

D1 炒蛋 Task `task_mtc83wm90b27c6ec0abf` 的 conversation 才是 T1 窗口里真实发生的 converse：

| 时间 (UTC) | turn | 原文 | intent | 备注 |
|---|---|---|---|---|
| 00:38:31 | Task created | goal = 番茄炒蛋 | — | D1 |
| 00:38:41 | user + DM | 炒蛋原文 / 规划回应 | `add_goal_info` 0.98 | 首轮成功 |
| 00:38:48 | user「确认」+ DM | 开始生成 | `confirm_start` 1.0 | D1 `submitTask`；Job `job_mtc84a5o` createdAt 00:38:48.684 |
| 00:39:02.872 | — | — | — | D1 Job `succeeded` |
| **00:39:09.314** | **user「确认」+ DM 降级** | **「确认」** | **`other` degraded** | **T1 窗口；不是招聘原文** |

招聘原文不在该 Task，不在其它任何 Task，也不在对话页 `ui/conversation.ndjson`（该文件只有 T3A 偏好句）。

### 2.2 Driver / UI 观察

`t1.json`：

- `time_to_result_ms`: **6237**
- `user_confirmation_count`: 1，`confirm_clicked`: true
- `taskId`: `task_mtc83wm90b27c6ec0abf`（炒蛋）
- `authoritative_job`: `job_mtc84a5o69f51df217be`（炒蛋，`succeeded`，无 search）
- `work.listTasks` 当时只有 D1 炒蛋 + T7 财务说明

`t1-result.png`（T1 结算瞬间）：

- 左栏仍是炒蛋 / 财务，**无招聘任务**
- 中栏标题「新建任务」；时间线是「确认」+ 模型连接不可用；红字「还没有可确认的方案。请先发送要做的事。」
- **招聘原文仍停在 compose 输入框**，未被清空（`submitWorkNaturalLanguage` 只清 `work-nl-input`，不清 `#goal`）
- 右栏仍展示炒蛋已确认规划 v1；「确认规划并开始开发」仍可见

Driver 结算逻辑（`waitJobSettled` / `attachAuthoritativeEvidence`）：

```text
taskId = work.listTasks.tasks[0]
job    = latestJobForTask(taskId)
if job.status === "succeeded" → settled ok
```

T1 开始时 list[0] 已是刚完成的炒蛋。fillAndSendGoal **不 await** `work.converse`。maybeConfirmPlan 约 1.2s 后点 start。waitJobSettled 立刻看到炒蛋 Job succeeded → 6.2s 退出。

### 2.3 必须回答的 8 问

1. **招聘输入是否进入 conversation store？** 否。权威落盘零命中。截图里它还在 compose 输入框。
2. **模型是否收到该输入？** 否。converse 本轮收到的是「确认」，且 `degraded`，模型通道未产生 intent/plan。
3. **是否产生 work intent / plan？** 对招聘：否。对误绑定的「确认」：`intent=other, degraded=true`，零效果。
4. **若产生，为何没建新 Job？** 未产生招聘工作单元。converse 按设计不建 Job。误绑定的「确认」也因 degraded 不授权 `submitTask`。
5. **为何「番茄炒蛋」仍是 authoritative Job？** 产品侧从未创建招聘 Task/Job。Driver 把 list[0] 的已成功 Job 当作当前结果。两者同向，不是「产品建了招聘 Job 而被 Driver 看错」。
6. **绑错旧 Job，还是新 Job 根本没创建？** **新 Job 根本没创建。** 另有一层产品错误：T1 窗口的 converse 把「确认」追加到了旧 Task。
7. **是否存在全局 latestJob/currentJob 指针错误？** 产品 **没有** 全局 currentJob。`latestJob` 只在单 Task 的 Job 集合上计算。错误指针在两处：renderer 发送时的 `activeTaskId`（让「确认」进了炒蛋 Task）；Driver 的 `tasks[0]`。
8. **上一任务 completion 后状态是否未清理？** 是。D1 Job 已在 00:39:02 完成，00:39:09 仍能对炒蛋 Task 追加「确认」。右栏炒蛋规划与 start 按钮在「新建任务」壳下仍可见。`btn-start-development` 不在 `WORK_UX_EL_BY_ID` 重置表里，跨任务可见性会残留。

**T1 第一失真点：** 招聘原文没有成为 `work.converse` 的 `text`（未 `createConversationTask`）。紧随其后的「确认」被写进 D1 Task。Driver 在新工作单元出现之前，用 D1 已成功 Job 宣告 T1 完成。

---

## 3. C2 完整时间线

**UI 输入原文（Driver）：**

> 帮我整理一版能直接拿去对上的进展稿，结构你定。

### 3.1 产品落盘（权威）

Task `task_mtc8lq8w7f6971b3f738`

| 字段 | 值 |
|---|---|
| createdAt | 00:52:22.688 |
| goal | 与 UI 原文完全一致 |
| jobs | **无**（`runtime/jobs/` 无此 taskId） |
| plan | v1 `draft` **`source: seed_internal`**（「内部恢复材料，未完成模型规划」） |
| plan.updatedAt | 00:52:57.585 |
| conversation | 仅一轮：user = 原文；DM = `CONVERSE_DEGRADED_NOTICE` |
| intent | `other`, confidence 0, **degraded: true** |
| 第二轮「确认」 | **不存在** |

`events.json` 在 C2 窗口无 `job.updated`。`work.listTasks` 派生 `state=waiting` / 「等待开始」。

时间关系：C1 Job 完成 00:52:16.326 → C2 Task 创建 00:52:22 → converse 落盘 00:52:57（约 35s）。`buildConverseChat()` 在 `chat === null` 时会立刻降级；35s 间隔说明当时 **chat 函数存在，但调用失败/抛错**（`chatFailed=true`），用户面文案仍是「模型连接不可用」。这是误导性文案，不是「没配模型」——同会话 T2/T5/C1 的 Job 都跑过 `cap_model_openai_compatible`。

### 3.2 Driver / UI 观察

`c2.json`：

- `time_to_result_ms`: **248197**（240s 超时）
- `user_confirmation_count`: **0**
- `authoritative_job`: **null**
- `settled.timeout`: true
- `candidate_coverage.candidateCount`: 0（未到 freeze/executor，本审计不展开）

`c2-result.png`：C2 任务选中、「等待开始」、时间线为原文 + 同一句降级提示、工作区「尚未产生成果」、输入框空且发送可用。

### 3.3 必须回答的 7 问

1. **waiting 是什么真实状态？** `deriveTaskState(jobsForTask)`：该 Task Job 集合为空 → `waiting`。Task 自身不持有 status 字段。用户面「等待开始」。
2. **谁设置 waiting？** 没有人写入 waiting。它是「还没有 Job」的派生。首轮 `createConversationTask` 按设计就是无 Job。
3. **正常谁负责离开 waiting？** Renderer 在 `startAuthorized` 后调 `work.submitTask`（`startConversationTaskExecution`）。Job `queued`/`running` 后派生变为 processing。低风险文档另有 `maybeAutoProgressLowRiskDocument`：要求 **用户可见模型规划**（`source !== seed_internal`），再发一轮「确认」。
4. **对应 callback/event/promise 是否发生？** converse **完成了**（有落盘 turn + seed plan），不是悬挂 promise。之后 **没有** `startAuthorized`，**没有** `submitTask`，**没有** `job.updated`。Executor 从未启动。
5. **是否被上一 Job / confirmation 阻塞？** 否。T8 失败在别的 Task 上；C1 已 succeeded。C2 的 Job 集合是空的。`jobRunning` 不会挡住这个新 Task。
6. **lost wake-up / unresolved promise / disabled send？** **lost wake-up：是。** 降级文案说「等模型恢复连接后，我会继续按你的话推进」，但没有任何恢复回调会重跑该 Task 的 converse。send 未禁用。start 因无用户可见规划而不出现（`hydratePlanFromTask` 丢弃 `seed_internal`）。Driver `maybeConfirmPlan` 只点可见的 start，因此 confirmation_count 保持 0。
7. **为何没有 Job persisted？** converse 永不建 Job；`seed_internal` 不可确认；`maybeAutoProgress` 直接 return；没有第二轮 `confirm_start`。不是 persistence race。

**C2 第一失真点：** 用户目标已经进了自己的 Task，但首轮 `work.converse` `degraded` → 只留下不可见 seed 规划。此后没有绑在该 Task 上的恢复/确认，系统停在「无 Job = waiting」。

---

## 4. 成功 / 失败链对照

同一会话、同一 Driver `runWorkTask`（new-task → fill `#goal` → 点发送 → maybeConfirmPlan → waitJobSettled）。

| | 前一任务 | 本 Task 是否新建 | 首轮 converse | 后续「确认」落在哪 | Job | Driver 结算 |
|---|---|---|---|---|---|---|
| **D1** 炒蛋 | T7 完成 | 是 | 成功 `add_goal_info` + 模型规划 | 本 Task `confirm_start` | `job_mtc84a5o` succeeded 00:39:02 | 正确 |
| **T1** 招聘 | D1 刚完成 | **否** | **招聘原文未发送**；00:39:09「确认」进 D1 | 旧 Task，且 degraded | 无新 Job | **list[0] 误取 D1，6.2s false OK** |
| **T2** 先啃哪头 | T1 假完成 | 是 `task_mtc84udt` 00:39:14 | **成功**（模型规划） | 本 Task：00:40:24 确认 degraded → **00:40:34 再确认 `confirm_start`** | `job_mtc86joq` succeeded | 正确（111s） |
| **T5** 开放目标 | T2 完成 | 是 `task_mtc878qb` 00:41:06 | **首轮 degraded**（与 C2 同类） | 本 Task：00:41:33 `confirm_start` 救回，规划 v2 | succeeded 00:41:52 | 正确（52s，driver confirmation_count=0，确认来自自动/残留 start） |
| **C1** 审批合规 | T8 失败 | 是 `task_mtc8ijlz` | 成功 `add_goal_info` | 本 Task 两轮确认 | succeeded 00:52:16 | 正确（148s） |
| **C2** 进展稿 | C1 刚完成 | 是 `task_mtc8lq8w` 00:52:22 | **degraded + seed_internal** | **无** | 无 | 正确观察到 waiting，240s 超时 |

共同差异（失败相对成功）：

1. **首轮模型通道失败是否被同一 Task 的后续确认接住。** T2/T5 接住了。C2 没有。T1 的确认打到了上一 Task。
2. **用户原文是否成为该 Task 的 goal/turn。** T2/T5/C1/C2 是。T1 否。
3. **Driver 是否在「当前 list[0] 已有 succeeded Job」时立刻收工。** 仅 T1 被这条误伤（因为没出现新 Task，list[0] 仍是 D1）。
4. **pending / confirmation 持久态：** 产品没有跨任务 confirmation 锁。C2 不是被 C1 的确认卡住。
5. **UI send：** C2 发送可用。T1 招聘句留在 `#goal`，真正发出的是 start 路径的「确认」。
6. **main/renderer IPC：** 无证据表明 `work.converse` invoke 丢失。C2/T5 首轮都有落盘。T1 招聘路径根本没 invoke 成功（或未带着招聘 text invoke）。
7. **persistence timing：** C2 seed plan 与 turn 同一毫秒写入。不是「Job 写了但 Driver 没读到」。

T5 是 C2 的对照实验：同样是开放目标、同样首轮 degraded、同样 driver confirmation_count=0，但 9 秒后本 Task 上出现了「确认」且模型已恢复 → 离开 waiting。C2 在 35s 降级后等了 240s，模型通道在会话里并未永久死亡（C1 刚成功），只是 **没有人再对该 Task 说话**。

---

## 5. Authoritative state ownership

### 5.1 应有关系

```text
user turn  ──►  work decision (converse intent/plan)
                 ──►  唯一 Task（若需要做事）
                      ──►  唯一 Job（确认后）
                           ──►  result / artifact
```

turn、Task、Job 应共享一个显式关联（至少：`turnId → taskId → jobId`，发送时冻结，而不是事后猜最新）。

### 5.2 实际关系（多个事实源）

```text
#goal 输入框          renderer 本地，发送后不清空
work-nl / 「确认」     renderer 调用 work.converse({ taskId?, text })
Task.meta.conversation 主进程按 taskId 追加；无 taskId 则 createTask(goal=text)
Task.meta.plan         converse 写入；seed_internal 对 UI 隐藏
Job                    仅 submitTask；与 turnId 无字段关联
work.listTasks[0]      按 activityTime 排序；Driver 当作「当前任务」
activeTaskId           仅 renderer；compose 会清，但残留 start 仍可对旧指针发送
latestJob              per-task 派生，不是全局
deriveTaskState        Job 集合 → waiting/processing/completed/attention
```

没有单一「当前工作」权威。谁先被点到、list 谁排第一、converse 带不带 taskId，三套答案可以不一致。

### 5.3 产品内部 vs Driver 观察

| | 产品内部真实状态 | Driver 观察 | 谁错 |
|---|---|---|---|
| T1 招聘 Task | **不存在** | 把炒蛋当作 T1 | Driver 归因错；产品也没把招聘建成 Task |
| T1 炒蛋 Job | D1 的真实完成结果 | 当作 T1 结果 | **Driver 错**（false settled） |
| T1「确认」turn | 写在炒蛋 Task 00:39:09 | 记了 confirm_clicked | **产品错**（确认未绑定新输入） |
| C2 Task | 存在，goal 正确 | 正确选中 list[0] | 一致 |
| C2 Job | 不存在 | authoritative_job=null | **一致；产品停在 waiting** |
| C2 waiting | 派生自无 Job | 与 UI「等待开始」一致 | 一致 |

**不能把 T1 整锅算成 Driver bug。** 炒蛋 Job 不是招聘 Job——这是产品没创建。Driver 错在「没核对 goal 就宣告成功」。C2 几乎不是 Driver 归因问题。

---

## 6. 第一失真点

### T1

用户招聘句停在 compose `#goal`，没有成为任何 Task 的 user turn。  
同一 6 秒窗口，renderer 把「确认」发进 D1 `task_mtc83wm90b27c6ec0abf`（00:39:09，degraded）。  
Driver `latestTaskIdFromList` 把 D1 已成功 Job 当成 T1 结果。

失真发生在 **send → converse acceptance**，早于 planner / Job / research。

### C2

用户句已成为 `task_mtc8lq8w` 的 goal 与唯一 user turn。  
`work.converse` 在 00:52:57 以 `degraded` 结束，写入 `seed_internal` 规划。  
失真发生在 **converse → work-needed/plan**：零效果，且无「模型恢复后对 **该** Task 重试」的所有者。  
之后的 planner / confirmation / Job / executor 从未被调用。

---

## 7. T1 / C2 是否共同根因

**是，同一所有权缺陷上的两个失败跳。**

共同：

- 用户轮次没有冻结的 work-unit id。
- `work.converse` 降级 = 零 Job，且把「等模型恢复」写成用户承诺，系统不兑现。
- 离开 waiting 依赖一次 **未绑定目标原文** 的「确认」/ start 点击。
- `seed_internal` 对 UI 不可见 → start 经常不出现 → 可以永久 waiting。

分成两跳：

- T1 死在「新输入没进自己的 Task」，再被 Driver 用旧 Job 盖住。
- C2 死在「进了自己的 Task，但降级后没有第二轮绑在该 Task 上的确认」。

不是 research 质量，不是 Subject coverage，不是 Job router 选错能力。

---

## 8. Product bug vs Driver bug 判定

对应任务要求的 A–E：

**主判定：D. State ownership flaw**

证据：turn 只挂在发送时的 taskId 上；Job 只挂在 Task 上；Driver 再用 list[0] 猜「当前」；三层都没有 user-turn id。T5 首轮同样 degraded 却能完成，只因为第二轮「确认」碰巧打在新 Task 上。

**同时成立：**

- **A. Product dispatch bug** — T1 招聘输入未进 store；T1 确认写入旧 Task；C2 降级后无 wake-up，永久 waiting。
- **B. Driver attribution bug** — **仅 T1 结算**：产品没有招聘 Job，Driver 仍报告炒蛋 Job 为 T1 权威结果。C2 的 Driver 观察与产品一致。
- **C. Async lifecycle race** — 放大器：fillAndSendGoal 不 await converse；waitJobSettled 在新 Task 出现前就可因旧 Job succeeded 返回；converse 通道本会话间歇失败（T2/T5/C2 均出现过 degraded）。不是「Job 写入与读取竞态」。

**E. 其它：** 降级文案把 chat 抛错说成「连接不可用」，干扰诊断。次要，不单独成类。

---

## 9. 是否需要统一修复

**需要一次统一修复，而不是分别打 T1 case / C2 case。**

分开修会再分叉：给 C2 加长等待或给 T1 改 Driver 匹配，都不会得到「用户刚说的事 = 一个工作单元」。T5 已经证明降级可被「打在正确 Task 上的第二轮确认」救回——这正是所有权问题，不是个别用例文案问题。

不要在本层修 research / Subject / candidate。那些是后续层。

---

## 10. 最小修复边界建议

只建议边界，本轮不改代码。

1. **发送身份（必须）**  
   compose 发送时：无 taskId 则 `createConversationTask` 的 goal **必须是本次 `#goal`/NL 原文**；禁止用残留 `activeTaskId` 把新目标或「确认」追加到已完成 Task。start / 「确认」必须带 **当前 compose/draft 的 taskId**，不能点到哪个按钮就打进当时的全局指针。

2. **Turn → Task → Job 关联（必须）**  
   至少在 Job 或 Task meta 记录 `originTurnId` / `originUserText`。禁止任何层（产品 UI、Driver、证据）用「最新 Task / 最新 Job」代替该关联。

3. **降级后的离开 waiting（必须）**  
   `degraded` 且无用户可见规划时：要么在模型通道再次可用时 **自动对同一 taskId 重试首轮 converse**，要么给用户一个明确「重试理解」且绑定该 Task 的动作。不能只写「等模型恢复后我会继续」然后无回调。`seed_internal` 不得成为无人能唤醒的终态。

4. **Driver（必须，但是观察层）**  
   `waitJobSettled` / `attachAuthoritativeEvidence` 按 **goal 文本（或本次 create 的 taskId）** 匹配，而不是 `tasks[0]`。已成功 Job 的 goal 与本次输入不一致则不得 settled。await 发送后的 converse 回落，而不是 click 后立刻轮询旧 Job。  
   **不要**用加长 sleep 掩盖。

5. **明确不在本边界**  
   researchEvidence、T4「部分满足」、T8 noisy retrieval、context candidate、Job 能力路由。

---

## 11. 额外观察（不修、不扩大）

1. **`researchEvidence.decided=false`**  
   T1 的招聘 Job 不存在，谈不上 research 决策。不要从 T1 的炒蛋 Job 反推 research 质量。

2. **T4「部分满足」vs test exit 0**  
   与 dispatch 第一失真点无关。本会话 T4 有自己的 Task/Job。不在本审计展开。

3. **T8 noisy retrieval**  
   T8 Task `task_mtc8a99m` 为 `attention` / 执行失败，是后续 C1/C2 的邻居状态，但 C2 并未被该 Job 阻塞。不在本审计展开。

4. **本会话 converse 降级是常态而非 T1/C2 特例**  
   T7 财务、T2、T5 均出现过同一句 `CONVERSE_DEGRADED_NOTICE`。成功者靠 **同一 Task 上的后续确认** 越过；T1/C2 没有这条正确绑定的后续确认。

---

## 12. 本轮约束核对

- product code changes = 0
- 未增加 retry / sleep / driver wait / prompt / intent / research / Subject / candidate / Job router
- 只新增本审计文档
- push = no
