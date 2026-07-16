# P1-02 任务包：Package schema + PackageStore 最小版本提交

状态：statically_verified（Codex 复核中；Owner 沙盒验收暂缓至复核通过；已补版本界面 recovery issue 真实呈现）
阶段：第一阶段 / WP1（PackageStore 最小可信切片）
前置任务：P1-00、P1-01 已接受
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §2.2、§3 WP1
审计依据：`digitalme_architecture_audit_20260716.md` F-04、F-05、F-06、§6.1
实现 Owner：Cursor；架构/安全复核：Codex；人工验收：Owner
实现分支：`codex/p1-02-package-store`
实现提交：`ff36102`；修订见 `digitalme_log.md`「P1-02 修订」

---

## 1. 目标

建立首个真实可用的 `PackageStore`：让主体资产具备统一校验、候选 change set、冲突检测、原子提交、版本快照、diff 和 rollback 能力；以现有 Feedback 人工确认写回作为唯一生产接入切片，证明“一次学习为什么改、改了什么、依据是什么、如何撤销”。

本任务不宣称已经完成全部 Package 治理。Builder、Life、Policies 等剩余直接写入路径必须继续如实标记为待迁移。

## 2. 设计原则

1. **真实 Package 默认不动**：启动、检查和测试不得自动迁移或改写 `digital-me-package/**`。
2. **候选先于确认**：业务层先生成 change set；只有已有的用户确认动作才能调用 commit。
3. **失败保持原样**：校验、锁、冲突、快照、写入或切换任一步失败，当前 Package 必须保持可读取、可恢复，不得留下半写状态。
4. **兼容优先**：现有 Package v0.1 可只读加载；schema v0.2 迁移必须显式、幂等、可回滚。
5. **主体语义不冒进**：本任务定义七类数据的类型契约与写权限元数据，不批量重分类历史主体内容，不把模型推断自动升级为事实或本人声明。
6. **唯一切片、非大重构**：只把 Feedback 的确认写回接入 PackageStore；其它写路径先盘点、加守卫或记录，不在本任务顺带迁移。

## 3. 允许修改

- 新建 `digitalme-app/src/package-store/` 下的 PackageStore、schema、migration、hash、lock、change-set、snapshot/rollback 小模块；
- 新建 `digitalme-app/scripts/test-p1-02-package-store.cjs` 及仅使用临时 Package fixture 的测试；
- `digitalme-app/package.json` 增加 P1-02 测试脚本；
- `digitalme-app/src/feedback.js`、`src/main.js`、必要的 preload/renderer 最小改动，用于候选预览、确认提交、版本结果和回滚验收；
- 更新能力状态表、任务状态、阶段计划和 `digitalme_log.md`。

## 4. 禁止修改

- 不直接提交 `digital-me-package/**` 的内容变化；
- 不在启动时自动升级、补 hash、修复 sourceRefs 或重分类真实主体数据；
- 不迁移 Builder、Life、Policies、Identity 等其它写路径；
- 不顺带开发主体首页、PolicyEngine、ToolBroker、可信 AuditService 或协作 UI；
- 不用“逐文件覆盖 + 失败后尽量恢复”冒充原子提交；
- 不把版本快照、候选区或测试 fixture 写入真实 Package；
- 不把当前 placeholder signature 宣称为密码学签名；
- 不新增大型数据库或状态管理依赖，除非现有平台能力无法满足且先暂停说明。

## 5. Package schema v0.2 最小契约

代码仓库中建立版本化 schema，至少覆盖：

- manifest 必填：`schemaVersion`、`packageVersion`、`revision`、`digitalMeId`、`updatedAt`；
- 当前版本内容摘要：算法、逻辑文件清单和 SHA-256 根摘要；
- 七类主体数据枚举：`evidence / fact / owner_assertion / inference / current_state / development_intent / capability_policy`；
- change set 元数据：`id`、`baseRevision`、`actor`、`reason`、`sourceRefs`、`dataKinds`、`affectedPaths`、`beforeHashes`、`afterHashes`、`createdAt`；
- migration 元数据：from/to、时间、工具版本、结果；
- 明确排除：缓存、embedding、索引、临时文件、版本仓库自身不得进入当前内容根摘要。

v0.1 → v0.2 migration 只能对临时 fixture 或显式确认的提交副本执行，不得在读取真实 Package 时自动执行。

## 6. PackageStore 最小接口

主进程专用，业务层不得获得任意文件写入口。至少提供：

- `inspect(packageDir)`：只读识别版本、解析错误、缺失文件、内容摘要与健康问题；
- `createChangeSet(intent)`：字段白名单、路径白名单、记录 base revision/hash，不写当前 Package；
- `preview(changeSetId)`：返回脱敏的人读 diff，不返回任意本机文件；
- `commit(changeSetId, confirmation)`：锁定、复核 base、建立快照、在完整 staging 副本应用、校验后安全切换；
- `listVersions()` / `diffVersions()`；
- `rollback(versionId, confirmation)`：回滚本身产生新 revision，不篡改历史；
- `recover()`：识别并处理上次中断的 journal/staging，不静默选择不明版本。

禁止提供 renderer 可调用的通用 `writeFile(packagePath, content)`。

## 7. 提交事务与恢复

实现前必须针对 Windows + WPS 云盘路径说明采用的文件系统切换策略。最低顺序：

1. 获取单写者锁；
2. 重新计算当前 revision/hash，与 change set 的 base 比对；
3. 生成当前版本不可变快照和恢复 journal；
4. 在同一卷的 staging 中构建完整候选版本；
5. 校验 JSON/JSONL、schema、受影响 sourceRefs、manifest 和内容摘要；
6. manifest 最后生成；
7. 使用可证明的安全切换策略提交；
8. 提交后重新打开并校验；
9. 清理 staging，释放锁；
10. 任一步失败，恢复到唯一明确的旧版本并报告可操作错误。

若无法在当前文件系统上证明目录级原子切换，应停止并报告，不得把多文件顺序覆盖标记为完成。

## 8. Feedback 接入切片

- 保留现有 Feedback “预览 → 用户确认 → 写回”的产品流程；
- preview 生成 PackageStore change set，但不得改 Package；
- apply 只能提交对应 change set，不能重新接受一份未经预览的任意写入 plan；
- Feedback 数据在 change set 中标记为 `owner_assertion` 或 `inference`，必须依据现有用户确认语义明确选择，不能一律写成高置信事实；
- 提交结果返回 revision、affected paths、change set id 和 rollback version；
- UI 至少能告诉用户“已形成第 N 版、修改了哪些主体部分、可撤销”；
- 回滚需再次确认，并显示将恢复的影响范围。

## 9. 安全与输入边界

- PackageStore 只允许相对路径白名单；拒绝绝对路径、`..`、符号链接/重解析点逃逸和 Package 根目录外写入；
- change set id、revision、actor、reason、sourceRefs、写入内容均做类型和大小限制；
- 同一 Package 同时只允许一个 commit/rollback；锁必须有崩溃恢复与 stale 判断；
- renderer 不能指定 snapshot、journal、staging 的实际磁盘路径；
- 日志不得记录完整主体内容，只记录 id、revision、path、hash、结果与错误类型；
- 当前根摘要是完整性校验，不得命名为签名或身份凭证。

## 10. 自动测试

测试必须全部使用临时目录和合成 fixture，不读取、复制或修改真实 `digital-me-package`。至少覆盖：

1. v0.1 fixture 只读 inspect 不产生文件变化；
2. v0.1 → v0.2 显式迁移幂等；
3. schema/JSON/JSONL 错误被拒绝；
4. path traversal、绝对路径、符号链接/重解析点逃逸被拒绝；
5. create/preview 不改变 Package；
6. commit 后 revision、updatedAt、affected hashes 与根摘要一致；
7. before hash/revision 冲突阻止提交；
8. 两个并发写者只有一个成功；
9. staging 写失败、校验失败、快照失败、切换失败后旧版本字节级不变；
10. 模拟提交各阶段崩溃后 `recover()` 只恢复到明确版本；
11. rollback 产生新 revision，内容恢复且历史不被覆盖；
12. Feedback 未确认不写入，确认后只提交预览过的 change set；
13. change set 正确标注 data kind、sourceRefs、actor 和 reason；
14. manifest/current digest 不包含缓存、临时目录和版本仓库；
15. 全部修改 JavaScript 语法通过；
16. P1-01 测试继续通过；
17. Git 中 `digital-me-package/**` 相对基线 `151d798` 无变化，基线 hash 仍为 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`。

不得用只检查 mock 调用次数的测试代替磁盘故障与恢复验证。

## 11. Owner 人工验收

实现者必须提供不接触真实主体资产的沙盒验收入口：

1. 一键创建临时演示 Package；
2. 预览一条 Feedback change set，确认此时版本和文件未变化；
3. 确认提交，看到新 revision、修改范围和“可撤销”；
4. 关闭并重启应用，确认版本仍一致；
5. 执行回滚，看到产生更新的 revision 且内容恢复；
6. 人为制造过期 change set，确认系统拒绝覆盖新版本。

在 Codex 复核和沙盒验收前，不得要求 Owner 用真实 Package 测试写回或回滚。

## 12. 完成状态与交接

完成实现与自动测试后最多标记 `statically_verified`。提交报告必须包含：

- 文件与模块边界；
- schema、摘要算法和排除项；
- Windows/WPS 文件系统提交与恢复策略；
- Feedback 接入前后数据流；
- 故障注入测试矩阵及结果；
- 仍未迁移的直接 Package 写路径清单；
- P1-01 回归结果和 Package 基线 hash；
- Owner 沙盒验收步骤；
- 本地提交 hash；不设置 remote、不推送。

Owner 沙盒验收、Codex 架构/安全复核通过后，本任务才能标记 `accepted`。后续再决定迁移 Builder/Life/Policies，不能在本任务中擅自扩大。
