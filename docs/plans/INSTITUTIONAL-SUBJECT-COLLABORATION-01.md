# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — 机构级主体协作与做事能力

**日期：** 2026-11-23
**状态：** `SLICE_0_COMPLETE / SLICE_1A_1B_1C_IMPLEMENTED / SLICE_2A_IMPLEMENTED / REAL_LOCAL_OIDC_DEVELOPER_VALIDATED / EXTERNAL_PROVIDER_AND_FAPI_PENDING / NOT_OWNER_ACCEPTED`
**前序地基：** `04-COLLABORATION-FOUNDATION`、`INSTITUTION-DISTRIBUTION-V01` 已接受  
**目标：** 在不破坏 Owner 主权和单一 Talk 入口的前提下，让 2digime 能以可验证的 Digital Subject 身份接入银行、电信、大型机构和大用户平台，并通过标准 A2A 协议安全协作、完成事情。

## 1. 产品结果

用户不需要学习认证协议、Agent Card 或 A2A。用户仍只在 Talk 中表达目标，系统负责：

1. 判断由本地主体完成，还是请求另一个独立 Digital Subject 协作；
2. 核实对方主体是谁、由谁授权、当前可从哪个端点到达；
3. 只披露完成当前目标所需的最少身份与上下文；
4. 让对方明确接受或拒绝，并返回可核验的结果、文件或失败事实；
5. 在授权过期、密钥轮换、端点变更或对方失联时安全恢复，不让旧授权继续有效。

银行、电信和平台可以管理其用户映射、权益、配额、模型池、使用量和品牌，但不能据此读取用户的 Digital Self、Talk、文件、记忆或其他机构中的主体关系。

Owner 对长期目标的进一步确认如下：邮箱、电话等应作为简便登录、通知和恢复入口，让普通用户能够安全管理自己的 2digime；它们不能单独冒充真实身份。接入银行、电信等高等级服务时，使用机构认可的真实身份认证，并把 Owner identity、Digital Subject identity 和 Runtime endpoint 继续分开。数字人民币等金融工具只作为远期受监管交易能力，在身份、委托、交易确认、额度、审计和监管接口成熟后另立任务。不同 2digime 之间既支持人参与关键节点，也支持在明确授权、风险和撤销边界内自动协作，二者共用同一主体协作事实链。

## 2. 两类 Personal Agent 探索带来的计划修订

本计划吸收 `docs/reference` 两篇材料中与 2digime 原则一致、且能被现有架构约束的部分，不照搬其产品形态或未经核实的商业叙事。

### 2.1 “个人算法”模式：平台供给，个人主体决定选择与呈现

HackerTube 一类探索证明的不是“每个人都要重建一个内容平台”，而是：内容、托管和传输可以继续来自既有平台，个人主体可以在自己一侧重组发现、选择、解释和呈现。对 2digime 的落点是：

1. Search、内容源、机构平台和外部 Agent 只提供候选与事实，不拥有个人化最终判断；
2. 个人算法不是新建 CTR、停留时长或中心画像，而是同一个 Digital Self、当前目标、明确控制和短期上下文共同进入当前模型判断；
3. 社区推荐、机构标签和历史行为只能作为带来源的证据，不得固化成 runtime 中的普适质量分；
4. 用户应能检查、纠正、导出自己的选择依据与内容控制；不绕过平台登录、付费、地区、版权或安全边界。

该原则继续约束“发现”，但当前不重启 `DISCOVER-WATCH-ENTRY-01`，也不新增搜索供应商、站点规则或平台抓取。

### 2.2 “Second”模式：一个长期个人上下文，外部能力随用随走

Second 一类探索与 2digime 初衷共通的部分是：长期稳定的是用户自己拥有、可迁移、可检查的个人模型/上下文，而不是每个外部 Agent 都各建一份用户画像。对 2digime 的落点是：

1. 一个 Subject 只有一个 Digital Self 权威；Tool、外部 Agent、机构平台和其他 Subject 都不能复制或取代它；
2. 外部能力通过“按目的生成、最少字段、短期有效、可审计”的 Personal Context Contract 获取当前任务所需上下文，永远不直接读取 `self.json`；
3. 推理提供方、模型和外部 Agent 可替换；个人上下文的所有权、纠正权和迁移权不随提供方迁移；
4. 语义判断继续由当前模型承担，runtime 只执行身份、授权、披露、费用、安全和结果真实性等机械边界；
5. 主动能力将来只允许在明确目标、打扰预算、可解释触发和可关闭前提下进入，不以全时监控作为默认数据源。

### 2.3 明确不吸收

- 不做全时屏幕、键盘或 OS 事件流监控，不用“理解用户”扩大为默认监视；
- 不建立后台多层 Agent 群、第二套 Personal AI、第二份长期记忆或独立主动通知产品；
- 不把本机可见数据默认上传给云模型，不用合同式“零留存”代替本机最小披露和可验证执行事实；
- 不因演示中的高成本预计算、模型调度或短信入口改变现有单一 Talk、模型中立和本机优先原则。

## 3. 必须复用的地基

- 既有 Relay、端到端加密、邀请、peer、public card 和 Grant；
- 已接受的 Institution Plane 与 Core 边界，不再复制一套机构版 Core；
- 现有单一 Talk 与做事 runtime，不新增“协作中心”或第二套工作流；
- A2A 的 Agent Card、Message、Task、Artifact 与安全方案；
- W3C Verifiable Credentials Data Model 2.0 的委托凭证形状；
- 机构已有的 OIDC/OAuth2/SAML 身份源；高价值 API 使用成熟安全剖面。

## 4. 身份与信任模型

三类对象必须分开，代码、日志和 UI 不得混称：

| 对象 | 回答的问题 | 最小事实 |
|---|---|---|
| Owner identity | 谁拥有并授权这个主体 | 机构/个人身份源、授权关系、有效期 |
| Digital Subject identity | 正在与谁协作 | 稳定 subject id、签名公钥、能力声明 |
| Runtime endpoint | 现在到哪里连接 | URL/Relay 地址、传输安全、健康与轮换状态 |

端点变化不能改变主体身份；Owner 账号变化不能自动继承旧主体授权；一个 Owner 可以拥有多个 Subject，一个 Subject 只能按明确授权代表其 Owner 行事。

## 5. 分阶段实现

### Slice 0 — 现状审计与威胁模型

- 盘点现有 Subject、peer、Grant、Relay、机构账号映射和审计字段，明确哪些已经被真实测试。
- 建立机构场景威胁模型：冒名主体、被替换端点、重放、权限扩大、跨租户泄露、撤销延迟、机构管理员越权、日志泄密。
- 冻结 `INSTITUTION-DISTRIBUTION-V01` 已接受结论，只补真实身份和安全缺口，不重做管理页面。

### Slice 1 — 可验证主体与签名 Agent Card

- **Slice 1A（本轮已实现）：** 复用现有 Ed25519 通信身份，为已配对主体的公开卡建立域分隔签名封装；机械绑定 Subject、Runtime Endpoint、key id、签发时间和有效期。Relay 只缓存验证通过的卡；篡改、过期、撤销 key、错误 Subject、错误 Endpoint 和错误 key 均拒绝。
- **Slice 1A 的诚实边界：** 当前对象是 `digitalme.public_subject_card.signed.v1`，不是标准 A2A Agent Card，也不是 Owner 身份证明；信任根仍是配对时保存的对端公钥。
- **Slice 1B（本轮已实现）：** 本机先以单个加密 bundle 持久化完整新密钥，再原子切换活动 profile；对端通过旧、新 Ed25519 key 双签声明允许短暂双端点重叠，经准备、就绪、提交、提交确认完成迁移。交接点、对端旧 key 撤销和已完成记录均持久化，准备前与激活后重启都可续跑；提交后旧 endpoint/key 的真实 Relay 密文投递被拒绝。
- **Slice 1B 的诚实边界：** 当前只验证同一 Relay 内、单方发起的 endpoint/key 轮换；不宣称跨 Relay 迁移、双方同时轮换、设备丢失后的 Owner 恢复或机构级密钥托管已经完成。
- **Slice 1C（本轮已实现）：** 当前模型通过稳定引用选择本次任务最少的 Digital Self 条目；runtime 只从真实、仍有效的 understanding 编译 Personal Context Contract，并绑定目的、任务、接收 Subject + Endpoint、字段来源摘要、内容 digest、15 分钟默认/30 分钟上限有效期和短期 `AuthorizationGrant` 撤销引用。发送方与接收方分别记录真实请求体 digest、UTF-8 字节数、接收端点、合同和字段引用；未送达不得记成 `request_sent`。
- **Slice 1C 的诚实边界：** 当前合同随既有已签名 Relay/E2EE 信封获得传输真实性，本身尚未独立签名或标准化；接收方可核验合同完整性、用途、接收方、端点和有效期，但尚不能远程实时查询签发方本机 Grant 的后续撤销状态。它不是 Owner 委托凭证、OpenID4VP 选择披露或标准 A2A Message。
- 标准 A2A Agent Card 必须区分声明者、Subject、Runtime Endpoint、能力、输入输出模式与认证方案，并在 Slice 4 通过独立实现互操作后才可宣称符合标准。

### Slice 2 — 真实机构身份联邦

- 通过 OIDC/OAuth2 或既有 SAML 适配机构身份，不自建用户名密码体系。
- 普通机构先实现授权码 + PKCE、明确 audience/scope、短期 token 和服务端密钥保护。
- 银行、电信等高价值 API 采用 FAPI 2.0：PAR、PKCE、`private_key_jwt`，以及 mTLS 或 DPoP 的 sender-constrained token；关闭隐式流和弱客户端认证。
- 机构登录只证明 Owner/组织身份，不直接等于 Subject 授权；必须经过独立绑定与撤销。
- **Slice 2A（本轮已实现）：** 通过成熟 `openid-client` 集成 OIDC discovery、浏览器授权码、PKCE S256、state、nonce、ID Token 和可选 UserInfo 校验；本地独立 `oidc-provider` 开发身份源完成真实协议闭环。稳定身份键只使用 `issuer + subject`，邮箱/电话只保存脱敏验证提示。登录事务加密、限时、一次性消费；Owner identity 到 Subject 的绑定必须显式确认，可单独撤销，撤销身份会级联撤销绑定，再次登录不会静默恢复被撤销身份。
- **Slice 2A 的诚实边界：** 这是标准协议的本机开发者门，不是真实银行、电信租户，不证明法定实名或机构合规；没有外部账号、第三方条款、真实身份数据或费用。`fapi2` 配置当前机械拒绝，避免把普通 OIDC 冒充 FAPI 2.0；PAR、`private_key_jwt`、DPoP/mTLS、外部 provider 注册、产品 UI、Owner 恢复流程和生产密钥管理仍待后续切片。

### Slice 3 — Owner → Subject 委托凭证

- 委托使用 VC 2.0 数据模型表达：issuer、holder/subject、权限范围、目的、有效期、撤销状态和最小必要 claims。
- 评估并优先集成 OpenID4VCI 1.0 与 OpenID4VP 1.0，分别完成凭证签发和按需出示；不自研二维码/钱包互操作协议。
- 默认最小披露；另一主体只能看到当前协作所需的身份与授权事实，不能获得完整 Owner 档案。
- 覆盖撤销、过期、重新签发、设备丢失、机构账号停用和主体迁移。

### Slice 4 — A2A 互操作

- 用标准 Agent Card 发现能力，用 Message/Task/Artifact 承载一次跨主体协作。
- A2A Task 是协议对象，不是面向用户的新任务中心或永久工作流；用户仍在 Talk 中看到自然语言进展与结果。
- A2A 的认证方案必须映射到 Slice 2/3 的真实安全事实，不接受“有 token 就可信”的降级。
- 先在现有 Relay/E2EE 上做最小绑定；只有标准互操作确有缺口时才增加适配层，不新建 network runtime。

### Slice 5 — 两 Owner 真实机构试验

- 两个独立 Owner、两个独立 Subject、两个独立运行端点；至少一侧使用真实机构身份源。
- 验证发现、签名核验、最小披露、接受、拒绝、结果交付、文件存在、审计、撤销、过期、密钥轮换和端点替换。
- A 不得直接驱动 B 的 runtime 或 drain；B 始终是能独立接受/拒绝的 Subject。
- 任何自动化回放只能作工程证据，不能替代两位 Owner 的真实验收。

### Slice 6 — 做事能力接入同一主链

- 当前模型在同一 Talk 中选择本地 Capability 或外部 Subject，不用关键词路由器替代判断。
- 外部能力的成功必须有真实结果、可打开文件/链接或对方签名 Artifact；“请求已发出”不等于事情完成。
- 拒绝、超时、授权不足和对方失联要回到同一对话，由模型解释并提出可执行替代方案。
- 沿用现有审批、费用和高风险动作边界；本计划不授权购买、付款、生产部署或机构数据接入。

## 6. 开发与验收门

### 身份门

- Owner、Subject、Endpoint 三类身份在存储、协议和日志中可机械区分；
- 伪造签名、过期 card、已撤销 key、错误 endpoint 绑定全部被拒绝；
- 机构管理员不能把一个租户的 Subject 绑定给另一租户。

### 认证与安全门

- 真实 OIDC/OAuth 端到端通过，不用 mock 冒充机构登录；
- token audience/scope、重放、PKCE、PAR、sender constraint、密钥轮换有负向测试；
- 日志、trace、错误消息和封存包中没有 access token、私钥、VC 全量敏感 claims 或 Digital Self。

### A2A 与做事门

- 与至少一个独立 A2A 实现完成 Agent Card、Message、Task、Artifact 基本互操作；
- 两 Owner 真实协作通过接受、拒绝、撤销、过期、恢复与结果交付；
- 用户只需在 Talk 中表达目标，不需要进入新协作页面或手动理解协议状态；
- 本地做与外部协作的选择、真实完成事实和失败恢复均由同一主模型主导，runtime 只执行机械约束。

## 7. 本阶段不做

- 不建协作中心、13 态产品状态机、第二套 Talk 或第二套 runtime；
- 不自研 DID、认证、钱包、支付、信誉或银行级密码协议；
- 不让机构、Relay 或另一 Subject 读取完整 Digital Self、Talk、文件或记忆；
- 不把 A2A Task 当作用户工作流，也不把另一 2digime 当 Tool、Sub-Agent 或 worker；
- 不以 mock SSO、单 Owner 回放或自动测试冒充机构真实验收；
- 不在本计划中授权外部费用、生产发布、真实银行数据或大规模用户迁移。
- 不用持续屏幕/键盘/OS 事件采集换取“更懂用户”，不建立后台 Agent 群或第二份个人上下文。

## 8. 当前检查点与下一执行批次

### 2026-11-23 开发者检查点

- Slice 0 现状/威胁审计已形成；
- Slice 1A 签名公开卡、对端 key 撤销持久记录和 Relay 严格 key 绑定已实现；
- Slice 1B 原子密钥 bundle、双签交接证明、四步 Relay 交接、撤销同步和重启恢复已实现；
- Slice 1C 一次任务 Personal Context Contract、短期 Grant、接收方核验和双侧实际披露审计已实现；
- Slice 2A OIDC 授权码 + PKCE 身份联邦、稳定 Owner identity、脱敏联系提示、显式 Subject 绑定与撤销已实现；
- TypeScript 构建、新增身份专项测试 3/3 与真实本机 OIDC 浏览器闭环通过；
- 物化前按需挂载既有 work runtime，已关闭 initiator 本地物化和远端 pull 共用的 artifact committer 回归；原始失败套件 7/7 通过；
- 生产依赖已最小升级，npm 官方 `--omit=dev` 审计为 0；HTTP/XML/Relay/A2A 定向路径 55/55、A2A adapter 独立 3/3 通过；包含开发/打包工具的完整审计仍有 28 项，留给独立工具链升级批次；
- 尚未 Owner 验收，尚未合并主干、推送、打包、发布或部署；
- 尚未完成合同独立签名与远程撤销同步、跨 Relay 迁移、同时双向轮换、标准 A2A Agent Card、外部真实机构租户、FAPI 2.0 高保障通道、Owner 委托凭证或独立实现互操作。

### 下一执行批次

1. 由 Owner 决定是否对 Slice 1A–1C 与 Slice 2A 做当前边界内验收；未验收前不得写成产品完成；
2. Slice 2B 选择一个无外部费用、无需真实身份数据的外部开发/沙箱身份源，注册 OIDC client 并接入现有适配器；创建外部账号、接受第三方条款或提供组织租户必须另行确认；
3. Slice 2C 在支持条件成熟时接 FAPI 2.0：PAR、`private_key_jwt`、DPoP 或 mTLS，并为 audience、scope、重放、密钥轮换和 token 泄露建立负向门；不自研替代协议；
4. 另立开发/打包工具链升级批次处理完整审计中的 28 项公告；在完成安装包复验前，不把生产依赖审计为 0 扩写成全依赖或发布安全通过；
5. 未通过前不做数字人民币/支付、平台定制、A2A 市场、生产接入或真实机构数据试验。
