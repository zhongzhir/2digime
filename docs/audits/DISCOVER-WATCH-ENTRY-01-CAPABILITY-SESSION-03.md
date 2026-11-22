# DISCOVER-WATCH-ENTRY-01 — Tavily 零费用能力验证 03

**日期：** 2026-11-22  
**结论：** `ZERO_COST_PROVIDER_BENCHMARK_FAILED / OWNER_ACCEPTED_LIMITED / KEY_REVOKED / CLOSED / NOT_RELEASED`

## 1. 授权与费用边界

Owner 授权沿推荐路线继续，但明确不授权任何外部费用。本次只使用 Tavily Researcher 免费计划：

- 未录入付款方式；
- Pay As You Go 保持关闭；
- 免费 plan credits 耗尽时由供应商拒绝请求，不发生超额计费；
- 本次共消耗 36 个免费 plan credits：Basic 20，Advanced 16；未产生外部费用。

## 2. 凭据处置

首次创建的 `2digime-relay` key 在创建成功界面被浏览器自动化可访问树回显，因此按泄露处理并立即撤销。随后创建 `2digime-relay-v2`：

- 不在对话、终端、日志、证据或 Git 中输出明文；
- 只通过浏览器隔离剪贴板和工作树内专用临时文件传递给一次性 benchmark 进程；
- 每次进程结束均删除临时文件并清除进程环境变量；
- 未写入 Relay，未部署到服务器。

## 3. 独立 provider benchmark

脚本：`scripts/discover-watch-entry-tavily-provider-benchmark.cjs`

固定样本：`scripts/fixtures/discover-watch-entry-01.json`，与现有开发者门一致，共 12 个具名请求和 8 个开放推荐请求。请求保持原始用户表达，不增加 `site:`、站点白名单或查询改写。

### Basic 全量

证据目录：`build/evidence/discover-watch-entry-tavily-basic-20261122T090548Z`。早期运行目录实际名称缺少 `basic` 字段，为 `build/evidence/discover-watch-entry-tavily-20261122T090548Z`；summary 内 `searchDepth=basic` 可核对。

| 指标 | 结果 |
|---|---:|
| 完成请求 | 20/20 |
| 免费 credits | 20 |
| 10 秒内终态 | 20/20 |
| 自动初筛疑似入口 | 5/20 |
| 具名疑似覆盖 | 3/12（25%） |
| 开放疑似覆盖 | 2/8（25%） |

### Advanced 缺口探针

证据目录：`build/evidence/discover-watch-entry-tavily-advanced-20261122T090811Z`。

只复测现有主链缺口：`named_01/06/07/09` 与 `open_01/03/05/07`。

| 指标 | 结果 |
|---|---:|
| 完成请求 | 8/8 |
| 免费 credits | 16 |
| 10 秒内终态 | 8/8 |
| 自动初筛疑似入口 | 3/8 |
| 具名疑似覆盖 | 1/4（25%） |
| 开放疑似覆盖 | 2/4（50%） |

## 4. 人工复核

自动初筛不是验收结论。逐条打开结果语义复核后：

- `named_01` 是 B 站同名 AI 二创“一口气看结局”，不能作为原短剧正式观看入口；
- `open_01` 是爱奇艺微短剧泛频道，没有交付具体推荐作品；
- `open_03` 包含 B 站盘点文章和爱奇艺纪录片泛频道，均不是“具体作品 + 实际入口”；
- Basic 中《沉默的荣耀》疑似命中为新闻资讯，不是观看入口；
- Basic 中《哪吒之魔童闹海》平台页真实，但现有主链已经交付腾讯、爱奇艺、B 站等多条已读取入口，不构成缺口净增。

人工确认的有效净增为 0。Tavily 在本次样本上提供了较低延迟，但没有证明能补足中文影视的具体作品入口。

## 5. 裁决

不写 Tavily production adapter，不把它加入 Relay failover，不部署、不打包、不安排 Owner 复验。继续使用同一供应商、更多查询改写、站点偏好或提示词补丁都会违反本任务停止条件与 02 Red。

后续必须由 Owner 重新选择产品路线：

1. 接受当前公开搜索能力边界；或
2. 单独授权逐平台登录态 Computer Use / 官方连接器评估；或
3. 单独授权具有付费容量和质量保障的成熟搜索能力。

在新选择前，本任务保持 `DEVELOPER_GATE_FAILED / RED_STOP / NOT_RELEASED`。

## 6. Owner 最终处置

2026-11-22，Owner 决定停止继续尝试其他搜索能力，并接受当前公开内容生态边界。Tavily 专用 `2digime-relay-v2` key 已在供应商控制台删除；控制台确认删除成功，仅保留与本任务无关的既有 `default` key。本任务没有 adapter、Relay Secret、部署或外部费用遗留。

现有通用页面读取、对象/依据分离和公开入口事实能力随本轮代码收束进入主干；直接观看/试看覆盖没有通过原开发者门，不能扩大为已完成能力。
