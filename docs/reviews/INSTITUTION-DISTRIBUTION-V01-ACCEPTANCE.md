# INSTITUTION-DISTRIBUTION-V01-ACCEPTANCE

日期：2026-09-11  
状态：ACCEPTED  
Verdict：`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`

## Authority

- Branch：`build/institution-distribution-01`
- Candidate source HEAD：`1a72abeaf0805d1294028522a8d2edafcbcd663d`
- Preceding exits：
  - `LITELLM_SPIKE_PRIVACY_AND_QUOTA_PASS`
  - `INSTITUTION_DISTRIBUTION_V01_BACKEND_ACCEPTED`
  - `INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_ACCEPTED`
  - `INSTITUTION_DISTRIBUTION_V01_BRAND_KIT_ACCEPTED`
- Harness：`institution/acceptance-e/run-acceptance.cjs`
- Evidence（不提交）：`build/evidence/institution-acceptance-e/report.json`

## Architecture

```text
                 2digime Core
                      │
       ┌──────────────┴─────────────┐
       │                            │
Personal configuration      Institution Adapter
                                    │
                           Institution Backend
                                    │
                               LiteLLM
                                    │
                            AI providers
```

- Digital Self / Talk / private assets：Local Subject Plane
- Relay：数字主体网络 only（本轮未改、未与 Institution Backend 合并）
- 无第二套 Core；无 institution-specific Talk / Digital Self runtime
- 无自研 model gateway / quota engine（quota 由 LiteLLM 执行）

## Artifacts（clean HEAD `1a72abe`）

| Brand | Setup | Bytes | SHA256 |
|-------|-------|------:|--------|
| 兔机米 (`tujimi`) | `兔机米-0.1.0-public-alpha-win-x64-setup.exe` | 83766139 | `257b191ead1cba90112724f49cfb7d6ce9c07b7945864ca86b0cece6997f1716` |
| Demo Telecom AI | `Demo Telecom AI-0.1.0-public-alpha-win-x64-setup.exe` | 83760848 | `fe0fa02b7564240098e845b4d312c40397d75be33a64e556b7b2933fcf45da52` |

- Staging：
  - `release-staging/v2-tujimi-20260911T063318Z-1a72abea`
  - `release-staging/v2-demo-telecom-20260911T063539Z-1a72abea`
- 两包 `integrity.gitHead` 均为 `1a72abe…`；sensitiveFindings 均为空
- Identity：
  - 兔机米：`appId=local.digitalme.v2`，`userDataDirName=digitalme-v2`
  - Demo Telecom：`appId=local.demotelecom.ai`，`userDataDirName=demo-telecom-ai`

## Real test evidence summary

连续两轮同一自动化链均 PASS（`--rounds=2`）。

1. Organization / users：Demo Telecom bootstrap；`demo-user-low` / `demo-user-high`
2. 独立映射与不同额度：low `max_budget=0.00001`，high `1.0`；凭证互不相同
3. High Talk：真实 Institution → LiteLLM → DeepSeek 成功；Digital Self 仍本地
4. Low quota：首次请求即 budget exceeded；人话提示「你的 AI 使用额度已用完。」
5. High after low fail：再次 Talk 成功（用户/额度隔离）
6. Usage：Backend `/v0/usage/summary` 分用户返回
7. Packaged smoke：两包可启动；隔离 userData；telecom 未读取官方私有 marker
8. Personal Mode：官方路径 `saveModelCredential` 仍在；直接 DeepSeek Personal Talk 成功；Institution 为可选入口
9. Brand Kit：asar 内 `brand.json` / `brand.runtime.js` 分别为兔机米 / Demo Telecom AI；openSourceNote 保留 2digime

§8 十条 checklist：全部 true（见 evidence report）。

## Privacy result

- Institution Backend `store.json`：无 prompt/messages/response/digitalSelf 等禁止字段；privacy marker hits = 0；无 master key
- LiteLLM Postgres `LiteLLM_SpendLogs`：privacy marker hits = 0；messages/response/proxy_server_request nonempty counts = 0

## Isolation result

- 用户凭证隔离、额度隔离、usage 分用户
- 品牌 userData namespace 隔离（`digitalme-v2` ≠ `demo-telecom-ai`）
- 跨品牌不读取对方本地 subjects / credentials

## Regression result

- 官方 appId / userDataDirName 未变
- Personal Mode Talk 成功
- Institution Adapter 可选，不强制机构模式
- Core Talk / Digital Self 语义未 fork

## Implemented in v0.1

1. Organization / Institution User（Demo Telecom mock）
2. 两用户独立映射
3. AI entitlement（LiteLLM max_budget）
4. LiteLLM enforcement
5. usage accounting（via LiteLLM + Backend summary）
6. Institution Adapter（thin exchange → existing credential store）
7. Personal Mode 保留
8. Brand Kit / white-label（electron-builder + brand config）
9. 同 Core 多品牌包
10. 用户主体数据与 Institution Plane 隔离

## Not implemented（诚实边界）

- 中国电信 / 招商银行真实 SSO
- 真实 CRM / billing
- 多机构生产租户
- Enterprise SSO
- 大规模高可用
- 合规认证
- 商业结算
- 机构运营后台深度能力
- Landing Page / Subject Network Trial / 机构正式发布

## Known limitations

- Demo identity 为 mock assertion，非生产 SSO
- Institution Backend 为最小本地服务，非多租户 SaaS
- Windows `rcedit` 偶发 exe 文件锁；afterPack 增加短重试（构建钩子，不改变产品语义）
- usage summary 的 spend 字段可能因 LiteLLM key 轮换显示滞后；预算拒绝与分用户 summary 仍以真实 LiteLLM 响应为准

## Final verdict

`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`
