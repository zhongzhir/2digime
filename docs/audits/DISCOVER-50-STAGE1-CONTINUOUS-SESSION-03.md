# DISCOVER-50-STAGE1-CONTINUOUS-SESSION-03

**日期：** 2026-11-11

**结论：** `BACKGROUND_PERSONAL_PRESELECTION_IMPLEMENTED / CONDITIONAL_FEED_REFRESH_IMPLEMENTED / LOCAL_MORE_P95_PASS / NOT_PRODUCT_ACCEPTED`

## 1. 后台个人预排序与唯一队列

低水位任务现在不只补中立候选，还会复用正式 `selectNetworkItems`，让当前 Digital Self、用户明确内容控制和近期上下文在后台完成个人选择。

边界如下：

1. 后台结果只是进程内、可丢弃的已排 ID 包，不持久化为第二份 Feed 或用户画像；
2. 预排序排除当前已交付 ID 和同一缓存中已经排队的 ID，不重复判断现有缓冲；
3. 后台任务不替换当前页，也不直接写 `personal-feed-cache.json`；
4. 只有正式 `more` 发现原队列已经耗尽，且 `selectionContextKey` 仍一致时，才把后台 ID 包原子接到同一 `rankedIds`；
5. 原队列仍有未交付内容、当前不再是个人流或本次调整已变化时，提交被拒绝；
6. 提交后仍走原有 `more` 解析和交付路径，没有第二套页面状态机。

专项覆盖了：当前页不被替换、原队列先耗尽、后台候选先经过 Digital Self、接入页无重复、旧上下文不得提交、已有未交付队列不得被覆盖。

## 2. Feed 条件刷新协议事实

`Source Portfolio` 在既有来源记录中新增可选的 `etag`、`lastModified` 和 `lastNotModifiedAt`。这些是来源执行事实，不参与个人排序，也不形成新的来源权威。

到期刷新时：

- 使用已有 ETag / Last-Modified 发送 `If-None-Match` / `If-Modified-Since`；
- 安全 HTTP 层返回规范化的小写响应头；
- 200 响应更新验证器和产量；
- 304 记为成功检查、产量 0、累计内容数不增加，并按成功间隔安排下次刷新；
- 304 不再误记为来源失败或进入指数退避；
- 条件头只加在来源本身的读取上，不带到页面内后续 oEmbed 请求。

本批实现的是 RSS / Atom / JSON Feed / 兼容内容入口的 ETag / Last-Modified。开放 API 的分页 cursor 仍未实现。

## 3. 本地“更多”时延

新增 `scripts/discover-stage1-more-latency-check.cjs`，通过正式 runtime `content.more` 命令读取 60 条本地已排候选；5 次预热后采集 50 次。

本机结果：

| 样本 | P50 | P95 | 最大值 | 门槛 |
|---:|---:|---:|---:|---:|
| 50 | 75.65 ms | 96.55 ms | 113.16 ms | P95 ≤ 300 ms |

结论只限“已有本地队列”的 runtime 命令路径。它不是 Electron 渲染时延，也不包含等待尚未完成的网络补量。

## 4. 验证

| 验证 | 结果 | 边界 |
|---|---|---|
| `npm run build` | PASS | TypeScript 全量编译 |
| Source / Reservoir / Selection 相邻专项 | 52/52 PASS | 含后台预排序、唯一队列、304 与来源协议事实 |
| Runtime / generation 专项 | 6/6 PASS | 含连续翻页、低水位调度和 A→B→C 隔离 |
| 公网 HTTP / SSRF 相邻专项 | 11/11 PASS | 含响应头归一且原安全门无回归 |
| 本地 `content.more` 50 样本 | PASS | P95 96.55 ms；不是 Electron 门 |

## 5. 尚不能宣称

- 真实 Electron 来源管理与连续翻页仍未形成可靠点击/视觉证据；此前 Windows 控制层失败不算通过。
- 开放 API 分页 cursor、30 分钟真实来源健康门和 20 来源 / 6 域 / 4 种表达仍未完成。
- 50 请求 × 3 Digital Self 推荐质量基准尚未完成。
- 后台模型选择在真实供应商下的费用、吞吐和长期失败恢复尚未验收。
- 因此“发现第一阶段”“市场一流 50%”“一直有”均仍是 `IN_PROGRESS`。

## 6. 下一批顺序

1. 为支持连续供给的开放 API 保存并消费分页 cursor，不把 cursor 变成个人 Feed 状态。
2. 跑 30 分钟真实来源健康与条件刷新，形成健康来源、域和内容表达证据。
3. 建立 50 × 3 推荐质量基准，分开测明确条件遵守、相关可用、来源可打开和 Digital Self 分化。
4. 在可可靠控制的正式 Electron 环境完成来源管理和连续 5 页验收；不得请 Owner 代替开发验收。
