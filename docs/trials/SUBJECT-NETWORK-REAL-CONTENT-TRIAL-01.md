# SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01

日期：2026-09-12
Authority：`origin/main` `7629880f0c995d03135f4186b9c90672483774f1`
状态：`ENGINEERING_READY_REAL_USER_TRIAL_PENDING`

## Architecture result

```text
content selection = recipient-side 2digime
central relay = transport only
```

复用既有 `NetworkItem` + `POST/GET /v1/network-items` + 本地 `selectNetworkItems`。中央不读 Digital Self，不做 ranking。判断发生在每个主体自己的 runtime，读取自己的 `self.json`。

## Learning boundary

```text
AI SHOW/IGNORE does not become user preference
```

`selectNetworkItems` 不写 Digital Self。本任务增加的 `network_content_feedback` 把 `origin=ai_decision` 与 `origin=user_action` 分开。本轮没有真人操作，因此没有 `user_action` 记录，也没有兴趣模型。

## Trial result

```text
ENGINEERING_READY_REAL_USER_TRIAL_PENDING
```

| 项 | 结果 |
|---|---|
| 真实公开内容 | PASS：WEBTOON *Tower of God* `https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95` |
| broadcast | PASS |
| relay | PASS |
| 同一 payload 到多个主体 | PASS |
| 中央个性化 | NONE |
| 真实模型 / stub=false | PASS：`deepseek-v4-flash` |
| 工程主体独立 Digital Self | PASS：A SHOW / B IGNORE |
| 自然分歧 | YES（未硬编码） |
| AI 反写偏好 | NO |
| 两个真人反馈 | 缺；未伪造 |

工程闭环已真实跑通。还缺 **2 个真人**。每人只需：用自己的 Digital Self 接收同一条内容，对 SHOW 项做打开 / 保留 / 感兴趣 / 稍后看 / 忽略 / 不感兴趣之一。完成后不要扩建 CMS、推荐或社交系统。
