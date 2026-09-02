# 03 — CURRENT PLAN

**状态：** `current_authority / only_execution_plan`
**日期：** 2026-09-02
**性质：** 当前唯一执行计划。旧 roadmap、execution index、context 文首指针、01A baseline 附录中的「下一步」均不得再当 current plan。

开始任何实现前读 AGENTS.md 所列四份文件。本文件只回答：现在做什么、按什么顺序、什么不准做、还有哪些未决冲突。

---

## 1. 唯一顺序

```text
Phase 1  Digital Self                         ACCEPTED
Phase 2  Core Interaction Loop                ACCEPTED
Phase 2  Product Surface                      ACCEPTED
Phase 3  Collaboration                        NEXT
```

不得并行把三阶段都当施工面。不得用旧「模块轮动」代替此顺序（`digitalme_rules.md` §14 为历史策略）。

协作传输层（Relay / E2EE）已验证。Phase 1 与 Phase 2 已对真人成立。**下一刀才是 Phase 3 Collaboration**，现在尚未开工。

---

## 2. 下一开发任务

**阶段：** Phase 3 Collaboration
**本轮状态（2026-09-02）：** Phase 1 Digital Self、Phase 2 Core Interaction Loop、Phase 2 Product Surface 均已 ACCEPTED。正式默认产品路径不再初始化旧 Work Runtime。旧 `work-runtime` 代码保留为 reference / 历史命令入口，不得再当新产品骨架。

### Phase 1 Digital Self（已接受）

**状态：** `ACCEPTED`

已成立：全系统一个 Digital Self authority；用户直述可写入；资料只形成候选；纠正有效；删除有效；重启保持；不读取旧 Growth / Profile / material facts 作为「我」。

唯一权威文件：SubjectPackage 内 `digital-self/self.json`。

脱敏验收摘要：[`02-DIGITAL-SELF-ACCEPTANCE.md`](./02-DIGITAL-SELF-ACCEPTANCE.md)。原始本地闸门证据不入库。

### Phase 2 Core Interaction Loop（已接受）

**状态：** `ACCEPTED`

已成立：对话是统一入口，做事是同一入口里的行为与结果。自然语言 → 当前 Digital Self → 模型 native `delegate` → External Capability 真实执行 → execution truth → 2digime semantic review → 同一 Thread。无 intent classifier、无关键词路由、无任务类型枚举。确定性 runtime 已知失败时，review 不得改写成成功。

不迁旧 work / conversation runtime，不把 Job 当用户任务。

### Phase 2 Product Surface（已接受）

**状态：** `ACCEPTED`

已成立：一级导航为「与 2digime / 数字之我 / 设置」；默认进入「与 2digime」；旧对话/做事/协作标签退出普通用户主路径。结果卡是文件名 + 打开/在文件夹中显示。附件路径只进入该次 talk 上下文。

正式默认启动不再 attach 旧 Work Runtime / Job runner，也不再创建旧 Task/Job/work state。历史 `work.*` / `artifact.*` 仍可按需挂载，供开发与旧测试使用；这不是新产品 compatibility layer，talk / Digital Self / capability 不得经过该路径。

### Phase 2 / 3 仍不做

- **不迁旧 work runtime**
- **不修旧做事页**
- **不接旧 conversation runtime**
- 不把旧 `job-runner` 当新骨架
- 不继续 capabilityLoop / GENERAL-TASK-CLOSURE
- 不沿 DIGITAL-SELF-CORE-01 的 P1–P5 迁旧主链
- 不为绕开旧依赖增加 compatibility layer
- 不 push、不打包，除非 Owner 另令

### Phase 3 Collaboration（下一步，尚未开工）

协作产品面。传输层 KEEP 资产可复用。不扩建材料/支付/信誉/多方/P2P。不开工，除非 Owner 下达 Phase 3 任务。

---

## 3. 现场保护（仍有效）

- **干净 Phase 1 基线：** 分支 `checkpoint/2digime-refoundation-02`（worktree `dm-2digime-refoundation-02-checkpoint`）。只含已接受的 authority 文档 + 新 Digital Self。
- **Phase 2 核心闭环基线：** 分支 `build/2digime-refoundation-03-dialogue-doing`（本工作区）。含 talk 主链、External Capabilities 暴露、execution truth、semantic review。
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
| 单一说话入口 vs 对话/做事双标签 | **对话是统一入口**；做事是行为/结果。产品表面仍可 refinement，不得双运行时 |

仍未决（用保守交集，不替 Owner 选产品形态）：

1. **本人事实写入门槛**（01A 决策 1）：低风险自动成候选并页上可纠正，还是凡事先问再写。在 Owner 回答前：**不得把模型或材料检测写成已确认身份**；候选允许存在。

**ChatGPT Personal Context** 与仓库 `digitalme_context.md` 不是同一对象。前者全文不在本 git。重叠的 Owner/CTO 纪律已从 `digitalme_rules.md` 与 context §5.4 吸收进 01。若 Owner 随后提供 `personal-context.md` / `05-personal-context-1-.md` / `project_sources/01-digitalme_context.md`，只做增量对照，不自动升为第五份权威。

---

## 6. PHASE 3 启动门

可以启动，当且仅当：

1. 实现者已读 00/01/02/03（经 AGENTS.md）；
2. Owner 已下达 Phase 3 Collaboration 任务；
3. 不迁旧 work / conversation runtime，不把旧 Job 当协作骨架；
4. 遵守上文「仍不做」；
5. 出现 Yellow/Red 立即停。

Phase 1 与 Phase 2（核心闭环 + 产品表面）已 ACCEPTED。未完成 checkpoint 验证前不得把旧冻结做事代码并入本基线。
