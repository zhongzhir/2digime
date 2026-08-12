# 2DIGIME-BUILD-01-CTO-REAL-MAIN-GATE-20A — 根因（产品缺陷，已停）

## 结论

`productDefectSuspected=true`。真实 `electron/main.cjs` 主链在 **确认规划并开始开发 → Codex 首次执行** 处失败。  
**未改产品代码。** 等待新的产品修复任务。

## 失败点

- UI：`job-status` =「执行失败」
- Job：`job_mspolbz31edb586bea5f` / `status=failed` / `phase=capability`
- `failure.message`：

```text
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

- `externalExecution.projectOrigin`: `"unknown"`
- fixture 目录未改写（`formatLabel` 仍原样）
- 无 Artifact

## 机制对照

`git-trust.ts` / `shouldSkipGitRepoCheck` **仅**在 `projectOrigin === 'digitalme_created'` 且授权目录匹配且非 Git 时注入 `--skip-git-repo-check`。

Owner 同款「添加文件夹」选中的可弃用本地目录在本闸得到 `projectOrigin: unknown`（或等价非 `digitalme_created`），Codex CLI 拒绝执行 → 主链不可用。

这不是脚本放宽断言可掩盖的问题：闸门要求 Owner 式选目录 + 真实 Codex；当前产品策略使该主路径在非 Git / 未信任目录上硬失败，且失败文案直出协议/CLI 细节。

## 脚本侧已排除的干扰

1. **第 1 次跑**：Electron 入口在主线程 `spawnSync` PowerShell 每 ~600ms 采黑窗 → JobRunner 卡住（job 停在 `context` / 仅剩 `.bak`）。已改为 **外层 Node 持续采样**，入口只写相位标记。
2. **第 2 次跑**（修复后）：主线程不再阻塞；Job 正常进入 capability 并在 ~1s 内以上述 Codex trust 错误失败 → 确认为产品缺陷。

## 已通过的闸门段（止于首次执行前）

- 无规划前不出现「开始处理」提交
- 真实模型规划 v1 可见且落盘 `source=model`
- 规划修订：version 严格递增、专属标记写入、jobs 仍为 0
- clean build 通过（外层）

## 未跑到的段

- CTO 五点 / 咨询 / 自然语言再改 / 真重启恢复 / 修订期黑窗分相位完整裁决

## 证据路径

- `scripts/_cto-real-main-gate-20a-evidence/runtime-report.json`
- `scripts/_cto-real-main-gate-20a-evidence/phase1-fail.json`
- `scripts/_cto-real-main-gate-20a-evidence/captured-runtime/jobs/`
- `scripts/_cto-real-main-gate-20a-evidence/captured-runtime/fixture-project/`
- `scripts/_cto-real-main-gate-20a-prior-fail-note.json`（第 1 次阻塞采样诊断）

## 建议的下一产品修复任务（不在本闸实施）

Owner 已选工作目录上，Codex 必须可执行：例如对 `user_selected` 授权目录受控注入 skip / 引导信任 / 或在选目录时明确 Git 前置，且用户面不得直出 CLI 原始错误。修复后重开 CTO-REAL-MAIN-GATE。
