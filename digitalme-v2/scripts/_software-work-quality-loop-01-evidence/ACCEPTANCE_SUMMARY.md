# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- fix: FIX-WINDOWS-VALIDATION-EVIDENCE-05
- readonlyCodexLocateWired: true
- realCodex: true
- readonlyZeroDiff: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## FIX-WINDOWS-VALIDATION-EVIDENCE-05

### EINVAL 根因
Windows 上 `spawnSync('npm.cmd', args, { shell: false })` 无法直接启动 `.cmd` 包装器，Node 报 `EINVAL`。构建/启动检查与测试共用该路径，导致 Owner 真机在 MUHUB 上出现「构建/启动失败：spawnSync npm.cmd EINVAL」。

### 命令执行修复
统一入口 `runProjectCommand`（`test-command.ts`）：
- Windows 优先 `node` + `npm-cli.js` / `npx-cli.js`；
- 回退 `cmd.exe /d /s /c` + `quoteCmdArg`（受控 argv，非自由 shell 拼接）；
- 构建 / 启动 / 测试共用；缺 script → `not_configured`，不得标 `execution_failed`。

### 证据与目标判断
- 技术证据：完整修改文件列表、每文件 +/- 摘要、命令行/退出码、构建/启动结果、越界与 HEAD/commit；
- 目标判断：以执行前理解路径 + 实际 diff 为主，关键词仅辅助（「不作为主判定」）；
- 未配置测试 vs 测试执行失败明确区分。

### Windows 真实回归（隔离 fixture，未改 MUHUB）
`fix-05-windows-validation-evidence.test.ts` + blocker-04/05 → **28/28 pass**  
覆盖：EINVAL 根因复现、npm 成功、非零退出、缺 script、超时、路径含空格、build/startup、技术证据完整性。

### MUHUB 现场
Owner 既有 9 个范围内文件变化：本修复过程未 reset/clean/stash/commit/push，亦未重跑 Coding Agent。

## 说明
工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
