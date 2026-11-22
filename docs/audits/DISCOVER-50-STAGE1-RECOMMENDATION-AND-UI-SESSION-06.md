# DISCOVER-50-STAGE1-RECOMMENDATION-AND-UI-SESSION-06

**日期：** 2026-11-11

**结论：** `STAGE1_TECHNICAL_GATES_PASS / OWNER_ACCEPTANCE_PENDING / NOT_RELEASED`

> 后续状态：2026-11-11 Owner 正式体验失败，本文件只保留为当时的局部技术证据，不再支持“当前候选可验收”。覆盖记录见 `DISCOVER-50-STAGE1-OWNER-ACCEPTANCE-SESSION-07.md`。

## 1. 本批关闭的主问题

本批不再用少量固定新闻源或一次成功搜索代表「发现」。正式门分别验证：

1. Digital Self 对 50 个请求 × 3 个脱敏主体的真实模型选择质量；
2. 真实开放来源形成 72 条中立 Reservoir 后，连续交付 5 页 / 60 条；
3. 正式 Electron 入口中的 5 页滚动、原文入口、来源列表、用户新增来源和可逆启停；
4. 30 分钟来源健康门同时检查 Feed / API 可摄取、正文链接抽样可消费、失败退避、续页和供给保留。

## 2. 推荐质量：50 × 3 真实模型基准

运行器：`scripts/discover-stage1-recommendation-benchmark.cjs`

原始摘要：`build/evidence/discover-stage1-recommendation-benchmark-strict-top12-20261111/summary.json`

模型：`deepseek-v4-flash`；150/150 运行完成，全部使用正式 `personal-selection` 合同，没有关键词/分数降级器。

| 指标 | 门槛 | 实际 | 结果 |
|---|---:|---:|---|
| 完整运行 | 150 | 150 | PASS |
| 选择成功率 | 100% | 100% | PASS |
| Top-12 可用相关率 | ≥70% | 80.78% | PASS |
| 明确条件遵守率 | ≥85% | 99.67% | PASS |
| 来源可打开率 | ≥95% | 100% | PASS |
| 三主体平均 Top-12 重合率 | ≤70% | 34.51% | PASS |

基准 fixture 只提供候选事实和三份脱敏 Digital Self。已删除曾经只存在于 fixture、并不存在于 Digital Self understanding 的隐藏 `open_source` 主题，避免第二画像权威。

## 3. 真实来源连续五页

运行器：`scripts/discover-stage1-real-feed-gate.cjs`

最终原始报告：`build/evidence/discover-stage1-real-feed-v4-20261111/report.json`

| 指标 | 实际 | 结果 |
|---|---:|---|
| 真实来源 Reservoir | 72 | PASS |
| 页面 | 5 × 12 | PASS |
| 唯一卡片 | 60 | PASS |
| item / canonical URL 重复 | 0 / 0 | PASS |
| 来源数 | 21 | 记录 |
| 单一来源最高占比 | 6.67% | PASS（门槛 ≤25%） |
| 内容表达 | 文章、音频、图片、视频、作品，共 5 种 | PASS |
| AI 调用 / 已判断候选 | 13 / 56 | PASS |
| 原文 URL 抽样 | 60/60 可打开 | PASS |

失败中间报告没有被删除：v1 暴露模型失败后第一页回流和链接可打开率 77%；v2 修复重复后仍因 Science.org 正文 403 只有 93.3%。v3 才在排除不健康来源后达到 60/60。失败报告是门禁演进证据，不算通过。

## 4. 正式 Electron 用户入口

运行器：`scripts/discover-stage1-electron-gate.cjs`

最终原始报告：`build/evidence/discover-stage1-electron-v10-20261111/report.json`

截图：

- `build/evidence/discover-stage1-electron-v10-20261111/feed-page-5.png`
- `build/evidence/discover-stage1-electron-v10-20261111/source-management.png`

正式产品以隔离用户目录启动，不调用 renderer hook：

- 页面实际卡片检查点为 12 / 36 / 36 / 48 / 60；第二次滚动因自动预取一次到达 36，但 12、24、36、48、60 五个阈值均在正式页面通过；
- 60 张卡、60 个 item、60 个原文 URL、60 个可见原文动作；
- 来源列表 28 个；普通用户加入 `https://feeds.bbci.co.uk/zhongwen/simp/rss.xml` 后变为 29 个，真实读入 24 条；
- 新来源不改代码即可进入 Portfolio；停用 → 启用往返通过；
- 两张最终截图已逐张视觉检查，未发现卡片重叠、空白页或来源管理错位。

v6～v9 在默认命令沙箱中均停在 Playwright / Electron 启动握手，页面未进入；Electron 二进制单独预检正常。按工作区 GUI 权限要求在沙箱外、仍使用隔离 userData 的 v10 启动后，完整主链通过。启动权限失败不记为产品通过，也没有据此修改发现产品逻辑。

## 5. 304 假恢复 Yellow 信号

严格正文抽样门首次运行时发现：Science News 的 Feed 可读，但正文样本返回 403；下一次 Feed 304 曾可能清掉 `content_unreachable`。304 只证明 Feed 未变化，不能证明同一批正文突然可消费。

按 02 的 Yellow 规则重读 00 / 01 / 02 后，修正为：

- Source Portfolio 在上一错误为 `content_unreachable` 时，不允许成功 304 清零失败；
- runtime 与真实门都把该 304 记录为「协议未变化、内容仍不可消费」；
- 来源继续进入退避并从活跃候选中隔离；只有后续 200 内容变化且正文抽样通过才恢复；
- 终局表达类型和 Reservoir 只统计当前健康且启用来源，旧 Store 内容不能替失败来源撑门；
- cursor 门要求已有值真实推进到新值，第一次获得 cursor 不再冒充 continuation；
- 新增专项测试 `304 does not make an unchanged source healthy after its content links failed`。

因此较早的 link-aware 运行已主动中止，不作为证据。最终严格报告：`build/evidence/discover-stage1-source-health-link-v5-20261111/report.json`。

| 严格来源指标 | 门槛 | 实际 | 结果 |
|---|---:|---:|---|
| 未压缩观察时长 | 30 分钟 | 30 分 16.863 秒 | PASS |
| 当前健康来源 | ≥20 | 23 | PASS |
| 独立域 | ≥6 | 22 | PASS |
| 当前健康内容表达 | 4 | 文章 / 图片 / 音频 / 视频 | PASS |
| 当前健康 Reservoir | ≥60 | 72 | PASS |
| 已有 cursor 的真实推进 | ≥1 | 1 | PASS |

七个检查点始终保留 72 条 Reservoir；终局为 72 条 / 23 来源、规范重复 0。Science News 首轮正文样本不可达，5 分钟和 15 分钟的 304 均没有清零失败；Microsoft Research 在 15 分钟恢复。30 分钟时 19/19 到期 Feed 成功、2 个真实 304；Wikimedia Commons 图片 token 前进，音频和视频 `gsroffset` 从 8 前进到 16。

## 6. 架构边界

- Source / Relay / Search 只提供中立候选；完整 Digital Self 不外发。
- Digital Self + 当前请求 + 用户显式控制 + 短期上下文只进入本机模型选择。
- 机械层只负责规范 URL、重复、安全、来源突发、失效来源隔离和分页；没有关键词相关性打分器。
- 72 条选择采用 24 条有界批次、跨批次两轮比较和一次截断恢复；页大小是机械约束，不是第二推荐器。
- Source Portfolio 是来源执行事实的唯一账本；来源管理 UI 只是投影，用户新增来源也进入同一账本。

## 7. 工程验证

- `corepack pnpm build`：PASS。
- Source Management / Portfolio / Reservoir / Personal Selection / Personal Feed / Runtime generation / 公网 SSRF 最新专项：59/59 PASS。
- 调整推荐 / 屏蔽与反转 / 重置 / 来源反馈专项：33/33 PASS。首次运行暴露一条仍按旧 6 张页容量写的断言；fixture 扩到 17 条后按当前 12 张正式页重验，确认新内容在前、余量仍留给更多，没有通过放宽断言掩盖合并错误。
- 正式 runtime 本地 `content.more`：50 样本 P50 86.51 ms、P95 96.11 ms、最大 96.50 ms，PASS（门槛 300 ms）；不冒充网络补量或 Electron 绘制时延。
- 沙箱外 Electron 启动预检：PASS；含空格工作区参数数组和 Electron runtime 均正常。
- 前序 Source / Reservoir / Personal Feed / SSRF 专项与 generation 回放继续作为本阶段证据。
- 全仓 `pnpm test` 不是本批绿色结论：尝试运行时进入既有真实协作、真实模型和长轮询用例，并出现与 Discover 改动无因果关系的旧失败，之后人工停止。不得写成全仓通过，也不得为让全仓变绿而扩大本任务到协作系统。

## 8. 当前边界

- 推荐质量、真实来源五页和正式 Electron 用户主链已经形成独立通过证据。
- 第一阶段计划定义的推荐、来源、连续会话、generation、时延和正式 UI 技术门已通过；这只表示当前技术候选达到计划门，不等于市场整体能力、内容规模或 Owner 体验已被接受。
- Owner 尚未做 Release Candidate 真人体验；没有打包、提交、推送、合并或发布。

