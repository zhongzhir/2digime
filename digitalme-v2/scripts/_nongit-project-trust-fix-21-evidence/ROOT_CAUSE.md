# 2DIGIME-BUILD-01-NONGIT-PROJECT-TRUST-FIX-21 — 闸门结果（已停）

## 结论

- **非 Git 信任修正已生效**：用户选择器目录首次真实 Codex 执行成功。
- **全链未通过**：自然语言再次修订未产生新 Job/Artifact（`revision_created_new_job` 失败）。
- 按任务边界：**不继续现场修补、不 commit、不 push**。
- `ownerAccepted=false`；第三次 Owner 真机验收 **不具备条件**。

## 1. projectOrigin 丢失的实际位置

1. **主丢失点**：`electron/renderer/app.js` 中 compose 栏 `#btn-add-folder` 旧处理器只写入 `{ kind, path }`，**未写 `projectOrigin: "user_selected"`**（右栏 `addProjectFolderFromPicker` 才有）。20A/本闸均点击该按钮 → Task.contextRefs 仅有 path。
2. **二次放大**：`needsExecutionConfirm` 在 folder 无 origin 时省略字段；自动授权用 `preview.projectOrigin || "unknown"` → Job 记为 `unknown`。
3. **策略缺口**：即便 origin 正确为 `user_selected`，旧 `shouldSkipGitRepoCheck` 也只允许 `digitalme_created`。

## 2. 新的 Git / 非 Git 信任规则

| 来源 | 非 Git | Git |
|------|--------|-----|
| `digitalme_created` | 授权目录精确一致且硬门通过 → `--skip-git-repo-check` | 不 skip |
| `user_selected` | 同上 | 不 skip |
| `unknown` | **启动 Codex 前拒绝** | 不 skip（走 Codex 正常 Git 检查） |

`--skip-git-repo-check` 只绕过 Codex Git 前置，不绕过 Digital Me 授权。

## 3. 安全硬门与用户面错误

硬门（`assertCodexProjectTrust`）：目录存在且为真目录、WD===授权目录、read/write scope 不越界、项目根非符号链接、unknown 非 Git 拒绝。

用户面映射：trusted-directory / skip-git 英文 →「尚未明确授权项目文件夹…」等自然语言；不直出 Codex 英文句。

## 4. 非 Git 真实 Codex 首次执行结果

**通过。**

- Job `job_msppky005fcc43c7dd1b`：`status=succeeded`，`projectOrigin=user_selected`
- fixture：`formatLabel('start') → 'start-processing'`
- Artifact：`art_msppky005fcc43c7dd1b`
- 未 `git init`

## 5. CTO / 咨询 / 修订 / 重启

| 段 | 结果 |
|----|------|
| 规划 v1 / NL 修订 v2（jobs=0） | 通过 |
| 确认规划 → 首次 Codex | 通过 |
| CTO 五点非空 | 通过（含「独立验收未能按要求形成」等降级表述） |
| 成果咨询且不新增 Job | 断言通过（实现上 wait 条件偏松） |
| NL 再次修订 → 新 Job/Artifact | **失败**（仍仅 1 个 Job；文件仍为 start-processing，未变为 done） |
| 关闭重启恢复 | **未跑到** |

失败时任务侧曾出现「当前结果需要你决定下一步，已暂停自动修改」类暂停语义；「按你说的改吧…」未形成新 Job。属信任修复后暴露的**后续主链产品缺陷**，本任务不继续现场修补。

## 6. 全时段黑窗

外层采样至失败前：`violations=0`（见 `runtime-report.json` / phase1 black）。修订段未完整收口。

## 7. 测试差异、commit 与 PR

- 已写/更新单测：`nongit-project-trust-fix-21.test.ts`（11 通过）、`software-dev-blocker-05` skip 策略更新。
- 产品代码已改但：**按失败停条件不提交、不 push Draft PR**。
- 证据：`scripts/_nongit-project-trust-fix-21-evidence/`、`_nongit-project-trust-fix-21-prior-partial.json`；20A 历史证据保留。

## 8. 第三次 Owner 真机验收条件

**不具备。** 全链未过；`ownerAccepted=false`；不得启动第三次 Owner 真机验收。

## 建议的下一产品任务（不在本闸实施）

在 FIX-21 信任已落地的前提下，专门处理：成果后暂停态下，Owner 自然语言授权再次修改时如何确定性产生修订 Job（含规划确认/开始开发），并重开加固 CTO 全链。
