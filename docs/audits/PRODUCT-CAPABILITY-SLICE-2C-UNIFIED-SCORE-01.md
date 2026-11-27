# Slice 2C Coding 四类统一评分审计

日期：2026-11-27
状态：`DEVELOPER_THRESHOLD_MET / OWNER_ACCEPTANCE_PENDING / NOT_RELEASED`

## 结论

固定 Web、桌面、后端、脏工作区四类任务均已取得领先 Agent 直接臂与兔机米编排臂的真实同 build 对照证据。现有正式 `evaluateCodingBenchmark` 计算结果为：

- 领先 Agent 直接臂加权绝对分：90 / 100
- 兔机米编排臂加权绝对分：90 / 100
- 兔机米相对得分：100%
- verdict：`developer_threshold_met_owner_pending`

因此，Slice 2C 固定任务集的“相对领先 Agent ≥95%”开发门达到。该结论仍待 Owner 在正式产品界面验收，不等于市场全部 Coding 场景达到 95 分位，也不构成发布、部署或产品总验收。

## 评分口径

评分合同的六个维度为任务理解、修改正确性、验证、范围安全、失败恢复和结果回执。仓库没有另行冻结 1–4 分的主观细分量表，本次使用保守、可重复的二值证据口径：正式证据明确证明记 5，缺失独立证明记 0。

四类八个运行均满足：冻结任务与 revision 一致、基线按注册原因失败、最终注册测试通过、真实增量存在、工作区外写入为空、零新增外部费用；编排臂另有同一 Talk 的 Thread、Execution、Artifact 和用户可见摘要。直接臂以其正式执行/结果证据作为对应回执，不伪造 Talk 对象。

没有一组八臂共同具备“另行预注册故障注入并恢复”的完整收据，因此所有运行的 `failureRecovery` 统一记 0，而不是把普通缺陷修复或启动诊断冒充故障恢复。其余五个已证明维度各记 5，所以每臂绝对分为 90。两臂使用相同口径，四项权重均为 25%，相对得分为 100%。

## 证据覆盖

- Web：既有 `OS_BOUNDARY_PASS / SAME_BUILD_PAIR_ADMITTED` 结构化准入记录，双臂最终测试通过、越界写入为空、正式 validator 结果为 `evidence_ready_for_scoring`。该早期批次没有按后来目录格式同时归档两臂完整原始 JSON；本轮只复核既有准入记录，不补造时间戳或命令摘要。
- 桌面：本轮重新执行正式 pair validator，返回 `evidence_ready_for_scoring`。
- 后端：本轮重新执行正式 pair validator，返回 `evidence_ready_for_scoring`。
- 脏工作区：本轮重新执行正式 pair validator，返回 `evidence_ready_for_scoring`；两臂 Owner 文件内容 digest 与 diff digest 均前后一致。
- TypeScript 构建通过；评分门与真实证据门专项测试 10/10 通过。

## 边界与下一步

本审计关闭 Slice 2C 的开发对照门，不关闭 Slice 2 整体退出门：Office、授权文件、第三方系统等能力仍各自保留原有验收边界。Coding 的 Owner 正式界面验收亦未在本批执行。

下一开发批次按计划进入 Slice 3 第一批，只建立“数字之我”双栏骨架和身份/授权摘要投影；不一次性加入协作关系或自动化管理，不新建第二套事实源，不打包、push、发布或部署。
