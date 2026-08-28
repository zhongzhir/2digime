# DIGITALME-CODING-CONFIRMATION-UI-FIX-01

> Coding 规划确认按钮恢复。只改 renderer / UI 状态对称。  
> 产品基线：`9b6f4d5d90b1bff11993c0391cfc60f1c6b8ef89`  
> 审计：`docs/audits/DIGITALME-CODING-CONFIRMATION-DISPATCH-AUDIT-01.md`（`e2ca78e`）  
> 证据：`build/evidence/coding-confirmation-ui-fix-01/`（本地保留）  
> Electron：`scripts/coding-confirmation-ui-fix-ui-driver.cjs`（与 Gate Driver 相同的确认点击，无额外 retry / 不加长等待）  
> **不 push。** 不改 planner / ownership / confirmation IPC / submitTask / Agent / capability / Subject。

---

## Before

Gate-02 T4：Task 归属正确，规划 `source=model` 已落盘，文案「待你确认 / 请确认方案后开始」。  
`enterCompose` 把 `#btn-start-development` 设为 `hidden` + `disabled`。规划就绪后 `bindStartButton` 绑上了正确 `taskId` / `originTurnId`，但没有对称 `hidden=false`。

Playwright `visible=false`。Driver / 用户无法点击。confirmation IPC 未发出。`submitTask` / Job / Coding Agent 均未发生。

文档/研究任务不受影响：`maybeAutoProgressLowRiskDocument` 在无 folder 时自行 `confirmPlanAndStartDevelopment(taskId)`，不依赖可见按钮。

---

## After

`enterCompose` 仍然藏按钮并清空绑定。

规划就绪且 **必须由用户确认开工**（folder / `modify_code` / `code-change` / 高风险，即自动推进不会走的路径）时：

`startDevelopmentPresentation` → 显示 `#btn-start-development`，dataset 为当前 Task 的 `taskId` + `originTurnId`。

用户点击仍走原链：`confirmPlanAndStartDevelopment` → `work.converse({ workUnit:"confirm" })` → `startAuthorized` → `submitTask` → Job → Coding Agent。

文档/研究继续自动推进，不新增确认。纯对话不出现该按钮。已完成 Task 不显示开始按钮。过期 `detailTaskId !== displayedTaskId` 不显示。

---

## Renderer state transition

```
enterCompose
  → bindStartButton(null)
  → setStartDevelopmentVisible(false)

refreshTaskWorkspace
  → startDevelopmentPresentation(facts)
      workMode=task
      workspaceMode=planning
      bindable
      confirmationRequired
      displayedTaskId === taskId === detailTaskId
      originTurnId 非空
      无 Job / 无 artifact
  → visible
      bindStartButton(taskId, originTurnId)
      setStartDevelopmentVisible(true)
  → otherwise
      bindStartButton(null)
      setStartDevelopmentVisible(false)
```

实现：

- `electron/renderer/task-workspace.js`：`startDevelopmentPresentation`；`setPlanEl` 按 `showStartButton` 显示/隐藏
- `electron/renderer/app.js`：`setStartDevelopmentVisible`、`taskNeedsUserPlanConfirmation`、`refreshTaskWorkspace` 对称恢复

未改：`maybeAutoProgressLowRiskDocument` 的 folder 早退、converse/submitTask 合同、Job runner、Agent。

---

## Button identity

隔离探针（修复前）已证明 hidden 按钮上 identity 可以是对的。修复后 identity 在 **可见时** 写入：

Electron T4 规划就绪瞬间（`2026-08-28T07:08:58.812Z`）：

| 字段 | 值 |
|------|-----|
| text | 确认并开始 |
| htmlHidden | false |
| playwrightVisible | **true** |
| driverWouldClick | true |
| dataset.taskId | `task_mtcm1ui183e19c6e7f47` |
| dataset.originTurnId | `turn_2eaa637f-d74e-4e6e-8ae0-533ca018f6fc` |

同一 `originTurnId` 写入 Task `workUnit` 与 Job。

---

## Electron T4 evidence

长会话顺序：T6 → T7 → D1 → T5 → T4。userData `dmv2-kwgate-ud-R9V2rl`。约 50.7s。

| 要求 | 结果 |
|------|------|
| 正确 Coding Task | `task_mtcm1ui183e19c6e7f47` |
| planning 完成 | 文案「已根据你的目标形成当前方案」 |
| 可点击确认控件 | `playwrightVisible=true`；`user_confirmation_count=1`；`confirm_clicked=true` |
| confirmation 绑定本 Task | dataset 与 Job.originTurnId 同为 `turn_2eaa637f-…` |
| submitTask / Job | `job_mtcm27ux9aea2c7ef789` `succeeded` |
| Coding Agent | `cap_external_executor_codex` |
| 文件真实变化 | `lot.js` 实现 `toUpperCase` + `padStart(4,'0')` |
| 测试真实运行 | 独立 `node --test` **exit 0** |
| 无 fake completion | 磁盘与 Job succeeded 一致 |

截图 `t4-result.png`：对话出现用户「确认」，成果含代码 diff。验收标题仍写「部分满足验收要求」（已知 verifier 杂质，本轮不修）。

---

## Job / Agent evidence

- Job `taskId` = Coding Task
- Job `originTurnId` = 规划确认所绑 originating turn
- `capabilityId` = `cap_external_executor_codex`
- 无 Job 假成功：测试 exit 0 且文件已改

---

## Regression

| 项 | 结果 |
|----|------|
| T5 document/open-goal | `user_confirmation_count=0`；`t5_start_ever_visible=false`；仍自动推进并 succeeded |
| T5 完成后再选中该 Task | 开始按钮 `htmlHidden=true`，`playwrightVisible=false`，dataset 空 |
| T6 纯对话 | 无 work Task；`coding_button_on_chat=false` |
| T7 附件文档 | 自动推进 succeeded，未新增 Coding 确认 |
| D1 文档 | 自动推进 succeeded |

单元测试：`src/execution/tests/coding-confirmation-ui-fix-01.test.ts`（pending / ready / completed / document / stale / compose / app.js 对称接线）。

---

## Known backlog（不修）

T4 用户面「部分满足验收要求」vs 磁盘 test exit 0。  
`claim_vs_diff=partially_satisfied` 导致 verifier `overall=partially_satisfied`。属 execution-verifier 聚合，不是本次开工失败根因。

---

## Verdict

**PASS。** Coding 规划就绪后确认按钮真实可见、identity 正确、点击后 Job 与 Coding Agent 真执行。文档/对话/已完成 Task 无按钮污染。无 Driver workaround。
