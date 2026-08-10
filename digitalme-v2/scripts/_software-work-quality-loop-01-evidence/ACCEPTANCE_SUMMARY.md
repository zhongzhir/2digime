# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- fix: FIX-RETURN-EDIT-ACTION-04
- readonlyCodexLocateWired: true
- realCodex: true
- readonlyZeroDiff: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## FIX-RETURN-EDIT-ACTION-04

### 根因
确认卡「返回修改」只调用 `hideExecutionConfirmCard()`，未 `refreshWorkUxView`。上一轮 UX 仍按 `needs_confirmation` 隐藏了 `start_submit`（开始处理），确认卡关闭后主按钮消失。

### 修复
新增 `returnFromExecutionConfirmToEdit()`：清空 pending 理解、保持 compose、保留材料、恢复「开始处理」并刷新 Work UX。再次「开始处理」走 `submitTask` 重新理解与确认卡。

### 产品链回归（含 MUHUB 材料路径）
`run-fix-return-edit-action-04.cjs`：confirm → return-edit 派生 → 改目标再 submit → 第二张确认卡；task/job 数 0；MUHUB `newDirty: []`。

### 自动化
`fix-return-edit-action-04.test.js` → **5/5 pass**

## 说明
工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
