# DISCOVER-50-STAGE1-API-CURSOR-SESSION-04

**日期：** 2026-11-11

**结论：** `DEFAULT_CATALOG_API_CURSOR_IMPLEMENTED / INTERNET_ARCHIVE_AND_COMMONS_RESUMABLE / NOT_PRODUCT_ACCEPTED`

## 1. 本批裁定

开放 API 没有一个可诚实通用的分页协议。本批没有发明“万能 cursor”，只对已经确认有稳定、与查询无关分页语义的默认目录流实施来源级续页。

Internet Archive 的[官方高级搜索页](https://archive.org/advancedsearch.php)明确提供“Number of results”和“Page”。因此先把它作为第一条真实 API 连续供给通道：每页 4 条，默认目录摄取按页继续；即时搜索仍从第一页开始。

MediaWiki 的[官方 continuation 说明](https://www.mediawiki.org/wiki/API%3AContinue)要求客户端把响应 `continue` 对象中的字段原样带到下一次请求，且不得依赖 token 内部格式。Wikimedia Commons 因此按图片、音频、视频三个独立流保存 continuation；一个流结束不会让另两个流重启。

## 2. 所有权与持久化边界

- `Source Portfolio` 的同一来源记录新增可选 `cursor`，它是来源执行事实，不是用户画像、个人 Feed 状态或语义排序信号；
- Internet Archive cursor 使用有协议前缀的有限字符串 `internet-archive:page:N`，非法、越界或其它协议的值回落到第 1 页；
- Commons cursor 使用 `wikimedia-commons:v1:` 前缀，在同一来源执行事实内分别保存 image / audio / video 的官方 continuation 对象；值保持不透明，只做字段名、长度与总大小安全边界；
- `listOpenCatalog` 可按来源 ID 接收 cursor；只有无查询词的 Internet Archive 目录流消费它；
- 带查询词的 `searchOpenMedia` 不消费已保存的来源 cursor，避免把某次搜索的第 N 页污染为全局来源状态；
- 成功且搜索响应仍有文档时回写下一页；空页清除 cursor，使后续周期可从第 1 页重新检查；
- Commons 单流无 continuation 时标为该流已结束；后续刷新只继续仍有 token 的流，三路全部结束后才清空来源 cursor；
- 失败 attempt 不携带 cursor，因此不会把上一次成功位置误清除；
- 正式 UI/Feed 仍只读取同一个 `personal-feed-cache.json` 队列，来源 cursor 没有进入个人选择或页面状态机。

## 3. 端到端证据

测试没有停在 URL 辅助函数：

1. 在真实 `Source Portfolio` 中把 `internet-archive` 预置为第 2 页；
2. 通过零 Key 的 `ensurePersonalFeed` 冷启动进入正式目录摄取；
3. 音频和视频目录请求都实际带 `page=2`；
4. 真实生成可消费 `NetworkItem` 并进入开屏；
5. 摄取完成后，同一来源记录更新为 `internet-archive:page:3`。

另有协议单测覆盖：第 1 页发出下一页 cursor、第 2 页继续到第 3 页、空第 3 页返回 `cursor: null`，以及 Portfolio 对 cursor 的保存和清除。

Commons 协议单测覆盖：首轮图片 / 音频 / 视频三路分别请求；视频先结束后不再重启；图片携 `gaicontinue`、音频携数值型 `gsroffset` 独立继续；剩余两路结束后才返回 `cursor: null`。官方 API 只读实测也分别返回了 `gaicontinue + continue` 和 `gsroffset + continue`，与实现的“不透明 continuation 对象”一致。

## 4. 验证

| 验证 | 结果 | 边界 |
|---|---|---|
| `pnpm build` | PASS | TypeScript 全量编译 |
| Source / Reservoir / Selection 相邻专项 | 52/52 PASS | 含 Portfolio cursor、两类 API 续页、零 Key 正式摄取与既有 5 页/低水位能力 |
| Internet Archive cursor 端到端 | PASS | Portfolio 第 2 页 → 正式冷启动请求第 2 页 → 回写第 3 页 |
| Commons 三流 continuation | PASS | 图片 / 音频 / 视频互不覆盖；已结束流不重启；全部结束后清空 |

## 5. 尚不能宣称

- 这是当前内置“无查询默认目录”里需要续页的两类 API；查询型 Wikivoyage、Bangumi、iTunes 等不能误用来源级全局 cursor。未来新增默认来源仍必须逐协议适配，不能套用这两个 cursor。
- 还没有完成 30 分钟真实来源健康门、20 个健康来源 / 6 个域 / 4 种表达、50×3 推荐质量和真实 Electron 连续 5 页。
- 因此默认目录 API cursor 的代码地基已完成，但真实长时供给、跨周期去重和 UI 连续 5 页尚未过门；“一直有”和第一阶段仍为 `IN_PROGRESS`。

## 6. 下一批顺序

1. 跑 30 分钟真实来源健康、条件刷新与 cursor 续页，形成成功率、产量、域和表达覆盖证据。
2. 对 cursor 跨周期结果做规范 URL 去重与产量核对，确认续页不是重复第一页。
3. 建立 50 × 3 推荐质量基准。
4. 在可可靠控制的正式 Electron 环境完成来源管理和连续 5 页验收；不得请 Owner 代替开发验收。
