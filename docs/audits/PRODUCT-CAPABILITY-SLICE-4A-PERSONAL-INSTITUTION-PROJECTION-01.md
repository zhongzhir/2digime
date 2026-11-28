# PRODUCT-CAPABILITY-SLICE-4A-PERSONAL-INSTITUTION-PROJECTION-01

**日期：** 2026-11-28  
**结论：** `SLICE_4A_PERSONAL_INSTITUTION_PROJECTION_DEVELOPER_VALIDATED`

## 本批范围

本批只关闭个人客户端的一条可感知主链：用户在“数字之我”右侧查看已连接机构、沙箱验证级别、权益、可用服务、授权范围、有效期、最小计量边界，并可撤销本机机构连接。

没有新增一级入口、机构专用 Talk、账户 Store、授权 Store 或第二事实源。页面读取现有 `institution-mode.json` 的连接事实，并从既有 Institution Backend 读取由 Organization、InstitutionUser 与 Entitlement 派生的摘要。

## 实现事实

- Institution Backend 新增只读 `/v0/client/overview` 投影；不返回 virtual key、provider master key、prompt、response、Digital Self、文件或记忆；
- 沙箱账号明确显示“非真实身份认证”，不把 mock assertion 冒充实名或机构生产 SSO；
- 可用机构 AI 服务只进入同一个 Talk，不建立机构专用聊天内核；
- “撤销机构连接”复用既有 `disconnectInstitution`，只清除本机机构模式和受限凭据，不删除机构侧用户映射或权益；
- 权益摘要刷新失败时保留“本机已记录连接”的真实边界，不把读取失败解释成未连接或已失效。

## 验证

1. `npm run build`：通过。
2. `node --test dist/identity/tests/institution-client-overview-slice4a.test.js`：2/2 通过。
3. `node --test dist/subject-core/tests/digital-self-institution-projection-slice4a.electron.test.js`：1/1 通过。正式 Electron 显示合成机构权益与隐私边界；renderer 未出现测试 virtual key；撤销后本机模式文件删除，机构侧测试用户仍存在。
4. Slice 3A 正式 Electron 回归：1/1 通过。
5. renderer/main/adapter/backend 语法检查与 `git diff --check`：通过。

## 未覆盖与停止边界

- 不是伙伴沙箱控制台、真实 OIDC/FAPI 2.0、真实银行/电信接入或真实身份认证；
- 尚未实现测试用户、权益、服务 Subject、A2A endpoint、授权策略、审计和停用的伙伴控制台；
- 尚未完成“电信权益发放”“银行服务协作”两条合成旅程；
- 尚未输出最终合作架构图、接口清单、安全边界、试点范围和验收清单；
- 未打包、push、发布或部署。

