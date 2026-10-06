# 网关最终审查（2026-10-06，北京时间）

基于 93b6bc5 的候选补丁。本轮未部署、未启用付费搜索、未打包、未 push、未发布。8d888b09 继续观察，真实课程联动未完成。报告正文与生产差异会同时贴入回复，不只提供本机路径。

## 参数与真实复验

仅对两门历史候选复验 1 次，0 搜索，不重试。客户端 maxTokens=2048、temperature=0、responseFormat=json_object，未发送 model 或 thinking。结果 HTTP 200、finish_reason=length、正文 0、judged=0，明确记 TRUNCATED_FAILURE。候选保留，retrievedAt=null，不能用文件保存时间冒充获取时间。现网仍误记 AVAILABLE；候选补丁修正这一合同，尚未上线。

| 层 | 核对结果 |
|---|---|
| 实际网关进程 | deepseek / deepseek-v4-flash，https://api.deepseek.com/v1，输出上限2048，总超时90000ms，provider最多重试2次 |
| 网关到供应商 | max_tokens=min(请求值,2048)，故此前客户端第二pass写4096，供应商仍2048；temperature=0、response_format=json_object，不发送thinking |
| 推理配置 | 官方当前文档默认thinking enabled、effort high；temperature在推理模式不生效。此为文档默认推断，历史响应没有保留reasoning计数，不能称逐请求实测 |
| 实际模型名称 | 进程配置别名deepseek-v4-flash；官方说明旧名称由V4.1-Flash承接。现网没有保存供应商返回model，无法回溯确认该次实际名称 |
| usage | 网关返回1023/0/1023，但空截断分支在parseChatUsage前return，网关随后按字符估算；不能当供应商真实tokens或账单 |

确定缺陷：空截断丢供应商usage；网关及幂等缓存将截断当AVAILABLE。默认推理消耗2048导致没有final JSON是主要配置假设，缺少reasoning计数，不能说已证明。不能盲目加客户端上限。

本轮只读核对实际进程、部署常量、服务布局和三个文件哈希；安全结果见 evidence/gateway-effective-parameters.json。复验见 evidence/managed-final-judgment.json。

官方依据（本轮已读取）：
- https://api-docs.deepseek.com/api/create-chat-completion/ ：thinking默认enabled、effort默认high，JSON可能因length截断。
- https://api-docs.deepseek.com/guides/codex ：旧deepseek-v4-flash名称仍接受，由V4.1-Flash承接。

## 生产候选差异

完整补丁 GATEWAY-FINAL-REVIEW.patch，只改三个生产文件：

1. server.ts：res.close与req.aborted共同取消上游，连接断开不写响应，finally移除监听。正常完整响应不误取消。
2. ai-inference-gateway.ts：started+timeoutMs为一次infer的绝对期限，包含串行排队时间；provider调用与退避只使用剩余时间；到期或caller取消后不启动下一次尝试，迟成功不得AVAILABLE；finally释放timer/listener/并发槽。
3. gateway日志关联安全requestId，非法格式生成UUID；阶段包含validation/provider_start/provider_failure/provider_result，区分gatewayHttpStatus与providerHttpStatus。记录供应商返回responseId（有则记）、有效模型、上限、推理设置、finishReason、输出/推理长度、供应商reasoningTokens（有则记）、usageSource，不记材料、推理正文、凭证。
4. model-http先解析usage再处理空截断；保留供应商实际HTTP、返回model及推理数字metadata。内部返回接口同步调整流式消费并运行回归。
5. 任意length/truncated都返回502、ok=false、PROVIDER_ERROR/error=truncated，幂等命中仍失败。返回的provider usage仍按原账本记录，不能宣称失败不计费或重复扣费。
6. 可选服务端配置MANAGED_AI_STRUCTURED_THINKING=disabled，仅对json_object且无tools的请求转发thinking disabled。客户端白名单不加入thinking，输出上限保持2048；未设置时行为不变。带tools的Talk保留原合同。其他无tools JSON也会受影响，部署后须抽查Self结构判断；不是课程特例。

cancelSent只表示本机AbortSignal已经触发；supplierStopConfirmed=false表示没有供应商停止确认或账单证明。连接断开/SDK返回aborted不能证明远端计算或计费停止。部署后仍须核对公网反向代理传递；本地socket不是Nginx/供应商现场验收。

## 验证

构建通过；55项相关离线测试全部通过，0跳过。9项新增覆盖剩余期限、退避到期、迟成功、caller取消、截断usage与幂等、真实socket断开和正常完成、结构化推理配置、关联ID/日志脱敏。既有非流式/流式、托管限额/并发/重试、失败保留候选也通过。证据 evidence/gateway-final-review-tests.tap。测试不调用真实供应商。

真实复验是线上旧合同1次，仍失败。候选补丁及disabled配置未部署，不能称服务已恢复。两项Discover失败继续未关闭：第70行replenishing expected true / actual undefined；第102行notice expected开启联网发现 / actual空。全部9模块b9cf67f对照也相同；当前目录12卡、第二测试NOT_CONFIGURED并非DISABLED，仍需补真实合同覆盖。

## 待审批部署及回滚

实际布局已只读确认：digitalme-relay.service、/etc/systemd/system/digitalme-relay.service、WorkingDirectory=/opt/digitalme-v2、EnvironmentFiles=/etc/digitalme-relay.env、node=/usr/bin/node、port8787。

推荐审查范围为网关补丁及限定structured thinking配置，配置作为明确可撤销设置。未授权部署，两个脚本本轮均未执行。仅替换三个编译JS，不涉及安装包、主体材料、搜索provider或付费开关。预计一次短时服务重启，可能中断活跃请求，执行应避开活跃任务。

授权后准备：目标创建 /opt/digitalme-review-gateway-20261006/dist/relay-service 和 dist/infrastructure，按路径放三个候选dist JS，以及candidate.sha256、deployed-before.sha256、DEPLOY-AFTER-APPROVAL.sh、ROLLBACK-AFTER-APPROVAL.sh。使用已有Workbench文件工具或已授权SSH，不新建凭证，不传回.env。部署和回滚具体命令在两个.sh中，回复也提供。

部署先校验现网baseline和候选hash，任一变化停下重审；备份三个JS和原env（root0700目录/env0600），替换三文件，仅设置MANAGED_AI_STRUCTURED_THINKING=disabled，再重启服务和检查health。不改systemd单元或Nginx。health失败立即回滚；health通过后最多一次历史两课判断（0搜索），要求正常结束、短JSON覆盖两对象、真实usage可追溯。任一失败停止，不重试、不加预算；恢复旧文件与env，核对baseline hash，再重启检查。

health只证明服务ready；判断、推理配置、反向代理取消和供应商停止仍须现场验证。回滚不删除已有用量记录或成果，不承诺退费。判断稳定后再估算完整课程链费用，17–20次仅为完整链估计，不是普通推荐成本。
