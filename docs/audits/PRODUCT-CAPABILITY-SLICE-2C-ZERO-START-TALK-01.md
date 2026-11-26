# Slice 2C 零起步 Coding Talk 真实门

日期：2026-11-26

任务：`2C-WEB-01`

结果：`ZERO_START_PRODUCT_CHAIN_PASS / FORMAL_BENCHMARK_INELIGIBLE`

## 结论

用户只有兔机米、没有预装 Codex/OpenCode 时，正式 Talk 已能先展示第三方 Runtime 的名称、固定版本、官方/镜像来源、SHA-256 和费用边界，等待下一轮明确同意；同意后由兔机米获取并校验 OpenCode 1.18.29，用兔机米当前托管模型连接驱动它，在上一轮授权目录内完成真实代码修改和测试，再把 Execution、Artifact 与用户可见摘要返回同一 Thread。

真实样本中，预注册测试先失败，最终只修改 `src/price-card.cjs`，独立测试退出码为 0。本机 Codex CLI 未参与，没有购买、充值或按量付费；托管免费额度显示 89%→89%，百分比未变化不等于零模型消耗。

这条记录证明零起步产品链成立，但不能进入既有 95% 双臂评分：OpenCode 自身配置已拒绝外部目录、内置网页工具和子 Agent，但当前没有 Windows OS 级沙箱或独立外部写监测，不能机械证明零越界写入；同时既有直连样本使用 Codex，而本次编排使用 OpenCode，不满足“同一 Agent build”比较条件。

## 产品链事实

- 未经同意只记录 `prepare_capability_acquisition`，不下载、不执行；同轮伪造令牌被拒绝。
- 目录授权只延续到紧接着的 Runtime 同意回合，执行后立即失效，不形成长期目录授权。
- 获取候选固定为 OpenCode 1.18.29，压缩包预期 SHA-256 为 `b32618aa3d1415f6e4f473aec248edef25759203fb707d7d968359d86d4a35ee`。
- 托管 `ChatCompleteFn` 只在本机 `127.0.0.1` 暂时投影为 OpenAI-compatible 端点，使用随机临时 bearer token；Agent 退出后端点关闭，安装令牌和模型凭证不写入第三方配置。
- OpenCode 1.18.29 使用其 V1 `permission` 合同，配置拒绝 `external_directory`、`webfetch`、`websearch` 和 `task`；这不是 OS 级 sandbox。
- 隔离进程环境补齐 Windows `COMSPEC`、`PATHEXT`、`TEMP` 和 `TMP`，最终真实运行无需 Agent 绕行即可启动项目测试。

## 验证结果

- TypeScript 构建通过。
- 获取同意、模型回环桥、Runtime 获取与既有零起步回归：12/12 通过。
- 当前代码真实门：基线退出码 1；只修改 `src/price-card.cjs`；最终退出码 0；Talk Execution 成功；本机 Codex 未使用。
- 入库证据：[`evidence/SLICE-2C-ZERO-START-TALK-01/evidence.json`](./evidence/SLICE-2C-ZERO-START-TALK-01/evidence.json)。绝对临时路径、安装令牌、模型令牌和一次性确认令牌均未入库。

## 未完成边界

- 不是与既有 Codex 直连臂可比较的正式配对结果，不计算相对得分。
- 没有证明 Windows OS 级零越界写入，不进入 `validateCodingRunEvidencePair`。
- 尚未覆盖桌面、后端和脏工作区三类任务。
- 不是 Owner 产品验收、打包、push、发布或部署。

下一小批次只解决“可获取 Runtime 的 OS 级工作区边界”和“同一 Agent build 的直连/编排准入”；两项未同时成立时继续 fail-closed，不消耗其余三类正式基准任务。
