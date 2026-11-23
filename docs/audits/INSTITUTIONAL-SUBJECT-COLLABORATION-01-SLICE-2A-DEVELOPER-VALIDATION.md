# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 2A 开发者验证

**日期：** 2026-11-23
**结论：** `IMPLEMENTED / REAL_LOCAL_OIDC_DEVELOPER_GATE_PASS / EXTERNAL_PROVIDER_AND_FAPI_PENDING / NOT_OWNER_ACCEPTED`

## 1. 本轮结果

本轮建立了真实机构身份联邦的最小安全地基，但没有接入真实银行、电信或其他外部机构租户。实现使用成熟 OIDC 客户端完成 discovery、浏览器授权码、PKCE S256、state、nonce、ID Token 与可选 UserInfo 校验；以 `issuer + subject` 作为稳定 Owner identity。邮箱和电话只作为带验证状态的脱敏联系提示，不作为稳定身份键，也不保存原值。

机构登录只形成 Owner identity，不会自动获得 Digital Subject 权限。Owner identity 到 Subject 的绑定需要独立确认引用，可单独撤销；身份撤销会级联撤销绑定，再次登录只更新验证事实，不会静默恢复已撤销身份。

## 2. Build-vs-Integrate 与能力充分性

- 基础模型不能替代协议级签名、issuer/audience/nonce/state/PKCE 校验、重放防护和加密存储，因此身份安全机械门必须由确定性代码承担。
- OIDC 客户端集成 `openid-client 6.9.1`，不自研 OIDC/OAuth 协议栈。
- 真实开发门使用独立的 `oidc-provider 9.15.1` 作为仅开发依赖，实际启动 HTTP provider、浏览器授权交互和回调，不用 fixture 冒充协议闭环。
- fixture 只用于负向边界与存储单元测试；语义路由、第二套身份状态机和新产品 UI 均未增加。

## 3. 已验证事实

### 编译与专项测试

- `npm run build`：通过。
- `node --test --test-concurrency=1 --test-reporter=spec "dist/identity/tests/*.test.js"`：3/3 通过。
- 身份专项加 Personal Context、签名卡、端点轮换、Relay 恢复和远程通信定向回归：22/22 通过。
- 覆盖 HTTPS/loopback 门、`openid` scope、FAPI 2.0 未实现拒绝、事务密文、一次性回调、显式绑定、撤销级联、撤销后不得因重新登录恢复，以及原始邮箱不落盘。

### 真实本机 OIDC 开发门

- `npm run identity:oidc:verify`：`REAL_OIDC_DEVELOPER_GATE_PASS`。
- provider：`oidc-provider 9.15.1`，独立监听 `http://127.0.0.1:18080`。
- flow：`authorization_code`；PKCE：`S256`；client authentication：`client_secret_basic`。
- 实际浏览器完成授权与回调；ID Token 得到稳定 `issuer + subject`；最初没有 Subject binding，只有显式确认后才建立绑定。
- 身份目录扫描未发现 client secret、测试密码、access token、refresh token 或原始联系方式。

开发 provider 的内存 adapter、临时 signing key 和开发交互均只用于本机门，不能用于产品或生产。

## 4. 回归事实与未关闭问题

选择的 Personal Context、签名卡、远程通信与协作回归中，大部分通过，但以下两项独立重跑仍失败：

1. `REAL-SUBJECT-COLLAB-02 CASE A`：A 未物化 B 的成果；
2. `CASE1+CASE3`：期望 `delivered`，实际 `failed`。

两项落盘事件均记录 `artifact committer not attached; open or create a package first`。本 Slice 没有修改 collaboration、runtime 或 artifact committer 代码；因此它被记录为既有协作运行时回归，不能用身份专项和 OIDC 通过掩盖，也不能写成全回归通过。后续应另立修复批次，对原始失败用例端到端复验。

生产依赖的官方 `npm audit --omit=dev --audit-level=high` 还报告 4 个既有依赖公告：`proxy-addr` 1 个 critical、`body-parser` 1 个 high、`qs` 1 个 moderate，以及 `fast-xml-parser` 1 个 low。报告路径没有指向本轮新增的 `openid-client`，但仓库整体安全门仍未通过。为避免无边界批量升级，本轮没有执行 `npm audit fix`；应另作最小依赖升级并完整复验后，才能进入产品或生产验收。

## 5. 明确未完成

- 未接外部机构租户、真实机构身份源或真实身份数据；
- 未创建外部账号、接受第三方条款或产生费用；
- 未实现 FAPI 2.0 的 PAR、`private_key_jwt`、DPoP/mTLS、sender-constrained token；
- 未建立真实实名、KYC、银行/电信业务授权或数字人民币接口；
- 未接产品 UI、邮箱/电话恢复流程、Owner 委托凭证或 A2A 标准互操作；
- 未 Owner 验收、合并主干、推送、打包、发布或部署。
- 生产依赖安全审计尚未清零。

## 6. 下一门

Slice 2B 应在 Owner 单独确认外部账号和条款后，选择一个无费用、无真实身份数据的外部开发/沙箱身份源注册 OIDC client，复用本轮适配器完成跨进程、跨服务的协议门。高价值机构服务进入 Slice 2C，只有支持 FAPI 2.0 所需的 PAR、强客户端认证和 sender constraint 后才可宣称高保障通道。
