# Digital Me V2 运行时契约

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 3
- 版本:v0.2(2026-08-02,P0.1 契约修订:submitTask 异步边界、幂等提交与崩溃恢复协议、成长闭环命令、Adapter 载荷三形)
- 状态:`draft_for_cto_review`
- 可编译权威:`digitalme-v2/src/runtime/`、`digitalme-v2/src/capability/adapter.ts`

---

## 1. 命令总线(UI ↔ 领域层唯一通道)

Renderer 与领域层之间只有两条通路:**命令调用**(request/response)与**事件推送**(单向)。禁止一功能一 IPC;禁止测试钩子进入生产命令面。

### 1.1 首切片命令清单(共 15 条,上限 20 条)

| 命令 | 入参(要点) | 返回 |
|------|-----------|------|
| `subject.createPackage` | displayName, targetDir | SubjectPackage 摘要 |
| `subject.openPackage` | dir | SubjectPackage 摘要 |
| `subject.getOverview` | — | 身份 + 已确认经验计数 + 待确认候选经验列表 |
| `subject.confirmExperience` | eventIds[] | { confirmedCount }(candidate → confirmed,追加事件) |
| `work.submitTask` | goal, contextRefs, requestedArtifactType, capabilityId? | { taskId, jobId }(1 秒内返回) |
| `work.retryTask` | taskId | { jobId }(强制单活跃 Job) |
| `work.cancelJob` | jobId | ok |
| `work.getTask` | taskId | Task + 派生状态 + 最新 Job 摘要 + artifactIds(均实时查询,非 Task 字段) |
| `work.listTasks` | filter? | 摘要列表 |
| `artifact.getContent` | artifactId, versionId? | ArtifactContent(text 类内联返回文本)+ 版本信息 |
| `artifact.saveEdit` | artifactId, text | { versionId }(自动保存,不要求"采用";P1 仅 text 类) |
| `artifact.export` | artifactId, format: 'docx'\|'md', targetPath? | { path } |
| `artifact.revealInFolder` | artifactId | ok |
| `capability.list` | — | CapabilityRegistration 列表 |
| `collab.simulateInteraction` | granteeName, scope | { requestId, grantId }(本地模拟) |

新增命令须满足:属于新的用户决策或新的领域用例,且现有命令无法参数化承载;经 CTO 复核后才可进入。P0.1 新增 `subject.confirmExperience`:确认候选经验是成长闭环(§5)中真实的新用户决策,现有命令无法承载。

### 1.2 事件推送(领域 → UI,单向)

| 事件 | 载荷 | 触发 |
|------|------|------|
| `job.updated` | { jobId, taskId, status, phase?, progress? } | Job 状态/进度变化 |
| `artifact.updated` | { artifactId, taskId, headVersionId } | 新 Artifact 或新版本 |
| `subject.updated` | { subjectId, summary } | GrowthEvent 落盘后派生视图更新 |

UI 状态 = 命令返回值 + 事件流的纯函数;UI 不得基于本地计时器推断或改写任务状态(前台等待超时只影响展示文案"仍在处理",不产生失败态)。

## 2. Capability Adapter 契约

```ts
interface CapabilityAdapter {
  readonly registration: CapabilityRegistration;

  // 唯一执行入口。实现方不得触碰 Store,只消费输入、产出结果。
  execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput>;
}

interface CapabilityInput {
  goal: string;
  snapshot: ContextSnapshotView;        // 只读快照视图
  subjectContext: ConfirmedExperienceView;  // 已确认经验(派生)
  artifactType: string;
}

interface ExecutionContext {
  jobId: string;
  reportProgress(note: string): void;   // 映射到 job.updated
  signal: AbortSignal;                  // cancelled 传播
  secrets: SecretAccessor;              // 声明的权限内取密钥
  workDir: string;                      // Adapter 可写工作目录(file/bundle 产出位置)
}

// 产出载荷三形:执行器负责落盘为 ArtifactContent 引用;
// 图像/视频等二进制成果走 file/bundle,不改主链与对象集。
type CapabilityArtifactPayload =
  | { kind: 'text';   format: 'markdown' | 'plain'; text: string }
  | { kind: 'file';   sourcePath: string; mediaType: string }
  | { kind: 'bundle'; entries: Array<{ sourcePath: string; mediaType: string; role?: string }> };

interface CapabilityOutput {
  artifact: { type: string; title: string; payload: CapabilityArtifactPayload; };
  costActual?: { tokens?: number };
}
```

规则:

1. Adapter 是模型/Agent/Skill/工具/服务接入的**唯一形态**;Work Runtime 主链对能力种类零感知。
2. Adapter 抛错 → 执行器落 `failed` 并归因 `stage: 'capability' | 'model'`;Adapter 无权写 Job/Artifact/Task。
3. 首切片内置一个 Adapter:`model.openai-compatible`(应用内真实模型,复用 Legacy 抽出的 HTTP 原语与密钥存储)。
4. 新增图像/编程/视频能力 = 新 Adapter + 新 Artifact 类型注册,不改主链(反向审查题 4 的结构保证)。

## 3. 执行器契约(Job Runner)

### 3.1 提交边界(<1s 承诺的精确定义)

`work.submitTask` **同步路径只做**:入参校验 → 建 Task → 建 `queued` Job → 两者落盘 → 返回 `{ taskId, jobId }`。目标 < 1s,与材料大小无关。

**ContextSnapshot 构建属于 Job 的第一个异步阶段**(`phase: 'context'`),在执行器中进行:Job 转 `running` → 抽取材料(单条失败降级 warning)→ 写 Snapshot → `snapshotId` 写入 Job → 进入能力调用阶段。context 阶段失败 → Job `failed`(stage: 'context')。因此同步路径耗时不含任何文件解析。

### 3.2 单活跃 Job

创建 Job(submit 或 retry)前,执行器查询 Job Store 中该 Task 的全部 Job;存在非终态 Job 即拒绝创建。**不依赖 Task 上的指针字段**(Task 是纯意图对象),Job Store 是唯一判定依据。

### 3.3 幂等提交协议(Job 成功路径)

1. Artifact id 确定性派生:`artifactId = artifactIdForJob(jobId)`(一个 Job 至多一个 Artifact)。
2. 提交序:写 Artifact(含 capability 首版本,内容落 storageDir)→ Job 迁移 `succeeded` 并记录 artifactId。
3. 幂等性:任一步骤重复执行写同一 id,不产生第二个权威 Artifact;两步之间崩溃由恢复协议补齐。

### 3.4 崩溃恢复协议(启动时)

对每个非终态 Job 执行 `recoverJobOnStartup(job, artifactExistsForJob)`:

| 现场 | 动作 |
|------|------|
| 已存在该 Job 的 Artifact(提交半途崩溃) | `commit_succeeded`:补交 Job → `succeeded`,不重新生成 |
| `queued`(尚无副作用) | `requeue`:重新入队执行 |
| `running`(进程已死) | `mark_failed`:落 `failed`,stage 保留,message 注明"应用重启中断",actionable 提示可重试 |
| 终态 | 不动作 |

Task、Artifact、Subject 全部从磁盘重建;恢复完成后才接受新命令。

### 3.5 取消与环境一致性

- 取消:置 AbortSignal → Adapter 中断 → Job `cancelled`;不可达则超时强制落 `cancelled`(仅执行器有此权力)。
- packaged 与开发环境走同一执行器代码路径,禁止环境分叉。

## 4. 状态派生契约(唯一翻译层)

```ts
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type TaskState =
  | 'waiting'      // 无 Job 或最新 Job queued
  | 'processing'   // 最新 Job running
  | 'completed'    // 最新 Job succeeded 且有 Artifact
  | 'attention';   // 最新 Job failed / cancelled

// 权威实现于 work-runtime/derive.ts;输入为该 Task 的 Job 集合(按 taskId 查询),
// 最新 Job 按 createdAt+id 全序选取,Task 本身不持有指针。
function deriveTaskState(jobsForTask): TaskState;
```

用户面文案映射(封闭表,禁止扩展为后台词汇):

| TaskState | 用户面显示 |
|-----------|-----------|
| waiting | 等待开始 |
| processing | 正在处理 |
| completed | 已完成 |
| attention | 需要处理 |

禁止出现在任何用户面:committed、Reviewer、Channel B、generationAttempt、adopted、learning job、authorization record。失败时用户看到:失败发生的阶段(材料读取 / 能力调用 / 结果保存)+ 一句可行动信息。

## 5. 反馈回流契约(P1 最小成长闭环)

闭环全链在 P1 落地:**用户具体修改 → confirmed 精确经验 → 下一任务复用**。

1. `artifact.saveEdit` 落 user 版本后,后台异步计算与上一版本的差异,提炼为 `feedback_recorded` GrowthEvent(candidate,payload 带 `evidence: { artifactId, fromVersionId, toVersionId }` 精确锚点)。
2. 候选经验经 `subject.getOverview` 呈现(用户面文案:来自你最近修改的可复用经验);用户经 `subject.confirmExperience` 确认 → 追加 `experience_confirmed` 事件(`confirms` 指回 candidate,payload 与锚点原样保留)。确认是轻量单步操作,不引入多轮审批。
3. 下一相似任务构建 `subjectContext` 时只读取 confirmed 派生视图;candidate 永不自动注入。
4. 回流全程不阻塞交付:GrowthEvent 写失败只记日志告警,不影响 Artifact 与 Job 状态。

## 6. 持久化端口(Port)契约

领域层只依赖接口,不依赖具体存储实现:

```ts
interface ObjectStore<T> {
  get(id: string): Promise<T | null>;
  put(obj: T): Promise<void>;      // 原子写(tmp → bak → rename,复用 Legacy 原语)
  list(filter?): Promise<T[]>;
}

interface EventLog<E> {            // GrowthEvent 专用:只追加
  append(event: E): Promise<void>;
  replay(subjectId: string): AsyncIterable<E>;
}
```

首切片实现:JSON 文件存储(每对象一目录,原子写);SQLite 显式后置,替换时领域层零改动。

## 7. 性能与可靠性验收点(工程自测,不上抛 Owner)

| 验收点 | 阈值 |
|--------|------|
| submitTask 返回耗时 | < 1s(仅校验+建 Task/Job+落盘;材料抽取与快照构建为 Job 异步阶段,不计入) |
| 模型调用期间 UI 线程 | 无阻塞(事件驱动) |
| 同一 Task 并行 Job 数 | ≤ 1(压测重试路径) |
| 单材料解析失败 | Snapshot warning,Job 继续 |
| 强杀进程后重启 | Task/Job/Artifact/Subject 全恢复,running 孤儿正确落 failed |
| packaged 连续真实任务 | 20 次成功后才申请 Owner 验收(实现阶段执行,本阶段不构建 portable) |
