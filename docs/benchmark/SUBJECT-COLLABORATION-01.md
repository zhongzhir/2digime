# SUBJECT-COLLABORATION-01 — Digital Me A ↔ Digital Me B 主体间协作

Branch: `build/subject-collaboration-01` (base `7a7a163`)
Owner: User · 2digime: 2digime · Coding Agent: opencode
Status: **engineering evidence**（AI-native runtime 验证；非哲学/法律意义上的「主体资格」宣称）

## 1. 目的

验证：两个真正隔离的 Digital Me（A 市场验证型 / B 可靠交付型）在**不合并主体**的前提下，
围绕一个任务完成 AI-native collaboration：

发现合作可能 → 最小授权请求 → B 依自己目标/边界/能力独立判断（accept/decline/constrain）
→ 执行 → 返回结果 + provenance → 双方各自验收 → 正确归属经验/成果。

**不是**两个普通 Agent 通信；而是两个各自保持 goal / memory / boundary 的 Subject 之间协作。

## 2. 控制变量与隔离

| 维度 | 值 |
|---|---|
| code / 协议 | 同一 commit `7a7a163` + 本次新增测试；复用同一 CollaborationRecord / AuthorizationGrant / CapabilityRegistry / Capability Closure / Growth 机制 |
| collaboration runtime | **不新建第二套**；完全复用 `src/collaboration/*`（LocalCollaborationHost + CollaborationTransport + evaluate + record-derive） |
| Subject Store | A 与 B 各用独立 subject package / store，**不共享** |
| 主体 | A=市场验证型（目标快速验证、允许可逆试错）；B=可靠交付型（目标可靠交付、边界=不得直接公开发布测试结果） |
| 能力 | 双方各注册独立 fake document capability（同一代码、不同 runtime 实例）；无真实模型依赖 |

## 3. 验证场景（`src/collaboration/tests/subject-collaboration-01.test.ts`）

- **CASE 1（能力互补）**：A 发现 B → 最小授权请求（只发 goal+必要材料+约束）→ B 依自己边界/能力 accept → B 自行组织执行 → 返回结果+provenance → A 验收 → Owner 获得结果；主体不合并。
- **CASE 2（主体边界冲突）**：A 请求「直接公开发布测试结果」触及 B 明确边界 → B 不服从 A、decline（依据来自 B 自身边界，`evaluationBasis` 含 `boundary:`）→ A 接受事实并本地 fallback，任务不死亡。
- **CASE 3（双方独立经验）**：一次合作后 A 形成 `collab:external_accept`（委托 B 有效），B 形成 `collab:fulfilled` + `collab:accepted_by_peer`；`cross_contamination = 0`。
- **SECTION 11（协商）**：A 要 24h → B 还价 48h 且先交关键部分 → A 接受 → B 接受 → 形成一次有限协调（proposal → counterproposal → accept），签发授权。
- **SECTION 13（对照）**：同一目标交给普通能力 vs Digital Me B —— 普通能力按 capability 合同直接执行（无 accept/decline、不落入协作记录）；Digital Me B 基于自身边界拒绝。产品确实区分 **Capability** 与 **Subject**。

## 4. 审计：既有协作能力（复用而非新建）

| 能力 | 现状 | 本次角色 |
|---|---|---|
| remote-subject / A2A | 已有 `remote-subject` adapter + relay transport | 远端「另一个 Digital Me」语义已具备；本地包路径复用 |
| delegated-execution | `delegateTask` + `decideDelegation` + capability fallback | 覆盖普通 Agent 委托（Arm 1）与失败回退 |
| CapabilityRegistry | 每 runtime 独立注册能力 | A/B 独立 capability view |
| ExternalCapabilityContract | `CapabilityProfile` / offerings | 能力发现载体 |
| SubjectContextPackage | `buildSubjectContextPackage` + `selectSubjectInjection` | 已用于 Distinguishability；本次协作只发最小上下文 |
| Capability Closure | `capability-closure` | 判断「本地不足 → 委托」 |
| receipt / provenance | `CollaborationDeliveryRef` + artifact provenance | 结果溯源（谁交付、digest、agreement） |
| CTO review | `delegateTask` 内本地验收 | 委托成果本地验收 |
| growth / experience isolation | `collab:*` tags 独立写各自 subject | 双方独立经验、cross_contamination=0 |

**既有但本次仅以测试验证、无需产品改动的部分**：主体间 accept/decline（`evaluateProposalForSubject`）、
最小披露（`offeredMaterials` + grant `resourceRefs` 只含必要材料）、协商（counter_proposed）、责任链（事件流）。

## 5. 成功标准

| 指标 | 结果 |
|---|---|
| subject_to_subject_collaboration | **true**（A↔B 通过现有协作 runtime 完成闭环） |
| independent_accept_decline | **true**（B 依自身边界 accept / decline；A 无法绕过） |
| minimum_context_disclosure | **true**（只发 goal+必要材料+约束；`whole_subject_disclosure = 0`） |
| subject_truth_isolation | **true**（A 的偏好/目标/边界不进 B，B 的不进 A） |
| independent_learning_after_collaboration | **true**（A/B 各自形成不同 confirmed experience） |
| delegated_execution_with_local_review | **true**（B 执行→A 验收→Owner 获得结果） |
| counterparty_failure_fallback | **true**（B decline → A 本地 fallback，任务不死亡） |
| responsibility_traceable | **true**（proposed/accepted/agreement/grant/fulfillment/delivered/result_decided 事件可追溯） |
| agent_vs_subject_semantics_distinct | **true**（普通能力无边界拒绝；Digital Me B 有） |
| cross_subject_contamination | **0** |
| whole_subject_disclosure | **0** |

## 6. LEVEL 3（capability swap）

本次 A/B 双方内部使用**同一** fake document capability（同一代码、不同 runtime 实例）。
能力交换的 subject continuity 条件在单能力环境下不自然成立；为完成指标不购买额外模型。
→ `capability_swap_subject_continuity = not_yet_fully_validated`（诚实保留；前置条件：A/B 行为由 subject state 驱动）。

## 7. Store / schema 变更

**0 新增 collaboration Store / 0 第二真值源 / 0 复杂状态机 / 0 新增永久 schema。**
本次仅新增测试文件 + 本文档/证据；产品代码无改动。临时运行态全部由现有 `CollaborationRecord`
事件流承载（append-only）。

## 8. 回归

`npm run build` 通过；`src/collaboration/tests/subject-collaboration-01.test.js`（4/4）通过；
全量测试结果见任务回传 CTO 部分。

## 9. 复现

```bash
npm run build
node --test --test-concurrency=1 dist/collaboration/tests/subject-collaboration-01.test.js
```
