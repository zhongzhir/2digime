# PRODUCT-CAPABILITY-SLICE-3B-COLLABORATION-RESULTS-01

**日期：** 2026-11-27  
**范围：** `PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01 / Slice 3-2C`  
**结论：** `DEVELOPER_VALIDATED / OWNER_ACCEPTANCE_PENDING`

## 本批关闭的用户主链

协作方交付结果后，发起方可以在“数字之我”右侧直接看到该协作的真实 Artifact 摘要，并用普通语言选择“采用结果”或“退回结果”。决定继续写入既有协作记录并同步给对方；页面每次操作后重新读取 `collab.interact list`，没有在 UI 保存第二份状态。

## 实现边界

- 只有发起方在成果已交付且尚未决定时显示“采用结果 / 退回结果”；
- 结果待确认时不同时显示“结束协作”，避免同一事实要求两个相互竞争的决定；
- 采用后显示“已完成”，退回真实成果后显示“结果已退回”，协作请求本身被拒绝仍显示“暂未建立协作”；
- 确认文案只说明对象、结果和后果，不展示 record、grant、A2A、exchange 等内部术语；
- 复用既有 Artifact、CollaborationRecord、Grant、Relay/E2EE 和 `decideResult`，没有新增 Store、状态机、一级入口或旧协作中心；
- 本批不增加修改结果的新流程，不进入自动化管理。

## 正式链路修复

首次双 Electron 验证发现：协作履行内部以 20ms 轮询权威 Job 文件，Windows 原子替换窗口下会与 Job runner 写入竞争，导致已开始的任务停在材料准备阶段并在 180 秒后失败。修复没有增加持久状态：协作履行改为订阅既有 `job.updated` 领域事件，只在终态事件到达后读取一次权威 Job；订阅后先读取一次以覆盖事件先到的竞态。Job 仍是唯一执行事实源，事件只负责唤醒。

## 正式链路验证

专项 Electron 测试启动两套独立 `userData` 和两个独立 Subject，通过本机 Relay 完成 invite、E2EE 信号、机会确认、正式协作、接受和成果履行：

1. 响应方使用既有文档能力生成成果，形成真实 Artifact，并通过 Relay 交付和在发起方物化；
2. 发起方在“数字之我”看到结果摘要和“采用结果 / 退回结果”；
3. 第一条成果采用后，双方均派生为 completed / accept；
4. 第二条成果退回后，双方均派生为 rejected / reject；
5. 两次确认文案不含内部协议术语，页面本身也未泄漏内部协议字段；
6. 页面截图人工检查通过：保持既有双栏结构，成果摘要与决定状态清晰，没有新增一级入口。

## 验证结果

- `npm run build`：通过；
- `node --check electron/renderer/digital-self.js`：通过；
- Slice 3-2C Relay/E2EE 双 Electron 成果专项：1/1 通过；
- Slice 3-2B 管理动作回归：1/1 通过；
- Slice 3-2A 只读协作投影回归：1/1 通过；
- 既有本地协作领域回归：2/2 通过；
- 截图：`%TEMP%/digital-self-slice3c-collaboration-results.png`，目视通过。

## 未关闭事项

- 尚未建立一条人在环自动化和一条低风险全自动化；
- 尚未完成两条自动化各连续 10 次正式运行门；
- 尚未由两个真人 Owner 完成 Slice 3 退出门验收；
- 未打包、push、公开发布或部署。

下一小批次进入 Slice 3 自动化的第一刀：只审计并投影已经成立的自动化事实与现有启停/撤销能力，先选定一条人在环自动化主链；不新增 workflow 产品、第二事实源或一级入口。
