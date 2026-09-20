# ZERO-START-MANAGED-AI-01 — AUDIT

**Status:** implementation-ready（无 Owner 架构冲突）  
**Date:** 2026-09-20  
**Worktree:** `D:\Projects\dm-discover-personal-feed-01`  
**Branch:** `build/discover-personal-feed-01`  
**HEAD at audit:** `11bfec4983715e677e95fce7f2cef88ce3863965`  
**Live Relay Web Discovery SHA:** `116f351`  
**Prerequisite:** `CN_ZERO_START_WEB_DISCOVERY_ACCEPTED`

写产品代码前完成。本文件回答八个必答问题。结论：复用 `relay.muhub.cn`，在能力层插入 Managed AI Gateway；上层只认 `AI_CAPABILITY`。

**TRIAL_ABUSE_RESISTANCE_LIMITED** — 本轮只有 per-install + rate limit + global ceiling，不是强反作弊。

---

## 0. Current facts

| Area | Current state | Binding |
|---|---|---|
| Talk / Digital Self / Work chat | `resolveSubjectUnderstandingRuntime` → SecretStore `openai-compatible` key → `chatComplete` → DeepSeek `/chat/completions` | Client BYOK |
| `bootstrap-secrets.cjs` | 无 Key → `ok:false` `documentCapability:'none'` `needsCredentialSetup:true` | 欢迎页 / Settings 逼填 API Key |
| Adapter | `createOpenAiCompatibleAdapter`：`secrets.get` 失败则「请先配置模型接口凭证」 | BYOK |
| `model-http.ts` | 只解析 `usage.total_tokens`；DeepSeek 同时给 `prompt_tokens` / `completion_tokens`（及 `input_tokens` / `output_tokens`） | 计量缺口 |
| SecretStore | `secrets.v2.json` + Electron safeStorage；`model-config.json` 无密钥 | 必须保留 |
| Preference | 仅 `web-discovery.json` `managed\|byok` | AI 无对等文件 |
| Relay | `/health` `/v1/web-discovery/search` `/v1/network-items` `/v1/envelopes`；无 inference | 可复用 |
| Install identity | `install-capability-token.json` 64-hex，配额身份，非画像 | 复用为 principal 原料 |
| Settings / Welcome | 「连接 AI」+ DeepSeek API Key 一等公民 | 产品语义错误 |
| `NO_MODEL_NOTICE` | 「需要先连接 AI 能力」 | 无 Key 即失败 |
| 发送给模型的上下文 | Talk：当前输入 + 线程历史 + `formatSelfContext(liveUnderstandings)`；Digital Self interpret：CURRENT 理解列表 + 本轮原文。**不是**默认上传 `self.json` 文件 | 保持；Gateway 拒收完整档案键 |
| 开发静默导入 | `DIGITALME_V2_ALLOW_DEV_CREDENTIAL=1` 才导入 `.runtime-model-credential.json`；默认不导入 | 零配置路径可测 |
| Institution UI | Settings 演示机构连接，走另一套虚拟 Key | 本轮不改后台；allowance schema 预留 INSTITUTION |

Owner 已有 DeepSeek BYOK。迁移规则必须保留 Key，不得因升级改写用户已明确的路径。

无架构冲突，不需要 Owner 决策即可实施。Live 部署若服务器没有 DeepSeek **服务端** Key，停在 `MANAGED_AI_PROVIDER_SECRET_REQUIRED`。

---

## 1. 当前为什么必须用户 BYOK？

因为对话通道只有一条：本机 SecretStore 里的 DeepSeek（OpenAI-compatible）凭证。

1. Settings / 欢迎页把 API Key 当产品入口。
2. `resolveModelConfig` 无 Key 则 `modelReady=false`，runtime `documentCapability=none`。
3. Talk / Digital Self / converse 都经 `resolveSubjectUnderstandingRuntime`，没有 secrets+config 就 `runtime=null` → `NO_MODEL_NOTICE`。
4. Adapter 没有 Key 直接拒绝。
5. 仓库禁止把 provider secret 打进安装包。没有 Relay inference 时，唯一办法是用户自己申请 DeepSeek Key。

这是开发者路径，不是普通用户路径。联网发现已经证明：同一 Relay + install token 可以把 BYOK 降为高级路径。AI 应对齐该结构。

---

## 2. 哪一层最适合插入 managed provider？

**能力层 + Relay，不要改 Talk / Digital Self / Work 业务逻辑。**

插入点：

1. **Relay** `POST /v1/ai/inference`：server-only DeepSeek Key、allowance、计量、限流、转发、规范化、失败态。
2. **Client capability** `ManagedAiChatComplete`：install token + preference `managed|byok`。
3. **`OpenAiCompatibleAdapterConfig.complete`**：托管通道注入；Talk / Digital Self / converse / 文档 Adapter 继续走现有 `chatComplete` 形状，不认识 `deepseekApiKey`。
4. **`resolveSubjectUnderstandingRuntime`**：若 `complete` 存在则启用，无需本地 Key。

不插入：keyword router、第二套 planner、中央 Digital Self、按 allowance source 分叉的 Talk 逻辑。

上层只认 `AI_CAPABILITY`（MANAGED / BYOK）。`deepseek-v4-flash` 只留在 Relay provider 配置。

---

## 3. 能否复用现有 Relay？

**YES — `createRelayServer` + `https://relay.muhub.cn`。**

已有：公网 TLS、install capability token、禁止画像字段、`logSafe`、server-only env、`RELAY_DATA_DIR` 文件账本风格。

本轮薄加：

- `POST /v1/ai/inference`
- `GET /v1/ai/allowance`（剩余百分比，不展示 5,000,000）
- `ai-allowance/` + `ai-idempotency/` 文件
- env：`MANAGED_AI_PROVIDER` / `MANAGED_AI_PROVIDER_API_KEY` / `MANAGED_AI_TRIAL_TOKEN_LIMIT`

不加：账号系统、支付、推荐、记忆、机构后台、第二套 AI 平台。

Gateway **不**做 Digital Self / ranking / memory / planning / recommendation。只做 credential、allowance、metering、rate limit、forward、normalize、failure。

---

## 4. 如何记录 token 用量而不建立用户画像？

- `principalId` = `sha256(installCapabilityToken)` 截断，**不是**用户画像 ID，不存姓名/兴趣。
- Ledger 只存：`allowanceId` `principalId` `source` `provider/model scope` `tokenLimit` `tokensUsed` `inputTokens` `outputTokens` `requestCount` `validFrom` `expiresAt` `status`；机构预留 `issuerId` `poolId`。
- 运营日志：request id、principal hash、provider/model、input/output/total tokens、latency、status、allowance balance。
- **禁止**持久化 prompt / response / conversation / Digital Self / embeddings。
- 幂等：磁盘只记 requestId→usage；完成结果仅内存短 TTL 回放，避免重试双扣且不长期存正文。
- 审计能回答某 principal 的 source/limit/used/remaining，**不能**回答「这个人喜欢什么」。

一次性 trial，默认 `MANAGED_AI_TRIAL_TOKEN_LIMIT=5000000`（可配置，非永久商业承诺）。计入 input+output。不承诺每月赠送。

---

## 5. 当前哪些上下文会发送给模型？

| 通道 | 客户端装配 | 是否完整 self.json |
|---|---|---|
| Talk | 系统角色说明 + **当前 live understandings 文本列表** + 本线程对话 + 用户本轮输入 + 工具结果 | 否。是理解条目投影，不是 `digital-self/self.json` 文件 |
| Digital Self interpret | 系统 JSON 合同 + CURRENT 理解 id/text/status/facet + 本轮原文/资料名 | 否。为「理解这句话」所必需 |
| Work / document | 任务目标 + 授权材料摘录 | 否 |
| Web Discovery | 仅 query（已 live） | 否 |

Managed 推理**必须**看到当前任务内容；不得宣称「任何 Digital Self 信息都不离开本机」。正确边界：只发当前任务必要上下文；Gateway 拒绝 `digitalSelf` / `self.json` / `facts` / `preferences` / `embeddings` / `profile` 等额外键；服务器 transient forward。

本轮**不**改 `selectSelfContext`（那会改 Talk 业务逻辑）。只保证不新增默认整文件上传。

---

## 6. 如何避免自动上传完整 Digital Self？

1. Inference 请求白名单：`messages` `temperature` `maxTokens` `tools` `toolChoice` `responseFormat` `idempotencyKey`。
2. 命中禁止键 → `payload_rejected`，不转发。
3. 不新增「把 self.json 交给 Gateway」的 API。
4. Talk 继续只投影 live understandings，不读盘上传档案。
5. 服务器不写 prompt/response 文件。

---

## 7. BYOK 如何无损切换？

文件 `ai-capability.json`：`path: managed | byok`。

迁移：

- 已有 preference → 服从。
- **无 preference 且 SecretStore 已有 openai-compatible Key**（升级前已连接用户）→ 写入 `path=byok`，保留 Key。
- 否则（全新 userData）→ `path=managed`。

不得因本机仍有旧 Key 就在用户未选择时把默认从 BYOK 改成 MANAGED。也不得删除 SecretStore。

运行时：MANAGED 且 allowance 可用 → Gateway。用户明确 BYOK → 本机 DeepSeek。Managed 暂时不可用且用户已启用 BYOK → BYOK；否则诚实失败，**不得**把 server secret 错误说成用户没配 Key。

Settings：普通面「AI 能力：可用 / 兔机米提供（推荐）/ 剩余 xx%」。高级面才出现 DeepSeek / API Key / Endpoint。

---

## 8. institution allowance 将来如何复用同一接口？

`AIAllowance.source` 支持 `TRIAL | INSTITUTION | BYOK`。v0.1 实现 TRIAL（服务端）与 BYOK（客户端，不走 Gateway 账本）。INSTITUTION：同一 `ensure/charge` 路径；若 ledger 已是 INSTITUTION（issuerId/poolId），Gateway **不改代码**即可计量。

机构可见：额度、用量、成本汇总（`summarizeInstitutionUsage`）。默认不可见 prompt/response/Digital Self。

不开发机构后台。不把 Institution Settings 演示当成本轮结算身份。

---

## Build-vs-Integrate Gate

1. 大模型会对话，但不会给普通用户免 Key，也不会计量 trial。
2. 成熟 DeepSeek API 已足够；不要自研模型。缺的是托管凭证与额度。
3. Relay 已存在，只缺 inference。
4. 用户电脑没有 2digime 的 DeepSeek 账号。
5. 缺的是授权/连接：server-only Key + install token。
6. 必须新写的只是极薄 Gateway + preference + Settings 语义。禁止自研第二套 AI 平台。

**CAPABILITY SUFFICIENCY:** 本轮代码只补「普通用户无 Key 也能调用已验证的 DeepSeek」，不替代模型智能。

---

## Failure / privacy / abuse notes

- Provider 429/5xx/timeout/auth → 人话；auth 失败不是「请配置 API Key」。
- 额度耗尽：不把 `402` / `quota_exhausted` 直接给普通 UI。
- 并发：per-principal 串行入账 + 剩余 ≤0 拒绝；允许一次 max_tokens 量级超打；另有 global token/request ceiling。
- 清除 userData 会得到新 install token → 新 trial。这是已知缺口，故 **TRIAL_ABUSE_RESISTANCE_LIMITED**。
- 若 ECS `/etc/digitalme-relay.env` 无 `MANAGED_AI_PROVIDER_API_KEY`：工程测试可用 mock；live 停在 `MANAGED_AI_PROVIDER_SECRET_REQUIRED`。
