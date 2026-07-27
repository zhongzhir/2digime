# Digital Me Phase 1 Task — LEARN-LOOP-FIX-02

**任务编号**：LEARN-LOOP-FIX-02  
**标题**：统一知识解析与真实循环学习  
**版本**：v0.1.1
**状态**：`unified_knowledge_resolution_validated` / `chat_and_task_cross_surface_application_validated` / `owner_runtime_accepted` / `accepted_as_implemented`
**Owner 真机验收**：2026-07-27
**分支**：`codex/learn-loop-fix-02-unified-knowledge`
**基线**：`89184a3`（LEARN-LOOP-FIX-01）
**实现提交**：`d080a65`（resolver）+ `ebf7fb7`（测试与任务包）

---

## 1. 任务目标

建立所有功能共同使用的 **Knowledge Resolver** 统一入口，并完成最小学习循环（候选 → 确认 → 跨面对召回 → 修正 supersede）。

**不得宣称**：完整自主学习、模型权重已学习用户、所有输入自动成为正确知识。

---

## 2. 修改前运行时调用图审计

| 功能 | context assembler | retrieval | memory store | project claims | reviewer |
|---|---|---|---|---|---|
| **对话** `main.js` `chat:send` | 否 | **是** `retrieval.retrieve` | 间接（TF-IDF） | **否** | 否 |
| **做事/成果生成** `deliverable-generation.js` | **是** `assembleSubjectContext` | 否（`retrieveProjectClaims`） | 是 | **是** FIX-01 | **是** |
| **研究** `research:runAgentLoop` | 否 | 否 | 否 | 否 | 否 |
| **写作/PPT** `output:planPpt` | 否 | **是** `retrieval.retrieve` | 间接 | 否 | 否 |
| **规划** `actBehalf:planGenerate` | 否 | 否 | 仅 task materials | 否 | 否 |
| **接受后学习** `deliverable-auto-learn.js` | 否 | 否 | PackageStore | 部分 candidate | 否 |

### 2.1 关键查明

1. **对话未调用 ProjectContextSet**：`chat:send` 仅 `retrieval.retrieve(dir, lastUser.content)`，未调用 `resolveProjectContext` / `retrieveProjectClaims`（`main.js` ~4326，`r2/chat-lifecycle.js` ~682）。
2. **对话 project detection**：修改前不存在统一 detection；仅成果链 `detectProjectFromGoal`。
3. **旧 retrieval 与 retrieveProjectClaims**：并行独立，无共享排序或权威治理。
4. **SCE**：`assembleSubjectContext` 用于成果生成与 VL1 preview，不仅 act-behalf；但对话链未接入。
5. **「显示依据」**：`renderer/app.js` ~1088，依赖 `meta.evidence`（memory/framework 摘要），非 project claims。
6. **研究/写作第三套逻辑**：研究用 `researchGrounded` + agent-loop 自有 prompt；写作用 `retrieval.retrieve`；与成果链 SCE+project claims 不一致。

### 2.2 对话失败代码原因

对话路径在 `main.js` 4297–4337 行只调用 `retrieval.retrieve`，历史探索记忆（core_006/008/009）可进入 TF-IDF 结果；`assembleSubjectContext` 与 `retrieveProjectClaims` 未执行，导致与成果链事实不一致。

---

## 3. Knowledge Resolver 设计

**入口**：`resolveKnowledgeContext(opts)` — `digitalme-app/src/act-behalf/knowledge-resolver.js`

**输出**：`detectedScope`, `projectContext`, `selectedClaims`, `selectedMemories`, `excludedItems`, `authoritySummary`, `provenance`, `evidenceRows`, `promptText`, `contextDigest`

**流程**：
1. `detectProjectScope`（`project-detection.js`）统一识别
2. `project-knowledge-store` 种子化 + `pickActiveClaims` 状态时效
3. `retrieveProjectClaims` + `ensurePrincipleClaimsIncluded`
4. `assembleSubjectContext`（过滤历史探索）
5.  lexical `retrieval.retrieve`（补充，稳定币探索排除）
6. 合并 prompt 与 provenance

---

## 4. 接入范围

| 功能 | 接入状态 |
|---|---|
| 对话 `chat:send` | **已接入** resolver + 学习候选 |
| R2 对话 `r2/chat-lifecycle.js` | **已接入** |
| 成果生成 `deliverable-generation.js` | **已重构** 使用 resolver |
| 写作/PPT `output:planPpt` | **已接入** |
| 研究 `research:runAgentLoop` | **已接入**（scenarioHint 追加） |
| 规划 `planGenerate` | **未接入**（仅 task materials，无独立知识 ranking；待 DVL2-04+ 评估） |

---

## 5. 学习循环

- **候选形成**：`knowledge-learning.js` `extractCandidatesFromUserInput`
- **风险分级**：低（表达/界面原则）→ 建议确认；高（身份/授权）→ 必须 Owner 确认
- **确认入口**：对话后 UI「是否将这条作为 Digital Me 项目的当前产品原则？」— 确认 / 仅本次 / 不记录
- **升级**：`knowledge:confirmCandidate` IPC → `owner_confirmed` claim
- **supersession**：`supersedeClaim`；旧 claim 保留审计

---

## 6. 来源可见

`meta.evidence` 现含 `summary | source | status | claimId`；「显示依据」展示实际 selected claims。

---

## 7. 六步验收样本

原则文本（仓库种子中**不存在**完整 owner-confirmed claim）：
> Digital Me 的默认工作界面只显示完成当前任务所必需的信息，其余信息必须按需展开。

**Electron 验收步骤**见任务包 §11（Owner 真机）。

---

## 8. 测试

```bash
npm run test:learn-loop-fix-02
npm run test:learn-loop-fix-01
npm run test:dvl2-03-generation
npm run test:idcollab-min-01
npm run test:crt-mvp-02
```

---

## 9. Owner 真机验收结论（2026-07-27）

**已通过**：

- 对话与做事已使用统一 **Knowledge Resolver**
- 项目知识可跨**新对话**与**新做事任务**调用
- 来源可见（「显示依据」含 claim 摘要）
- 用户修正后 **supersession** 生效
- 冲突内容要求用户选择，不静默覆盖

**未验证 / 不得宣称**：

- **独立研究 / 写作产品面**的统一验证（`all_surfaces_validated` **不得**写入）
- 完整自主学习、模型权重持续训练、所有输入自动成为正确知识

## 10. 状态

```text
unified_knowledge_resolution_validated /
chat_and_task_cross_surface_application_validated /
owner_runtime_accepted /
accepted_as_implemented
```
