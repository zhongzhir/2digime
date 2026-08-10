# 2DIGIME-BUILD-01 SOFTWARE-WORK-QUALITY-LOOP

- phase: 2DIGIME-BUILD-01-SOFTWARE-WORK-QUALITY-LOOP
- readonlyCodexLocateWired: true
- fix: FIX-READONLY-CODEX-LOCATE-02
- realCodex: true
- readonlyZeroDiff: true
- conclusion: ready_for_owner_runtime_acceptance
- ownerAccepted: false

## FIX-READONLY-CODEX-LOCATE-02 真实只读定位回归

在 worktree 内对 digitalme-v2 调用真实 Codex（locateWithReadonlyCodex → buildSoftwareTaskUnderstanding）。目标文本不含路径/文件名/函数名。调用前后 git status --porcelain 对比：零新增 dirty。

### A — 做事页确认前任务理解噪音文件

- result: **pass**
- REAL_CODEX: true
- reliability: reliable
- hintFiles（相对路径）:
  - src/work-runtime/job-runner.ts
  - src/execution/software-task-understanding.ts
  - src/execution/software-readonly-codex-locate.ts
  - src/execution/task-package.ts
  - electron/renderer/app.js
  - src/execution/tests/software-task-understanding.test.ts
  - src/execution/tests/software-readonly-codex-locate.test.ts
  - scripts/electron-software-dev-fresh-ud-acceptance.cjs
  - scripts/electron-coding-capability-onboarding-acceptance.cjs
- understanding.keyFiles:
  - src/execution/tests/software-task-understanding.test.ts
  - src/execution/tests/software-readonly-codex-locate.test.ts
  - scripts/electron-coding-capability-onboarding-acceptance.cjs
  - scripts/electron-software-dev-fresh-ud-acceptance.cjs
  - electron/renderer/app.js
  - src/execution/software-readonly-codex-locate.ts
  - src/execution/software-task-understanding.ts
  - src/execution/task-package.ts
  - src/work-runtime/job-runner.ts
- containsNoiseConfig: false
- readonlyZeroDiff: true

### B — 质量等级映射为用户可见状态

- result: **pass**
- REAL_CODEX: true
- reliability: reliable
- hintFiles（相对路径）:
  - src/capability/adapters/code-repo-analysis.ts
  - src/capability/adapters/code-repo-analysis-contract.ts
  - src/artifact-workspace/workspace.ts
  - src/work-runtime/job-runner.ts
  - src/work-runtime/derive.ts
  - src/work-runtime/task-display-state.ts
  - electron/renderer/bundle-quality-ui.js
  - electron/renderer/app.js
  - src/execution/tests/software-task-understanding.test.ts
  - src/execution/tests/software-dev-blocker-07.test.ts
  - src/capability/adapters/tests/p2a-owner-feedback-fix.test.ts
  - src/capability/adapters/tests/code-repo-analysis.test.ts
- understanding.keyFiles:
  - src/capability/adapters/tests/code-repo-analysis.test.ts
  - src/execution/tests/software-task-understanding.test.ts
  - electron/renderer/bundle-quality-ui.js
  - src/artifact-workspace/workspace.ts
  - src/capability/adapters/code-repo-analysis-contract.ts
  - src/capability/adapters/code-repo-analysis.ts
  - electron/renderer/app.js
  - src/capability/adapters/tests/p2a-owner-feedback-fix.test.ts
  - src/execution/tests/software-dev-blocker-07.test.ts
  - src/work-runtime/derive.ts
  - src/work-runtime/job-runner.ts
  - src/work-runtime/task-display-state.ts
- containsNoiseConfig: false
- readonlyZeroDiff: true

### 自动化

node --test --test-concurrency=1 dist/execution/tests/software-readonly-codex-locate.test.js dist/execution/tests/software-task-understanding.test.js → **19/19 pass**。

## 说明

本摘要为工程验证证据，不是 Owner 运行时验收。ownerAccepted 必须为 false。
