# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 2C 进入条件评估

**日期：** 2026-11-23  
**结论：** `ENTRY_PATH_SELECTED / IMPLEMENTATION_NOT_STARTED / FAPI2_STILL_FAIL_CLOSED / NO_EXTERNAL_ACCOUNT_OR_FEE`

## 1. 结论

Slice 2C 不需要自研 FAPI 协议栈。仓库实际安装 `openid-client 6.9.1`（下层 `oauth4webapi 3.8.9`），已经提供 PAR、`private_key_jwt` 和 DPoP 所需接口；OpenID Foundation 的认证清单覆盖 `openid-client >= 6.6.2` 的 FAPI 2.0 RP 组合。

桌面端第一实现路线确定为：

`private_key_jwt + PAR + authorization code + PKCE S256 + DPoP sender-constrained token`

mTLS 保留为机构明确要求时的替代 sender constraint。选择 DPoP 不是降低安全要求，而是避免桌面端先引入客户端证书签发、安装和跨设备生命周期；最终仍必须服从具体机构的安全策略。

本文件只关闭进入评估，不宣称 FAPI 2.0 已实现。现有 `fapi2` 配置继续机械拒绝。

## 2. 标准与成熟实现依据

- OpenID Foundation 已于 2025-02-19 将 FAPI 2.0 Security Profile 和 Attacker Model 批准为 Final Specification；
- FAPI 2.0 Security Profile 要求 PAR、强客户端认证（mTLS 或 `private_key_jwt`）以及 sender-constrained access token（mTLS 或 DPoP），并规定 DPoP nonce、授权服务器元数据和密码算法等约束；
- OpenID Foundation 的认证清单列出 `openid-client >= 6.6.2` 通过 FAPI 2.0 RP Security Profile Final 的多种组合，包括 private key、DPoP 与 OIDC；
- 当前安装版本为 `openid-client 6.9.1`，可继续复用现有适配器边界，无需引入第二套 OIDC/FAPI 状态机或 token store。

依据：

- <https://openid.net/fapi-2-security-profile-attacker-model-final-specifications-approved/>
- <https://openid.net/specs/fapi-security-profile-2_0-final.html>
- <https://openid.net/certification/certified-fapi-2-0-rp-security-profile-final-message-signing-final/>
- <https://github.com/panva/openid-client>

## 3. Slice 2C-1 的最小实现边界

1. 在现有 `InstitutionIdentityProvider` 上增加明确的 FAPI 2.0 client 配置，不改变 Owner identity、Subject binding 或既有一次性事务模型；
2. `private_key_jwt` 私钥进入既有 SecretStore，产品配置和事务只持有 `kid`、算法与 provider 配置指纹，不写入私钥；
3. PAR request URI、PKCE verifier、state、nonce 与 DPoP nonce 只进入加密一次性事务；access token、refresh token 和 DPoP 私钥不持久化到身份记录或审计报告；
4. DPoP key 至少按 issuer/client 隔离；是否按事务或设备轮换由真实提供方兼容性门决定，不能以固定全局 key 省略生命周期；
5. 必须真实调用受保护资源，验证 token audience、scope 与 sender constraint；只取得 ID Token 或 access token 不算通过；
6. 继续由同一个机构联邦服务完成身份结果，同一个 Digital Self 和授权模型决定后续动作，不新增机构控制面、第二套长期上下文或用户可见状态机。

## 4. 必过正向与负向门

- 正向：HTTPS discovery、PAR、浏览器授权、PKCE S256、`private_key_jwt`、DPoP nonce、token 交换、UserInfo 或等价受保护资源调用全部真实通过；
- audience/scope：错误资源、缺少 scope、错误 audience 均被提供方或本地机械校验拒绝；
- 重放：授权码、PAR request URI、DPoP proof 和旧 nonce 重放被拒绝；
- sender constraint：用不同 DPoP key 调用资源被拒绝；
- 生命周期：client 撤销、签名私钥撤销/轮换及 DPoP key 轮换后，旧材料失效且新材料可恢复；
- 泄露：仅取得 bearer 字符串不能在没有匹配 DPoP 私钥时调用资源；日志、报告和身份存储中无 token、私钥、原始联系方式或外部 subject；
- 隔离：已有 provider 配置指纹和 organization/tenant 绑定门继续生效。

## 5. 进入 2C-1 的外部条件

必须先找到一个不产生外部费用、使用合成身份、支持真实 HTTPS 的开发提供方，同时支持：

- PAR；
- `private_key_jwt` client 注册与公钥轮换；
- DPoP 及 DPoP nonce；
- 可验证 audience/scope/sender constraint 的受保护资源；
- client/key 撤销或等价管理员操作。

如果免费测试提供方不能覆盖完整组合，则停在本评估，不通过拼接多个普通 OIDC demo、仅本机 mock 或只做库级单元测试来宣称 FAPI 2.0 完成。创建外部账号、接受新条款、录入付款方式、接触真实机构数据或产生费用，仍需另行授权；本评估没有发生这些行为。

## 6. 下一动作

先对候选提供方做只读能力核验；满足全部条件后再实现 Slice 2C-1。若没有合适的零费用完整提供方，优先继续 Owner 委托凭证和 A2A 互操作等不依赖该外部条件的既定切片，FAPI 2.0 保持 fail-closed，不阻塞整个协作能力建设。
