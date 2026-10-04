# DISCOVER-PERSONAL-FEED-01

**状态：** `LIMITED_TRIAL_ACCEPTED`（`DISCOVER_PERSONAL_FEED_LIMITED_TRIAL_ACCEPTED`，2026-10-04）  
**日期：** 2026-10-04  
**试用版本：** `230cfc6` / `v2-tujimi-20261003T111446Z-230cfc69`  
**工程基线（历史）：** `60b3278736c421a30a4862e199797327b75a3dbf`  
**工作区：** `D:\Projects\dm-discover-personal-feed-01` / `build/discover-personal-feed-01`

Owner 已对上述试用版做**限定试用接受**。不是全部产品验收，不是 95 分位达标，不得升格为 `DISCOVER_PERSONAL_FEED_ACCEPTED`。未 push、未发布。

后续只按此顺序改进，每批与当时基线比较，不每修一处就打包：

1. 卡片排版 — 已做，未打包
2. 信息来源 + 行为闭环 — 见 `docs/audits/DISCOVER-SOURCE-FEEDBACK-02.md`
3. 大众供给 + 调整推荐 — 见 `docs/audits/DISCOVER-ADJUST-03.md`；交付修复见 `docs/audits/DISCOVER-DELIVERY-04.md`
4. 信息质量 — 核实诚实 / 验证页 / 撤销 / 课程耗时见 `docs/audits/DISCOVER-QUALITY-05.md`
5. 运行可靠性（配额、取消、迟写、CASE R3；保留已知缺陷）

个人分布式内容选择是为了让内容服务于人，不以延长使用时间或增加使用频率为优化目标。

---

## 原则

- 发现 = 内容消费入口，不是搜索工具。
- 搜索 = `CURRENT INTENT OVERRIDE`（我现在特别想看这个），不是 Feed 的前提。
- 选择发生在用户自己的 2digime，不在中心平台。
- 优化 USER VALUE：相关、有用、质量、新鲜、明确偏好、当前目标、多样、必要新奇。
- 禁止优化：停留、点击、DAU、session、无限刷屏。
- 不采集 dwell / hover / scroll / CTR reward。

## 两层学习

| 层 | 是什么 | 写到哪 | 能否当「喜欢」 |
|---|---|---|---|
| **EXPLICIT PREFERENCE** | 加推 / 少推 / 关注 / 屏蔽 / 用户明确说的 | `content-preferences.json`，`origin=user_action` | 是，长期、可检查、可撤销 |
| **RECENT RECOMMENDATION STATE** | 打开、问兔机米、最近搜索主题等可靠事件 | 本机临时文件 | **否**。会衰减、可重置，不写 Digital Self，不上传 Directory / Relay |

持续关注某主题时，未来可询问是否升格为 explicit preference。本轮只留 hook，不实现确认升级。

## 生命周期

```text
打开 Discover
  → 立即解析上次本地 Feed / 本地候选并显示
  → 不足或过旧时 bounded 补量（开放 Web / Feed ingest）
  → 用户侧 2digime 选择
  → 写入本机 Feed ID 缓存（不是第二套内容库）
```

「换一批」：保留候选，排除已展示，不足再补，重新选择。禁止清空后空等搜索。

## 敏感边界

生成外部 Search Query 时只发最短主题词。  
默认不把医疗/疾病、政治立场、宗教、性生活及其它高度敏感事实变成发现 query，除非用户明确搜索、明确关注或明确内容偏好。  
禁止把完整 Digital Self / self.json / 事实列表 / 长期 preference vector 发给 Directory、Relay、供应商或搜索服务。

## 不做

中央推荐、engagement、dwell、广告、autoplay、TikTok swipe、移动端、WebSub、ActivityPub、站点 scraper、支付结算、supplier portal、长期后台 scheduler。

## 本轮落地

主路径改为：打开 Discover → 重放本机 Feed 缓存 → 不足或过旧才 bounded 补量 → 本机 2digime 选择。  
搜索是 `CURRENT_SEARCH_MODE`。失败显示当前搜索无结果，不把上次 Personal Feed 填进搜索主列表。联网空态用人话反映机械状态，不展示 reason code。  
短期打开/问兔机米/搜索只写 `recent-recommendation-state.json`（可衰减、可重置），不写 Digital Self。  
工程验收：`docs/audits/DISCOVER-PERSONAL-FEED-01-ACCEPTANCE.md`。

## Search Intent

搜索是 `CURRENT_SEARCH_MODE`：用户当前意图是最高优先级。

```text
CURRENT USER INTENT
  > 其它 personalization signals
```

Digital Self、explicit preference、recent recommendation state 只能在已经符合当前 scope 的内容里排序和精选。它们不得扩大主题范围，也不得把默认 Personal Feed 混进当前搜索主列表。

对象忠实度：

- `PRIMARY_CONTENT`：用户这次要消费的对象本身
- `ABOUT_CONTENT`：关于该对象的报道、盘点、介绍；可放在「相关介绍」，不得进入消费主 Feed
- `UNRELATED`：直接排除

宁可 0 个正确结果，不要 10 个错误内容对象。失败时允许返回「为你发现」，旧 Feed 仍在 cache。
