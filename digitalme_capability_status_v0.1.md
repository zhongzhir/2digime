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
| Builder | `implemented` | `digitalme-app/src/builder.js`；审计 §3.1 | 提取/分块/蒸馏/写回已有代码；缺原子事务与系统化测试 |
| Retrieval | `implemented` | `digitalme-app/src/retrieval.js` | TF-IDF-lite 本地检索已接线对话；无自动化回归 |
| Feedback | `implemented` | `digitalme-app/src/feedback.js` | 预览确认后追加写回；无候选版本/回滚 |
| Life Graph | `implemented` | `digitalme-app/src/life.js`；`digital-me-package/life/` | 事件/维度表/推断可写；治理与分层不完整 |
| Writing | `implemented` | `digitalme-app/src/outputs/*`；`renderer/app.js` 写作场景 | 文稿库/改稿/导出已实现；未达连续 5 次真实验收门槛 |
| Research | `implemented` | `digitalme-app/src/research/*` | ResearchNotebook / Agent 循环已实现；安全与评测未闭环 |
| MCP extensions | `implemented` | `digitalme-app/src/capabilities/*` | 可安装连接并自动调用；默认高风险，待 ToolBroker 硬化 |
| External CLI | `implemented` | `digitalme-app/src/orchestration/agents.js` | 确认后 shell 委派已实现；默认应视为开发者实验 |
| Audit | `implemented` | `digitalme-app/src/orchestration/audit-store.js` | 本地 JSON 账本；非 append-only/不可伪可信审计 |
| Package export/import | `planned` | 规格 v0.4 §7.4.2；审计 F-04/F-05 | 文档有分级导出设想；运行时无完整导出—删除—重导入闭环 |
| Secret storage | `statically_verified` | P1-01：`src/security/secret-store.js`、`config-secrets.js`；`npm run test:p1-01`（含迁移产物扫描与失败路径） | Codex 初复核缺口已修订（临时备份、损坏配置、短 env）；待再复核；暂缓 Owner 真实密钥验收后方可 `accepted`/`released` |
| External collaboration | `specified` | `digital-me-package/contracts/*`；规格 v0.4 §7.4.5 | Agent Card / Interaction Contract 数据结构已对齐；无用户面协作闭环 |

## 附注

1. `implemented` 仅表示代码路径存在，不等于安全可用或产品验收通过。  
2. 第一阶段完成前，不得将 MCP / External CLI / Audit 标记为 `released`。  
3. 升格为 `statically_verified` 至少需要自动化测试证据；`runtime_verified` 需要真实任务连续验收记录；`released` 需要 Owner 人工验收 + 技术复核。  
4. 本表由 P1-00 建立；后续任务更新时须同步修改本文件并在 `digitalme_log.md` 留痕。
