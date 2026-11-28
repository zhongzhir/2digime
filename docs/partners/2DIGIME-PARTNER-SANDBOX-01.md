# 兔机米机构伙伴沙箱与试点资料包

**版本：** Slice 4 developer package
**日期：** 2026-11-28
**适用范围：** 合成数据、零费用、本机开发沙箱；不是生产银行/电信接入。

## 1. 合作价值与边界

机构可以把自身账号、权益和服务以最小方式连接到用户拥有的兔机米：机构负责身份映射、权益、服务配置和必要用量；用户的 Digital Self、私人 Talk、本地文件、长期记忆和通信私钥继续只在个人主体侧。机构服务以已验证 Subject 或 Capability 进入同一个 Talk 与数字主体协作，不建立机构专用聊天内核。

本资料包不宣称真实 KYC、真实银行/电信 SSO、FAPI 2.0 已实现、生产 SLA、支付或数字人民币能力。

## 2. 通信架构

```mermaid
flowchart LR
  Owner[真人 Owner] --> Client[兔机米个人客户端]
  Client --> Self[(本地 Digital Self\n私人 Talk / 文件 / 记忆)]
  Client -->|OIDC code + PKCE\n当前已实现| IdP[机构身份源]
  Client -->|账号兑换 / 权益摘要| Backend[Institution Backend]
  Backend --> Store[(机构 Store\n映射 / 权益 / 服务 / 审计)]
  Backend -->|virtual key 管理| Gateway[成熟 AI Gateway]
  Client -->|OpenAI-compatible\n受限凭据| Gateway
  Client -->|Relay / E2EE| Relay[Subject Relay]
  Relay --> Service[机构服务 Subject]
  Service -. Agent Card / A2A 1.0 .-> Client
  Backend -. 不得读取 .-> Self
```

Relay 与 Institution Backend 职责分离。前者只做主体网络传输，后者只做机构账号、权益、服务、用量和最小审计。

## 3. 60 分钟启动路径

| 时间 | 操作 | 通过标准 |
|---|---|---|
| 0–10 分钟 | 克隆/解压代码，确认 Node.js 与依赖，设置随机 `INSTITUTION_ADMIN_TOKEN` 和临时 `INSTITUTION_DATA_FILE` | 不需要云资源、付款方式或真实数据 |
| 10–20 分钟 | 启动 `node institution/backend/server.cjs`，打开 `/partner-sandbox` | 控制台可见；无令牌管理 API 返回 401 |
| 20–35 分钟 | 创建 1 个合成机构、2 个测试用户及不同权益 | 控制台显示两个独立用户与权益 |
| 35–45 分钟 | 注册 1 个服务 Subject，填写授权范围；需要时填 A2A endpoint 与 Agent Card URL | 服务引用真实 Subject ID，零费用、人在环策略可见 |
| 45–55 分钟 | 运行 `npm run institution:partner:journeys` | 电信权益旅程与银行服务协作旅程通过 |
| 55–60 分钟 | 查看最小审计与隐私边界，停用服务 | 审计无正文；停用生效；个人主体资料不受影响 |

## 4. 接口清单

正式机器可读合同见 [`institution/partner-sandbox/openapi.json`](../../institution/partner-sandbox/openapi.json)。当前沙箱主要接口：

| 接口 | 用途 | 认证 | 数据边界 |
|---|---|---|---|
| `GET /partner-sandbox` | 本机演示控制台 | 无；管理动作另鉴权 | 不注入令牌或用户数据 |
| `POST /v0/admin/partner/organizations` | 创建合成机构 | Admin Bearer | 机构 ID、名称、品牌引用、gateway 地址 |
| `POST /v0/admin/partner/users` | 创建测试用户与权益 | Admin Bearer | 合成账号、权益、有效期、模型范围 |
| `POST /v0/admin/partner/services` | 注册服务 Subject | Admin Bearer | Subject ID、endpoint、Agent Card、授权策略 |
| `GET /v0/admin/partner/overview` | 管理投影与最小审计 | Admin Bearer | 不返回任何凭据或正文 |
| `POST /v0/admin/partner/disable` | 停用机构/用户/服务 | Admin Bearer | 只改变机构侧可用性 |
| `POST /v0/session/exchange` | 沙箱账号兑换受限凭据 | mock，仅沙箱 | 不返回 provider master key |
| `GET /v0/client/overview` | 个人客户端机构投影 | 当前本机沙箱 | 权益、服务、授权与隐私边界 |
| `GET /v0/usage/summary` | 必要用量汇总 | 当前本机沙箱 | 无 prompt/response |

## 5. 身份与高安全 API 目标配置

- 当前真实成立：成熟 `openid-client`、HTTPS discovery、authorization code、PKCE S256、state、nonce、ID Token/UserInfo 校验、显式 Subject binding 与撤销。
- FAPI 2.0 仍是目标配置，不是当前能力。目标为 `private_key_jwt + PAR + authorization code + PKCE S256 + DPoP`；配置样例见 [`oidc-fapi-target.example.json`](../../institution/partner-sandbox/oidc-fapi-target.example.json)。现有产品对 `fapi2` 继续 fail-closed。
- 只有真实伙伴同时提供 client 注册、PAR、DPoP nonce 与受保护资源后，才进入独立互操作门；不得把普通 OIDC 或本沙箱写成 FAPI 2.0 通过。

## 6. A2A / Agent Card

机构服务的 `subjectId` 必须引用真实 Digital Subject。Agent Card 只公开服务名称、技能、可达 endpoint 与安全方案；实际卡必须由 Subject 通信 key 签名并在每次使用前校验，Bearer token 不能代替 Subject 绑定。参考形状见 [`agent-card.example.json`](../../institution/partner-sandbox/agent-card.example.json)，它没有签名，只用于合作方理解字段。

A2A Message / Task / Artifact 是协议投影，不是新的用户任务状态机。用户仍在同一 Talk 看协作目标、接受/拒绝、结果和撤销。

## 7. 机构事件合同

机器可读 schema 见 [`institution-event.schema.json`](../../institution/partner-sandbox/institution-event.schema.json)。事件只含机构、服务、事件类型、幂等键、发生时间和最小 payload 引用；不得把 prompt、response、Digital Self、文件正文或记忆放进事件。高风险动作、对外发送、付费、删除和权限变化仍需动作时确认。

## 8. 白标包

复用现有 Brand Kit，通过独立 `appId` 与 `userDataDirName` 形成机构品牌包；品牌配置不得包含密钥。当前已接受样例为 `brands/demo-telecom/brand.json`。构建命令：

```powershell
npm run build:packaged -- --brand=demo-telecom
```

本 Slice 不执行打包或发布。签名安装包、外部下载、生产部署需 Owner 另行授权。

## 9. 隐私数据流

| 数据 | 个人客户端 | Institution Backend | Relay | AI Gateway |
|---|---:|---:|---:|---:|
| Digital Self | 是 | 否 | 否 | 仅本次最小投影，按授权 |
| 私人 Talk 正文 | 是 | 否 | 否 | 本次调用所需内容；沙箱合成模式不落库 |
| 本地文件/Artifact | 是 | 否 | 仅加密授权载荷 | 仅本次授权所需 |
| 机构账号映射/权益 | 摘要 | 是 | 否 | 受限 credential/额度执行 |
| 用量汇总 | 摘要 | 是 | 否 | 是，无正文 |
| Subject 通信私钥 | 是 | 否 | 否 | 否 |
| 最小审计 | 本机执行事实 | 管理动作与资源 ID | 投递/确认元数据 | 必要计量 |

## 10. 建议试点范围

首个真实伙伴试点只做 1 个机构、10–50 名内部测试用户、1 项低风险服务、1 个 OIDC 租户、1 条人在环机构事件和只读/草拟型能力。禁止真实支付、数字人民币、信贷决定、号码过户、真实 KYC 结论、自动外发、删除或权限变化。

试点进入条件：机构安全负责人确认数据流；OIDC client 与回调完成登记；用量与日志无正文；服务 Agent Card 签名/撤销可验证；停用和 Owner 撤销真实生效；故障时回到 Talk，不假完成。

## 11. 验收清单

- [ ] 60 分钟内启动本机沙箱；
- [ ] 创建 1 个机构、2 个测试用户和不同权益；
- [ ] 注册 1 个真实 Subject 引用的服务；
- [ ] 无管理员令牌的管理请求被拒绝；
- [ ] 个人端显示机构、沙箱验证级别、权益、服务、范围、有效期和撤销；
- [ ] 完成 1 次 Talk 能力调用并产生用量汇总；
- [ ] 完成 1 次机构服务 Subject 协作接受与双方撤销；
- [ ] A2A 签名卡、Message、Task、Artifact 互操作通过；
- [ ] 机构侧无 prompt/response、Digital Self、私人文件或长期记忆；
- [ ] 服务停用与客户端撤销均生效；
- [ ] 所有数据为合成数据，材料没有冒充真实机构生产接入。
