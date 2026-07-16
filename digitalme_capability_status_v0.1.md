# Digital Me 能力状态表

版本：v0.1  
日期：2026-07-16  
依据：`digitalme_architecture_audit_20260716.md`、`digitalme_phase1_subject_upgrade_plan_v0.1.md`、代码静态核查  
维护规则：每项只允许一个状态；不得仅凭文档声明标记 `statically_verified` / `runtime_verified` / `released`。

## 状态枚举

`planned` → `specified` → `implemented` → `statically_verified` → `runtime_verified` → `released`

## 总表

| 能力 | 状态 | 证据（文件/测试） | 说明 |
|---|---|---|---|
| Builder | `implemented` | `digitalme-app/src/builder.js`；审计 §3.1 | 提取/分块/蒸馏/写回已有代码；**仍直接写 Package，未迁 PackageStore** |
| Retrieval | `implemented` | `digitalme-app/src/retrieval.js` | TF-IDF-lite 本地检索已接线对话；无自动化回归 |
| Feedback | `runtime_verified` | `feedback.js` + PackageStore；`npm run test:p1-02` 31/31；Owner 临时资料验收 | 预览不写、确认提交、重启保留、跨重启恢复均通过；仍仅 Feedback 切片接入 |
| Life Graph | `implemented` | `digitalme-app/src/life.js`；`digital-me-package/life/` | 事件/维度表/推断可写；**仍直接写文件，未迁 PackageStore** |
| Writing | `implemented` | `digitalme-app/src/outputs/*`；`renderer/app.js` 写作场景 | 文稿库/改稿/导出已实现；未达连续 5 次真实验收门槛 |
| Research | `implemented` | `digitalme-app/src/research/*` | ResearchNotebook / Agent 循环已实现；安全与评测未闭环 |
| MCP extensions | `implemented` | `digitalme-app/src/capabilities/*` | 可安装连接并自动调用；默认高风险，待 ToolBroker 硬化 |
| External CLI | `implemented` | `digitalme-app/src/orchestration/agents.js` | 确认后 shell 委派已实现；默认应视为开发者实验 |
| Audit | `implemented` | `digitalme-app/src/orchestration/audit-store.js` | 本地 JSON 账本；非 append-only/不可伪可信审计 |
| PackageStore | `runtime_verified` | `src/package-store/*`；`npm run test:p1-02` 31/31；Owner 临时资料提交/重启/恢复验收 | P1-02 最小可信切片已验收；**仅 Feedback 接入**；Builder/Life/Policies 等仍直接写 |
| Package export/import | `planned` | 规格 v0.4 §7.4.2；审计 F-04/F-05 | 文档有分级导出设想；运行时无完整导出—删除—重导入闭环 |
| Secret storage | `runtime_verified` | P1-01：提交 `363e58d`、`94f7e13`、`9d3ecc4`；`npm run test:p1-01` 21/21；Owner 真实模型验收 | 重启识别、普通调用、空白保留、替换、清除均通过；扩展撤销 UI 与最小 env 隔离仍属后续 ToolBroker |
| External collaboration | `specified` | `digital-me-package/contracts/*`；规格 v0.4 §7.4.5 | Agent Card / Interaction Contract 数据结构已对齐；无用户面协作闭环 |

## 附注

1. `implemented` 仅表示代码路径存在，不等于安全可用或产品验收通过。  
2. 第一阶段完成前，不得将 MCP / External CLI / Audit 标记为 `released`。  
3. 升格为 `statically_verified` 至少需要自动化测试证据；`runtime_verified` 需要真实任务连续验收记录；`released` 需要 Owner 人工验收 + 技术复核。  
4. 本表由 P1-00 建立；后续任务更新时须同步修改本文件并在 `digitalme_log.md` 留痕。
