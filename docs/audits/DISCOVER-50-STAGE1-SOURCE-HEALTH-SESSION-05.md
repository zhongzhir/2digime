# DISCOVER-50-STAGE1-SOURCE-HEALTH-SESSION-05

**日期：** 2026-11-11

**结论：** `30_MIN_SOURCE_HEALTH_PASS / 20_6_4_SOURCE_GATE_PASS / REAL_CURSOR_ADVANCE_PASS / NOT_PRODUCT_ACCEPTED`

## 1. 来源组合扩容

本批先通过产品自己的安全摄取链逐个验活，再把 11 个直连来源加入内置种子；没有接 RSSHub，也没有以单一聚合器冒充来源规模。

新增中文直连来源：爱范儿、阮一峰科技爱好者周刊、开源中国、FreeBuf、InfoQ 中文、钛媒体、博客园首页。

新增官方科学 / 技术来源：Science News、Google Blog、Google Research、Microsoft Research。

同时新增统一的 `supportsDefaultCatalogListing` 能力判定。后台和健康门只调度无需用户查询词即可形成中立目录的端点；iTunes 查询、Bangumi 搜索和 Wikivoyage 查询不再被误记成“默认流健康但产量 0”。

## 2. 30 分钟真实健康门

运行器：`scripts/discover-stage1-source-health-check.cjs`

原始报告：`build/evidence/discover-stage1-source-health-20261111/report.json`

观察时间为 1,810,534 ms，未压缩时钟。七个检查点使用同一个临时 Subject、同一 Source Portfolio 和同一 NetworkItem Store：

| 时点 | Feed 尝试 | API 尝试 | 结果 |
|---:|---:|---:|---|
| 0 分钟 | 21 | 4 | Feed 21/21；API 3/4；Commons 保存三路 cursor；Internet Archive 被安全门拒绝 |
| 5 分钟 | 0 | 1 | 只重试首次失败来源；其余来源未被重复请求 |
| 10 分钟 | 0 | 0 | 无到期请求 |
| 15 分钟 | 0 | 1 | Internet Archive 第二级退避重试；失败不删已有供给 |
| 20 分钟 | 0 | 0 | 无到期请求 |
| 25 分钟 | 0 | 0 | 无到期请求 |
| 30 分钟 | 21 | 3 | Feed 21/21；3 个真实 304；默认 API 3/3；Commons cursor 继续前进 |

最终门：

| 指标 | 门槛 | 实际 | 结果 |
|---|---:|---:|---|
| 真实观察 | 30 分钟 | 30 分 10.534 秒 | PASS |
| 健康来源 | ≥20 | 24 | PASS |
| 独立域 | ≥6 | 23 | PASS |
| 内容表达 | 4 | 文章 / 图片 / 音频 / 视频 | PASS |
| Reservoir | ≥60 | 72 | PASS |
| Reservoir 实际来源 | — | 24 | 记录 |
| 规范重复 | 0 | 0 | PASS |

目录内容从首轮 271 条增长到末轮 319 条；Reservoir 始终保持 72 条 / 24 来源，没有因单点失败变空。

## 3. 条件刷新与真实续页

- 第二轮 21 个 Feed 全部成功，其中机核、阮一峰、Microsoft Research 返回真实 304；304 记成功、产量 0，没有误入失败退避。
- Commons 图片 cursor 从 `!!!Beginning_Shodo_Tehon-strokes.jpg` 前进到下一 token；视频与音频 `gsroffset` 都从 8 前进到 16。
- 第二轮 Commons 产生 24 条，目录净增 48 条；证明实际消费的是下一段 continuation，不是重复构造第 1 页 URL。

## 4. 单点失败与安全边界

Internet Archive 在当前网络被解析为 `198.19.50.212`，属于保留的网络基准地址段。正式安全 HTTP 因此返回 `ssrf`，本批没有为使来源变绿而放宽安全门。

Source Portfolio 已保存 `lastErrorCode`，普通来源管理投影可显示“安全门拒绝 / 请求超时 / 域名解析失败”等有界原因。Internet Archive 按 5 / 10 / 20 分钟指数退避，且失败期间 271 条已有目录和 72 条 Reservoir 未丢失。

## 5. 尚不能宣称

- 24 个健康来源通过的是可访问、可摄取和持续刷新门，不等于每条内容都符合每个 Digital Self；推荐质量仍需 50 × 3 基准。
- 本轮没有完成正式 Electron 连续 5 页点击/视觉验收，也没有把 319 条真实目录在 UI 中连续交付 60 条作为证据。
- Internet Archive 的协议适配代码和离线端到端测试通过，但在当前网络不能作为健康来源；安全门不得绕过。
- 因此“能发现”的来源技术门已显著闭合，但“能推荐”“一直有”的完整产品门和第一阶段仍为 `IN_PROGRESS`。

## 6. 下一批顺序

1. 建立 50 个请求 × 3 个脱敏 Digital Self 的推荐质量基准，输出明确条件遵守、相关可用、来源可打开和 Self 分化。
2. 用本次真实来源目录驱动连续 5 页 / 60 条交付回放，核对空页、重复、旧页回流和低水位补量。
3. 在可可靠控制的正式 Electron 环境完成来源管理与连续 5 页视觉验收；不得请 Owner 代替开发验收。
