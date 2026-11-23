# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 3A Owner 委托凭证开发者验证

**日期：** 2026-11-23  
**结论：** `VC2_JOSE_DELEGATION_CORE_PASS / MINIMUM_DISCLOSURE_AND_LIFECYCLE_GATES_PASS / OPENID4VC_INTEROP_PENDING / NOT_OWNER_ACCEPTED`

## 1. 用户主链与实现边界

本切片支持以下机械主链：Owner identity 已通过机构联邦验证并显式绑定一个 Digital Subject；Owner 为该 Subject 签发有目的、有 actions/resource 范围和有效期的委托；Subject 向指定 verifier 出示时，以自己的活动通信 key 对短时 presentation 签名，并绑定 audience 与 challenge；verifier 同时验证 Owner 签名、Subject holder proof、当前 Grant、Owner identity/binding 和时间边界。

没有新增协作 UI、钱包、二维码、工作流或长期状态机。既有 `AuthorizationGrant` 仍是允许做什么的唯一事实源，VC/VP 是它的可验证投影；撤销不能只改凭证副本而绕开 Grant。

## 2. 标准与 Build-vs-Integrate 结论

- W3C Verifiable Credentials Data Model v2.0 是 2025-05-15 Recommendation，要求 conforming credential 使用 `https://www.w3.org/ns/credentials/v2`、VC 数据模型和至少一种 securing mechanism；
- W3C VC-JOSE-COSE 已于 2026-10-13成为 Recommendation，定义 `application/vc+jwt` / `application/vp+jwt`、`typ=vc+jwt|vp+jwt`、`cty=vc|vp` 和 JOSE 验证路径；
- OpenID4VP 1.0 于 2025-07-09成为 Final，定义 credential presentation request、DCQL、`vp_token`、`direct_post`、challenge/replay 与隐私要求；
- OpenID4VCI 1.0 于 2025-09-16成为 Final，定义 credential offer、授权、token、nonce、credential endpoint、生命周期和最小披露；
- 仓库已有 `jose 6.2.18` 作为成熟传递依赖，本轮把它提升为直接生产依赖，不自行实现 JWS/JWT 密码协议。

规范依据：

- <https://www.w3.org/TR/vc-data-model/>
- <https://www.w3.org/TR/vc-jose-cose/>
- <https://openid.net/specs/openid-4-verifiable-presentations-1_0.html>
- <https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html>

## 3. 已实现

- 新增 VC 2.0 紧凑 JSON-LD 委托文档，包含 pseudonymous Owner issuer、目标 Subject、owner-subject binding 引用、holder key 摘要、actions、可选 resource refs、purpose、有效期和 Grant 状态引用；
- 新增 `application/vc+jwt` EdDSA 签名，Owner 私钥只保存在既有 `FileSecretStore` 的加密文件中；
- 新增 `application/vp+jwt` 短时 presentation，由 Subject 既有 Ed25519 通信 key 签名，绑定 verifier audience、challenge、创建时间和 5 分钟有效期；
- 默认不披露邮箱、电话、外部 identity provider subject、ACR/AMR 或完整机构范围；仅 `organization_id` / `tenant_id` 可由调用方显式选择，未选择字段不进入 payload；
- 新增 `owned_subject` grantee 与 `owner_delegation` Grant origin，使实际 Owner identity、binding、purpose digest 和 credential id 可机械追溯，同时不增加第二个 Grant store；
- Owner key 按 Owner identity 隔离并支持轮换；旧 key 被替换后旧凭证不再接受，需以新 key 和新 Grant 重新签发；
- verifier 同时检查当前 Grant、Owner identity、Owner→Subject binding、Subject 活动 key、scope、purpose、时间、audience 和 challenge。
- Owner→Subject binding 保存签发确认时的 organization/tenant authority scope；同一 `issuer + subject` 重新认证但机构范围改变时，旧 binding 自动撤销，必须重新确认绑定。

## 4. 已通过负向门

- 修改或使用错误 Owner 公钥的 VC 签名拒绝；
- 使用错误 Subject key/endpoint 的 holder proof 拒绝；
- audience 或 challenge 不匹配拒绝；
- 缺少 required action 拒绝；
- Grant 撤销或凭证/presentation 过期拒绝；
- Owner identity 停用或 Owner→Subject binding 撤销拒绝；
- 同一机构 subject 的 organization/tenant 改变后旧 binding 自动撤销，旧凭证拒绝且不能继续签发；
- Owner key 轮换后旧凭证拒绝，新 key 重新签发通过；
- 未建立显式 Owner→Subject binding 时不能签发；
- 加密 secret 文件中没有私钥明文、外部 identity subject、邮箱或电话。

## 5. 明确未完成

- 没有实现 OpenID4VCI 的 credential offer、authorization/token/nonce/credential endpoint，也没有接独立 credential issuer；
- 没有实现 OpenID4VP 的 DCQL、`vp_token`、`direct_post`、request object、二维码或跨设备流程，也没有接独立 wallet/verifier；
- 普通 JOSE VC 本身不能像 SD-JWT 一样在既有凭证内选择性披露；本轮通过“签发时只包含本次需要的最小 claims”实现数据最小化，不冒充 SD-JWT；
- Owner 公钥目前由明确配置的 verifier 信任，尚未获得外部机构身份源背书，也没有受监管 trust registry；
- Grant 撤销通过当前权威存储注入验证，尚无公网状态端点、Status List 或跨 Relay 实时撤销同步；
- 设备丢失当前只证明用 Owner/Subject 新 key 重新签发的机械路径，不证明真实恢复仪式、机构管理员流程或多设备钱包迁移；
- 未接真实银行、电信或政府数据，未产生外部费用；未接产品 UI、Owner 验收、主干合并、推送、打包、发布或部署。

## 6. 工程验证

- `npm run build`：通过；
- identity 专项：11/11 通过，其中 Slice 3A 新增 5/5；
- Personal Context Contract、签名公开卡、端点/key 轮换和协作 Grant 受影响回归：13/13 通过；
- 远端授权投影合同：8/8 通过，其中 Owner→Subject Grant 直接当作远端再委托会被拒绝；
- `npm run smoke`：通过；
- `npm ls jose --depth=0`：直接生产依赖解析为 `jose 6.2.18`；
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：生产依赖 0 漏洞；
- `git diff --check`：通过，仅有工作区既有 LF→CRLF 提示。

本轮没有重跑并宣称全仓测试通过；当前计划已经记录的全仓真实模型/Electron 长跑失败与挂起仍是独立基线，不扩大本切片去修复。

## 7. 下一门

Slice 3B 需要独立、零费用的 OpenID4VCI issuer 与 OpenID4VP wallet/verifier，至少真实覆盖一次 issuance、DCQL 最小 claim 请求、challenge/replay、`vp_token`/`direct_post`、撤销/刷新和 key rotation。若没有合适独立对端，本阶段不自研钱包或二维码协议，转入 Slice 4 的 A2A 标准对象映射，并继续把 Slice 3A Grant 当唯一授权事实。
