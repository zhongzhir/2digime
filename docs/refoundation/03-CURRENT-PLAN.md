# 03 — CURRENT PLAN

**状态：** `current_authority / only_execution_plan`
**日期：** 2026-09-08
**性质：** 当前唯一执行计划。旧 roadmap、execution index、context 文首指针、01A baseline 附录中的「下一步」均不得再当 current plan。

开始任何实现前读 AGENTS.md 所列四份文件。本文件只回答：现在做什么、按什么顺序、什么不准做、还有哪些未决冲突。

---

## Repository Authority

### CURRENT AUTHORITY

```text
CURRENT AUTHORITY BRANCH:
build/tujimi-ui-minimal-integration-01
```

当前 Authority 为本文件所在的最新已提交 HEAD；每次 accepted 产品开发或治理提交后，该 HEAD 线性前进。不把某个 SHA 永久硬编码为本文件的 Authority HEAD。

### ACTIVE DEVELOPMENT RULE

默认：

```text
所有当前产品开发在唯一 Authority 线上线性推进。
```

不得再默认：

```text
one task = one branch = one permanent worktree
```

只有确实需要高风险隔离、长时间并行、明确实验，或 Owner / CTO 要求时，才创建临时 task branch/worktree。

### NEW TASK GATE

所有后续开发任务在开始前必须确认：

```text
1. AUTHORITY_HEAD
2. CURRENT_ACTIVE_BRANCH
3. ACTIVE_WORKTREE_STATUS
4. Build-vs-Integrate Gate
```

若任务指令中的旧 SHA 与当前 Authority 不一致：以当前已提交 Authority 为准，不得机械从旧 SHA 新开开发线。

### DIRTY WORKTREE RULE

历史 DIRTY worktree：

```text
FROZEN / NOT AUTHORITY
```

不得：作为新任务基线；从其中未提交 CURRENT-PLAN 判断当前权威状态；stash / reset / clean / checkout 覆盖；未经单独审计直接合入 Authority。

### TASK BRANCH LIFECYCLE

临时 task branch：

```text
建立
→ 开发
→ 验证
→ Owner / CTO ACCEPTED
→ integration 回唯一 Authority
→ 移除 task worktree
→ branch 归档或安全删除
```

禁止 accepted 后长期漂浮形成第二主线。

### MAIN RULE

当前：

```text
origin/main ≠ development authority
```

它仍是公开历史线。后续是否 reconcile / 升格，必须单独决策。

---

## 1. 后续唯一战略顺序（2026-09-08）

Refoundation Phase 1–3 已作为地基接受（见 §3）。**后续产品建设**按下列顺序，不得把四段同时当施工面，也不得在 Phase A 无限停留。

```text
Phase A  基础能力达到约 95 分位     CURRENT（Integrate-first；Coding 路线已证明）
Phase B  做实数字之我                 NEXT（增强，不限制模型）
Phase C  连接与自主选择               LATER
Phase D  Digital Subject Network      THIN SLICE ACCEPTED（Distributed Personal Selection；不做完整 Feed 产品）
```

核心定位（00）：**Digital Self / AI Capability / Digital Subject Network**。对外：**属于我 · 能做事 · 连接世界**。协作是 Subject Network 的一种应用，不是第三核心总称。

### Phase A — 基础能力达到 95 分位

**原则：** Integrate-first。能接不造。

重点接入（不自研替代成熟能力）：Coding Agent、Web、Computer Use、Office、Excel、图片、音频、视频、MCP / Skills。

当某项成熟外部能力已经能满足约 95 分位：停止继续自研该基础能力。研发转向数字之我、安全、授权与真实执行事实。

**2026-09-06 已部分闭环（Integrate-first，未自研替代）：** Talk / reasoning；Web search；authorized local files；Word/PPT 基础文件输出；Coding Agent（Codex + Windows 官方 `windows.sandbox=unelevated`）。

**2026-09-08 已证明 AI Capability 路线：** Zero-start Coding Talk Gate `ZERO_START_CODING_TALK_ACCEPTED`（Authority `24e1ce9`）。用户无现成 Coding Agent 时，2digime 可 acquire 成熟 runtime、复用聊天凭证、真实改项目、真实跑测试、把本次 delta 如实交给模型与用户。不自研 Coding Agent。

**尚未达到完整 95 分位：** Computer Use；专业 Office / PPT；Excel；图像；音频；视频；更丰富成熟 Agent / Tool 接入。这些仍须先过 Build-vs-Integrate Gate，**不要因为列表存在就自建**。Computer Use **今天仍 NOT STARTED**。

### Phase B — 做实数字之我

重点：输入资料、对话、成果、纠正、工作经验、协作经验、网络选择 → 模型理解 → Digital Self 持续成长 → 应用于下一次真实任务与网络选择。

Digital Self 不限制模型，只增加主体上下文。禁止用 Digital Self 削弱、隐藏或锁死。Digital Self 是这个人的个人选择算法，不得另建统一中心推荐代替它。

### Phase C — 连接与自主选择

兔机米根据目标、数字之我、真实能力与授权，由大模型自主选择：模型、Agent、Tool、本地软件、网络能力、其他 Digital Self。系统不写 router / score / workflow 代替这些判断。

### Phase D — Digital Subject Network / 新模式

**2026-09-08：** Digital Subject Network substrate 审计已完成（04 §13）。`DIGITALME-SUBJECT-NETWORK-FEED-01` 已证明：**同一 Relay 返回完全相同候选池，不同 Digital Self 的 2digime 自主选出不同内容；Relay 不参与个性化。** 裁定 `DISTRIBUTED_PERSONAL_SELECTION_ACCEPTED`（04 §14）。禁止另起 `subject-network-v2` / `feed-runtime` / `new-relay`。不把 Opportunity 冒充内容分发。不开始 Computer Use。不恢复 `#nav-collab`。

前三项能力仍须对真人成立；不把 Phase 3 协作试验扩成广播市场；不恢复 `#nav-collab`。中间服务（Relay / Index / Search 等）是服务商，不是网络主人。

### 与已接受 Refoundation 的关系

Phase 1 Digital Self、Phase 2 Talk 主链、Phase 3 协作地基仍然有效，不推倒重来。Phase 3 对象视为 Subject Network 的已有 substrate。两 Owner 真人试验（见 §3）可继续，但不扩建协作产品面，也不用新 runtime 替换已有 relay / discovery。

---

## 2. 下一开发任务

**任务名：** `DIGITALME-UI-PUBLIC-ALPHA-SURFACE-01`
**状态：** `NOT STARTED`
**阶段：** Public Alpha 产品面（UI Recovery Audit 已完成）
**本轮指针：** 实现 [`05-UI-RECOVERY-AUDIT.md`](./05-UI-RECOVERY-AUDIT.md) 的 **P0（7 项）**。视觉 **RECOVER_AND_ADAPT**：沿用 01B-B5 / 09-04 暖色纸感，按今天三入口重映射 IA。不重画 Figma，不造 Feed，不恢复 `#nav-work` / `#nav-collab`。成熟 Computer Use 仍在 Phase A 未完成清单中，**今天 NOT STARTED**。

已接受：UI Recovery Audit（本文指针所依 05）；`DISTRIBUTED_PERSONAL_SELECTION_ACCEPTED`；substrate 审计（04 §13）；`ZERO_START_CODING_TALK_ACCEPTED`（`24e1ce9`）；`STRATEGIC_ALIGNMENT_ACCEPTED` / `EXECUTION_TRUTH_RESTORED` / `CODING_CAPABILITY_REAL_AND_INTEGRATED`。

不要做完整 Feed 产品、不要做订阅/关注、不要恢复协作中心。历史已接受任务（Talk ↔ Digital Self Learning、Zero-start Coding 等）见 §3，不再当作「下一步」。

一台机器时必须两套完全独立的 Electron `userData`（`DIGITALME_V2_USER_DATA`），不得共享 Package、Thread、SecretStore。

---

## 3. 已接受的 Refoundation 地基

下列 Phase 1–3 条目仍是已接受地基，不是当前「下一步」。不得用旧模块轮动代替 §1 的 A–D。

### Phase 1 Digital Self（已接受）

**状态：** `ACCEPTED`

已成立：全系统一个 Digital Self authority；用户直述可写入；资料只形成候选；纠正有效；删除有效；重启保持；不读取旧 Growth / Profile / material facts 作为「我」。

唯一权威文件：SubjectPackage 内 `digital-self/self.json`。

脱敏验收摘要：[`02-DIGITAL-SELF-ACCEPTANCE.md`](./02-DIGITAL-SELF-ACCEPTANCE.md)。原始本地闸门证据不入库。

### Phase 2 Core Interaction Loop（已接受）

**状态：** `ACCEPTED`

已成立：对话是统一入口，做事是同一入口里的行为与结果。自然语言 → 当前 Digital Self → 模型 native `delegate` → External Capability 真实执行 → execution truth → 2digime semantic review → 同一 Thread。无 intent classifier、无关键词路由、无任务类型枚举。确定性 runtime 已知失败时，review 不得改写成成功。Talk 中具有持续意义的本人表达回流到同一 `self.json`，一次性事务不沉淀。

不迁旧 work / conversation runtime，不把 Job 当用户任务。

### Phase 2 Talk ↔ Digital Self Learning（已接受）

**状态：** `ACCEPTED`

已成立：用户只在「与 2digime」说话即可更新唯一 Digital Self。沿用 Phase 1 tell 的确认 / candidate / conflict 规则。纠正覆盖旧 current。默认不弹「是否保存到数字之我」。打开「数字之我」可见刚通过 Talk 形成的当前理解。正式 Electron + DeepSeek 已验证真人原句写入、纠正替换、一次性日程不沉淀。stub 不是产品路径。

### Phase 2 Product Surface（已接受）

**状态：** `ACCEPTED`

已成立：一级导航为「与 2digime / 数字之我 / 设置」；默认进入「与 2digime」；旧对话/做事/协作标签退出普通用户主路径。结果卡是文件名 + 打开/在文件夹中显示。附件路径只进入该次 talk 上下文。

Public Alpha 表面的 KEEP / ADAPT / RETIRE / MISSING、Figma 裁决与 P0 清单见 [`05-UI-RECOVERY-AUDIT.md`](./05-UI-RECOVERY-AUDIT.md)。实现前读 05；不得用旧四主栏 Figma 反写产品结构。

正式默认启动不再 attach 旧 Work Runtime / Job runner，也不再创建旧 Task/Job/work state。历史 `work.*` / `artifact.*` 仍可按需挂载，供开发与旧测试使用；这不是新产品 compatibility layer，talk / Digital Self / capability 不得经过该路径。

### Phase 2 / 3 仍不做

- **不迁旧 work runtime**
- **不修旧做事页**
- **不接旧 conversation runtime**
- 不把旧 `job-runner` 当新骨架
- 不继续 capabilityLoop / GENERAL-TASK-CLOSURE
- 不沿 DIGITAL-SELF-CORE-01 的 P1–P5 迁旧主链
- 不为绕开旧依赖增加 compatibility layer
- 不先做协作中心 UI，不恢复 `#nav-collab` 普通入口
- 不把另一 Subject 当 Tool / worker，不打开对方 Package 去 `submitTask`
- 不 push、不打包，除非 Owner 另令

### Phase 3 Collaboration Foundation（已接受）

**状态：** `ACCEPTED`

协作不是第三入口。用户仍只与自己的 2digime 交流；对端是独立 Subject，不是 Tool / Sub-Agent / 本方 worker。

外部标准判断与最小对象、第一版双 Subject 实验、禁止事项见 04。传输 KEEP Relay / E2EE。旧 `local-collaboration` 13 态与打开对方包 `submitTask`：**不接线**。

### Phase 3 Dual-Subject Loop（已接受 architecture/engineering pass）

**状态：** `ACCEPTED`（architecture/engineering pass）

正式入口「与 2digime」上，两个独立 Subject Package 完成一次合作闭环（内存 discovery 证明对象模型）。不做协作 UI、广域发现、真钱、信誉市场、多方。

### Phase 3 Real Peer Relay Gate（工程已接受）

**状态：** `ACCEPTED`（engineering）

discovery / transport 已接到 invite/peers + Relay/E2EE。不重写 AI collaboration logic。不新协作 UI、状态机、session、Task。

### Phase 3 Two-Owner Real Trial（进行中）

**状态：** `IN PROGRESS`

两个正式 Electron 实例之间的真实 Subject↔Subject。B 作为在线主体自主收件、判断、组织能力、回复。Owner A 只在原 Thread 看结果。必须另验一条 B 自主拒绝、A 自然恢复。本轮仍不扩功能。

---

## 4. 现场保护（仍有效）

- **干净 Phase 1 基线：** 分支 `checkpoint/2digime-refoundation-02`（worktree `dm-2digime-refoundation-02-checkpoint`）。只含已接受的 authority 文档 + 新 Digital Self。
- **Phase 2 核心闭环基线：** 分支 `build/2digime-refoundation-03-dialogue-doing`（本工作区）。含 talk 主链、External Capabilities 暴露、execution truth、semantic review。
- **冻结 legacy 工作区：** 分支 `build/subject-learning-availability-01` 仍停在 `1f4a7cf` 之上的未提交做事 UI / 能力闭环 / Digital Self Core：**保持原样**，不清理、不提交、不混入本基线。
- `digitalme-v2/`：未跟踪，不纳入。

---

## 5. 权威文件与降级清单

**现行唯一层级**

```text
AGENTS.md
  → 00-PRODUCT-CONSTITUTION.md
  → 01-DEVELOPMENT-CONSTITUTION.md
  → 02-FAILURE-LESSONS.md
  → 03-CURRENT-PLAN.md   ← 本文（排期）
  → 04-COLLABORATION-FOUNDATION.md   Phase 3 架构；不与 00/01/02 并列产品宪法
  → 05-UI-RECOVERY-AUDIT.md          Public Alpha UI 审计；不是宪法、不是 Current Plan
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

## 6. 原则冲突（不自行猜）

已裁定（后续 Owner 指令优先）：

| 冲突 | 裁定 |
|---|---|
| 01A「下一步 = 最短 Goal 闭环」vs 01C「Phase 1 = Digital Self」 | **01C**：先 Digital Self |
| rules §14 模块轮动 vs 本文旧 Phase 1→2→3 | **已被 §1 战略 Phase A–D 覆盖**；1–3 为已接受地基 |
| 广播作为核心创新假设 vs 协作扩建暂停 | **不实现广播市场与协作中心 UI**；假设留在 00。Distributed Personal Selection 已用公开候选池证明，不恢复 `#nav-collab`，不另起 network runtime |
| 自研基础能力 vs Integrate-first | **2026-09-06：能接不造**；95 分位靠接入，不自研替代 Codex / 搜索 / Computer Use |
| 「后台可保留复杂状态机」vs 禁止用状态机替代 AI | **禁止替代 AI**；运行态 ≠ 永久状态机 |
| DIGITAL-SELF P1–P5 迁旧主链 vs 新核重建 | **不沿旧链 P1–P5** |
| 单一说话入口 vs 对话/做事双标签 | **对话是统一入口**；做事是行为/结果。产品表面仍可 refinement，不得双运行时 |

仍未决（用保守交集，不替 Owner 选产品形态）：

1. **本人事实写入门槛**（01A 决策 1）：低风险自动成候选并页上可纠正，还是凡事先问再写。在 Owner 回答前：**不得把模型或材料检测写成已确认身份**；候选允许存在。

**ChatGPT Personal Context** 与仓库 `digitalme_context.md` 不是同一对象。前者全文不在本 git。重叠的 Owner/CTO 纪律已从 `digitalme_rules.md` 与 context §5.4 吸收进 01。若 Owner 随后提供 `personal-context.md` / `05-personal-context-1-.md` / `project_sources/01-digitalme_context.md`，只做增量对照，不自动升为第五份权威。

---

## 7. PHASE 3 协作试验约束

Foundation（04）与 Dual-Subject Loop architecture/engineering pass 已接受。Relay 工程接线已接受。Two-Owner Real Trial 仍可继续，**但不扩建协作产品面，也不用新 runtime 替代已有 substrate。协作是 Digital Subject Network 的一种应用（00 §4）。**

约束仍是：

1. 实现者已读 00/01/02/03 与 04；
2. Owner 已接受 04，并已下达 Dual-Subject、Relay Gate 与 `2DIGIME-COLLABORATION-03-TWO-OWNER-REAL-TRIAL`；
3. 不迁旧 work / conversation runtime，不把旧 Job 当协作骨架，不打开对方 Package 当 worker；
4. 不先做协作页面，不恢复 13 态，不自研替代 A2A/VC/payment；A 不得驱动 B runtime / drain；
5. 出现 Yellow/Red 立即停（04 §11）。

Phase 1 与 Phase 2（核心闭环 + 产品表面）已 ACCEPTED。Zero-start Coding Talk 已 ACCEPTED。Distributed Personal Selection 第一刀已 ACCEPTED（04 §14）。未完成 checkpoint 验证前不得把旧冻结做事代码并入本基线。当前不要自建 Computer Use，也不要新写 network runtime。
