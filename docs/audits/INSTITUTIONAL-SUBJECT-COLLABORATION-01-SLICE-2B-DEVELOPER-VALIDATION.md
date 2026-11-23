# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 2B 外部身份源开发者验证

**日期：** 2026-11-23
**结论：** `PUBLIC_EXTERNAL_PROVIDER_GATE_PASS / OWNER_CONTROLLED_CLIENT_REGISTRATION_PENDING / NO_REAL_IDENTITY_OR_FEE / NOT_OWNER_ACCEPTED`

## 1. 本轮结果

2digime 通过现有 `openid-client` 适配器真实连接 Duende 官方公开演示 IdentityServer，完成 HTTPS discovery、浏览器登录、授权码、PKCE S256、state、nonce、ID Token/UserInfo 校验和动态本机 loopback 回调。授权事务由一个 `InstitutionFederationService` 实例发起，再由新实例从同一加密事务存储完成回调，证明不是单函数 fixture 回放。

外部身份只形成稳定 `issuer + subject` Owner identity；完成登录后 Subject binding 仍为 0，只有开发门中的独立显式确认才建立测试 binding。临时身份包在验证结束后删除，报告不记录 token、原始联系方式、登录名、密码或外部 subject。

## 2. 选择依据与边界

- Duende [公开演示页](https://demo.duendesoftware.com/) 明确把该服务用于 demo，公开 `interactive.public` 的授权码 + PKCE 配置和允许的 OIDC scopes。
- Duende [官方原生客户端样例](https://github.com/DuendeSoftware/foss/blob/main/identity-model-oidc-client/samples/HttpSysConsoleClient/HttpSysConsoleClient/Program.cs) 使用 `interactive.public`、系统浏览器和本机 loopback 回调。
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html) 将外部 user-agent、PKCE 和 loopback redirect 作为原生应用 OAuth 最佳实践。本轮因此把“HTTPS 外部 issuer”与“显式允许的 HTTP loopback 回调”分开校验，没有把整个身份源降级为不安全 HTTP。

本轮使用服务方公开测试身份，不创建外部账号、不接受新条款、不提交真实身份资料、不录入付款方式、不产生费用。`interactive.public` 是服务方预配置的公共 client，不是 2digime 自有注册 client；因此本轮关闭的是外部协议开发门，不宣称完成 Owner 控制的机构 client 注册。

## 3. 实现变化

- `InstitutionIdentityProvider` 新增显式 `allowLoopbackRedirect`；
- issuer 仍必须 HTTPS，只有既有本机开发 provider 可通过 `allowInsecureLoopback` 使用 HTTP；
- 非 HTTPS 回调只有在地址确为 `127.0.0.1`、`localhost` 或 `::1` 且显式允许时通过；普通远端 HTTP 回调继续拒绝；
- 新增 `identity:oidc:external:verify`，用动态端口启动本机回调监听，走真实浏览器与远端 provider，再清理临时身份包；
- demo 登录凭据只从环境变量读取，不写入仓库、报告或身份目录。

## 4. 已验证事实

- `npm run build`：通过；
- 身份专项测试：3/3 通过，覆盖 HTTPS issuer、显式 loopback、远端 HTTP 回调拒绝、PKCE profile、事务加密/一次性消费、绑定与撤销；
- `npm run identity:oidc:external:verify`：`REAL_EXTERNAL_OIDC_DEVELOPER_GATE_PASS`；
- issuer：`https://demo.duendesoftware.com`；client：`interactive.public`；flow：authorization code；PKCE：S256；client authentication：none；
- 回调前后使用不同 `InstitutionFederationService` 实例，稳定身份成功持久化；
- 登录后 binding 初始为空，显式确认后才建立；
- 外部影响：账号创建 false、真实身份 false、付款方式 false、费用 false。

首次页面自动化因 Duende 当前 ASP.NET 字段名不同而未找到输入框；诊断确认协议请求已正确进入官方登录页，随后只补充 `Input.Username`、`Input.Password`、`Input.Button` 页面兼容，最终闭环通过。失败尝试没有完成登录或回调。

## 5. 明确未完成

- 未注册由 2digime/Owner 控制的外部 OIDC client，未验证 client 生命周期、redirect URI 变更、client 撤销或机构管理员流程；
- 未接银行、电信、政府或大型平台真实租户，未使用真实身份，不证明实名、KYC、组织归属或机构合规；
- public client 没有服务端 client secret，本轮也没有验证 `private_key_jwt`；
- 未实现 FAPI 2.0 的 PAR、JAR、DPoP/mTLS、sender-constrained token、audience 资源绑定或 token 泄露负向门；
- 未接产品 UI、邮箱/电话找回、Owner 委托凭证、生产密钥管理、安装包或生产部署；
- 未完成 Owner 验收、主干合并或发布。

## 6. 下一门

Slice 2B 的下一小门是使用 Owner 控制、零费用且不含真实身份数据的开发租户注册独立 client；创建账号、接受第三方条款或使用组织租户必须由 Owner 单独明确授权。完成后才能验证 client 撤销、redirect URI 管理和租户隔离。Slice 2C 的 FAPI 2.0 高保障通道仍需支持 PAR、强客户端认证和 sender constraint 的提供方，不能用本次 public demo 门冒充。
