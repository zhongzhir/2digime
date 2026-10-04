# DISCOVER 来源扩大与行为推荐闭环（第 2 批）

**日期：** 2026-10-04  
**工作区：** `build/discover-personal-feed-01`  
**未：** 改额度、打包、部署、push、发布  
**达性口径：** 下表「本机外网」只表示本机探测 HTTP 结果。**不得写成国内已验证。**

## 1. 先查再接

复用已有：托管搜索、`ingestSource` RSS/Atom、`OPEN_SOURCE_CATALOG`、Commons / Archive / iTunes、原站入口。未新建搜索引擎、未硬塞类型名额、未加固定示例卡。

### 本轮新增（本机探测为真实 RSS 后才接入）

| 来源 | 内容类型 | 获取方式 | 本机外网 | 国内已验证 | 更新情况（本机） |
|---|---|---|---|---|---|
| 中新网即时新闻 RSS | 新闻文章 | `media_rss` | 200 / RSS | 否 | 2026-10-04 有即时条目 |
| 少数派 Feed | 科技/文化文章 | `media_rss` | 200 / RSS | 否 | 本机可达 |
| 36氪 Feed | 科技文章 | `media_rss` | 200 / RSS | 否 | 本机可达 |
| 机核 RSS | 文化文章 | `media_rss` | 200 / RSS | 否 | 本机可达 |
| 豆瓣书评 RSS | 文化 | `media_rss` | 200 / RSS | 否 | 本机可达 |
| 豆瓣影评 RSS | 影视评论（不是正片文件） | `media_rss` | 200 / RSS | 否 | 本机可达 |
| 豆瓣乐评 RSS | 文化/音频相关评论 | `media_rss` | 200 / RSS | 否 | 本机可达 |

### 已有、继续复用

| 来源 | 内容类型 | 获取方式 | 本机外网 | 国内已验证 |
|---|---|---|---|---|
| IT之家 RSS | 科技文章 | `media_rss` | 200 / RSS | 否 |
| Solidot RSS | 科技文章 | `media_rss` | 200 / RSS | 否 |
| Wikimedia Commons | 图片/视频/音频 | 官方 API | 沿用已有能力 | 否 |
| Internet Archive | 音频/视频、含影视节目文件入口 | 官方 API | 沿用已有能力 | 否 |
| iTunes Podcast 搜索 | 音频节目 | 官方 API | 沿用已有能力 | 否 |
| iTunes 中国区热门播客 | 音频节目 | `itunes_rss` JSON | 200 / JSON | 否 |

### 探测后不接入

| 候选 | 原因 |
|---|---|
| 新华社若干 XML | 本机 404 |
| 央视 RSS | 403 / 404 |
| 澎湃 `rss.jsp` | 200 但是 HTML |
| 人民网时政 RSS | 本机 200，但此前因条目停更被移出；本轮不回加 |
| 游研社 / 电影网 / 时光网 / RSSHub | HTML、409、403 或声明勿作生产源 |
| 小宇宙 / 机核电台 / 荔枝 / 喜马拉雅 猜测地址 | 404 / 403 / 空响应 |

影视**节目文件**仍走 Archive / Commons 与原站入口；豆瓣影评补的是影视主题文章，不是正片托管。

## 2. 默认供给为何曾被单一类型占满

具体原因，不是缺类型名额：

1. 默认中文 RSS 原先只有 IT之家、Solidot 两类科技文章。
2. Commons / Archive / iTunes 入库时 `provenance.via = 'search'`。
3. `candidatesForDefault` 只要存在任何非 search 条目，就丢掉全部 search 条目。
4. 于是目录媒体进不了默认池；`diverseFeedCandidates` 只按来源轮转，同一出版社的不同文章不会被裁掉，IT之家可以铺满 24 条。

本轮：默认目录媒体改为 `via: 'feed'`；用户搜索仍是 `via: 'search'`，不进默认流。图片/音视频不再按 21 天新闻时效丢掉。个性化排序失败时继续展示已取到的可用卡片。没有固定示例，没有类型配额。

## 3. 反馈事实（先报，再补）

| 行为 | 记录 | 持久化 | 进入搜索方向 | 进入排序/展示 |
|---|---|---|---|---|
| 打开 | `network-content-feedback.jsonl` + recent `opened` | recent 14 天 | **否**（默认意图不再用打开当方向） | 去优先，不写偏好；打开 ≠ 喜欢 |
| 稍后看 | feedback + `later-items.json` | 收藏列表 | **否** | **否** |
| 多推荐 | feedback + preference `boost` | `content-preferences.json` | 是 | 是；原卡机械去优先，要求相近新条目，不只重复这一条 |
| 不喜欢 | feedback + preference `reduce` | 同上 | 是 | 该条移到后面；`blocked()` 只认 block，单条不喜欢不封主题 |
| 屏蔽来源 | feedback + preference `block` | 同上 | 是 | 按 `publisherSubjectId` 过滤；重启后仍在 |

缺口（已补）：`seek_topic` 曾被写成「最近想看」并进入默认 `proposeDiscoveryIntents`。现默认意图不再带一次性检索；排序备注仍标明「一次性检索，不是长期兴趣」。

## 4. 隔离对照

隔离副本：`D:\Projects\_dm-audit-data\discover-source-feedback-02\isolated`  
源副本：`D:\Projects\_dm-audit-data\discover-actual-failure-audit-01\owner-copy`  
未写真实 AppData，未改 owner-copy。报告：`D:\Projects\_dm-audit-data\discover-source-feedback-02\report.json`。

同一份副本上的默认候选池：

| | 条目 | 出版社 | 形态 |
|---|---|---|---|
| 旧代码（search 排除 + 作品当过期新闻） | 424 | 31 | 文章 415 / 音频 9 |
| 本轮之后 | 621 | 37 | 文章 468 / 音频 141 / 图片 8 / 视频 4 |

新增 RSS 本机均摄入成功（每源最多 8 条）。目录媒体 `listOpenCatalog` 收下 12 条。

首页 12 张在这次对照里仍全是文章，但主题已铺开：中新网、IT之家、豆瓣影评/乐评/书评、机核、少数派、Solidot、36氪 等。形态变丰富发生在候选池，不是靠名额把图片硬塞进第一屏。

反馈对照：

- 打开 / 稍后看：副本里原先无 `content-preferences.json`；稍后看列表仍在，不升格为喜欢。
- 多推荐：原卡「核聚变周六联票」未独占刷新后的列表，出现了其它条目。
- 不喜欢：指令已持久化；大池子里该条被移到后面，第一屏不一定还能看见，同来源其它条没有被整主题清掉。
- 屏蔽来源：新华网时政被屏蔽后，刷新与再跑默认流都不再出现；重启重读偏好后仍生效。
