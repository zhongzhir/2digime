# P1-01 任务包：SecretStore 与敏感配置迁移

状态：accepted（自动测试 21/21；Codex 三次安全复核通过；Owner 真实模型验收通过）
阶段：第一阶段 / WP2（SecretStore 切片）  
前置任务：P1-00 已接受，基线提交 `151d798`  
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP2、`digitalme_product_spec_v0.2.md` §7.4.2–7.4.3  
审计依据：`digitalme_architecture_audit_20260716.md` F-01、F-02  
实现分支：`codex/p1-01-secret-store`  
实现提交：`363e58d`；修订提交：`94f7e13`、`9d3ecc4`

---

## 1. 目标

将模型 API Key 和能力扩展密钥从明文 `config.json` 迁入操作系统保护的 SecretStore；renderer、普通配置、日志、Package 和导出均不得再获得或保存 secret 明文，同时保持现有模型调用和扩展连接行为可用。

## 2. 代码 Owner

本任务指定唯一实现者：Cursor。  
Codex 负责完成后的架构、安全和回归复核；Owner 负责设置页与真实模型连接的人工验收。

## 3. 允许修改

- `digitalme-app/src/main.js`；
- `digitalme-app/src/preload.js`（仅在确有必要时增加窄接口）；
- `digitalme-app/src/renderer/index.html`、`app.js`、`styles.css` 中与密钥状态、替换、清除有关的最小 UI；
- 新建 `digitalme-app/src/security/secret-store.js` 及直接相关的小型模块；
- 新建自动测试与 fixture；
- `digitalme-app/package.json` 仅可增加测试脚本，不新增秘密管理第三方依赖；
- 更新能力状态表、任务状态和 `digitalme_log.md`。

## 4. 禁止修改

- 不修改 `digital-me-package/**`；
- 不升级 Electron或其他依赖，本任务只处理 secret 边界；
- 不顺带重构 PackageStore、PolicyEngine、ToolBroker、全部 IPC 或 UI；
- 不把密钥放进环境文件、Package、Git、测试 fixture、错误消息或日志；
- 不在 safeStorage 不可用或迁移失败时删除旧明文；
- 不改变模型 baseURL、model、Package 路径等非敏感配置语义；
- 不通过“Base64 编码”冒充加密。

## 5. 安全设计约束

### 5.1 SecretStore

建立主进程专用 SecretStore：

- 使用 Electron `safeStorage` 的 OS 保护能力；
- 存储文件位于 `app.getPath("userData")`，建议版本化为 `secrets.v1.json`；
- 文件只保存版本、secret id、加密后的 Base64 ciphertext、更新时间等必要元数据；
- secret id 使用稳定命名：`model.apiKey`、`extension.<extensionId>.<ENV_KEY>`；
- 提供最小接口：`has/get/set/delete/listConfigured`；
- 默认不提供“列出全部明文”接口；
- 写入采用临时文件 + rename，避免半写；
- 不记录 secret 值；错误只说明 secret id 和失败类型。

SecretStore 应把 Electron 加密适配器与文件存储逻辑分开，使单元测试可注入 fake adapter，而不需要在测试中保存真实密钥。

### 5.2 普通配置与运行时配置分离

必须区分：

- **PublicConfig**：provider、baseURL、model、packageDir、能力非敏感参数；可返回 renderer；
- **RuntimeConfig**：仅主进程内部，在调用模型或启动扩展前临时装配所需 secret；
- renderer 不得获得 RuntimeConfig。

`config:get` 返回 `apiKeyConfigured: true/false` 等状态，不返回 API Key 明文。兼容当前 UI 时，即使保留 `apiKey` 字段也必须恒为空字符串，并明确逐步移除。

### 5.3 设置页语义

- 已配置时显示“已安全保存”，输入框保持空白；
- 空白保存默认表示“保留现有密钥”，不能意外清空；
- 输入新值表示替换；
- 必须提供明确的“清除密钥”动作，并再次确认；
- 保存成功后立即清空输入框；
- UI、DOM、alert、错误信息中不得回显密钥。

### 5.4 扩展密钥

- `capabilityExtensions[].env` 不再持久化 secret 值；
- `extensions:getConfig` 不返回 secret，只返回每个必要 env key 是否已配置；
- 启用或更新扩展时，main 将收到的 secret 立即写入 SecretStore，普通配置只保存 env key 名或配置状态；
- 连接扩展时，仅在主进程临时为该扩展装配其需要的 env；
- 不向扩展传递其他扩展的 secret；
- 停用扩展默认不自动删除 secret，必须另有明确撤销/清除动作；若本任务不增加完整撤销 UI，至少提供窄 IPC 和清晰状态，记录后续 UI 缺口。

注意：本任务只消除“配置明文与 renderer 泄露”；`extension-manager` 目前继承整个 `process.env` 的问题属于后续 ToolBroker，不得误报为已解决。

## 6. 旧配置迁移

应用启动后、窗口创建前执行一次幂等迁移：

1. 检查旧 `config.json.apiKey` 和 `capabilityExtensions[].env`；
2. safeStorage 可用时，先把全部 secret 写入并逐项回读校验；
3. 全部成功后，原子重写普通配置，删除明文 secret；
4. 记录不含密钥的迁移版本和完成状态；
5. 重复启动不得重复产生 secret 或破坏配置；
6. safeStorage 不可用、写入失败或校验失败时：保留旧明文、不覆盖、不部分清理，向用户显示可操作的安全警告；
7. 不自动把真实旧配置复制进测试目录或日志。

迁移过程必须支持以下恢复路径：备份旧 config → 写 secret 临时文件 → 校验 → 原子替换 config；任何一步失败均保持可恢复。

## 7. IPC 与输入边界

- 不暴露通用 `getSecret`；
- renderer 只能调用语义化动作，例如保存模型设置、清除模型密钥、设置某扩展所需密钥；
- main 对 config 和 extension payload 做字段白名单与类型校验；
- renderer 传来的 `apiKeyConfigured`、secret 状态等不得被当作真实状态，真实状态只从 SecretStore读取；
- 所有 handler 返回值必须脱敏。

## 8. 自动测试

至少覆盖：

1. SecretStore set/get/has/delete；
2. 存储文件不包含测试 secret 明文；
3. PublicConfig 与扩展配置序列化不包含 secret；
4. 旧 API Key 迁移成功后明文从 config 删除且模型运行时仍能取得；
5. 多个扩展 env 迁移后按 extension id 隔离；
6. 迁移重复运行幂等；
7. fake safeStorage 不可用、加密失败、写文件失败、校验失败时旧 config 保留；
8. 设置空白保存保留旧 key、替换生效、清除生效；
9. IPC 返回对象深度扫描不出现已知测试 secret；
10. 全部 JavaScript 语法检查；
11. P1-00 Package 基线验证再次通过，Package hash 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

测试必须使用临时目录与明显的假 secret，执行后清理；不得读取或打印真实 userData config。

## 9. Owner 人工验收

实现者提供一组不需要技术判断的步骤：

1. 启动应用，设置页输入一个真实模型 API Key并保存；
2. 关闭并重启应用，确认显示“已安全保存”但不回显；
3. 发起一次普通对话，确认模型调用成功；
4. 打开设置，空白保存其他非敏感配置，确认原密钥仍可用；
5. 替换密钥并验证；
6. 清除密钥，确认模型调用被阻止并提示重新连接；
7. 若已有带密钥扩展，验证迁移后仍可连接且 UI 不显示密钥。

不得要求 Owner 手工打开 secret 存储文件查看密文；该项由自动测试负责。

## 10. 回滚与兼容

- 提供迁移前 config 备份位置和恢复说明，备份本身必须位于 userData 且不进 Git；
- 回滚旧代码时，说明如何安全恢复旧配置，但不得自动把 secret 降级回明文；
- 若新版本发现 SecretStore 不可用，应明确阻断 secret 写入，不静默改用明文；
- Package 不参与本任务回滚。

## 11. 完成标准

完成后只能先标记 `statically_verified`。必须提交：

- 修改文件与设计摘要；
- secret id 与存储格式说明；
- 迁移顺序和失败回滚证据；
- 全部自动测试命令及结果；
- 明文扫描结果；
- Package 前后 hash；
- 已知未解决问题，特别是 `process.env` 继承和 MCP 沙箱；
- Owner 人工验收步骤；
- 本地提交 hash，不推送远程。

Owner 完成真实模型人工验收、Codex 复核通过后，任务才能标记 `accepted`。
