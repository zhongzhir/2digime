# DIGITALME-UNIFIED-CAPABILITY-01 收尾证据

**日期：** 2026-10-11

**隔离分支：** `codex/digitalme-unified-capability-01-closeout`

**基线：** `2d3732fa7129c2340f8afdaeabf25993c6b6f267`

**范围：** 仅来源身份、日期来源依据、离线完整链路回放、一次真实区块链 UI 复验和既有证据归档；未扩展视频、P95、真实 Digital Self 或其他产品功能。

## 结论

**限定新闻/网页接入可供 Owner 体验。** 该结论只覆盖北京 Responses 下的新闻/网页 Discover 链路，不表示视频、P95、普通用户全环境或整体产品可用已经验收。

## 1. 离线完整链路回放

输入来自 `supplemental-ui-validation-result.json` 中真实响应 `resp_d6e35c64-e621-9212-94ce-321a793c09a0` 已保存的 7 张 UI 卡片和供应商 trace。原始 SSE 字节及原始 `present_results.arguments` 当时未保留，因此本次把已保存卡片与 trace 规范化为 `offline-blockchain-replay-input.json`；`why` 空值和回放 summary 是重建元数据，不冒充供应商原始证据。

真实 Electron 产品入口通过同一 Responses 适配器、当前 runtime、`personal-feed-cache.json` 与 renderer 完成回放：

- 适配器收到且只收到 1 个 `POST .../responses`；配置为 `max_output_tokens=8192`、`stream=true`、`store=false`，工具为 `web_search`、`web_extractor`、`present_results`。
- `techflowpost.com/` 与 `wublock123.com/` 两个首页未显示。
- Grayscale、Pantera、OAK Research、WEF、钜亨网五个具体文章 URL 全部保留。
- 内容缓存的 5 个 `itemId` 与 UI 五卡逐项一致；同一查询写入 intent 视图缓存，没有另建卡片事实源。
- 五卡均按相同 URL 绑定 trace；正文状态全部为 `read → body`；展示的五个日期只出现在 trace 已确认正文读取的来源上。
- `/news/search?query=...` 仍拒绝；深层文章携带 `q`、`query`、`utm_source`、`ref` 查询参数仍保留。没有新增媒体黑名单、评分或排序。

结果：`offline-blockchain-replay-result.json`（11/11 通过）；截图：`evidence/closeout/01-offline-blockchain-replay.png`。

## 2. 唯一一次真实区块链 UI 复验

预算准入：既有 `CNY 1.6078902`，事前预留 `CNY 0.30`，启动前为 `CNY 1.9078902 / 2.00`。本轮只启动 1 个 provider 请求，未重试。

- Response：`resp_de26f1f0-4c12-9488-b9d3-32e897bbd350`，`completed`。
- 耗时：122.450 秒；首个工具调用 9.014 秒。
- 工具：2 次搜索、4 次正文读取、1 次 `present_results`。
- usage：输入 69,457、输出 4,583、reasoning 1,274、合计 74,040 tokens。
- 已知费用估算：`CNY 0.0759397`；无本轮未知在途预留；本批最终准入占用 `CNY 1.6838299 / 2.00`。
- UI 显示 10 张具体文章卡；无首页/搜索页；10 张均有可读标题、摘要与具体 URL。
- 10 张正文状态全部与 trace 的 `read` 一致；每张 URL 均精确存在于 trace。
- 仅 2 张显示日期（2026-06-01、2026-10-07），两者对应 URL 均有正文读取事实；其余 8 张未显示无 trace 日期字段支持的日期。

结果：`final-blockchain-ui-validation-result.json`（9/9 通过）；截图：`evidence/closeout/02-final-real-blockchain.png`。

本轮只核验结果相关性、具体来源身份、日期展示门与读取事实；没有独立保存供应商正文全文，因而不把每个日期/观点的逐字出处审计扩大为已通过。

## 3. 咨询、成果与取消证据

- `supplemental-ui-validation-attempt-2.json` 是咨询与成果 attempt-2 原始记录：咨询直接回答且未申请目录权限；明确委托写入 `podcast-brief-digital-self.md`，真实回读 7,894 bytes，并记录可见成果卡的打开动作。
- attempt-2 后续外部目录用例使用了无效路径，等待超时；该失败已原样保留，不能当授权允许证据。授权拒绝的有效证据在 `supplemental-ui-validation-result.json`。
- 取消用例只验证到 **Talk 的前置 Digital Self interpret provider 请求**：唯一 `request_started` 后 191ms 收到 `cancelled`，总计 256ms，未产生 trace、成果或迟到 turn。代码顺序表明主 Talk 模型循环在前置 interpret 之后才开始。因此本批没有验证搜索工具已经启动后的取消，也没有验证文件写入中途取消。

## 4. 工程证据与边界

- TypeScript 全量编译通过。
- Responses 适配器、咨询/成果、来源完整性专项 8/8 通过。
- 扩展内容回归 33/38；在未改动的 `2d3732f` 基线以同一依赖和同一命令运行也是 33/38，失败项与名称、断言逐项相同，均属于统一 Responses 接入前已退出的旧 Discover/RSS/重试/文案预期。本次未为旧链修改产品。
- 离线回放使用真实 Electron UI 和隔离 `userData`，全部外部网络被回放入口阻断；它是确定性链路证据，不是供应商效果证据。
- 真实 UI 复验使用公开数据和隔离 `userData`；密钥只在 runner 进程读取并写入隔离 SecretStore，未进入报告或提交。
- 未打包、未合并、未 push、未发布；未上传真实 Digital Self。

## 证据索引

- `offline-blockchain-replay-input.json`
- `offline-blockchain-replay-result.json`
- `final-blockchain-ui-validation-result.json`
- `supplemental-ui-validation-attempt-2.json`
- `supplemental-ui-validation-result.json`
- `evidence/closeout/01-offline-blockchain-replay.png`
- `evidence/closeout/02-final-real-blockchain.png`
