# 2digime.com 正式站自动发布

## 结论

2digime.com 与 www.2digime.com 当前都通过 A 记录指向 47.94.210.18。该地址属于阿里云轻量应用服务器 `92fd4c0d20d44bf4b2616eacf1b3ef1e`（宝塔Linux面板-rmtg），与 allmeme.online 同机。2digime 使用独立 Nginx vhost 和独立目录；正式发布采用 GitHub Actions 通过受限 SSH 身份只同步该目录，GitHub Pages 仅保留为灾备预览。

## GitHub production environment

建立 GitHub production environment，并在仓库级设置发布开关。

Repository variable：

- PRODUCTION_DEPLOY_ENABLED：全部验证完成后设为 true；启用前保持 false

Production environment variables：

Variables：

- PROD_SSH_HOST：47.94.210.18
- PROD_SSH_PORT：22
- PROD_SSH_USER：专用部署用户，不使用日常管理员账号
- PROD_SITE_PATH：`/www/wwwroot/2digime.com`

Secrets：

- PROD_SSH_PRIVATE_KEY：专用部署用户的 Ed25519 私钥
- PROD_SSH_KNOWN_HOSTS：经独立核验的服务器 host key 行；工作流不会在运行时盲信 ssh-keyscan

私钥不得进入仓库、Issue、聊天或 Grok 载荷。部署用户只需要写入官网目录的权限，不需要读取业务数据。

## 服务端条件

- 部署目标被硬限制为 `/www/wwwroot/2digime.com`；任何其他路径都会被工作流拒绝。
- 服务器需要 tar、rsync。
- 不修改 `/var/www/allmeme`、allmeme 的 Nginx vhost、进程或证书。
- Nginx 应同时接收 2digime.com 与 www.2digime.com，建议将 www 301 跳转到 https://2digime.com$request_uri。
- 正式 canonical、Open Graph、RSS 与 sitemap 统一使用 https://2digime.com。

2026-09-27 现场核验：Nginx root 为 `/www/wwwroot/2digime.com`，配置语法通过，tar/rsync/realpath 均已安装；系统盘使用率 95%，主要占用来自与官网无关的 `/root/fisco-bcos/nodes`。官网发布包很小，但磁盘清理须作为独立运维任务处理，不得在官网发布流程中自动删除其他业务数据。

## 发布链

1. 普通站点变更进入 main。
2. pages.yml 构建并校验站点，部署 GitHub Pages 灾备副本。
3. production 开关开启后，调用 deploy-production.yml。
4. 正式部署重新构建并检查不得残留旧 GitHub Pages canonical。
5. 站点压缩包通过固定 host key 的 SSH 上传。
6. 服务端确认目标路径、创建暂存与回滚副本，再用 rsync --delete 同步。
7. 自动访问首页、个人版、机构版、下载、资讯与 RSS，全部为 200 才通过。
8. Grok 的 publish_news 工作流使用同一个正式站发布流程。

首次启用前必须先确认 Nginx root、建立专用部署用户并配置 GitHub environment；仓库级 PRODUCTION_DEPLOY_ENABLED 未设置为 true 时，正式部署任务会安全跳过。
