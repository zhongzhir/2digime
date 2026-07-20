# Digital Me 能力状态表

版本：v0.1
日期：2026-07-19
依据：`digitalme_architecture_audit_20260716.md`、`digitalme_phase1_subject_upgrade_plan_v0.1.md`（Trusted Beta 依据）、`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`、`digitalme_phase1_task_PAN-01R_sovereign_collaboration_loop.md`、代码静态核查
维护规则：每项只允许一个工程状态；不得仅凭文档声明标记 `statically_verified` / `runtime_verified` / `released` / `accepted`。

## 工程状态枚举

`planned` → `specified` → `implemented` → `statically_verified` → `runtime_verified` → `accepted/released`

可附加冻结或缺口标记（如 `frozen_for_panorama`、`known_acceptance_gaps`），但不得删除证据。

## 工程状态 ≠ 用户面状态（强制）

本表只记录**工程证据**，不自行决定用户界面上的能力状态。

| 工程状态 | 对用户面的非自动映射 |
|---|---|
| `planned` / `specified` | 最多「尚未开放」或「预览」 |
| `implemented` | **不**自动等于「可用」；通常仍为「预览」或未对用户宣称 |
| `statically_verified` | 通常最多支持「实验」，仍须结合风险与运行证据 |
| `runtime_verified` | 可候选「可用」或「实验」，须产品规格与验收裁定 |
| `accepted` / `released` | 仍须按规格给出用户面标签；不得省略边界说明 |

用户面**只允许**使用：`可用` · `实验` · `本地模拟` · `预览` · `尚未开放`。

规则：

1. 静态卡片、按钮或 JSON 文件不能证明能力「可用」；
2. 失败、取消不得显示为成功；
3. 本地模拟不得显示为真实公网协作；
4. 用户面状态只能由主进程真实信息或明确的产品常量生成。

## 总表

| 能力 | 状态 | 证据（文件/测试） | 说明 |
|---|---|---|---|
| Builder | `accepted` | `src/builder/package-write.js`；`builder:previewWrite` / `builder:write`；`npm run test:p1-06` 14/14；Owner 临时资料验收；提交 `0e8ba88`、`81ba8f1` | **仅** Builder 观念/人格写入已迁 PackageStore（预览→确认→commit；`dataKind=inference`）；identity 主写回见 P1-07 |
| Retrieval | `implemented` | `digitalme-app/src/retrieval.js` | TF-IDF-lite 本地检索已接线对话；无自动化回归 |
| Feedback | `runtime_verified` | `feedback.js` + PackageStore；`npm run test:p1-02` 31/31；Owner 临时资料验收 | 预览不写、确认提交、重启保留、跨重启恢复均通过；仍仅 Feedback 切片接入 |
| Life Graph | `statically_verified` / `owner_partial_verified` / `known_acceptance_gaps` / `frozen_for_panorama` | `src/life/package-write.js`；`builder:previewWrite`/`builder:write` identity；`npm run test:p1-07` 39/39；`test:p1-07-owner-runtime` 13/13；审阅取消/队列/revision fail-closed；代码基线 `5ab55dc`；收工文档 `8fb8210` | **仅** Builder 材料链路的 Life/identity 确认写回已迁 PackageStore；**不标 accepted**；不占 Panorama 主线；缺口见下节；仅资料损坏/越权/密钥泄漏/Panorama 主路径阻断时恢复 |
| Writing | `implemented` | `digitalme-app/src/outputs/*`；`renderer/app.js` 写作场景 | 文稿库/改稿/导出已实现；未达连续 5 次真实验收门槛；用户面不得自动标「可用」 |
| Research | `implemented` | `digitalme-app/src/research/*` | ResearchNotebook / Agent 循环已实现；安全与评测未闭环 |
| MCP extensions | `implemented` | `digitalme-app/src/capabilities/*` | 可安装连接并自动调用；默认高风险，**尚未**经 ToolBroker 硬化 |
| External CLI | `statically_verified` | `src/tool-broker/*`；`external-agent-flow.js`；`npm run test:p1-05` 19/19 + P1-01～04 回归 | 身份契约 + Authenticode + spawn 前 TOCTOU；停止立即生效；`shell:false`；**不是 OS 沙箱**；不标记 accepted |
| Audit (legacy) | `implemented` | `digitalme-app/src/orchestration/audit-store.js` | 旧 JSON 账本；renderer 已不可追加；不冒充可信链 |
| DecisionAudit (P1-04) | `runtime_verified` | `src/decision-audit/*`；`src/orchestration/external-agent-flow.js`；`npm run test:p1-04` 25/25 + P1-01～03 回归；Codex 三轮复核；Owner 成功/失败/取消、轮换、重启验收 | append-only JSONL + hash chain；仅向前恢复；跨代连接校验；仅可检测篡改，非签名或不可删除存证；仅外部 CLI 切片接入；P1-05 起绑定 planDigest |
| PackageStore | `runtime_verified` | `src/package-store/*`；`npm run test:p1-02` 31/31；P1-06 / P1-07 接入 | Feedback + Builder 观念 + Life/identity **主 Builder 写回**已接入；**Policies / 认知页零散编辑仍直接写** |
| Package export/import | `planned` | 规格 v0.5；审计 F-04/F-05 | 文档有分级导出设想；运行时无完整导出—删除—重导入闭环 |
| Secret storage | `runtime_verified` | P1-01：提交 `363e58d`、`94f7e13`、`9d3ecc4`；`npm run test:p1-01` 21/21；Owner 真实模型验收 | 重启识别、普通调用、空白保留、替换、清除均通过；扩展撤销 UI 与按工具密钥注入仍属后续 |
| PolicyEngine (P1-04) | `runtime_verified` | `src/policy-engine/*`；`l0:requestExternalAgent` / `l0:runExternalAgent`；`npm run test:p1-04` 25/25；Codex 三轮复核；Owner 确认/取消/执行验收 | v1 内置规则；fail-closed；P1-05 起 `requestDigest` 绑定 ToolBroker 执行计划；不代表全部工具已统一治理 |
| ToolBroker (P1-05) | `statically_verified` | `src/tool-broker/*`；`l0:external-agent-started`；`npm run test:p1-05`（含 stop IPC）；主动取消 → `execution_canceled` | 停止须完全重启应用后复验；不标记 accepted |
| External collaboration | `specified` | `digital-me-package/contracts/*`；规格 v0.5 Panorama 冻结章 | Agent Card / Interaction Contract 数据结构已对齐；无用户面协作闭环；Alpha 以本地模拟交付 |
| Subject home (P1-03) | `runtime_verified` | `src/subject-overview/*`；`src/package-store/read-only.js`；`subject:getOverview`；P1-03 21/21；Codex 复核与 Owner 真实 Electron 验收 | 严格只读聚合与 SubjectOverview v1；不迁移写路径；Panorama 首页将复用只读聚合 |
| **P1-PANORAMA** | `active` / `three_part_alpha_reframed` / `PAN-01S_family_accepted` | 总任务包 v0.4；执行索引 v0.2.10；PAN-00R `accepted`；**PAN-01S / S.1 / S.2 `accepted`（baseline `cbde807`）**；R0 决策包 v0.1.1-draft | 当前产品主线；**当前唯一任务：Codex 再复核 Renderer Foundation R0**（`spec_revision_1` / `codex_review_changes_requested`；implementation `not_started`）；**PAN-02** = `planned` / `blocked` |
| **PAN-00** | `accepted` | 验收提交 `bc85a14`；Codex 最终复核通过 | 战略与规格冻结完成（历史，不改写） |
| **PAN-00R** | `accepted` | 分支 `codex/pan-00r-three-part-alpha-reset`；任务包 v0.1.2；规格 v0.6.1；证据 `07b631d` + `6ae2dca` + `0fcd432`；Codex 最终复核通过；Owner 确认 | **docs/strategy acceptance**：三位一体重构与极简产品原则冻结；**不是**运行能力 `released`；不代表 PAN-02～PAN-06 已实现 |
| **PAN-01** | `statically_verified` / `owner_product_perception_failed` / `needs_minimal_surface_reset` | 分支 `codex/pan-01-product-panorama-home`；基线 `a40c5f8`；`test:pan-01` / `test:pan-01-owner-runtime` | 工程验证通过；Owner **产品感知**验收未通过（非工程失败）；**不标 accepted**；不回滚；只读聚合与 fail-closed 逻辑保留；表面收口由 PAN-01S 族完成 |
| **PAN-01R** | `statically_verified` / `codex_review_passed` / `owner_runtime_verified` / `owner_product_perception_failed` / `retained_as_internal_collaboration_harness` | 分支 `codex/pan-01r-sovereign-collaboration-loop`；规格 `35c5aea`；最终实现 `9dd6fa0`；`test:pan-01r` 70/70；`test:pan-01r-owner-runtime` 20/20；Codex 两轮复核通过；Owner 走通主要路径 | 工程与运行验证通过；Owner **产品感知**验收未通过（owner runtime 通过 ≠ accepted）；**不标 accepted**；底层授权/取消/审计/adopt-reject/推理环境绑定保留为内部 test harness 与未来 PAN-04 基础设施；**不**进入生产设置／高级（规格 v0.6.3） |
| **PAN-01S** | **`accepted`（2026-07-20）** | 收口分支 `codex/pan-01s2-chat-incident-close`；accepted baseline `cbde807`；Owner real Electron runtime | 极简表面 + 会话菜单/永久构建入口收口；**Acceptance basis = Owner real Electron runtime**（自动测试不是唯一依据） |
| **PAN-01S.1** | **`accepted`（2026-07-20）** | 规格接受 `686fd7b`；前置 `98fb817`；accepted baseline `cbde807` | 主体解释与渐进构建；与 PAN-01S / S.2 同基线验收 |
| **PAN-01S.2** | **`accepted`（2026-07-20）** | 对话事故收口；baseline `cbde807`；提交链含 `b5997b6` / `acacc6e` / `598e7e9` | 对话历史显示、附件上下文分离、关联文稿正文隔离与恢复；正式独立任务包未入库，以执行索引与 log 为准 |
| **renderer foundation R0** | **`spec_revision_1` / `codex_review_changes_requested`**；implementation = `not_started`；branch = 不存在 | `digitalme_renderer_foundation_R0_decision_and_migration_plan.md` v0.1.1-draft | 整窗入口；R2=JSON；R2.5 SQLite deferred；Playwright E2E；R1 收窄；**不** accepted；**不得**开始 R1；不重开 PAN-01S |
| **R2.5 SQLite ADR** | `planned` / **`deferred`** | — | 量化触发 + 独立 ADR + Owner 授权；非 PAN-02 前提；不读真实 sessions 正文 |
| **PAN-02** | `planned` / **`blocked`** | — | 解锁见 R0 §16；不以 SQLite 为前提；任务包与实现均不得自行启动 |

## P1-07 冻结说明（与任务包 / 执行索引 / log 一致）

```text
statically_verified / owner_partial_verified / known_acceptance_gaps / frozen_for_panorama
```

### 已知验收缺口

1. 真实 GUI 多类别审阅：第一组提交后，第二组未被 Owner 观察到自动呈现；
2. 智能构建的确认交互尚未由 Owner 完整复验。

### 处理规则

- **不标** `accepted`；
- **不再占用** Panorama 当前主线；
- **不修改** P1-07 代码和测试来制造 accepted；
- 仅资料损坏、越权写入、密钥泄漏或 Panorama 主路径阻断时恢复处理。

### 历史收工快照（2026-07-17，保留）

- **代码基准提交**：`5ab55dc`（分支 `codex/p1-07-life-identity-package-store`）
- **收工文档提交**：`8fb8210`（`docs(p1-07): record owner acceptance handoff`）
- **自动化**：`test:p1-07` 39/39，`test:p1-07-owner-runtime` 13/13
- **（已被取代的旧下一门槛）**：原「Codex 复核 → Owner 运行验收 → 方可考虑 accepted」——自 2026-07-18 起由 **Panorama 冻结决定**取代，不再作为当前任务入口；缺口转入执行索引 backlog。

## 附注

1. `implemented` 仅表示代码路径存在，不等于安全可用或产品验收通过，更不等于用户面「可用」。
2. Product Panorama Alpha 完成前，不得将 MCP / External CLI / Audit 标记为 `released`。
3. 升格为 `statically_verified` 至少需要自动化测试证据；`runtime_verified` 需要真实任务连续验收记录；`accepted`/`released` 需要 Owner 人工验收 + 技术复核。
4. 本表由 P1-00 建立；后续任务更新时须同步修改本文件并在 `digitalme_log.md` 留痕。
5. 2026-07-18 起同步维护 P1-PANORAMA / PAN 条目；用户面状态见产品规格 v0.6 与执行索引 v0.2。
6. **产品感知失败 ≠ 工程失败（2026-07-19）**：PAN-01 / PAN-01R 的 `owner_product_perception_failed` 是产品验收结论，其工程与运行证据（statically_verified / owner_runtime_verified）仍然有效；反之，owner runtime 通过也不自动等于 `accepted`。
