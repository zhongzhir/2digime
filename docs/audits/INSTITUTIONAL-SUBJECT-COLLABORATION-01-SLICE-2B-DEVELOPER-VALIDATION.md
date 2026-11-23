# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 2B 外部身份源开发者验证

**日期：** 2026-11-23
**结论：** `OWNER_CONTROLLED_AUTH0_OIDC_DEVELOPER_GATE_PASS / SYNTHETIC_IDENTITY_ONLY / NO_REAL_IDENTITY_OR_FEE / NOT_OWNER_ACCEPTED`

## 1. 本轮结果

2digime 通过现有 `openid-client` 适配器真实连接 Duende 官方公开演示 IdentityServer，完成 HTTPS discovery、浏览器登录、授权码、PKCE S256、state、nonce、ID Token/UserInfo 校验和动态本机 loopback 回调。授权事务由一个 `InstitutionFederationService` 实例发起，再由新实例从同一加密事务存储完成回调，证明不是单函数 fixture 回放。

在 Owner 明确授权后，又建立零费用 Auth0 开发租户和独立 Native client。Owner 亲自完成第三方注册、client 创建、回调白名单保存以及合成账号的密码输入；2digime 只使用公开 issuer 与 client ID，以固定 `http://127.0.0.1:43120/callback` 再次完成真实授权码 + PKCE S256 协议闭环。验证器没有读取 client secret 或账号密码，证据只保存 client ID 的 SHA-256 摘要，不保存外部 subject、token 或原始联系方式。

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
- 新增 `identity:oidc:auth0:verify`，从环境变量读取公开 issuer/client ID，以固定回调等待 Owner 在浏览器中手动完成合成身份登录；
- Auth0 验证器在回调后重建服务实例，校验稳定身份、显式绑定和敏感材料不落盘，随后删除临时身份包；
- Auth0 client 按 Native/public client 使用 `token_endpoint_auth_method=none`，不读取页面显示的 client secret，也不把租户专用配置硬编码进产品运行时。
- OIDC 登录事务新增安全相关 provider 指纹，覆盖 issuer、client ID、redirect URI、scopes、client authentication、security profile 与 loopback 许可；显示名变化不影响事务，安全配置变化会使事务一次性拒绝；
- `bindToSubject` 不新增租户 Store，只在机构身份或目标 Subject 声明 organization/tenant 范围时机械要求双方完整且一致。

## 4. 已验证事实

- `npm run build`：通过；
- 身份专项测试：6/6 通过，覆盖 HTTPS issuer、显式 loopback、远端 HTTP 回调拒绝、PKCE profile、事务加密/一次性消费、provider 配置替换、租户隔离、绑定与撤销；
- `npm run smoke`：通过；
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：生产依赖 0 漏洞；本机 npm 镜像不实现 audit endpoint，故显式使用官方只读审计端点，没有安装或升级依赖；
- `npm run identity:oidc:external:verify`：`REAL_EXTERNAL_OIDC_DEVELOPER_GATE_PASS`；
- `npm run identity:oidc:auth0:verify`：`OWNER_CONTROLLED_AUTH0_OIDC_DEVELOPER_GATE_PASS`；
- issuer：`https://demo.duendesoftware.com`；client：`interactive.public`；flow：authorization code；PKCE：S256；client authentication：none；
- Auth0：Owner 控制的开发 tenant 与 Native client；固定 `127.0.0.1:43120` callback；authorization code + PKCE S256；client authentication：none；
- provider 配置指纹专项与事务替换负向门通过：安全相关字段变化会拒绝，adapter 不进入 token 调用；
- 本机标准 OIDC provider 真实签发第二个动态 client 的授权码后撤销该 client，token 交换被 provider 拒绝，身份与绑定数量保持不变；
- 带 organization/tenant 声明的真实本机 OIDC 身份跨租户绑定拒绝，同租户显式绑定通过；
- 回调前后使用不同 `InstitutionFederationService` 实例，稳定身份成功持久化；
- 登录后 binding 初始为空，显式确认后才建立；
- Duende 外部影响：账号创建 false、真实身份 false、付款方式 false、费用 false；Auth0 外部影响：Owner 明确授权创建开发 tenant、Native client 与合成测试账号，真实身份 false、client secret 读取/保存 false、付款方式 false、费用 false。

全仓 `npm test` 本轮没有通过：长跑中原身份测试保持 3/3，但既有软件开发交互、真实模型和 Electron 场景出现多组失败，随后一个 Electron 场景长期无新输出，约十分钟后人工停止。此后新增的配置替换与租户隔离专项使身份测试扩展为 6/6，受影响身份专项、本机撤销门与真实 Auth0 门均通过；因此本记录不宣称全仓回归通过，也不顺带修改无关历史失败。

首次页面自动化因 Duende 当前 ASP.NET 字段名不同而未找到输入框；诊断确认协议请求已正确进入官方登录页，随后只补充 `Input.Username`、`Input.Password`、`Input.Button` 页面兼容，最终闭环通过。失败尝试没有完成登录或回调。

## 5. 明确未完成

- 已验证 Owner 控制 Auth0 client 的创建后使用与 redirect URI 保存，以及本机 provider 的真实 client 撤销和跨租户绑定负向门；尚未破坏性删除外部 Auth0 client，也未验证其恢复流程或机构管理员流程；
- 未接银行、电信、政府或大型平台真实租户，未使用真实身份，不证明实名、KYC、组织归属或机构合规；
- public client 没有服务端 client secret，本轮也没有验证 `private_key_jwt`；
- 未实现 FAPI 2.0 的 PAR、JAR、DPoP/mTLS、sender-constrained token、audience 资源绑定或 token 泄露负向门；
- 未接产品 UI、邮箱/电话找回、Owner 委托凭证、生产密钥管理、安装包或生产部署；
- 未完成 Owner 验收、主干合并或发布。

## 6. 下一门

Slice 2B 的 Owner 控制外部 client 开发门与本机 client 撤销/跨租户负向门已经关闭。下一步进入 Slice 2C 的 FAPI 2.0 高保障通道评估与最小实现。Slice 2C 仍需支持 PAR、强客户端认证和 sender constraint 的提供方，不能用 Auth0 普通 Native client、本机普通 OIDC 或 public demo 门冒充。
