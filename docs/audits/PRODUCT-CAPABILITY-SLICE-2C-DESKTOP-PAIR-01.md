# Slice 2C 桌面任务双臂验证

日期：2026-11-27

任务：`2C-DESKTOP-01`

结果：`DIRECT_PASS / ORCHESTRATED_NOT_ADMITTED`

## 结论

桌面任务直接臂真实通过；兔机米 Talk 编排臂尚未取得可准入样本，因此本轮不进入后端或脏工作区任务，也不计算四类评分。

直接臂使用上一门已准入的 OpenAI 官方 Codex Windows Runtime `0.171.0-alpha.13.2`，在独立工作区只修改 `src/main.cjs`。窗口保存坐标位于主屏之外时回退到主屏工作区，预注册测试由退出码 1 变为 0；宿主负向探针继续证明工作区内可写、工作区外 `Access denied` 且无越界文件。

编排臂已真实做到同一代码树、同一 Agent build、独立工作区和同一预注册测试。最后一个干净样本也只修改 `src/main.cjs`，独立测试由失败变为通过，没有遗留补丁临时文件；但 Agent 在最终模型收尾请求上达到 10 分钟执行超时，Talk Execution 失败、Artifact 为空、用户面如实返回未完成。它不能因为代码和测试碰巧已经通过就被追认为成功，也不能进入 pair validator。

## 本轮关闭的产品链欠账

1. 桌面 runner 不再写死 Web 任务，正式读取 collector 冻结的 `taskId`、`projectClass`、`goal` 和 `testFile`。
2. Responses 回环桥支持 custom tool 的双向转换，并把同一轮的并行 function calls 合并为一个 assistant 工具消息，避免第二轮 Chat 历史失真。
3. 自定义 Codex provider 明确 `supports_websockets = false`，只走兔机米已有的 HTTP Responses 回环桥；隔离运行同时禁用 Plugins 与 Apps 初始化。
4. Windows 执行提示禁止会挂起的 `apply_patch` 管道及不稳定的反引号/here-string 写法，要求使用 Node.js `fs` 或 .NET File API、清理临时文件，并在结束前以 `git diff` 和注册测试核对真实修改。
5. 失败诊断保留事件流尾部，不再只留下无因的 `Reading additional input from stdin`。

## 真实运行与费用边界

- 直接臂：通过；`changedFiles=["src/main.cjs"]`，`outsideScopeWrites=[]`。
- 编排臂最终干净样本：代码修改和测试通过，但 Execution 因 `timeout` 失败，`artifactRefs=[]`，未准入。
- 诊断样本曾暴露 WebSocket、并行工具历史、Windows 补丁子进程和收尾超时问题；有一个样本在人工终止卡死子进程后才结束，并遗留 `.codex-patch.txt`，已明确排除。
- 没有购买、充值或新增外部按量费用。托管免费额度从本轮开始时 66% 降至最终 42%；这是明显的既有额度消耗，故停止继续真实重跑。

## 边界与下一步

当前状态为 `SLICE_2C_DESKTOP_DIRECT_PASS / DESKTOP_ORCHESTRATED_TIMEOUT`。下一任务仍是 `2C-DESKTOP-01` 的编排臂收尾可靠性，不得转入 `2C-BACKEND-01` 或 `2C-DIRTY-01`。下一次真实运行前应先建立无模型的“已通过注册测试但最后模型调用挂起”收尾策略与机械回归，保证不把未完成冒充成功，也避免重复消耗托管额度。

本轮不是 95% 结论、Owner 验收、打包、push、发布或部署。结构化证据见 [`evidence/SLICE-2C-DESKTOP-PAIR-01/evidence.json`](evidence/SLICE-2C-DESKTOP-PAIR-01/evidence.json)。
