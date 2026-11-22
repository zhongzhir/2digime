# DISCOVER-50-STAGE1-FOUNDATION-01

**日期：** 2026-11-10

**结论：** `FOUNDATION_IMPLEMENTED / ENGINEERING_PARTIAL / NOT_PRODUCT_ACCEPTED`

## 1. 本批完成

### 1.1 候选蓄水池

- 从 `personal-feed.ts` 抽出 `discover-candidate-reservoir.ts`。
- 默认容量从 24 提升为 72。
- 机械处理：明确排除项、屏蔽来源、过期、规范 URL 重复、来源轮转、已取到媒介露出。
- 不读取 Digital Self，不计算关键词/语义分数，不替模型决定相关性。
- Personal Feed 已接入 Reservoir；排序失败仍保留已取候选。

### 1.2 来源组合

- 新增 `content/source-portfolio.json` 本地事实文件。
- 内置开放目录会物化为可审计来源记录，而不再只存在代码常量。
- 记录：来源 URL、能力类型、来源 origin、启用事实、最近尝试/成功/失败、连续失败、最近/累计产量、下次刷新时间。
- 成功后 30 分钟刷新；失败从 5 分钟起指数退避，最高 6 小时；成功会清零连续失败。
- 用户可注册兼容开放 Feed，不需要修改源码，并可逆停用而不删除历史执行事实；discovered 来源默认不自动启用，避免模型自行扩大授权。
- RSS/Feed 与 Wikimedia、Internet Archive、iTunes、Bangumi、Wikivoyage 等既有开放 API 均按端点写入成功/失败与产量；尚未做普通用户来源管理 UI。

### 1.3 选择调用上限

- 旧实现 8 条一批；72 条会产生 9 次串行模型调用。
- 本批调整为 24 条一批；72 条最多 3 次。
- 这仍是批内可比、批间合并，尚未达到全池一次可比或工业粗排/精排；在 Slice C 继续解决。

## 2. 验证结果

| 验证 | 结果 | 边界 |
|---|---|---|
| `npm run build` | PASS | TypeScript 编译 |
| 新模块 + 相邻专项 | 73/73 PASS | 来源组合、Reservoir、Personal Selection、Personal Feed、推荐调整、来源身份回归 |
| 72 条 Reservoir | PASS | 10 个来源，规范去重与过滤 |
| 5 页连续会话 | PASS | 60 条唯一卡；离线合成候选，不是外部供给验收 |
| 真实开放供给 | PASS（最低门） | 连续检查在 9～10/10 Feed、132～144 条目录、11～12 个规范来源间波动；均形成 72 条 Reservoir，最新为 10/10、144、12 |
| 统一 Responses A→B→C | PASS | mock provider 同合同回放；旧代次拒收，当前及 replenish 只保留 C |
| 当前统一适配器专项 | 5/5 PASS | 统一 Responses generation 回放及相邻适配器合同 |
| 既有真实开放标准专项 | 5/5 PASS | PeerTube、Wikimedia、iTunes、JSON Feed、Media RSS、schema.org/oEmbed 当次可用性 |
| 广内容侧测试 | 117/121 PASS，1 SKIP | 3 个失败为旧额度文案断言；真实模型凭据不可用跳过 |
| 全仓 `npm test` | 不作为本轮结论；人工停止 | 混入真实模型、真实协作和长轮询；存在大量历史失败，与本批无因果关系 |

## 3. 开工前红灯仍在

旧 runtime 测试显示两类未清债务：

1. **跨代/竞态：** 当前统一 Responses 已新增 A→B→C 同合同回放并通过；旧 RSS/seek 链的快速换题、旧补充结果、媒体反向竞态测试仍失败。还缺真实 Electron 的当前链故障注入。
2. **旧链测试漂移：** 10 月明确把显式 Discover 切到统一 Responses 后，一批测试仍注入旧 `contentChat/contentSearch` 并期待 RSS/旧 seek 主链。这些失败不能通过复活旧链解决，应迁移为统一 Responses 适配器回放测试。

另有 3 个额度文案断言期待“额度已经用完”，而当前状态同时覆盖 quota/rate-limit，真实文案为“额度或频率限制”。这是基线断言漂移，不是本批功能回归。

## 4. 尚不能宣称

- 不能宣称“市场一流 50% 已完成”。
- 不能宣称已达到完整 20 个健康来源、6 域、4 种表达；连续实时检查只证明 11～12 个规范来源及当次供给。
- 不能宣称低水位后台补量已成立；当前 72 条只形成 6 页静态余量。
- 不能宣称推荐相关率、条件遵守率或三个 Digital Self 分化率达标。
- 不能宣称真实 Electron、完整真实来源门、P95 或长时间运行通过；本轮外部检查只是一次性供给快照。
- 不打包、不发布、不 push。

## 5. 下一批唯一顺序

1. 用正式 Electron 验证已实现的普通用户来源管理入口，并用真实外部来源核验逐端点健康与退避。
2. 在已实现的低水位中立候选预取上补个人选择预排序和统一 cursor；旧结果不得写入新会话。
3. 在真实 Electron 对统一 Responses 做快速换题、超时、取消和旧补充故障注入；不得再用旧链测试代替。
4. 建 50 请求 × 3 Digital Self 的相关性/条件遵守基准。
5. 最后才做真实来源、真实 Electron 连续 5 页与故障注入。

