# Slice 2C 可获取 Coding Runtime 同构建准入门

日期：2026-11-27

任务：`2C-WEB-01`

结果：`OS_BOUNDARY_PASS / SAME_BUILD_PAIR_ADMITTED`

## 结论

兔机米现在可在用户没有预装 Coding 工具时，获取并校验 OpenAI 官方固定版本 Codex Windows Runtime，通过兔机米当前托管模型连接驱动该 Runtime；用户无需另行安装、登录或配置 Codex。OpenCode 兼容候选代码仍保留，但不会在只展示 Codex 版本、来源和 hash 的同一次授权下静默回退，也不再承担 Windows 正式评分准入。

公开 Release 固定为 `0.171.0-alpha.13.2`。下载压缩包 SHA-256 为 `82accf27a8fa00e489fa7182a0d454b254025d0564e2af91786f47eae44c4e6c`；解压后的实际 Agent 可执行文件 SHA-256 为 `3b0b6d91b32a43b6e708a200445a7dff190b0116009ca29c3bca3623a1bbb69e`。获取链执行下载 hash、解压和 `--version` 三重校验，不追 `latest`。

上游依据：[`rust-v0.171.0-alpha.13.2` 官方 Release](https://github.com/openai/codex/releases/tag/rust-v0.171.0-alpha.13.2)、[固定版本 ModelProvider / Responses 合同](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.13.2/codex-rs/model-provider-info/src/lib.rs)、[官方 Windows sandbox 实现](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.13.2/codex-rs/core/src/windows_sandbox.rs)。

Codex 固定版本只接受 Responses wire API。兔机米现有临时回环模型桥增加了最小 `/v1/responses` 兼容面，把函数工具与历史工具结果映射到既有 `ChatCompleteFn`；随机 bearer token 不落盘，Agent 退出后端点关闭。Codex 配置使用官方 `workspace-write`、Windows `unelevated` restricted-token、approval `never` 与禁网工具沙箱。

## OS 级边界

同一公开 Agent 二进制在宿主 Windows 上执行了确定性负向探针：授权工作区内写入成功；授权工作区同级目录写入返回 `Access denied`，目标文件不存在。直接臂和兔机米编排臂均在各自真实工作区取得独立收据，`outsideScopeWrites=[]`。

探针必须在宿主执行；在当前 Codex 会话的沙箱内嵌套 restricted token 会得到 `CreateRestrictedToken failed: 87`，不能把该测试装置失败写成产品失败或边界通过。曾试验的 managed network proxy 与 unelevated Windows sandbox 不兼容，已撤回，正式配置继续使用禁网 `:workspace`。

## 同一构建双臂证据

- 冻结任务：`2C-WEB-01`；fixture SHA-256：`2595425886ee84caa67d7e3374094eb96831be1b03b6194104bce53b16f1ee93`；确定性 Git tree：`406ff7d0eaeb3ef224a395c7927cbce9a8660f6d`。
- 直接臂：公开 Codex Runtime 使用既有 ChatGPT 权益，独立工作区只修改 `src/price-card.cjs`；预注册测试由退出码 1 变为 0。
- 编排臂：兔机米同一 Talk 使用托管模型驱动同一公开 Codex Runtime，独立工作区只修改 `src/price-card.cjs`；预注册测试由退出码 1 变为 0；Execution、Artifact 引用与用户可见摘要均存在。
- 两臂 `executorId`、版本和可执行文件 digest 完全一致，正式 pair validator 返回 `evidence_ready_for_scoring`。
- 没有购买、充值或外部按量费用。编排臂托管免费额度显示 75%→66%，这代表使用了既有额度，不能写成零模型消耗。

真实试验中另有两个编排临时样本未完成，均未进入正式证据；产品如实标记失败，没有把模型摘要冒充成果。最终正式样本只由独立注册测试和 OS 边界收据判定。

## 边界

本门只关闭“可获取 Runtime 的 Windows OS 写边界”和“同一 Agent build 的双臂准入”。它只完成一项 Web 样本，不是四类任务评分，不构成 95% 结论；桌面、后端、脏工作区仍未运行。也不是 Owner 界面验收、打包、push、发布或部署。

正式 pair 使用了本轮已获明确开发授权并完成 hash/版本校验的缓存 Runtime，因此没有重新演示首次 Codex 获取同意页；首次无缓存状态的“先展示版本/来源/hash、下一轮同意后才获取”由同一机械合同回归覆盖，仍待后续 Owner 界面验收。

结构化证据见 [`evidence/SLICE-2C-SAME-BUILD-ADMISSION-01/evidence.json`](evidence/SLICE-2C-SAME-BUILD-ADMISSION-01/evidence.json)。
