# PRODUCT-CAPABILITY-SLICE-4B-PARTNER-SANDBOX-CONTROL-01

**日期：** 2026-11-28  
**结论：** `SLICE_4B_PARTNER_SANDBOX_CONTROL_PLANE_DEVELOPER_VALIDATED`

## 本批范围

本批在既有 Institution Backend 和同一机构 Store 上增加本机伙伴沙箱控制台。伙伴可用合成数据创建机构、两个测试用户、权益和服务 Subject，配置 A2A endpoint、Agent Card URL 与授权策略，查看最小审计并停用资源。

没有建立第二个 Institution Backend、Relay 分支、机构专用 Talk、模型网关、计费引擎或多租户运营平台。

## 安全与数据边界

- 新管理 API 必须配置 `INSTITUTION_ADMIN_TOKEN`，无令牌或错误令牌均拒绝；服务仍只监听 `127.0.0.1`；
- 管理令牌只保存在控制台当前浏览器会话，不写入机构 Store；
- 管理视图不返回 virtual key、provider master key 或其它凭据；
- Store 继续机械拒绝 prompt、response、Digital Self、私人文件成果和长期记忆；
- 最小审计只包含操作者、动作、资源类型/标识、时间和结果；
- 组织停用只级联账号和服务可用性，不删除个人 Digital Self、Talk 或本地成果；
- 所有样本均为合成机构与测试用户，不冒充真实银行、电信、SSO、KYC 或生产接入。

## 验证

1. `npm run build`：通过。
2. 全部 identity 聚焦回归：16/16 通过，覆盖机构 OIDC 事务、绑定范围、撤销和 VC 委托。
3. 伙伴管理领域专项：3/3 通过，覆盖 1 机构/2 用户/1 服务、凭据不投影、级联停用、非法 ID 与非 HTTP endpoint 拒绝。
4. `node institution/partner-sandbox/run-verify.cjs`：通过。
   - 1 个机构、2 个测试用户、1 个服务；
   - 5 条最小审计；
   - 未授权管理请求拒绝；
   - 管理视图私人字段扫描通过；
   - 服务停用生效。
5. 控制台合同与内联脚本语法检查：通过；`git diff --check`：通过。

## 未覆盖

- 本批尚未把沙箱用户实际登录接入 Electron，也未完成 Talk 能力调用；
- 尚未用注册的服务 Subject 完成 A2A 协作与撤销；
- 尚未完成“电信权益发放”和“银行服务协作”两条端到端合成旅程；
- 尚未输出最终 OpenAPI/事件合同、架构图、安全边界、试点范围和验收清单；
- 未打包、push、发布或部署。

