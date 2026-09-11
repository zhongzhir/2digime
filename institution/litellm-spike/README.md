# LiteLLM Spike (Institution Distribution v0.1 · Slice A)

隔离验证 LiteLLM Proxy + Postgres 是否满足机构分发硬门槛。

**不接** 2digime Core / Electron / Relay。

## 前置

- Docker Desktop 运行中
- 本机已有 DeepSeek API Key（个人版 `digitalme-v2` SecretStore 或环境变量）

## 步骤

```powershell
# 可选：从本机 SecretStore 导出到 gitignored .env（不打印密钥）
npx electron institution/litellm-spike/export-local-key-to-env.cjs

cd institution/litellm-spike
docker compose up -d
cd ../..
node institution/litellm-spike/run-spike.cjs
```

成功时 stdout / `build/evidence/institution-litellm-spike/report.json` 含：

`LITELLM_SPIKE_PRIVACY_AND_QUOTA_PASS`

Evidence 与 `.env` 默认不提交。

## 验证点

1. LiteLLM + Postgres 真实启动  
2. 两个独立 virtual key，不同 `max_budget`  
3. 真实 DeepSeek chat completions  
4. 低额度用户超额 429；高额度用户不受影响  
5. `store_prompts_in_spend_logs=false` + `turn_off_message_logging=true`  
6. Postgres `LiteLLM_SpendLogs` 中 messages/response/proxy_server_request 无正文；隐私 marker 命中为 0  
7. key/generate 响应不含 provider master key  
