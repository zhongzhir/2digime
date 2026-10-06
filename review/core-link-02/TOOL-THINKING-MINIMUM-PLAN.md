# 工具请求推理配置受控对照：最小方案，待复审

2026-10-06；基线 cf32734。此次先提交方案，不改线上配置，不使用此前部署授权，不重复执行完整课程链。当前真实对照尚未执行，新的模型请求/usage为0；cf32734仅作失败定位证据。

## 官方合同与现有缺口

DeepSeek [Tool Calls 官方文档的 Non-thinking Mode](https://api-docs.deepseek.com/guides/tool_calls/)明确支持非思考模式下的工具调用及工具结果后的继续回答；关闭思考不等于关闭tools。文档代码没有显式写thinking开关，而当前[Thinking Mode合同](https://api-docs.deepseek.com/guides/thinking_mode/)说默认开启，因此对照B必须显式发送 thinking.type=disabled，不能仅照抄省略参数的示例。工具思考模式还要求后续请求传回reasoning_content。

现有 model-http 已能向供应商转发thinking及tools，但 managed客户端不发送thinking、网关请求白名单不接受thinking。线上只给无工具json_object设置disabled。工具请求仍provider_default；model-http不保留/续传完整reasoning_content，不能把“支持工具思考”当成当前多轮合同已实现。

## 最小配置差异

cf32734 已有比较证据：客户端 HTTP 502、供应商 HTTP 200、finish_reason=length；输出预算2048，reasoningTokens=2048，最终正文长度0。供应商耗时9575毫秒，usage为input2941/output2048/total4989。它是截断失败，不是可用回复；这些是既有记录，不是本轮新的A/B结果。此次仅准备方案，没有新增真实调用或费用。

| 条件 | A控制组 | B实验组 |
| --- | --- | --- |
| messages、历史原需求、两门课程与来源、tools、tool_choice、模型 | 相同 | 相同 |
| 输出上限 | 2048 | 2048 |
| 期限 | 90秒共享期限 | 90秒共享期限 |
| 推理配置 | 省略，供应商默认 | 显式thinking.type=disabled |
| provider重试 | 对照中0次 | 对照中0次 |

从 cf32734 的比较输入及保存的目标、对象、Self状态重建正式Talk请求，一次捕获后冻结，用同一规范JSON的SHA256确认A/B messages/tools/参数逐字节相同，只允许thinking与请求关联ID不同。上轮没有保存完整出站messages，因此不得称为上轮HTTP请求的逐字节重放；同一用户比较请求、材料与目标的重建对照必须单列这一限制。

复审后建议在原ECS的隔离诊断进程中复用现有供应商账号、模型和密钥，密钥只由该进程原地读取，不输出、不拷到本机，不生成新身份；逐次直达供应商用于参数诊断，明确区别于普通托管安装入口。进程不监听公网、不改systemd/env/正式dist、不部署，不调用搜索。各阶段先校验线上产品哈希，结束再校验；所有真实费用记录供应商usage，并注明诊断调用不通过正式网关安装额度账本，不能据此推断普通用户额度表现。若不允许诊断直连，则需先提供隔离网关环境，不能把参数塞入不支持的正式网关请求。

## 验证顺序与停止条件

1. 比较：A一次、B一次。A允许复现length失败；B必须有非空有效答复或有效工具调用，随后取得有效比较结论，检查两门课程、推荐理由、来源与未知项。tool-only空正文是合法中间结果，不能当空回复失败。
2. 读文件：非课程中性文本样本，B允许模型自主read_file，再基于真实读取结果回答；验证文件路径、内容、工具调用及最终回复。
3. 写入：中性短文件，授权范围内用真实write_file写入，必要时回读；独立检查磁盘字节。另用离线注入证明越界/无授权不能写。
4. 取消：模型返回有效write_file调用后，在异步文件检查完成、写入副作用前注入用户取消，验证文件未产生、后续模型调用不启动。另以离线用例区分取消前已写入和取消后才写入；前者保留实际效果，不声称回滚。供应商取消只报告已发出，除非取得供应商停止确认。

配置选择只依据tools合同，不看“课程”等目标关键词。整个B回合保持同一模式（包括工具结果后的继续回答）；任何阶段网络/合同/授权失败立即停，不靠加重试、改问题措辞或放宽匹配完成。比较与工具通过后，才恢复未完成的学习计划与工作日30/周末60纠正；本次不做整链验收。

## 调用量与输出预算

预计真实供应商请求：比较A/B各1（B若需工具最多另1）、读文件2、授权写入及回读2–3、取消边界1：合计7–9次。建议诊断硬上限10次、每个测试回合最多3次、全程不自动重试，输出最多20480 tokens加实测输入。关联ID、阶段、HTTP、finish_reason、最终输出长度、工具调用数、reasoningTokens、usageSource、输入/输出/总tokens、每调用及阶段耗时全部脱敏记录；不保存密钥和推理正文。取消请求若未取得usage，标未知而非0。

目前没有证据需要增加2048输出上限。先做仅改变推理配置的对照；若B正常工具调用仍因必要最终正文长度被截断，才给出正文/推理token占比、最低可用上限和增量费用，并另行复审。计算增量费用使用本账号已核实的单价与实际input/output，不把潜在最大输出当实际计费，不默认免费。

## 后续产品差异（仅建议，未修改）

避免把Self设置扩成模糊全局开关。建议网关新增独立、默认不启用的工具推理选项（例 MANAGED_AI_TOOL_THINKING=disabled），依据parsed.tools.length选择；无工具JSON继续使用现有structuredThinking，无工具普通文本保持现状。服务端两处最小候选差异如下，仅在复审和对照通过后实施：

```diff
--- ai-inference-gateway.ts
+++ ai-inference-gateway.ts
@@ ManagedAiGatewayOptions
+  toolThinking?: ChatCompleteOptions['thinking'];
@@ infer
- const thinking = parsed.responseFormat?.type === 'json_object' && !parsed.tools?.length ? options.structuredThinking : undefined;
+ const thinking = parsed.tools?.length ? options.toolThinking
+   : parsed.responseFormat?.type === 'json_object' ? options.structuredThinking : undefined;
--- server.ts
+++ server.ts
@@ createManagedAiGateway options
+ ...(env.MANAGED_AI_TOOL_THINKING === 'disabled' ? { toolThinking: { type: 'disabled' } } : {}),
```

候选会影响共享网关的所有带工具请求，必须复审，不按单任务启停；不改客户端请求白名单，不透出供应商设置给普通用户。A/B可验证供应商与现有工具执行合同，但不能单独证明未来共享网关或正式Electron入口验收通过。

实施前还必须检查工具结果后的最终请求是否仍携带tools：若正式Talk存在去掉tools的继续请求，上述仅依据tools的服务端差异不能保证整回合模式一致，需要先提交该合同缺口的最小补充方案，不能悄悄把所有普通文本也关闭推理。
