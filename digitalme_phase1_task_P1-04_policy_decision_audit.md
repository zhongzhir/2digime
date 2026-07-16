# P1-04 任务包：PolicyEngine 与可信决策记录最小强制切片

状态：statically_verified（待 Codex 安全复核与 Owner 沙盒验收）
阶段：第一阶段 / WP2（策略强制与可信审计切片）
前置任务：P1-00～P1-03 已接受
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP2
审计依据：`digitalme_architecture_audit_20260716.md` F-03、F-07、F-09、F-10、F-11

---

## 1. 目标

建立第一条真正由主进程强制执行的安全决策链：

`高风险请求 → PolicyEngine 判定 → 必要时一次性确认 → 执行点复核 → 可信决策记录`

本任务选择现有“外部命令执行体”作为唯一接入切片，证明 renderer 的布尔值或提示词不能直接授予高风险权限。任务完成后仍不得宣称所有工具、模型外发和 Package 写入都已统一治理。

## 2. 当前问题

- `l0:runExternalAgent` 只相信 renderer 传入的 `writeAuthorized`；
- 外部命令使用 `shell: true` 且继承完整 `process.env`；本任务不解决执行隔离，但必须保持默认阻断；
- renderer 可调用 `l0:auditAppend` 写入“审计”，记录可伪造或漏报；
- `l0-audit-ledger.json` 覆盖写、最多 200 条且可直接清空，不具备追加链和完整性检测；
- 当前记录缺少 policy version、decision、数据范围、目标、确认凭据和结果摘要 hash。

## 3. 范围

### 3.1 PolicyEngine v1

新增纯逻辑、可单测的策略内核，例如 `src/policy-engine/`：

- 规范化并校验 `actor / purpose / action / dataScopes / resource / destination / risk`；
- 返回 `allow / deny / require_confirmation`；
- 返回稳定的 `decisionId / policyVersion / reasonCodes / obligations / requestDigest`；
- 未知枚举、缺字段、未知目标、策略加载失败一律 fail-closed；
- v1 规则内置且版本化，不静默读取或修改真实 Package；
- 外部进程执行、允许写目录、携带任务文本进入外部进程均不得由 renderer 布尔值直接放行。

### 3.2 一次性确认票据

确认必须由主进程管理：

- PolicyEngine 先产生 `require_confirmation` 和脱敏确认摘要；
- 主进程签发短时、一次性、随机票据；
- 票据绑定请求摘要、actor、action、destination、data scope、工作目录、sender 和过期时间；
- 执行时重新判定并消费票据；重放、篡改、过期、sender 不符或请求内容变化均拒绝；
- renderer 的 `confirmed: true`、`writeAuthorized: true` 或自造 token 均无效；
- 票据只存在内存，不写入 Package，不返回任何密钥。

### 3.3 DecisionAudit v1

新增由主进程实际执行点写入的决策记录，例如 `src/decision-audit/`：

- append-only JSONL，单调 sequence；
- 每条包含 `generation / sequence / at / event / decisionId / policyVersion / requestDigest / actor / purpose / action / dataScopes / destination / approval / outcome / previousHash / entryHash`；
- 参数只保存脱敏摘要；结果只保存状态、长度和 SHA-256，不保存完整任务、密钥或命令输出；
- reader 验证 hash chain、sequence 和 generation；发现篡改、断链或非末尾损坏时明确返回 unhealthy；
- 崩溃造成的最后一条半行可报告并隔离，不得把损坏账本冒充健康；
- “清空记录”改为经 Owner 确认后开启新 generation；旧 generation 保留并记录 rotate 事件；
- 明确声明这是本机防篡改检测，不是签名、远程见证或不可删除存证。

### 3.4 唯一运行时接入

只接入 `l0:runExternalAgent`：

1. 请求进入后先判定并记录；
2. `deny` 直接拒绝；
3. `require_confirmation` 返回人读摘要，不启动子进程；
4. renderer 展示动作、命令执行体、工作目录、数据范围、风险和有效期；
5. Owner 确认后携一次性票据再次请求；
6. 主进程重新判定、验证并消费票据；
7. `approved` 记录成功落盘后才允许启动子进程；此前审计写失败必须 fail-closed；
8. `started / completed / failed / aborted` 由实际执行点记录；执行后记录失败必须向用户显示 `audit_incomplete`，不得静默成功。

## 4. 产品面

- 用一句话说明“即将让本机外部程序执行任务”；
- 明确显示是否可能改文件、工作目录、执行体名称、数据类别和票据有效期；
- 默认按钮为取消；不得预勾选授权；
- 设置页“近期行动记录”改为只读可信记录视图；renderer 不再拥有追加可信记录的接口；
- 旧账本可标为 legacy activity，不迁入可信链，不冒充 DecisionAudit；
- 开启新记录代次必须二次确认，并说明旧记录仍保留。

## 5. 禁止事项

- 不顺带实现完整 ToolBroker、MCP 隔离、网络代理或沙箱；
- 不声称已解决 `shell: true`、完整 `process.env` 或任意命令风险；在 P1-05 前外部 CLI 继续标记实验性；
- 不把策略写成 prompt 或只在 renderer 检查；
- 不允许 renderer 写入、补写或指定可信审计字段；
- 不读取、迁移或修改 `digital-me-package/**`；
- 不把 hash chain 宣称为密码学身份签名或防删除存证；
- 不改 Builder、Life、Policies 的直接 Package 写路径；
- 不接公网协作，不发布 Agent Card，不处理支付。

## 6. 建议模块边界

- `src/policy-engine/schema.js`：输入、枚举与输出契约；
- `src/policy-engine/index.js`：纯判定与 request digest；
- `src/policy-engine/confirmation-store.js`：内存票据生命周期；
- `src/decision-audit/index.js`：主进程 append/list/verify/rotate；
- `src/decision-audit/hash.js`：canonical form 与 hash chain；
- `src/orchestration/agents.js`：仅保留实际执行，不自行决定授权；
- `main.js`：在真实执行点编排策略、确认和审计；
- `preload.js`：只暴露窄的 request/confirm/list/rotate 接口；移除 renderer 可信 append；
- renderer：确认摘要和只读记录视图。

业务层不得获得通用 `policyBypass`、`auditAppend`、任意 token 签发或账本文件写接口。

## 7. 自动验证

新增 `npm run test:p1-04`，至少覆盖：

1. 规则表的 allow/deny/require_confirmation；
2. 缺字段、未知 action/destination/risk fail-closed；
3. request digest 对 key 顺序稳定，对语义变化敏感；
4. 票据绑定、一次性消费、过期、重放、篡改、sender 不符；
5. renderer 布尔值和伪造 token 不能放行；
6. 未确认、策略失败、确认前审计失败时子进程调用次数为 0；
7. 成功、非零退出、异常、取消均形成完整事件链；
8. 账本 sequence/hash chain 校验；中间篡改、删除、重排可检出；
9. 最后一条半行与非末尾损坏分别处理且不冒充 healthy；
10. rotate 产生新 generation，旧记录仍可读且有连接事件；
11. renderer/preload 无可信 `auditAppend`；
12. 日志和 IPC payload 不含测试密钥、完整任务正文、完整命令输出；
13. P1-01～P1-03 全量回归；
14. Package 清单 hash 不变。

## 8. Owner 验收

只使用无敏感数据、无真实资料的临时工作目录和安全演示命令：

1. 未确认时执行体不启动；
2. 确认页能说清执行体、动作、目录、数据范围、风险和有效期；
3. 取消后无执行；
4. 确认后只执行一次，重复确认被拒绝；
5. 成功、失败和取消均能在近期行动记录中看到；
6. 开启新记录代次后旧记录仍可查看；
7. 重启后记录仍在且完整性状态正常；
8. 真实主体资料目录和 Package hash 不变。

Owner 验收不能证明任意外部 CLI 已安全沙箱化；这里只验收策略和记录链。

## 9. 回滚与停止条件

- 新存储只写 `userData` 下独立目录，不覆盖 legacy ledger；
- 回滚代码不得删除已生成的 DecisionAudit；
- 若发现未确认可执行、renderer 可伪造可信记录、审计落盘失败仍启动，立即停止并标记 blocked；
- 实现和自动测试后最高标记 `statically_verified`；Codex 安全复核和 Owner 沙盒验收后才可 `accepted`；
- 完成本任务后停止，不顺带进入 ToolBroker 或协作骨架。

## 10. 交付格式

- 分支与独立提交；不 amend、不设置 remote、不 push；
- 修改文件和模块边界；
- PolicyRequest/Decision/AuditEntry 脱敏示例；
- 规则表、确认票据威胁模型、审计完整性与失败策略；
- 故障注入矩阵、测试结果、Package 基线；
- 未解决边界与 Owner 沙盒验收步骤。
