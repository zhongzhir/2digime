# 空effects参数：原响应、定义与拒绝原因

2026-10-06。核对e4cb020保存的供应商结果和同一出站工具定义；不修改校验、工具定义或线上配置。

## 供应商原始参数

响应ID：e3936878-aafd-495b-b99a-007c6e3c69e5；HTTP200，finish_reason=tool_calls，正文为空。

```json
{"id":"call_00_CzVRfNd7CxH2V3W31Buc1075","name":"set_expected_effects","arguments":"{\"effects\": []}"}
```

准确说法是effects数组为空，不是arguments缺失或非法JSON。此前保存了原始function.arguments字符串和响应元数据，但没有保存供应商完整原始响应正文；不能称为完整HTTP响应逐字节归档。

## 定义与执行器

src/intelligence/loop.ts的SET_EXPECTED_EFFECTS_TOOL要求对象中有effects，定义其type=array、items对象中effect必填；没有minItems，因此该JSON Schema允许空数组。工具描述为可选核对点，不是必须调用的任务开关。模型无需为纯比较先设置核对点。

同文件parseExpectedEffectsArgs解析JSON、确认effects是数组，并过滤effect为空的项。[]经解析仍为[]。runOneTool判定ok=effects.length>0，所以记录ok=false、failureReason="expected effects 为空"；工具回传actualSuccess=false、ok=false、effects=[]、summary="effects 不能为空。"。

这是定义允许空数组、执行器要求非空的合同差异；不是解析错误或供应商未返回工具。不放宽执行器校验。本轮用原参数替身复现拒绝，再自动回传错误→非空参数调用→成功记录→最终答复，证明测试器能够完整承载这条路径。

未修改产品。后续如需修正定义，应独立审查最小minItems=1与描述一致性，同时评估纯比较是否发生不必要核对点调用，不能靠强制预置答案或去掉校验让测试通过。
