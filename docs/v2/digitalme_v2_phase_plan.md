# Digital Me V2 阶段计划

- 文档编号:DIGITALME-FOUNDATION-V2 / 交付物 5
- 版本:v0.2(2026-08-02,P0.1 修订:最小成长闭环全链纳入 P1)
- 状态:`draft_for_cto_review`
- 纪律:每阶段一个已批准任务块;非阻断问题进 backlog;每阶段出口跑一次反向审查六问

---

## P0 架构规格与骨架(本轮,已执行)

产出:五份规格文档 + 复用清单 + 反向审查 + `digitalme-v2/` 最小可编译骨架(TypeScript 契约与派生函数,零 Electron 依赖)。

出口门:CTO 复核文档通过;`tsc` 编译零错误;反向审查六问全部为"是/否符合预期"。**通过前不进入 P1 实现。**

## P1 第一实现切片(架构最小闭环)

不是"写作产品",是验证完整架构闭环。范围即 Owner 指令第六节 9 步:

1. 创建 SubjectPackage(subject.createPackage / openPackage)。
2. 导入文件与文件夹 → ContextSnapshot(单条失败降级 warning)。
3. 创建 Task(大输入区 goal + 材料引用)。
4. Capability Adapter 调用应用内真实模型(`model.openai-compatible`,复用抽出的 HTTP/密钥原语)。
5. 生成可编辑 Artifact(document 类型,页面直接显示)。
6. 用户修改 Artifact(自动保存 user 版本,无"采用结果")。
7. 修改 → `feedback_recorded` GrowthEvent(后台,candidate,带版本对精确锚点)。
8. **最小成长闭环全链(P0.1 纳入 P1)**:候选经验经 `subject.confirmExperience` 轻量确认 → confirmed 精确经验 → 下一相似任务注入已确认经验视图并可观察到复用。
9. Collaboration Core 本地模拟生成 InteractionRequest + AuthorizationGrant(不执行外网协作)。

交付体验硬指标:提交 1 秒返回;页面直显进度与 Artifact;导出 DOCX/Markdown;失败显示阶段+可行动信息;重启恢复 Task/Job/Artifact/Subject。

实现顺序建议(工程内部,不上抛):
P1.1 infrastructure(json-store、secrets、model-http、extract、export)→ P1.2 Work Runtime 执行器(含幂等提交与崩溃恢复协议)→ P1.3 Electron 薄壳 + 命令总线 → P1.4 Renderer 首切片 UI → P1.5 成长闭环(diff 提炼 → 候选呈现 → 确认 → 下一任务注入)→ P1.6 Collaboration 本地模拟。

出口门:
- 工程自测清单(runtime contracts §7)全绿;
- packaged 构建与开发同链验证,连续 20 次真实 packaged 任务成功(此时才允许构建 portable 并申请 Owner 验收);
- 反向审查复跑通过。

## P2 能力扩展验证(架构可扩展性证明)

目的:证明"新增能力 = 新 Adapter + 新 Artifact 类型",不动主链。

- 接入第二类 Adapter(候选:本地工具类,如"代码片段生成"或"结构化数据整理"),新增一种 Artifact 类型(file/bundle 内容形态已在对象模型就位)。
- 验收标准:`work-runtime/` 目录零修改(或仅注册表数据变化);UI 仅 Artifact 查看器按类型分发。
- 同期:成长闭环调优(候选提炼质量、确认路径的确认负担复查)。

## P3 主体成长深化 + 数据导入(视需求)

- 已确认经验在跨任务上下文注入的效果评估与调优。
- Legacy 一次性导入器(migration_boundary §3 映射表):主体资料 → GrowthEvent;成稿 → Artifact。仅在 Owner 明确需要历史数据时启动。

## P4 协作契约实装(仍不开放网络)

- CollaborationJob 走 ExecutionJob 语义的本地双主体模拟(同机两个 SubjectPackage 互发 InteractionRequest → Grant → Job → VerificationResult)。
- 产出协作链路的完整本地演练证据,为未来开放网络提供接口冻结依据。

## 第一阶段(P1–P4)明确不做

开放协作网络 · 支付结算 · A2A/AP2 完整运行时 · 图片/视频/播客生产界面 · 自研编程 IDE · 自动多轮质量流水线 · 复杂任务市场 · 旧任务完整迁移 · 为演示增加空壳功能。

以上均须可经 Capability Adapter、Collaboration Core、Artifact 类型扩展接入,不得需要推翻基础架构(反向审查题 4/5 每阶段复验)。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 首切片 document 起步造成产品认知回退为写作工具 | 战略偏航 | P2 强制第二类非写作能力;反向审查题 1 每阶段复跑 |
| 命令面/对象集随实现膨胀 | 重蹈 268 IPC 覆辙 | 命令 ≤ 20、对象 8 个的上限写入契约;新增须 CTO 复核 |
| 模型调用真实性(packaged 网络/密钥差异) | 20 连门失败 | 同一运行链承诺;P1.1 先行验证 packaged 下 model-http |
| 反馈提炼质量差 → 经验视图噪声 | 主体成长失真 | candidate/confirmed 两级,confirmed 才注入;不自动采纳 |
| Electron 薄壳纪律松动,业务回流 main | 巨石重生 | main 只允许命令路由/窗口/对话框;代码评审红线 |
| Legacy 并行维护诱惑 | 精力分裂 | Legacy 冻结;阻断级问题(四类)之外一律 backlog |
