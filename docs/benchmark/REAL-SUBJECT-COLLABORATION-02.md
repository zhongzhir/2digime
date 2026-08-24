# REAL-SUBJECT-COLLABORATION-02 — 两个独立 Digital Me runtime 的真实 subject-to-subject loop

Branch: `build/real-subject-collaboration-02` (base `ba1e2ed`)
Owner: User · 2digime: 2digime · Coding Agent: opencode
Status: **engineering evidence**（AI-native runtime 验证；非哲学/法律意义上的「主体资格」宣称）

## 1. 目的

验证两个真正隔离的 Digital Me runtime（A / B）经**真实 HTTP Relay transport（A2A）** 完成完整
subject-to-subject 协作闭环。**不共享对象引用、不调用对方内存函数**；通信全部走现有
remote-subject / A2A / transport 路径。

0 新协作功能；只修真实 integration defect。

## 2. 隔离方式

| 维度 | 值 |
|---|---|
| runtime | A / B 各自独立 `createDigitalMeRuntime` 实例 |
| userData / Subject Store | 各自独立 package（独立 subject store、collaboration store、grant store、growth store） |
| capability registry | 各自独立注册能力（`cap_fake_document` 各自实例） |
| subject state | A=市场验证型 / B=可靠交付型，各自独立 goals/boundaries/experience |
| 通信 | 真实 HTTP Relay（`createRelayServer` + `FileRelayStore`）+ `RelayTransport` E2EE 密封信封 |
| 不共享 | 无共享对象引用；无共享 Store |

## 3. 发现并修复的真实 integration defect

现有远程协作路径在 `propose`/`respond`（状态同步）可用，但**完整执行闭环**在远端不可用：

1. **成果内容无法跨 Relay**：`CollaborationDeliveryRef` 只含引用+digest，A 无法打开 B 的本地包取内容；
   `fulfill` 在 B 侧打开 A 包物化（远端 `dmep:` 引用失败）。
2. **授权无法跨 Relay**：`persistGrantBothSides` 对远端对端静默失败，A 侧 GrantStore 无授权。
3. **`autoEvaluateAndMaybeAgree` 不感知本方角色**：B 在自己 runtime 上运行 subject 评估时仍尝试
   `openByEndpointRef` 打开自己（远端引用失败）。

修复（复用现有协议，不新增 Store / 永久 schema / 状态机）：

- `src/collaboration/schema.ts`：`CollaborationEvent` 增加瞬态字段 `artifactText?`（交付内容）与
  `grant?`（授权副本），仅用于远端跨 Relay 承载；非持久业务 schema。
- `src/collaboration/local-collaboration.ts`：
  - `fulfill`：远端发起方时把成果内容随 `delivered` 事件承载，不再打开对端包物化（对端自行物化）。
  - `autoEvaluateAndMaybeAgree`：感知本方角色（发起方代评 / 接收方自身 runtime 评估），peer 路由正确。
  - `finishMaterializeFromDelivery`：优先用事件承载的内容物化，远端不再打开对端包。
  - `finalizeAgreementIfReady`：`grant_issued` 事件携带完整授权。
- `src/subject-comm/collaboration-sync-apply.ts`：接收方从 `grant_issued` 事件重建授权到本机 GrantStore。

## 4. 验证场景（`src/collaboration/tests/real-subject-collaboration-02.test.ts`）

- **CASE A（能力互补）**：A 提议 → B 在自己 runtime 上跑 subject 评估（accept）→ B 自行选能力执行 →
  成果经 Relay 交付 + provenance → A 拉取并本地物化 → A 本地 review（decideResult accept）→ Owner 获得成果。
  验证：A 不指定 B 用哪个内部模型；B 未获得 A 完整 SubjectPackage。
- **CASE B（边界冲突）**：A 请求「直接公开发布」触碰 B 边界 → 真实远端 B 依自身 subject 评估 decline
  （`evaluationBasis` 含 `boundary:`）→ A 接受并本地 fallback，任务不死亡。
- **failure path**：关闭 Relay / 远端不可达 → A 本地 fallback，用户面文档无 HTTP/Relay/adapter/内部错误。
- **最小披露**：捕获 B 实际收到的 collaboration_sync 明文 payload，断言只含 goal+必要材料+约束，
  无 SubjectPackage / 无关偏好 / 完整 memory。
- **独立成长**：A 形成 `collab:external_accept`，B 形成 `collab:fulfilled`；cross_contamination=0。

## 5. 成功标准

| 指标 | 结果 |
|---|---|
| real_independent_subject_runtimes | **true** |
| real_remote_subject_request | **true**（经真实 Relay + E2EE 信封） |
| remote_independent_accept_decline | **true**（B 依自身 subject 评估 accept / decline） |
| minimum_network_disclosure | **true**（只发 goal/材料/约束） |
| remote_subject_truth_isolation | **true** |
| independent_growth_after_remote_collaboration | **true** |
| local_final_review | **true**（A decideResult 定案） |
| remote_failure_fallback | **true** |
| cross_subject_contamination | **0** |
| whole_subject_disclosure | **0** |
| fake_remote_execution | **false**（真实 Relay 传输，非内存模拟） |

## 6. Store / schema / state

- 0 新增 collaboration Store / 0 第二真值源 / 0 新持久 schema / 0 新状态机。
- 仅向既有 `CollaborationEvent` 增加瞬态传输字段（`artifactText?` / `grant?`），随既有 `collaboration_sync`
  信封承载；Relay 无改动（仍纯 store-and-forward 密文）。

## 7. 回归

- `npm run build` 通过；smoke / model-gate / electron preflight 通过。
- 全量测试 877 / 841 pass / 31 fail（= 基线上既有环境失败：真实模型 e2e + electron 脚本；无新增回归）。
- `src/collaboration/tests/*` 28/27/1（1 fail = `local-collaboration-real.test.js` 需真实模型凭证，既有环境依赖）。
- `src/subject-comm/tests/*` 23/23 通过（含远程协作 minimal-close）。
- 既有 subject-collaboration-01 / delegated-execution-01 / subject-grounded-work-01 /
  growth-closed-loop-03 / capability-closure-01 / mcp-readonly 全部通过。

## 8. 复现

```bash
npm run build
node --test --test-concurrency=1 dist/collaboration/tests/real-subject-collaboration-02.test.js
```