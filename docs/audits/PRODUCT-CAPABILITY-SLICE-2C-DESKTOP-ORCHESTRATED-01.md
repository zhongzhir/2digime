# Slice 2C 桌面编排臂合格真实证据

日期：2026-11-27  
状态：`ORCHESTRATED_ARM_PASS / DIRECT_RAW_EVIDENCE_REFRESH_PENDING / NOT_OWNER_ACCEPTED`

## 结论

`2C-DESKTOP-01` 的兔机米正式 Talk 编排臂已经取得合格真实证据。运行从普通用户宿主启动，模拟用户正常启动桌面产品；内部仍使用官方 `workspace-write`、Windows `unelevated` restricted token、approval `never` 和禁网配置，没有放宽兔机米执行权限。

本次产品链完成：预注册基线失败 → Talk 委托获取后的成熟 Agent → 修改 `src/main.cjs` → 运行预注册测试 → 形成 Artifact → 用户可见成功摘要。采集器独立复跑最终测试并读取 Git 增量；OS 边界探针独立证明工作区外写入被拒绝。

## 真实事实

- 任务：`2C-DESKTOP-01`
- 项目类别：desktop
- Agent：OpenAI 官方固定 Codex Windows Runtime `0.171.0-alpha.13.2`
- 可执行文件 SHA-256：`3b0b6d91b32a43b6e708a200445a7dff190b0116009ca29c3bca3623a1bbb69e`
- 基线测试：退出码1，匹配预注册失败
- 变更文件：仅 `src/main.cjs`
- 最终测试：退出码0
- 工作区外写入：空；负向探针返回 `Access denied`
- Talk：具有独立 Thread、Execution、Artifact和成功摘要
- 托管免费额度：37%→35%
- 购买、充值或外部按量费用：无

## 准入边界

完整编排单臂证据通过 `validateCodingRunEvidence`，可以进入配对。上一批次直接臂的审计摘要证明其真实通过，但没有保留机械配对所需的完整原始JSON；本批次不补造缺失字段，也不追加第二次模型执行。因此桌面任务尚未运行 pair validator，不能写成双臂 admitted。

下一小批次只刷新同一固定 Agent build 的直接臂原始证据并配对；不调用兔机米托管模型，不进入后端或脏工作区。
