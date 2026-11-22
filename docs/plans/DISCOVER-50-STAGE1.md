# DISCOVER-50-STAGE1 — 发现系统第一阶段升级

**状态：** `OWNER_LIMITED_ACCEPTED / DIRECT_WATCH_ENTRY_PENDING / NOT_RELEASED`

**日期：** 2026-11-22

**目标：** 对标抖音、小红书、B站公开可核验推荐底座约 50% 的能力，先让个人体验达到「能发现、能推荐、一直有」。

**产品边界：** 这是 Digital Subject Network 上的分布式个人选择，不是中心 Feed 平台；内容服务供候选，Digital Self 在本机做最终选择。

**2026-11-11 Owner 试用覆盖：** 原技术门未覆盖主模型不原生支持 Responses 时的显式发现、真实滚动补量的等待方式和第一响应终态，因此不能继续作为验收候选。当前修复与复验见 `docs/audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-07.md`。

**2026-11-22 Owner 限定验收：** 新独立安装构建已由 Owner 体验。信息关联度与无关内容控制已有可感知提升，本轮修改接收；但推荐卡仍主要指向新闻、百科、榜单或推荐依据，尚不能稳定交付直接观看、试看/预告或明确的平台观看入口。平台登录、付费、地区和 App 跳转可能影响可达性，但不得因此把报道冒充观看入口。详细记录见 `docs/audits/DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-08.md`；下一任务见 `docs/plans/DISCOVER-WATCH-ENTRY-01.md`。

---

## 1. 先把历史结论说准确

| 阶段 | 真正完成 | 当时没有完成 |
|---|---|---|
| 2026-09-08 Distributed Personal Selection | 同一 Relay 候选池上，不同 Digital Self 能选出不同内容；选择权不在 Relay | 来源规模、持续供给、成熟 Feed 体验 |
| 2026-09-14 内容分发最小闭环 | RSS/开放内容 → `NetworkItem` → 选择 → 展示 → 显式反馈 → 下一轮选择 | 来源运营、来源健康、后台调度、无限流、质量基准 |
| 2026-09-18～10-04 Personal Feed / Quality 01–09 | 本地先开屏、目录补量、联网搜索、推荐调整、卡片去重与 12→24 条连续加载 | 24 条之外的供给；真实来源组合；跨代异步正确性；稳定时延 |
| 2026-10-09～11 Unified Capability | 显式新闻/网页请求可由 Responses 自主搜索、读正文、交付结构化卡片；一次真实请求得到 10 张文章卡 | 默认个人流未重写；视频/P95/Digital Self 整体验收；持续供给 |

过去的验收都是真实的局部工程结论，但被错误地靠近了“成熟发现产品”的表述。尤其 12→24 条只证明缓存里还有下一页，不等于一直刷一直有。

证据入口：

- `docs/audits/CONTENT-DISTRIBUTION-FINAL-CLOSURE-01.md`
- `docs/audits/CONTENT-SOURCE-CAPABILITY-GATE-01.md`
- `docs/audits/DISCOVER-PERSONAL-FEED-01-AUDIT.md`
- `docs/audits/DISCOVER-PERSONAL-FEED-01-ACCEPTANCE.md`
- `docs/audits/DISCOVER-QUALITY-09.md`
- `docs/reviews/使用反馈-5.md`
- `review/unified-capability-01/CLOSEOUT.md`

## 2. 现在为什么会“单薄、有限、刷不动”

### 2.1 供给不是来源系统

当前开放目录约 17 个硬编码端点，混合 RSS、开放目录和少量媒体 API。系统没有可持久的来源注册、健康度、最近成功、内容产量、类型覆盖、失败退避和来源发现证据，因此只能“每次再试几个 URL”，不能建立优质来源组合。

### 2.2 推荐不是多级流水线

`personal-feed.ts` 约 1760 行，把开屏、缓存、抓取、检索、候选窗、模型选择、分页和降级混在一个函数。候选先被机械截成 24 条，再以 8 条一批串行交给模型；不同批次没有全局比较。这既限制质量，也放大时延。

### 2.3 “一直有”实际上只有一次余量

缓存虽然保存 `rankedIds`，但主排序窗最多 24 条。下一页耗尽后才重新进入原单体流程；没有 60+ 条蓄水池、低水位补量、来源游标、后台刷新或供给失败预算。

### 2.4 已有 Red 信号

- 同类问题经历 Personal Feed、Quality 01–09、Unified Capability 多轮仍重复出现。
- 基线已有跨代异步结果污染：旧请求可能进入新一代搜索/媒体结果。
- 再在原函数追加来源、状态和分支会违反 02 的 Red 处理规则。

裁定：停止以补丁扩大旧单体；保留已验证接入件，抽出新的来源组合、候选蓄水池、选择与会话分页边界。

## 3. “市场一流 50%”的可执行定义

不按用户量、内容库存或模型参数宣称 50%。第一阶段以公开可核验的共同能力族计数：12 个能力族中至少 6 个达到本计划定义的 `PASS`，且三个 P0 用户门不得失败。

| 能力族 | 一流系统共同做法 | 第一阶段 |
|---|---|---|
| 1. 多路召回 | 关注/兴趣/热门/搜索/相似/探索等候选通道 | **P0 PASS**：开放源、用户源、目录、搜索、探索至少 4 路进入统一候选 |
| 2. 来源与创作者生态 | 新内容/新作者冷启动，来源质量与供给维护 | **P0 PASS**：可持久来源组合、健康/产量/类型证据、失败退避 |
| 3. 内容理解 | 文本、多模态、主题、质量与安全理解 | P1 PARTIAL：复用成熟模型/供应商，不自研模型 |
| 4. 个性选择 | 用户长期特征 + 当前行为/意图 + 候选 | **P0 PASS**：Digital Self + 本次要求 + 显式控制 + 短期上下文 |
| 5. 多阶段排序 | candidate generation → scoring → reranking | **P0 PASS**：供给/蓄水池 → AI 选择 → 机械去重/多样重排 |
| 6. 多目标与多样性 | 相关性、质量、新鲜、探索、生态平衡 | **P0 PASS**：模型判断用户价值；系统只做去重、来源轮转、安全/授权 |
| 7. 实时反馈 | 行为快速影响后续推荐 | P1：本轮明确调整即时生效；不把点击/停留偷写长期偏好 |
| 8. 冷启动 | 首次兴趣、热门/探索、内容侧理解 | **P0 PASS**：无 Digital Self 也有可用混合流；有 Self 则立即分化 |
| 9. 连续会话 | 分页、低水位预取、已看抑制、源游标 | **P0 PASS**：至少连续 5 页/60 条，低水位自动补量 |
| 10. 质量与安全 | 低质/重复/违规/不可消费过滤 | P1：复用来源事实、规范 URL、具体内容门与安全能力 |
| 11. 用户控制与解释 | 不感兴趣、屏蔽、更多/更少、为何推荐、重置 | P1：现有显式控制保留并补可解释入口 |
| 12. 可靠性与观测 | 实时特征、降级、链路指标、实验 | **P0 PASS**：供给/去重/选择/分页 trace；跨代结果 0 污染 |

抖音公开算法备案与 TikTok 说明共同展示了行为/内容信号、排序、多样化、探索和用户控制；小红书公开备案与招聘信息展示多路召回、粗排/精排/重排、冷启动和多模态；B站公开算法说明、备案和工程文章展示候选池、排序、去重多样、实时特征与降级。Google 推荐系统教材把工业推荐通用地拆成 candidate generation、scoring、reranking。兔机米采用这些系统边界，但拒绝中心画像和停留时长目标。

## 4. 新系统边界

```text
开放标准 / 官方 API / 用户订阅 / Search / Relay / Content Service
                              │
                              ▼
Source Portfolio  来源注册、能力、健康、产量、游标、退避
                              │
                              ▼
Candidate Reservoir  规范化、去重、已看抑制、来源轮转、60+ 蓄水
                              │
                              ▼
Local Personal Selection  Digital Self + 当前要求 + 显式控制 + 短期上下文
                              │
                              ▼
Mechanical Re-rank  只做重复/来源爆发/安全/不可消费约束，不判语义相关性
                              │
                              ▼
Feed Session  12 条分页、低水位预取、generation/cursor、失败保底
                              │
                              ▼
用户打开 / 稍后看 / 更多类似 / 不喜欢 / 屏蔽 / 重置
```

关键所有权：

- Source/Relay/Search 只能返回中立候选，不接收完整 Digital Self。
- 语义相关性、价值、新鲜与探索由本机模型根据 Digital Self 和本次要求判断。
- 系统机械层允许做规范 URL、重复、过期、安全、授权、来源突发和分页；不允许关键词相关性分数。
- AI 的 SHOW/IGNORE 仍不是用户事实；只有用户明确控制能持久影响下一轮。

## 5. 第一阶段实施顺序

### Slice A — 候选蓄水池与连续会话（当前）

1. 从 `personal-feed.ts` 抽出纯机械 Candidate Reservoir。
2. 规范 URL 去重、过期/屏蔽/已看排除、来源轮转、媒介可见性。
3. 默认容量 72，保证 5 页/60 条验收并留 1 页补量余量。
4. 模型选择批次从 8 条串行限制升级为可覆盖蓄水池的有界批次；保留失败降级。
5. 新增长池单测与现有回归；不把假数据通过冒充真实供给。

### Slice B — 来源组合

1. 建立本地 Source Portfolio：来源身份、接入方式、类型、最近成功/失败、连续失败、最近产出、游标/ETag、刷新建议。
2. 内置目录只是种子；模型/Search 可发现 RSS/Atom/JSON Feed/官方 API/oEmbed/ActivityPub 等新供应面，经能力门后入库。
3. 来源失败指数退避，成功恢复；任何单一来源不得冒充整体供给。
4. 先接开放标准和官方接口；不做违反站点规则的整站抓取。

### Slice C — 选择、重排与反馈

1. AI 对整个候选窗口做可比较选择，不能让前 8 条天然支配后续批次。
2. 明确请求优先于历史偏好；Digital Self 只增强，不锁死。
3. 机械重排抑制重复与单源连发；保留高质量探索位，不设固定内容类型配额。
4. “为什么推荐/更多类似/不喜欢/屏蔽来源/重置”都产生可追溯、可撤销效果。

### Slice D — 真实供给与真实 UI 门

1. 在干净 Subject 上以真实开放来源运行至少 30 分钟。
2. 连续刷 5 页并触发至少一次低水位补量。
3. 三个不同 Digital Self + 三个明确临时要求交叉验收。
4. 断开一个供应通道、制造一个超时、快速连续换题，验证降级与 generation 隔离。

## 6. 验收标准

### 6.1 P0 用户门

**能发现**

- 活跃来源组合不少于 20 个健康来源、6 个域、4 种内容表达；每个来源有最近成功/失败和最近产出证据。
- 60 条真实卡片中，任何单一来源占比不超过 25%（供给确有至少 4 源时）；规范 URL 重复为 0。
- 用户加入一个兼容开放标准的来源后，不改代码即可进入后续候选。

**能推荐**

- 50 个基准请求 × 3 个脱敏 Digital Self：Top-12 可用相关率 ≥70%，明确条件遵守率 ≥85%，来源可打开率 ≥95%。
- 同一候选池下，三个 Digital Self 的 Top-12 平均重合率 ≤70%；用户本次明确调整在下一页生效率 ≥80%。
- 屏蔽来源命中率 100%，重置后恢复默认且不改写 Digital Self。

**一直有**

- 标准供给场景连续 5 页/60 条：空页 0、重复 0、旧页回流 0。
- 蓄水池低于 24 条时开始补量；外部通道失败时仍保留至少 2 页已排候选。
- “更多”从本地蓄水池返回 P95 ≤300ms；补量独立计时并展示真实状态，不阻塞已缓存页面。

### 6.2 P0 技术门

- generation/cursor 隔离：A→B→C 快速换题或搜索时，最终结果只属于 C；相关基线失败必须清零。
- Source → normalize → reservoir → select → rerank → session 全链路 trace 含数量、丢弃原因、来源数、时延和终止原因，不记录完整 Digital Self。
- 候选生成、个人选择、机械重排可分别离线测试；`personal-feed.ts` 不再拥有全部职责。
- 任一来源、Search 或模型失败不删除已存在的可用页；无虚假“已联网/已读正文/已补量”状态。
- 全量构建通过；专项回归不得扩大基线失败；真实 UI 与真实来源另有证据。

## 7. 这阶段明确不做

- 不承诺与抖音/小红书/B站相同的内容规模、实时性、视频理解或商业生态。
- 不优化 CTR、观看时长、连续使用时长，不用暗示性行为形成不可见长期画像。
- 不自研搜索引擎、推荐基础模型、全网爬虫或内容平台。
- 不因当前开放内容少而降低技术门；供给扩张时，来源与蓄水池应能水平增加而不改个人选择所有权。
- 未通过真实供给、真实 UI 和 Owner 体验前，不打包、不发布、不写“市场 50% 已完成”。

## 8. 外部基准证据

- TikTok, How TikTok recommends videos #ForYou: https://newsroom.tiktok.com/how-tiktok-recommends-videos-foryou?lang=en-AU
- TikTok, Why this video: https://newsroom.tiktok.com/learn-why-a-video-is-recommended-for-you?lang=en
- 国家网信办，抖音/小红书/B站算法备案公示：https://beian.cac.gov.cn/
- 小红书校招推荐算法职位：https://job.xiaohongshu.com/campus/position/13155
- B站算法公开说明：https://www.bilibili.com/blackboard/activity-gPIvOmhxbh.html
- Google ML, Recommendation systems overview: https://developers.google.com/machine-learning/recommendation/overview/types

## 9. 当前实现检查点（2026-11-11）

已完成的地基：

- `discover-candidate-reservoir.ts`：72 条中立候选蓄水池、规范 URL 去重、过期/排除过滤、来源轮转和媒介露出。
- `content-source-portfolio.ts`：内置来源物化、用户/发现来源注册与可逆停用、Feed/开放 API 最近尝试/成功/失败/产量、连续失败、刷新时间与指数退避。
- `content-source-management.ts` + Discover「内容来源」：用户粘贴公开 HTTPS 地址后先真实摄入，产生可消费候选才登记；同一 Portfolio 投影最近可用性、类型、产量并支持可逆启停。
- `personal-selection.ts`：24 条有界批次、跨批次两轮比较和一次截断恢复覆盖 72 条候选；12 张页大小只作为机械约束，不建立第二语义打分器。
- `personal-feed.ts`：默认排序窗接入 72 条 Reservoir，保存后续分页 ID；旧候选窗实现已从单体文件抽离。
- 低水位供给与个人预排序：低于 24 条时后台补中立候选并复用正式 Digital Self 选择；后台 ID 包不直接写缓存，只有原队列耗尽且调整上下文一致时才接入同一 `rankedIds`。
- Feed 条件刷新：Source Portfolio 保存 ETag / Last-Modified / 最近 304；到期刷新发送条件头，304 记成功且不重复累计产量。
- API 连续摄取：Source Portfolio 保存 Internet Archive 默认目录页码；零 Key 正式摄取从已保存页继续并回写下一页，空页清除；即时查询不消费来源级 cursor。Wikimedia Commons 按官方 `continue` 对象分别保存图片 / 音频 / 视频三路 continuation，已结束流不重启，三路全部结束后才清空。
- 来源组合扩容：新增 11 个先经产品安全摄取验活的直连种子；统一能力判定把查询型 API 排除在无查询默认流健康统计之外。严格 30 分钟门还抽样正文可消费性、隔离失败来源并只统计当前健康内容，最终达到 23 个健康来源、22 个域和 4 种内容表达。
- 304 不再假恢复：来源若因正文样本 `content_unreachable` 失败，同一 Feed 的 304 只记录协议未变化，不清零失败；只有新内容重新抽样通过才恢复。终局 Reservoir 与表达类型也只统计当前健康且启用来源。
- 本地“更多”时延：正式 runtime `content.more` 对 60 条已排队候选，50 样本 P50 86.51 ms、P95 96.11 ms、最大 96.50 ms；通过 300 ms 技术门，但不冒充 Electron 渲染或网络补量时延。
- 离线连续会话：5 页 × 12 条，共 60 条唯一卡片通过；这只证明候选与分页地基，不代表真实外部供给已经达标。
- 真实开放供给检查：30 分 16.863 秒、7 个检查点使用同一 Source Portfolio；Science News 的正文 403 在后续两次 304 时继续保持失败，Microsoft Research 恢复；末轮 19/19 到期 Feed 和 3/3 到期默认 API 成功。终局目录 310 条，活跃 Reservoir 72 条 / 23 来源；Commons 图片 token 前进、音视频 offset 8→16，真实 continuation `PASS`。
- 统一 Responses A→B→C 并发回放：旧代次不进入当前视图，当前代次及后续 replenish 只保留 C，`PASS`。
- 推荐质量：50 个请求 × 3 个脱敏 Digital Self，150/150 真实模型运行完成；Top-12 可用相关率 80.78%、明确条件遵守率 99.67%、来源可打开率 100%、三主体平均重合率 34.51%，全部过门。
- 真实来源连续交付：严格来源门驱动 5×12，共 60 条唯一卡、21 个来源、规范重复 0、单源最高 6.67%、5 种表达、60/60 原文可打开；13 次模型调用判断并提交 56 个后续候选，`PASS`。
- 正式 Electron：当前代码 v10 连续显示 60 张唯一卡和 60 个原文动作；来源列表 28→29，用户新增 BBC 中文 Feed 真实读入 24 条，停用 / 启用往返通过；最终截图已视觉检查。

验证：构建通过；Source / Portfolio / Reservoir / Selection / Personal Feed / runtime generation / 公网 SSRF 最新专项 59/59，通过；调整推荐 / 屏蔽与反转 / 重置 / 来源反馈 33/33 通过；Electron 启动预检通过。全仓测试尝试仍混入既有真实协作、真实模型与长轮询失败，不写成全仓通过，也不把本任务扩成协作修复。

当前边界：第一阶段技术门已过，Owner 于 2026-11-22 在独立安装构建上给出 `OWNER_LIMITED_ACCEPTED / DIRECT_WATCH_ENTRY_PENDING`。本轮关联度、无关内容控制、响应与连续供给改善已接收；直接观看/试看入口、发布与整体市场 50% 能力仍未通过。当前工作仍未提交、未推送、未合并、未公开发布。查询型 API continuation 继续只属于具体检索会话，不得伪装成 Source Portfolio 的全局 cursor。


