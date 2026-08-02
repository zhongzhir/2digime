# Digital Me V2 架构反向审查报告

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 8
- 版本:v0.2(2026-08-02,随 P0.1 契约修订复跑)
- 状态:`draft_for_cto_review`
- 审查对象:`docs/v2/` 五份规格(v0.2)+ `digitalme-v2/` 骨架(编译零错误,31 项契约冒烟全绿)
- 每阶段出口须复跑本审查六问(phase plan 纪律)

---

## 1. 六问结论

### Q1 是否仍然是完整 Digital Me,而非写作工具?

**是。** 判据:① 三条主线(Subject / Work / Collaboration)在架构 §1 各有正式层、正式对象与代码目录(`subject-core/`、`work-runtime/`+`capability/`、`collaboration/`),骨架中同时存在且编译通过;② "document 首切片"在规格中被明确定性为成本考虑而非产品定位(phase plan P1 开头);③ P2 强制接入第二类非写作能力作为架构可扩展性证明;④ 主体成长(GrowthEvent → 已确认经验 → 下一任务注入)是首切片 9 步中的第 7、8 步,不是附加项。残余风险:实现期资源全部投向 document 路径导致事实性退化——由 phase plan 风险表 + 每阶段复跑本审查约束。

### Q2 构建、做事、协作是否都具有正式架构位置?

**是。**

| 主线 | 正式对象 | 正式接口 | 骨架代码 |
|------|---------|---------|---------|
| 构建(Subject) | SubjectPackage、GrowthEvent | `subject.*` 命令、EventLog 端口、派生视图函数 | `src/subject-core/`(3 文件) |
| 做事(Work) | Task、ContextSnapshot、ExecutionJob、Artifact、CapabilityRegistration | `work.*`/`artifact.*`/`capability.*` 命令、CapabilityAdapter、执行器契约 | `src/work-runtime/`、`src/capability/`(8 文件) |
| 协作(Collaboration) | AuthorizationGrant(持久)+ 7 个 schema 对象 | `collab.simulateInteraction`、本地模拟函数 | `src/collaboration/`(2 文件) |

协作按 Owner 指令只做 schema + 接口边界 + 本地模拟,但边界是第一天就存在的正式边界,不是占位注释。

### Q3 是否只有一个任务和 Job 事实源?

**是(P0.1 后更强)。** 判据:① Task 是**纯意图对象**——没有 status 字段,也不持有 `jobIds`/`activeJobId`/`artifactIds` 指针(P0.1 移除了指针镜像这一潜在双事实源),关联由 Job/Artifact/Snapshot 的 taskId 单向反向承载;② 状态只能经 `deriveTaskState(jobsForTask)` 派生,最新 Job 按 createdAt+id 全序选取,冒烟验证含重试场景;③ ExecutionJob 五态封闭,`transitionJob` 是唯一写入口,非法迁移抛错;④ 单 Task 单活跃 Job 由执行器查询 Job Store 强制(contracts §3.2),Job Store 是唯一判定依据;⑤ 幂等提交协议(Artifact id 由 jobId 确定性派生)+ 崩溃恢复协议(contracts §3.3/3.4)保证成功只产生一个权威 Artifact,恢复动作冒烟全覆盖;⑥ 用户面四态是封闭映射表;⑦ domain model §5 明确禁止 flag+digest 双源。UI 状态 = f(命令返回 + 事件流),Renderer 无独立事实状态。

### Q4 新增图片、编程、视频能力是否只需添加 Adapter 和 Artifact 类型?

**是(结构上成立,P2 实证)。** 判据:① Work Runtime 主链对能力种类零感知——执行器只调 `CapabilityAdapter.execute`,`CapabilityInput/Output` 不含任何 provider 或体裁专有字段;② Artifact.type 是开放字符串,由 CapabilityRegistration.outputArtifactTypes 声明,新类型只需注册 + Workspace 按类型分发查看器;③ **二进制成果通道已在 P0.1 落地**:Adapter 载荷与 ArtifactContent 均为 text/file/bundle 三形,图像/视频走 file/bundle,不改主链与对象集(v0.1 的遗留项已消除);④ Adapter 类型是代码内封闭白名单(`openai-compatible-model` / `local-tool` / `remote-subject`),注册数据永不指定可加载代码位置,新增类型必须改代码过评审——扩展有形、且不可绕过评审;⑤ 没有万能生成流水线可被"扩进":每类能力自带 Adapter,质量/学习旁路在 Artifact 之后。

### Q5 外部协作是否无需重写主体和任务系统?

**是(P0.1 后更强)。** 判据:① 远端主体在未来形态是一种 `remote-subject` 类 CapabilityAdapter(已在白名单占位),对 Work Runtime 而言与本地模型无区别;② CollaborationJob 直接复用 ExecutionJob 五态语义(`schema.ts` 引用同一 JobStatus 类型,编译期绑定);③ SubjectIdentifier 从 SubjectPackage 派生、CapabilityProfile 从 CapabilityRegistration 派生,开放网络只是给它们增加新的 scheme/传输层,不改权威对象;④ **授权已泛化**:AuthorizationGrant 的 grantee 联合类型(capability | remote_subject)使能力授权与主体协作授权共用同一权威对象、同一 Store、同一撤销语义,外网化只是扩展 grantee 与 origin 的取值,不新建授权体系;⑤ origin 内嵌请求快照,不依赖非持久 InteractionRequest 的存续(悬空引用已消除)。

### Q6 是否重新引入了旧系统的复杂状态和多入口问题?

**否。** 逐项对照 Legacy 病灶:

| Legacy 病灶(勘察证据) | V2 现状 |
|------|---------|
| 约 268 条 IPC,`actBehalf` 单域 53 条 | 命令面 15 条(P0.1 经论证新增 1 条确认命令),硬上限 20,冒烟断言守护 |
| 6–8 套并行状态机(status×lifecycleStatus、plan、attempt、learn job、claims…) | 1 套 Job 五态 + 1 个派生函数;Grant 三态为独立领域的权威状态,非任务状态镜像 |
| Task 指针域与 Store 互为镜像(deliverablePlanning/Execution 指针债) | Task 纯意图对象,零指针字段;关联单向反向承载(P0.1 移除) |
| 生成多入口(generateDeliverable / confirmPlanAndGenerate / autoGenerate / run) | 唯一入口 `work.submitTask`(+受限 retry) |
| flag+digest 双事实源(materialsStale) | Snapshot 不可变、每 Job 一个,无"过期"概念;派生值禁落盘 |
| UI 派生相位当权威(do-workspace) | Renderer 零事实状态,UI 无状态改写权 |
| 崩溃/重试产生并行 attempt 与孤儿状态 | 幂等提交(确定性 Artifact id)+ 启动恢复协议,恢复动作封闭枚举且冒烟全覆盖 |
| 任意模块路径式扩展(adapterModule 类形态风险) | Adapter 类型代码白名单,注册数据不含可加载代码位置 |
| 测试钩子进生产总线(`*:test*`) | 命令表封闭枚举,无测试通道 |
| main.js 7300 行业务巨石 | App Shell 薄层纪律 + 领域层零 Electron 依赖(骨架已做到) |

需实现期持续盯防的两点:① `phase`/`progress` 是说明性字段,若有人开始据其做分支判断即变相第二状态机(评审红线);② 命令上限依赖 CTO 复核执行力,冒烟断言只能挡住数字超标。

## 2. 骨架验证证据

- `npm run verify`:tsc strict 编译零错误;冒烟 31 项全绿,覆盖:Task 无状态/指针字段、Job 转移守卫与非法迁移拒绝、重试后按最新 Job 派生、幂等 Artifact id、崩溃恢复四种动作、成长闭环(candidate 不注入 → 确认保留精确锚点 → confirmed 注入 → 重复确认拒绝)、Grant 双形态(capability/remote_subject)与 origin 快照、Adapter 白名单拒绝非法类型、命令数上限(15 ≤ 20)。
- 领域层零运行时依赖(仅 devDependencies:typescript、@types/node),零 Electron 依赖,零 Legacy import。

## 3. Legacy 失败案例 → V2 架构反制映射(抽样)

| 失败案例(仓库审计文档) | V2 反制 |
|------|---------|
| 生成生命周期反复修补(MVP-GENERATION-LIFECYCLE-FIX-01) | 五态封闭 + 唯一转移函数 + 派生态不落盘 + 启动恢复协议封闭枚举 |
| 前台超时伪装失败 / timed_out_but_running | UI 无状态改写权;超时只改文案 |
| 重试/崩溃产生重复成果或孤儿 attempt | Artifact id 由 jobId 确定性派生;半途崩溃由恢复协议补交而非重新生成 |
| 学习链阻塞交付、追逐单次评分 | 反馈是 Artifact 之后的异步 GrowthEvent,写失败不影响交付 |
| packaged 与 dev 行为分叉 | 同一运行链承诺 + 20 连门(P1 出口) |
| 材料 stale 假阳性 | Snapshot 不可变,无 stale 概念 |

## 4. 审查结论

六问全部通过(P0.1 修订后 Q3/Q4/Q5 判据增强,v0.1 遗留的"二进制内容引用形态"已消除)。本报告与五份规格(v0.2)一并进入 CTO 复核;复核通过前不进入 P1 实现。遗留跟踪项(非阻断):候选经验 diff 提炼的质量调优(P1 实现期)、Legacy 一次性导入器(P3,按需)。
