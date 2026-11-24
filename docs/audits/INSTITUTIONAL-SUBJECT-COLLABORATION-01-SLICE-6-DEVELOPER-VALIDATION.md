# INSTITUTIONAL-SUBJECT-COLLABORATION-01 — Slice 6 同一 Talk 做事主链开发者验证

**日期：** 2026-11-24
**结论：** `UNIFIED_TALK_PATH_IMPLEMENTED / RESULT_TRUTH_GATE_PASS / FAILURE_RECOVERY_PASS / ELECTRON_AUTOMATION_PENDING / NOT_OWNER_ACCEPTED`

## 1. 本轮结果

同一 Talk 模型现在同时看到本地 Capability 与外部 Subject，并依据当前目标、可用能力和真实执行结果自行选择路径。没有新增关键词路由器、协作页面、Task Store、产品状态机或第二套 runtime。

外部协作不再把“请求已发送”或“对方已接受”当作完成。只有对方返回非空可消费贡献，并形成 `a2a:artifact:<exchangeId>` 成果引用时，`consult_subject` 才记录为成功；接受但没有成果按失败事实处理。

拒绝、超时、没有可联系主体或未得到成果都会作为机械执行记录回到同一模型。模型可在同一轮解释失败，或继续选择本地 Capability/另一外部 Subject；后续真实本地成果或外部 Artifact 可以解除该协作失败，不能只靠自然语言宣称完成。

## 2. 完成事实与边界

- `consult_subject` 与本地 Capability 共用既有 `TalkExecution`、结果判定和原 Thread，不另建协作完成状态；
- 外部成功记录 Artifact 引用、exchange、最小安全明细和 evidence digest；完整 Digital Self、token、私钥和原始机构身份信息不进入执行记录；
- 外部调用抛出的普通错误和超时转为可恢复失败；Owner 取消/Abort 仍立即中断，不被伪装成普通失败；
- 未恢复的外部失败使本轮保持 `FAILED` 或 `PARTIAL_SUCCESS`；后续有真实文件、变更成果或有效外部 Artifact 才能恢复；
- 既有审批、授权根、费用和高风险动作边界未放宽。本轮没有购买、付款、生产接入、外部机构数据访问或部署。

## 3. A2A 运行时兼容修复

聚焦验证发现 `@a2a-js/sdk` 的 CommonJS 入口会同步 `require()` ESM-only 的 `jose`，导致 Electron/Node CommonJS 启动报 `ERR_REQUIRE_ESM`。本轮把 A2A SDK 运行时加载改为原生动态 ESM import，同时保留 TypeScript 类型导入；独立参考 Agent 的 server/executor 也按同一方式初始化。

修复后：

- `dist/runtime/digitalme-runtime` 可由 CommonJS 正常加载；
- 官方 A2A 独立 server 仍可完成 Agent Card discovery、Message、Task 与 Artifact 互操作；
- 故意篡改签名的负向用例仍被拒绝。官方 SDK 会为该预期负向用例向 stderr 输出一次签名验证失败堆栈，测试本身通过。

## 4. 工程验证

- `npm run build`：通过；
- Slice 6 新增主链测试：3/3 通过（本地选择、接受但无成果后本地回退、超时后同模型恢复）；
- 本机双 Subject 主链：3/3 通过；
- Relay/E2EE 双 Subject：2/2 通过；
- 两 Owner 非 Electron 自主收件/拒绝：2/2 通过；
- 官方 A2A 独立进程互操作：4/4 通过；
- 既有 Talk 文件写入边界：6/6 通过；
- `git diff --check`：通过；仅有工作区既有 LF→CRLF 提示。

Relay 套件在一次与多套件并行运行时出现过单次时序失败，随后独立重跑 2/2 通过；因此这里记录独立稳定结果，不把它扩写为全仓稳定性结论。

## 5. 未通过与未完成

- 既有 `talk-work-completion-stability-01` 的多轮上下文用例稳定复现为 5/6：第二轮测试提示词未包含上一轮 `GPT-5.4`。该用例走 `delegate`，不走本轮改动的 `consult_subject` 分支；本轮未扩大范围修复，但不能宣称全 Talk 回归通过；
- 正式双 Electron 两端长测两次未通过，并在清理阶段挂起；窄启动观察到真实窗口已创建，但 Playwright Electron 握手仍在 60 秒超时；
- `npm run preflight:electron` 本次也在无新增输出情况下持续挂起，已人工终止，且确认无残留 Electron 进程。因此 Electron 自动化门仍为 pending；
- 没有完成两位真实 Owner、两个独立产品安装端和真实机构身份源的 Slice 5 产品验收；单机测试与此前云端工程试验不能替代该验收；
- 尚未进行 Owner 对 Slice 6 的产品验收，没有合并主干、推送、打包、发布或部署。

## 6. 下一门

先修复或隔离 Electron/Playwright 启动与清理挂起，并由 Owner 在正式产品界面验收：同一 Talk 能选择本地做事或外部协作；外部接受但无成果不得显示完成；拒绝、超时和失联能回到原对话并给出可执行替代方案。上述门通过前，Slice 6 只记为“代码实现与聚焦开发验证完成”，不记为产品完成。
