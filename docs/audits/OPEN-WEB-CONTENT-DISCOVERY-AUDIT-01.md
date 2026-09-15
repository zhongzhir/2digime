# OPEN-WEB-CONTENT-DISCOVERY-AUDIT-01

**Status:** complete / implementation-ready  
**Date:** 2026-09-15  
**Worktree:** `D:\Projects\dm-open-web-content-discovery-01`  
**Branch:** `build/open-web-content-discovery-01`  
**HEAD / origin/main:** `1e57bd753cd226a23b78e513033737dacd61726c`

No product code was written before this audit.

---

## 0. 三个必须分开的概念

| 概念 | 含义 | 当前是否已有 |
|---|---|---|
| **ELIGIBLE** | 公开可访问、未被访问控制明确禁止的 Web 内容，原则上属于可发现范围。不表示已入库。 | 产品原则上有；代码未实现为范围对象。 |
| **DISCOVERED** | 经 Search / RSS / Atom / Feed Autodiscovery / sitemap 等标准来源实际得到 URL。 | Search 与 RSS/Atom 部分有；Autodiscovery / sitemap 无。 |
| **INDEXED** | 已取必要 metadata、canonicalize、provenance、dedup，写入现有 Content Directory / NetworkItem。 | RSS/Atom 与单 URL HTML 预览有；Search 命中默认不入库。 |

禁止把「互联网默认可发现」做成「预先抓取并存储整个互联网」。本任务只做：按需发现少量 URL → 规范化 → 现有目录 → 接收侧 SHOW/IGNORE → 一级发现页。

---

## 1. 当前 RSS/Atom 到 directory 已有哪些真实能力？

**已有（生产代码）：**

- `src/subject-comm/content-ingest.ts` `ingestSource`：`safePublicHttpGet` 拉取源 URL；RSS `<item>` / Atom `<entry>` 解析为 title/url/text/publishedAt；canonicalize + `contentItemId` 去重；`FileNetworkItemStore` / `MemoryNetworkItemStore.put`。
- `parseFeed`：自研正则 XML 切片，不是 npm 解析器。对标准 RSS 2.0 / Atom 的测试夹具与真实 BBC / HN RSS 已通过。
- `src/subject-comm/content-canonical.ts`：http(s)、去 tracking query、去 fragment、host 小写、itemId = `ni_` + sha256(canonicalUrl)。
- `NetworkItem`：`kind=content` / `visibility=public`；`provenance.origin=publisher`；禁止个性化字段。
- `src/subject-comm/content-directory.ts`：对已有 items 的本机全文投影，不是中央搜索引擎。

**没有：** Feed Autodiscovery、sitemap、把 Search URL 自动 `put` 进目录、供应商注册/专有 API。

**不值得重写：** 已工作的 `parseFeed` + `ingestSource` 是唯一摄入路径。本任务必须复用，不得第二套 feed ingestion。

---

## 2. 当前 Gemini Search result 如何进入 content pipeline？

`DigitalMeRuntime.resolveContentSearch`（`src/runtime/digitalme-runtime.ts`）：Settings 里保存的 Gemini Search key → `createGeminiSearchConnector` → `connector.search(query)` → `{ title, url, snippet }`。

`runContentSeek` → `seekContent`（`src/subject-comm/content-seek.ts`）：

1. 先按 query 匹配**已有目录**；
2. 若有 `searchWeb`，把 Gemini URL canonicalize 后做成 `DiscoverCard`，`source: 'web'`，`itemId: seek_N`；
3. **不调用 `ingestSource`，不 `store.put`。**

因此 Search 结果只存在于这一次 Discover/Talk 投影里。`later/boost` 对 web 卡没有目录权威；Talk 的 `resolveContentSeek` 甚至只走目录、不传 `searchWeb`。

Gemini `read(url)`（`src/capability/adapters/gemini-search.ts`）会抓页并 `htmlToText` 作 evidence chunk，这是搜索能力内部的读页，**不是** Content Directory 索引，也不得拿来默认存全文。

---

## 3. 普通公开网页目前缺哪一步才能成为 Content candidate？

`ingestSource` 在 body 不像 feed 时走 `parseHtmlPreview`：正则抽取 `og:title` / `og:description` / `og:url` / `<title>`。工程上**已经能**把单个 HTML URL 变成一条 NetworkItem（测试与供应商文档均写明：这不是对外发布通道）。

缺口是**调用链**，不是目录模型：

1. 没有从站点首页发现 feed/sitemap，再交给现有 `ingestSource`；
2. Search 命中 URL 没有自动走 `ingestSource`；
3. HTML metadata 不完整：无 `<link rel=canonical>`、无 JSON-LD、无可靠 publishedAt/author、无相对 URL 解析为站点基址之外的标准入口列表；
4. Discover 冷启动在目录为空时直接 `还没有新内容`，不会按需发现公开 Web。

默认仍只存 title / summary / canonical URL，不存整篇版权正文（`clipText` 上限 8000 是 feed 摘要上限，HTML 路径目前只用 description）。

---

## 4. Feed autodiscovery 是否已有？

**没有。** 全库无 `rel="alternate"` + `application/rss+xml` / `application/atom+xml` 的生产解析。JSON Feed（`application/feed+json`）也没有；**DEFER**，不为完整而自研。

---

## 5. sitemap 是否已有？

**没有产品 sitemap 解析。** 仓库内 `site/sitemap.xml` / `site/robots.txt` 只是 2digime 自己的静态站，不是运行时能力。

---

## 6. canonical / OpenGraph / JSON-LD 是否已有解析？

| 能力 | 状态 |
|---|---|
| URL canonicalize（tracking/host/hash） | 有，`normalizeCanonicalUrl` |
| HTML `<link rel=canonical>` | 无 |
| OpenGraph title/description/url | 有，正则 `parseHtmlPreview` |
| JSON-LD / schema.org Article | 无 |
| author / datePublished | feed 条目有日期；HTML 页无 |

---

## 7. robots / access restriction 当前如何处理？

`src/work-runtime/public-http-safety.ts` `safePublicHttpGet`：

- 只允许 http/https；拒绝 URL 凭据；
- 拒绝 localhost / 私网 / 链路本地等（含 DNS 钉死，防 rebinding）；
- 最多 3 次重定向，每次重验；
- 超时、body 上限 512KiB、非文本/xml/json 的 content-type 拒绝。

**没有** `robots.txt` 解析，自动发现路径不会看 `Sitemap:` 或 `Disallow`。  
401/403/404/410 由 `ingestSource` 记为 `unavailable`（`http_N`），不会带登录态重试。无付费墙绕过。

Bing/Gemini `htmlToText` 是搜索 evidence，不是索引器，不得升级成爬虫正文库。

---

## 8. 「联网搜索已开启」能否作为被动 Open Web Discovery 的授权边界？

**可以，而且应该复用，不要第二个开关。**

判定应以 `resolveContentSearch()` 是否得到 Gemini Search connector 为准（SecretStore / Settings「联网搜索」密钥）。这与旧环境变量 `DIGITALME_V2_SEARCH_ENABLED`（对话里 Bing closure 诊断开关）不是同一件事。

- 已开启：允许 recipient-side 按需对成熟搜索发**少量检索词**，并把返回 URL 规范化入库。
- 未开启：不得偷偷联网；只用已有 directory / network；UI 提示开启联网发现。

Digital Self、preference vector **不得**发给中央目录 / Relay / 搜索请求体。搜索请求只带短 query。

---

## 9. 怎样做到用户不指定网站，也能在 Discover 获得公开 Web 内容？

冷启动（V0.1，打开「发现」或「看看新的」，无后台轮询）：

1. 用户已开联网搜索；
2. 本地目录候选不足；
3. **本机** DeepSeek（现有 `contentChat` / subject understanding runtime）根据 Digital Self 摘要 + 用户明确内容偏好，提出 2–3 条公开检索词（不把 self.json 上传）；
4. Gemini Search live 返回 URL（DISCOVERED）；
5. 每条 URL：标准 metadata → 现有 canonicalize/dedup/`ingestSource`（INDEXED）；
6. 现有 `selectNetworkItems` 在本机 SHOW/IGNORE；
7. 一级发现页投影。

用户不必关注网站、提交 Feed、或在 Talk 里指定站点。也没有中央个性化推荐。

---

## 10. 哪些能力应用成熟标准/库，不值得自研？

| 需求 | 决策 |
|---|---|
| 搜索引擎 / 全网爬虫 | 禁止。用已有 Gemini Search。 |
| RSS/Atom 条目摄入 | **复用** `parseFeed` + `ingestSource`，不新写第二套。 |
| HTML DOM / `<link>` / OG / JSON-LD 抽取 | **接入** `node-html-parser`，禁止继续用正则当 HTML parser 扩张。 |
| robots.txt | **接入** `robots-parser`。 |
| sitemap XML | **接入** `fast-xml-parser`，限条数/深度/timeout。 |
| JSON Feed | **DEFER**。 |
| 选择/排序 | 复用 `selectNetworkItems` + 本机模型。禁止 score/ranker。 |
| HTTP 安全 | 复用 `safePublicHttpGet`。 |
| 发现 UI | 复用 `ContentDiscoverPage` 卡片动作。 |

**CAPABILITY SUFFICIENCY GATE**

1. 大模型会选内容、会写检索词；不会替系统做 SSRF/canonical/dedup。
2. Gemini Search 已能找到真实 URL；缺的是入库与冷启动调用。
3. Runtime 已有 `content` 命令、目录、Discover 页；缺暴露，不缺第二套产品。
4. 本任务只加：标准发现、Search→directory、打开 Discover 时的按需 Open Web。不替代模型智力。
5. 可删：Search 命中长期停留在 `seek_N` 临时卡、Talk 内嵌信息流（上轮已拆）。不要再加中央推荐。

---

## Build-vs-Integrate 结论

允许新增的确定性代码仅限：权限/安全边界、工具真实成败、文件/目录是否写入、timeout、标准协议解析的薄封装。

实现顺序：

1. `discoverOpenWebSource(url)`：autodiscovery → 现有 ingest；无 feed 时 sitemap fallback；普通页 metadata。  
2. Gemini URL → 同一 `ingestSource` / 同一 NetworkItem。  
3. Discover 冷启动：联网已开且目录不足 → 本机检索词 → Search → index → `selectNetworkItems`。
