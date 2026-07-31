# MVP-LEARNING-QUALITY-01 报告（2026-07-31）

## 状态

```
implemented /
learning_precision_improved /
expression_preferences_classified /
boundaries_classified /
project_facts_separated /
artifact_content_overlearning_blocked /
memory_provenance_complete /
real_model_regression_pending /
owner_acceptance_not_ready /
not_pushed
```

Agent 环境无 `DEEPSEEK_API_KEY`。静态与 FAKE 专项测试已通过；真实 DeepSeek A/B 回归需 Owner 运行一键脚本后才能标 `real_deepseek_personalization_regression_passed`。

---

## 1. Git 基线

| 项 | 值 |
|---|---|
| 分支 | `codex/mvp-release-gate-01` |
| 开始时 HEAD | `4e7e63c` |
| 产品基线 | `597225e` |
| 唯一候选 | `20260731-173649-597225e` |
| push | **未 push** |

未执行 reset / rebase / stash pop / 改历史。

---

## 2. 原真实 A/B 学习问题

权威证据：`digitalme-app/scripts/_mvp-value-validation-real-model-01-evidence/probe-c-2026-07-31T12-24-12-732Z/`

已确认：

1. 成果正文长段被写入长期 `expression_preference`（如「最近一段时间…」「目前主流的选择是放在云端…」）。
2. 「未完成或未验证的能力不得写成已经实现」被归为表达偏好，而非 boundary。
3. 审计顶层 `sourceTaskId` / `sourceVersionId` 为 null（虽 nested `learnProvenance` 有值）。
4. `expressionCount=10`、`factCount=0`、`boundaryCount=0`、`overlearnRiskCount=0` 不准确。
5. 「请按以下明确修改重写：」被当成长期偏好。

---

## 3. 修改前学习条目（摘要）

| 类型 | 内容 |
|---|---|
| 误学 header | 请按以下明确修改重写： |
| 表达偏好（正确方向） | 标题观点/冲突、开头直接、减少分点、事实趋势平衡 |
| 误分类 | 未验证能力不得写成已实现 → expression_preference |
| 正文 overlearn | 两段 Task A 长文进入长期偏好 |
| 来源 | 顶层 source* 缺失 |

---

## 4. 最终分类规则

优先级：

1. **boundary**（不得/不能/不要把/未经…不得/尚未…不得/必须避免/需要严格区分…）
2. **current_fact**（尚未验证/完成、当前已/未、仍处于…）→ project claims
3. **expression_preference**（revisionGuidance / 抽象 revisionDiff）
4. **artifact_history**（采用审计；`session_only` + `resolverEligible=false`）
5. **reject / overlearn**（正文收获）

revisionGuidance 标题行不进长期记忆。正文收获不得写成可召回偏好。

---

## 5. 表达偏好结果（期望）

- 标题更有观点和冲突感  
- 开头减少铺垫，直接进入问题  
- 减少机械分点（可与 diff「连贯叙述」合并）  
- 事实新闻与趋势判断保持平衡  

专项测试：Task B Resolver ≥4 条可召回表达偏好。

---

## 6. boundary 结果

- 「未完成或未验证的能力不得写成已经实现」→ `learnKind=boundary`  
- 同时写入既有 `policies/boundaries.json`（`addBoundary`，**无新 Store**）  
- Resolver 对 boundary 加权高于 expression_preference  

---

## 7. current_fact 结果

- 明确项目状态句 → `current_fact`，走既有 project claims  
- **不**写入长期表达偏好  

---

## 8. overlearn 检测

触发条件包括：长度 >120、多句正文、文章开头模式、无用户来源长文、`fromBodyHarvest`。

结果：`overlearnRisk=true`，`logicalState=session_only`，`resolverEligible=false`。

---

## 9. 被拒绝的正文候选

- 「最近一段时间，关于个人 AI…」类段落  
- 「目前主流的选择是放在云端…」类段落  
- 任意无 revisionGuidance/diff/显式声明的长正文  

不得进入长期可召回 `expression_preference`。

---

## 10. 来源字段

复用并补齐顶层（无第二套 Store）：

- `sourceTaskId`  
- `sourceVersionId`  
- `sourceLearnJobId`  
- `sourceType`（revision_guidance / revision_diff / project_fact_correction / accepted_version…）  
- `sourceRevisionGuidanceHash`  
- `createdAt` / `lastConfirmedAt`  
- 保留既有 `learnProvenance` / `sourceRefs`  

---

## 11. 去重与多来源

同义偏好按 `preferenceKey` 合并；保留 `sourceRefsAccum[]` / `canonicalStatement`。

---

## 12. 撤销测试

`suppressRejectedVersion` 按 `sourceVersionId` / `learnProvenance.deliverableVersionId` / sourceRefs 命中撤销；其他版本同类偏好保留；Resolver 跳过 revoked。

---

## 13. Resolver 顺序

`subject-context-assembler`：

- 跳过 `resolverEligible=false` / revoked / session_only / artifact_history / overlearn 正文  
- `scoreAsset`：boundary > current_fact > revision_guidance 偏好 > revision_diff 偏好  

---

## 14. 专项测试

```
npm run test:mvp-learning-quality-01
→ passed=14 failed=0
```

覆盖任务所列分类、overlearn、provenance、去重、撤销、Resolver、静态价值契约。

回归：`npm run test:dvl2-04-auto-learn` → 6 passed。

---

## 15. 真实 DeepSeek 回归

**状态：`real_model_regression_pending`**

Owner 一键脚本：

`digitalme-app/scripts/run-mvp-learning-quality-01-real-deepseek.ps1`

```powershell
$env:DEEPSEEK_API_KEY = Read-Host "DeepSeek API Key"
$env:DIGITALME_VALUE_PROVIDER = "deepseek"
$env:DIGITALME_VALUE_MODEL = "deepseek-chat"
Set-Location "D:\Projects\Digital Me\digitalme-app"
.\scripts\run-mvp-learning-quality-01-real-deepseek.ps1
Remove-Item Env:DEEPSEEK_API_KEY
```

不得把 Key 写入脚本 / 报告 / evidence / .env。

---

## 16. A/B 指标前后对比

| 项 | 原真实 A/B（probe-c） | 本轮 |
|---|---|---|
| 跨任务个性化价值 | 已证明可观察差异 | **待**同模型真实回归确认不退化 |
| 学习精度 | 不准确 | 静态契约已收口 |
| expression / boundary | 10 / 0（误） | 期望 4 / 1 |

**不得**用 FAKE 替代真实结论。

---

## 17. 代码净增减

| 文件 | 约计 |
|---|---|
| `deliverable-auto-learn.js` | +约 700 行级改动（分类/抽取/provenance/合并） |
| `subject-context-assembler.js` | +约 43 |
| `package.json` | +1 script |
| `test-mvp-learning-quality-01.cjs` | 新增 |
| Owner 回归脚本 | 新增 |
| probe-c 学习审计分类 | 小改 |

粗算净增：约 **+597 / −149**（核心 3 文件 tracked diff）。

---

## 18. 新增字段 / Store / IPC

| 项 | 结果 |
|---|---|
| 新增 Store | **0** |
| 新增 IPC | **0** |
| 新增知识源 | **0** |
| 新增永久状态机状态 | **0** |
| 字段 | 在既有 memory row / claim 上补齐 provenance 与 `resolverEligible` / `overlearnRisk`（非新 Store） |

---

## 19. 遗留问题

1. Owner 需跑真实 DeepSeek Probe C，核对 learning-audit：≈4 偏好 + ≥1 边界、正文不进长期偏好、来源字段非 null。  
2. 原 probe-c 证据保留不删；新证据目录将另存。  
3. 身份称呼等非本轮学习链路条目仍可能出现在记忆文件中，不属本轮收口范围。  
4. 未 commit（除非 Owner 明确要求）；**未 push**。

---

## 20. push 状态

**not_pushed**

---

## 主要改动文件

- `digitalme-app/src/act-behalf/deliverable-auto-learn.js`
- `digitalme-app/src/act-behalf/subject-context-assembler.js`
- `digitalme-app/scripts/test-mvp-learning-quality-01.cjs`
- `digitalme-app/scripts/run-mvp-learning-quality-01-real-deepseek.ps1`
- `digitalme-app/scripts/electron-probe-c-value-ab.cjs`（审计分类对齐 learnKind）
- `digitalme-app/package.json`（`test:mvp-learning-quality-01`）
