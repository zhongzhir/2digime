# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- fix: FIX-REAL-RUNTIME-LOCATE-03
- readonlyCodexLocateWired: true
- realCodex: true
- readonlyZeroDiff: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## FIX-REAL-RUNTIME-LOCATE-03

### 真机失败根因
确认卡路径 `asReadOnlyLocateHook({ timeoutMs: 45_000 })` 过短。MUHUB 真实只读 Codex 约需 ~95–120s；超时后返回 null，本地有界扫描对无路径提示的 UX 目标亦为 unreliable → 用户面「尚未定位到可靠改动位置」。
DIGITALME_READONLY_CODEX_LOCATE=1 仅影响是否跳过 spawn；父进程已传入，子进程最小环境故意剥离 DIGITALME_*（Codex 用用户级认证）。失败点在**超时**，非认证/未调用。
交互偏差：`work-ux-stage` 在 `needs_confirmation` 硬编码「确认并开始」，覆盖 app.js 已写的「仍要继续」。

### 修复
- 默认/确认卡/改码前超时统一为 `READONLY_CODEX_LOCATE_TIMEOUT_MS = 180_000`
- unreliable 时 UX 主按钮「仍要继续」；refresh 传入 `understandingReliable`
- 样式扩展允许 `.css` 等作为只读定位源码类型

### MUHUB 真实产品链回归
`node scripts/run-fix-real-runtime-locate-03.cjs`（submitTask → needsExecutionConfirm）：
- reliable: true
- 重点文件含：app/page.tsx、app/projects/*、components/home/*、globals.css
- 确认前 MUHUB 零新增 dirty
- 标题为确定性「这项任务需要修改项目文件」（非「尚未定位」）

### 自动化
software-readonly-codex-locate + software-task-understanding + fix-real-runtime-locate-03 → **25/25 pass**

## 说明
工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
