# DIGITALME-CORE-STAGE-REVIEW-01 — Subject / Capability Control / Collaboration 三层核心骨架阶段复盘

Branch: `docs/core-stage-review-01` (base `build/real-subject-collaboration-02` @ `217acbe`)
Owner: User · 2digime: 2digime · Coding Agent: opencode
性质：产品与架构复盘。本任务不写产品代码、不新增测试框架、不扩协议。

---

## 一、核心问题回答

### 1. 现在 2digime 已经真正能做什么？

配置一个模型（如 DeepSeek）后，单用户闭环**真实可用**：

- **了解我**：自然对话 + 引导问题（一次一项、可换题）→ 候选体会 → 确认 → 成为已确认事实；
  阶段成长（未开始/基础建立/基本成形/持续完善）+ 十个方面的缺口 cockpit + 资料导入。
- **做事**：目标 → AI 规划（目标/怎么做/完成标准/边界）→ 用户确认 → 执行（文档为最强路径；
  小代码改动可走已连接的代码执行能力或实验性 model-api 执行器）→ Digital Me 自检验收
  → 用户采用/不采用/提出修改（含截图）→ 导出（复制/md/docx/打开目录）。
- **成长与复用**：从对话、任务反馈、采用/拒绝决定中沉淀经验；后续相似任务注入
  appliedUnderstanding（≤3 条）与经验复用（"沿用经验"可见）。
- **对话内研究**：grounded search 已接入聊天（真实搜索提供方）。
- **研究委托（可用但难到达）**：做事页研究类目标可委托给已配置的外部研究服务，
  本地 CTO 验收、失败自动回退本地能力（runtime 已验证；但设置入口之外的产品入口被隐藏）。
- **主体间协作（runtime 层真实成立）**：真实 HTTP relay（E2EE 密封信封）、最小必要披露、
  对方依自身主体独立接受/拒绝、独立执行、结果 + provenance 回流、双方独立成长、
  失败回退。全部经 REAL-SUBJECT-COLLABORATION-02 真实验证。
- **纪律面**：内部机制默认静默执行得很好（多层 sanitizer + 专门防泄漏测试）。

### 2. 哪些只是工程机制成立，还没有形成自然产品体验？

| 机制 | 工程状态 | 产品状态 |
|---|---|---|
| 远端协作完整履行（fulfill/交付/验收/修订） | runtime 真实闭环（REAL-02 已修通） | **UI 全部关闭**（`canFulfill=false` 等，"本轮只收口建立协作"） |
| 主体候选确认 / 事实修改 / 停用 | 完整 UI 已实现 | **被永久 hidden**（`#subject-hidden-lists`，无任何代码取消隐藏）；确认只能靠聊天状态提示与任务内 owner-choice 间接感知 |
| 首次启动自我介绍（welcome 第 3 步） | 已实现 | **被旁路**：主进程先自动创建默认包，直接进主界面 |
| 做事页外部能力快捷入口（请人帮忙/用专业能力） | 已实现 | **被 force-hidden**；研究服务"设置可达、使用不可达" |
| requestRevision 远端修订 | 本地路径可用 | 远端路径未接线（`openByEndpointRef` 对 dmep: 失败） |
| Managed Capability | 架构预留 | 无托管默认；用户自备 key/模型名/URL |

### 3. 哪些能力已经足够，应停止继续自研？

- **协作协议与 runtime**：CollaborationRecord 事件溯源 / AuthorizationGrant / relay / E2EE /
  最小披露 / receipts——**冻结**。继续扩协议只会增加复杂度，不会增加用户价值。
- **能力闭环核心**：closure 判断、有序 fallback、委托 + CTO 本地验收、action receipt——已闭环。
- **主体上下文选择引擎**：`buildSubjectContextPackage`（distinguishability 100% 盲评验证）。
- **Growth 事件溯源 + 派生视图管线**：0 第二真值源的结构已经稳定。

### 4. 当前最影响真实用户价值的三个缺口

1. **"它在了解我"的感受薄弱**：确认面被隐藏，学习显得被动、不可见、不可纠正——
   用户无法感受到"数字之我在认识我并接受我的校正"这一核心承诺。
2. **首次价值门槛**：无模型 = 对话与做事全部不可用；用户必须先获取 API key、
   理解模型名与 baseUrl。对非技术用户，这条门槛挡住了一切。
3. **做事链的日常质量与摩擦**：规划确认一律出现、修订轮次偏多、验收质量依赖单一
   已连接模型——日常产出的可信度与速度决定留存，而这正是当前最薄的地方。

### 5. 下一阶段开发最值得投入哪里？

见第九节。一句话：**点亮主体确认闭环、把首次价值压到 30 分钟内、打磨做事链日常质量**。
不再补基础设施（协作网络、协议、状态机都不需要）。

---

## 二、Subject Layer 审计

**主体信息如何进入 Talk / Do**：
- Talk：已确认事实 → 聊天顶部"可参考已确认内容"行 + 模型请求上下文（growth-guided 与 normal 同源）。
- Do：任务 → `buildSubjectContextPackage` 选窄上下文（mandatory/applied/reference）→
  注入模型；任务时间线向用户展示 appliedUnderstanding（≤3 条，自然语言）。

**是否真正改变任务结果**：**工程已验证**——SUBJECT-DISTINGUISHABILITY-01（跨任务盲评 100%、
fact distortion 0）、subject-grounded-work、growth closed loop、small-loop 经验复用（偏好/
项目决策/纠错分别复用且不污染无关项目）。

**上下文过度/不足**：最小必要已验证（每任务 selected 0–6 条、中性任务 0 条、无关偏好被排除）。
不足侧的真实风险是**注入质量依赖模型**对窄上下文的利用程度，而不是选择机制本身。

**主体成长是否自然**：采集→候选→JIT 冲突确认→确认→派生视图的链路完整且克制；
但**确认环节的产品面是关的**，成长的"自然感"目前只兑现了一半（用户看得到阶段与缺口，
看不到"待你确认的体会"清单，也无法修改/停用已确认事实）。

**用户能否感受到"这是我的 2digime"**：部分能——任务中的 appliedUnderstanding、聊天上下文行、
成长阶段是真实可感的；SubjectPackage 等内部机制确实从未外泄。但缺少"我纠正它、它记住"
的可见回路，主体感停留在"它了解我"而非"我们共同维护对我的认识"。

**engineering validated vs product experienced**：

| 已 engineering validated | 尚未 product experienced |
|---|---|
| 可区分性 / 状态隔离 / supersede | 候选确认清单、事实修改/停用（UI 已建被隐藏） |
| 窄上下文最小注入 | 学习进度的主动感知与纠正 |
| 经验复用改变后续任务 | onboarding 自我介绍（被旁路） |

**判断：FIX（确认面与 onboarding）；引擎 KEEP。**

---

## 三、Capability Control Layer 审计

- **ordinary model only 基本闭环**：成立。文档任务全链可用；小代码改动有实验性
  model-api 执行器兜底。但前提是"已连接一个模型"——无模型时产品完全不可用。
- **specialist 升级自然**：设置页以自然名呈现（"代码执行能力"），做事页 prep-blocked
  卡引导（"完成这项任务需要代码执行能力"→ 连接/打开设置）；CLI/Adapter/provider 等
  术语被 `stripInternalTerms` 主动改写。升级路径自然度可接受。
- **fallback 自然**：已验证（capability-fallback-closure、delegated-execution CASE C：
  远端失败→本地 baseline→用户面无 HTTP/quota/adapter 错误）。
- **provider-specific leakage**：基本清除。残留一处：bundle 分析报告证据行的
  `claimId → path`（半内部标识符外泄，低危）。
- **用户是否仍被迫处理技术能力配置**：**是**。API key、模型名、服务地址、研究服务 URL
  都由用户处理（有推荐预设与"恢复推荐设置"缓解）。

**Managed Capability 判断**：
对**非技术用户**，它已经不是架构预留而是近期必要——当前门槛阻断全部首次价值。
对**当前实际用户群（开发者型早期用户）**，完整托管（账号体系、计费、marketplace）仍属过早。
结论：**做"最小托管默认"（预置可用的一条模型通道或一键引导），不做完整托管体系**。
完整 Managed Capability marketplace → RESEARCH。

**判断：核心 KEEP（closure/fallback/delegation/CTO review/receipts 冻结）；配置体验 FIX（极简首连）。**

---

## 四、Collaboration Layer 审计

- **runtime proof 还是产品能力**：**主要是 runtime proof + 诚实的实验性外壳**。
  runtime 侧经真实 relay 端到端验证（含我在 REAL-02 修通的交付/授权/物化回流）；
  产品侧有配对、意向、机会卡、提议向导（材料勾选 + 授权范围预览）与状态列表，
  但**履行循环 UI 刻意关闭**，且真实 Digital Me 人口约等于零。
- **用户如何发现另一个 Digital Me**：目前**不能"发现"**——必须先有 relay 服务地址，
  双方互相粘贴邀请 JSON 完成配对；"可能值得了解"机会卡只发生在已配对之后。
  没有目录、没有网络、没有托管 relay（部署物 Dockerfile/Caddyfile 存在但无公共实例）。
- **为什么要与它合作**：机会卡给出互补/共同目标的理由（语义匹配，模型不可用时保守
  文本重合 fallback）；发起方在提议里写明 goal 与验收标准。
- **信任、授权、身份与结果如何被用户理解**：
  - 授权预览是真实的好设计（"对方将看到…/可以做…/不能做…/可随时撤销"）；
  - E2EE 密封信封（relay 不可读明文）；
  - 结果 provenance 在 runtime 完整（sourceArtifact/digest/agreementTermsDigest）；
  - 但远端履行不开放时，"结果如何回来、如何验收"用户无从体验。
- **哪些还只是测试 fixture**：controlled-remote 对端（验证用真实 HTTP 边界）、
  测试内 relay、合成 A/B 主体；机会匹配的语义判断依赖本方 distill 模型。
- **是否应继续开发协作 UI / discovery / network**：**否——RESEARCH**。
  理由：(1) 无真实第二主体人口，discovery/network 无对象；(2) runtime 已成立，
  按"不要因为 runtime 已成立就自动扩功能"原则，下一步应是等待真实需求信号而非扩建；
  (3) 协议应冻结，防止复杂度继续膨胀。

**判断：RESEARCH（协议冻结、UI 保持实验态）；不新开发。**

---

## 五、端到端真实用户链走查（只看用户感受）

**A. 研究一个当前行业问题**
输入目标 → AI 出规划 → 确认 → 执行。
- 有搜索的聊天能即时给 grounded 回答（好）。
- 走做事页研究委托：需要先在设置里配置研究服务 URL（技术操作），且做事页快捷入口
  被隐藏——**真实用户大概率走不到委托路径**，只能得到普通模型基于材料写的"研究报告"。
- 断点：研究能力的**到达性**（配置 + 入口），不是能力本身。

**B. 完成一项开发任务**
目标 → 规划 → 确认规划 → （高风险再确认）→ 执行 → diff/测试/验证结果 → CTO 结论 →
采用（时间线内确认）→ 试用（打开项目/试运行）。
- 链路完整、摩擦点都是刻意设计（安全确认）。
- 断点：代码执行工具的**安装在应用外**（官方渠道自装）+ 首次配置；无能力时降级为
  实验性小改动执行器，用户需理解"实验"含义。

**C. 根据已有项目资料形成成果**（**最强链路**）
添加材料 → 目标 → 规划确认 → 成果正文（可编辑、自动保存、版本）→ 验收结论 →
采用 → 导出 md/docx。主体经验注入（如"结论先行"偏好）真实改变产出。
断点最少，体验最接近产品承诺。

**D. 利用历史经验再次完成类似任务**
相似任务自动复用已确认经验/偏好/项目决策（validated）；用户可在输出中看到
"沿用经验"。断点：复用质量依赖模型；无主动的"经验管理"面（同主体确认面问题）。

**E. 需要外部 Digital Me / Agent 协作的任务**
配对（relay 地址 + 互贴邀请 JSON）→ 发意向/机会卡 → 提议（材料勾选+授权预览）→
对方接受 → **到此为止**（履行/交付/验收按钮全部隐藏；修订远端未接线）。
runtime 能走完全程，但产品面走不完。**结论：E 当前不是产品能力，是实验能力。**

---

## 六、复杂度审计（只列问题，不清理）

1. **schema 残留**：`collaboration/schema.ts` 13 处 `@deprecated`（旧 Grant 扩展字段、
   InteractionRequest、CollaborationJob、VerificationResult、SettlementRecord、ReputationEvent）。
2. **巨型编排器**：`LocalCollaborationHost` 1883 行，双视角编排（发起方本地代 B 评估/
   接收方自身运行）+ 恢复 + 修订 + 状态/列表——履行路由的复杂度集中点；REAL-02 的
   修复正是靠在这上面继续加分支完成的。
3. **适配器叠层**：3 个 remote-subject 适配器（a2a-remote / controlled-remote /
   private-http-remote）+ fake-document（测试用）位于生产适配器目录。
4. **renderer 单体**：`electron/renderer/app.js` 约 8800 行。
5. **建好未开的 UI**（产品决策债）：候选确认清单（hidden）、welcome 自我介绍（被旁路）、
   做事页协助入口（force-hidden）、协作详情履行按钮（强制 false）。
6. **未接线路径**：`requestRevision` 远端分支（`openByEndpointRef` 对 dmep: 必失败）。
7. **传输路由层叠**：LocalSubjectTransport / RelayTransport / LocalPackageTransport /
   transport-factory；且每次 `collab.interact` 命令重建 host + transport。
8. **状态词汇膨胀**：CollabUserStatus 12 态 + renderer work-ux-stage 状态机
   （虽为事件派生、非持久状态机，但词汇在涨）。
9. **工作区残留**：`build/`、`.digitalme-pkgstore/` 等未跟踪目录混在工作区。

**总体判断**：未失控（316 个 src 文件中 125 个测试文件、命令面 23 条封顶、11 个 Store
均为薄 JsonObjectStore 封装、0 第二真值源），但**协作层已达复杂度预算上限**——
任何进一步的协议/状态扩展都应拒绝。连续开发开始出现"建好未开"型膨胀信号。

---

## 七、与长期架构原则对照

| 原则 | 状态 | 备注 |
|---|---|---|
| AI Native / AI First | 基本 ✓ | work.converse 无关键词路由；**偏差**：协作接受/拒绝判断（evaluate.ts）是正则启发式——薄但浅，主体判断质量有限（刻意选择，可接受但要知道） |
| 用户 → 2digime → 专业 Agent | ✓ | delegateTask / collaboration 均此形态 |
| 代表我—做事—协作 | ✓ | 三层齐备且互相独立 |
| 薄约束 | ✓ | 协作状态全部事件派生；高风险判定用正则（薄而脆） |
| 专业能力优先 integrate/invoke/handoff | ✓ | 合同/白名单/receipt 齐备 |
| 主体信息最小必要披露 | ✓ | 两轮实验实证（whole_subject_disclosure=0） |
| 任务闭环优先 | ✓ | Do 链完整 |
| 内部机制默认静默 | ✓ | 多层 sanitizer + 防泄漏测试；claimId 一处小漏 |
| 0 second truth source | ✓ | growth/collab 均事件溯源派生 |
| 避免复杂 workflow/state machine | 基本 ✓ | renderer UX 状态机与 12 态 collab 词汇在边缘膨胀 |

**已出现的偏离**：(1) 协作主体判断的启发式化（浅层正则代替模型判断）；
(2) 双视角履行编排造成的路由重复；(3) 建好未开的 UI 偏离"做当前有用的事"。

---

## 八、最终阶段判断

**KEEP（已成立，近期停止扩建）**
- Subject 上下文选择与注入引擎、Growth 事件溯源 + 派生视图。
- Capability closure / fallback / delegation / CTO review / receipts 核心。
- Collaboration 协议与 runtime（record/grant/events/relay/E2EE/最小披露）——**协议冻结**。
- 内部静默与 sanitization 纪律。

**FIX（明确用户价值问题，近期修）**
- 主体候选确认 / 事实管理面（UI 已建成，被隐藏）——点亮并打磨。
- 首次价值门槛（无模型即全不可用）——最小托管默认或一键首连 + 可先浏览。
- 做事链日常质量（低风险确认减负、验收质量、失败恢复文案、claimId 小泄漏）。
- Welcome 旁路：要么恢复自我介绍路径，要么明确删除。

**RESEARCH（暂不开发，继续观察）**
- 协作 discovery / network / 托管 relay / 多人——等待真实第二主体需求信号。
- 完整 Managed Capability marketplace（只做最小托管默认）。
- Capability swap LEVEL 3（需多模型环境，不为此购模型）。
- 协作主体判断的模型化（当前正则够用与否，随真实协作需求再评估）。

---

## 九、下一阶段建议（最多 3 个）

### 任务 1：点亮主体确认闭环
- **解决的真实用户问题**：用户看不见、也无法纠正 Digital Me 学到了什么——
  "它在了解我"这一核心承诺只兑现一半，信任无法建立。
- **为什么现在做**：UI 已完整实现并有测试覆盖，主体上只差取消隐藏 + 文案打磨 +
  回归验证——单位投入回报最高；且不点亮它，后续所有主体成长投资都无法被用户感知。
- **为什么不是补基础设施**：不需要任何新机制，是纯产品收口。
- **成功后用户感受**："它记住了我说的，我可以确认、修改、让它忘掉"——从被动观察
  变成共同维护。

### 任务 2：首次价值 30 分钟内
- **解决的真实用户问题**：新用户必须先搞到 API key、看懂模型名，否则连对话都不能开始；
  对目标用户（非开发者）这是全部价值的阻断点。
- **为什么现在做**：所有其他投入（包括已完成的三大骨架）在用户连不上模型时价值为零；
  这是当前最大的杠杆点。
- **为什么不是补基础设施**：不是建设托管平台，而是给现有能力一个"开箱默认通道"
  （预置可用的一条模型通道/一键引导），加上"先浏览再连接"的降级体验。
- **成功后用户感受**：打开应用 → 立刻能对话、能跑一个示例任务 → 再被引导完成正式连接。

### 任务 3：做事链日常质量打磨
- **解决的真实用户问题**：留存取决于日常产出的可信度与速度——规划确认一律出现、
  修订轮次多、验收结论质量随单一模型波动、失败恢复文案生硬。
- **为什么现在做**：闭环已经完整，继续加功能边际价值低；"把已有的做好"是当前
  价值密度最高的工程方向（含低风险路径减少确认、验收提示质量、错误文案自然化、
  claimId 清理）。
- **为什么不是补基础设施**：全部是对既有链路的打磨，不新增机制。
- **成功后用户感受**：同样的任务更快拿到更可信的结果，少点几次确认，出错时
  得到人话和下一步。

---

## 十、回归与提交

本任务为纯复盘：0 产品代码改动、0 新测试、0 协议变更。
基线全量测试状态（REAL-02 时点）：877 tests / 841 pass / 31 fail（全部为既有环境依赖失败：
真实模型 e2e + electron 凭证脚本；无新增回归）。

```bash
git commit -m "docs(review): assess digitalme core runtime stage"
```
