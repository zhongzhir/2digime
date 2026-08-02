# Digital Me V2 领域模型

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 2
- 版本:v0.2(2026-08-02,P0.1 契约修订:Task 去指针、Snapshot 关系、幂等提交、内容引用三形、Grant 泛化、Adapter 白名单、成长闭环锚点)
- 状态:`draft_for_cto_review`

---

## 1. 最小权威对象集(V2 初期唯一允许的持久核心对象)

| # | 对象 | 所属层 | 权威职责 | 持久位置 |
|---|------|--------|---------|---------|
| 1 | SubjectPackage | Subject Core | 主体的全部权威数据(身份、记忆、偏好、决策框架、目标、边界、资产) | 用户可选目录(可整体迁移) |
| 2 | GrowthEvent | Subject Core | 主体成长的唯一进入方式;追加式事件流 | SubjectPackage 内 `growth/events` |
| 3 | Task | Work Runtime | 用户意图的单一任务对象 | 应用数据目录 `work/tasks` |
| 4 | ContextSnapshot | Work Runtime | 每次执行(Job)的上下文材料不可变快照;Task 1:N,Job 1:1 | `work/snapshots` |
| 5 | ExecutionJob | Work Runtime | 一次执行的唯一权威状态载体(五态) | `work/jobs` |
| 6 | Artifact | Work Runtime / Workspace | 一等成果对象,含版本记录与任务关联 | `work/artifacts` |
| 7 | CapabilityRegistration | Capability Layer | 一项已接入能力的声明与可用性 | `capability/registrations` |
| 8 | AuthorizationGrant | Collaboration Core | 一次授权的权威记录(本阶段本地模拟) | `collaboration/grants` |

**增补规则**:新增任何永久对象前,必须书面证明上述 8 个对象无法承载,并经 CTO 复核。FeedbackEvent、InteractionRequest 等均不是独立持久对象(见 §3)。

**禁止**:UI 独立事实状态;同一状态 flag + digest 双事实源;分场景 Store;分模型 Store;重复任务状态机;一功能一 IPC。

## 2. 对象定义

字段以 TypeScript 契约(`digitalme-v2/src/`)为可编译权威,本文为规格视图。通用约定:所有对象含 `id`(前缀式,如 `task_`、`job_`)、`createdAt`;所有时间为 ISO-8601;所有对象可 JSON 序列化。

### 2.1 SubjectPackage

```
SubjectPackage {
  id, schemaVersion, createdAt
  identity:  { displayName, description }
  memory:    分区目录(资料、经验索引)——由 GrowthEvent 派生
  preferences / decisionFrameworks / goals / boundaries / assets:
             当前视图文件——由 GrowthEvent 派生,可重建
  growth:    events 追加日志(权威)
}
```

- 权威 = `growth/events` 事件流 + 导入的原始资料;其余视图均为派生,损坏可重放重建。
- 一个运行实例同一时刻挂载一个活跃 SubjectPackage。
- 不为能力建独立人格:任何 Adapter 读到的都是同一主体的投影。

### 2.2 GrowthEvent(追加式,不可变)

```
GrowthEvent {
  id, subjectId, occurredAt
  type: 'preference_observed' | 'experience_confirmed' | 'asset_added'
      | 'boundary_updated' | 'goal_updated' | 'feedback_recorded'
  source: { kind: 'task_feedback' | 'artifact_edit' | 'owner_direct' | 'import',
            taskId?, artifactId?, jobId? }
  payload: {
    title, detail, tags?,
    evidence?: { artifactId, fromVersionId?, toVersionId }   // 精确锚点:源自哪次具体修改
  }
  confidence: 'confirmed' | 'candidate'
  confirms?: string        // 本事件确认的 candidate 事件 id(仅 experience_confirmed)
}
```

- 用户对 Artifact 的修改/反馈 → `feedback_recorded` / `experience_confirmed` 事件;**Feedback 不是独立对象,是 GrowthEvent 的一种来源**。
- **最小成长闭环(P1 范围)**:用户具体修改(版本对 diff)→ `feedback_recorded` candidate(带 evidence 锚点)→ 用户经 `subject.confirmExperience` 确认 → 追加 `experience_confirmed` 事件(`confirms` 指回 candidate,payload 与锚点原样保留)→ 下一相似任务注入已确认经验视图。确认是追加事件,不修改历史事件。
- 下一相似任务读取的是派生出的"已确认经验视图"(`confidence: confirmed`),候选经验不自动进入上下文。

### 2.3 Task

```
Task {
  id, subjectId, createdAt
  goal: string                  // 大输入区的任务目标原文
  contextRefs: [{ kind: 'file'|'folder', path }]   // 用户指定的材料来源
  requestedArtifactType: 'document' | ...          // 随 Adapter 扩展
  capabilityId?: string         // 选定能力;缺省由选择器决定
}
```

- **Task 是纯意图对象**:没有 status 字段,也不持有 `jobIds` / `activeJobId` / `artifactIds` 指针。关联关系由 `ExecutionJob.taskId`、`Artifact.taskId`、`ContextSnapshot.taskId` 反向承载(单向引用,无镜像字段,无双事实源)。
- 状态由派生函数 `deriveTaskState(jobsForTask)` 计算(见 runtime contracts §4),消灭 Legacy `status` × `lifecycleStatus` 双字段债。
- 重试语义:执行器查询 Job Store 中该 Task 的全部 Job;仅当不存在非终态 Job 时才允许创建新 Job(单活跃 Job 由 Store 查询强制,不靠 Task 指针)。

### 2.4 ContextSnapshot(不可变)

```
ContextSnapshot {
  id, taskId, createdAt
  items: [{
    sourcePath, kind: 'file'|'folder-entry',
    status: 'ok' | 'warning',
    warning?: string,            // 解析失败原因;不拖垮其余材料
    contentDigest, extractedTextRef   // 抽取文本的存储引用
  }]
  subjectContextRef?: string     // 注入的已确认经验视图快照引用
}
```

- **基数:Task 1:N ContextSnapshot;ExecutionJob 1:1 ContextSnapshot。** 每次执行(含重试)在 Job 的 context 阶段构建属于该 Job 的新快照;同一 Task 的多次执行各有独立快照,历史快照保留供审计。
- 构建即冻结:Job 的能力调用阶段只读本 Job 的 Snapshot,不回读原文件,保证可重放、可审计。
- 单条目解析失败记 `warning`,Snapshot 整体仍可用。

### 2.5 ExecutionJob

```
ExecutionJob {
  id, taskId, capabilityId, createdAt
  snapshotId?: string            // context 阶段完成后写入;成功的 Job 恰好关联一个 Snapshot
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'   // 唯一权威,五态封闭
  phase?: string                 // 仅供失败定位与进度展示的说明性字段,非状态机
  progress?: { note, updatedAt }
  startedAt?, finishedAt?
  failure?: { stage: 'context'|'capability'|'model'|'artifact_write',
              message, actionable: string }   // 准确显示失败阶段与可行动信息
  artifactId?                    // succeeded 时恰好一个;id 由 jobId 确定性派生
  costActual?: { tokens?, durationMs }
}
```

- 状态只能由执行器写入;UI、超时器、任何旁路无权改写。
- 合法迁移:`queued→running→succeeded|failed`;`queued|running→cancelled`。终态不可再迁移。
- **幂等提交**:`artifactId = artifactIdForJob(jobId)` 确定性派生;重复提交与崩溃后补交写同一 id,不产生第二个权威 Artifact(协议见 runtime contracts §3.4)。
- **崩溃恢复**:启动时对非终态 Job 执行 `recoverJobOnStartup` —— 已有该 Job 的 Artifact → 补交 `succeeded`;`queued` → 重新入队;`running` 且进程已死 → 落 `failed`(阶段保留,提示可重试)。
- 无 attempt 子状态机、无 reviewer 状态、无 Channel A/B:那些属于 Legacy,禁止再现。

### 2.6 Artifact

```
Artifact {
  id, taskId, jobId, subjectId, createdAt   // id = artifactIdForJob(jobId),幂等锚点
  type: 'document' | ...        // 首切片仅 document;类型随 Adapter 扩展
  title
  versions: [{ versionId, createdAt,
               author: 'capability' | 'user',
               content: ArtifactContent, note? }]
  headVersionId                 // 当前内容指针
  storageDir                    // 磁盘目录,支持"打开所在目录";content ref 相对此目录解析
}

ArtifactContent =               // 内容引用三形,支撑非文本成果而不改对象集
  | { kind: 'text',   format: 'markdown'|'plain', ref }
  | { kind: 'file',   ref, mediaType }
  | { kind: 'bundle', entries: [{ ref, mediaType, role? }] }
```

- 一等对象:页面直接查看、编辑自动保存(user 版本)、复制、导出 DOCX/Markdown、版本记录、来源任务关联(`taskId`/`jobId`)。
- 用户编辑追加 `author: 'user'` 版本并移动 head;**保存不要求"采用结果"**,不存在 adopted 概念。P1 仅 `text` 类内容可页面编辑;`file`/`bundle` 提供查看、复制、打开目录。
- 用户编辑触发 diff 提炼 → `feedback_recorded` GrowthEvent(candidate,带版本对 evidence 锚点;后台,不打扰用户)。

### 2.7 CapabilityRegistration

```
CapabilityRegistration {
  id, kind: 'model' | 'agent' | 'skill' | 'tool' | 'service'
  displayName
  description: 能做什么
  inputContract:  接受什么输入(goal + snapshot + subjectContext 的子集声明)
  outputArtifactTypes: ['document', ...]
  permissions: ['network', 'filesystem_read', ...]
  cost: { estimate: string, unit? }
  latencyEstimate: string
  location: 'local' | 'remote'
  availability: 'available' | 'unavailable' | 'needs_setup'
  adapter: { type: AdapterType, adapterId: string }   // 白名单类型 + 实现实例标识
}

AdapterType = 'openai-compatible-model' | 'local-tool' | 'remote-subject'   // 代码内封闭白名单
```

- 注册表是能力的唯一声明处;Work Runtime 通过 `CapabilityAdapter` 接口调用,永不感知 provider 细节。
- **注册数据永不指定可加载代码位置**:废除任意模块路径(原 adapterModule),Adapter 实现由代码静态绑定;`adapter.type` 必须属于白名单,注册时校验,新增类型必须改代码并过评审。
- 能力所需权限(network、secret_access 等)经 AuthorizationGrant 授予(`grantee.kind = 'capability'`),与协作授权共用同一权威对象。

### 2.8 AuthorizationGrant

```
AuthorizationGrant {
  id, grantorSubjectId
  grantee:                       // 泛化:能力授权与主体协作授权共用同一对象
    | { kind: 'capability',     capabilityId }
    | { kind: 'remote_subject', subjectId }
  scope: { actions: string[], resourceRefs?: string[] }
  origin:                        // 授权来源;内嵌快照,无悬空引用
    | { kind: 'owner_direct' }
    | { kind: 'interaction_request', requestId,
        requestSummary: { fromDisplayName, goal } }   // 请求本体非持久,要点随 Grant 落盘
  status: 'granted' | 'revoked' | 'expired'
  grantedAt, expiresAt?, revokedAt?
}
```

- 两种形态:① Owner 直接授予某能力所需权限(`capability` + `owner_direct`);② 协作请求产生的主体间授权(`remote_subject` + `interaction_request`)。同一对象、同一 Store、同一撤销语义。
- InteractionRequest 本阶段不持久,其要点以 `requestSummary` 快照随 Grant 落盘,消除对非持久对象的悬空 requestId 引用。

## 3. 非持久 schema 对象(Collaboration Core 本阶段)

以下对象本阶段**只有 schema 与本地模拟**,不建独立 Store、不实现外网协作:

| 对象 | 本阶段形态 |
|------|-----------|
| SubjectIdentifier | schema + 由 SubjectPackage 派生的本地标识 |
| CapabilityProfile | schema + 从 CapabilityRegistration 派生的可分享投影 |
| InteractionRequest | schema + 本地模拟生成(内存/演示快照) |
| CollaborationJob | schema,复用 ExecutionJob 五态语义 |
| VerificationResult / SettlementRecord / ReputationEvent | 仅 schema 占位,接口边界预留 |

未来开放协作时:远端主体表现为一个 `remote-subject` 类 CapabilityAdapter + CollaborationJob 包装,主体系统与任务系统无需重写(见反向审查题 5)。

## 4. 对象关系图

```
SubjectPackage 1 ──── * GrowthEvent(confirmed 由 confirms 指回 candidate)
      │                     ▲
      │ 派生已确认经验视图    │ 反馈/编辑提炼(后台,带 evidence 锚点)
      ▼                     │
Task(纯意图,无指针)        │
  ▲ taskId                  │
  ├── * ContextSnapshot(每 Job 一个;Task 1:N)
  ├── * ExecutionJob ── 1 snapshotId(context 阶段写入)
  │        │            └── 0..1 artifactId = artifactIdForJob(jobId)
  │        └─ capabilityId → CapabilityRegistration(adapter ∈ 白名单)
  └── * Artifact ── * versions(capability | user;content: text|file|bundle)

AuthorizationGrant ── grantor → SubjectPackage
   ├── grantee: capability | remote_subject(共用授权)
   └── origin: owner_direct | interaction_request(内嵌 requestSummary 快照)
```

## 5. 派生值纪律

| 派生值 | 派生函数 | 禁止事项 |
|--------|---------|---------|
| Task 状态 | `deriveTaskState(jobsForTask)`(最新 Job 按 createdAt+id 全序选取) | 落盘为 Task 字段;Task 持有 Job/Artifact 指针;UI 自算第二套 |
| 用户面状态(四态) | `toUserFacingState(taskState)` | 出现后台机制词汇 |
| 主体当前视图(偏好/经验) | GrowthEvent 重放 | 直接手改视图文件绕过事件 |
| 材料新旧判断 | Snapshot 不可变,无"过期"概念;要更新即建新 Task/新 Job 新 Snapshot | flag + digest 双源(Legacy `materialsStale` 教训) |
