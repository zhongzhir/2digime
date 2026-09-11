# INSTITUTION-DISTRIBUTION-V01-IMPLEMENTATION-01

日期：2026-09-11
状态：PLANNED（Slice A / B / C / D 已本地真实验证）
前置：`INSTITUTION_DISTRIBUTION_FOUNDATION_ACCEPTED`
权威设计：[`docs/design/INSTITUTION-DISTRIBUTION-FOUNDATION-01.md`](../design/INSTITUTION-DISTRIBUTION-FOUNDATION-01.md)
产品计划：[`docs/plans/INSTITUTION-DISTRIBUTION-01.md`](INSTITUTION-DISTRIBUTION-01.md)
Slice A 退出：`LITELLM_SPIKE_PRIVACY_AND_QUOTA_PASS`（harness：`institution/litellm-spike/`；evidence 默认不提交）
Slice B 退出：`INSTITUTION_DISTRIBUTION_V01_BACKEND_ACCEPTED`（harness：`institution/backend/`；evidence 默认不提交）
Slice C 退出：`INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_ACCEPTED`（harness：`institution/adapter-verify/`；evidence 默认不提交）
Slice D 退出：`INSTITUTION_DISTRIBUTION_V01_BRAND_KIT_ACCEPTED`（harness：`institution/brand-kit/`；evidence 默认不提交）

## 1. 本轮唯一目标

打穿 Demo Telecom 最小闭环：

> 一个机构 → 两个用户 → 不同 AI 权益 → 同一 Core 白标客户端 → 真实 Talk → 用量分别归集 → Digital Self / Talk 正文不进机构侧

不建设大型管理后台。不改 Relay。不做 Landing Page。不做漫剧网络试验。

## 2. Build-vs-Integrate（冻结）

| 能力 | 决策 |
|------|------|
| LLM Gateway / virtual key / budget / usage | **集成 LiteLLM Proxy** |
| 身份 | Demo **mock**；合同预留 OIDC 替换 |
| 白标 | **electron-builder + brand config** |
| Quota / billing 引擎 | **禁止自研** |

## 3. 第一轮切片（仅此 5 步）

### Slice A — LiteLLM 隔离 spike（硬门槛） — DONE

- 本地/容器启动 LiteLLM + Postgres。
- 配置一个测试 DeepSeek（或现有 OpenAI-compatible）provider；**master key 仅在环境变量，不提交、不进 git**。
- 创建两个 virtual key，不同 `max_budget`（或等价额度）。
- 各发真实 chat completions。
- 验证：usage/spend 可见；超额方被拒绝且不影响另一方。
- 验证：`store_prompts_in_spend_logs=false` + `turn_off_message_logging=true`；DB/logs **无** prompt/response 正文。
- Evidence 可放 `build/evidence/`；**默认不提交**。
- Spike **不接**主产品、不改 Core。
- Harness：`institution/litellm-spike/`（compose + config + `run-spike.cjs`）。

退出：`LITELLM_SPIKE_PRIVACY_AND_QUOTA_PASS` 或明确 fail 原因。

### Slice B — 最小 Institution Backend — DONE

独立小服务（勿塞进 Relay）：

- Organization：`Demo Telecom`
- 两个 InstitutionUser + entitlement（映射到两个 LiteLLM key 策略）
- API：`session/exchange`、`entitlement`、`usage/summary`
- 仅调用 LiteLLM management API；不自研 key 账本
- Harness：`institution/backend/`（`server.cjs` + `run-verify.cjs`）

退出：用 curl/脚本证明两用户权益与用量分离 → `INSTITUTION_DISTRIBUTION_V01_BACKEND_ACCEPTED`

### Slice C — 客户端 Institution Adapter（最薄） — DONE

- 机构模式：兑换 virtual key → 写入现有 SecretStore / model-config；`baseUrl` 指向 LiteLLM。
- 保留个人版「自备 API Key」路径。
- Talk 仍走现有 `chatComplete`；不改语义循环。
- 额度耗尽：透传错误 → 普通人语言提示。
- 实现：`electron/institution-adapter.cjs` + IPC/`settings` 最小入口；验证：`institution/adapter-verify/run-verify.cjs`

退出：两台（或两 profile）客户端真实 Talk，用量进 LiteLLM/Backend 汇总 → `INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_ACCEPTED`

### Slice D — Brand Kit v0 — DONE

- 一份 brand config（如 Demo Telecom 名称/图标/字符串）。
- 驱动 `electron-builder` productName/icon/shortcut + 关键 UI 文案。
- 证明同一 Core、另一 brand config 可再打一包（可只做配置切换验证，不必两套都发 Release）。
- Harness：`brands/` + `scripts/apply-brand.cjs` + `institution/brand-kit/`

退出：白标安装包可见机构品牌；无第二仓库 → `INSTITUTION_DISTRIBUTION_V01_BRAND_KIT_ACCEPTED`

### Slice E — 验收对照

按 `INSTITUTION-DISTRIBUTION-01.md` §8 十条逐项取证。
目标：`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`

## 4. 明确不做（本 Implementation）

- 多机构 SaaS 控制台、真实运营商/银行接口
- 自研 gateway / quota engine / token billing engine
- Relay 改造、Landing Page、Subject Network 内容试验
- 开启 LiteLLM prompt 正文存储
- 提交 secrets、node_modules、DB 数据、大 evidence

## 5. 建议提交节奏

1. Foundation docs（本任务）
2. Spike 通过后：backend + adapter + brand（可分 1–2 个小 commit）
3. 验收通过后再考虑是否进入 Authority/main 发布流程（另任务；默认不 push）

建议实现期 commit 前缀：`feat(institution): …`；本 Foundation 已用 `docs(institution): …`。

## 6. DoD

- [x] Spike 隐私 + quota 真实通过（Slice A）
- [x] 两用户不同额度、互不影响（Slice A / LiteLLM）
- [x] 白标客户端 Talk 成功（Slice D：Demo Telecom brand + Institution Talk）
- [x] 用量可归集且无正文（Slice A / SpendLogs 计数验证）
- [x] Core 无机构 fork；Relay 未混职责（Slice A 未改 Core/Relay）
- [x] 个人版路径未破坏（Slice C：个人保存凭证会退出 Institution Mode；`saveModelCredential` 保留）
- [x] 客户端 Adapter + 双 profile Talk（Slice C）
- [x] Brand Kit：同一 HEAD 打出官方兔机米 + Demo Telecom 两包（Slice D）

## 7. Verdict

成功：`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`
本文件本身不宣告该 verdict；仅定义第一轮实现切片。
