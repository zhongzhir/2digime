# DISCOVER-PERSONAL-FEED-01

**状态：** `READY_FOR_OWNER_ACCEPTANCE`  
**日期：** 2026-09-18  
**基线：** `60b3278736c421a30a4862e199797327b75a3dbf`  
**工作区：** `D:\Projects\dm-discover-personal-feed-01` / `build/discover-personal-feed-01`

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
搜索是 `CURRENT INTENT OVERRIDE`。失败保留上次 Feed。联网空态用人话反映机械状态，不展示 reason code。  
短期打开/问兔机米/搜索只写 `recent-recommendation-state.json`（可衰减、可重置），不写 Digital Self。  
工程验收：`docs/audits/DISCOVER-PERSONAL-FEED-01-ACCEPTANCE.md`。
