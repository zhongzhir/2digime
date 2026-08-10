# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- fix: DIGITALME-CTO-LOOP-08
- readonlyCodexLocateWired: true
- realCodex: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## DIGITALME-CTO-LOOP-08

### 原流程为何丢失 AI CTO
成果面默认呈现规则检查表 + Coding Agent 摘要，把「修改还是接受」推给用户阅读技术证据；Digital Me 未形成独立验收叙事与修正指令。

### 新调用链
用户自然语言 → Digital Me 理解/规划 → 用户确认 → Coding Agent 执行 → Digital Me CTO 独立验收 → 未达标则修正指令 + 用户「确认继续/补充意见」→ 同 Task 新 Job → 达标则「建议采用」→ 用户最终确认。

### 责任边界
- Digital Me：理解、委派、独立验收、修正指令、建议交付
- Coding Agent：文件阅读、实现、命令、测试与工程证据
- 不扩展为自研 Coding Agent；不新增第二套任务状态机

### 验证
`cto-loop-08` + blocker-04/05 + work-ux blocker-02 → **30/30 pass**（隔离 fixture；未改 MUHUB）

## 说明
工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
