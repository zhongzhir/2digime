# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 4 A2A 互操作开发者验证

**日期：** 2026-11-23
**结论：** `A2A_V1_OBJECT_MAPPING_PASS / EXISTING_RELAY_E2EE_BINDING_PASS / OFFLINE_INDEPENDENT_PROCESS_INTEROP_PASS / EXTERNAL_PRODUCTION_INTEROP_PENDING / NOT_OWNER_ACCEPTED`

## 1. 本轮结果

2digime 已把现有 Subject 协作投影为 A2A v1 标准对象：签名 Agent Card 用于发现主体能力，Message 承载一次合作请求，Task 与 Artifact 承载对方决定和可消费结果。真实协作仍经现有 Relay/E2EE 发送和接收，没有新建 network runtime、协作中心、用户 Task 页面、永久 Task Store 或第二套工作流。

用户侧仍只在 Talk 中看到自然语言事件和结果。`a2a:message:<exchangeId>` 与 `a2a:task:<exchangeId>` 只作为协议引用进入既有事件；A2A Task 不成为产品事实源或面向用户的任务状态机。

## 2. Build-vs-Integrate 结论

- 复用仓库已有的官方 `@a2a-js/sdk 1.0.1`，没有自行实现 A2A JSON-RPC、REST、gRPC、Agent Card 签名或协议序列化；
- Agent Card、Message、Task、Artifact 的构造、序列化、解析与签名均使用官方 SDK 类型和实现；
- 现有 `reference-agents/research-a2a-agent` 作为与 Digital Me 代码无依赖的独立进程启动，通过官方 A2A client/server 路径完成 Agent Card discovery、Message 发送和 Task + Artifact 返回；
- 该探针显式清空模型 API key，并使用离线协议探针，不调用付费模型、不产生外部费用。它验证协议对象可互通，不验证回答质量。

标准依据：

- <https://a2a-protocol.org/v1.0.0/specification/>
- <https://github.com/a2aproject/a2a-js>

## 3. Agent Card 与真实安全事实

- 标准 Agent Card 绑定当前 Subject ID、Runtime Endpoint、公开技能、合作范围、签发/过期时间和当前 Ed25519 通信 key；
- Card 使用现有 Subject 通信私钥生成官方 A2A 签名；接收方只使用配对时保存的对端公钥验证，并同时检查 key 撤销、有效期、Subject、Endpoint 和协议绑定；
- Relay 发布包同时携带既有签名公开卡和标准签名 Agent Card。两种投影必须分别验签并还原为完全一致的公开主体事实，才写入本地对端缓存；
- 标准 Card 的 required extension 明示当前传输事实：`X25519 + AES-256-GCM` 端到端加密、Ed25519 信封签名、配对端点 key 信任、既有 `AuthorizationGrant` 与 Personal Context Contract；
- 当前自定义 Relay binding 没有冒充 OAuth、Bearer、API key 或 mTLS，因此 `securitySchemes` 与 `securityRequirements` 保持为空。只有 token、没有签名 Subject extension 的 Card 和 Message 会被拒绝。

Slice 3A 的 `application/vp+jwt` 只作为该 Subject 支持的 Owner 委托出示格式写入扩展安全事实。本轮低风险 Relay 协作实际携带的仍是 Slice 1C Personal Context Contract 与 Grant 引用，没有自动为每条 Message 附加 Owner VP，不能扩写为“Slice 3A 委托凭证已完成 A2A 远程验证”。

## 4. Message、Task 与 Artifact

- `CollaborationRequest` 与 A2A Message 双向无损映射；Message 带当前 exchange、发送/接收 Subject、目标、希望贡献、最少披露合同和既有 Thread 引用；
- `CollaborationResponse` 与 A2A Task 双向无损映射；accept 对应 completed，decline 对应 rejected，clarify/alternative 对应 input-required；
- 接受结果以 Artifact 返回，包含自然语言贡献和结构化协作事实；现有 evidence digest 放在 Artifact metadata 与既有事件 body 中，不再误作协议引用；
- 接收方继续验证 Personal Context Contract、Relay 信封双方身份和实际发送体摘要。A2A 对象没有绕过既有授权、披露和结果真实性边界。

## 5. 已通过门

- 正确 Card 的 Subject、Endpoint、技能、Relay 安全事实、协议版本和 Ed25519 签名验证通过；
- Card 内容篡改、过期、已撤销 key、缺少 required Subject extension 或缺少签名均拒绝；
- bearer-only Card 和只放 token、没有 Subject binding 的 Message 均不能建立信任；
- Message → CollaborationRequest、CollaborationResponse → Task/Artifact → CollaborationResponse 无损往返通过；
- Task 状态与结构化 decision 不一致时拒绝；
- 真实 Relay 发布、缓存、重验标准 Card，并以标准 Message、Task、Artifact 完成现有双 Subject 协作；
- 独立官方 A2A server 进程完成标准 Agent Card discovery，接受 Message，并返回带可消费文本 Artifact 的 Task。

## 6. 工程验证

- `corepack pnpm build`：通过；
- Slice 4、签名公开卡、Endpoint/key 轮换、双 Subject Relay 和 Personal Context Contract 定向回归：17/17 通过；
- 真实 Subject 协作、Owner 委托和既有 A2A capability/adapter 回归：20/20 通过；
- 合计相关测试：37/37 通过；
- `git diff --check`：通过；只有工作区既有 LF→CRLF 提示。

官方 SDK 在“故意篡改 Card”的负向用例中会向 stderr 输出一次预期的签名验证失败堆栈；测试随后机械确认 `signature_invalid` 并通过。这不是未处理的产品异常。

本轮没有重跑并宣称全仓测试通过。既有全仓真实模型/Electron 长跑失败和挂起仍按当前计划作为独立基线处理。

## 7. 明确未完成

- 没有把 A2A HTTP/JSON-RPC Subject endpoint 暴露为公网生产服务；当前真实 Subject 协作绑定仍是现有私有 Relay/E2EE；
- 独立进程探针验证的是官方 SDK 协议实现，不是互联网上由另一组织运营的第三方 Agent，也不是第二位 Owner 控制的 Digital Subject；
- 没有验证公网 HTTPS、跨 Relay、外部 Agent 的签名 Subject extension、Owner VP challenge、远程 Grant 撤销或机构信任注册；
- 没有接真实银行、电信、政府或大型平台租户，没有真实身份、KYC、FAPI 2.0、OpenID4VC 互操作、数字人民币或支付；
- 没有新增产品 UI；尚未进行 Owner 产品验收、主干合并、推送、打包、发布或部署。

## 8. 下一门

下一推荐路线是 Slice 5 的两 Owner 真实机构试验，但必须先具备两位独立 Owner、两个独立 Subject/运行端点，以及至少一侧可合法、零费用或另行授权接入的真实机构身份源。试验应覆盖接受、拒绝、最小披露、撤销、过期、key 轮换、Endpoint 替换和可消费结果；自动测试不能替代两位 Owner 的真实验收。
