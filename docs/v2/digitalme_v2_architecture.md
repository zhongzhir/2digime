# Digital Me V2 架构规格

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 1
- 版本:v0.2(2026-08-02,P0.1 契约修订同步)
- 状态:`draft_for_cto_review`(CTO 复核通过前不得进入实现)
- 上位授权:Owner 指令 DIGITALME-FOUNDATION-V2
- 配套文档:`digitalme_v2_domain_model.md` · `digitalme_v2_runtime_contracts.md` · `digitalme_v2_migration_boundary.md` · `digitalme_v2_phase_plan.md` · `digitalme_v2_legacy_reuse_inventory.md` · `digitalme_v2_reverse_audit.md`

---

## 1. 系统定位

Digital Me V2 是完整的个人数字主体系统,架构上同时承载三条正式主线:

| 主线 | 含义 | 架构位置 |
|------|------|---------|
| A. Subject | 数字之我的构建与成长 | Subject Core |
| B. Work | 数字之我调用外部能力完成真实任务 | Work Runtime + Capability Layer |
| C. Collaboration | 数字主体之间的授权协作 | Collaboration Core |

允许分期实现,但三条主线自第一天起都有正式对象、正式接口边界与正式目录位置。系统不得退化为写作工具、聊天助手或单一 Agent 外壳。

## 2. 分层总览

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (UI)                                          │
│  · 只呈现用户意图与派生视图,不持有独立事实状态           │
└───────────────┬─────────────────────────────────────────┘
                │  Command Bus(粗粒度命令 ≤ 20)+ Event Push
┌───────────────┴─────────────────────────────────────────┐
│  App Shell (Electron main,薄层)                        │
│  · 只做命令路由、窗口、文件对话框;不写业务逻辑           │
├─────────────────────────────────────────────────────────┤
│  Work Runtime                        Collaboration Core │
│  Task → ContextSnapshot →            SubjectIdentifier  │
│  CapabilityAdapter → ExecutionJob →  InteractionRequest │
│  Artifact → FeedbackEvent            AuthorizationGrant │
│                                      (本阶段仅 schema+  │
│  Artifact Workspace(一等对象)        接口+本地模拟)     │
├──────────────────┬──────────────────────────────────────┤
│  Capability Layer│  统一表达 Model / Agent / Skill /    │
│                  │  Tool / Service,经 Adapter 接入      │
├──────────────────┴──────────────────────────────────────┤
│  Subject Core                                           │
│  SubjectPackage(权威)← GrowthEvent(事件入)→ 派生视图 │
├─────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│  原子 JSON 持久化 · SecretStore · 文件解析 · 导出器      │
└─────────────────────────────────────────────────────────┘
```

依赖方向自上而下单向:UI → 命令面 → 领域层 → 基础设施。领域层之间的依赖规则:

- Work Runtime 可读 Subject Core(取上下文),经 GrowthEvent 写回(不直接改包)。
- Work Runtime 依赖 Capability Layer 的 Adapter 接口,不依赖任何具体能力实现。
- Collaboration Core 依赖 Subject Core(身份)与 Work Runtime(Job 语义),反向不成立。
- Subject Core 不依赖其他领域层。

## 3. 各层职责与硬性原则

### 3.1 Subject Core

负责:Identity、Memory、Preferences、Decision Frameworks、Goals/Intent、Boundaries/Policies、Personal Assets、Growth Events。

原则:

1. **SubjectPackage 是主体权威来源**,本地优先、可导出、可迁移(单目录整体拷贝即迁移)。
2. **新知识只以 GrowthEvent 事件方式进入**,当前视图(preferences、经验索引等)由事件流派生,可重建。
3. 不为每项能力建立独立人格或独立 Store;所有能力共享同一主体。
4. 派生视图损坏时可从事件流重放恢复;事件流是审计与成长记录的唯一来源。

### 3.2 Work Runtime

负责:Task、Context Snapshot、Capability Selection、Execution Job、Artifact、Feedback。

正式主链(唯一正式执行入口):

```
Task → ContextSnapshot → CapabilityAdapter → ExecutionJob → Artifact → FeedbackEvent
```

原则:

1. **一个任务对象**(Task);**一个权威 Job 状态**(ExecutionJob,五态,见 §5)。
2. **一个场景只允许一个正式执行入口**:`work.submitTask` 一条命令走完主链,禁止 Legacy 式 `generateDeliverable / confirmPlanAndGenerate / autoGenerate / run` 多入口并存。
3. 模型、Agent、Skill、工具一律经 Capability Adapter 接入,Work Runtime 不出现任何 provider 专有代码。
4. 质量、学习、审计是 Artifact 产出之后的**后置旁路**,不得阻塞基础成果交付(无 Channel B、无同步 reviewer 链)。
5. 不建覆盖写作、编程、图像、视频的万能生成流水线;每类 Artifact 由对应 Adapter + Artifact 类型承载。

### 3.3 Capability Layer

统一表达 Model / Agent / Skill / Tool / Service。每项能力注册为一条 CapabilityRegistration,至少声明:能做什么(capabilities)、接受什么输入、产出什么 Artifact 类型、需要什么权限、成本与预计耗时、运行位置(local/remote)、可用性状态。

Digital Me 的职责是**选择、授权、调用、验收、回流**,不重复开发市场已有的专业能力。新增一类能力 = 新增一个 Adapter 实现 + (可选)新增一个 Artifact 类型,不允许触碰 Work Runtime 主链代码。

### 3.4 Collaboration Core

第一版即保留正式边界,但仅实现:对象 schema、接口契约、本地模拟。不实现开放网络、交易市场、支付。

核心对象:SubjectIdentifier、CapabilityProfile、InteractionRequest、AuthorizationGrant、CollaborationJob、VerificationResult、SettlementRecord、ReputationEvent。其中本阶段持久化的只有 AuthorizationGrant(进入最小权威对象集);其余对象在本阶段以 schema + 本地模拟内存/快照形态存在,不建独立 Store。

关键设计约束:CollaborationJob 复用 ExecutionJob 的五态语义;对外协作在未来实现时表现为一种 Capability Adapter(`remote-subject` 类),因此**外部协作不需要重写主体系统与任务系统**。

### 3.5 Artifact Workspace

Artifact 是一等对象,不是模型回复附件。首切片即支持:页面直接查看、编辑与自动保存、复制、导出 DOCX/Markdown、打开所在目录、版本记录、来源与任务关联。用户不需要经"文件菜单—打开当前成果"看到工作结果;Task 页面即 Artifact 页面。

### 3.6 App Shell 与 Renderer

- App Shell(Electron main)是薄层:注册命令总线、窗口管理、原生对话框。业务逻辑全部在领域层模块,可脱离 Electron 用 Node 直接测试。**packaged 环境与开发环境使用同一运行链**(同一领域层代码,无 packaged 专用分支逻辑)。
- Renderer 不持有独立事实状态:所有状态来自命令返回值与事件推送,UI 状态 = f(领域事件流)。禁止 UI 侧自建状态机。

## 4. 事实源纪律(反 Legacy 债)

| 规则 | 说明 |
|------|------|
| 单一权威对象集 | 仅 8 个持久核心对象(见 domain model);新增前必须书面证明现有对象无法承载 |
| 禁止 flag + digest 双事实源 | 同一状态只允许一个权威表达;派生值必须标注派生函数且不落盘为独立事实 |
| 禁止分场景/分模型 Store | 所有 Task 一个 Store,所有 Artifact 一个 Store,与场景、能力类型无关 |
| 禁止重复任务状态机 | Task 无自有状态字段;Task 状态 = 派生函数(Jobs, Artifacts),见 contracts §4 |
| 禁止一功能一 IPC | 命令总线粗粒度命令 ≤ 20,按领域分组;禁止测试钩子进入生产命令面 |

## 5. 状态设计

ExecutionJob 权威状态仅五个:`queued | running | succeeded | failed | cancelled`。

Task 不维护第二套状态,由 Job 与 Artifact 派生。用户面仅显示四个状态:**等待开始 · 正在处理 · 已完成 · 需要处理**。映射函数是唯一合法翻译层(定义于 runtime contracts §4),用户面禁止出现 committed、Reviewer、Channel B、generationAttempt、adopted、learning job、authorization record 等后台机制词汇。

## 6. 性能与可靠性承诺(架构级)

| 承诺 | 架构保障 |
|------|---------|
| 提交后 1 秒内创建 Job 并返回 | `work.submitTask` 同步路径只做校验+建 Task/Job+落盘;材料抽取与 Snapshot 构建是 Job 的第一个异步阶段(contracts §3.1) |
| 模型慢不阻塞前台 | Job 在 main 进程异步执行器中运行;UI 靠事件推送更新 |
| 前台超时不伪装任务失败 | UI 无超时改状态权;Job 状态只能由执行器写 |
| 成功只产生一个权威 Artifact | Artifact id 由 jobId 确定性派生;幂等提交协议保证重复提交/崩溃补交写同一 id(contracts §3.3) |
| 重试不产生并行 Job | 重试 = 同一 Task 下新建 Job;执行器查询 Job Store,存在非终态 Job 即拒绝(不依赖 Task 指针,contracts §3.2) |
| 单材料解析失败不拖垮整体 | ContextSnapshot 逐条目记录 `ok/warning`,失败材料降级为警告 |
| 重启恢复 | 8 个权威对象全部落盘;启动按恢复协议处置非终态 Job(补交/重入队/落 failed,contracts §3.4),无内存态孤儿 |

## 7. 代码目录映射

新实现位于独立目录 `digitalme-v2/`,与 Legacy(`digitalme-app/`)零混写:

```
digitalme-v2/
  src/
    shared/          # ids、Result、领域事件、时钟等原语
    subject-core/    # SubjectPackage、GrowthEvent、派生视图
    work-runtime/    # Task、ContextSnapshot、ExecutionJob、Artifact、执行器
    capability/      # CapabilityRegistration、Adapter 接口、注册表
    collaboration/   # 协作 schema、AuthorizationGrant、本地模拟
    artifact-workspace/  # Artifact 查看/编辑/导出契约
    runtime/         # 命令总线契约、持久化端口(Port)
    infrastructure/  # (后续)JSON 持久化、模型 HTTP、文件解析、导出器
  package.json / tsconfig.json
```

语言:TypeScript(契约可编译校验)。领域层零 Electron 依赖;Electron 壳在实现阶段以薄适配层接入。

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 首切片以 document 起步,团队惯性滑回"写作工具" | 反向审查题 1/4 作为每阶段出口门;Capability/Collaboration 骨架先于功能存在 |
| 命令面随功能增长重新碎化 | 命令数上限写入 contracts,新增命令需 CTO 复核 |
| 学习/质量旁路再次侵入主链 | FeedbackEvent 单向出口;主链代码禁止 import 学习模块 |
| Legacy 数据兼容诉求提前污染 schema | 迁移后置,边界见 migration_boundary;V2 schema 不为旧字段留位 |
