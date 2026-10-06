# 托管判断核验与服务端最小修复方案

2026-10-06（北京时间）。基于 cb84ea4；只使用历史两门课程的公开候选摘要，没有搜索调用、付费搜索、Gemini 或开发模型凭证。8d888b09 未变。真实课程联动仍未完成。本轮没有部署、打包、push 或发布。

## 真实判断结果：尚不稳定

| 请求 | 客户端实际结果 | 判断 / 后续尝试 |
|---|---|---|
| 首次原客户端 | HTTP 400 PAYLOAD_REJECTED，169ms | 判断 0 / 无重试 |
| 修正后正常 pass 1 | HTTP 200，finish_reason=length，正文 0，10459ms | 空截断 / 原有 pass 2 |
| 修正后正常 pass 2 | HTTP 200，finish_reason=length，正文 0，10676ms | 仍空截断 / 停止 |
| 共用截止 1500ms | 1514ms 结束，HTTP 未收到，deadline/timeout | 1 次 / 无下一尝试 |
| 1500ms 后主动取消 | 1501ms 结束，HTTP 未收到，user/cancelled | 1 次 / 无下一尝试 |

本轮共 5 次客户端托管 HTTP 请求（其中 1 次字段拒绝），0 搜索。初始 harness 缺少候选 summary 的本地 TypeError 发生在发请求之前，不计供应商调用。两门课程始终是历史待判断候选；获取时间缺失继续 null，文件保存时间不能冒充获取时间。此次是正式判断模块+正式托管客户端，不是桌面 UI 全链验收。

原先新增发送 thinking 与部署网关白名单冲突，是 cb84ea4 引入的兼容退化。本轮最小客户端修复恢复既有协议，不发送 thinking；增加 parseAiInferenceRequest 实际合同测试，14/14 故障处理测试通过；加托管回归共 24/24 通过，构建通过。未自动降级服务或购买额度。

网关同窗日志有 4 行 AVAILABLE / inputTokens=1023 / outputTokens=0，耗时 10361、10630、10525、19777ms；与客户端两次正常及两次取消窗口吻合，但没有 requestId、finish_reason，不能逐请求归因。后两行晚于客户端结束，提示服务器仍继续完成，结合本地 socket 复现与部署源码可以确定取消传递缺口；不能凭同窗条目证明每次实际收费。400 校验失败窗口日志为空，源码该分支确实未写诊断。证据见 evidence/managed-gateway-window-20261006.json 及 managed-judgment*.json；不存原始终端日志、凭证或候选正文到诊断。

空截断的直接事实已确认，但根因只能收敛到 provider 输出/思考预算与网关参数合同层，尚不能证明关 thinking 就会恢复。不再发正常探测。服务端输出 token=0 不能推导未计费，账单待核。

## 服务端：最小改动、测试、部署方案（待审，未实施到线上）

1. server.ts 增加 res.close → abortIfClientGone，保留 req.aborted；在 finally 移除监听，断开后禁止写响应。SERVER-MINIMAL-CHANGE.patch 为两处监听改动候选。本地实际 HTTP socket 发完请求体后断开，当前 providerSignalAborted=false；候选编译模块改动为 true。候选只在测试中临时替换 dist，finally 已恢复。不是已修生产服务。继续覆盖正常完整响应不误取消、上传中取消和 socket 后重复关闭。
2. ai-inference-gateway.ts 在单次 infer 内建立一个请求截止，覆盖 admission 后 provider 调用和退避。每次 timeoutMs=min(配置上限, 剩余)，退避同样受共用 AbortSignal 约束；到期或 caller 取消不启动下一次调用，迟到成功不记为正常返回。相对预算可通过受限 HTTP timeout header 接收，校验有限正数并 clamp 到服务端上限，无需新业务事实或存储。请求截止 timer 在 finally 清理。默认两次 provider 重试意味着单个客户端请求可发供应商 3 次，必须显式计数。
   已完成诊断注入：100ms 配置窗口下三次调用各拿 100ms，模拟经过 240ms仍 AVAILABLE（server-fixed-retry-probe.json），证明固定预算错误。剩余预算、退避到期、迟成功、同一请求最多次数的修复验收还未执行，不把诊断当修复通过。
3. thinking 需要显式可验证的网关合同：只接受受限结构、转发给 provider，或统一由网关按模型文档设置。不能仅放开白名单却继续丢弃；先 fixture 确认转发，再一次有预算的真实判断证实 provider 行为。当前不以此猜测修改线上参数。
4. 日志补齐 requestId、stage、实际 HTTP、finish_reason、输出字符数、解析类别、取消类别及 provider attempt；拒绝路径也记录安全类别。取消日志单列，不复用 AVAILABLE。所有字段白名单，不记录材料、错误正文或凭证。

部署门槛：上述本地网关/HTTP回归通过 → 提交可审 SHA 和差异 → Owner 明确部署授权 → 核对实际机器与当前运行版本、备份部署文件 → 只替换网关应用文件（不改 env、IQS、凭证或套餐），检查服务 ready 与请求取消 → 一次候选判断 → 异常则恢复备份服务版本。未经授权不重启或部署。预计一次服务重启，实际切换与回滚命令须在批准前按当时部署布局固定，不在此生成未经验证的指令。

## 两项 Discover 失败：仍是未关闭断点

已将 cb84ea4 改动的全部 9 个生产 TS 模块的编译产物临时替换为 b9cf67f 版本，运行同一测试，再逐字节恢复。模块清单与退出码见 discover-baseline-comparison.json；两组各 2 失败，具体输出保留为 discover-baseline-*.tap。未还原无变化模块，因为它们没有版本差异。这是生产模块对照，不是桌面基线验收。

| 原测试断言 | cb84ea4 / b9cf67f 实际 | 当前原因与处理 |
|---|---|---|
| open-web-discovery-01.test.ts 第 70 行：opened.view.replenishing === true | undefined / undefined | 冷启动读取公开目录，实际卡片 12、reasonCode=REPLENISHED、searchCalls=0。已有足量目录不触发补充，viewOf 只在 true 时包含 replenishing。断言依赖旧冷启动总需补充合同；仍需验证目录失败/不足时补充与足量时终态，不能直接删测试。首次断言使后面的 web-hit 索引与判断断言未执行，故这些覆盖仍缺失。 |
| 同文件第 102 行：notice 匹配 开启联网发现 | 空字符串 / 空字符串 | 实际 networking=NOT_CONFIGURED，cards=12、reasonCode=REPLENISHED。测试仅删除 Gemini 环境变量，没有明确设置用户关闭联网；NOT_CONFIGURED 与 DISABLED 混淆，公开目录仍能供给。这不能证明用户关闭联网后无请求。下一最小测试应显式设置联网关闭、注入全部外部入口计数，并验证 0 外部请求且已有内容保留；同时单测未配置托管但允许目录的合同。 |

不因测试年代排除问题。本轮不扩改 Feed 产品行为，也不把这些失败计为通过。当前断言定位为第 70 与 102 行。

## 后续真实窗口

判断未稳定，暂不安排付费窗口，不把 17–20 次当普通推荐成本。当前完整链正常预计 17–20 客户端模型调用（取决于独立回读由本地验证器还是另一次 Talk 完成）；普通推荐正常仅意图+批量判断约 2 次。服务端重试使供应商次数可能放大至 3 倍，thinking/截断与 token 用量未澄清，暂不能给可信模型费用估算。待托管判断稳定并取得本账号模型实际 token 价格/账单后，按各阶段输入、输出及重试次数重新计算完整链预算和搜索费用，另交付付费窗口方案。之前 24 模型/6 IQS 是未批准建议，不是当前已执行预算或服务器硬上限。
