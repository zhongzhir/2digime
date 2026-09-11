# OFFICIAL-WEBSITE-V01

日期：2026-09-11  
状态：`OFFICIAL_WEBSITE_V01_PUBLISHED`

## 1. 发布结论

兔机米官方网站 v0.1 已通过 GitHub Pages 正式发布：

- Public URL：<https://zhongzhir.github.io/2digime/>
- Source authority before：`cdffcc893c2ae255287d7355a07129e65ab521e7`
- Site deploy SHA：`e0fd007e64e8729145f149ce8124e16a6121436a`
- GitHub Actions run：<https://github.com/zhongzhir/2digime/actions/runs/34583200432>
- Deploy result：`success`
- HTTPS：enabled

## 2. 为什么采用 fallback

原 OFFICIAL-WEBSITE-01 已建立 Figma 文件与一部分 token，但 Figma Starter 的月度 MCP 调用额度耗尽，无法完成后续页面设计。OFFICIAL-WEBSITE-V01-FALLBACK-01 明确要求不等待额度恢复，也不继续寻找第三、第四个设计平台。

当前 Codex 环境没有可直接调用的 Product Design connector，因此 v0.1 采用仓库既有产品视觉 token 方向，由代码直接完成简洁、正式的响应式官网。技术实现为原生 HTML、CSS 与 minimal JavaScript；无数据库、CMS、后端或站点运行时依赖。

## 3. 信息架构

| 路由 | 目的 |
|---|---|
| `/` | 兔机米整体产品、核心理念、个人版、机构合作版、开源与下载 |
| `/personal/` | Digital Self、长期上下文、当前已验证能力、使用方式与阶段边界 |
| `/institution/` | 机构分发、Brand Kit、权益 / 用量、数据边界与合作实施范围 |
| `/download/` | Windows Installer、Portable ZIP、安装说明与 SHA256 |

补充：`404.html`、`robots.txt`、`sitemap.xml`、SVG favicon。

## 4. 设计方式

- 沿用产品当前的暖纸色、墨色与克制绿色方向；以大留白、编辑式层级和细分隔线建立可信感。
- 无 AI 紫蓝渐变、机器人图、发光特效、复杂动画、廉价科技背景或卡片墙。
- 首页产品窗口与机构品牌窗口均为 HTML/CSS 信息示意，不冒充真实产品截图。
- mobile 不是缩小 desktop：导航、两栏、能力表、数据边界、CTA 与 footer 均在断点下重新布局。
- 支持键盘跳转、语义标签、可见焦点基础、移动导航与 `prefers-reduced-motion`。

## 5. 真实性边界

### A：官网可直接陈述的已验证能力

- Windows x64 Public Alpha
- 真实模型 Talk、多会话、文件 / 文件夹授权后读写
- Digital Self 基础形成与持久化
- 大模型完成一般任务、专业能力 delegation、Coding capability、Result Truth
- Organization / User、entitlement、quota isolation、usage
- Institution Adapter、个人与机构模式共存、Brand Kit、同 Core 多品牌、本地数据品牌隔离
- provider master key 不下发；Institution Backend 不保存 Talk 正文
- Demo 闭环通过 LiteLLM 调用 DeepSeek 完成真实 Talk

### B：必须表述为合作中可对接 / 可实施

- 真实机构 SSO、CRM、billing、user provisioning、usage callback
- 高可用、企业审计与具体行业合规要求

### C：未来方向

- 更完整的能力发现、Computer Use、多媒体生成、主动数字管家
- 大众化 Digital Subject Network

Demo Telecom 始终标明为虚拟验证品牌，不代表真实机构合作。官网未使用或暗示中国电信、招商银行等真实机构客户关系，也未虚构邮箱、微信或电话。

## 6. 下载事实

Release：<https://github.com/zhongzhir/2digime/releases/tag/v0.1.0-public-alpha.1>

- Installer：`tujimi-0.1.0-public-alpha-win-x64-setup.exe`
  - SHA256：`7cb6c4c6d340c624cf35b4b06dc3fb34bd04c654cd2469b81f5793ebe905a492`
- Portable ZIP：`tujimi-0.1.0-public-alpha-win-x64.zip`
  - SHA256：`05cd3c0798e3ec413cd722faa66a3050bfb3e928c369e336bacfbf9ec26d15b7`

2026-09-11 公网复验时，两个下载地址最终资产响应均为 HTTP 200。

## 7. 部署与 smoke

部署方式：`.github/workflows/pages.yml` 使用 GitHub 官方 Pages Actions，将 `site/` 作为静态 artifact 发布。

本地与公网均执行：

- 结构、内部链接、必要 metadata、下载资产名与禁用夸大文案检查；
- 1440 × 1000 desktop；
- 390 × 844 mobile；
- `/`、`/personal/`、`/institution/`、`/download/` 共 8 个浏览器组合；
- mobile 菜单展开；
- HTTP status、横向溢出、控制台错误、资源加载失败、中文 `lang` 与 H1 检查。

结果：8/8 通过。公网 `/`、`/personal/`、`/institution/`、`/download/`、favicon、robots、sitemap 均为 HTTPS 200。

## 8. v0.2 Figma 视觉升级

Figma MCP 额度恢复后执行：`OFFICIAL-WEBSITE-V02-DESIGN-UPGRADE`。

v0.2 保持现有 URL、IA、内容事实与下载入口，主要升级 visual design、typography、layout、imagery、motion 与 component polish；不把升级变成第二次重建官网。

现有 Figma 文件：<https://www.figma.com/design/NwsKzBXFdFXYn8POeuQwmk>

## 9. Blocker

v0.1 发布无 blocker。Figma MCP 月度额度只影响 v0.2 视觉升级，不再阻塞正式官网。
