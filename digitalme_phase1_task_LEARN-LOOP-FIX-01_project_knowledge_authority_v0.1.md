# Digital Me Phase 1 · LEARN-LOOP-FIX-01

## 项目知识学习与权威应用闭环

| 字段 | 值 |
|---|---|
| 任务编号 | LEARN-LOOP-FIX-01 |
| 版本 | v0.1 |
| 状态 | `implemented` / `codex_verified` / `ready_for_owner_runtime_acceptance` |
| 分支 | `codex/learn-loop-fix-01-project-authority` |
| 前置审计 | `LEARN_LOOP_FORENSIC_AUDIT_20260727.md` |
| 优先级 | P0 |

## 1. 背景

`LEARN-LOOP-FORENSIC-01` 证实：任务「开始起草 Digital Me 项目的开发计划」在零参考材料、SCE 误用泛探索记忆、情境误分类、Reviewer 缺口共同作用下，生成了与项目定位严重不符的成果。

## 2. 目标

修复学习闭环断裂，使 Digital Me 项目类任务能够：

1. 自动挂载权威项目上下文（`ProjectContextSet`）；
2. 以 `ProjectKnowledgeClaim` 治理项目事实、决策与历史探索；
3. 权威优先检索进入成果生成路径；
4. 项目文档情境正确分类；
5. 项目权威 Reviewer 拦截无依据数字与主线漂移；
6. 接受后学习区分事件与项目知识候选。

## 3. 实现摘要

| 模块 | 路径 |
|---|---|
| Schema | `digitalme-app/src/act-behalf/project-knowledge-schema.js` |
| Store | `digitalme-app/src/act-behalf/project-knowledge-store.js` |
| Registry | `digitalme-app/src/act-behalf/project-context-registry.js` |
| Retrieval | `digitalme-app/src/act-behalf/project-knowledge-retrieval.js` |
| SCE 更新 | `subject-context-engine.js`（`project_document_generation`、CORE_ANCHOR、Reviewer） |
| 生成接线 | `deliverable-generation.js`、`deliverable-generators.js` |
| 学习回流 | `deliverable-auto-learn.js`（`project_knowledge_candidate`） |
| 测试 | `scripts/test-learn-loop-fix-01.cjs` |

## 4. 验收标准（Owner 真机）

对等价任务「开始起草 Digital Me 项目的开发计划」：

- 定位：数字主体层；非稳定币/区块链基础设施主线；
- 进度：反映 DVL2-03、IDCOLLAB-MIN-01；P0 为学习闭环；
- 无虚构：无来源不出现 6–8 人、300–500 万、15 个月、UBC 主线；
- 结构：区分已确认事实 / 当前状态 / 建议 / 待决策；
- 来源：关键结论可追溯至 context / log / execution index / frozen task records。

## 5. 状态声明

- **不得**标 `project_learning_loop_validated` / `cross_task_application_validated`，直至 Owner 真机回归通过；
- **不得** push；
- **不得**笼统宣称「完整数字之我学习已经完成」。

## 6. Electron 验收场景 A–H

见任务指令第十六节；本分支 `ready_for_owner_runtime_acceptance`，待 Owner 执行。
