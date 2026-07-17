# P1-05 任务包：ToolBroker 与外部 CLI 最小隔离切片

状态：statically_verified（第一轮 Codex 复核修订已落地；须经第二轮安全复核与 Owner 沙盒验收后方可 accepted）
阶段：第一阶段 / WP3（受控能力执行）
前置任务：P1-00～P1-04 已接受
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP3
审计依据：`digitalme_architecture_audit_20260716.md` F-02、F-03，以及阶段 3“受控能力执行”

---

## 1. 目标

把 P1-04 唯一接入的外部 CLI 从“经策略确认后执行任意 shell”收敛为“经 ToolBroker 执行一个明确注册、参数结构化、环境最小化、目录受限、可超时取消的本地工具”。

目标链路：

`结构化工具请求 → ToolBroker 解析与约束 → PolicyEngine 判定 → Owner 一次性确认 → 执行点复核 → shell:false 启动 → DecisionAudit 记录`

本任务建立的是最小受控执行代理，不是操作系统级沙箱。完成后不得宣称任意 CLI、MCP 扩展或第三方代码已经安全隔离。

## 2. 当前问题

- 外部命令使用 `shell: true`，命令字符串可触发管道、重定向、命令连接符和 shell 展开；
- 子进程继承完整 `process.env`，可能获得 API Key、调试变量和宿主环境信息；
- renderer 可配置命令与工作目录，缺少稳定的工具身份、允许目录与参数契约；
- 缺少统一的超时、取消、输出上限和子进程树回收；
- P1-04 虽绑定执行配置摘要，但约束的是“确认内容未漂移”，尚未证明该配置本身足够安全。

## 3. 范围

### 3.1 ToolBroker v1

新增纯主进程模块（建议 `src/tool-broker/`）：

- 维护版本化工具注册表；v1 只注册一个 `local_cli` 工具，不提供通用 shell 接口；
- 工具定义至少包含 `toolId / definitionVersion / executable / argsTemplate / allowedActions / timeoutMs / maxOutputBytes / envAllowlist`；
- 解析可执行文件到绝对路径，并形成稳定 `executableFingerprint`；至少绑定规范路径，建议同时绑定文件大小、mtime 与 SHA-256；
- 将执行计划规范化为不可变快照，包含工具定义版本、可执行文件指纹、结构化参数、授权工作目录、环境变量键名、超时和数据范围；
- 未注册工具、未知字段、缺少约束、解析失败、指纹变化或注册表加载失败一律 fail-closed。

不得把通用 `spawn`、任意命令字符串、环境对象或路径写接口暴露给 renderer/业务层。

### 3.2 禁止 shell 解释

- 使用 `spawn(executable, args, { shell: false, ... })` 或等价接口；
- `argsTemplate` 必须是字符串数组，只允许已声明占位符；任务文本作为单一参数值传入，不进行字符串拼接或二次 shell 解析；
- 拒绝空字节、非法占位符、超长任务与超量参数；
- `& | ; > < \`、换行、引号、`$()` 等内容必须作为普通参数传递，不能触发第二个命令、重定向或变量展开；
- v1 不支持 `.bat`、`.cmd`、PowerShell 脚本或依赖 shell 关联启动的文件。

### 3.3 最小环境变量

- 禁止继承完整 `process.env`；从空对象构造子进程环境；
- Windows 仅按大小写不敏感的固定白名单复制运行必需项，例如 `SystemRoot`、`WINDIR`、`TEMP`、`TMP`；若可执行文件已解析为绝对路径，默认不传宿主 `PATH`；
- 审计和确认界面只显示环境变量键名，不显示值；
- 不读取或注入 SecretStore、模型密钥、扩展密钥与未列入工具定义的变量；
- 测试哨兵密钥必须证明不会进入子进程。

### 3.4 工作目录边界

- 工作目录必须来自 Owner 明确选择且已保存的授权根目录，不能由单次 renderer 请求任意扩大；
- 使用真实路径校验目标位于授权根内；拒绝 `..`、路径逃逸、符号链接、junction/reparse point 和不存在路径；
- v1 默认拒绝 UNC、网络盘与 WPS 云同步路径作为外部执行工作目录；Owner 验收只使用系统临时本地目录；
- 未勾选 `workspace_files` 时不得传入工作目录或启动可能访问文件的 CLI；外部 CLI 仍一律按“可能改文件”处理。

### 3.5 生命周期、资源限制与回收

- 统一处理 `prepared / started / completed / failed / timed_out / canceled / audit_incomplete`；
- 设置硬超时和 stdout/stderr 总字节上限；超过上限时截断显示并记录原始长度/截断状态，不把完整输出写入审计；
- Owner 取消、窗口销毁、应用退出或超时后必须终止子进程及其后代，并形成脱敏记录；
- 未完成终止或存在孤儿进程风险时向用户明确显示，不得静默报告成功；
- spawn 前的策略、确认或审计失败必须保持 `spawn=0`。

### 3.6 与 P1-04 决策链绑定

- `requestDigest` 与确认票据必须绑定 ToolBroker 执行计划摘要；
- 至少绑定 `toolId / definitionVersion / executableFingerprint / args / cwd realpath / env key names / timeoutMs / dataScopes`；
- 请求、确认、执行、取消与结果继续使用同一 `decisionId`；
- 工具定义、可执行文件、参数模板、工作目录、环境白名单或超时在确认后变化，必须销毁旧票据并要求重新确认；
- DecisionAudit 只记录脱敏摘要、环境键名、输出长度/hash 和终止原因，不记录任务全文、环境值或完整输出。

## 4. 产品面

- 外部执行能力默认关闭；升级后不得自动替用户重新开启；
- 确认摘要显示工具名称与版本、绝对可执行路径、工作目录、可能访问的文件范围、环境变量键名、超时和输出限制；
- 明确标注“受限执行，不是安全沙箱”；默认操作仍为取消；
- 设置页不再接受任意 shell 命令，只允许选择/配置已注册工具需要的窄字段；
- 取消、超时、输出截断、配置漂移与无法完全终止均给出可理解提示。

## 5. 禁止事项

- 不顺带迁移 MCP extensions，不增加网络访问或远程 Agent；
- 不加入通用 shell、命令行文本框、任意环境变量编辑器或策略绕过开关；
- 不把 `shell: false` 宣称为 OS 沙箱；不承诺阻止已授权工具自身的恶意行为；
- 不读取、迁移或修改 `digital-me-package/**`；
- 不修改 Builder/Life/Policies 的直接 Package 写路径；
- 不降低 P1-04 的确认票据、sender 绑定、DecisionAudit 完整性或 fail-closed 要求；
- 不启动外部协作骨架。

## 6. 建议模块边界

- `src/tool-broker/schema.js`：工具定义与结构化请求契约；
- `src/tool-broker/registry.js`：版本化白名单与工具身份解析；
- `src/tool-broker/paths.js`：授权根、realpath、reparse/网络路径检查；
- `src/tool-broker/environment.js`：大小写不敏感的最小环境构造；
- `src/tool-broker/executor.js`：`shell:false`、输出限制、超时、取消与进程树回收；
- `src/tool-broker/index.js`：生成不可变执行计划并协调执行；
- `src/orchestration/external-agent-flow.js`：继续编排策略、确认、审计，实际启动只能委托 ToolBroker；
- renderer/preload：只暴露注册工具状态、请求、确认与取消的窄接口。

业务层不得获得通用 `execute(command, env, cwd)`、`spawn` 或 ToolBroker 注册表修改接口。

## 7. 自动验证

新增 `npm run test:p1-05`，至少覆盖：

1. 只允许注册工具，任意 executable/command 与未知字段拒绝；
2. 实际 spawn 参数为绝对 executable + args array + `shell:false`；
3. shell 元字符、引号、换行和命令连接符仅作为普通参数，不产生第二个进程或文件；
4. `PATH` 劫持、同名不同路径、工具文件替换、argsTemplate/definitionVersion 漂移均阻断；
5. 子进程环境仅含白名单键，宿主测试密钥和无关变量不可见；
6. cwd 缺失、逃逸、symlink、junction/reparse、UNC/网络路径拒绝；
7. 未声明 `workspace_files` 时 `spawn=0`；
8. 超时、Owner 取消、窗口销毁与应用退出能终止进程树并留下正确记录；
9. stdout/stderr 超限被截断，内存和审计文件不保存无限输出；
10. 策略失败、确认失败、确认前审计失败、配置漂移与审计 unhealthy 时 `spawn=0`；
11. 请求至结果保持同一 `decisionId`，执行计划摘要贯穿确认与审计；
12. preload/renderer 无通用 spawn、shell、env 或注册表写接口；
13. P1-01～P1-04 全量回归；
14. P1-00 Package 基线逐文件不变。

Windows 相关测试必须使用真实 `child_process` 故障/竞态路径，而不能只 mock 核心安全边界。

## 8. Owner 沙盒验收

只使用系统临时本地目录、无敏感数据和安全演示参数；不要使用真实主体 Package、WPS 云盘目录或日常工作目录。

1. 升级并重启后确认外部执行能力仍为关闭；
2. 配置项目明确允许的演示工具，界面不再接受任意 shell 命令；
3. 请求执行前确认摘要能看清工具、绝对路径、临时工作目录、文件范围、环境键名、超时和输出限制；
4. 取消后无进程启动并有取消记录；
5. 确认后执行一次无害命令（例如受信 Node 可执行文件的 `--version`），只产生一次完整记录；
6. 输入带 shell 元字符的演示文本，确认它只被当作普通参数且未产生额外文件/进程；
7. 执行超时演示，确认进程终止、界面提示和审计记录一致；
8. 重启后记录仍在且完整性正常；
9. 验收结束后再次关闭外部执行能力，并恢复原工作目录配置。

Owner 验收不能证明已形成 OS 沙箱；它只验收 ToolBroker 约束、生命周期和产品感知。

## 9. 回滚与停止条件

- 新增运行状态只写 `userData` 独立目录，不写 Package；
- 回滚代码不得删除 P1-04/P1-05 已生成的 DecisionAudit；
- 若发现可触发 shell 解释、泄露非白名单环境变量、逃逸授权目录、确认后配置漂移仍执行、取消/超时留下子进程，立即停止并标记 blocked；
- 实现和自动测试后最高标记 `statically_verified`；Codex 安全复核与 Owner 沙盒验收后方可 `accepted`；
- 完成本任务后停止，不顺带进入 MCP 或外部协作骨架。

## 10. 交付格式

- 从当前收口提交新建分支 `codex/p1-05-tool-broker`；
- 保留独立提交，不 amend、不设置 remote、不 push；
- 提供修改文件与模块边界、ToolDefinition/ExecutionPlan 脱敏示例；
- 提供威胁矩阵、真实子进程测试、故障注入、回归与 Package 基线证据；
- 列出仍未解决的 OS 沙箱、MCP、网络、密钥按工具注入与全部 Package 写路径边界；
- 完成后停止，交 Codex 安全复核，不直接安排 Owner 验收。
