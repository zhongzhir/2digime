# 兔机米伙伴沙箱

本地、零费用、仅使用合成数据的伙伴控制面。它复用现有 Institution Backend 的 Organization、用户映射与权益事实，不是生产多租户运营平台。

## 启动

在 PowerShell 中设置一次性管理员令牌和独立数据文件后启动：

```powershell
$env:INSTITUTION_ADMIN_TOKEN = '请替换为本次随机长令牌'
$env:INSTITUTION_DATA_FILE = Join-Path $env:TEMP '2digime-partner-sandbox-store.json'
$env:INSTITUTION_BACKEND_PORT = '4100'
node institution/backend/server.cjs
```

浏览器打开 `http://127.0.0.1:4100/partner-sandbox`，输入同一管理员令牌。按页面顺序创建一个机构、两个测试用户和一项服务。

## 安全边界

- 服务只监听 `127.0.0.1`；新伙伴管理 API 没有管理员令牌时拒绝启动管理动作；
- 只使用合成测试用户，不录入真实手机号、邮箱、身份证号、银行或电信生产数据；
- 机构侧只保存账号映射、权益、服务配置、授权策略、用量汇总和最小审计；
- 不保存 prompt、response、Digital Self、私人文件、长期记忆或 provider master key；
- 服务停用只改变机构侧可用性，不删除个人 Digital Self、Talk 或本地成果。

## 自动验证

```powershell
npm run build
node institution/partner-sandbox/run-verify.cjs
npm run institution:partner:journeys
```

验证脚本使用系统临时目录和随机本机端口，不连接外部服务、不产生费用。`institution:partner:journeys` 运行两条合成旅程：电信权益发放，以及银行服务 Subject 的协作接受、撤销与 A2A 互操作。

