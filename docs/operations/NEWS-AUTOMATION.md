# 兔机米资讯自动发布通道

## 边界

这是官网资讯的受控出版通道，不是 Grok 对仓库的通用写权限。外部 Agent 只能通过 GitHub `repository_dispatch` 提交一篇满足规则的结构化文章；工作流校验后生成静态页面、RSS 与站点地图，并留下 Git 提交记录。

## Grok Agent 所需权限

推荐为 `zhongzhir/2digime` 建立专用 GitHub App；初次接入也可使用仅限本仓库的 fine-grained personal access token。令牌至少需要对该仓库的 **Contents: Read and write** 权限。令牌只保存在 Grok Agent 的密钥库，不写入提示词、仓库或发布载荷。

请求地址：

`POST https://api.github.com/repos/zhongzhir/2digime/dispatches`

请求头：

```text
Authorization: Bearer <GROK_GITHUB_TOKEN>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

请求体：

```json
{
  "event_type": "publish_news",
  "client_payload": {
    "id": "stable-unique-id-20260927",
    "slug": "human-agency-in-the-ai-age",
    "title": "标题（8—120 字符）",
    "summary": "摘要（20—240 字符）",
    "category": "人的主体性",
    "publishedAt": "2026-09-27",
    "production": "AI 协作整理",
    "body": "## 小标题\n\n正文至少 100 字符。支持二、三级标题、段落、引用、无序列表和 **加粗**。不接受原始 HTML。",
    "sources": [
      { "label": "来源名称", "url": "https://example.com/source" }
    ]
  }
}
```

`category` 只能是 `人的主体性`、`AI 与人`、`兔机米进展`。`id` 和 `slug` 一经使用不可覆盖；同一 `id` 与完全相同的载荷可安全重试。工作流失败时文章不会上线，原因会保留在 GitHub Actions 日志中。

## 发布结果

- 栏目：`/news/`
- 文章：`/news/<slug>/`
- RSS：`/news/feed.xml`
- 来源记录：`content/news/*.json`
- 自动更新：首页最新文章、`site/sitemap.xml`

由于 GitHub 的 `GITHUB_TOKEN` 推送不会再次触发普通 push 工作流，资讯工作流在提交内容后会在同一次运行中直接部署 Pages。
