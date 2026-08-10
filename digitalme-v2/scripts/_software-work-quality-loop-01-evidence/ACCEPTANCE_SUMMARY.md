# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- task: 2DIGIME-BUILD-01-CONVERSATIONAL-WORKSPACE-10
- baseline: a7274107a2f655258f5dbdcf868d90a7096e61b4
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## CONVERSATIONAL-WORKSPACE-10

### 页面职责
- 左栏：任务名称、简要状态、新建任务
- 中栏：唯一主交互 — 时间线（目标 / 理解 / 进展 / Digital Me 验收 / 修正建议 / 多轮自然语言）+ 固定输入区
- 右栏：成果版本 / 预览 / 文件 / 打开下载；简洁执行状态；技术证据折叠；无成果时「尚未形成可交付成果」

### 多轮自然语言调用链
用户输入 → Digital Me 理解并建议 → 用户自然语言确认 → Coding Agent 执行 → Digital Me 独立验收（中栏说明）→ 用户继续输入 → 同 Task 新 Job / Artifact 版本 → 循环至建议采用 → 用户确认采用（含版本与后果说明）

### 失败 / 未达标 / 达标
- 失败：中栏解释 + NL 仍可用；「重试」仅为辅助
- 未达标：NL 直接驱动下一轮；无必经「继续修改」按钮
- 达标：验收消息附近「确认采用」；点击前说明版本与结束循环后果

### 复用对象
复用既有 Task / Job / Artifact / revision / acceptance；不新增第二套会话或状态机；不改 AI CTO ↔ Coding Agent 边界；未改 MUHUB。

### 验证
- 单元：`conversational-workspace-10` + `cto-loop-08` + work-ux / blocker-04/05 → **52/52 pass**
- Electron：`electron-conversational-workspace-10-acceptance.cjs` → 3 张视觉截图（隔离 userData）

## 说明
工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
