# INSTITUTION-DISTRIBUTION-FOUNDATION-01

日期：2026-09-11  
状态：FOUNDATION  
Authority parent：`d23ede023cf68c555a79e58f433bd2d80f58f2f5`  
Governance commit：`3940cd301cac34687f7357c841a2bbae32d56d2d`  
前置：`POST_PUBLIC_ALPHA_GOVERNANCE_BASELINE_ACCEPTED`

## 0. 本文件回答的问题

要让银行、电信运营商、手机厂商等机构，把**同一个 2digime Core** 作为自有品牌 AI 产品分发给大量普通用户，**目前真正缺什么？**

结论摘要：

| 类别 | 现状 |
|------|------|
| A 已有可直接复用 | 本地 Subject / Digital Self / Talk / OpenAI-compatible 模型调用 / 本地密钥存储 / Electron+NSIS 打包 / Relay（仅作网络传输） |
| B 成熟组件应集成 | **LiteLLM Proxy**（LLM gateway：virtual key、budget、usage、多模型）；真实机构身份用 **OIDC/OAuth2/SAML**（不自研协议） |
| C 薄 adapter / configuration | Institution Adapter；Brand Kit（build-time + 少量 runtime）；把 `baseUrl`/`apiKey` 指到 gateway virtual key |
| D 2digime 必须新增 | 最小 Institution Backend（org / user mapping / entitlement 编排 / 对外 Integration API）+ 客户端 Institution Adapter 入口；**不**自研 ModelQuotaEngine / TokenBillingEngine / MultiModelGateway |

原则：Core 不 fork；机构不拥有用户 Digital Self；Relay ≠ Institution Backend。

> `personal-context.md` 不存在；按 `AGENTS.md` / `01` 不得另建第五份原则文件。权威仍为 00–03 + 本阶段治理文档。

---

## 1. Existing capability audit

证据基于当前源码，不以旧文档假设功能已存在。

### 1.1 判定总表

| # | 能力 | 判定 | 真实位置 |
|---|------|------|----------|
| 1 | Model Gateway / provider abstraction | **PARTIAL** | 本地 OpenAI-compatible 适配，非服务端 gateway。`src/infrastructure/model-http.ts`；`src/capability/adapters/openai-compatible.ts`；`electron/bootstrap-secrets.cjs`（`DEFAULT_PROVIDER_PRESETS`） |
| 2 | DeepSeek / OpenAI-compatible 调用 | **EXISTS** | `chatComplete` → `{baseUrl}/chat/completions`；Talk / converse / model executor 均经此路径；DeepSeek 为默认 preset |
| 3 | API Key 保存 | **EXISTS** | Electron `safeStorage` + `FileSecretStore` → `%userData%/secrets.v2.json`；非密配置 `model-config.json`（`bootstrap-secrets.cjs` / `secret-store.ts`） |
| 4 | usage / token / cost | **PARTIAL** | 仅透传 `usage.totalTokens`（`model-http.ts`）；Job 可挂 `costActual.tokens`；**无**租户/用户账本与强制额度 |
| 5 | Subject / local identity | **EXISTS** | `SubjectPackage.id`；`subject-service.ts`；通信身份 `crypto-identity.ts` / `identity-store.ts` |
| 6 | userData / Digital Self | **EXISTS** | `app.getPath('userData')`（可被 `DIGITALME_V2_USER_DATA` 覆盖）；`subjects/default`；`digital-self/self.json` |
| 7 | Talk request path | **EXISTS** | `talk.js` → IPC → `command-bus` `talk` → `DigitalMeRuntime.talk` → `TalkService` / `runTalkTurn` → `chatComplete` |
| 8 | Electron build / packaging | **EXISTS** | `electron-builder.yml`；NSIS+ZIP；`scripts/build-packaged.cjs`；`after-pack-win-icon.cjs` |
| 9 | product name / icon / theme / strings | **ABSENT**（可配置层） | 品牌硬编码于 `electron-builder.yml`、`index.html`、`talk.js`、`app.js`、`app-menu.cjs` 等；无 brand kit |
| 10 | Relay / Subject Network 边界 | **EXISTS** | `src/relay-service/server.ts`：加密邮局，不解释业务、不存 SubjectPackage；客户端 `relay-client.ts` / `relay-transport.ts`。**不是**机构 AI 后端 |
| 11 | 本地授权与审计 | **PARTIAL** | Grant / Owner 确认（协作与高风险）；GrowthEvent；**无**机构合规审计导出面 |
| 12 | HTTP server / backend / cloud | **PARTIAL** | 正式产品侧仅 Relay；`reference-agents/**` express 非产品核心。**无**账号/权益云服务 |
| 13 | 账号 / session / cloud identity | **ABSENT** | 无 signup / OIDC / 云会话；本地仅有对话 session |
| 14 | Institution Adapter 可用抽象 | **PARTIAL** | `DigitalMeRuntimeOptions.openaiCompatible` + `SecretAccessor` 可将 `baseUrl`/`apiKey` 指到外部兼容端点；**无** entitlement / virtual-key 合同模块 |

### 1.2 A / B / C / D 归类

**A — 当前已有，可直接复用**

- 同一 Core：Talk、Digital Self、本地 SubjectPackage、能力调用链路。
- OpenAI-compatible HTTP 客户端（可指向机构 gateway，无需改协议）。
- 本地加密密钥存储与 model-config。
- Electron + NSIS per-user 打包管线。
- Relay（仅 Subject Network 传输；保持解耦）。

**B — 成熟开源组件已有，应集成**

- **LiteLLM Proxy**：OpenAI-compatible proxy、多 provider、virtual keys、user/team、budget、model access、spend/usage、rate limit、key expiration、Postgres、management API。
- **OIDC / OAuth2 / SAML**：真实机构身份（Demo 可用 mock，接口可替换）。
- **Postgres**（LiteLLM virtual keys / spend 所需；Demo 可用本地/容器）。
- **electron-builder**：白标打包入口（已在用）。

**C — 只需薄 adapter / configuration**

- 客户端：Institution mode 下用机构签发的短期/virtual credential 替代用户自填上游 master key；`baseUrl` → 机构 LiteLLM。
- Brand Kit：productName / icon / strings / theme 的 build-time（及必要 runtime）配置，不 fork 仓库。
- Institution Backend ↔ LiteLLM management API 的编排（创建 key、设 budget、读 spend）。
- Demo Telecom mock identity adapter。

**D — 2digime 确实必须新增（刻意最小）**

1. **Institution Backend（薄）**：Organization、User Mapping、Entitlement 策略编排、Integration API、向 LiteLLM 发放/吊销 virtual key、聚合机构侧必要 usage metadata（可主要读 LiteLLM）。
2. **Institution Adapter（客户端）**：识别机构部署模式；领取/刷新受限 credential；把凭证注入现有 SecretStore / model-config；**不**上传 Digital Self / Talk 正文。
3. **Brand configuration 装载**：单一配置源驱动 builder + UI 文案/图标。

**禁止自研（因 LiteLLM 已覆盖）：**

- ModelQuotaEngine  
- TokenBillingEngine  
- LLMUsageTracker（作为独立产品内核）  
- VirtualKeyService  
- MultiModelGateway  

---

## 2. Build-vs-Integrate decision

### 2.1 LLM Gateway → 采用 LiteLLM Proxy

| 需求 | LiteLLM OSS 文档结论 | 2digime 动作 |
|------|----------------------|--------------|
| OpenAI-compatible proxy | 支持 | 客户端继续 `chatComplete` |
| 多模型 provider | 支持 | 配置 model_list，含 DeepSeek 等 |
| virtual keys | 支持（需 Postgres + master key） | 客户端只持有 per-user virtual key |
| user / team | 支持 | team ≈ 机构；user/key ≈ 终端用户 |
| per-user / per-team budget | 支持 | 服务端强制超额拒绝 |
| model access | 支持 | 按 key/team 限制模型 |
| spend / usage tracking | 支持 | Institution Plane 读 metadata |
| rate limits / key expiration | 支持 | 配置即可 |
| Postgres persistence | 支持 | Demo 本地容器 |
| management API | 支持 `/key/generate` 等 | Backend 调用，不自研 key 引擎 |
| SSO / auth | OSS：virtual key + 有限 SSO；规模化 SSO/SCIM/JWT 多为 Enterprise | **v0.1 不依赖 LiteLLM Enterprise SSO**；用 Institution Backend mock/OIDC 发 key |

**不采用 LiteLLM 的条件（当前不成立）：** 仅当无法关闭正文 logging、无法 virtual key、或许可与商业实质冲突。官方文档：`store_prompts_in_spend_logs` **默认关闭**；`turn_off_message_logging` 可进一步 redact。  
**真实验证状态：** 本 Foundation 以官方文档 + 源码审计为准；**未**在本机跑通隔离 spike（无落库测试密钥）。Implementation 切片必须做一次真实 spike 验收隐私硬门槛。

**许可：** LiteLLM 核心自托管为开源（MIT）；Enterprise 为可选治理增强。v0.1 路径不强制购买。若未来机构强依赖 LiteLLM Admin UI 的大规模 SSO，再走 Owner Decision Gate（付费 / 或自建 OIDC→Backend→virtual key，后者仍可避免锁定）。

### 2.2 Identity

- 真实机构：OIDC / OAuth2 / SAML → Institution Backend 映射 → 签发/刷新 LiteLLM virtual key。
- Demo v0.1：mock institution identity（两个用户、不同 entitlement）。
- **不自研**身份协议。

### 2.3 White Label

- 复用 `electron-builder.yml` + `scripts/build-packaged.cjs` + icon/rcedit 管线。
- 引入 brand config（JSON/YAML）覆盖 `productName`、icon 路径、shortcutName、关键 UI 字符串。
- **禁止**招行/电信专用仓库 fork。

### 2.4 Relay 边界（硬规则）

| | Relay | Institution Plane |
|--|-------|-------------------|
| 职责 | 数字主体网络连接 / 传输 / 密文投递 | 机构用户、entitlement、usage、brand、integration |
| 数据 | 密封信封；不持有 SubjectPackage | 计量与权益；**无** prompt/Digital Self |
| 演进 | 可共享底层 hosting | **不得**混成同一业务服务 |

不得把 `src/relay-service` 改造成 Institution Backend。

---

## 3. 模型额度架构（机构版）

```text
institution provider master key(s)     ← 仅存 LiteLLM / 机构密钥保管
        ↓
server-side LiteLLM Proxy
        ↓
per-user / per-team virtual key + budget + model allowlist
        ↓
2digime client (Institution Adapter)
```

强制原则：

1. 客户端**不得**获得机构上游 master provider key。  
2. Quota 在 **LiteLLM 服务端**强制；单用户超额只影响该用户。  
3. 机构可统计必要用量（tokens / spend / model / timestamps）。  
4. 个人版路径（用户自备 API Key）保留；机构模式为并行配置，不破坏个人版。

当前个人版：用户密钥在本地 `secrets.v2.json`。机构版：本地只存机构签发的受限 credential（virtual key / 短期 token），`baseUrl` 指向机构 gateway。

---

## 4. Institution Plane / Local Subject Plane 数据边界

### 4.1 Institution Plane 可以有

- institution user id  
- entitlement（套餐、quota、模型池引用）  
- provider/model（机构侧配置，非用户私人选择日志）  
- quota / used / remaining  
- usage / cost / timestamps  
- account status（active / suspended）  
- brand / integration 配置引用  

### 4.2 Local Subject Plane 默认保留

- Digital Self  
- Talk 内容（prompt / response）  
- 本地文件与 artifacts  
- memory / relationship / preference  
- 通信私钥与 SubjectPackage  

### 4.3 Institution Plane 默认禁止

- prompt / response 正文  
- Digital Self 内容  
- 私人文件与长期记忆  

### 4.4 LiteLLM 隐私硬门槛（v0.1）

部署必须确认：

1. `general_settings.store_prompts_in_spend_logs` **保持 false**（文档：默认不存 request/response 正文）。  
2. 设置 `litellm_settings.turn_off_message_logging: true`（进一步防止回调/日志通道写入正文）。  
3. 验收时检查 Postgres `LiteLLM_SpendLogs`（及 UI Logs）仅有计量 metadata，无 messages/content。  
4. 已知社区 issue：在**同时开启** store_prompts 时 redaction 曾不完整 → **v0.1 禁止开启 store_prompts**，不做「开启后再 redact」路线。

这是 v0.1 硬门槛；未通过不得宣称 `INSTITUTION_DISTRIBUTION_V01_ACCEPTED`。

---

## 5. White-label 方案

最小 Brand Kit 字段：

- `productName` / `organizationName`  
- `appId`（可选变体，避免安装冲突时再评估）  
- `icon` / `logo` 路径  
- `supportUrl` / `supportText`  
- `themeTokens`（有限）  
- `defaultGatewayBaseUrl`（机构部署）  
- UI 关键字符串表（标题、空态、关于）

实现策略：

1. **Build-time：** 生成/覆盖 `electron-builder` 的 `productName`、icon、shortcut、artifact 命名。  
2. **Runtime：** 读取打包内 `brand.json` 投影到 renderer；缺省回退兔机米。  
3. 同一 Core 二进制逻辑；不同 brand 用不同 config 产出安装包（或同一包 + 机构配置注入——v0.1 优先 **build-time 白标包**，更简单、更符合预装分发）。

---

## 6. Identity / entitlement / usage contract（v0.1）

### 6.1 概念

```text
Organization { id, name, status, brandRef, gatewayRef }
InstitutionUser { institutionUserId, status, entitlementGroup }
Entitlement { providerPool, models[], quotaType, quotaAmount, validFrom, validTo }
CredentialGrant { virtualKeyRef, expiresAt, scopes }   // 客户端可见的是受限 secret，不是 master key
UsageEvent { institutionUserId, model, tokens|spend, timestamp }  // 无正文
```

### 6.2 客户端 ↔ Backend（示意）

- `POST /v0/session/exchange`：mock/OIDC assertion → 返回 gateway baseUrl + virtual key（或短期兑换句柄）。  
- `GET /v0/entitlement`：当前权益摘要（给 UI「剩余额度」可选；强制仍在 gateway）。  
- `GET /v0/usage/summary`：机构侧汇总（Demo 管理面）。  

### 6.3 Backend ↔ LiteLLM

- 用 master key 调 `/key/generate`、`/key/update`、`/key/info`、`/user/info` 或 `/team/info`。  
- Entitlement 变更 = 更新 virtual key budget / model list / block。  

### 6.4 客户端 ↔ LiteLLM

- 现有 `chatComplete(baseUrl, apiKey=virtualKey, model)`。  
- 超额：透传 4xx；UI 用普通人语言说明「额度已用完」，不引入第二套本地 quota 引擎。

---

## 7. 最小部署拓扑

```text
[白标 2digime 客户端]
        │  OpenAI-compatible HTTPS
        │  Authorization: Bearer <virtual key>
        ▼
[LiteLLM Proxy] ── provider master keys ──► DeepSeek / 其它
        │
        │  management API (master key; 仅 Backend)
        ▼
[Institution Backend] ◄── mock identity / 未来 OIDC
        │
        ├── Postgres（LiteLLM）
        └── 自有薄库（org / mapping / brand）可选与 LiteLLM DB 分离

[Relay]  —— 独立进程/域名；与上图无业务耦合 ——
```

Demo Telecom：单机 Docker Compose（LiteLLM + Postgres + Backend）即可。

---

## 8. v0.1 需要新增的最薄代码

| 模块 | 性质 | 是否改 Core 思考链路 |
|------|------|----------------------|
| `institution-backend`（独立小服务） | org/user/entitlement 编排 + LiteLLM admin 客户端 | 否 |
| `institution-adapter`（Electron/runtime 薄层） | 兑换凭证、写入现有 secrets/model-config | 否（注入配置） |
| `brand-kit` 配置与打包钩子 | builder + UI 字符串 | 否 |
| Demo 管理脚本/最小 API | 创建两用户、查用量 | 否 |

**不需要修改：** Talk 语义循环、Digital Self 写路径、Relay 协议、自研 gateway。

**允许的最小 Core 触点（非语义）：** 启动时读取 brand；机构模式下跳过「请填自己的 API Key」引导，改为 adapter 兑换；错误映射额度耗尽。

---

## 9. 明确不做事项

- 大型多租户 SaaS 管理后台  
- 招行/电信专用 Core 或仓库 fork  
- 自研 ModelQuotaEngine / TokenBillingEngine / VirtualKeyService / MultiModelGateway  
- 把 Relay 改成 Institution Backend  
- 机构侧保存 prompt / response / Digital Self  
- Landing Page（属 Phase 3）  
- Subject Network 漫剧试验（属 Phase 4）  
- 真实银行/运营商生产对接  
- 支付系统、合同系统、企业级合规认证全套  
- 本轮产品代码实现（本文件为 Foundation；实现见 Implementation plan）

---

## 10. 下一 implementation slice

见 [`docs/plans/INSTITUTION-DISTRIBUTION-V01-IMPLEMENTATION-01.md`](../plans/INSTITUTION-DISTRIBUTION-V01-IMPLEMENTATION-01.md)。

唯一下一产品实现任务（本 Foundation 验收后）：

1. 隔离 LiteLLM spike（真实请求 + budget + **确认无正文落库**）  
2. 最小 Institution Backend + Demo 两用户  
3. 客户端 Adapter 指向 gateway  
4. 一套 Brand Kit 白标包  
5. 按 `INSTITUTION-DISTRIBUTION-01.md` 十条验收  

目标 verdict：`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`

---

## 11. Owner Decision Gate（本轮）

| # | 问题 | 本轮结论 |
|---|------|----------|
| 1 | 必须改变 Core？ | **否**（薄适配） |
| 2 | 必须让机构获得私人主体数据？ | **否**（硬禁止） |
| 3 | 必须采用明显供应商锁定？ | **否**（LiteLLM MIT 自托管；可替换为其它 OpenAI-compatible gateway） |
| 4 | 开源许可商业冲突？ | **否**（v0.1 用 OSS 能力） |
| 5 | 需付费基础设施才能继续验证？ | **否**（本地/容器 Postgres + 现有测试模型额度即可；密钥不落库） |

**无必须升级 Owner 的决策项。**  
备注（非阻断）：未来大规模 LiteLLM Admin SSO 可能触发 Enterprise 许可或「自建 OIDC→发 key」二选一——留到真实机构对接时再提请 Owner。

---

## 12. Verdict（Foundation）

`INSTITUTION_DISTRIBUTION_FOUNDATION_ACCEPTED`（本文件落盘并提交后生效）
