# Digital Me V2 — P2.0 代码能力规格（CODE-CAPABILITY-SPEC）v0.1

- 日期：2026-08-03
- 分支：`v2/foundation`
- 状态：`superseded_by_v0.2`（见 `digitalme_v2_p2.0_code_capability_spec_v0.2_20260803.md`；本版 local-tool 本地分析器与 Adapter 直读文件系统路线已废止）
- 范围：**只做规格与可编译契约**，不实现完整能力
- 可编译契约落点：
  - `digitalme-v2/src/capability/adapters/code-repo-analysis-contract.ts`
  - 契约测试：`digitalme-v2/src/capability/adapters/tests/code-repo-analysis-contract.test.ts`

## 0. 硬约束回执

| 约束 | 本规格如何满足 |
|---|---|
| 不修改 Subject Core | 规格与契约不触碰 `subject-core/`；成长回流沿用既有 saveEdit → GrowthEvent 链 |
| 不修改 ExecutionJob 状态机 | 代码分析 Job 仍是 queued→running→succeeded/failed/cancelled 五态；无新增态 |
| 不新增核心对象 | 复用 Task / Job / Snapshot / Artifact(bundle)；manifest 是 bundle 内一个条目，不是新对象 |
| 不新增代码任务 Store | 无新 Store；分析结果全部落入既有 ArtifactCommitter + ContentStore |
| 不执行仓库命令 | 扫描器**只读文件系统**；禁止 `git`/`npm`/任何子进程 |
| 不修改用户仓库 | P2A 权限只有 `filesystem_read`；无写路径 |
| 不读取凭证文件 | 排除规则将凭证类文件列为**硬排除**；Adapter 无 `secret_access` 权限 |
| 不 push / 不构建 portable | 本任务只产出文档与契约代码 |

---

## 1. code repository analysis Adapter 契约

### 1.1 定位

- `CapabilityAdapter` 的一个新实现，**不改 CapabilityAdapter / CapabilityInput / CapabilityOutput 接口**。
- `adapter.type` 使用既有白名单 `'local-tool'`（不扩 `ADAPTER_TYPES`，无评审面扩张）。
- 能力 id：`cap_code_repo_analysis`；`kind: 'tool'`；`location: 'local'`。

### 1.2 注册声明（可编译契约已提供 builder）

| 字段 | 值 | 说明 |
|---|---|---|
| `outputArtifactTypes` | `['code-analysis']` | 新 artifact type 字符串；Artifact 对象本身不变 |
| `permissions` | `['filesystem_read']` | **只读**；无 `network` / `filesystem_write` / `secret_access` |
| `inputContract` | goal + snapshot + subjectContext | 与文档能力一致 |
| `availability` | 由装配层给定 | 与模型能力同一 `capability.list` 单源派生 |

### 1.3 输入输出

- 输入：用户在既有任务页把**仓库根目录**作为 folder 材料加入；`ContextSnapshotBuilder` 产出 folder-entry 条目。仓库扫描的深度枚举由 Adapter 在执行期基于 snapshot 的根路径完成（见 §3 预算），**Snapshot 契约不变**。
- 输出：`CapabilityOutput.artifact.payload = { kind: 'bundle', entries: [...] }`，条目角色见 §2。
- 失败：沿用既有 `stage: 'capability'` + `actionable` 错误面；不新增失败阶段。

### 1.4 与主链的关系

Work Runtime / JobRunner / ArtifactCommitter **零改动**。`requestedArtifactType: 'code-analysis'` 由既有 `registry.selectFor(artifactType)` 路由到本 Adapter。

---

## 2. bundle Artifact manifest 契约

### 2.1 载体

复用既有 `ArtifactContent.bundle`（`entries: { ref, mediaType, role }[]`）。manifest 本身是 bundle 的一个条目（`role: 'manifest'`，`mediaType: 'application/json'`），**不是新领域对象**。

### 2.2 角色封闭表（契约常量 `CODE_BUNDLE_ROLES`）

| role | 内容 | 必选 |
|---|---|---|
| `report` | 分析报告 Markdown（用户主阅读面） | 是 |
| `manifest` | `CodeAnalysisBundleManifest` JSON | 是 |
| `evidence` | 结构化证据（文件清单、指标 JSON） | 否 |

### 2.3 `CodeAnalysisBundleManifest`（可编译类型）

```
schemaVersion: 'code-analysis/1'
generatedAt: ISO 字符串
repo: { rootName, fileCountScanned, totalBytesScanned, truncated, skippedSensitiveCount, skippedBudgetCount }
languages: { language, files, bytes }[]
entries: { role, path, mediaType, bytes? }[]   // 与 bundle entries 一一对应
warnings: string[]                              // 用户面文案,不含内部字段名
```

规则：
- manifest **不包含**任何文件正文、密钥样本或绝对路径外泄（只保留仓库内相对路径）；
- `schemaVersion` 变更必须升版本号，viewer 按版本兼容渲染；
- 报告与 manifest 不一致时以 manifest 为准（viewer 校验条目数）。

---

## 3. repository scanner 安全与预算规则

### 3.1 安全规则（硬性）

1. **只读**：仅 `fs.readdir` / `fs.stat` / `fs.readFile`；禁止 spawn、禁止写入、禁止跟随符号链接（`lstat` 判定，symlink 一律跳过并记 warning）。
2. **围栏**：所有访问路径必须解析后仍位于用户选择的仓库根目录之下（沿用 ContentStore 同款路径围栏语义）。
3. **不读凭证**：命中 §4 排除规则的文件**不打开句柄**，直接跳过。
4. **单文件失败降级**：读取失败记 warning，不中断整体（与 Snapshot warning 语义一致）。

### 3.2 预算（契约常量 `CODE_SCAN_BUDGET`）

| 常量 | 值 | 说明 |
|---|---|---|
| `maxFiles` | 2000 | 超出即 `truncated=true`，按目录序截断 |
| `maxTotalBytes` | 32 MB | 累计读取上限 |
| `maxFileBytes` | 512 KB | 单文件上限，超出只读前段并标记截断 |
| `maxDepth` | 12 | 目录深度上限 |
| `maxScanMs` | 60_000 | 扫描时间预算，超时产出部分结果 + warning |

预算触发一律**降级为部分结果**，不视为失败；manifest 里如实记录 `truncated / skippedBudgetCount`。

---

## 4. sensitive-file exclusion 规则

契约常量 `SENSITIVE_PATH_RULES` + 纯函数 `isSensitivePath(relPath)`（可编译、已测试）。

### 4.1 目录级排除（整树跳过）

`node_modules`、`.git`、`.svn`、`.hg`、`dist`、`build`、`out`、`coverage`、`release-staging`、`.venv`、`venv`、`__pycache__`、`.idea`、`.vscode`（其下 `settings.json` 可能含 token）

### 4.2 文件级硬排除（凭证与密钥，永不读取）

- `.env` 及 `.env.*`；`*.pem`、`*.key`、`*.pfx`、`*.p12`、`*.jks`、`*.keystore`
- `id_rsa*`、`id_ed25519*`、`*.ppk`
- `secrets*.json`、`credentials*`、`.npmrc`、`.netrc`、`.pypirc`
- `.runtime-model-credential.json`、`secrets.v2.json`（本产品自身凭证文件显式列入）

### 4.3 内容级兜底

进入报告/evidence 的任何文本片段过 secret scrub（复用 `scrubSecrets` 同款正则：`sk-…`、`Bearer …`、`api_key=`）。命中即替换 `[redacted]` 并记 warning。

### 4.4 用户面表达

跳过敏感文件时用户面只显示「已跳过 N 个敏感或凭证类文件」，不列出具体密钥文件名样本。

---

## 5. bundle workspace UI 设计

原则：**bundle viewer 是既有成果区的一种渲染分支**，无新页面、无新命令、无新状态。

- `artifact.getContent` 返回 `content.kind === 'bundle'` 时，成果区切换为 bundle 视图：
  - 顶部：成果标题 + 「打开所在目录」（复用）；
  - 主区：渲染 `role: 'report'` 条目的 Markdown（只读）；
  - 侧栏/下方：manifest 摘要（扫描文件数、语言分布、截断与跳过计数、warnings）与条目列表（role、相对路径、大小）；
- P2A **不提供 bundle 编辑**：`saveEdit` 对 bundle 保持现有报错语义（仅 text 可编辑），UI 隐藏编辑器与自动保存；
- 「修改成果」（reviseArtifact）P2A 对 bundle **不开放**（按钮不渲染），推迟到 P2B 评估；
- 导出：P2A 仅提供「打开所在目录」访达文件；MD/DOCX 导出按钮对 bundle 隐藏（导出契约不变）；
- 状态文案沿用封闭表：等待开始 / 正在处理 / 已完成 / 需要处理（无「正在修改」场景）。

---

## 6. P2A 测试矩阵

| # | 场景 | 断言 |
|---|---|---|
| 1 | 小型 TS 仓库（<100 文件） | succeeded；bundle 含 report+manifest；manifest 计数与实际一致 |
| 2 | 含 `node_modules` / `.git` | 整树跳过；不出现在 manifest.entries |
| 3 | 含 `.env`、`id_rsa`、`secrets.v2.json` | 文件未被打开（探针：不可读权限文件不报错）；skippedSensitiveCount 正确；报告无内容泄漏 |
| 4 | 超 `maxFiles` / `maxTotalBytes` | truncated=true；部分结果；Job 仍 succeeded |
| 5 | 超 `maxScanMs`（大仓库） | 部分结果 + warning；无僵死 Job |
| 6 | symlink 指向仓库外 | 跳过 + warning；无围栏逃逸 |
| 7 | 单文件读取失败（锁定/权限） | warning 降级；整体成功 |
| 8 | cancel 扫描中 | cancelled；无 Artifact |
| 9 | 同 Task 并发提交 | 第二次拒绝（既有单活跃 Job 语义） |
| 10 | 崩溃重启恢复 | 既有恢复协议不变；bundle Artifact 完整或 Job failed |
| 11 | UI bundle 视图 | report 渲染；编辑器/导出/修改成果均不出现；打开所在目录可用 |
| 12 | `capability.list` | code 能力与模型能力互不影响可用性派生；文档任务仍走模型 Adapter |
| 13 | 报告内容 scrub | 植入伪密钥文件（非排除名单内）→ 报告中为 `[redacted]` |
| 14 | 无模型凭证时 | code 分析（本地工具）仍可用——**待 CTO 决策**：P2A 是否随模型门禁一起禁用（建议：不禁用，horizontal gate 只约束 document 类型） |

---

## 7. P2B 受控修改的后置边界

P2B（未来的「代码受控修改」）**不在 P2A 范围**，此处仅定边界，防止 P2A 私自越界：

1. 任何写入用户仓库的能力必须声明 `filesystem_write`，并经正式 `AuthorizationGrant`（grantee.kind='capability'）授权后才可注册为 available——**授权不得藏在 Adapter 内部**。
2. P2B 的产出形态是**修改提案**（diff/patch bundle Artifact），Adapter 本身永不直接改仓库文件；「应用修改」是用户在 UI 上的显式动作，且应用器是独立受审模块，不是 Adapter 的隐藏副作用。
3. 不新增「代码任务」对象或 Store；提案仍是 Artifact 版本链的一部分。
4. 不引入 plan/confirm/reviewer/adopted 等已废除概念；受控修改的确认次数以「新决策才新增确认」原则约束（用户面一次确认：应用/不应用）。
5. 若未来接入 Codex/Claude Code 类外部代码代理：作为新的 Adapter（`openai-compatible-model` 或新评审的 adapter 类型），主链、Store、UI viewer 不变。

---

## 8. 架构反向审查

**Q1 新能力是否只由 Adapter + bundle viewer 构成？**
是。改动面 = 1 个 `local-tool` Adapter + 成果区的 bundle 渲染分支 + 契约常量。无新命令（复用 `work.submitTask` 传 `requestedArtifactType: 'code-analysis'`）、无新 Store、无新状态。

**Q2 Work Runtime 是否仍对代码场景零感知？**
是。JobRunner 仅经 `registry.selectFor` 路由；快照、提交、恢复、取消全部沿用。代码场景专有知识（扫描、排除、预算、manifest）全部封装在 Adapter 与契约常量中。

**Q3 能否未来把本地分析器替换为 Codex/Claude Code 而不改主链？**
能。替换点是 Adapter 实现（同一 registration id 或并列新能力），`CapabilityInput/Output` 与 bundle manifest 契约不变；viewer 按 `schemaVersion` 渲染。外部代理需要的 network/secret 权限走 registration.permissions 声明 + 授权边界，不进主链。

**Q4 是否把安全权限错误地藏进 Adapter 内而没有正式授权边界？**
未发生，且已显式防范：P2A registration 只声明 `filesystem_read`；扫描器安全规则（只读、围栏、不读凭证、不 spawn）写入契约与测试；P2B 写权限必须走 AuthorizationGrant（§7.1），规格明文禁止 Adapter 内部自授权。

**Q5 是否出现新的多状态、多 Store 或多入口？**
否。状态机不变（五态 Job / 四态 Task 派生）；Store 集合不变；入口仍是唯一命令面（16 条，未新增）。manifest 是内容而非状态，bundle viewer 是渲染而非入口。

---

## 9. 待 CTO 决策项

1. §6-14：无模型凭证时本地代码分析是否可用（建议可用，模型门禁只约束 document）。
2. `code-analysis` 是否作为任务页的显式成果类型选项，还是由目标文本推断（建议：P2A 用显式选择，避免误路由）。
3. P2A 是否需要 `evidence` 角色（建议：首版只 report+manifest，evidence 留位）。
