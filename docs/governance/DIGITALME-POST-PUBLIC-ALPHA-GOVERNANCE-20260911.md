# Digital Me / 2digime — Public Alpha 后执行治理规则与路线

日期：2026-09-11  
状态：Owner 已确认；后续阶段执行基线

## 1. 目的

Public Alpha 已进入真实对外阶段。系统开始从单一产品验证扩展到：

1. 面向普通用户的 2digime 基础产品；
2. 面向机构分发的 Institution Distribution；
3. 数字主体网络的真实内容分发与自主选择试验。

从本阶段开始，必须优先防止多线并发、架构分叉、局部需求侵入核心、文档与实现脱节。

## 2. 最高不变原则

以下原则继续高于任何阶段任务：

- AI Native / AI First。
- Build-vs-Integrate First。
- 用户 → 2digime → 专业 Agent / Skill / Tool / Model。
- 2digime 核心只承担数字之我、超级助手、数字主体网络三类长期纵向能力。
- 用户体验横向贯穿全部能力。
- 规则只用于安全、隐私、授权、真实性、Owner 意志与 Digital Self 必要边界。
- 不自研成熟外部能力已经解决的通用 AI / Agent / Tool 能力。
- 不按图片、视频、漫剧、编程、机构等场景复制新的核心工作流、Router、State Machine。
- 任何新增能力优先做薄适配，不修改 2digime 的核心思考与做事逻辑。

## 3. 系统分层

### 3.1 Core

唯一核心：

1. Digital Self
2. Super Assistant
3. Digital Subject Network

机构版、品牌版、内容分发、专业能力均不得 fork Core。

### 3.2 Distribution / Institution Layer

机构版是 2digime 的分发与运营层，不是新的产品核心。

仅允许增加：

- Organization / Tenant
- 用户与权益管理
- AI entitlement / quota / usage
- Institution API / SSO / billing / CRM adapter
- Brand kit / white-label packaging
- 机构侧必要统计与审计

机构默认无权读取用户 Digital Self、私人对话和主体资产。

### 3.3 Network Application Layer

漫剧、网文等内容只作为数字主体网络的真实应用对象。

内容类型不得反向侵入 Core：

- 不创建 MangaRouter
- 不创建 ContentRecommendationEngine 作为核心
- 不以内容分类替代 Digital Self 自主判断

Relay 只负责连接和传输；最终 SHOW / IGNORE 由每个用户自己的 2digime 判断。

## 4. Authority 与开发纪律

冻结执行方式：

> 一个 Authority → 一个当前主任务 → 真实验证 → 验收 → 提交 → 下一任务

规则：

- 默认只允许一个产品开发主任务处于 active。
- 其它任务只能处于 PLANNED / BLOCKED / DONE。
- 每个任务开始前必须确认 origin/main、HEAD、dirty 状态。
- 不允许为了赶进度并行创建多个长期 branch。
- 每个任务必须有明确 DoD 和 verdict。
- 未验收通过不得进入下一产品阶段。
- Owner 只处理目标、关键边界、重大取舍和高风险确认，不承担技术排障。

## 5. 文档纪律

本阶段开始，规划必须先于开发落盘。

每项主任务至少包含：

- 背景与目的
- 服务哪个核心
- 明确“不改什么”
- Build-vs-Integrate Gate
- 最小实现
- 数据与权限边界
- 用户体验
- 真实验收
- 退出条件 / verdict

原则：

> 文档不是增加管理负担，而是防止多线发展后系统失去单一方向。

## 6. 冻结执行顺序

### Phase 0 — Governance 落盘

状态：当前执行

产物：

- 本文件
- `docs/plans/INSTITUTION-DISTRIBUTION-01.md`
- `docs/plans/SUBJECT-NETWORK-REAL-CONTENT-TRIAL-01.md`

完成后不再改变本轮顺序，除非出现 P0 安全或发布事故。

### Phase 1 — Public Alpha 基础版本正式发布完成

目标：

完成 Windows Installer patch release，让普通 Windows 用户从 GitHub 获得标准安装体验。

必须完成：

- main 进入已验收 Installer UX commit
- 新 tag / Release
- Installer 为 Windows 默认推荐下载
- Portable ZIP 保留
- Release 下载后二次 SHA256 验证
- tag / source / binary 可追溯

目标 verdict：

`PUBLIC_ALPHA_WINDOWS_INSTALL_RELEASED`

该阶段完成前，不启动机构版代码开发。

### Phase 2 — Institution Distribution v0.1

目标：

证明 2digime 可以由银行、电信、运营商、大型平台作为自有品牌 AI 产品分发，同时不改变用户数字主体所有权。

第一阶段只打穿：

> 一个机构 → 两个用户 → 不同 AI 权益 → 同一 Core 的白标客户端 → 正常 Talk → 用量归集 → 用户 Digital Self / 私人对话不进入机构后台

最小模块：

- Organization / Tenant
- User mapping
- AI entitlement
- Usage accounting
- Brand configuration
- Institution API adapter
- 最小机构管理面

禁止：

- 招行专用 Core
- 电信专用 Core
- 为每家机构 fork 仓库
- 集中保存用户 Digital Self
- 机构读取私人 Talk 内容
- 一开始建设庞大的 SaaS 管理平台

目标 verdict：

`INSTITUTION_DISTRIBUTION_V01_ACCEPTED`

### Phase 3 — Institution Distribution 对外落地页

前置：

必须先完成 Phase 2 的真实产品验证。

目标：

发布一个公开可访问的机构合作落地页，面向：

- 银行
- 电信运营商
- 手机 / 终端厂商
- 大型互联网平台
- 拥有大量 C 端用户的机构

页面核心说明：

- 为什么机构需要自己的 AI 用户入口
- 2digime 如何帮助分发模型 / AI 权益
- 白标能力
- 用户与权益管理
- API / SSO / 统计 / 结算能力
- 用户数字主体仍归本人
- 完全开源
- 可自由部署和改造
- 兼容 2digime 开放互联协议后可接入数字主体网络

不得提前宣传尚未实现的功能。

目标 verdict：

`INSTITUTION_LANDING_PAGE_PUBLISHED`

### Phase 4 — Subject Network Real Content Trial

目标：

用一条真实漫剧或等价公开内容，打穿数字主体网络真实分发闭环：

> 内容进入网络 → broadcast → relay → 多个 Digital Subject 收到 → 各自 Digital Self 独立 SHOW / IGNORE → 用户看到不同结果 → 用户真实反馈

关键边界：

- Relay 不做人群画像
- Relay 不做中心化 personalized ranking
- 各 Subject 独立判断
- AI 自己的 SHOW / IGNORE 不能反写为用户偏好
- 漫剧只是内容样本，不发展为漫剧产品线

目标 verdict：

`SUBJECT_NETWORK_REAL_CONTENT_ACCEPTED`

## 7. 多线关系

本阶段允许“战略上多线”，但不允许“工程上多头并行”。

关系如下：

- 基础产品是唯一 Core。
- Institution Distribution 是分发 / 运营层。
- Subject Network Trial 是网络真实应用验证。
- Landing Page 是已验证 Institution 能力的市场表达。

任何一条线如果要求修改 Core，必须先回答：

1. 这是数字之我、超级助手或数字主体网络的通用需求吗？
2. 能否通过 adapter / config / plugin / provider 解决？
3. 是否会为单一机构或内容类型引入永久复杂度？

若 1=否，或 2=是，则默认禁止进入 Core。

## 8. 开源与互联规则

2digime Core 保持开源。

机构和第三方可自由：

- 部署
- 修改
- 白标
- 集成自己的模型与系统

但“2digime Compatible / 官方数字主体网络兼容”应要求遵守开放互联协议与必要安全规范。

互联兼容不等于用户必须公开：

- 用户可保持私有
- 可关闭发现
- 可拒绝协作
- 可撤销授权

## 9. 当前唯一下一步

当前只执行：

`PUBLIC-ALPHA-WINDOWS-INSTALL-RELEASE-01`

完成并验收后，才进入：

`INSTITUTION-DISTRIBUTION-FOUNDATION-01`

在 Institution v0.1 完成并验收后：

1. 发布 Institution Landing Page；
2. 再进入 Subject Network Real Content Trial。

除 P0 事故外，不改变以上顺序。
