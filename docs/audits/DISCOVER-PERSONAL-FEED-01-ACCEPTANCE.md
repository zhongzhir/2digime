# DISCOVER-PERSONAL-FEED-01 验收

**日期：** 2026-09-18  
**Branch：** `build/discover-personal-feed-01`  
**HEAD：** `60b3278736c421a30a4862e199797327b75a3dbf`  
**工作区：** `D:\Projects\dm-discover-personal-feed-01`  
**计划：** `docs/plans/DISCOVER-PERSONAL-FEED-01.md`  
**审计：** `docs/audits/DISCOVER-PERSONAL-FEED-01-AUDIT.md`  
**性质：** 工程验收。未 push。未触碰其它 worktree。  
**裁定：** `DISCOVER_PERSONAL_FEED_ENGINEERING_READY`

未提交现场仍在本任务 worktree。Owner 试用机真人复验前，不得写成产品 ACCEPTED。

---

## 核验

```text
git branch --show-current  = build/discover-personal-feed-01
git rev-parse HEAD         = 60b3278736c421a30a4862e199797327b75a3dbf
workspace                  = D:\Projects\dm-discover-personal-feed-01
```

从已有现场继续，未重建 worktree，未切换 branch，未移动 agent root。

---

## Capability Sufficiency / Build-vs-Integrate

已复用：Content Directory、NetworkItem、`ingestSource`、开放 Feed / Media RSS、Gemini Search、`selectNetworkItems`、explicit `content-preferences`、对话模型。

本轮只补模型无法自己保证的机械事实：

1. 打开 Discover 先重放本机 Feed，而不是先搜索。
2. 上次成功 Feed 可重放；失败不得清空。
3. 联网态可诊断（人话；reason code 仅内部）。
4. 短期行为不写 Digital Self / 长期偏好。

未建中心推荐、用户向量、engagement、dwell、CTR reward、第二套画像。

---

## 主路径

```text
打开 Discover
  → 解析本机 personal-feed-cache / 本地候选
  → 新鲜且足够则直接显示
  → 不足或过旧时由模型拟定最短主题词，bounded 补量（优先 ingestSource，失败再 indexSearchHits）
  → 本机 2digime SHOW/IGNORE
  → 只缓存 Feed ID 列表
```

「换一批」排除上次已展示 ID，不足再补，重新选择。搜索失败或没有新候选时保留当前列表。

搜索框 = `CURRENT INTENT OVERRIDE`。空查询回个人 Feed，不再拒绝「请先说想找什么。」

---

## 验收矩阵

| 项 | 状态 | 证据 |
|---|---|---|
| 打开 Discover 不是先搜索 | PASS | 新鲜缓存 ≥4 条时不调用 `searchWeb`（`personal-feed.test`） |
| 目录非空但全是站点/首页时仍补量 | PASS | hub URL 被滤掉后走补量；401 仍保留旧 Feed |
| 失败不清空上次 Feed | PASS | 401/503 时 `cards` 仍在；runtime `content refresh` 同步 |
| 空态反映真实联网态 | PASS | `NOT_CONFIGURED` 才提「开启联网发现」；`AUTH_FAILED` 说检查设置；HTML 不再写死旧空态 |
| UI 不展示 reason code | PASS | renderer 不读 `view.reasonCode`；notice 不含 `NETWORK_*` |
| 选择在本机 2digime | PASS | 继续 `selectNetworkItems`；Relay/Directory 无用户向量 |
| 搜索词不泄漏 Digital Self | PASS | 只发模型给出的最短 `searchQuery`；禁止代码代造兜底 query |
| 敏感事实默认不进发现 query | PASS | 发现方向 / 开放搜索词 prompt 均禁止，除非用户明确搜索/关注/偏好 |
| EXPLICIT PREFERENCE 仍是长期层 | PASS | boost/reduce/follow/block → `content-preferences.json` `origin=user_action` |
| RECENT STATE 不是「喜欢」 | PASS | `recent-recommendation-state.json`；打开/问兔机米/搜索主题；14 天衰减；可重置；`self.json` hash 不变 |
| 升格 hook 仅占位 | PASS | 注释 hook，本轮不实现确认升级 |
| 无 engagement / dwell / 中央推荐 | PASS | 新代码无 dwell/CTR/engagement；未新增命令 |
| 换一批不空等 | PASS | 排除已展示；失败回退上次列表 |

---

## 测试

`npm run build` 通过。

本任务：

```text
dist/subject-comm/tests/network-discovery-state.test.js
dist/subject-comm/tests/recent-recommendation-state.test.js
dist/subject-comm/tests/personal-feed.test.js
dist/subject-comm/tests/personal-selection.test.js
dist/runtime/tests/open-web-discovery-01.test.js
dist/runtime/tests/discover-personal-feed-01.test.js
```

16/16 PASS。

回归（Discover / 偏好 / 开放 Web / 消费形态 / seek）：27 PASS，1 skip（真模型 401，与本任务无关）。

未在本环境跑正式 Electron + 真 Gemini 冷启动（现有 `open-web-discovery-01.electron.test.ts` 仍可在有 SecretStore / `GEMINI_API_KEY` 时跑）。本轮 UI 变更用 renderer 源码断言与 runtime 命令面验证；未能做交互式窗口点选。

---

## 未做（按计划）

中央推荐、engagement、dwell、广告、autoplay、TikTok swipe、移动端、WebSub、ActivityPub、站点 scraper、支付结算、supplier portal、长期后台 scheduler、近期主题升格为 explicit preference。

---

## 裁定说明

工程上，Owner 空页面的根因已被对准：默认 Discover 不再在「目录非空就不补、空了才搜、失败被吞、空态永远写开启联网发现」上打转。个人 Feed 缓存、联网机械态、失败保留、两层学习已经接到 `content` 命令和一级发现页。

Owner 真人试用机复验通过后，才可将本任务升为 `DISCOVER_PERSONAL_FEED_ACCEPTED`。

---

## 2026-10-04 附录：限定试用接受

**裁定：** `DISCOVER_PERSONAL_FEED_LIMITED_TRIAL_ACCEPTED`  
**试用版本：** 产品提交 `230cfc6`；打包 `release-staging/v2-tujimi-20261003T111446Z-230cfc69`  
**范围：** 隔离 `DIGITALME_V2_USER_DATA` / `DIGITALME_V2_HOME` 下的 Discover 节目搜索、入口核实、额度与判断分页。  
**不是：** 全部产品验收通过；市场 95 分位达标；`DISCOVER_PERSONAL_FEED_ACCEPTED`。  
**未：** push、发布。

后续改进顺序由 Owner 指定：排版 → 来源 → 质量 → 运行可靠性。第 2 批来源与行为闭环见 `docs/audits/DISCOVER-SOURCE-FEEDBACK-02.md`。第 3 批大众供给与调整推荐见 `docs/audits/DISCOVER-ADJUST-03.md`。课程与复杂查询交付修复见 `docs/audits/DISCOVER-DELIVERY-04.md`。核实诚实、验证页、撤销与课程耗时见 `docs/audits/DISCOVER-QUALITY-05.md`。对象匹配与试用包 `c9356686` 见 `docs/audits/DISCOVER-QUALITY-06.md`。课程查询偏离、漫剧额度分记、默认流缩水定向修复见 `docs/audits/DISCOVER-QUALITY-07.md`（本轮不打包）。已知缺陷见 `digitalme_context.md` 2026-10-04 条，不得在本附录里写成已关闭。`230cfc6` 仍是已接受试用基线，不代表这些新增改动已接受。
