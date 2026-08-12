# 19A 只读诊断 — Owner 运行路径分叉

- 任务：`2DIGIME-BUILD-01-OWNER-REJECTION-CLOSE-19A`
- 基线：`ce89f7a` / `build/software-work-quality-loop-01` / Draft PR #1
- 机器可读全文：`RUNTIME_PATH_DIVERGENCE_19A.json`
- 本轮**未改**产品代码

## 结论标签

`owner_runtime_completed_rejected` · `ownerAccepted=false` · `build_01_not_accepted` · `runtime_path_divergence_suspected`  
架构归类：**双工作流并存 + 错误主按钮路由**（不是单一局部文案缺陷）

## Owner 实际命中路径

### 首轮（formatLabel 目标）

1. 真实入口：`electron/main.cjs` + 隔离 userData。
2. 磁盘：**无** formatLabel Task；`runtime/tasks` 仅有后续「再试一轮规划」。
3. UI：`!hasPlanDraft` → UX `drafting` 主按钮「开始处理」→ `#btn-submit` → `work.submitTask`（**旧路径**）。
4. `JobRunner.submitTask`：`modify_code` 且未授权 → `needsExecutionConfirm` 且 `taskId/jobId` 为空 → **不落盘 Task/Job/Artifact**。
5. 同路径 `listCodingCapabilityStatuses({ probe: true })` → `runCodexVersion` → 拉起真实 Codex；黑窗标题含 `codex-win32-x64\vendor`。
6. Renderer 收口文案：引导「请先在右侧确认最新规划」——但右侧并无规划卡。

### 第二轮（「再试一轮规划」）

1. Renderer：`work.converse`（Build-01 对话中枢）。
2. `createConversationTask`：`intentKind=general`，`requestedArtifactType=document`（目标句不像改码）。
3. 真实模型被调用（建任务与落盘对话间隔约 19s）。
4. 解析失败 / 空 reply → `CONVERSE_UNPARSEABLE_NOTICE`（「没听懂」类固定澄清）。
5. `createdTask && !planUpdate` → **确定性 seed plan** 写入 draft（非模型 CTO 建议）。
6. Job/Artifact 仍为 0；未测重启 / 咨询 / 修订 / 采用。

## Smoke 与真人关键差异

| 维度 | 18A smoke | Owner 19 |
| --- | --- | --- |
| 启动 | 自定义 harness，非 `main.cjs` | 真实 `main.cjs` |
| 主按钮 | 等规划后点「确认规划并开始开发」 | 无规划时点「开始处理」 |
| 执行器 | hooked | 真实 Codex |
| 静默探针 | 独立 probe 进程树 | 产品内 probe/exec 挂在 Electron 父进程下 |
| 目标文本 | 标准 formatLabel 改码句 | 第二轮验收口令污染为 `general` |

## 四类现象根因（摘要）

| 现象 | 根因 |
| --- | --- |
| 无规划 | 首轮未走通/未持久化 converse→plan；UX 仍给旧「开始处理」 |
| 零 Task/Job/Artifact | 旧 `submitTask` 确认门返回空 id；未授权执行 |
| 没听懂 + seed | 模型调用后不可解析 → 固定澄清；首轮种子规划模板 |
| 黑窗 | Electron→node→codex.js→**vendor 原生孙进程**控制台；不能用 parent `windowsHide` 宣称已修 |

## 最小纠正边界（不实施）

见 JSON `minimalCorrectiveBoundary_doNotImplement`：收敛单一主 CTA、禁止无规划 compose 直提 modify_code、种子规划不得冒充 CTO、converse 解析硬化、黑窗在 Electron 父链下重验、禁止用 hooked/smoke 代替 Owner 主链证明。
