# TASK-QUALITY-STABILIZE-01：可靠交付主路径与后台质量增强分离

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `automated_tests_passed` / `stable_delivery_added` / `owner_runtime_acceptance_pending` / `market_95th_percentile_not_proven`  
实施分支：`codex/task-quality-stabilize-01`  
基线：`72f8f20`（`codex/task-quality-loop-01-2-fix-auto-completion`）  
上位：Owner 决策（连续真机验收表明质量管线已成为交付阻断器）

> **不得**标 `owner_runtime_accepted` / `accepted_as_implemented` / `market_95th_percentile_*`。  
> **不得** push。等待 Owner Electron 真机验收。

---

## 1. 架构

```text
可靠基础成果 → 立即落盘并可使用
→ 后台质量增强
→ 成功则新 DeliverableVersion 并切换 currentVersionId
→ 失败则保留基础成果（任务仍 completed）
```

| 模式 | 含义 | 默认 |
|---|---|---|
| `stable_delivery` | 通道 A 硬门禁落盘；通道 B ≤3 次模型调用增强，不阻断打开 | **生产默认** |
| `advanced_shadow` | 旧 Outline/Block/Rebuild/多轮 Reviewer 恢复链路；测试与对照 | 非生产门禁 |

配置：`deps.qualityPipelineMode` 或环境变量 `DIGITALME_QUALITY_PIPELINE_MODE`；**无**新持久化用户设置。

---

## 2. 降为 shadow / experimental 的旧生产步骤

以下保留代码与测试，标记为 `experimental_advanced_quality_pipeline`，**不再共同决定能否生成成果**：

- OutlinePlan / semantic blocks / semantic gap fill
- grounded rebuild / whole-document fallback / clean regeneration
- Product Reviewer 多轮阻断
- 多恢复动作串行循环

---

## 3. 基础成果硬门禁

仅以下可阻止基础落盘：

- `empty_content`
- `model_call_failed`
- `authorization_revoked`
- `unresolved_project_identity`
- `file_write_failed`
- `unsafe_path`
- `obvious_placeholder`（确定性未填写：待填写 / TODO / TBD / 空「目标：」「范围：」 / `[项目名称]` / `{{var}}`）
- `invalid_artifact`

不得因缺章节、语义评分、Reviewer 不够优秀、引用不足等阻止基础成果。

---

## 4. 点击到落盘路径（稳定模式）

1. 确认计划 → `confirmPlanAndGenerate` / `generateOneDeliverable`
2. 装配目标 / OutcomeCriteria / Snapshot / AuthorityMap / Knowledge
3. 一次整篇生成（无 Outline/Block 协议要求）
4. `assertBaselineHardGates`（硬门禁）
5. 原子：DeliverableVersion + ArtifactRef + 文件 + contentHash；`provenance.generation_stage=baseline`
6. `generationStatus=ready`；IPC `actBehalf:baselinePersisted` → UI「打开成果」
7. 通道 B（`awaitEnhancement:false` 后台）：Review → 重写 → Review（≤3 调用）
8. 增强成功：新版本 `generation_stage=enhanced`；失败：保留基础，`phase=completed`，高级审计可记「质量增强未完成，已保留基础版本。」

---

## 5. 字段与 Attempt

- 新增永久顶层字段：**0**（`generation_stage` 仅在既有 `provenance` 扩展区）
- 复用 DeliverableVersion / currentVersionId；无 baseline/enhanced 新 Store
- 一次用户发起一个主 Attempt；增强失败不 `terminal_failed`
- 停止新写入平行问题数组；旧字段兼容读

---

## 6. UI

- 生成中：「正在生成成果」
- 基线落盘：「成果已完成」+ 可打开；增强中低强调「正在进一步完善」
- 增强失败：默认仍「成果已完成」；无「继续完善」
- 基础失败：「成果未能生成」+「查看原因」

---

## 7. 测试

| 脚本 | 结果 |
|---|---|
| `test:task-quality-stabilize-01` | 12 passed |
| `test:stable-delivery-real-model` | SKIP（需 `DIGITALME_STABLE_REAL=1`）；结论改由 Owner 真机 |
| TASK-QUALITY-LOOP 01 / 01.1 / FIX / 01.2 / FIX-01 | 全绿（advanced_shadow） |
| DVL2-01/02/03/04/05、placeholder（shadow）、one-click、TASK-UX、IDCOLLAB、Learn | 全绿 |

---

## 8. Owner 真机验收

```powershell
Set-Location "D:\Projects\Digital Me\digitalme-app"
npm start
```

输入：`为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。`

通过：一次点击 → 基础落盘可打开 → 增强不阻塞 → 失败仍保留基础 → 无「继续完善」。

---

## 9. 明确未证明

`market_95th_percentile_not_proven` — 市场 95% 分位仍未证明。
