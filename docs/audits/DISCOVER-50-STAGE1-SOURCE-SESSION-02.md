# DISCOVER-50-STAGE1-SOURCE-SESSION-02

**日期：** 2026-11-10

**结论：** `SOURCE_MANAGEMENT_IMPLEMENTED / LOW_WATER_SUPPLY_PARTIAL / NOT_PRODUCT_ACCEPTED`

## 1. 普通用户来源管理主链

正式 Discover 页面新增「内容来源」投影，读取的仍是唯一 `content/source-portfolio.json`，没有新增第二份来源状态。

用户可以：

1. 查看内置与本人加入来源的启用状态、内容表达、最近检查、最近产量和最近失败；
2. 粘贴一个公开 HTTPS Feed / 内容地址；
3. 系统先通过既有开放摄入能力真实读取，只有产生可消费候选后才登记；
4. 可逆启用或停用来源，历史执行事实不删除。

来源管理只证明可达性和产量，不用确定性分数判断内容是否适合用户。相关性和个人价值仍由本机模型结合 Digital Self 和本次要求判断。

## 2. 低水位供给主链

- 从现有个人流缓存派生已排队但未交付数量，不新增会话事实源。
- 队列低于 24 条时，runtime 在后台启动 `prefetch`。
- `prefetch` 只补中立候选，不替换当前可见页、不提前消费最后缓冲页、不改写 Digital Self。
- 本地仍有不少于 24 条未展示候选时，不发起外部搜索。
- 队列耗尽且后台补量尚未完成时，下一轮先等待该次补量，避免重复启动并发补量。

## 3. 验证

| 验证 | 结果 | 边界 |
|---|---|---|
| `npm run build` | PASS | TypeScript 全量编译 |
| Source / Reservoir / Personal Feed 相邻专项 | 77/77 PASS | 含来源真实格式离线接入、可逆启停、低水位不误搜、候选补量不替换当前页 |
| Runtime / 统一适配器专项 | 9/9 PASS | 含正式 content 命令来源管理、低水位调度、A→B→C generation |
| Renderer JavaScript 语法 | PASS | 尚不是正式 Electron 视觉与交互验收 |
| 正式 Electron 来源管理操作 | NOT PASSED / automation blocked | 隔离用户数据启动成功且真实页面树可读；Windows 控制层连续报 `FrameArrived timed out`、`coordinate input geometry is unavailable`、`failed to activate captured window`，没有发生可靠点击，不计为 UI 通过 |
| diff whitespace | PASS | — |

## 4. 尚不能宣称

- 来源管理正式 Electron 已启动但自动化输入失败；尚未经过可靠鼠标操作、视觉检查和真实用户 Feed 加入闸门。
- 当前后台预取补的是中立候选，尚未预先完成个人选择；缓冲彻底耗尽后的下一页仍可能等待模型，因此 `more P95 ≤ 300ms` 未通过。
- Source Portfolio 尚未保存各协议的 ETag / Last-Modified / 分页 cursor；30 分钟长期刷新门未通过。
- 20 个健康来源、6 个域、4 种内容表达仍未达到；一次实时供给快照不能代替健康运行。
- 50×3 Digital Self 推荐质量基准和真实 Electron 故障注入仍未开始。

## 5. 下一批顺序

1. 用正式 Electron 完成来源页读取、真实 Feed 加入、停用/启用和返回信息流验证。
2. 把低水位补到的中立候选在后台完成个人选择并安全合并到同一队列；不得另建第二会话权威。
3. 为支持该主链的开放协议补 ETag / Last-Modified / cursor 执行事实，再跑 30 分钟来源健康门。
4. 建立 50 请求 × 3 Digital Self 的推荐质量基准。

