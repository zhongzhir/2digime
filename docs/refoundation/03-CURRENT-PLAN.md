# 03 — CURRENT PLAN

**状态：** `current_authority / only_execution_plan`  
**日期：** 2026-09-01  
**性质：** 当前唯一执行计划。旧 roadmap、execution index、context 文首指针、01A baseline 附录中的「下一步」均不得再当 current plan。

开始任何实现前读 AGENTS.md 所列四份文件。本文件只回答：现在做什么、按什么顺序、什么不准做、还有哪些未决冲突。

---

## 1. 唯一顺序

```text
Phase 1  Digital Self
Phase 2  Dialogue + Doing
Phase 3  Collaboration
```

不得并行把三阶段都当施工面。不得用旧「模块轮动」代替此顺序（`digitalme_rules.md` §14 为历史策略）。

协作传输层（Relay / E2EE）已验证，**产品面继续暂停扩建**（决策 #110）。Phase 3 开始前须 Phase 1 与 Phase 2 对真人成立。

---

## 2. 下一开发任务

**任务名：** `2DIGIME-REFOUNDATION-03-DIALOGUE-DOING`  
**阶段：** Phase 2 Dialogue + Doing  
**本轮状态（2026-09-01）：** Phase 1 Digital Self 已获 Owner/CTO 接受，干净基线已固化。**现在不要开工实现**，除非 Owner 明确下达 03 任务。

### Phase 1（已接受）

**状态：** `ACCEPTED`

已成立：全系统一个 Digital Self authority；用户直述可写入；资料只形成候选；纠正有效；删除有效；重启保持；不读取旧 Growth / Profile / material facts 作为「我」。

唯一权威文件：SubjectPackage 内 `digital-self/self.json`。不是 GrowthEvent、不是 Profile、不是 memory、不是 `digital-self-core` Event 账本。

脱敏验收摘要：[`02-DIGITAL-SELF-ACCEPTANCE.md`](./02-DIGITAL-SELF-ACCEPTANCE.md)。原始本地闸门证据不入库。

### Phase 2 做

同一 Intelligence、同一 Goal，直接消费唯一 Digital Self。「帮我做 X」最短链路；两种不同 X 不加 intent enum。

### Phase 2 不做

- **不迁旧 work runtime**
- **不修旧做事页**
- **不接旧 conversation runtime**
- 不把旧 `job-runner` 当新骨架
- 不继续 capabilityLoop / GENERAL-TASK-CLOSURE
- 不沿 DIGITAL-SELF-CORE-01 的 P1–P5 迁旧主链
- 不 push、不打包，除非 Owner 另令

### Phase 3 预告（现在不开工）

协作产品面。传输层 KEEP 资产可复用。不扩建材料/支付/信誉/多方/P2P。

---

## 3. 现场保护（仍有效）

- **干净 Phase 1 基线：** 分支 `checkpoint/2digime-refoundation-02`（worktree `dm-2digime-refoundation-02-checkpoint`）。只含已接受的 authority 文档 + 新 Digital Self。
- **冻结 legacy 工作区：** 分支 `build/subject-learning-availability-01` 仍停在 `1f4a7cf` 之上的未提交做事 UI / 能力闭环 / Digital Self Core：**保持原样**，不清理、不提交、不混入本基线。
- `digitalme-v2/`：未跟踪，不纳入。

---

## 4. 权威文件与降级清单

**现行唯一层级**

```text
AGENTS.md
  → 00-PRODUCT-CONSTITUTION.md
  → 01-DEVELOPMENT-CONSTITUTION.md
  → 02-FAILURE-LESSONS.md
  → 03-CURRENT-PLAN.md   ← 本文
```

**降级（不删除）**

| 文件 | 新状态 |
|---|---|
| `AGENTS.md` | 仅入口（新写） |
| `docs/refoundation/2DIGIME-REFOUNDATION-BASELINE-01.md` | 01A 审计报告，不与四份 authority 并列 |
| `digitalme_context.md` | historical strategic context，不再承担 current plan |
| `digitalme_log.md` | append-only history |
| `digitalme_rules.md` | historical；吸收进 01/02（从 `433c3a8` 恢复到本工作区供对照） |
| personal-context / `project_sources/*` | 本 git 未找到；角色吸收进 01；全文待 Owner 补档 |
| DIGITAL-SELF-CORE-01 / ADR / 依赖图 | `frozen / absorbed_into_refoundation` |
| GENERAL-TASK-CLOSURE-01 | 不再作为当前执行计划 |
| 一切旧「当前执行指针 / 当前最高原则 / frozen_for_implementation 主线」 | historical / superseded |

---

## 5. 原则冲突（不自行猜）

已裁定（后续 Owner 指令优先）：

| 冲突 | 裁定 |
|---|---|
| 01A「下一步 = 最短 Goal 闭环」vs 01C「Phase 1 = Digital Self」 | **01C**：先 Digital Self |
| rules §14 模块轮动 vs 本文 Phase 1→2→3 | **本文顺序** |
| 广播作为核心创新假设 vs 协作扩建暂停 | **当前不实现广播/协作产品面**；假设留在 00 |
| 「后台可保留复杂状态机」vs 禁止用状态机替代 AI | **禁止替代 AI**；运行态 ≠ 永久状态机 |
| DIGITAL-SELF P1–P5 迁旧主链 vs 新核重建 | **不沿旧链 P1–P5** |

仍未决（03 开工时用保守交集，不替 Owner 选产品形态）：

1. **本人事实写入门槛**（01A 决策 1）：低风险自动成候选并页上可纠正，还是凡事先问再写。在 Owner 回答前：**不得把模型或材料检测写成已确认身份**；候选允许存在。
2. **第一刀用户入口**（01A 决策 2）：单一说话入口 vs 暂时保留对话/做事双标签。Phase 1 不依赖此题；Phase 2 前必须回答。底层必须同一 Subject + 同一 Goal，禁止双运行时。

**ChatGPT Personal Context** 与仓库 `digitalme_context.md` 不是同一对象。前者全文不在本 git。重叠的 Owner/CTO 纪律已从 `digitalme_rules.md` 与 context §5.4 吸收进 01。若 Owner 随后提供 `personal-context.md` / `05-personal-context-1-.md` / `project_sources/01-digitalme_context.md`，只做增量对照，不自动升为第五份权威。

---

## 6. 03-DIALOGUE-DOING 启动门

可以启动，当且仅当：

1. 实现者已读 00/01/02/03（经 AGENTS.md）；
2. 直接消费唯一 Digital Self，不迁旧 work / conversation runtime，不修旧做事页；
3. 遵守上文「Phase 2 不做」；
4. 未决冲突按保守交集处理（入口形态仍未决时不得做双运行时）；
5. 出现 Yellow/Red 立即停。

Phase 1 已 ACCEPTED。未完成 checkpoint 验证前不得把旧冻结做事代码并入本基线。
