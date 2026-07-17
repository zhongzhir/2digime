# Digital Me 能力状态表

版本：v0.1  
日期：2026-07-17
依据：`digitalme_architecture_audit_20260716.md`、`digitalme_phase1_subject_upgrade_plan_v0.1.md`、代码静态核查  
维护规则：每项只允许一个状态；不得仅凭文档声明标记 `statically_verified` / `runtime_verified` / `released`。

## 状态枚举

`planned` → `specified` → `implemented` → `statically_verified` → `runtime_verified` → `released`

## 总表

| 能力 | 状态 | 证据（文件/测试） | 说明 |
|---|---|---|---|
| Builder | `accepted` | `src/builder/package-write.js`；`builder:previewWrite` / `builder:write`；`npm run test:p1-06` 14/14；Owner 临时资料验收；提交 `0e8ba88`、`81ba8f1` | **仅** Builder 观念/人格写入已迁 PackageStore（预览→确认→commit；`dataKind=inference`）；identity 主写回见 P1-07 |
| Retrieval | `implemented` | `digitalme-app/src/retrieval.js` | TF-IDF-lite 本地检索已接线对话；无自动化回归 |
| Feedback | `runtime_verified` | `feedback.js` + PackageStore；`npm run test:p1-02` 31/31；Owner 临时资料验收 | 预览不写、确认提交、重启保留、跨重启恢复均通过；仍仅 Feedback 切片接入 |
| Life Graph | `statically_verified`（P1-07 主写回切片） | `src/life/package-write.js`；`builder:previewWrite`/`builder:write` identity；`npm run test:p1-07` 27/27；任务包 P1-07 | **仅** Builder 材料链路的 Life/identity 确认写回已迁 PackageStore；**认知页零散编辑、Policies、MCP、协作仍未迁移**；等待 Codex 复核与 Owner 临时资料验收，不标 accepted |
| Writing | `implemented` | `digitalme-app/src/outputs/*`；`renderer/app.js` 写作场景 | 文稿库/改稿/导出已实现；未达连续 5 次真实验收门槛 |
| Research | `implemented` | `digitalme-app/src/research/*` | ResearchNotebook / Agent 循环已实现；安全与评测未闭环 |
| MCP extensions | `implemented` | `digitalme-app/src/capabilities/*` | 可安装连接并自动调用；默认高风险，**尚未**经 ToolBroker 硬化 |
| External CLI | `statically_verified` | `src/tool-broker/*`；`external-agent-flow.js`；`npm run test:p1-05` 19/19 + P1-01～04 回归 | 身份契约 + Authenticode + spawn 前 TOCTOU；停止立即生效；`shell:false`；**不是 OS 沙箱**；不标记 accepted |
| Audit (legacy) | `implemented` | `digitalme-app/src/orchestration/audit-store.js` | 旧 JSON 账本；renderer 已不可追加；不冒充可信链 |
| DecisionAudit (P1-04) | `runtime_verified` | `src/decision-audit/*`；`src/orchestration/external-agent-flow.js`；`npm run test:p1-04` 25/25 + P1-01～03 回归；Codex 三轮复核；Owner 成功/失败/取消、轮换、重启验收 | append-only JSONL + hash chain；仅向前恢复；跨代连接校验；仅可检测篡改，非签名或不可删除存证；仅外部 CLI 切片接入；P1-05 起绑定 planDigest |
| PackageStore | `runtime_verified` | `src/package-store/*`；`npm run test:p1-02` 31/31；P1-06 / P1-07 接入 | Feedback + Builder 观念 + Life/identity **主 Builder 写回**已接入；**Policies / 认知页零散编辑仍直接写** |
| Package export/import | `planned` | 规格 v0.4 §7.4.2；审计 F-04/F-05 | 文档有分级导出设想；运行时无完整导出—删除—重导入闭环 |
| Secret storage | `runtime_verified` | P1-01：提交 `363e58d`、`94f7e13`、`9d3ecc4`；`npm run test:p1-01` 21/21；Owner 真实模型验收 | 重启识别、普通调用、空白保留、替换、清除均通过；扩展撤销 UI 与按工具密钥注入仍属后续 |
| PolicyEngine (P1-04) | `runtime_verified` | `src/policy-engine/*`；`l0:requestExternalAgent` / `l0:runExternalAgent`；`npm run test:p1-04` 25/25；Codex 三轮复核；Owner 确认/取消/执行验收 | v1 内置规则；fail-closed；P1-05 起 `requestDigest` 绑定 ToolBroker 执行计划；不代表全部工具已统一治理 |
| ToolBroker (P1-05) | `statically_verified` | `src/tool-broker/*`；`l0:external-agent-started`；`npm run test:p1-05`（含 stop IPC）；主动取消 → `execution_canceled` | 停止须完全重启应用后复验；不标记 accepted |
| External collaboration | `specified` | `digital-me-package/contracts/*`；规格 v0.4 §7.4.5 | Agent Card / Interaction Contract 数据结构已对齐；无用户面协作闭环 |
| Subject home (P1-03) | `runtime_verified` | `src/subject-overview/*`；`src/package-store/read-only.js`；`subject:getOverview`；P1-03 21/21；Codex 复核与 Owner 真实 Electron 验收 | 严格只读聚合与 SubjectOverview v1；主体认知、七类分层、能力/边界/协作状态、版本入口、重启一致性及设置弹窗可达性均通过；不迁移写路径 |

## 附注

1. `implemented` 仅表示代码路径存在，不等于安全可用或产品验收通过。  
2. 第一阶段完成前，不得将 MCP / External CLI / Audit 标记为 `released`。  
3. 升格为 `statically_verified` 至少需要自动化测试证据；`runtime_verified` 需要真实任务连续验收记录；`released` 需要 Owner 人工验收 + 技术复核。  
4. 本表由 P1-00 建立；后续任务更新时须同步修改本文件并在 `digitalme_log.md` 留痕。
