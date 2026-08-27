# DIGITALME-SUBJECT-PREFERENCE-RELIABILITY-01

> 自然表达的长期偏好必须稳定进入 Subject，并在匹配任务时进入 freeze / executor。  
> 产品祖先：`e68e635f18489ba034846a815e56aaff21662c88`。Trial 文档祖先：`2cad235`。  
> 不 push。`researchEvidence.decided=false` 本轮不修（audit 杂质 backlog）。

---

## Success / failure case 对照

| Case | 输入（摘要） | 对话层 | Distill 落盘 | 复用 |
|------|----------------|--------|--------------|------|
| 语义控制 T4 / 学习可用性 CASE A | 「最有效的是先看到结论…」 | 理解 | `preference_observed` + `silent_ok` | 下一周报 freeze 注入 |
| Trial-05 初次 T3A | 「给老板看东西时，习惯先把风险…摊开」 | 理解 | `gevt_mtb5g8qj…` confirmed | T3B freeze **空**（当时是 reuse 缺口，CONTEXT-CONTINUITY 已修） |
| CONTEXT-CONTINUITY T3A | 同上 | 理解 | `gevt_mtb8334w…` confirmed | T3B freeze 含 preference |
| Revalidation T3A | 「跟上级同步的时候，我更想先把还没把握的地方和风险摊开…」 | **理解**（答应风险优先） | **`ok_empty` + `capture:noop`** | T3B/C2 无 preference 可注入 |
| 本轮 T3A | 「向上同步进展时，我更习惯把还没把握的地方和风险放在最前面…」 | 理解 | `gevt_mtbegdji…` `preference_observed` / `distill:model` / `silent_ok` | T3B/R2/C2 freeze 均含该 event |

Revalidation 权威盘（`dmv2-trial05rv-ud-01HnTU`）：

- 对话 turn `turn_mtbc6fas_k3jrf5` capture `pending` → **`ok_empty`（attempts=1，约 11.5s）**
- Growth：`本次输入无可沉淀要点` + `capture:noop` + 用户原句
- `derived/preferences.json` 终态为空
- 全程只有 `feedback_recorded`，没有 `preference_observed`

---

## 第一失真点

**Acquisition，不是 reuse。**

失败发生在：模型对话已经把这句话当成今后同类工作的做法，但 **structured distill 产出空提案**，系统把它写成语义上的「无可学」，并写下带 `captureKey` 的 `capture:noop`。此后幂等短路，重放也不会再学。

对应问题 A：

- 不是「模型完全没识别」（聊天回复已承诺风险优先）
- 不是 candidate / relevance / freeze 丢（当时 Subject 里根本没有 preference）
- 是 **structured result 为空 → adoption 没发生**；空结果与「模型明确判定不是长期偏好」被当成同一条 `nothing_to_learn`

成功/失败差异：同一条管道，对近义自然表达 **有时写出 `working_method`，有时写出 `candidates:[]`**。助手回复曾被拼进蒸馏原文，可能把「本轮已答应怎么做」当成无需沉淀。不是关键词漏检。

C2 fail 是后果：open goal + 项目上下文能工作，偏好不在 Subject，freeze 不可能有 preference。

---

## 修复点

原则：AI owns semantic interpretation。Subject 只做 provenance / 边界 / 采用闸门。没有 preference 关键词分类器，没有第二套 memory。

1. **蒸馏只看用户原文**  
   不再把助手回复拼进 `structuredDistill` source text。

2. **区分三种空结果**  
   - 模型明确 `not_durable` → 不记  
   - 解析/超时/未知 schema → repair；仍不可靠 → `distill_failed`，**禁止** `capture:noop`  
   - 首次空提案后做 **第二次模型语义验证**（durable / not_durable / uncertain），不是关键词重判

3. **结构化字段 schema repair**  
   中文标签「工作方法 / 偏好」等映射到既有 category/eventType；`eventType: working_method` 归一为 `preference_observed`。这是字段别名，不是用户自然语言分类。

4. **验证判定 durable 但 candidate 缺字段时，保留语义结果**  
   用用户原文补 title/text，不猜成 `knowledge_gap`。

模块：`structured-distill.ts`、`candidate-normalize.ts`、`subject-service.ts`。  
未改 planner / context-relevance / Trial 原句。

---

## Acquisition pipeline

```
user turn
  → captureInput（仅用户原文）
  → model distill JSON
  → 技术失败：repair
  → 仍空：semantic verify
  → normalize + quality gate
  → 低风险 preference_observed + silent_ok
  → confirm → derived/preferences.json
```

Electron 五次不同措辞（均 `preference_adopted=true`，`distill:model`，非 Trial 原句）：

| ID | 类型 | 事件 |
|----|------|------|
| G1 | 输出结构 | `gevt_mtbecz7u…` 先问题后方案 |
| G2 | 表达长度 | 主干短、细节进附录 |
| G3 | 判断方式 | 认原始数据与出处 |
| G4 | 协作方式 | 重大分歧先单独列出 |
| T3A | 向上同步结构 | `gevt_mtbegdji…` 风险/没把握在前 |

---

## Reuse pipeline

```
confirmed preference
  → context candidates（preference:eventId）
  → AI relevance
  → freeze selectedEventIds
  → executor subjectContext / plan requirements
  → 成文形状
```

三组真实任务：

| 任务 | freeze | executor |
|------|--------|----------|
| T3B 管理层进展 | `gevt_mtbegdji` + 长度偏好 | 正文先写 11 天审批卡点，建议后置；184 万 |
| R2 周五口述 | `gevt_mtbegdji` | `preference_in_context=true` |
| C2 开放对上稿 | 同上两条 preference + 苇舟 historical-artifact | 风险先行 + 附录；184 万 / 不做移动端；未选番茄炒蛋 |

---

## Stability / false-positive

- 五次独立 durable 采集：5/5 进入 Subject（Electron + 单测空提案后再验证）。
- G5「这次说明只用口语写，下回不用这样」：`preference_adopted=false`，未长期化。
- G6「同事老李…他那套我不想学」：未写成本人 preference。
- 单测：中文 schema 标签可归一；`<<<not-json>>>` → `distill_failed` 且该 `captureKey` 无 `capture:noop`。

---

## T3 / C2 Electron

入口：`electron/main.cjs`，userData `dmv2-prefrel-ud-nUCf2A`。  
证据：`build/evidence/subject-preference-reliability-01/`（本地，不入库）。

| 项 | 结果 |
|----|------|
| T3 | **pass**：T3A adopted；T3B freeze 含 preference；成文风险先行且有项目事实 |
| C2 | **pass**：历史项目 + 两条 durable preference 同时进入 selected/freeze；成文体现二者；无炒蛋污染；无空模板 |

本轮 Electron 首次 distill 即写出 `working_method`（验证层是安全网）。Revalidation 那次是空 JSON 被当成无可学。

---

## Regression

单测通过：`subject-preference-reliability-01`、`ai-native-semantic-control-01`、`context-continuity-01`、`subject-learning-availability-01`、`real-distillation-jit-integration`。  
correction / supersede / knowledge_gap 不升级本人事实 / 无 fake completion：既有测试保持。  
T1 research 综合、T2 指代、T4 coding、T6 对话、T7 附件、T8 诚实失败、C1 本轮未重跑全量 Electron；产品路径未改那些模块。C2 本轮证明项目上下文仍能与偏好同时装配。

**Backlog：** `researchEvidence.decided=false` 仍是审计杂质，未修。

---

## Verdict

```
PASS
```

完成标准 1–10 均成立：T3/C2 Electron pass；6 类语义泛化正确；durable 多次采集稳定；临时与他人信息不误入；preference 进入 freeze 且 executor 使用；无关键词/regex/case patch。
