# DISCOVER-PERSONAL-FEED-01 审计

**日期：** 2026-09-18  
**基线 HEAD：** `60b3278736c421a30a4862e199797327b75a3dbf`（DISCOVER-CONTENT-CONSUMPTION-02）  
**Authority：** `origin/main` = `9dba88a49455248a2738412c22d99d1a1436df6d`  
**性质：** 只读审计。实现前证明现有 Discover 主路径不够，不是新推荐平台。

---

## Owner 空页面链路

```text
打开「发现」
  → content.action=discover
  → runContentDiscover
  → 需要已连接对话模型，否则直接空
  → loadDiscoverItems（Relay 或本地 Directory，limit 50）
  → 仅当 items.length === 0 且 resolveContentSearch() 有函数时 cold start
  → discoverForSubject 做接收侧选择
  → 非具体卡被滤掉
  → UI：cards=[] 时永远展示静态「开启联网发现后……」
```

搜索框路径是另一条：`seek` 且 **query 为空直接拒绝**（`请先说想找什么。`）。  
默认打开 Discover **不会**走 seek，也 **不会**在「目录里已有但不够具体 / 过旧」时补量。

---

## 六个必须回答的问题

### 1. 当时联网发现到底是什么状态？

代码里没有 AVAILABLE / DISABLED / NOT_CONFIGURED / AUTH_FAILED / TEMPORARY_ERROR。

| 实际机制 | 效果 |
|---|---|
| `openWebSearchEnabled()` | 产品路径几乎恒为 true；仅 Electron 测试可关 |
| `resolveContentSearch()` | 无 Gemini key → `undefined`（静默） |
| cold start / seek 的 `searchWeb` catch | 失败被吞掉，不记录 401 / 空结果 / 全被过滤 |

因此 Owner 截图无法从产品态区分：

- `NETWORK_NOT_CONFIGURED`（无 key）
- `NETWORK_AUTH_FAILED`（key 已配但 401）
- `DIRECTORY_EMPTY` 且搜索返回 0
- 有命中但 `NO_CONSUMABLE_CANDIDATES`
- `MODEL_SELECTION_EMPTY`

**最可能的叠加（与截图文案一致，而不是「Settings 真的没开联网」）：**

1. 默认 Discover 若 Directory 非空则 **不补量**；若为空则 cold start，失败被吞。
2. 无论真实联网态如何，空列表都渲染静态句「开启联网发现后……」。
3. runtime 若返回「还没有新内容。开启联网发现后……」，`friendlyNotice` 会把整句剥掉，只剩 HTML 静态空态。

### 2. 「开启联网发现后……」是否准确反映 Settings？

**不准确。** 该句写死在 `electron/renderer/index.html` 的 `#content-discover-empty`。  
`empty.hidden = lastCards.length > 0`。只要没卡，这句话就出现，与 `geminiSearchConfigured` 无关。

Settings「已配置」只表示 SecretStore 里有 `gemini-search` key，且 `rebootstrapAndNotify` 会把 key 交给 `runtime.options.geminiSearchApiKey`。Discover **没有**读取该 status 来改空态文案。

### 3. Gemini API Key 已配置时，Discover 是否识别为联网可用？

**只识别「有没有 search 函数」，不识别「这次能不能搜」。**

- 有 key：`resolveContentSearch()` 返回函数，空 Directory 会 cold start。
- 无 key：当 Directory 为空时 notice 走「开启联网发现后……」。
- 有 key 但 401：cold start catch 后 Directory 仍空，notice 变成「这次没有找到可直接消费的内容。」——同时 HTML 仍说「开启联网发现」。
- 不探测 AUTH_FAILED，也不保留旧 Feed。

### 4. 搜索失败以后为什么没有保留旧 Feed？

没有 Feed 缓存。每次 `discover` / `open` / `boost` 都重跑 `runContentDiscover`。失败或空选择就返回 `cards: []`。Renderer `renderView` 用新 view 覆盖，`refresh()` 失败时甚至主动渲染空 view。

### 5. 当前 Directory 实际有多少可消费 item？

本审计不读取 Owner 试用机 userData（避免污染试用现场）。代码事实：

- 列表上限 50。
- cold start **只在 `items.length === 0`**。
- 非空但全是站点/频道/非具体项时：**不补量**，再被 `isConcreteContentCard` 滤光 → 空 Feed。
- cold start 默认 `indexSearchHits`，不优先 `ingestSource` 吃开放 Feed。

### 6. Discover 打开时是否主动补量？

**仅 Directory 完全为空且 search 函数存在时。**  
用户不输入时的主路径不是「读上次 Feed → 不足再补」，而是「有库存就选择，没库存才搜；没 query 就不 seek」。

---

## Reason code（内部诊断）

| Code | 含义 |
|---|---|
| `DIRECTORY_EMPTY` | 本地/Relay 无可消费 NetworkItem |
| `NETWORK_DISABLED` | 测试或显式关闭联网发现 |
| `NETWORK_NOT_CONFIGURED` | 无 Gemini Search 凭据 |
| `NETWORK_AUTH_FAILED` | 凭据在但认证失败（如 401/403） |
| `NETWORK_TEMPORARY_ERROR` | 超时、配额、5xx、空结果等瞬时失败 |
| `NO_CONSUMABLE_CANDIDATES` | 有 URL/条目，滤完后无具体可消费项 |
| `MODEL_SELECTION_EMPTY` | 候选在，接收侧选择后无 SHOW 或选择失败 |
| `AI_NOT_CONNECTED` | 无对话模型，无法做数字之我选择 |
| `CACHED_FEED` | 使用上次成功 Feed |
| `REPLENISHED` | 本轮自动补量后选出 |
| `CURRENT_INTENT` | 用户输入覆盖，不是默认 Feed |

UI 不得展示这些 code。

---

## 现有能力够不够？（Capability Sufficiency）

已有且必须复用：Content Directory、NetworkItem、`seekContent`、`ingestSource`、开放 Feed / Media RSS / JSON Feed / schema.org / oEmbed、`selectNetworkItems`、explicit `content-preferences`、Gemini Search、对话模型。

不够的只有机械事实与生命周期：

1. 打开 Discover ≠ 先搜索；
2. 上次成功 Feed 必须可重放；
3. 联网态必须可诊断；
4. 失败不得清空；
5. 短期行为不得写进 Digital Self / 长期偏好。

禁止新建中心推荐、用户向量、engagement 模型、dwell tracking。
