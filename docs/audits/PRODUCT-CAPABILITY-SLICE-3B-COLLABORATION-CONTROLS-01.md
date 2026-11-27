# PRODUCT-CAPABILITY-SLICE-3B-COLLABORATION-CONTROLS-01

**日期：** 2026-11-27  
**范围：** `PRODUCT-CAPABILITY-AND-PARTNER-CLOSURE-01 / Slice 3-2B`  
**结论：** `DEVELOPER_VALIDATED / OWNER_ACCEPTANCE_PENDING`

## 本批关闭的用户主链

用户在“数字之我”右侧看到正式协作请求后，可以用普通语言接受或拒绝；协作成立后，任一方可以结束并撤销本次授权。页面只投影既有 `CollaborationRecord / Grant`，所有动作继续复用 `collab.interact`，没有新增协作 Store、状态机、一级入口或旧协作中心。

## 实现边界

- 收到且尚未决定的请求显示“接受 / 拒绝”；
- 已发出但尚未接受的请求可取消；已成立或处理中协作可结束；
- 操作前只说明对方、当前目标和后果，不展示 record、grant、A2A、exchange 等内部术语；
- 每次动作完成后重新读取正式 `collab.interact list`，UI 不保存协作状态；
- 修复既有撤销命令的对端选择：响应方结束协作时同步给发起方，不再错误投递给响应方自己；
- 本批不处理成果采用/退回，不建立自动化。

## 正式链路验证

专项 Electron 测试启动两套独立 `userData` 和两个独立 Subject，通过本机 Relay 完成 invite、E2EE 信号、机会确认和正式协作请求：

1. 响应方在“数字之我”接受请求，形成 agreement 与最小 Grant；
2. 响应方结束协作，本地状态与向发起方的同步均成功，状态为 revoked；
3. 第二条独立请求由响应方拒绝，状态为 rejected；
4. 三次确认文案均不含内部协议术语；终态界面显示“已结束 / 暂未建立协作”；
5. 页面截图人工检查通过：双栏结构未改变，协作条目与终态文案清晰，没有增加一级入口。

## 验证结果

- `npm run build`：通过；
- `node --check electron/renderer/digital-self.js`：通过；
- Slice 3-2B Relay/E2EE 双 Electron 专项：1/1 通过；
- 既有本地协作领域回归：2/2 通过；
- Slice 3A 身份授权投影回归：1/1 通过；
- Slice 3-2A 只读协作投影回归：1/1 通过。

## 未关闭事项

- 尚未把真实 Artifact 的交付、采用/退回投影到管理动作；
- 尚未建立一条人在环自动化和一条低风险全自动化；
- 尚未由两个真人 Owner 完成 Slice 3 退出门验收；
- 未打包、push、公开发布或部署。

下一小批次只进入 Slice 3-2C：复用既有成果交付与决定命令，让发起方在同一协作投影中查看真实结果并采用或退回，不进入自动化。
