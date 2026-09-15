# 为兔机米用户提供内容

# Providing Content to 2digime Users

面向内容创作者、媒体、出版机构和平台的公开说明。
Public Alpha · 2026-09-15

**公开 Web 是兔机米默认的可发现内容范围。** 如果你的网站已经公开发布内容，通常无需为兔机米开发专用接口、注册账户或填写专用标签。

本文只写当前已经真实存在的能力。没有公开自助发布后台，也没有对外内容发布 API。

---

## A. 兔机米的内容分发是什么

兔机米不是传统的中央推荐平台。它不会在中心侧为每个用户建立兴趣画像，再按画像统一推送；也不会向供应商出售或暴露用户画像。

公开内容被发现后，大致会经历：

1. 通过成熟搜索或标准 Web 协议（RSS / Atom / Feed Autodiscovery / sitemap / 公开页面 metadata）得到少量 URL；
2. 规范化 canonical URL、来源与去重后，进入一份中立的内容目录 / 网络；
3. 每个用户自己的兔机米收到相同的公开候选；
4. 该用户自己的数字之我，以及他明确表达过的偏好，在本机决定 **呈现** 还是 **忽略**；
5. 用户在自己的兔机米里打开原文、稍后看，或明确说「加推类似 / 少推类似」。

选择发生在接收方自己的兔机米上，不发生在中央网络。兔机米发现内容，是为了让用户回到原站阅读，而不是重新托管全文。

---

## B. 供应商现在需要准备什么

**默认：把内容公开发布在 Web 上即可。** 不需要兔机米 SDK、专用 meta tag、人工兴趣标签、供应商账户或专有发布 API。

为了让机器更稳定地发现和理解内容，推荐遵循开放 Web 标准（按优先级）：

1. 公开稳定的 **RSS 或 Atom Feed**，并在页面 `<head>` 中做标准 **Feed Autodiscovery**（`<link rel="alternate" type="application/rss+xml">` / `application/atom+xml`）；
2. 每条内容有稳定的原始 URL（建议即 **canonical URL**）；
3. Feed 或页面中尽量包含：title、原始 / canonical URL、published time、来源名称、summary / description；
4. 标准 **sitemap**（可在 `robots.txt` 中声明 `Sitemap:`），在没有 Feed 时作为发现 URL 的补充；
5. 页面级 **OpenGraph** 与 **schema.org / JSON-LD**（Article / NewsArticle 等），便于普通公开页成为候选；
6. 保持内容可被公开读取；不要把正式内容只放在需登录的墙后；
7. 内容更新、删除或过期时，保持源站状态真实；尊重 `robots.txt` 与 HTTP 访问控制。

当前会实际用到的来源信息主要是：**标题、摘要/正文预览、原始 URL、发布时间、来源名称**。
不要求供应商维护封面图、复杂标签体系或专用 JSON 字段。不默认保存整篇版权正文。

Public Alpha **当前尚未提供自助内容发布 API。** 没有对外的内容提交地址、注册接口或供应商 portal。请不要等待一份并不存在的公网 API。

---

## C. 标签与分类

供应商 **不需要** 人工填写一套兔机米专用分类法。

兔机米可利用 AI 对已进入网络的内容做必要的类型识别、摘要、主题理解和搜索所需描述。这些理解服务于用户侧的发现与选择，不是要供应商维护 taxonomy。

如果你的 Feed 或页面里已经有 tags，可以把它们当作来源信息保留在原文站点；当前不要求、也不提供一套必须同步的公开标签表。

---

## D. 内容如何被用户发现

当前真实机制：

**公开 Web 默认可发现**
用户打开一级「发现」且已开启联网搜索时，自己的兔机米可以按需向成熟搜索能力发出少量主题查询（不上传数字之我全文或偏好向量），把得到的公开 URL 规范化后写入本机内容目录，再由本机决定呈现或忽略。用户不必先指定「关注某网站」。

**标准源发现**
若站点提供 RSS / Atom / Autodiscovery / sitemap / 公开页面 metadata，兔机米按这些标准入口发现 URL，而不是自建全网爬虫或搜索引擎。

**被动选择**
候选进入中立目录后，用户自己的兔机米根据其数字之我和明确偏好，决定是否在「发现」页呈现。同一批公开候选，不同用户可以看见不同结果。

**主动发现**
用户可以直接对兔机米说「帮我找……」。兔机米会查看已接入的内容目录，并在已连接成熟搜索能力时（当前验证路径是 Gemini Search connector）帮助筛选、去重、理解和组织。它不自研爬虫，也不把搜索结果改写成中央推荐榜。

供应商 **不能** 购买某个用户的隐藏兴趣画像来做定向投放。中央网络不持有这类画像，也不提供按用户画像查询内容的接口。

联网搜索未开启时，不会偷偷访问公开网络；此时仅使用已有目录 / 网络内容。

---

## E. 用户怎样影响后续分发

只有用户的 **明确动作** 才会改变后续内容偏好，例如：

- 加推类似
- 少推类似
- 关注来源
- 不再看这个来源
- 撤销刚才的偏好

普通打开原文、稍后看，以及兔机米自己做出的呈现 / 忽略判断，**不会**自动变成用户的长期偏好。

供应商看不到、也买不到这些个人选择。

---

## F. 来源、版权与内容托管

- 默认保留原始来源和 canonical URL。
- 当前优先做索引 / 发现，并跳转回原内容；用户「打开原文」是打开源站，不是打开一份重新托管的副本。
- **不默认重新托管**受版权保护的媒体文件或全文。
- 供应商应保证自己有权发布所提供的内容及其标题、摘要等 metadata。
- 付费墙：可以索引公开可见的标题、来源和摘要；不会绕过登录、订阅或付费访问控制。当前阶段不做付费内容购买或结算。
- 当前没有供应商后台删除按钮。源站、Feed 或 sitemap 不可访问时，该次接入会失败；已进入目录且带有过期时间的条目会停止继续作为候选。若需要停止继续分发，Public Alpha 阶段由项目侧在接入验证时处理，而不是通过自助 CMS。

---

## G. 当前 Public Alpha 能力边界

当前 **没有** 提供：

- 完整供应商 CMS / 自助账号后台 / supplier portal
- 自助内容发布 API、SDK 或自动注册
- 广告投放系统
- 用户画像购买或定向
- 内容付费结算、创作者分成（未来付费内容接入是独立商业层，尚未上线）
- 大规模供应商分析后台
- 原生视频托管
- 原生移动端 App
- 全网爬虫、自有搜索引擎、全网预索引或全天候后台抓取

以上不是承诺清单。未写出的能力，默认尚未提供。当前优先免费公开内容的发现，用户访问原始网站。

---

## H. 如何参与

大多数公开网站无需单独「接入」。把内容放在可访问的 Web 上，并尽量提供 Feed Autodiscovery / canonical / sitemap / OpenGraph / schema.org 即可。

若你希望项目侧知晓某个源，或标准发现未能稳定找到你的内容，请使用已经存在的公开渠道，不要另找虚构邮箱或提交地址：

- GitHub Issues：https://github.com/zhongzhir/2digime/issues
- GitHub Releases：https://github.com/zhongzhir/2digime/releases
- 项目说明：https://github.com/zhongzhir/2digime
- 官网：https://zhongzhir.github.io/2digime/

机构如果希望按自己的品牌发行兔机米（白标 / 机构发行），那是另一条已有合作入口，不是内容供应商后台：

- https://zhongzhir.github.io/2digime/institution/

在 Issue 中说明：你的机构或产品名称、公开站点或 RSS / Atom 地址、内容类型，以及你希望兔机米用户如何发现这些内容。

---

## English (short)

**The public Web is 2digime’s default eligible content universe.** If your site already publishes in the open, you usually do not need a 2digime account, SDK, proprietary API, or taxonomy tags.

2digime is not a central ranking platform. URLs are discovered on demand via mature Search and standard Web protocols (RSS / Atom / feed autodiscovery / sitemap / public page metadata), then stored as **neutral directory** items. Each user’s own 2digime decides SHOW or IGNORE from that user’s Digital Self and **explicit** preferences. The network does not hold or sell personal interest profiles. Users open the **original site**; full copyrighted bodies are not re-hosted by default.

**Recommended (not required):** public RSS or Atom with feed autodiscovery, stable canonical URLs, sitemap, OpenGraph, and schema.org / JSON-LD.

**Not available in this Public Alpha:** a self-serve publish API, supplier portal, SDK, ads, profile targeting, payments, creator payouts, analytics product, native video hosting, a mobile app, or a general web crawler. Paid-content settlement is a future commercial layer, not shipped.

To talk to the project: open a [GitHub Issue](https://github.com/zhongzhir/2digime/issues) with your public site or feed URL.

Institution white-label distribution (not a CMS) is documented separately: https://zhongzhir.github.io/2digime/institution/
