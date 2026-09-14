# 为兔机米用户提供内容

# Providing Content to 2digime Users

面向内容创作者、媒体、出版机构和平台的公开说明。  
Public Alpha · 2026-09-14

本文只写当前已经真实存在的能力。没有公开自助发布后台，也没有对外内容发布 API。

---

## A. 兔机米的内容分发是什么

兔机米不是传统的中央推荐平台。它不会在中心侧为每个用户建立兴趣画像，再按画像统一推送；也不会向供应商出售或暴露用户画像。

供应商把内容提供到内容网络后，大致会经历：

1. 内容进入一份中立的内容目录 / 网络；
2. 每个用户自己的兔机米收到相同的公开候选；
3. 该用户自己的数字之我，以及他明确表达过的偏好，在本机决定 **呈现** 还是 **忽略**；
4. 用户在自己的兔机米里打开、稍后看，或明确说「加推类似 / 少推类似」。

选择发生在接收方自己的兔机米上，不发生在中央网络。

---

## B. 供应商现在需要准备什么

**当前正式可用、也最简单的路径是公开稳定的 RSS / Atom Feed。**

Public Alpha **当前尚未提供自助内容发布 API。** 没有对外的内容提交地址、注册接口或供应商 portal。请不要等待一份并不存在的公网 API。

工程上可以对单个公开 HTTPS 页面做预览摄入，但这 **不是** 对外自助发布通道。单篇文章 HTML 也不能代替 Feed：稳定更新请使用 RSS / Atom。

供应商现在最需要准备：

1. 一个可被标准 HTTPS 访问的公开 RSS 或 Atom Feed；
2. 每条内容有稳定的原始 URL（建议即 canonical URL）；
3. Feed 条目中尽量包含：
   - title
   - 原始 / canonical URL
   - published time
   - 来源名称（Feed 标题即可）
   - summary / description
4. 保持 Feed 可被公开读取；不要把正式内容只放在需登录的墙后；
5. 内容更新、删除或过期时，保持源站状态真实。

当前会实际用到的来源信息主要是：**标题、摘要/正文预览、原始 URL、发布时间、来源名称**。  
不要求供应商维护封面图、复杂标签体系或专用 JSON 字段。Feed 里如果带有作者名或其他 metadata，可以作为来源信息，但当前不会把它们当成必须填写的独立字段。

---

## C. 标签与分类

供应商 **不需要** 人工填写一套兔机米专用分类法。

兔机米可利用 AI 对已进入网络的内容做必要的类型识别、摘要、主题理解和搜索所需描述。这些理解服务于用户侧的发现与选择，不是要供应商维护 taxonomy。

如果你的 Feed 里已经有 tags，可以把它们当作来源信息保留在原文站点；当前不要求、也不提供一套必须同步的公开标签表。

---

## D. 内容如何被用户发现

当前有两条真实机制：

**被动发现**  
内容进入中立目录后，用户自己的兔机米根据其数字之我和明确偏好，决定是否在「与兔机米」旁的发现区呈现。同一批公开候选，不同用户可以看见不同结果。

**主动发现**  
用户可以直接对兔机米说「帮我找……」。兔机米会查看已接入的内容目录，并在已连接成熟搜索能力时（当前验证路径是 Gemini Search connector）帮助筛选、去重、理解和组织。它不自研爬虫，也不把搜索结果改写成中央推荐榜。

供应商 **不能** 购买某个用户的隐藏兴趣画像来做定向投放。中央网络不持有这类画像，也不提供按用户画像查询内容的接口。

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
- **不默认重新托管**受版权保护的媒体文件。
- 供应商应保证自己有权发布所提供的内容及其标题、摘要等 metadata。
- 当前没有供应商后台删除按钮。源站或 Feed 不可访问时，该次接入会失败；已进入目录且带有过期时间的条目会停止继续作为候选。若需要停止继续分发，Public Alpha 阶段由项目侧在接入验证时处理，而不是通过自助 CMS。

---

## G. 当前 Public Alpha 能力边界

当前 **没有** 提供：

- 完整供应商 CMS / 自助账号后台
- 自助内容发布 API 或自动注册
- 广告投放系统
- 用户画像购买或定向
- 内容付费结算、创作者分成
- 大规模供应商分析后台
- 原生视频托管
- 原生移动端 App

以上不是承诺清单。未写出的能力，默认尚未提供。

---

## H. 如何参与

Public Alpha 阶段，请先提供你现有的公开 Feed / 内容源；由项目侧完成接入验证。后续再逐步开放标准化自助接口——**现在还没有**。

请使用已经存在的公开渠道，不要另找虚构邮箱或提交地址：

- GitHub Issues：https://github.com/zhongzhir/2digime/issues
- GitHub Releases：https://github.com/zhongzhir/2digime/releases
- 项目说明：https://github.com/zhongzhir/2digime
- 官网：https://zhongzhir.github.io/2digime/

机构如果希望按自己的品牌发行兔机米（白标 / 机构发行），那是另一条已有合作入口，不是内容供应商后台：

- https://zhongzhir.github.io/2digime/institution/

在 Issue 中说明：你的机构或产品名称、公开 RSS / Atom 地址、内容类型，以及你希望兔机米用户如何发现这些内容。

---

## English (short)

2digime is not a central ranking platform. Content enters a **neutral directory**; each user’s own 2digime decides SHOW or IGNORE from that user’s Digital Self and **explicit** preferences. The network does not hold or sell personal interest profiles.

**Supported now for suppliers:** a public, stable **RSS or Atom** feed over HTTPS, with a stable original URL per item, plus title, published time, source name, and summary when available.

**Not available in this Public Alpha:** a self-serve publish API, supplier portal, auto-registration, ads, profile targeting, payments, creator payouts, analytics product, native video hosting, or a mobile app. A one-off public HTTPS page can be preview-ingested in code; it is **not** a public onboarding channel.

To participate: open a [GitHub Issue](https://github.com/zhongzhir/2digime/issues) with your public feed URL. Project-side validation comes first; a standardized self-serve interface is not live yet.

Institution white-label distribution (not a CMS) is documented separately: https://zhongzhir.github.io/2digime/institution/
