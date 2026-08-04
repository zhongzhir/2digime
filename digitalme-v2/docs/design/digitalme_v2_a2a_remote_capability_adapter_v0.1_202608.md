# Digital Me V2 A2A Remote Capability Adapter v0.1

- **日期**：2026-08-04
- **任务**：`DIGITALME-V2-A2A-REMOTE-CAPABILITY-ADAPTER-01`
- **状态**：`implemented_pending_owner_review`（本轮不提交）
- **基线**：`v2/foundation` @ `4805f5b`

## 1. 对手方为何独立

参考 Agent 位于 `digitalme-v2/reference-agents/research-a2a-agent/`，以独立 Node 进程运行：

- 自有 Agent Card、Task Store（SDK `InMemoryTaskStore`）、生命周期与模型凭证
- **不**读取 Digital Me SubjectPackage / SecretStore / Artifact Store / Job Store
- 只消费 A2A Task 消息中明确给出的授权材料
- 可被任意兼容 A2A 1.0 的第三方 Agent 替换，而无需修改 Subject、Work Runtime 或 Artifact 合同

它是产品级互操作基线，不是 echo / 固定模板服务。真实模型路径写入 `reachedModel` 元数据。

## 2. A2A 与内部对象映射

| Digital Me | A2A |
|---|---|
| Capability description | Agent Card / Skill（`project_risk_brief`） |
| 本地 Task + Grant 投影 | A2A Message 输入（仅授权字段与材料摘要） |
| 本地 Job | 用户面唯一权威状态 |
| `Job.remoteExecution.executionId` | A2A `taskId` |
| Candidate Artifact | A2A Artifact |
| cancel | A2A CancelTask（本地 abort 优先） |
| recover | 重新 GetTask / collectArtifact |
| Action Receipt | 记录 `protocolMapping.protocol=a2a` 与来源 |

**禁止**：把 A2A Task 变成内部权威；新建第二 Job 状态机；把 Agent Card 写入主体事实；把外部 Artifact 直接写入成长链；让 renderer 直接调用 A2A。

## 3. 端点白名单策略

`RemoteEndpointPolicy` 由确定性代码执行，字段包括：

`endpointId`、`baseUrl`、`expectedAgentCardUrl`、`allowedHost`、`allowedProtocol=https|loopback-http`、`capabilityAllowlist`、`modelPolicy`、`maxTaskDuration`、`maxInputBytes`、`maxOutputBytes`、`maxCallsPerTask`、`enabled`。

规则：

- 开发期允许 `127.0.0.1` 的 `loopback-http`
- 非 loopback 必须 HTTPS
- 禁止任意 URL 输入后立即调用
- Agent Card 主体名、Skill、接口主机与协议版本必须校验
- 端点指纹变更视为新对手方
- 默认禁止重定向到非白名单主机
- 默认禁止再委托
- 对手方凭证使用独立环境变量，不复用 Digital Me SecretStore 主密钥
- 本轮不做公网目录 / 动态发现

## 4. 授权与数据披露

沿用 readiness 的 `RemoteAuthorizationProjection`：

- 仅发送授权材料摘要与目标
- 主体经验默认不外发
- `allowRemotePersist=false`、`allowRedelegate=false`
- UI 展示「外部专业能力：研究分析能力 · 来源：已连接的专业能力」
- 仅 SubjectPackage 对手方使用「另一个数字之我」
- 不暴露协议名、Card、taskId、endpoint

## 5. Artifact 验证与完整性

沿用 `verifyCandidateArtifact`，并增加完整性追溯：

- `modelGeneratedContent` / `modelContentDigest`：真实模型原文
- `deterministicFormatting`：仅标题、目标行、间距等格式结构
- `reachedModel=true` 只表示调用到模型，**不**表示成果合格
- 篇幅不足：最多一次受预算控制的模型修订；仍不足则失败，不得用模板补写风险判断/建议
- 若最终正文出现模型原文中不存在的固定模板实质句，验证拒绝（`template_padding_detected`）

## 6. 取消与恢复

- 本地 Job 取消优先；远端 CancelTask 使用短超时通知
- 取消后迟到 Artifact 不得覆盖本地 `cancelled`
- 应用重启后扫描 `running + remoteExecution`，经 `recover` 续接
- 远端服务重启后，若 Task 仍可查询则恢复；否则 Job 失败并可重试

## 7. 与私有 API 的工程对照

同一参考 Agent 提供 `POST /private/v1/analyze`（仅工程对照，不进产品 UI）。

| 项 | 证据 |
|---|---|
| A2A Adapter 新增主文件 | `a2a-remote.ts` + `a2a-wire.ts` + `remote-endpoint-policy.ts` |
| 私有 API Adapter 新增主文件 | `private-http-remote.ts`（显著更薄，但无耐久取消/恢复） |
| 第二能力接入需改核心合同 | **否**；仅新增 endpoint policy 实例并 `registry.register` |
| 状态/取消/Artifact 是否需私有字段 | **否**；A2A 走标准 Task/Artifact；本地只用既有 `remoteExecution` |
| A2A 是否减少定制成本 | **是**：协议状态、取消、成果形态标准化；私有路径每次都要重做异步语义 |

## 8. 第三个外部 Agent 接入前的条件

1. 白名单 endpoint policy（主机、协议、Skill、时长与字节预算）
2. Agent Card 可核对且 Skill 落入 allowlist
3. 独立凭证与禁止再委托
4. 通过候选验证与 Action Receipt 审计
5. 取消/恢复在本地 Job 权威下可演示
6. 产品文案不泄漏协议细节
7. 单独 Owner 授权任务（本轮不自动接入公网或第二个异构 Agent）

## 9. 明确不做

公共目录、广播、自动发现/协商、支付、信誉、DID/VC、公网开放服务、自动再委托、多方协作、修改主体核心合同、产品壳重构。

## 10. 验收入口

```bash
cd digitalme-v2
npm run accept:a2a-remote-capability
```
