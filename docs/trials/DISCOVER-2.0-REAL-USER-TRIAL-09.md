# DISCOVER-2.0-REAL-USER-TRIAL-09

**Version:** 兔机米 0.2.0 · Discover 2.0 trial (`兔机米-0.2.0-discover2-trial-win-x64-setup.exe`)
**Source:** `e0d5da656e6d912f45cf5a495f459af7cb3e1b91`
**Scale:** 3–5 real people, 2–3 days each. This is not a survey project.

## What to tell each person (nothing more)

> 兔机米现在有一个「发现」功能，可以试着让它帮你找最近值得看的内容、新闻、文章、视频或音频。

Do not teach them how to test. Do not mention what changed.

## What to watch (真实行为，不引导)

1. 用户是否主动再次打开 Discover？
2. 用户最常提出什么内容需求？
3. 是否真的打开 / 阅读 / 播放结果？
4. 是否使用「问兔机米」？
5. 是否使用「加推类似 / 少推类似」？
6. 哪些结果明显不相关？
7. 哪些结果让用户觉得「这个确实懂我」？
8. 与直接用新闻 App / 搜索 / 内容平台相比，有没有明显省力？
9. 是否出现「内容太少」？
10. 是否出现「太慢」？
11. 是否愿意第二天继续用？

## How to record (不要建复杂埋点)

- 优先用现有日志：每个测试用户的 `subjects/<id>/content/content-preferences.json`（显式反馈）、`recent-recommendation-state.json`（打开/稍后/问兔机米事件）。
- 现有日志不够的，人工记录：一句需求、看到什么、做了什么、感受。
- 每人一段简短记录即可，不写长篇。

## Gate

试用结束后只回答其中之一：

- `DISCOVER_REAL_USER_VALUE_PROVEN`
- `DISCOVER_REAL_USER_VALUE_MIXED`
- `DISCOVER_REAL_USER_VALUE_NOT_PROVEN`

`PROVEN` 至少需要：不止 Owner 的真人实际使用；有用户主动重复使用；至少部分内容真正被消费；个性化价值被真人感知；没有普遍性严重内容质量问题；没有严重性能阻塞。

不为了得到 PROVEN 修改判定标准。

## Known limitations to expect (backlog, not blockers)

- 模糊请求下偶发长期画像轻微泄漏。
- 视频/音频查询首屏偶发偏慢（个别一次 20–30s）。
- 单一 Search provider 失败（Gemini 429 / DashScope 401）时由托管 Search + Feed 兜底。
- 暂无进程内 TTL 缓存；重复查询会重新抓取公开源。
- 部分视频只能官方 embed 或 external-only。
