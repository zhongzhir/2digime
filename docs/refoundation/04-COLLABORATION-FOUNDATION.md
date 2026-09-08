# 04 — COLLABORATION FOUNDATION

**状态：** `phase3_foundation / architecture_for_collaboration`
**日期：** 2026-09-08
**基线：** Dual-Subject Loop architecture/engineering pass 已接受
**性质：** Phase 3 协作架构。不替代 00/01/02；不承担排期（排期只在 03）。本文回答：协作是什么、对端是谁、外部标准怎么用、代码守什么、第一版最少验什么。

**2026-09-08：** 00 已将第三核心从「协作」更名为 **Digital Subject Network**。协作是该网络的一种应用（COLLABORATION IS AN APPLICATION），不是第三核心总称。本文仍是 Phase 3 对象与传输地基；现有 relay / discovery / opportunity 等实现视为 Subject Network substrate。禁止另起一套 network runtime。不在本文开始新实现。**同日只读审计见 §13。**

开始任何协作实现前：读 AGENTS.md 所列四份文件，再读本文。出现 Yellow / Red 必须重读 00 / 01 / 02 与本文。

`2DIGIME-COLLABORATION-01-DUAL-SUBJECT-LOOP` 已接受为 architecture/engineering pass。其后实现只替换 discovery/transport 底座，不重写已通过的 AI collaboration logic。

---

## 1. 协作产品定义

协作不是另一个主入口，也不是第三个产品，更不是第三核心的总称。它是 Digital Subject Network 上的一种应用。

用户仍然只与自己的 2digime 交流。对话是统一入口；做事是同一入口里的外部执行；协作是同一入口里、对端换成另一个独立 Subject 时发生的行为。删除协作页面之后，主体、Goal、授权、传输与验收逻辑必须仍独立成立。

当目标需要另一个人的数字主体参与时：

```text
Human A
  → 2digime A
  → 自主判断需要协作
  → 发现 / 联系 2digime B
  → A ↔ B 自主协商、分工、交换必要信息
  → 双方分别组织自己的 Models / Agents / Tools
  → 交换结果 / 证据
  → A 验收并综合
  → Human A
```

Human B 只在超出已有授权、高风险、敏感披露、承诺、支付、不可逆动作时介入。Human A 同样如此。人不操作「创建协作 / 选择协议 / 建 session / 填分工表 / 管理 A2A Task」。

协作成立的标志不是出现协作中心，而是：A 的用户说了一句需要别人的话，随后在同一条交流里收到综合结果，且 B 作为独立主体真实参与过。

来源：00 §4 / §6 / §8；01 §1 / §3.1 / §3.12；本任务冻结本体。推翻：旧「对话 | 做事 | 协作」三标签；`#nav-collab` 作为普通用户入口。

---

## 2. Subject ↔ Subject 架构

### 2.1 对端是独立 Subject

另一个 2digime：

- 不是 Tool
- 不是 Sub-Agent
- 不是我的 Runtime worker

它是独立 Subject：有自己的 Owner、Digital Self、目标与边界、External Capabilities、接受或拒绝合作的权利、自己的审计与信誉。

协作是 **Subject ↔ Subject**。A 不得把 B 的内部模型、材料、密钥、Job runner 当成自己的资源。B 不得因为接到请求就变成 A 的执行线程。

### 2.2 拓扑

```text
Human A                         Human B
   │                               │
   ▼                               ▼
2digime A                       2digime B
 Digital Self A                  Digital Self B
 Intelligence A                  Intelligence B
 Grants / Audit A                Grants / Audit B
   │                               │
   ├─ Models / Agents / Tools      ├─ Models / Agents / Tools
   │  (MCP · Codex · Search …)     │  (MCP · Codex · Search …)
   │                               │
   └──────── Subject ↔ Subject ────┘
            协议对象：A2A Message / Task / Artifact
            传输：KEEP Relay + E2EE（v1）
            以后可换公开 A2A HTTP / gRPC / JSON-RPC 绑定
```

冻结关系（01 §1）：

```text
Human
  → Digital Self / Subject
  → 2digime Intelligence & Orchestration
  → Models / Agents / Skills / Tools / Other Subjects
  → World
```

Other Subject 与 Tool 可走相似的调用接口，**产品本体不得把 Other Subject 概念化成 Tool**。MCP 只连接 Agent ↔ Tool/Data。A2A 连接 Agent/Subject ↔ Agent/Subject。

### 2.3 身份三件套（必须分开）

| 对象 | 是什么 | 现有落点 | 不是什么 |
|---|---|---|---|
| **Owner identity** | 人。源头与最终权威 | 本机占有 Subject Package；未来 VC 发行方 | 不是 `subjectId`，不是 Relay 账号 |
| **Subject identity** | 这个数字主体 | `SubjectPackage.id` + `digital-self/self.json` | 不是设备，不是 Agent Card 全文 |
| **Runtime endpoint** | 这次可达的通信位置 | `endpointId`、`dmep:`、Ed25519/X25519、`relayUrl` | 不是「我是谁」 |

同一 Subject 可以换设备（换 endpoint），Owner 不变。同一 endpoint 密钥轮换不等于换了一个人。Agent Card 描述的是**可协作表面 + 当前 endpoint**，不是 Digital Self。

### 2.4 现有代码反向审计

评价口径与 01A 相同：对宪法有没有不可替代的作用。代码多、测试绿、曾经 Owner 通过，都不构成 KEEP。

| 资产 | 现用位置 | 判断 | 原因 |
|---|---|---|---|
| SubjectEnvelope、Relay 只存密文、Ed25519/X25519、AES-GCM、inbox/ACK | `src/subject-comm/` | **KEEP** | 传输层。Relay 不是事实源 |
| Comm identity + `peers.json` + invite | `identity-store.ts`、`invite.ts` | **KEEP** | v1 发现与配对的物理基础 |
| `SubjectRef`（subjectId / endpointRef） | `collaboration/schema.ts` | **KEEP** | 已分开主体与端点引用 |
| `AuthorizationGrant`（granted / revoked / expired） | `grant-store.ts` | **KEEP 合同** | 单方授权，可撤销。去掉 deprecated 摘录字段 |
| Record / Grant 分离、最小披露、对端独立判断、provenance | 合同思想 | **KEEP 思想** | 见 01A §5.14 |
| `cap_a2a_research_analysis` | `a2a-remote.ts` | **KEEP 为 External Capability** | 对端是 service/Agent，不是 Subject B |
| `LocalCollaborationHost` 打开对方包并 `submitTask` | `local-collaboration.ts` | **REFERENCE_ONLY / 禁止接线** | 把 B 当本进程 worker；绑旧 work runtime |
| `CollabUserStatus` 13 态 | `schema.ts` | **DISCARD 为产品模型** | 02 L3。协议 TaskState 也不得投影成这 13 态 |
| `evaluate.ts` `HIGH_RISK` 正则 | `evaluate.ts` | **DISCARD 为理解层** | 02 L1。闸门可留确定性 Grant 校验，接受/拒绝交给 B 的 Intelligence |
| Signal / Opportunity 产品面 | `subject-comm/signal*.ts` | **REFERENCE_ONLY** | 广播/机会市场；决策 #110 仍暂停 |
| 信封里同步整份 `CollaborationRecord` | `envelope.ts` `collaboration_sync` | **REFERENCE_ONLY 形状** | v1 应交换 A2A Message/Task/Artifact 形状的载荷，不把 13 态记录当 wire |
| 旧协作中心 UI / `#nav-collab` | renderer | **不恢复为普通入口** | 00 §8 |

把 B 当 `remote-subject` worker 去 `submitTask`，或把 A2A Task 画成用户任务，都是错误归类。现有 `a2a-remote.ts` 注释写「A2A Task 仅作外部映射；本地 Job 仍是用户面唯一权威」——这只适用于 **External Capability**。Subject 协作不得再把协议 Task 映射进旧 Job。

---

## 3. 外部标准：ADOPT / EXTEND / DEFER / DO_NOT_BUILD

判断口径：buy/integrate before build（01 §3.5）；不自研替代已有协议；第一版不实现不等于架构不留接口。

调研时点：2026-09-02。A2A Protocol 1.0 由 Linux Foundation 托管（[a2a-protocol.org](https://a2a-protocol.org/latest/specification/)）。MCP 现行规范定位为 LLM 应用连接工具与数据（[modelcontextprotocol.io](https://modelcontextprotocol.io)）。VC 2.0 为 W3C Recommendation。AP2 / x402 作为 A2A Extension 存在。ERC-8004 Identity/Reputation 已有部署，Validation 仍不稳定。

### 3.1 A2A v1.0

| 部件 | 标记 | 适配判断 |
|---|---|---|
| Agent Card | **ADOPT** | 公开可协作表面：名字、skills、`supportedInterfaces[]`（url / protocolBinding / protocolVersion）、安全方案。2digime 出示的是 Card，不是 `self.json` |
| Signed Agent Card（JWS RFC 7515 + RFC 8785 JCS） | **ADOPT** | 未验证签名的 Card 不得升为「已信任主体」 |
| `/.well-known/agent-card.json` | **DEFER** 广域；**EXTEND** 本地 | 第一版不开放互联网发现。配对后的 peer 可缓存 Card。以后公开 2digime 才发布 well-known |
| GetExtendedAgentCard | **ADOPT 形状 / DEFER 实现** | 认证后更细 skills。对应最小披露：公开 Card 粗，认证后才给本次需要的技能细节 |
| Message / Part | **ADOPT** | 协商与澄清的协议回合。不是用户 Thread 的替身 |
| Task（`TASK_STATE_SUBMITTED` → `WORKING` → 终态 `COMPLETED` / `FAILED` / `REJECTED` / `CANCELED`；中断态 `INPUT_REQUIRED` / `AUTH_REQUIRED`） | **ADOPT 为协议对象** | **禁止**升为 2digime 用户 Task / 旧 work-runtime Task。`REJECTED` 是对端拒绝的 wire 事实，不是产品 13 态 |
| Artifact | **ADOPT 为协议对象** | 对端交付物。落到本方后成为证据/文件；用户看见结果，不是 A2A Artifact 词。内容完整性若规范未强制，本方仍打 digest |
| Version negotiation | **ADOPT** | 不自研版本方言。绑定在 interface 的 `protocolVersion` |
| Authentication schemes（OAuth + PKCE、mTLS、API key 等） | **ADOPT 声明** | v1 实际认证走已有配对密钥；Card 仍声明方案，便于以后换 |
| JSON-RPC / gRPC / HTTP 三绑定 | **ADOPT 形状 / DEFER 公开 HTTP** | v1 载荷走 KEEP Relay 信封；不自研第四种绑定 |
| Push / streaming（SubscribeToTask） | **DEFER** | 第一版：同步消息 + Relay inbox |
| Extension | **ADOPT** | 以后 AP2 / x402 / `2digime-subject` 都走这里 |
| 现有 `cap_a2a_research_analysis` | **KEEP 为 Tool/Service** | 继续当 External Capability。不得冒充 Subject B |

A2A 的价值是互操作与不透明执行（对方不必交出内部 tool）。它**不够**表达 Owner、Digital Self、最小披露编译、本方验收。那些是 2digime 智能层。

### 3.2 MCP

| 标记 | 判断 |
|---|---|
| **ADOPT** | Host/Client/Server：Resources / Tools / Prompts。已用于只读资料等 |
| **DO_NOT_BUILD** | 用 MCP 冒充 Subject ↔ Subject。MCP server 没有独立 Owner、没有拒绝合作的主体权、没有 Digital Self |
| **DEFER / 勿混** | MCP 可选 Tasks extension 是 Agent↔Tool 的长操作句柄，**不是** A2A Task，更不是用户 Task |

B 调用自己的 MCP/Codex，属于 B 的内部做事，A 不可见。A 不得通过 MCP 去「操作 B」。

### 3.3 身份 / 信任

| 标准 | 标记 | 适配判断 |
|---|---|---|
| W3C Verifiable Credentials 2.0 | **ADOPT 数据模型** | 「Owner 授权此 Subject 在范围内代表我」做成 VC 形状的委托声明 |
| OpenID4VCI | **DEFER** | 钱包式签发/领取。v1 本地签发即可；对象形状预留 VC，避免以后双写 |
| OpenID4VP / 选择披露 | **DEFER** | 与最小披露同向；第一版用本方 compiler + Grant 闸门 |
| DID 方法选型 | **DEFER** | 不自研 DID 链。v1 用 `subjectId` + 通信公钥 |
| Agent Card signature | **ADOPT** | 见 3.1 |
| UCAN / SD-JWT-VC / 第三方 Agent ID 产品 | **DEFER** | 跟踪，不并行自研身份协议。VC 2.0 + Card 签名足够起步 |
| Owner ↔ 2digime 委托 | **EXTEND** | 标准管凭证形状；2digime 管「委托范围来自 Grant、可撤销、不可被模型改写」 |

第一版诚实缺口：还不能向陌生人密码学证明「这个包的 Owner 是现实中的某人」。能证明的是：这个 endpoint 持有配对公钥、这个 Subject Package 在本机、委托声明由该包密钥签署。全球可验证 Owner 身份等 VC 发行方与 OpenID4VCI，不在第一版假装已经成立。

### 3.4 Agent payments

| 标准 | 标记 | 适配判断 |
|---|---|---|
| AP2（Agent Payments Protocol） | **DEFER 实现 / ADOPT 插入位** | 授权层：Intent / Cart / Payment Mandate。可作为 A2A 与 MCP 的 extension。不把转账写进 talk 主链对象 |
| x402 v2（A2A x402 extension，现见 v0.2 spec） | **DEFER 实现 / ADOPT 为 AP2 的稳定币结算扩展** | HTTP 402 精神。Standalone：metadata；Embedded：嵌进 AP2 CartMandate / PaymentMandate。不进 Digital Self |
| 传统卡 / 银行 / 钱包 / 法币 | **DEFER** | AP2 支付方式无关；2digime 不自研收单 |
| Mandate / budget / receipt / refund | **ADOPT 语义 / DEFER 实现** | 与 Grant 同类：确定性事实。模型不得把 payment failed 说成已付 |

支付不是协作本体。没有支付，两个 Subject 仍必须能完成一次真实合作。

### 3.5 Reputation / attestations

| 对象 | 标记 | 适配判断 |
|---|---|---|
| 自有积分 / 信誉市场 / 排行榜 | **DO_NOT_BUILD** | 00：社交匹配不是本体。L3：不为将来平台先造永久分数 Store |
| ERC-8004 Trustless Agents | **DEFER** | Identity + Reputation 登记可作为以后广域发现的可选锚；Validation registry 仍不稳定，不得当 v1 验收 |
| 本地方合作结果学习 | **EXTEND（智能层）** | 「上次 B 在这类目标上交付如何」留在 A 的 Subject 侧经验，由 AI 用于以后选择；不做成全局分数 |
| 第三方 attestations | **DEFER** | 以后作为 Card / VC 上的可选证据 |

v1 判断「B 值不值得合作」：已配对、Card 签名有效（有则验）、endpoint 可达、本次目标匹配、本地方史（若有）。没有历史时用公开 Card + 目标匹配，并允许 B 拒绝。

---

## 4. Digital Subject Network

与 00 冻结的六层一致。上层不得把下层的协议状态当成用户流程。

```text
Identity → Reachability → Discovery → Collaboration → Transaction → Physical Interaction
```

| 层 | v1 落点 | 明确不是 |
|---|---|---|
| **Identity** | Owner / Subject / Endpoint 三件套；配对公钥 | Agent Card 不是 Digital Self |
| **Reachability** | KEEP Relay + E2EE；invite 交换 endpoint | Relay 不是事实源；不可达 ≠ 拒绝合作 |
| **Discovery** | 已配对 `peers.json` + 对端 public-card | 不是写死 peer；不是广域搜索 |
| **Collaboration** | 同一 talk 主链；AI 选择/协商/披露/验收 | 不是 13 态；不是 session/Task |
| **Transaction** | `settlementRef` 空槽 | 本阶段不做支付 |
| **Physical Interaction** | 未实现 | 不提前造物理工作流 |

```text
┌─────────────────────────────────────────────────────────┐
│  Intelligence（AI）                                       │
│  发现谁、谈什么、披露什么、怎么分工、结果好不好、失败怎么办 │
└─────────────────────────────────────────────────────────┘
            │ 不得改写下层事实
┌─────────────────────────────────────────────────────────┐
│  Deterministic boundary                                  │
│  身份 · 签名 · 可达 · 接受/拒绝 · Grant · 实发实收         │
│  支付事实 · 文件存在 · 审计 · 撤销/过期                    │
└─────────────────────────────────────────────────────────┘
            │
     Identity · Reachability · Discovery · Collaboration
     Transaction（空槽）· Physical Interaction（空槽）
            │
     KEEP transport: Relay 只存密文 · 信封 · ACK
     public-card = publishable collaboration surface
     exchange = append-only fact，不是 workflow state
```

**public-card**：我公开愿意合作什么。
**disclosure**：本次合作具体给你什么。二者不得混写进 Digital Self。

Relay 只负责：「消息真实安全地从 A 到 B」。协作怎么进行仍由两边 2digime 决定。

v1 只填 Identity / Reachability / Discovery / Collaboration。Transaction 与 Physical Interaction 留空槽。

---

## 5. AI 与确定性边界

### 5.1 主要由 AI 完成（2digime 真正要创新的层）

| | 问题 | 不是什么 |
|---|---|---|
| A Discovery intelligence | 为了这个目标，我应该找什么样的主体？ | 不是爬公开通讯录的状态机 |
| B Collaboration selection | 这些候选里谁最适合？ | 不是积分排序器 |
| C Negotiation | 需要对方做什么、给什么、何时完成？ | 不是固定邀请表单 |
| D Minimum disclosure | 为了合作最少应披露哪些？ | 不是把 Digital Self 整包寄出 |
| E Division of work | 我做什么、对方做什么？ | 不是用户填的 RACI |
| F Result evaluation | 对方真正完成了吗？够好吗？ | 不是把 A2A `COMPLETED` 当成验收 |
| G Recovery | 继续谈、换人、还是问 Owner？ | 不是 13 态跳转表 |
| H Reputation learning | 这次结果如何影响以后找谁？ | 不是自研信誉币 |

这些判断在 Intelligence 里，走与 Phase 2 同一条 talk 主链：自然语言 → Digital Self → 模型决定是否联系其他 Subject → 真实交换 → exchange 事实 → semantic review → 同一 Thread。

**禁止**产品智能层被这条用户工作流取代：

`discover → invite → accept → assign → execute → verify`

协议层可以有 Task 生命周期。那是 wire。用户与 2digime 仍然只在说话。

### 5.2 代码必须守住的真实世界事实

确定性代码负责，AI 不得改写：

- Subject identity 是否就是声称的那个 `subjectId`
- Agent Card / credential 签名是否通过
- 对方 endpoint 是否真实可达
- 对方是否真实接受（有对端签名或对等信封中的 accept / `TASK_STATE_REJECTED` 事实）
- 当前授权范围（Grant：granted / revoked / expired）
- 可以披露什么（Grant ∩ compiler 输出 ∩ 敏感级）
- 实际发出了什么（内容 digest、字节、接收方 endpoint）
- 实际收到了什么（同样 digest）
- payment 是否真的发生（有 receipt 才是发生；v1 无支付）
- 文件/成果是否真实存在于本方包内
- audit trail（append-only）
- revoke / expiry 之后不得继续当有效

**硬禁止模型重解释：**

| 事实 | 禁止改写成 |
|---|---|
| rejected / `TASK_STATE_REJECTED` | accepted / completed |
| payment failed / 无 receipt | paid |
| credential invalid / 未验证 | trusted |
| execution failed / `TASK_STATE_FAILED` | completed |
| 未发出 | 已披露 |
| 未收到文件 | 已交付 |

与 Phase 2 同一原则：runtime 已知失败时，review 不得改写成成功。

### 5.3 Owner 最终权力如何同时成立

AI 在 **已有 Grant 与默认敏感策略** 内自主协商。Owner 不参与普通回合。

必须停下来问 Owner 的，只有 00/01 已冻结的那类：超出已有授权、高风险、敏感披露、承诺、支付、不可逆动作。没有新决策，不得新增确认按钮或协作阶段。

B 侧同理：B 的 2digime 可拒绝；B 的 Owner 只在 B 的闸门触发时出现。A 不得要求 B 的 Owner 来操作 A 的界面。

---

## 6. 最小永久对象：候选与必要性证明

01 §3.2：答不出「用户主链缺了它为何不成立」，不准加。答「测试需要 / 以后可能用 / A2A 有这个字段」——不准加。

### 6.1 已有、证明可复用（不新建）

| 对象 | 为何已够 | 不准变成 |
|---|---|---|
| **Digital Self / SubjectPackage** | 「我是谁」唯一权威 | 协作专用第二套人格 |
| **Talk Thread / openGoal / TalkExecution** | 用户目标、交流、本方外部执行事实 | 把对端协议 Task 写进 Thread 当用户任务 |
| **Comm identity + peers.json + Relay 信封** | 谁能找到谁、密文怎么走 | Relay 当事实源；公开目录 |
| **AuthorizationGrant** | 单方授权、可撤销、可过期 | 再塞协作 13 态或摘录 |
| **Content-addressed 文件 / digest** | 成果是否真实存在 | 旧 Artifact Store 用户模型 |

### 6.2 需要一条薄的对等交换事实（现有对象不够）

**候选名：`CollaborationExchange`（append-only 事实，不是状态机表）。**

为什么现有对象不够：

| 已有对象 | 缺什么 |
|---|---|
| Thread | 面向 A 的用户，可投影，不能当「对 B 实际发出了哪些字节」的权威 |
| TalkExecution | 记录本方 Capability 调用，不是 B 作为 Subject 的接受/拒绝/交付 |
| Grant | 只说允许什么，不说这次实际寄出了什么 |
| A2A Task | 协议对象，存在对方 runtime，不能成为 A 的用户产品模型 |
| peers.json | 能找到谁，不是这一次合作发生了什么 |

因此一次真实合作最少还要持久：

1. **peer 引用**：`subjectId` + `endpointRef`（已有 Peer 目录承担关系；交换记录只引用）
2. **交换事件**：提议内容摘要、对方 accept/decline 事实、披露 digest、收到证据 digest、本方验收事实（ok / not ok，与 Phase 2 execution truth 同级）
3. **可选 `protocolRef`**：对方 A2A Task id 或信封 id，仅审计，不展示
4. **可选空 `settlementRef`**：v1 恒为空，表示没有支付

不需要：13 个 `CollabUserStatus`、协作中心、session 对象、分工表、用户可见协议状态。

旧 `CollaborationRecord` + 事件流 **思想 KEEP，实现 REFERENCE_ONLY**。新核若复用文件，必须丢掉用户态枚举与 `issuerTaskId` 绑旧 Task 的路径。第一版实现任务再决定是新薄日志还是剪过的 Record；本文不提前造第二套 Store。

### 6.3 明确不建

| 对象 | 理由 |
|---|---|
| 用户 Task = A2A Task | L6；本任务第 11 问 |
| 协作 13 态 | L3；本任务禁止状态机产品 |
| ReputationScore Store | DO_NOT_BUILD |
| SettlementRecord（v1） | 无真钱；预留字段即可 |
| Digital Org / 多方角色 | 第一版暂不要求 |
| 把 Digital Self 镜像给对方的 Profile | L4 第二事实源 |

---

## 7. 第一版双 2digime 真实实验

### 7.1 布置

两个真正独立的 Subject Package，不是两个线程共享一个 runtime 权威，也不是 A 的宿主打开 B 的包去 `submitTask`。

| | A | B |
|---|---|---|
| Package | 独立目录 | 独立目录 |
| Digital Self | Self A | Self B |
| Model | Model A | Model B |
| Owner | Owner A | Owner B |
| 通信身份 | endpoint A | endpoint B |
| 能力 | A 自己的 | B 自己的（例如 B 的模型 + 可选本方工具） |

配对用现有 invite（Owner 交换联系方式一次）。**产品代码不得写死 B 的 subjectId。** 测试 fixture 可以生成两个包并完成 invite，那是实验布置，不是产品里的硬编码身份。

传输：KEEP Relay + E2EE，或本机等价信封。不要求公网 well-known。

推荐实验目标（可换说法，禁止关键词路由）：A 的用户需要 B 所掌握、A 自己没有的具体知识或能力（例如 B 的 Digital Self 里有一项目的验收标准，A 要一页给自己用的说明）。B 用 **B 自己的** 模型/工具完成其部分，而不是 A 远程驱动 B 的 Job runner。

### 7.2 用户主链（A 的正式入口「与 2digime」）

1. A 的用户提出一个真实目标（需要 B 的知识或能力，A 自己做不到或不该做）。
2. A 自己判断需要协作（模型，不是关键词「帮我协作」）。
3. A 在已配对目录中发现合适的 B（智能选择，不是用户点选协议）。
4. A 与 B 建立本次联系（信封 / 协议 Message）。
5. A 只披露 compiler 允许且 Grant 允许的最小信息。
6. B 自己判断接受或拒绝（B 的 Intelligence + Digital Self + Grant）。
7. 接受后 A/B 自主协商分工（协议 Message；用户不填表）。
8. B 调用 **B 自己的** External Capabilities 完成其部分。
9. B 返回结果与必要证据（digest、文件、provenance）。
10. A 按 Phase 2 同类规则验收：失败不得改写成成功。
11. A 在同一 Thread 向自己的用户交付综合结果。

用户过程中不操作：创建协作、选择协议、建 session、填分工表、管理 A2A Task。

B 的用户默认无事可做。若 B 的闸门触发，B 在 **B 自己的**「与 2digime」里被询问，不是跑到 A 的协作中心。

### 7.3 第一版暂不要求（架构须允许以后接入）

开放互联网广域发现、真钱结算、Reputation marketplace、多方群体、复杂组织角色、Digital Org、协作中心 UI、多 Agent 团队编排。

接入位置见 §8。

### 7.4 验收分层

| 层 | 过了才算 |
|---|---|
| 传输 | 密文送达、ACK、非明文进 Relay |
| 主体边界 | B 可拒绝；拒绝后 A 不得当成功；整包 Digital Self 未外发；A 未打开 B 的 Package 去跑 Job |
| 智能 | 用户只在「与 2digime」说话；无协作中心 |
| 正式入口 | 专项 hook 绿 ≠ 完成（02 L8） |

---

## 8. 未来 A2A / VC / AP2 / x402 接入位置

不要为它们先挖平行主链。

| 标准 | 插入点 | 不插入 |
|---|---|---|
| A2A Card / Message / Task / Artifact | 对等交换的协议对象；公开 2digime 的 well-known Card | 用户导航、Digital Self、旧 work Task |
| A2A Extension | AP2、x402、`2digime-subject`（声明这是人拥有的 Subject，不是 SaaS agent） | 新的用户状态枚举 |
| VC 2.0 委托凭证 | Identity 层：Owner → Subject；出示给 B 证明代表关系 | `self.json` 正文 |
| OpenID4VCI / OpenID4VP | 凭证签发/领取与出示 | talk 循环 |
| AP2 Mandate | Auth/Settlement：与 Grant 并列的「允许支付」事实 | Intelligence 提示词里假装已付款 |
| x402 | A2A Extension 或 HTTP 402 结算轨 | Digital Self、Thread |
| ERC-8004 | Discovery/Trust 可选登记，广域之后 | v1 发现的唯一来源 |

v1 即使不实现支付，交换事实上可留空的 `settlementRef`。没有值就是没有支付。模型看见空引用不得说「已经付过」。

---

## 9. 必须回答的 12 个问题

**1. 一个 2digime 怎样证明「我是某个人的授权数字主体」？**
长期：Owner 签发的 VC（VC 2.0）：subject = 此 `subjectId` + endpoint 公钥，mandate = 范围与过期。短期：本机 Package 占有 + 通信密钥签署的委托声明（形状按 VC，发行协议用 OpenID4VCI 以后再接）。不得用「模型说我代表张三」当证明。

**2. 怎样区分 subject / owner / runtime endpoint？**
见 §2.3。Card 与信封绑定 endpoint；Digital Self 绑定 subject；Owner 只出现在委托凭证的 issuer 与闸门。

**3. 怎样发现另一个 2digime？**
v1：已配对 peer 目录 + Discovery intelligence（哪一类主体、目录里谁合适）。以后：well-known Card、受控登记、可选 ERC-8004。不做自研全球搜索引擎。不做广播市场（00 长期假设，03 仍暂停）。

**4. Agent Card 是否足以表达可协作能力？**
足以表达**可协作表面**（skills、endpoint、auth、扩展）。不足以表达 Digital Self、授权边界、本次最小披露、本方验收标准。Card 是门牌，不是灵魂。

**5. Digital Self 哪些内容绝不能直接变成 Agent Card？**
全部 `understandings` 正文、provenance 摘录、材料原文与路径、未确认候选、冲突链、密钥、Grant、完整目标/关系/财务、精确住址与证件。Card 最多：显示名、极粗能力类别、联系 endpoint、认证方案。「会做技术调查」可以；「Owner 正在谈的融资条款」不可以。

**6. A 怎样自主判断 B 是否值得合作？**
AI：目标匹配、Card skills、本地方史。代码：签名、可达、未过期、未在撤销名单。无历史不视为有信誉，只视为未知。

**7. B 怎样自主决定接受还是拒绝？**
B 的 Intelligence + Digital Self + Grant。确定性风险词表（旧 `evaluate.ts` HIGH_RISK）不得当理解层（02 L1）。代码只拒绝「超 Grant / 证书无效 / 不可达」；「想不想做这件事」交给 B 的模型。B 拒绝必须留下 `REJECTED` 或对等 accept=false 事实。

**8. 怎样保证只披露合作必要信息？**
与做事同一 compiler 思想：按本次目标编译最小上下文 → Grant 闸门 → 实发字节打 digest 写入交换事实。默认不发 `self.json`。Extended Card 只在认证后给本次 skills。

**9. AI 自主协商与 Owner 最终权力怎么同时成立？**
见 §5.3。Grant 是 Owner 事先（或闸门时）给出的权力边界。AI 在边界内自主；越界停。不把 Owner 拉进每一轮协商。

**10. 支付/结算未来从哪里插入，而不污染当前主链？**
Settlement 层 + A2A Extension + 与 Grant 同级的 Mandate/receipt 事实。Talk 只投影「是否需要付款、是否已有 receipt」。无 receipt 就不是已付。

**11. A2A Task/Artifact 如何只作为协议对象？**
它们出现在信封或 A2A 绑定里，以 `protocolRef` 记入交换事实。用户面：Goal、人话进展、文件结果。禁止：导航里的 Task 列表、把 A2A 状态机画成进度条、映射回旧 `work.submitTask`。现有研究能力适配器继续把 A2A Task 映射到 **Capability 执行事实**，不得推广为 Subject 协作模型。

**12. 怎样避免协作重新长成状态机系统？**
不设用户协作阶段枚举。不设协作中心。不把协议 Task 生命周期投影成产品步骤。失败由 AI 选择继续谈 / 换人 / 问 Owner，代码只记录发生过的事实。讨论开始围着 flag/listener/13 态转 → Yellow；靠新状态机才能成立 → Red。

---

## 10. 明确禁止事项

- 先做协作页面 / 协作中心 / 恢复 `#nav-collab` 为普通入口
- 先造固定流程状态机或恢复 `CollabUserStatus` 13 态为产品模型
- 把另一个 Subject 当 Tool、Sub-Agent、或 `work.submitTask` 的 worker
- 自研替代 A2A / VC / AP2 / x402 的私有协作协议
- 为一次实验在产品代码里写死对方 identity
- 默认把整个 Digital Self 或 Subject Package 暴露给对方
- 开始设计几十个 collaboration states
- 迁旧 work runtime、把 Job 当协作骨架
- 用 MCP 当 Subject ↔ Subject；把 MCP Tasks 当成 A2A Task 或用户 Task
- 自研积分信誉市场
- 用 mock/hook 成功宣称两个真人主体已经能合作（02 L8）
- 模型把拒绝、未付、证书无效、执行失败改写成成功
- 并行开广域发现、真钱、多方、Digital Org

旧 `local-collaboration` 上帝宿主、Signal/Opportunity 产品面、履行 UI 关死的半成品：REFERENCE_ONLY，不在上面续建。

---

## 11. 报警规则（协作专项）

在 02 的 Yellow / Red 之上，出现以下**任一**立即 Yellow：

- 先做协作页面
- 先造固定流程状态机
- 把另一个 Subject 当 Tool / Sub-Agent
- 自研替代 A2A / VC / payment 标准
- 为一次实验写死对方 identity
- 默认把整个 Digital Self 暴露给对方
- 开始设计几十个 collaboration states

第三轮仍在协议字段 / 状态细节纠缠：**RED**。回到「两个数字主体怎样自然合作」的用户目标。不准再补协议枚举。

---

## 12. 下一项最小实现任务

**已接受（architecture/engineering pass）：** `2DIGIME-COLLABORATION-01-DUAL-SUBJECT-LOOP`

**下一实现任务：** `2DIGIME-COLLABORATION-02-REAL-PEER-RELAY-GATE`

**目标：** 把 SubjectCollabNetwork 的 discovery / transport 从本机内存切到已有配对身份 + Relay/E2EE；不重写 AI collaboration logic；不新协作 UI / 状态机 / session / Task。

**做：** 复用 invite / peers / Relay / E2EE / Grant 合同；A 从配对目录发现 public-card；真实信封往返；检查网络层 payload 的最小披露。

**不做：** 协作 UI、广域发现、支付、信誉市场、多方、迁旧 work、恢复 13 态、硬编码 peer、打开对方 Package 当 worker、为接线增加 collaboration stage。

代码路径上该接线已存在（`createRelaySubjectNetwork` + Talk `consult_subject`）。后续网络薄片以 §13 审计为准，不另起 network runtime。

---

## 13. Subject Network Substrate Audit — 2026-09-08

**任务：** `DIGITALME-SUBJECT-NETWORK-SUBSTRATE-AUDIT-01`

**性质：** READ-ONLY ARCHITECTURE AUDIT。本文仍是 Phase 3 foundation，不升格为总纲。不开始 Feed 实现。不改 schema。不改产品代码。

**Build-vs-Integrate：** 现有 Relay / envelope / invite / peers / public-card / consult / 本地匹配 **足以作为第一版网络基础设施的传输与本地选择底座**。不得另建 `subject-network-v2` / `network-runtime-v2` / `feed-runtime` / `new-relay`。它们还 **不足以直接当 Feed**：Relay 是已配对端点的加密邮局，不是公开候选池；advertisement 是协作公开面，不是通用发布。

### 13.1 现有 substrate 清单（真实调用链）

#### Transport / Relay

| 职责 | 代码 | 调用链 |
|---|---|---|
| Relay HTTP 邮局 | `src/relay-service/server.ts` | `POST /v1/envelopes` 存密文；`GET /v1/envelopes?to=` 按 `toEndpointId` 列出未 ACK；`POST .../ack`；`purgeExpired` |
| 客户端 | `src/subject-comm/relay-client.ts` | `submit` / `fetchFor` / `ack` / `health` |
| E2EE + 验签 | `relay-transport.ts` + `crypto-identity.ts` | `sealForRecipient` → 签名 → Relay；拉取后验签、解密、入本机 inbox |
| Envelope | `envelope.ts` | `SubjectEnvelope`：from/to、kind、TTL、correlation、payload、ACK 字段 |
| Wire | `relay-wire.ts` | 仅 `fromEndpointId` / `toEndpointId` / `sealed` / `signatureB64` |
| 离线 / 重试 | `outbox-store.ts` + `retryOutbox` | 提交失败留 outbox；`subject.communicate` `retryOutbox` |
| Inbox | `inbox-store.ts` | 本机明文副本；ACK ≠ 业务接受 |
| 寻址 | `endpoint.ts` + `identity-store.ts` | `dmep:` endpoint；`peers.json` |

Relay **没有** list-all、search、rank、profile、relevance API。`listForRecipient` 仅按 `createdAt` 排序。

#### Subject identity / publication

仓库 **没有** 名为 `SubjectAdvertisement` 的类型。对应物是 **`PublicSubjectCard`**（`src/subject-collab/types.ts` + `public-card.ts`）。

字段：`subjectId`、`displayName`、`endpointRef`、`publicSkills`、`cooperationScope`、`protocol: 2digime-subject-collab/1`、`reachable`。

发布：`RelaySubjectNetwork.publishPublicCard()` **单播** 给 `listPeers()` 中每一个已配对端，wire=`public_card`。不是广播目录。

配对：`invite.ts` 注释写明 **无公开目录**；Owner 显式 `createInvite` / `acceptInvite`。

#### Discovery

v1 发现 = 已配对 `peers.json` + 缓存的 peer `public-card`。`listCards()` 返回全部已配对卡，**无 score / rank**。Talk 把卡列表交给模型（`formatPublicCardsForModel`），模型自行决定是否 `consult_subject`。

不存在：公开主体列表、discovery broadcast、广域 search。

#### Interaction

| 应用 | 代码 | 谁判断 |
|---|---|---|
| Consult | `consult.ts` → `network.deliver` → Relay `collab_request` | A 侧模型选 `consult_subject` |
| 自动接收 | Electron `autonomousCollabReceive=true` → `relayCollab.start(800)` drain | B 侧 `decideIncomingRequest`（模型 JSON：accept/decline/clarify/alternative） |
| Delegate（Talk `delegate`） | `loop.ts` `DELEGATE_TOOL` | **外部 Agent/Tool**，不是 Subject↔Subject |
| 旧 LocalCollaborationHost | `local-collaboration.ts` | **REFERENCE_ONLY / 禁止接线**（打开对方 Package） |

#### Opportunity

权威消息是 inbox 里的 `kind: signal` envelope。`OpportunityCard` 是派生视图。`SignalPayload`：`intent` / `seeking` / `offering` / `constraints` / `disclosureLevel` / `expiresAt`。匹配在 **接收方本机** `matchSignalLocally`（优先模型；失败才本地 token 重合 fallback）。产品面：04 已标 **REFERENCE_ONLY**（决策 #110）。UI：`#nav-collab` hidden；设置页仍有 Relay URL / invite / 机会卡按钮。

#### Owner control / audit

- 默认无 Relay profile、无 peers → 默认不可被网络找到。
- 显式 opt-in：配置 Relay + 交换 invite。
- Grant 合同：`AuthorizationGrant` 含 `granted` / `revoked` / `expired`（`collaboration/schema.ts`）。
- Exchange 日志：sender/receiver/timestamp/bodyDigest（`exchange-store`）。
- 机械披露闸：`disclosure.ts`（完整 Digital Self / 线程 / 证件密钥 / 支付账号）。
- 无单一「停止全部自动网络活动」开关；停自动接收需关进程或关掉 `autonomousCollabReceive`。没有独立「可发现状态」Owner 开关（只有 card.`reachable` + 是否配对）。

### 13.2 当前真实网络链路

**路径 A — 已配对主体咨询（KEEP，可继承为 Personal Selection）**

```text
Owner 配置 Relay                         [Owner 控制]
Owner A/B 交换 invite → peers.json       [Owner 控制 / 固定规则：无公开目录]
Talk 打开前 publishPublicCard            [网络 transport：单播密文 public_card]
listCards ← 配对目录 + peer-card 缓存    [候选发现：无排序]
模型读公开声明，决定是否 consult_subject  [模型判断 = Distributed Personal Selection]
consultSubject + checkDisclosure         [固定规则：最小披露 / 敏感词闸]
RelayTransport.send collab_request       [网络 transport / E2EE]
B drainInbox（Electron 800ms 轮询）      [自动接收]
B decideIncomingRequest                  [模型判断；无 Owner 确认]
B 回 collab_response                     [网络 transport]
A 等待 drain 得到 decision               [应用：Collaboration]
```

与 collaboration **语义强绑定**的步骤：public-card 字段、consult 工具文案、decision 枚举、合作请求 JSON。Transport 本身不绑定。

**路径 B — Signal / Opportunity（REFERENCE_ONLY）**

```text
已知 peer 的 sendSignal                  [必须已配对；非开放发现]
Relay 或本地 inbox                       [transport]
processInbox → matchSignalLocally        [本地模型；fallback 为 token 重合]
potential_match 才建 OpportunityCard     [本地选择]
自动回 signal_response                   [自动响应]
Owner 点继续/拒绝/交换简介/发起协作       [旧 UX；#nav-collab 隐藏]
```

**Relay 不做：** 推荐、选人、判断是否值得看。

### 13.3 Relay 是否哑基础设施

| 应该做 | 证据 | 现状 |
|---|---|---|
| 传输 / 寻址 | `toEndpointId` 路由 | 有 |
| 暂存 / TTL / ACK / 幂等 | `FileRelayStore` + default TTL 7 天 | 有 |
| 重试 | 客户端 outbox，不在 Relay 内 | 有（客户端） |
| 基本索引 | 按收件人列出 | 有；无主题索引 |
| 安全 | 拒疑似明文；只存 sealed | 有 |
| 授权 | Relay 不验业务授权；客户端拒绝未知 from peer | 有（端侧） |

| 不应该拥有 | 证据 |
|---|---|
| 最终个性化推荐 | 无 |
| 统一 relevance score | `src/relay-service` 与 `src/subject-comm` **无** score/rank/relevance |
| 中心用户画像 / preference model | 无；Relay 不读 payload |
| 决定用户最终看到什么 | 拉取是收件箱，不是 Feed |

明文拒绝正则（`intent`/`seeking`/`offering`）是安全过滤器，不是推荐。

```text
RELAY_AS_SERVICE_LAYER = YES
```

### 13.4 Discovery：候选 vs 最终选择

当前 discovery **不是**开放候选池，而是 **已配对名录**。

- 无中央 relevance score。
- 无 Relay 侧关键词评分。
- `listCards` 无统一 ranking。
- 最终 consult 由 Talk 模型决定。

**可直接继承为 Distributed Personal Selection：** `loop.ts` 把候选交给模型 + `consult_subject`；对端 `decideIncomingRequest`。不要继承 `opportunity-match.ts` 的 token fallback 作为网络排序。

本地 `fallbackMatch`（token 重合）与 `disclosure.ts` / `evaluate.ts` HIGH_RISK 正则是 **本机确定性闸/降级**，不在 Relay。Feed 不得把它们做成中心推荐。

### 13.5 Advertisement → 网络发布？

`PublicSubjectCard` **语义绑在「找人协作」**：`publicSkills`、`cooperationScope`、`2digime-subject-collab/1`。

Envelope **形状**相对通用（from/to/kind/TTL/payload），但 `kind` 枚举现为 `signal | signal_response | collaboration_sync | subject_collab`。

```text
现有 advertisement 不够通用当 Content Publication
现有 envelope 外壳可复用，缺 generic network item kind
```

**最小抽象方向（不改 schema，本轮只记）：** 将来若扩展，只增加一种通用 `network_item`（或同等）载荷类型 + 查询，不新造第二套 Relay。不要把 public-card 字段硬扩成内容/兴趣/offer 大杂烩。

### 13.6 OpportunitySignal 是什么

代码名是 `SignalPayload` / `OpportunityCard`，不是 `OpportunitySignal`。

1. **数据结构：** 偏合作供需（seeking/offering/intent），不是通用 network item。
2. **Filtering：** 在接收方本机，优先模型。
3. **固定关键词/score：** 无中心 score；有本地 BOUNDARY_MARKERS 与 token overlap fallback。
4. **Owner opt-in：** 发送须已知 peer；入站匹配可自动发生。opt-in 配对可继承。
5. **内容候选：** 不能自然冒充内容分发（判定 **B. 合作机会**）。不要用它假装 Feed。

```text
Opportunity = Collaboration-specific signal（可作「已知 peer 上的本地过滤」参考）
≠ generic network item
```

### 13.7 自动化

| 动作 | 现状 |
|---|---|
| 自动接收 | Electron 有（collab drain 800ms）；Signal 需 `processInbox` / `pullRemote`（设置页会拉） |
| 自动判断 | 有：入站 consult 由模型；Signal 由本地模型 |
| 自动响应 | 有：collab_response；signal_response（match 时） |
| 自动过滤 | 有：no_match 静默不建卡 |
| 自动建立持续关系 | **无** subscription；持续关系 = `peers.json` 配对 |
| 必须 Owner 手动 | 配 Relay、换 invite、发 Signal、机会卡「继续/拒绝/简介/开工」（旧 UX） |
| 因安全需要确认 | 披露闸；Grant 合同存在；入站 consult **不**弹 Owner |
| 旧 UX 遗留 | hidden `#nav-collab` 机会卡 |

不要为自动化新增状态机。Feed 应复用「本机模型决定 show/ignore」，不要复用机会卡 stage。

### 13.8 Owner / 主权

满足：默认不公开（无 invite 则无目录项）；显式配对 opt-in；Grant 可撤销/过期；披露可限制；Relay 非事实源。

缺口：无「停止自动网络活动」产品开关；入站合作由模型自动答，低风险筛选已自动化（符合 00）；高风险支付/承诺仍未做网络交易层。

### 13.9 按新战略重分类

| 当前组件 | 新网络角色 | 命名旧？ | 语义也旧？ |
|---|---|---|---|
| Relay | Transport / Service Layer | 否 | 否（已是哑邮局） |
| PublicSubjectCard（无 Advertisement 类型） | Presence / collab publication | 是（常被叫 advertisement） | **是**（绑合作技能） |
| peers.json + listCards | Candidate Discovery（仅已配对） | 「发现」偏大 | **是**（不是开放候选池） |
| Talk consult_subject | Personal Selection | 「合作」文案旧 | 选择机制可继承 |
| Consult | Communication / Collaboration application | 是 | 是（合作请求） |
| Talk `delegate` | AI Capability 调用，不是主体委托 | 易混 | 与 Subject Network 无关 |
| Signal / OpportunityCard | Collaboration-specific | 是 | **是** |
| Owner invite / Relay 设置 | Network autonomy control candidate | 部分 | 配对模型可继承 |
| Opportunity stage UI | 旧产品面 | — | REFERENCE_ONLY |

### 13.10 Feed 第一刀 verdict

目标形态：

```text
Content Publisher
→ Existing Relay
→ Same candidate pool
→ 2digime A → Digital Self A selection
→ 2digime B → Digital Self B selection
```

现有 Relay **能**当传输，且 **不做**个性化推荐。但 **没有**「同一候选池」：只有点对点收件箱；public-card 只发已配对 peer；无内容 envelope。

```text
FEED_SUBSTRATE_PARTIAL
```

**唯一最小缺口（只许这几项，禁止顺手设计完整网络）：**

1. 现有 advertisement 只能发布「我是谁/能协作什么」，缺 generic network item envelope（可复用 `SubjectEnvelope` 外壳）。
2. Relay 已能传输，但只能 peer-to-peer 投递到已知 `toEndpointId`，缺非个性化的广播/候选查询（时间/类型/来源/公开范围/TTL/分页即可）。
3. Opportunity signal **不足以**承载内容候选，不要复用成 Feed 模型。

**不需要新 runtime。**

### 13.11 Feed 第一刀必须坚持的 Gate

```text
NO CENTRAL PERSONALIZED RANKING
NO CENTRAL USER PROFILE
NO CENTRAL RELEVANCE SCORE
NO KEYWORD RECOMMENDER
NO FEED ALGORITHM IN RELAY
```

Relay / Index 可以：时间、类型、来源、公开范围、基础 topic、分页、查询、TTL。

最终 `show / ignore / connect / subscribe` 只能由每个 2digime 在本地按 Digital Self 判断。继承路径 A 的模型选择，不继承路径 B 的合作 schema，不把 `fallbackMatch` 做成推荐器。

---

## 14. Distributed Personal Selection — 2026-09-08 第一真实薄片

**任务：** `DIGITALME-SUBJECT-NETWORK-FEED-01`

**状态：** `DISTRIBUTED_PERSONAL_SELECTION_ACCEPTED`

补上 §13.10 的两个最小缺口，**没有**新 runtime / 新推荐引擎 / 新 UI。

| 缺口 | 落地 |
|---|---|
| Generic Network Item | `src/subject-comm/network-item.ts`：`NetworkItem`（kind=content，visibility=public；不锁成 FeedArticle） |
| 非个性化候选查询 | 同一 Relay 增加 `POST/GET /v1/network-items`；按 kind / publisher / createdAfter / createdBefore / visibility / cursor / limit；拒绝 Digital Self / preference / score 等查询键 |
| Personal Selection | `src/subject-comm/personal-selection.ts`：本地 `selectNetworkItems`；模型失败 → `PERSONAL_SELECTION_UNAVAILABLE`；不复用 Opportunity token fallback |

**Trial：** 同一 Relay、32 条公开候选、同一 `deepseek-v4-flash`、两个隔离 `self.json`。A/B 候选 ID 完全相同。选择差由 Digital Self 解释。反事实 `ni_01`：A=SHOW，B=IGNORE。证据在 gitignored `build/evidence/subject-network-feed-01/`。

**仍不做：** Feed 产品面、`#nav-collab`、FOLLOW/SUBSCRIBE、中心排序、Computer Use。
