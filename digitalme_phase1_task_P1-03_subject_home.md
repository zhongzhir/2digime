# P1-03 任务包：主体首页信息架构与数据契约

状态：statically_verified（Codex 复核中；Owner 只读沙盒验收暂缓）
阶段：第一阶段 / WP4（主体产品面与观念认知）
前置任务：P1-00、P1-01、P1-02 已接受
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §2.1、§2.2、§3 WP4
审计依据：`digitalme_architecture_audit_20260716.md`、`digitalme_product_spec_v0.2.md`
实现 Owner：Cursor；架构/产品复核：Codex；人工验收：Owner

---

## 1. 目标

建立 Digital Me 第一版“主体首页”，让用户不看说明文档也能形成四个基本认知：

1. **这是我的数字之我**：看见主体名称、所有者、默认私有状态和数据位置；
2. **它由不同可信层构成**：事实、本人声明、系统推断、当前状态、发展意图和边界不能混为一谈；
3. **它连续存在且由我管理**：看见当前版本、最近变化、健康状态和恢复入口；
4. **它能够行动但有明确边界**：看见真实可用、受限和实验中的能力，以及尚未公开的对外状态。

本任务是只读聚合与产品呈现任务，不迁移 Builder/Life/Policies 写入，不建立公网协作，不以漂亮卡片掩盖未知、缺失或未验证状态。

## 2. 产品原则

1. **主体优先，不是数据仪表盘**：首页先回答“是谁、属于谁、由谁决定”，再展示数量；
2. **真实优先**：没有可靠来源的字段显示“未知/尚未建立”，不得硬编码乐观状态；
3. **分层优先**：不得把 inference 显示为 fact，不得把模型生成内容显示为 owner assertion；
4. **可管优先**：版本、健康、恢复、边界与私有状态必须在首页可感知；
5. **只读优先**：本任务读取真实 Package 时不得迁移、补 hash、建 scaffold 或改写任何主体文件；
6. **渐进兼容**：v0.1 Package 必须可只读展示；v0.2 展示更完整版本能力，但不得要求用户先迁移才能打开首页。

## 3. 允许修改

- 新增主进程只读聚合模块，例如 `src/subject-overview/`；
- 新增窄 IPC：`subject:getOverview`；
- 修改 preload，暴露单一只读 overview 接口；
- 在现有“我”页面内建立主体首页，并将用户可见名称调整为“我的数字之我”；
- 复用 PackageStore `inspect/listVersions`、现有能力状态和 Package 读取模块；
- 新增临时 fixture 自动测试和必要的 renderer 样式；
- 更新本任务、阶段计划、能力状态表和 `digitalme_log.md`。

## 4. 禁止修改

- 不改写 `digital-me-package/**`；
- 不在读取时执行 v0.1→v0.2 自动迁移；
- 不迁移 Builder、Life、Policies、scaffold 或离线脚本的写路径；
- 不新增通用文件读写 IPC，不向 renderer 暴露任意 Package 路径读取能力；
- 不实现 PolicyEngine、ToolBroker、可信 AuditService 或真实外部协作；
- 不宣称 placeholder signature 是数字签名，不宣称现有审计不可篡改；
- 不把“资料条数多、覆盖率高”作为主体可信的替代品；
- 不进行全应用导航或视觉体系大改版。

## 5. 数据契约：SubjectOverview v1

建立有版本号、可测试的只读 view model。字段名可按代码规范调整，但语义必须覆盖：

```text
SubjectOverviewV1
├── contractVersion
├── generatedAt
├── identity
│   ├── digitalMeId
│   ├── displayName
│   ├── ownerDisplayName
│   └── ownershipStatus
├── package
│   ├── schemaVersion / revision / updatedAt
│   ├── healthStatus / recoverability
│   ├── locationLabel
│   └── privacyStatus
├── layers[]
│   ├── kind
│   ├── userLabel / explanation
│   ├── count
│   └── countStatus / provenance
├── recentChange
├── capabilities[]
│   ├── id / label
│   ├── status
│   └── limitation
├── boundaries
├── collaboration
│   ├── visibility
│   ├── cardStatus
│   └── authorizationStatus
└── warnings[]
```

### 5.1 契约规则

- `contractVersion` 固定并纳入测试；
- 所有数量必须来自明确文件/索引；无法可靠统计时 `count=null` 且 `countStatus="unknown"`；
- 七类数据使用 P1-02 定义：`evidence / fact / owner_assertion / inference / current_state / development_intent / capability_policy`；
- `owner_assertion` 与 `inference` 必须有不同用户语言和视觉标识；
- `privacyStatus` 第一阶段默认只能表达“本地私有/未公开/状态未知”，不得因存在 contracts 文件就显示“已对外协作”；
- 能力状态必须区分 `available / limited / experimental / unavailable / unknown`，并带限制说明；
- Package 不健康、版本恢复歧义、字段缺失等必须进入 `warnings`，不得被正常卡片掩盖；
- 不把 API Key、token、主体正文、完整行动参数或不必要的绝对隐私路径放入契约。

## 6. 主体首页最小信息架构

### 6.1 主体抬头

- “我的数字之我”明确标题；
- 主体名称、所有者/归属说明；
- “默认私有 · 未公开”状态；
- 当前版本、最近更新时间、Package 健康状态；
- 一句话说明：“它由你的资料、声明、决定和边界持续形成，不是一个通用 AI 账号。”

### 6.2 我的构成

- 展示七类主体数据；
- 每类提供简明解释与真实数量/未知状态；
- 事实、本人声明、系统推断至少在文案和样式上明显不同；
- 不展示大段主体正文。

### 6.3 最近变化与可恢复

- 展示当前 revision、最近可恢复状态和告警；
- 提供进入现有设置页“资料版本”的入口；
- 不在首页重新实现第二套 rollback 逻辑。

### 6.4 我现在能做什么

- 展示写作、研究、受控执行等已有能力的真实状态；
- 对未完成真实验收的能力标记“实验/受限”，不得统一显示“可用”；
- 能力卡可导航到已有入口，但本任务不重写能力实现。

### 6.5 边界与对外状态

- 显示“默认私有、未公开、无自动授权”；
- 显示边界是否已建立、是否存在待处理警告；
- 协作名片/授权尚未落地时显示“尚未建立”，作为后续协作骨架的认知入口，不提供虚假按钮。

## 7. 主进程与安全边界

1. 所有磁盘解析在主进程完成；renderer 只得到 `SubjectOverviewV1`；
2. IPC 不接受任意文件路径；默认只读取当前配置的 Package；
3. overview 生成前后 Package 字节级 hash 必须一致；
4. JSON/JSONL 损坏、权限不足、symlink/reparse 等返回受控 warning，不得静默跳过后显示健康；
5. renderer 对所有动态文本进行安全渲染，禁止把 Package 内容直接拼入 `innerHTML`；
6. 不记录主体正文到普通日志。

## 8. 自动验证

至少覆盖：

1. v0.1 fixture 可只读生成 overview，文件完全不变；
2. v0.2 fixture 正确返回 revision、健康与恢复状态；
3. 七类数据的 count、label、provenance 映射正确；
4. inference 不会被映射为 fact/owner assertion；
5. 缺文件、坏 JSON/JSONL、不可读目录返回 warning 和 unknown，不冒充正常；
6. 无可靠来源的名称、所有者、数量和能力状态不被编造；
7. privacy/collaboration 默认显示私有、未公开、无自动授权；
8. IPC payload 不含 secret、正文样本或任意读取接口；
9. renderer 对恶意名称/文本不产生 HTML 注入；
10. overview 生成前后 fixture 清单 hash 一致；
11. P1-01、P1-02 全部回归继续通过；
12. 修改 JavaScript 语法和 `git diff --check` 通过。

## 9. Owner 人工验收

Owner 使用当前真实 Package 做只读验收，开始前后复验 Package 基线：

1. 打开“我的数字之我”，能立即说出主体名称、归属、默认私有状态；
2. 能区分“事实 / 本人声明 / 系统推断”，且系统没有把未知数量装成确定值；
3. 能看见当前 Package 版本、健康状态以及去哪里恢复版本；
4. 能看见至少三项现有能力及其真实限制；
5. 能确认当前未公开、没有自动对外授权，协作能力尚未建立时如实显示；
6. 重启应用后首页信息一致；
7. 验收前后真实 Package 清单 hash 一致。

Owner 最终应能回答：

- 这为什么不是普通 AI 助手？
- 哪些内容是事实，哪些只是系统推断？
- 这个数字之我现在能做什么、哪些还受限？
- 它是否对外公开，出现错误时去哪里恢复？

## 10. 回滚

- UI 改动可按本任务提交整体回退；
- overview 为只读聚合，不应产生 Package 数据回滚需求；
- 若发现读取导致真实 Package 变化，任务立即失败，停止应用并用基线定位变化，不自动覆盖用户数据；
- 不删除 P1-02 PackageStore、SecretStore 或既有页面。

## 11. 完成证据

实现者交付：

- 修改文件与模块边界；
- `SubjectOverviewV1` 实际 JSON 示例（脱敏）；
- 每个首页字段的数据来源表；
- v0.1/v0.2/损坏数据降级结果；
- 自动测试命令与结果；
- P1-01/P1-02 回归结果；
- Package 前后 hash；
- Owner 验收步骤与未完成边界；
- 分支和独立提交号。

## 12. 停止条件

实现、自动验证和静态复核材料完成后停止，状态最高标为 `statically_verified`。未经 Owner 真实只读验收与 Codex 复核，不得标记 `accepted`，不得顺带启动 PolicyEngine、ToolBroker 或协作骨架。
