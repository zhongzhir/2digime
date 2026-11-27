# Slice 2C 桌面编排宿主嵌套诊断

日期：2026-11-27  
状态：`HOST_NESTING_DIAGNOSED / QUALIFIED_REAL_RERUN_PENDING / NOT_OWNER_ACCEPTED`

## 结论

本批次没有形成可评分的桌面编排证据。真实样本由 Codex 开发宿主的外层受限令牌启动，再由兔机米获取的 Codex Runtime 创建 Windows `unelevated` 沙箱，形成“沙箱套沙箱”。内层禁网环境无法从 Windows Profile Known Folder 得到 home，所有 `exec_command` 均在进程创建前失败。产品没有修改文件，最终测试仍失败，Talk 没有生成 Artifact，也没有误报完成。

同一 Runtime 和配置的零模型机械对照证明：

- 外层受限令牌内：`Failed to create unified exec process: no home dir`；
- 普通用户令牌下：`cmd /c echo probe-ok`，退出码 0、状态 `completed`；
- 两边都使用官方固定 Codex `0.171.0-alpha.13.2`、`workspace-write`、Windows `unelevated`、approval `never` 和禁网配置；
- 机械对照不调用外部模型，不进入正式评分。

OpenAI 官方 [`windows-sandbox-rs/src/env.rs`](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/env.rs) 的禁网环境会调用 `dirs_next::home_dir()` 创建 `.sbx-denybin`。Windows 实现读取 Profile Known Folder，不由传入的 `HOME/USERPROFILE` 直接决定，所以工作区一次性 home 不能修复外层令牌本身缺少 Profile 的问题。正常用户启动的桌面应用不存在这一层 Codex 宿主沙箱。

## 本轮真实事实

- 任务：`2C-DESKTOP-01`
- Runtime：官方固定 `0.171.0-alpha.13.2`
- 基线测试：预注册失败
- 工作区增量：空
- 最终测试：失败
- Talk Artifact：空
- 免费额度：39%→37%
- 购买、充值或外部按量费用：无

## 代码与验证

- 固定 Runtime 第一次启动可能被 Windows 安全扫描占用超过 20 秒，版本探针等待上限调整为 60 秒；精确版本、来源和 hash 门未放宽。
- TypeScript build：通过。
- 获取与编排定向测试：29/29 通过。
- 本轮没有再次调用模型去验证宿主诊断；下一次必须从普通用户令牌启动整条产品链。

## 下一步硬边界

只允许在普通用户令牌下对 `2C-DESKTOP-01` 做一次有上限的合格真实复验。成功后才运行 OS 边界探针、正式采集和 pair validator；失败则记录并停止。不得提前进入后端或脏工作区任务。
