# DIGITALME-UNIFIED-CAPABILITY-01 补验交付

> 2026-10-11 收尾：来源完整性离线完整链路及唯一一次真实区块链 UI 复验均已通过。最新结论与预算以 [`CLOSEOUT.md`](./CLOSEOUT.md) 为准；本文保留 2026-10-10 当时的失败与修复前状态，不能单独作为最终结论。

**状态：** COMPLETE / OWNER REVIEW REQUIRED / NOT MERGED

**分支：** `codex/digitalme-unified-capability-01-core`

**起始 HEAD：** `dc0a191a2d27315d80843763b58037344256adf9`

**数据边界：** 隔离 userData；仅公开网页与虚构播客材料；未上传真实 Digital Self；未打包、发布、push 或合并。

## 用户目标结论

| 项目 | 结论 | 真实 UI 证据 | 关键事实 |
|---|---|---|---|
| 咨询直接回答 | 通过 | `evidence/supplemental/01-consultation.png`；`supplemental-ui-validation-attempt-2.json` | 15.405s；有效回答；无目录权限、无成果文件 |
| 明确制作、写入、回读、打开 | 通过 | `02-podcast-artifact.png`、`02-podcast-artifact-opened.png`；attempt-2 原始 JSON | 56.799s；写入并回读 7,894 bytes；真实成果卡执行“打开”。打开成功反馈补齐后，无付费 Electron 真文件打开 1/1 通过 |
| 拒绝授权后不写入 | 通过 | `03-permission-waiting.png`、`03-permission-denied.png`；最终 JSON | 权限框对应真实 Documents 隔离目录；拒绝后文件不存在，无 result path，答复明确未完成 |
| 运行中取消 | 通过 | `06-cancel-running.png`、`06-runtime-cancelled.png`；最终 JSON | 请求已发出；256ms 取消；provider `cancelled`；Thread 持久化“已取消”；2s 后无迟到 turn、无成果 |
| 已有两文追问比较 | 通过 | `04-existing-source-comparison.png`；最终 JSON | TradingKey 与 Coinbase 两个具体 URL 均为 `web_extractor/read`；答复绑定两来源，未混入播客上下文 |
| 区块链文章 URL / 正文状态 | **失败** | `05-blockchain-quality.png`；最终 JSON | 正文状态 7/7 与 trace 一致；具体文章 URL 5/7，TechFlow、吴说两项仍是首页。只运行了这一次质量复验 |

## 范围内修复

1. 验证 helper 必须先观察真实 running 状态，完成时同时要求：发送恢复、瞬时 `.talk-processing` 消失、新持久化 turn 出现；取消必须等到 Thread 的 `CANCELLED` 终态。
2. 取消信号贯穿 Talk 前置 Digital Self Responses 调用；前置取消不会继续启动主 Talk 或写入迟到结果。
3. Talk 主调用与 Digital Self 调用记录不含提示词、正文和密钥的 trace；fresh Subject 会先创建 `content/`。
4. Talk view 保留 execution trace 供隔离证据读取；成果卡根据真实 `shell.openPath` 返回显示“已打开”或失败/回退状态。
5. 复用已有机械 URL 结构检查：站点首页和搜索页不得承载具体文章标题；只拒绝错误来源身份，不做相关性评分、排序或补搜。实测两个失败首页与两个具体文章 URL 的离线回归通过。按 Owner 的“一次复验”限制，修复后未再发付费请求，因此仍是“代码已修、真实 UI 待验证”。

## 费用账本

- 新增目标预算：`CNY 2.00`。
- 已知可计算估算：`CNY 0.0578902`。
- 未知预留：`CNY 1.55`，包括 CSP runner 中止 `0.25`、缺 trace 的咨询 `0.25`、缺 trace 的成果 `0.45`、无效授权路径等待 `0.30`、主动取消在途 `0.30`。
- 新增准入占用：`CNY 1.6078902 / 2.00`。
- 加既有准入占用：`CNY 3.4521027 / 3.8442125`。
- 未知不按 0；无自动重试；未触碰预算边界。金额为当前 token/搜索公式的可计算估算，不是供应商最终账单；未能获得终态 usage 的调用保持未知预留。

## 无付费工程闸门

- 验证等待/取消 helper：2/2。
- 成果卡真文件系统打开及 UI 回执：1/1。
- 咨询/成果/Digital Self/首页完整性专项：4/4。
- 既有取消回归：1/1。
- TypeScript 全量检查、产品编译、JS 语法、`git diff --check`：通过。

## 原始证据与缺口

- 首次 CSP 失败：`supplemental-ui-validation-attempt-1.json`。
- 咨询与成果真实结果、无效临时目录授权等待：`supplemental-ui-validation-attempt-2.json`。
- 拒绝授权、比较、区块链、取消与逐请求 trace：`supplemental-ui-validation-result.json`。
- 截图：`evidence/supplemental/`。
- 区块链首页过滤修复尚无第二次真实 UI 结果；这是剩余阻塞项。视频、真实 Digital Self、P95 和整体产品可用不在本批结论内。
