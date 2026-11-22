# DISCOVER-WATCH-ENTRY-01 — 零费用能力路线审计 02

**日期：** 2026-11-22  
**结论：** `ZERO_COST_ROUTE_SELECTED / EXTERNAL_ACCOUNT_AUTH_REQUIRED / NO_DEPLOY / NOT_RELEASED`

## 1. 授权边界

Owner 授权按推荐的“增强 Relay 成熟搜索能力”路线继续，但不授权任何外部费用。因此本轮未购买、充值、绑定付款方式、开启超额计费、创建外部账户、创建 API key 或部署 Relay。

## 2. Relay 现场

通过现有阿里云 OAuth 与 Cloud Assistant 做了只读核查：

- `digitalme-relay.service` 为 `active/running`，工作目录 `/opt/digitalme-v2`；
- 已配置 `WEB_DISCOVERY_PROVIDER` 与服务端 IQS key；
- 未显式配置 `WEB_DISCOVERY_IQS_ENGINE_TYPE`，按现行代码使用 `CNAuto`；
- 未配置 `GEMINI_API_KEY` 或 Gemini Search model；
- 本机 `/health` 返回 `webDiscovery:true`、`managedAi:true`。

未输出或复制任何 Secret。IQS `GetIqsUsage` 对当前 OAuth 身份没有返回可用明细，因此不能用该接口证明剩余额度。

## 3. IQS 零费用引擎比较

在既有“免费额度耗尽即停”边界下执行 8 次小样本：4 个开放影视请求分别调用 `CNAuto` 与 `CNLiteBasic`。两种引擎均返回 HTTP 200；没有启用增强摘要或 Advanced 增值包。

结果：

- 热门短剧：两者主要返回榜单、聚合或资讯；未形成可靠官方入口；
- 家庭自然纪录片：`CNAuto` 出现 1 个爱奇艺单集入口，`CNLiteBasic` 仍以目录与文章为主；
- 悬疑剧：两者均主要返回榜单与新闻；
- 轻松喜剧：`CNAuto` 出现优酷预告，`CNLiteBasic` 主要为新闻和猫眼材料。

结论：`CNLiteBasic` 不是 `CNAuto` 的有效质量补强；继续做同供应商双引擎回退不能解决开放推荐入口覆盖问题。

## 4. 零费用成熟供应商审计

| 候选 | 当前事实 | 裁决 |
|---|---|---|
| Gemini Google Search Grounding | Gemini 3+ API 免费层不可用；付费层提供月度免费搜索量但超额计费 | 不符合“无外部费用”硬边界 |
| Google Custom Search JSON API | 已停止接纳新客户，并计划 2027-01-01 关闭现有服务 | 不采用 |
| Brave Search API | 无独立免费计划；激活计划必须绑定信用卡 | 不采用 |
| Exa Starter | 每月免费 credits、无需付款方式，但更偏语义/Agent 搜索；中文影视入口质量未知 | 保留为后备，不同时开户 |
| Tavily Researcher | 每月 1,000 免费 credits、无需信用卡；额度耗尽后停止；Basic Search 每次 1 credit | **推荐进入能力验证** |

## 5. 下一动作与停止条件

需要 Owner 单独授权创建免费 Tavily 账户，因为该动作会把指定邮箱提供给外部服务并创建长期凭据。授权后：

1. 只选 Researcher 免费计划；不录入付款方式，不启用 Pay As You Go。
2. API key 只存 Relay 服务端 Secret；不进客户端、证据、日志或 Git。
3. 先用既有 12 个具名 + 8 个开放样本跑 provider 独立 benchmark；不过门不写生产 adapter。
4. 若独立能力过门，再接入既有 provider-agnostic failover，保持 Search 只供候选、模型与 Digital Self 做最终选择。
5. 若 Tavily 仍不能达到入口覆盖与 30 秒门，停止本路线；不再增加搜索供应商、站点规则或提示词补丁。

当前未打包、未安装、未安排 Owner 复验、未提交、未 push、未合并、未发布。
