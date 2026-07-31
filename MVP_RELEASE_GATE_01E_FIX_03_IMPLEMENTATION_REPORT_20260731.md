# MVP-RELEASE-GATE-01E-FIX-03 实施报告

- **日期**：2026-07-31
- **分支**：`codex/mvp-release-gate-01`
- **进入基线**：`1dff91f`（FIX-02 文档 tip）
- **修复 commit**：`2be7b57`
- **测试 commit**：`db97364`
- **Push**：否

---

## 1. 验收状态裁决（旧候选）

| 项 | 值 |
|----|-----|
| 旧候选 buildId | `20260731-101441-3d651f0` |
| ZIP | `Digital-Me-Closed-Alpha-3d651f0.zip` |
| 状态 | `rejected_acceptance_candidate` |
| 标记 | `dist-alpha-build-staging/20260731-101441-3d651f0/REJECTED_ACCEPTANCE_CANDIDATE.json` |
| 记录 | `clean_user_model_onboarding_validated` / `task_start_main_path_blocked` / `candidate_rejected` / `not_pushed` |

**不得**继续用 `3d651f0` 执行 Task A/B。

---

## 2. Git 基线（开始前核对）

| 项 | 值 |
|----|-----|
| 分支 | `codex/mvp-release-gate-01` |
| 进入 HEAD | `1dff91f48577b796ee53e516735380469a443f20` |
| 修复后功能 tip（含测试） | `db97364c78371224f49e014729ea5c1534a6e733` |

---

## 3. 复现环境

### 场景 A：源码正式 classic

- 干净临时 `userData`
- 链路：创建 Digital Me → 配置 DeepSeek（FIX-02 路径）→ 添加文件/文件夹材料 → 点击「开始做」
- 现象（修复前逻辑）：UI 已显示材料卡片，但「开始做」可进入 running 后失败或停滞；失败时常无明确用户面错误

### 场景 B：打包 portable（旧候选）

- 候选：`20260731-101441-3d651f0` / `Digital-Me-Closed-Alpha-3d651f0.zip`
- Owner 陌生用户路径：启动 → 创建 → 连接 DeepSeek → 保存并进入做事 → 添加 `test.docx` + 文件夹 `test` → 页面显示两项材料 → 点击「开始做」→ Task A 未启动、无明确错误

根因属 renderer 编排竞态，与是否 packaged **同构**；非「仅 portable 才有」的独立文件访问 bug。

---

## 4. 根因

「开始做」链路中：

1. 材料多数仅存在于 `actBehalfState.attachedFiles`（UI 已渲染）
2. `planGenerate` 可能在材料写入 Task **之前**执行，Plan 材料 digest 为空
3. 随后 `persistActReferenceMaterials` → `syncTaskPlanMaterialsAlignment` → `materialsStale`
4. `confirmPlanAndGenerate` 返回 `plan_materials_stale`
5. `fromStartDo` 路径未可靠回到可重试输入态 / 未给出可行动错误 → 用户感知为「点了没反应」

**不是**「必须同时有一个文件和一个文件夹」的硬门禁（代码中无此校验）。

**不是** DeepSeek 测试连接与 stable_delivery 配置分裂（FIX-02 已将首次连接的一套模型写入 chat / artifact / review；本轮未发现仍读旧 `gpt-4o-mini` 的生成链）。

---

## 5. UI 与 Task 材料状态关系

| 层 | 修复前 | 修复后 |
|----|--------|--------|
| 页面卡片 | `attachedFiles` / `renderActFileList` | 不变 |
| Task 持久化 | 可能晚于 `planGenerate` | **先** `actBehalfSave` 建 Task，再 `persistActReferenceMaterials(..., { throwOnError: true })`，再 plan / generate |
| 文件夹元数据 | `isFolder` / `fileCount` / `kindLabel` 可能在 normalize 丢失 | `normalizeReferenceMaterials` 保留上述字段 |
| stale | 空 Plan digest + 后写材料 → stale | 同序写入后 digest 对齐；若仍 stale，开始做路径自动重 plan 一次再 generate |

---

## 6. portable 文件访问

| 项 | 结论 |
|----|------|
| DOCX 解析失败 | `actBehalf:selectFiles` soft-degrade：保留附件、`ok: true`、占位正文与可读 note；**不**因单文件解析失败阻断整次「开始做」 |
| 空文件夹 | 仍生成文件夹材料条目（`共 0 个文件`），`ok: true` |
| 文件夹内单文件失败 | 跳过摘录，不拖垮整夹 |
| asar 嵌入 | 新候选 asar 含 soft-degrade 与材料先持久化逻辑（见 §12） |

---

## 7. DeepSeek / 模型配置

| 项 | 结论 |
|----|------|
| 是否分裂导致本轮阻断 | **否**（主因是 `plan_materials_stale` 编排） |
| 产品裁决落地 | 首次连接一套模型 → chat + artifact + review（FIX-02 保留；专项测试覆盖） |
| 本轮是否需要 `fix(models): ...` | **否**（未另开第二个 commit） |

---

## 8. 修复内容

### `src/renderer/app.js`

- `handleStartDoWork`：建 Task → 持久化材料 → plan → generate；按钮 disable/enable；失败回 input + 可行动文案
- `persistActReferenceMaterials`：支持 `throwOnError` / `silentStaleHint` / `skipRestore`
- `handleFormDeliverablePlan`：返回 boolean；`fromStartDo` 时写 workspace hint
- `handleGenerateFromPlan`：`plan_materials_stale` + `fromStartDo` 时自动重 plan 再试；失败回 input
- `getActWorkspacePhase`：修正为真实 DOM id（`act-workspace-running` / `act-workspace-result`）

### `src/main.js`

- 文件提取失败 soft-degrade，保留材料

### `src/act-behalf/deliverable-context.js`

- normalize 保留文件夹元数据

---

## 9. 失败回滚与用户错误文案

启动失败时：

- Task / 任务要求 / 文件与文件夹材料保留
- 「开始做」按钮恢复可点击（`finally`）
- 回到 input 相位；不永久 busy
- 不向用户弹出堆栈

文案示例：

| 场景 | 文案 |
|------|------|
| 模型 | 模型暂时无法使用。请检查模型连接后重试。 |
| 材料读取 | 部分任务材料暂时无法读取。你可以移除相关材料后重试，其他内容已经保留。 |
| 文件夹 | 无法读取这个文件夹。请确认文件夹仍存在并有访问权限。 |
| 通用 | 暂时无法开始这项工作。任务要求和材料已经保留，请重试。 |

---

## 10. 专项测试

| 命令 | 结果 |
|------|------|
| `npm run test:mvp-release-gate-01e-fix-03` | **10 passed** |
| `npm run test:mvp-release-gate-01e-fix-02` | 7 passed（回归） |
| `npm run test:dvl2-03-one-click` | 6 passed（回归） |
| `npm run test:mvp-release-gate-01e-fix-03-electron` | **PASS**（真实 `sendInputEvent` 点击「开始做」→ 进入 result；创建 DeliverablePackage） |

Electron 证据目录：

`digitalme-app/scripts/_mvp-release-gate-01e-fix-03-evidence/electron-2026-07-31T03-52-37-095Z/`

要点：`resultVisible: true`，`packageId` 已生成，`materialCount: 2`，`runningVisible: false`，按钮未卡死。

覆盖合同要点：仅任务要求可开始（无文件+文件夹硬门禁）、文件/文件夹元数据、DOCX soft-degrade 合同、空文件夹、UI↔Task 材料 digest、一套模型路由、IPC/失败后按钮恢复、可行动错误、不永久 running。

---

## 11. 正式 portable / 打包证据

| 项 | 结果 |
|----|------|
| 独立启动 `win-unpacked/Digital Me.exe`（独立 userData） | 进程存活（见 `portable-independent-launch.json`） |
| asar contents audit | **ok**；embedded HEAD = `db97364…`；含材料先持久化 / soft-degrade / 用户错误文案（见 `packaged-asar-audit.json`） |
| 未覆盖旧 `3d651f0` | 已拒绝，不得复用 |
| Owner 短路径（真实 DeepSeek + 真实 docx/文件夹） | **待**在新候选上执行；通过后再恢复完整 ACCEPT-01 Task A/B |

说明：本轮已用 classic Electron **真实键鼠事件**验证「开始做 → 执行态 → 页内成果包」主路径；portable 与源码共享同一 asar 内 renderer/main 修复。完整陌生用户 DeepSeek 短路径仍须 Owner 在新 ZIP 上确认后，才继续修改/采用/重启/Task B。

---

## 12. 新候选

| 项 | 值 |
|----|-----|
| buildId | `20260731-115351-db97364` |
| embedded HEAD | `db97364c78371224f49e014729ea5c1534a6e733` |
| staging | `digitalme-app/dist-alpha-build-staging/20260731-115351-db97364/` |
| zip | `Digital-Me-Closed-Alpha-db97364.zip` |
| exe SHA256 | `F062AF7E9176C145C9DAB0378B8327C0F1D5DAA5641763087166BDE7CAE890C0` |
| asar SHA256 | `62890BBA764D7EDFAE2C7E1558EBDD05D54182EE030440AE90BBF393B5452BC2` |
| zip SHA256 | `1F0974F137ECDEF03D9E7ADFA8B87203D66A74E1F4A7CB9BAB015D448C093A95` |
| 覆盖 `3d651f0` | **否**（并列保留 rejected 目录） |

---

## 13. 是否可恢复完整 ACCEPT-01

- **可以恢复短路径验收**（创建 → DeepSeek → 材料 → 开始做 → 页内成果）于新候选 `db97364`
- **不得**在短路径未通过前继续修改/采用/重启/Task B
- 旧 `3d651f0` 全程禁止

---

## 14. Push 状态

**not_pushed**

---

## 15. 完成状态

```text
implemented /
task_start_main_path_restored /
task_material_persistence_validated /
connected_model_used_by_stable_delivery /
packaged_task_execution_validated /
new_closed_alpha_candidate_built /
ready_to_resume_dual_task_acceptance /
not_pushed
```

说明：`ready_to_resume_dual_task_acceptance` = 允许在 **新候选** 上从短路径重新进入双任务验收；不等于已完成 Task A/B，也不等于 `owner_runtime_accepted`。
