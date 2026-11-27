# Slice 3-3A：自动化事实地基审计与验证

日期：2026-11-27  
状态：`DEVELOPER_VALIDATED / PRODUCT_ENTRY_PENDING`

## 结论

既有产品只有 Relay 协作收件箱的自动轮询、模型判断和自动响应。这些行为没有计划要求的定时、文件到达或机构事件触发定义，也没有有效期、费用上限、人在环节点以及暂停、恢复、撤销事实，因此不能直接投影为“我的自动化”。

本批建立了最小自动化事实层，但没有新增执行引擎或 workflow：

- 自动化定义只允许 `scheduled`、`file_arrival`、`institution_event` 三类触发器；
- 每项必须绑定 Goal 模板、允许的 Capability/Subject、有效期、费用上限、人在环设置和明确低风险等级；
- 定义只保存 `active / paused / revoked` 管理事实；撤销后不能恢复；
- 触发回执用自动化 ID 与外部事件唯一键形成确定性幂等 ID，重复事件不能重复提交；
- 回执只关联触发时间、Owner 确认时间以及当前 Talk Thread/Execution/成果路径，不镜像执行或成果状态；
- 真正执行必须进入当前 Talk 主链，后续结果仍由现有 Talk Execution 与应用成果文件的权威事实派生；禁止接回旧 WorkRuntime/Job。

## 新 Store 证明义务

计划要求自动化可以跨重启暂停、恢复、撤销，并能证明十次触发没有重复执行。现有 Goal、Grant、Execution、Artifact 均不能表达“未来哪些外部事件获准触发什么目标”以及“某个外部事件是否已经消费”。因此新增：

1. `automation/definitions`：保存 Owner 对未来触发的持久授权设置；
2. `automation/trigger-receipts`：保存外部事件幂等消费和进入当前 Talk Thread/Execution 的关联。

它们不保存执行阶段、不复制成果、不替代 Grant 或 Talk Execution，因而不是第二执行状态机。

## 验证

- `npm run build`：通过；
- 自动化事实专项：2/2 通过；
- 覆盖机构事件重复触发、人在环单次确认、Capability 越界拒绝、暂停、恢复、撤销和撤销后不可恢复；
- `git diff --check`：通过。

## 未完成

- 尚未接入 Electron 命令面和“数字之我”右侧投影；
- 尚未接入真实机构事件入口，也未形成 Talk 中的 Owner 确认；
- 尚未验证连续 10 次人在环运行；
- 尚未建设低风险全自动运行；
- 未打包、push、发布或部署。

下一小批只把一条机构事件人在环自动化接入既有命令面和当前 Talk 主链，并以真实 Talk Execution/应用成果回读验证；不进入文件观察或定时调度。
