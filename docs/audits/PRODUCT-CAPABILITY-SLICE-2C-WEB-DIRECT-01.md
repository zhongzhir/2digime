# Slice 2C Web 直连真实样本

日期：2026-11-26

任务：`2C-WEB-01`
结果：`LEADING_AGENT_DIRECT_REAL_RUN_PASS / ORCHESTRATED_ARM_PENDING`

## 结论

本机 Codex CLI `0.171.0-alpha.13.2` 使用既有 ChatGPT 登录，在独立 Git 工作副本中以官方 `workspace-write`、Windows `unelevated` sandbox、`approval=never` 和 ephemeral session 完成 Web 价格格式缺陷修复。只修改 `src/price-card.cjs`，预注册测试由失败转为通过；采集后的正式证据通过 `validateCodingRunEvidence`。

该结果只关闭领先 Agent 直连单臂样本，不包含 2digime Talk 编排臂、双臂相对评分、四类项目覆盖、95% 结论或 Owner 验收。

## 真实执行事实

- 登录状态：`Logged in using ChatGPT`；没有使用 API Key、购买、充值或启用按量付费。
- 费用口径：现有权益，无新增外部收费；供应商未提供本次订阅额度消耗回执，因此不宣称“零配额消耗”。
- Agent 可执行文件 SHA-256：`2A1EC3F1DD463FD30224BE4C0C67D3FE83D3D863A3D7539CCAD366952436D2AA`。
- 冻结材料 SHA-256：`2595425886EE84CAA67D7E3374094EB96831BE1B03B6194104BCE53B16F1EE93`。
- sandbox：`workspace-write`；Windows `unelevated`；approval `never`；outside-scope writes `0`。
- Agent 运行退出码：`0`；开始 `2026-11-26T11:08:52.996Z`，结束 `2026-11-26T11:09:54.401Z`。
- 基线测试退出码：`1`，匹配预注册失败；独立最终测试退出码：`0`，1/1 通过。
- 唯一变更：`src/price-card.cjs`，最终文件 SHA-256 `B44E1FD6800453E81FC6D122C9D8066E2693DFC90862DF562CFA86973918590C`。

Agent 在自身 sandbox 内第一次运行默认测试时遇到子进程 `spawn EPERM`，随后用无隔离模式完成同一测试；该自报不作为通过依据。Agent 退出后，采集器在独立环境重新运行默认注册测试并通过。

## 证据摘要

- 入库证据：[`evidence/SLICE-2C-WEB-DIRECT-01/evidence.json`](./evidence/SLICE-2C-WEB-DIRECT-01/evidence.json)
- 运行时生成 evidence SHA-256：`43F52F8AF5862CC617B84BB4C3BAC12B2CAB22D4341F5D670C01ACA7E9E69B42`
- 入库规范化 evidence SHA-256：`1E47B141EC1AC989C4CF5F807E931B15C689C6757132C3C98CF23E8F36271E8E`（JSON 语义相同，已重新通过正式 validator）
- sandbox receipt SHA-256：`294B2C0E5F5A07A644A4B72779C9EF2EA1BD76AFE71BD64964B0A7504D6D16B9`
- Agent events SHA-256：`913CE1496336F6EB753FCD6BD7EBB76B96CD70BB9B717367D8696AE23EB3CCF7`
- Agent final message SHA-256：`9CAEBCA0EAFA4CD061670452FA150B0925983CF29F0F9E50EA0B2E98C5593FFC`

第一次启动在 CLI 参数解析阶段以退出码 2 停止，stdout 为空、未进入模型、未改文件；失败副本已通过采集器安全清理。修正参数层级后使用全新副本完成上述唯一真实运行。原始一次性运行目录在证据摘要入库后清理，不提交本机登录材料、会话文件或绝对路径。
