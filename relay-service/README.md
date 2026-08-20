# Digital Me Relay Service

最小「加密邮局」：只路由密文信封，不解释业务内容。

## 本机快速启动（开发验收）

```bash
npm run build
RELAY_PORT=8787 RELAY_DATA_DIR=./.relay-data npm run relay:start
```

Health: `GET /health`

## 环境变量

见 `.env.relay.example`。

## Docker

```bash
docker build -f relay-service/Dockerfile -t digitalme-relay .
docker run --rm -p 127.0.0.1:8787:8787 -v relay-data:/data digitalme-relay
```

生产请只把容器端口绑到本机环回，再由反向代理对外提供 HTTPS。

## 公网 HTTPS（必须）

第一版公网部署要求：

1. 真实 TLS 证书（Let’s Encrypt 等）
2. Relay Node **只监听内部端口**（如 `127.0.0.1:8787`）
3. Caddy / Nginx 反代 HTTPS → 内部端口
4. 独立数据目录（`RELAY_DATA_DIR`），重启后消息仍在
5. `GET https://<domain>/health` 正常
6. **不要**把无 TLS 的 Relay 直接暴露公网

Caddy 示例见 `Caddyfile.example`。

Owner 最终只需要一个地址：

```text
https://<domain>
```

## 日志边界

只记录信封标识、不透明端点标识、投递状态、错误类别。不记录明文正文或私钥。
