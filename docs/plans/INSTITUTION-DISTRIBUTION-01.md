# INSTITUTION-DISTRIBUTION-01

日期：2026-09-11  
状态：PLANNED  
前置：`PUBLIC_ALPHA_WINDOWS_INSTALL_RELEASED`

## 1. 定位

Institution Distribution 是 2digime 面向银行、电信运营商、手机厂商、大型平台等机构的 B2B2C 分发与运营层。

它不是新的 2digime Core，也不是行业专用 Agent。

目标是让机构可以：

- 将 2digime 作为自有品牌 AI 产品提供给现有用户；
- 分发自有或采购的大模型 / AI 权益；
- 管理用户、额度、用量和结算；
- 与现有会员、CRM、计费、身份系统对接；
- 保持 2digime 开源、可迁移、可互联。

## 2. 核心边界

机构可以管理：

- 用户身份映射
- 套餐 / 权益
- AI quota / token / 次数 / 金额
- 模型池
- 成本与用量统计
- 机构系统接口
- 品牌配置

机构默认不能读取：

- 用户 Digital Self 内容
- 私人 Talk
- 私人文件
- 长期记忆
- 用户自己的主体资产

机构拥有客户与权益关系，不拥有用户数字主体。

## 3. v0.1 最小闭环

仅证明：

> 一个虚拟机构 → 创建两个用户 → 发放不同 AI 权益 → 同一 2digime Core 的白标客户端 → 用户正常 Talk → 用量分别归集 → 用户主体数据不进入机构后台

建议验证对象：

`Demo Telecom`

不是因为最终只服务电信，而是运营商天然具备：

- 用户身份
- 套餐
- 权益
- 计费
- 大规模分发

## 4. v0.1 最小模块

### A. Organization

- organization id
- organization name
- status
- brand config reference
- integration config reference

### B. User Mapping

- institution user id
- 2digime local subject / account mapping
- active / suspended
- entitlement group

### C. AI Entitlement

支持表达：

- provider
- model / capability
- quota type
- quota amount
- used amount
- valid from / to

不得把产品绑定在单一模型厂商。

### D. Usage Accounting

机构侧只归集必要计量：

- user id
- capability / provider
- usage
- cost / quota consumption
- timestamp

默认不上传 prompt / response 正文。

### E. Brand Kit

最小配置：

- product name
- logo
- app icon
- organization name
- support url / text
- theme token
- optional default provider

必须由配置生成，不 fork Core。

### F. Institution Adapter

预留但不假装完成真实银行 / 电信接口：

- SSO
- user provisioning
- entitlement grant / revoke
- usage callback
- billing / CRM sync

v0.1 使用通用 API contract + demo adapter。

## 5. Build-vs-Integrate Gate

优先使用成熟能力：

- 身份：OIDC / OAuth / SAML（真实机构接入时）
- API：现有 HTTP stack
- 统计：现有数据库 / telemetry 能力
- 配置：现有 config / packaging
- 白标：electron-builder 现有 build-time config
- 权限：复用 2digime 现有授权边界

禁止自研：

- 身份协议
- 支付系统
- 大模型网关协议
- 新的 Agent Runtime
- 新的 Digital Self

## 6. 开源与兼容

Core 继续开源。

任何机构可：

- 自行部署
- 修改品牌
- 接自己的模型
- 接自己的后台

官方兼容标识要求：

- 保持用户数据主权
- 支持开放互联协议
- 不伪装 / 冒充用户
- 支持撤销与必要审计

“不兼容官方网络”不等于禁止 fork。

## 7. 用户体验

普通用户应感知：

- 这是机构提供给我的 AI 产品
- 不需要自己申请 API Key
- 权益自动到账
- 可以直接使用 AI
- 我的数字之我仍属于我

普通用户不应感知：

- tenant id
- provider pool
- token accounting internals
- billing adapter
- institution API

## 8. 验收

至少验证：

1. 一个机构创建成功；
2. 两个用户存在独立映射；
3. 两个用户拥有不同额度；
4. 白标客户端显示机构品牌；
5. 两个用户真实 Talk；
6. 用量分别归集；
7. 一个用户额度耗尽时只影响自己；
8. Digital Self / Talk 正文未进入机构 usage store；
9. Core 没有机构专用 fork；
10. 同一 Core 可换另一套 brand config。

目标：

`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`

## 9. 后续但不在 v0.1

- 真实中国电信接口
- 真实招商银行接口
- 多机构 SaaS 控制台
- 复杂结算
- 企业级审计报表
- 合规认证
- 大规模租户隔离
- 自动合同 / 商务系统

先证明产品和架构，再进入真实机构对接。
