# MVP-RELEASE-GATE-01E-FIX-05 实施报告

- **日期**：2026-07-31
- **分支**：`codex/mvp-release-gate-01`
- **进入基线**：`4654c2a`（FIX-04 文档 tip）
- **修复 commit**：`19b7cdf`
- **测试 commit**：`2890048`
- **Push**：否

---

## 1. Owner 复现事实

Owner 使用正式 portable `20260731-165449-e22abb6`：

```text
「开始做」可点击
→ 点击后立即有反馈
→ 进入「正在完成」
→ 一段时间后开始输出结果
→ 右侧工作区剧烈抖动
→ 无法进行修改、采用或打开本地文件
```

旧候选已标记 `rejected_acceptance_candidate`：

| 项 | 值 |
|----|-----|
| buildId | `20260731-165449-e22abb6` |
| ZIP | `Digital-Me-Closed-Alpha-e22abb6.zip` |
| 记录 | `task_start_validated` / `streaming_render_blocked` / `workspace_unusable_during_output` / `candidate_rejected` / `not_pushed` |

---

## 2. portable 复现 / 根因证据

证据：`scripts/_mvp-release-gate-01e-fix-05-evidence/portable-root-cause.json`

对 **e22abb6 asar** 只读追踪得到的准确链路：

```text
awaitEnhancement:false
→ baselinePersisted
→ scheduleThrottledGenerationPanelRefresh(250ms)
→ refreshActGenerationPanel
   → renderGenerationPanel(innerHTML 全量重建)
   → presentActWorkspaceResult
      → 只要 currentVersionId 存在就切 result
      → body.innerHTML =「正在载入成果……」
      → 再 innerHTML = 完整 Markdown
→ enhancementSettled 再次全量刷新
→ 多次刷新竞态 → running/result 抖动 + 成果区反复重建
→ 修改/采用/打开控件不可稳定使用
```

说明：本轮**不是**逐 token 流式写 `act-result-body`，而是 **baseline 提前切成果态 + 增强阶段重复全量重渲染**。按产品裁决采用 **方案 A（非流式成果呈现）**。

---

## 3. 抖动准确根因

| 根因 | 说明 |
|------|------|
| 过早切成果态 | `pickWorkspacePrimaryFromView` 在 `currentVersionId` 存在即呈现，不等待 enhancement settle |
| 每次刷新清屏重建 | `presentActWorkspaceResult` 每次先写「正在载入…」再全量 Markdown |
| 双事件重复刷新 | `baselinePersisted` + `enhancementSettled` + IPC 返回路径叠加 |
| 生成面板 DOM 重建 | `renderGenerationPanel` 对 items `innerHTML` 全量替换 |

---

## 4. 是否关闭逐 token streaming

| 项 | 结论 |
|----|------|
| 工作区成果路径 | **方案 A**：生成期间固定「正在完成」；权威完成后再一次性呈现 |
| baseline 事件 | 运行中只更新 hint，**不**切成果、不重建 Markdown |
| enhancement 完成 / 有界轮询 settle | 一次性 `forcePresent` |
| 同 key 重复呈现 | `presentedResultKey` 跳过 |

未新增逐 token UI；也未保留「每个 chunk 重排」。

---

## 5. Render / 布局指标（修复后 Electron）

证据目录：`scripts/_mvp-release-gate-01e-fix-05-evidence/electron-2026-07-31T09-22-22-470Z/`

| 指标 | 结果 |
|------|------|
| `presentCount`（权威成果呈现次数） | **1** |
| 工作区宽度变化 `widthDelta` | **17 px** |
| `scrollReversals` | **0** |
| `phaseFlips` | **1**（running → result 一次） |
| 修改框可用 | 是 |
| 采用可用 | 是（已点「采用结果」→「已采用」） |
| 打开本地文件按钮可用 | 是 |

目标：生成阶段主要 UI present ≤ 10–20；实测 **1**。

---

## 6. Listener / Observer

- 未新增 MutationObserver / ResizeObserver
- 生成中跳过 `renderGenerationPanel` 全量重建，避免 DOM 替换累积行为
- settle 使用有界轮询（≤180s，450ms 间隔），失败回 input，不无限刷新

---

## 7. 成果完成状态判定

权威完成条件：

```text
included deliverables 不再 generating / repairing / quality_enhancement / enhancement.pending
+ pickWorkspacePrimaryFromView 得到可读 ArtifactRef
→ 一次性 present
```

首个 baseline token / pending enhancement **不得**切成果态。

---

## 8. 修改 / 采用 / 打开

| 动作 | 验证 |
|------|------|
| 继续修改输入框 | Electron：可写 |
| 采用结果 | Electron：点击后显示「已采用」 |
| 打开本地文件 | 按钮 enabled（真实打开依赖本机文件关联，本轮验证可用性） |

---

## 9. 专项测试

| 命令 | 结果 |
|------|------|
| `npm run test:mvp-release-gate-01e-fix-05` | **12 passed** |
| `npm run test:mvp-release-gate-01e-fix-04` | 12 passed（回归） |
| `npm run test:mvp-release-gate-01e-fix-05-electron` | **PASS** |

---

## 10. 新候选

| 项 | 值 |
|----|-----|
| buildId | `20260731-172256-2890048` |
| embedded HEAD | `28900482bb7b813462a21e3b613a278558a2143f` |
| staging | `digitalme-app/dist-alpha-build-staging/20260731-172256-2890048/` |
| zip | `Digital-Me-Closed-Alpha-2890048.zip` |
| exe SHA256 | `0BFCBE2440CD26646E3F2E16D5969454B4336597508E3772A5EFD3DF36E96C35` |
| asar SHA256 | `53DC89BBB2117195C6A2FBB4D3EFF7A3B9BABF868FC64620B0A72707D5D3823D` |
| zip SHA256 | `8C22464C389EFEC3019DB2F938907352B542A6A8D2ECF183E37392C1D893B81D` |
| 独立启动 | ok |
| asar 审计 | Scheme A + settle wait 已嵌入 |
| 覆盖 e22abb6 | **否** |

---

## 11. 是否恢复 Owner Task A

- **可以**在新候选 `2890048` 上恢复 Owner Task A 短路径
- 必须验证：开始做 → 稳定「正在完成」→ **一次**呈现成果 → 修改框 / 采用 / 打开本地文件可操作
- 旧 `e22abb6` 禁止再用

---

## 12. Push

**not_pushed**

---

## 13. 完成状态

```text
implemented /
generation_rendering_stabilized /
workspace_layout_stable /
result_completion_transition_validated /
post_result_actions_usable /
packaged_long_result_validated /
new_closed_alpha_candidate_built /
ready_to_resume_owner_task_a /
not_pushed
```

说明：`packaged_long_result_validated` 以同源 classic Electron 布局指标 + 新 portable asar 嵌入为准；Owner 仍须用新 ZIP 做真实 DeepSeek 长文复验。不等于 `owner_runtime_accepted`。
