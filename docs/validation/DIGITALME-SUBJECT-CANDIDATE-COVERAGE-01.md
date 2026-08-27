# DIGITALME-SUBJECT-CANDIDATE-COVERAGE-01

> 长会话中已采用 durable Subject preference 不得被近期 artifact / conversation 挤出 candidates。  
> 产品祖先：`65a7253db2b50a39d1bbc35421a474e355ad341a`。Trial 文档祖先：`04ba36a93ea449d8feac1b382f5f618f6b7824d2`。  
> 不 push。不修 preference learning。不修 `researchEvidence.decided` / T4 验收文案。

---

## Candidate budget before / after

| | Before（Final Gate C2） | After |
|--|------------------------|-------|
| 结构 | 单一全局池 `MAX_CANDIDATES = 16` | 分源有界 lane，再合并 |
| artifact | 与其它来源争抢 16；按任务 recency 先填 | 独立上限 10 |
| task_folder | 插在 artifact 循环里，占全局槽 | 独立上限 2 |
| conversation | 上限 6，排在 artifact 之后 | 独立上限 6 |
| preference | 上限 6，**排在最后**；池满则 0 条 | 独立上限 6 |
| 总容量 | 硬 16 | 合并最多 24，各源仍有界 |
| 选择 ID | 只认 canonical `preference:gevt_…` | 无前缀 `gevt_` / `art_` / `task_` 映射到候选 id（身份对齐，不决定相关性） |

这不是把 16 改成无限。Subject lane 只保证：可能相关的 durable 信息有机会被模型看见。

---

## 第一失真点

**`buildWorkContextCandidates` 的全局截断，发生在 AI relevance 之前。**

Final Gate C2（`job_mtbg8jlkd69a3bdb983e`）：

1. **Subject 权威层仍在。** `gevt_mtbfj9ey…` 已 confirmed；T3B/C1 刚 freeze 过同一 event。
2. **消失点：候选构造。** C2 `candidateIds` 正好 16 条：10 artifact/folder + 6 conversation，没有 `preference:`。
3. **不是没生成 Subject candidate。** `loadSubjectPreferenceCandidates` 仍读 `derived.preferences`。`push()` 在 `out.length >= 16` 时拒绝。
4. **共用一个候选上限。** 每源虽有局部 cap，但不预留名额。
5. **排序过度偏向 recency。** 任务按 `createdAt` 新→旧；artifact 先、conversation 次、preference 最后。
6. **AI relevance 之前已被淘汰。** 模型从未看见该 preference。
7. **复现点。** C1 恰好 16 槽、preference 挤在最后一格。C2 多一条 artifact 后消失。约 8–10 个带成果任务 + 6 条 conversation。

不是 acquisition 失败，不是 freeze 写丢。

次要失真（C3 第一轮）：模型/规划器用无前缀 `gevt_…` 选中偏好，`resolveSelectedContextRefs` 只认 `preference:gevt_…`，freeze 为空。已做 identity canonicalize，不是关键词补丁。

---

## source-aware coverage 设计

```
authoritative sources
  ├ current conversation / attachments   （converse 材料）
  ├ recent work / artifacts              lane ≤ 10
  ├ project folders                      lane ≤ 2
  ├ recent conversations                 lane ≤ 6
  └ Subject durable preferences          lane ≤ 6（更多则 shortlist，不新建 store）
        ↓ merge + dedupe
        ↓ canonicalize selected ids
AI relevance judgment
        ↓
unified selected context → freeze → executor
```

确定性层：每类覆盖、数量预算、去重、授权、id 对齐。  
「本次是否相关」仍由模型判断。

未做：全量注入、无条件 freeze、周报/进展关键词、C2 case patch、last-preference 优先、无限放大全局池。

模块：`context-candidates.ts`、`context-relevance.ts`、`job-runner.ts`。  
候选 brief 按来源分组，避免长列表把 preference 埋在末尾。

---

## Short / medium / long session evidence

单测：`src/work-runtime/tests/subject-candidate-coverage-01.test.ts`（10/10）。

| 会话 | 证据 | 结果 |
|------|------|------|
| A Short | 1 artifact + conversation + preference；Electron T3A→T7→T3B | preference 在 candidates；T3B freeze `gevt_mtbmf6y6…` |
| B Medium | 6 artifacts；Electron T2/T5 | preference 仍在 |
| C Long | 18 artifacts 单测；Electron F1–F6 后 C2/C3 | artifact/conversation 顶满各自 lane；**preference 仍在**（C2/C3 `preferenceInCandidates=true`，candidateCount=17=10+6+1） |
| Electron | `build/evidence/subject-candidate-coverage-01/` userData `dmv2-subjcand-ud-vw2Gm2` | 见下 |

F6（第 6 条填充备忘，长会话中段）已 `preferenceInCandidates=true`。

---

## Competing-context evidence

同时存在：相关 durable preference（向上同步先摊风险）、P2 备菜清单表达（本轮未 adopted）、近期无关 artifact（番茄炒蛋 + F 填充）、旧相关项目成果（苇舟财务说明）。

- 单测 D：两条 preference 都进 candidates；选择只保留风险偏好 + 试点 artifact。
- Electron C2/C3：`cook_preference_in_freeze=false`；正文无番茄炒蛋。
- C3：模型**没有**把「跟上面同步」偏好选进 freeze（客户说明 ≠ 对上习惯）。这是 relevance，不是 coverage 丢失。产物仍卡点先行（`risk_first_shape=true`），因历史成果已是风险前置结构。

---

## C2 + 新组合任务

同一长会话 `dmv2-subjcand-ud-vw2Gm2`。

| 任务 | 目标 | Driver | 独立判定 |
|------|------|--------|----------|
| C2 | 「帮我收一版能直接拿去对上的进展稿，结构你定。」 | **pass** | freeze `gevt_mtbmf6y6…`；material 含苇舟财务说明/讲稿；正文先写 11 天审批与 184 万；无空模板、无炒蛋 |
| C3 | 「客户下周要听试点现在卡在哪，你直接出一版他们能看的说明，结构你定。」 | driver fail（freeze 无 preference） | **coverage pass**；历史项目进入 material；AI 未把上级习惯注入客户稿；无污染。独立视为组合任务成立，且证明不是 C2 case patch |

C3 不要求「偏好必然进 freeze」。要求是：相关 Subject 仍在 candidates，由 AI 判断。客户场景未选上级偏好，符合原则。

---

## Regression

| 项 | 结果 | 证据 |
|----|------|------|
| T2 recent-work continuity | **pass** | `t2.json` `historical_context_used=true` |
| T3 short-interval reuse | **pass** | `t3b.json` freeze 含 preference |
| T5 open goal | **pass** | `t5.json` 无 placeholder，用了项目 |
| C1 context + research | 长会话 driver 曾误绑 F6 备忘（`taskId` 回退到最新任务）。修正绑定后短会话 **pass** | `build/evidence/subject-candidate-coverage-01-c1/`：`cap_baseline_web_search`，`search_used=true`，`historical_context_used=true` |
| 不相关 preference 不机械进入 | **pass** | C2/C3 cook freeze false |
| attachment grounded | **pass** | `t7.json` 用纪要、未搜索 |
| pure conversation 不建 Job | **pass** | `t6.json` `created_work_task=false`，已回复 |
| research 路径 | 未改 research 代码；C1 回归仍走 baseline search | 见 c1 短会话 |
| Subject acquisition 5/5 | **pass** | `subject-preference-reliability-01.test.ts` |

未改：`researchEvidence.decided`、T4 验收文案。

长会话 C1 误绑是 driver 用最新任务兜底，不是 candidate coverage 回归。已禁止在给定 goal 时回退到 `tasks[0]`。

---

## 完成标准核对

1. 第一失真点：全局 16 槽 recency 先填 artifact/conversation。  
2. 修复是分源 lane，不是放大总 budget。  
3. Subject 有稳定 candidate coverage（F6/C2/C3）。  
4. 最终 relevance 仍由 AI 判断（C3 未强行注入）。  
5. C2 pass。  
6. 新组合 C3：coverage + 历史项目成立；freeze 空是客户场景未选用上级偏好。  
7. long-session pass。  
8. 无不相关 preference 污染。  
9. T2/T3/T5/C1 无产品回归。  
10. 无关键词/regex/case patch。

**Verdict：PASS**
