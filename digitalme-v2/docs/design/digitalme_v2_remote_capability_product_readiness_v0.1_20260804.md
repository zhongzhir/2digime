# Digital Me V2 — 远端能力产品准备（Remote Capability Product Readiness）v0.1

- **任务**：`DIGITALME-V2-REMOTE-CAPABILITY-PRODUCT-READINESS-01`
- **日期**：2026-08-04
- **状态**：`product_readiness` / **not A2A connected** / **not implementation of broadcast**
- **范围**：统一 CapabilityAdapter 合同、Work Runtime 远端映射边界、授权投影、候选成果验证、行动收据、受控远端 Adapter 参考实现与验收
- **明确不做**：真实 A2A、自动发现、广播、公网、支付、信誉、DID/VC、再委托、导航调整、`digitalme-app`

---

## 1. 模块成熟度基线

| 模块 | 成熟度 | 说明 |
| --- | --- | --- |
| CapabilityAdapter 统一合同 | readiness | `describe` / `checkAvailability` / `prepareAuthorizedInput` / `execute` / `getStatus` / `cancel` / `recover` / `collectArtifact` 已冻结 |
| 本地 Adapter helper | readiness | 本地同步能力经 `asLocalCapabilityAdapter` 补齐默认生命周期，不改原有 `execute` 语义 |
| Work Runtime 远端边界 | readiness | 本地 Job 五态仍是唯一用户面权威；`remoteExecution` 仅为映射 |
| Authorization 投影 | readiness | 本地确定性投影；默认禁止远端持久化与再委托 |
| Candidate Artifact 验证 | readiness | 验证前为候选；通过后方可 ArtifactCommit；模型自评不算独立验证 |
| Action Receipt | readiness | Artifact bundle / audit 附件；**不新增权威 Store** |
| ControlledRemoteCapabilityAdapter | readiness | `adapter.type = remote-subject` 正式参考实现；HTTP 进程边界；可替换为未来 A2A Adapter |
| 真实 A2A / 广播 / 支付 | not started | 本轮仅准备条件，不接入 |

---

## 2. 统一 Adapter 合同

实现方**不得**触碰 Task/Job/Artifact Store。协议 Adapter **不得**成为 Job 权威。

冻结方法：

1. `describe()` — 静态描述与版本
2. `checkAvailability()` — 可用性
3. `prepareAuthorizedInput()` — 按授权投影裁剪字段/材料
4. `execute()` — 启动或完成执行，产出可规范化的 `CapabilityOutput`
5. `getStatus()` — 远端/本地状态视图
6. `cancel()` — 取消；取消后迟到 `collectArtifact` 必须拒绝
7. `recover()` — 断线/重启后按 `executionId` 再关联
8. `collectArtifact()` — 收集候选成果（仍须经验证门禁）

本地同步能力：`getStatus` / `cancel` / `recover` / `collectArtifact` 可为本地语义（执行即完成 / 跟随 `AbortSignal`）。

---

## 3. 远端状态映射

本地 Job 状态仍封闭为：

`queued → running → succeeded | failed | cancelled`

可选映射字段（**不是**第二状态机）：

```ts
remoteExecution?: {
  executionId: string;
  adapterId: string;
  endpoint?: string;
  lastRemoteStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  cancelRequested?: boolean;
  retryCount?: number;
}
```

支持：超时、断线恢复、幂等重试（最多一次）、重启后 re-associate `executionId`、远端完成但本地提交失败时可恢复。取消后禁止新结果写入。

---

## 4. 授权投影

`src/capability/remote-authorization.ts` 将 Grant / 本地约束投影为：

- `allowedFields`
- `allowedMaterials`
- `purpose`
- `expiresAt` / time limit
- `maxCalls`
- `maxMaterialBytes`
- `maxRuntimeMs`
- `allowRemotePersist`（默认 `false`）
- `allowRedelegate`（默认 `false`）

全部由本地确定性代码执行；`prepareAuthorizedInput` 必须裁剪字段与材料。

---

## 5. 候选 Artifact 验证

`src/capability/candidate-artifact-verify.ts` 检查：

- format / size
- task relevance
- provenance / source binding
- authorized-data leakage
- unsafe instruction

验证前为候选；只有通过验证后才可 ArtifactCommit。  
模型自评不算独立验证。  
未验证成果不得写正向 GrowthEvent；采用仍走既有 `subject.captureInput`。

---

## 6. 行动收据（Action Receipt）

`src/capability/action-receipt.ts` 作为 Artifact bundle / audit 附件：

- 记录 subject/task/job/grant、capability/adapter/version、endpoint
- 实际发送字段名与材料引用（非敏感正文）
- 远端 `executionId`、状态/超时/取消/重试
- 返回 Artifact 哈希/类型/来源、验证结果
- 采用/拒绝占位、开始/结束/失败时间

**不新增权威 Store。**

---

## 7. 故障恢复

| 场景 | 处理 |
| --- | --- |
| 请求重复提交 | 同 job 幂等键；网络层最多重试一次 |
| 网络超时 | Job `failed`；不写正式 Artifact |
| 远端处理中断线 | 保留 `remoteExecution`；重启后 recover/collect |
| 应用重启 | `running + remoteExecution` → requeue resume（非第二状态机） |
| 取消成功 | 本地 `cancelled`；迟到 collect 拒绝 |
| 取消请求失败 | 本地仍取消并禁止写入 |
| 远端已完成、本地未收到 | recover → collect → verify → commit |
| Artifact 已返回、本地写入失败 | 保留映射，重启后可再提交 |
| 返回格式错误 / 未授权泄漏 / 索要额外材料 | 验证或安全门禁失败，不落正式成果 |

---

## 8. 安全与预算

确定性限制：

- endpoint 白名单
- 单任务调用次数
- 超时 / 并发
- 重试最多一次
- 输入/输出大小
- Token/费用**占位**预算接口（本轮不实现真实付款）
- Kill switch
- 取消后禁止新结果写入

App 默认**不**注册远端能力；仅测试/验收通过 `DigitalMeRuntimeOptions.remoteCapability` 启用。

---

## 9. 下一轮 A2A 接入条件（闸门）

在宣称 A2A 接入前，至少同时满足：

1. 本轮 readiness 验收持续绿色（合同、验证、取消、恢复）
2. 对手方 endpoint / 身份绑定策略经 Owner 确认（白名单，非公网广播）
3. 授权投影覆盖 A2A Task/Message 披露面，且再委托仍默认关闭
4. 候选验证与 Action Receipt 能绑定外部 `taskId` / `contextId` 而不引入第二 Job 权威
5. 不把 Discovery / Broadcast / 支付 / 信誉 绑进同一切片

替换路径：未来 `A2ACapabilityAdapter` 实现同一 `CapabilityAdapter` 合同即可，**不得**修改 Subject / Work Runtime 核心合同。

---

## 10. 验收入口

```bash
npm run build && npm test
npm run accept:remote-capability-readiness
```

状态声明：本设计与实现为 **product readiness**；**尚未连接 A2A**；**不是广播实现**。
