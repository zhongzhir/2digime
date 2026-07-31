# MVP-RELEASE-GATE-01E-FIX-04 实施报告

- **日期**：2026-07-31
- **分支**：`codex/mvp-release-gate-01`
- **进入基线**：`533f9ae`（FIX-03 文档 tip）
- **修复 commit**：`3abac86`
- **测试 commit**：`e22abb6`
- **Push**：否

---

## 1. Owner 验收事实（不得被自动化覆盖）

Owner 使用正式 portable 候选 `20260731-115351-db97364`：

```text
启动成功
→ 创建 Digital Me 成功
→ DeepSeek 连接成功（无需第二模型）
→ 添加文件成功
→ 添加文件夹成功
→ 「开始做」按钮不可点击
→ Task A 未启动，后续验收停止
```

此前 FIX-03 自动化「真实键鼠进入成果态」**不得**视为覆盖上述 Owner portable 结果。

旧候选已标记：

| 项 | 值 |
|----|-----|
| buildId | `20260731-115351-db97364` |
| ZIP | `Digital-Me-Closed-Alpha-db97364.zip` |
| 状态 | `rejected_acceptance_candidate` |
| 标记文件 | `dist-alpha-build-staging/20260731-115351-db97364/REJECTED_ACCEPTANCE_CANDIDATE.json` |

---

## 2. Git 基线

| 项 | 值 |
|----|-----|
| 分支 | `codex/mvp-release-gate-01` |
| 进入 HEAD | `533f9aef73269a7c8517db95db4e18a439ec7f69` |
| 功能 tip（含测试） | `e22abb61bea5d7d679f5d2c0f449722019cd4f74` |

---

## 3. portable 复现结果

### 3.1 打包 asar 只读追踪（db97364）

证据：`scripts/_mvp-release-gate-01e-fix-04-evidence/portable-asar-button-trace.json`

| 检查 | 结果 |
|------|------|
| HTML `#btn-act-start-do` 初始 `disabled` | **否** |
| `updatePrimaryGenerateButton` 写 `startBtn.disabled` | **是** |
| `refreshActDeliverableResults` 使用 `disabled: !hasPlan` | **是** |
| `hidePlanPanel` → `disabled: true` | **是** |

### 3.2 同源逻辑 live 复现（classic Electron，同 predicate）

证据：`scripts/_mvp-release-gate-01e-fix-04-evidence/repro-2026-07-31T08-46-59-627Z/`

| 阶段 | disabled | goal | materials |
|------|----------|------|-----------|
| 新建任务后 | **true** | 空 | 0 |
| 输入任务要求后 | **true** | 有 | 0 |
| 添加文件+文件夹 + plan restore/hidePlan | **true** | 有 | 2 |

`bugConfirmed: true`

---

## 4. 按钮被禁用的准确 predicate

**主 predicate（唯一决定性写入）**：

`DeliverablePlannerUi.updatePrimaryGenerateButton({ disabled })` 同步设置：

```text
#btn-act-start-do.disabled = disabled || busy || authRevoked
```

触发路径包括：

1. **新建任务** → `resetActBehalfForm` → `hidePlanPanel()` → `disabled: true`
2. **无 Plan** → `refreshActDeliverableResults` → `disabled: !hasPlan`（新任务恒为 true）
3. **材料持久化 / restorePlan** → 再次 hidePlan / refresh → 保持禁用
4. **generation panel** 空态也可 `disabled: true`

因此：即使 DeepSeek 已连接、任务要求已填、材料已显示，只要还没有 Plan，按钮就会被 planner 生成态逻辑误禁用。

**次要问题**：输入/粘贴/材料变化**没有**独立的「开始做」可用性重算；一旦被 planner 写死 disabled，无法自愈。

---

## 5. 是否存在多个状态写入点

修复前：

| 写入点 | 作用对象 |
|--------|----------|
| `updatePrimaryGenerateButton`（planner） | `#btn-act-generate-from-plan` **与** `#btn-act-start-do` |
| `handleStartDoWork` finally | `#btn-act-start-do` |
| HTML 初始 | 无 disabled |

修复后：

| 写入点 | 作用对象 |
|--------|----------|
| **唯一** `renderStartDoAvailability()` ← `deriveStartDoAvailability(...)` | `#btn-act-start-do` + `#act-start-do-reason` |
| `updatePrimaryGenerateButton` | **仅** `#btn-act-generate-from-plan`；结束后回调 `renderStartDoAvailability` |

---

## 6. 最终唯一启用规则

```text
可点击 ⇔
  任务要求非空
  ∧ 当前不在启动/生成中（非 running / 非 startDoBusy）
  ∧ Digital Me 可用（package exists，非 needsFirstRunUi）
  ∧ 存在可用模型配置（lastModelConfigured / firstRun.modelConfigured）
```

**明确不是门禁**：任务材料、任务标题、Plan、备用模型、Reviewer、独立成果模型、成果类型、角色/期望成果。

---

## 7. DeepSeek / Package readiness

| 项 | 处理 |
|----|------|
| DeepSeek 单模型已连接 | `renderModelStatus` / 首次连接保存后 `lastModelConfigured=true`，并 `renderStartDoAvailability` |
| 不因 Reviewer/备用为空禁用 | 派生函数不读取这些字段 |
| 创建 Digital Me 后 | `completeFirstRunSetup` / `renderPackageStatus` 触发重算 |
| 避免 `pkg.firstRun` 陈旧覆盖 | `isModelReadyForStart` **优先** `lastModelConfigured` |

---

## 8. 材料变化后的状态刷新

- 添加文件/文件夹后：`renderStartDoAvailability()`
- 移除材料后：同上
- `hidePlanPanel` / planner 更新后：回调 `renderStartDoAvailability()`，**不再**把 start 设为 disabled

---

## 9. 不可用原因文案

按钮旁 `#act-start-do-reason`（不可用时可见，非 tooltip）：

| 原因 | 文案 |
|------|------|
| 无任务要求 | 先描述你希望完成的工作。 |
| 无模型 | 连接模型后即可开始。 +「连接模型」操作 |
| 无 Digital Me | 先创建或导入你的 Digital Me。 |
| 执行中 | 按钮文案改为「正在进行」 |

---

## 10. 点击失败回滚

复用 FIX-03：`startDoBusy` + finally 清 busy → `renderStartDoAvailability`；失败回 input；可行动错误；任务要求与材料保留；防双击。

---

## 11. 专项测试

| 命令 | 结果 |
|------|------|
| `npm run test:mvp-release-gate-01e-fix-04` | **12 passed** |
| `npm run test:mvp-release-gate-01e-fix-03` | 10 passed（回归） |
| `npm run test:mvp-release-gate-01e-fix-04-electron` | **PASS**（空要求禁用+原因 → 有要求可点 → 材料+hidePlan 仍可点 → 真实点击进入成果） |

证据：`scripts/_mvp-release-gate-01e-fix-04-evidence/electron-2026-07-31T08-53-45-760Z/`

---

## 12. 新候选

| 项 | 值 |
|----|-----|
| buildId | `20260731-165449-e22abb6` |
| embedded HEAD | `e22abb61bea5d7d679f5d2c0f449722019cd4f74` |
| staging | `digitalme-app/dist-alpha-build-staging/20260731-165449-e22abb6/` |
| zip | `Digital-Me-Closed-Alpha-e22abb6.zip` |
| exe SHA256 | `386ED8F4C9F80656BA6F4B07B309709568A594E062129CA7D3CFE0FF5C532F3C` |
| asar SHA256 | `D30D4EE71006F899D25C607BD992259AC18028C20001971F7B080C555BCA6E33` |
| zip SHA256 | `CE4FA8702BEBEBCDB04D47CD97FC3645326731A7FF159B2A345E01ECC4973E3F` |
| 独立启动 | ok（`portable-independent-launch.json`） |
| asar 审计 | ok（含 derive/render、planner 不再写 start、reason 节点） |
| 覆盖 db97364 | **否** |

---

## 13. 是否可恢复 Task A/B

- **可以**在新候选 `e22abb6` 上恢复 **Owner 本地短路径 E2E**
- 顺序仍须：启动 → 创建 → DeepSeek → 输入任务 → 文件+文件夹 → **确认按钮可点** → 真实点击 → 页内成果
- 短路径通过前，不得继续修改/采用/重启/Task B
- 旧 `db97364` **禁止**再用

---

## 14. Push

**not_pushed**

---

## 15. 完成状态

```text
implemented /
start_action_availability_unified /
portable_start_button_enabled /
disabled_reason_visible /
single_model_readiness_validated /
packaged_start_to_result_validated /
new_closed_alpha_candidate_built /
ready_to_resume_owner_local_e2e /
not_pushed
```

说明：

- `portable_start_button_enabled` / `packaged_start_to_result_validated`：同源 classic Electron 已验证「可点 → 点击 → 成果」，且新 portable asar 嵌入同一修复；**Owner 仍须**用新 ZIP 以真实 DeepSeek 复验短路径。
- 不等于 `owner_runtime_accepted`。
