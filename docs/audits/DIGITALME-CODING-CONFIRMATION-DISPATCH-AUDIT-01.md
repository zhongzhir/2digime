# DIGITALME-CODING-CONFIRMATION-DISPATCH-AUDIT-01

> Coding 规划确认 → Job 分发审计。只读诊断。**product code changes = 0**。  
> 不自动多点确认、不延长 420s、不改 Driver 重试、不去掉确认、不改 ownership / planner / Agent。
>
> 产品基线：`9b6f4d5d90b1bff11993c0391cfc60f1c6b8ef89`  
> Gate-02 文档：`9733f71ee2f41579f8f2f89ebf9f376cdb3e4b5c`  
> Gate-02 证据：`build/evidence/knowledge-worker-broader-trial-gate-02/`（userData `dmv2-kwgate-ud-27t7yt`）  
> 成功对照：Gate-01 T4（基线 `7b26500`，userData `dmv2-kwgate-ud-LrFUnT`）  
> 本轮独立 Electron 观察探针：`build/evidence/coding-confirmation-dispatch-audit-01/`（空 FOCUS 编码任务，只观察、不额外点击）

核心问题：**一个已经正确归属、已经完成规划的 Coding Task，为什么没有从确认稳定推进到 Job？**

---

## 1. Executive Verdict

**类别：C（Product UX bug）为主因。**  
ownership 修复的副作用藏起了确认控件，规划出现后没有对称地再显示。确认身份其实已经绑对。Driver 点不到隐藏按钮是后果，不是根因。不是 Turn→Task 丢失，也不是第二层 coding authorization 卡住。

Gate-02 T4 与本轮隔离探针结论相同：

| 节点 | 结果 |
|---|---|
| Task 创建 / 归属 | 正确 |
| 规划 persist | 正确（`source=model` / `thin_v1` / `draft`） |
| 文案请求确认 | 有（「待你确认」「请确认方案后开始」） |
| `#btn-start-development` 可见 | **否**（`hidden` + `display:none` + 面积 0） |
| 按钮 dataset 身份 | **已绑对** taskId + originTurnId |
| 用户/Driver 确认动作 | **未发生**（`user_confirmation_count=0`，无「确认」turn） |
| IPC / `work.converse` confirm | 未发出 |
| `startAuthorized` / `submitTask` | 未到达 |
| Job / Coding Agent | 无 |

文档类任务能完成，是因为 `maybeAutoProgressLowRiskDocument()` 在**无 folder 材料**时会自己调用 `confirmPlanAndStartDevelopment(taskId)`，不依赖可见按钮。Coding T4 带了项目文件夹，该自动推进被跳过，于是唯一用户路径就是那颗被藏起来的按钮。

---

## 2. Gate-02 T4 时间线

权威落盘：`C:\Users\46554\AppData\Local\Temp\dmv2-kwgate-ud-27t7yt\subjects\default\runtime\tasks\task_mtck650b4bf781be73b1.json`

同一长会话。T4 之前已有 T7 / D1 / T1 / T2 / T5 / T3B。Driver：`newWorkTask` → 添加 `lot-format` 文件夹 → 发送编码目标 → `maybeConfirmPlan` + `waitJobSettled` 420s。

| UTC | 节点 | 权威事实 |
|---|---|---|
| 06:16:10.715 | Task 创建 | `task_mtck650b4bf781be73b1`；goal = 引用号格式化；`contextRefs.kind=folder` |
| 06:16:20.567 | coding user turn | `turn_4fefbfdb-4ec2-453e-816e-4062fb2f5577`；intent `add_goal_info` 0.95 |
| 06:16:20.567 | converse / planning | DM 回复含 `lot.js` 空实现与 `CD-0004`；「方案确认后我即可开始实施」 |
| 06:16:20.556 | plan persisted | `meta.plan.status=draft`；`source=model`；`version=1`；semantic 含 `code_execution` |
| — | confirmation requested（产品文案） | 中栏：「需要你：请确认方案后开始」；右栏：「待你确认」 |
| — | confirmation rendered（可点控件） | **未出现**。截图 `t4-result.png` 右栏规划可见，底部无「确认并开始」 |
| — | user/driver confirmation | `user_confirmation_count=0`。conversation 只有 2 轮，无「确认」 |
| — | confirmation IPC | 无 `workUnit=confirm` |
| — | submitTask / Job | **无** Job 文件；`authoritative_job=null` |
| 06:23:15 左右 | Driver 超时 | `time_to_result_ms=424784`；磁盘 `lot.js` 仍 `return ''`；`test_exit=1` |

`workUnit.originTurnId` 始终是 `turn_4fefbfdb-…`。后续 T8/C1/C2 仍把该 Task 当作历史 conversation 候选，没有被后续 Turn 写脏。

Driver 确认动作（未改，仅引用）：

1. `evaluate`：仅当 `#btn-start-development` **`!el.hidden && !el.disabled`** 才 `click()`。
2. Playwright `locator.isVisible()` 为真才再点一次。
3. 不把「确认」打进自然语言框。

隐藏按钮使两条路径都为假。420s 内反复尝试等于空操作。

---

## 3. Successful T4 对照

Gate-01 T4（同一题、同一 Driver、长会话、folder 材料）。产品基线 **早于** ownership 提交，`enterCompose` 还不会把开始按钮永久 `hidden`。

| 项目 | 成功 Gate-01 T4 | Gate-02 T4 |
|---|---|---|
| Task 创建 | `task_mtc897sp431f25e20f48` @ 00:42:38 | `task_mtck650b4bf781be73b1` @ 06:16:10 |
| planning | model draft @ 00:42:48 | model draft @ 06:16:20 |
| confirmation request | 文案「请您确认」 | 文案「请确认方案后开始」 |
| UI confirmation | 按钮可点；会话出现用户「确认」 | 按钮 hidden；无「确认」turn |
| taskId | 自有 Task | 自有 Task |
| originTurnId | 首轮用户 turn `turn_91c20385-…` | `turn_4fefbfdb-…`（正确） |
| authorization | 规划确认后低风险自动附 `executionAuthorization` | 未进入该层 |
| submitTask | 第一句「确认」后立刻发生 | 未调用 |
| Job created | `job_mtc89lce…` @ 00:42:56（确认后 ~1s） | 无 |
| Agent launch | `cap_external_executor_codex`；24s 完成；磁盘 test exit 0 | 无 |

Gate-01 会话细节：

- 00:42:55 用户 turn「确认」`confirm_start` 1.0 → Job @ 00:42:56。
- 00:43:04 第二次「确认」（wait 循环在 Job 已存在后 dual-click）。规划 `confirmedAt` 落在第二次。
- 不是两套产品确认层；是 Driver 在 Job 出现前/后各点了一次可见按钮。

长会话差异（不解释失败）：

| | Gate-01 T4 前 | Gate-02 T4 前 |
|---|---|---|
| 已完成 Task | 6（T7/D1/T1/T2/T5/T3B） | 6（同序） |
| 先前 Coding Job | 无 | 无 |
| 本轮是否 compose 新建 | 是 | 是 |

本轮隔离探针（无前序 Task）复现同一隐藏按钮，因此**不是** previous confirmation residue / stale UI / 长会话 epoch 竞争。

隔离探针 `2026-08-28T06:50:40.521Z`：

- 规划面板 `htmlHidden=false`，「待你确认」
- 按钮文案已改成 thin 的「确认并开始」，`disabled=false`
- `dataset.taskId=task_mtcle4h9f1fb7283d779`
- `dataset.originTurnId=turn_8e29e2be-9cb5-4293-841b-0424df49e640`
- **`htmlHidden=true`，`display:none`，rect 0×0，`playwrightVisible=false`，`driverWouldClick=false`**
- `planStatus=draft`；turns=2；confirmTurns=0；jobs=0

---

## 4. Confirmation ownership

确认控件身份在规划出现后是对的。断的是**可见性**，不是 owner。

`9b6f4d5` 在 `enterCompose` 增加：

```
bindStartButton(null, null);
els.startDevelopment.hidden = true;
els.startDevelopment.setAttribute("hidden", "");
els.startDevelopment.disabled = true;
```

目的：新建任务时清掉上一任务的确认绑定，避免 stale confirm。这一点本身合理。

规划渲染后 `refreshTaskWorkspace`：

- `bindable` = 非 compose + 有当前 Task + 有非 `seed_internal` 规划
- `bindStartButton(boundTask, origin)` 写入 dataset
- `setPlanEl` 把 `disabled=false`、改按钮文案
- **没有任何路径 `hidden=false` / `removeAttribute("hidden")`**

全 renderer 里，给该按钮设 `hidden` 的只有 `enterCompose`。没有对称的 show。

因此：

- confirmation identity：**正确**（探针 dataset 与落盘 workUnit 一致）
- confirmation presentation：**失败**
- 不存在「点到旧 Task」——因为点击从未发生
- 不是 stale/epoch 拒绝后静默丢弃——main 从未收到 confirm IPC

---

## 5. Authorization layers

存在两层，但 Gate-02 T4 **停在第一层之前**。

### 第一层：计划确认

谁触发：用户点 `#btn-start-development`，或文档类 `maybeAutoProgressLowRiskDocument()`。  
谁持有：renderer `confirmPlanAndStartDevelopment` → `work.converse({ workUnit:"confirm", taskId, originatingTurnId })`。  
谁继续：`startAuthorized` → `startConversationTaskExecution` → `work.submitTask`。

Coding / folder 任务被自动推进明确排除：

```
if (refs.some((m) => m && m.kind === "folder")) return;
if (taskRefs.some((r) => r && r.kind === "folder")) return;
```

所以 T1/T2/T5/T3B/T8/C1/C2 能在按钮隐藏时完成：它们走自动推进。T4 不能。

### 第二层：执行授权（写目录 / executor）

谁触发：`submitTask` 且 `forceModify && !executionAuthorization.confirmed` 时，main 返回 `needsExecutionConfirm`，**不创建 Job**。  
谁持有：renderer `pendingExecutionConfirm` + 右栏 high-risk 控件。  
谁继续：

- 低风险 + `fromPlanConfirm`：自动附 `executionAuthorization.confirmed=true` 再 submit（用户不可见）
- 高风险：`btn-tw-high-risk-confirm`
- 非规划确认入口：文案「请先在右侧确认最新规划」

Gate-02 T4 从未 `submitTask`，因此从未进入 `needsExecutionConfirm` / `pendingExecutionConfirm`。截图也没有高风险第二卡。

**不是**「planning confirmed → 等待 coding authorization → UI 没再呈现」。  
**也不是**「coding confirmation 已产生，generic handler 没推进 submit」。

---

## 6. First broken node

**第一个断点：确认控件未展示。**

链路与断点：

```
coding user turn          ✓
→ Task                    ✓ 归属正确
→ converse / planning     ✓
→ plan persisted          ✓ draft / model
→ confirmation requested  ✓ 文案
→ confirmation rendered   ✗  #btn-start-development 保持 hidden
→ user/driver action      （无法发生）
→ confirmation IPC        （未发出）
→ startAuthorized         （未到达）
→ submitTask              （未调用）
→ Job / Agent             （无）
```

`submitTask` 没发生，是因为确认动作没发生，不是状态枚举不匹配、plan version mismatch、stale rejection、callback 丢失或 confirmation consumed 无 continuation。那些节点都还没碰到。

---

## 7. Product vs driver verdict

| 类别 | 是否成立 | 说明 |
|---|---|---|
| **C. Product UX bug** | **主因** | 产品要求确认并渲染规划，但不显示可确认控件。真实用户同样看不到按钮。 |
| **B. Driver bug** | 次要后果 | Driver 只点可见 `#btn-start-development`。条件与产品隐藏一致。人可以在输入框打「确认」走 converse；Driver 不走这条。产品文案称「快捷按钮只是辅助」，暗示按钮应当存在。 |
| A. Product dispatch | 未证实 | 隐藏按钮上的 taskId/originTurnId 已正确。未证明点下去后 Job 仍不创建。 |
| D. Async/state race | 否 | 隔离会话同样隐藏；无迟到事件拒绝。 |
| E. Ownership residue | 部分 | Turn→Task 已修对。`enterCompose` 藏按钮是 ownership 防护；缺「规划就绪后重新展示」。确认 operation 的身份已绑上，缺的是可见性。 |

可多项同时成立：**C 为主，E 为引入点，B 为放大。**  
仍**不是** Gate-01 那种「确认落到旧 Task」。

---

## 8. 是否存在 redundant confirmation

对 **T4 这种低风险、已授权项目目录内改一个文件**：

- 文档任务：规划后**自动开始**，用户不点确认。
- 编码+folder：规划后**必须**确认，因为自动推进把 folder 当风险边界。
- 真正写文件时：低风险第二层授权是自动附带的，用户看不到第二次确认。
- 高风险（删库、push、生产发布等）才有单独的 `btn-tw-high-risk-confirm`。

因此 T4 **没有双重确认卡住**。实际是：**需要的那一次确认没有控件。**

产品问题（只判断，不改）：

> 「我计划这样改代码，是否开始？」作为写真实文件的边界，当前设计是有意的，不是 Coding 一律确认。  
> 但同一产品里文档自动开始、编码只靠一颗会被 compose 藏死的按钮，编码路径对用户/Driver 都不可完成。  
> 若保留该边界，必须稳定展示确认控件。若认为执行合同已足够，才应讨论去掉第一层——本轮不改。

---

## 9. 最小修复边界

值得做一个**小而统一**的 renderer 修复，不要动 planner / Agent / capability / Subject / work-unit 身份：

1. `enterCompose` 继续隐藏并清空确认绑定（防 stale）。
2. 当 `bindable && workspaceMode==='planning'`：去掉 `#btn-start-development` 的 `hidden`，保持已有 dataset 绑定。
3. 有 Job / running / compose 时再藏回去。
4. **不要**给 folder 打开 `maybeAutoProgressLowRiskDocument`。
5. **不要**让 Driver 多点或改打「确认」。
6. 不改 `submitTask` / `executionAuthorization` 合同。

修复后应重跑**同一最终 build 上的完整 Gate**（T1–T8 + C1/C2），因为编码确认是唯一相对文档自动推进的分叉。本审计轮不修、不重跑 Gate。

---

## 10. 是否值得重新跑完整 Gate

**现在不要。** 产品代码未改，重跑只会再得到 T4 停在待确认。

**在上述 renderer 可见性修复之后，值得。** 那时才回答「按钮出现后 submitTask / Job / Agent 是否稳定」。最高评级仍不超过 BROADER REAL TRIAL。

---

## 观察项（不修）

### T4 验收文案「部分满足」vs 磁盘 test exit 0

发生在 **Digital Me 独立 verifier 聚合层**，不是 Coding Agent 自报，也不是 Driver parser。

Gate-01 Job `job_mtc89lce…` 的 `verification.json`：

- `tests_passed=satisfied`（`npm test --if-present → exit 0`）
- `exit_code=satisfied`，`file_changes=satisfied`
- `claim_vs_diff=partially_satisfied`：「执行器未提供完整文件清单，以独立采集为准」
- `build_check=unverifiable`（无 build 脚本）不单独拉低
- **`overall=partially_satisfied`**

`userFacingVerification('partially_satisfied')` → 「部分满足验收要求」。UI 右栏与成果摘要直接渲染该字符串。Agent 正文写「测试全部通过」。磁盘 `node --test` exit 0。

层定位：**execution-verifier 聚合 → 用户面验收文案**。已知 UX backlog。

### `researchEvidence.decided=false`

与本审计无关。不处理。
