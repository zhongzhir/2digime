# Digital Me 能力状态表

版本：v0.1
日期：2026-07-18
依据：`digitalme_architecture_audit_20260716.md`、`digitalme_phase1_subject_upgrade_plan_v0.1.md`（Trusted Beta 依据）、`digitalme_phase1_task_P1-PANORAMA_product_panorama_alpha.md`、代码静态核查
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
| **P1-PANORAMA** | `active` / `PAN-01_statically_verified` | 总任务包；执行索引；PAN-01 任务包 | 当前产品主线；非代码能力项 |
| **PAN-00** | `accepted` | 验收提交 `bc85a14`；Codex 最终复核通过 | 战略与规格冻结完成 |
| **PAN-01** | `statically_verified` | 分支 `codex/pan-01-product-panorama-home`；实现 `01d56d0`；Codex 第一轮复核修复（Hero fail-closed / 承诺证据 / 发展意图 / 资料版本聚焦）；`test:pan-01` 22/22；`test:pan-01-owner-runtime` 9/9 | 产品全貌首页；只读；**不标 accepted**；待 Codex 再复核与 Owner 验收 |

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
5. 2026-07-18 起同步维护 P1-PANORAMA / PAN 条目；用户面状态见产品规格 v0.5 与执行索引。
