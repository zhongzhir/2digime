# Digital Me V2 — P2.0 代码能力规格（CODE-CAPABILITY-SPEC）v0.2

- 日期：2026-08-03
- 分支：`v2/foundation`
- 状态：`cto_revision_applied`（v0.1 → v0.2，按 CTO 复核意见修订；复核通过后进入 P2.1）
- 替代：`digitalme_v2_p2.0_code_capability_spec_v0.1_20260803.md`（superseded）
- 可编译契约落点：
  - `digitalme-v2/src/work-runtime/context-policy.ts`（新增：通用摄取策略）
  - `digitalme-v2/src/capability/registration.ts`（新增可选字段 `contextPolicy`）
  - `digitalme-v2/src/capability/adapters/code-repo-analysis-contract.ts`
  - 契约测试：`digitalme-v2/src/capability/adapters/tests/code-repo-analysis-contract.test.ts`

## v0.2 修订要点（相对 v0.1）

1. **Adapter 执行期禁止重新读取用户仓库**。仓库遍历、敏感排除、预算控制、内容冻结全部移动到 ContextSnapshot 构建阶段。
2. `CapabilityRegistration` 增加**通用可选 `contextPolicy`**（无代码专用状态），由 SnapshotBuilder 执行；文档能力不声明策略，缺省行为不变。
3. 代码分析 Adapter **只消费冻结 Snapshot**（`extractedTextRef`），真实分析由模型完成：权限修正为 `network` + `secret_access`，**不含 `filesystem_read`**。
4. 无模型凭证时 `availability = 'needs_setup'`，**不生成本地替代成果**（v0.1 的 local-tool 本地分析器路线废止，v0.1 §9 决策项 1 由此关闭）。
5. 任务页采用**显式 `requestedArtifactType`**：`document | code-analysis`（v0.1 §9 决策项 2 关闭：显式选择）。
6. evidence role：P2.1 实现 manifest/schema 与确定性引用结构；P2.2 成为分析成果必选条目（v0.1 §9 决策项 3 关闭）。

## 0. 硬约束回执

| 约束 | 满足方式 |
|---|---|
| 8 个核心对象不增加 | 复用 Task / Job / Snapshot / Artifact(bundle)；contextPolicy 是注册声明上的值对象，manifest/evidence 是 bundle 条目内容 |
| 命令面不增加 | 仍 16 条；`work.submitTask` 携带显式 `requestedArtifactType` |
| Job 五态不改 | queued→running→succeeded/failed/cancelled；预算截断降级为部分快照 + warning，不引入新态 |
| Work Runtime 无代码专用分支 | SnapshotBuilder 只认通用 `ContextIngestionPolicy`；JobRunner 仅经 `registry.selectFor` 路由 |
| 不执行仓库命令 / 不修改用户仓库 | 构建期只读 `lstat/readdir/readFile`，禁止 spawn 与写入 |
| 不读取凭证文件 | 构建期敏感排除命中即不打开句柄；Adapter 无文件系统权限 |
| 不提交 / 不 push / 不构建 portable | 本任务只产出文档与契约代码 |

---

## 1. code repository analysis Adapter 契约（修订）

### 1.1 定位

- `CapabilityAdapter` 的一个新实现，**不改 CapabilityAdapter / CapabilityInput / CapabilityOutput 接口**。
- 真实分析由模型完成：`adapter.type = 'openai-compatible-model'`（既有白名单），`adapterId: 'code-repo-analysis'`，与文档能力共用模型凭证与门禁。
- `kind: 'agent'`；`location: 'remote'`。

### 1.2 注册声明

| 字段 | 值 | 说明 |
|---|---|---|
| `outputArtifactTypes` | `['code-analysis']` | 新 artifact type 字符串；Artifact 对象不变 |
| `permissions` | `['network', 'secret_access']` | **无 `filesystem_read`**；仓库内容一律经冻结 Snapshot 进入 |
| `contextPolicy` | `{ folderTraversal:'recursive', excludeSensitivePaths:true, budget }` | 通用策略，SnapshotBuilder 执行 |
| `availability` | `resolveCodeAnalysisAvailability(modelReady)` | 无凭证 → `needs_setup`，无本地替代 |

### 1.3 执行期边界（硬性）

- Adapter 输入 = 冻结 `ContextSnapshot` + goal + subjectContext；仓库文本只能经 `ctx.readExtractedText(ref)` 读取冻结副本。
- **禁止**在 execute 内访问用户文件系统原路径、重扫目录、读任何 `sourcePath`。
- 产出 bundle（report + manifest [+ evidence]）写入 `ctx.workDir`，由执行器持久化。

### 1.4 与主链的关系

Work Runtime / JobRunner / ArtifactCommitter 零改动；`requestedArtifactType: 'code-analysis'` 经既有 `registry.selectFor` 路由。

---

## 2. Snapshot 构建阶段的摄取策略（原扫描器章节重写）

### 2.1 通用 `ContextIngestionPolicy`（已落契约）

```
folderTraversal: 'top-level' | 'recursive'   // 缺省 top-level = 现行文档行为
excludeSensitivePaths: boolean               // 缺省 false = 现行行为
budget?: { maxFiles, maxTotalBytes, maxFileBytes, maxDepth, maxScanMs }
```

- 策略挂在 `CapabilityRegistration.contextPolicy`（可选）；**不含任何代码专用字段**（契约测试锁死键名）。
- P2.1 实现：JobRunner 在选定能力后把该能力的 `contextPolicy`（或缺省策略）传给 `ContextSnapshotBuilder.build`；Builder 是唯一执行者。
- 文档能力不声明策略 → Builder 走现行 top-level 路径，行为逐字节不变。

### 2.2 构建期安全规则（硬性）

1. 只读 `lstat / readdir / readFile`；禁止 spawn；禁止写入；symlink 一律跳过并记 warning。
2. 路径围栏：解析后必须仍在用户所选根目录之下。
3. 敏感命中（§3）不打开文件句柄，计入 `skippedSensitiveCount`。
4. 单文件失败降级 warning，不中断整体（既有 Snapshot 语义）。

### 2.3 预算（契约常量 `RECURSIVE_INGESTION_BUDGET`）

maxFiles 2000 / maxTotalBytes 32MB / maxFileBytes 512KB / maxDepth 12 / maxScanMs 60s。
超预算 → 部分快照 + warning + `skippedBudgetCount`，Job 不失败、无新状态。

### 2.4 内容冻结

递归摄取的每个文件按既有 `mapOutcome` 流程冻结为 `contentDigest + extractedTextRef`。快照建成后，用户仓库的任何后续变化不影响本次 Job；Adapter、manifest、evidence 全部只引用冻结副本。

---

## 3. sensitive-file exclusion 规则（迁移至构建期）

规则集与纯函数 `isSensitivePath` 现位于 `work-runtime/context-policy.ts`（Builder 层执行）：

- **目录级**：`node_modules`、`.git`、`.svn`、`.hg`、`dist`、`build`、`out`、`coverage`、`release-staging`、`.venv`、`venv`、`__pycache__`、`.idea`、`.vscode`
- **文件级硬排除**：`.env*`；`*.pem/.key/.pfx/.p12/.jks/.keystore/.ppk`；`id_rsa*`/`id_ed25519*` 等；`secrets*.json`、`credentials*`、`.npmrc`、`.netrc`、`.pypirc`；本产品自身 `.runtime-model-credential.json`、`secrets.v2.json`
- **内容级兜底**：进入 prompt / 报告 / evidence 的文本过 `sanitizeMessage` 同款 scrub。
- **用户面**：只显示「已跳过 N 个敏感或凭证类文件」，不列文件名样本。

---

## 4. bundle Artifact manifest 契约

同 v0.1（载体为既有 bundle entries + role），修订两点：

1. `repo.*` 计数**来自 Snapshot 构建结果**，不来自执行期重扫；
2. 角色封闭表 `report | manifest | evidence`，evidence 时间表见 §5。

`schemaVersion: 'code-analysis/1'`；manifest 不含文件正文、密钥样本、绝对路径。

---

## 5. evidence 契约（新增章节）

- **P2.1**：落 `code-analysis-evidence/1` schema 与确定性引用结构（已可编译）；产出可选。
- **P2.2**：evidence 成为分析成果**必选**条目，report 中的结论必须可经 `claimId` 回溯。

结构（`CodeAnalysisEvidenceFile`）：

```
schemaVersion: 'code-analysis-evidence/1'
items: {
  claimId: string                 // report 结论锚点
  path: string                    // 根内相对路径,禁止绝对路径
  contentDigest: string           // 指向冻结 SnapshotItem.contentDigest
  span?: { startLine, endLine }
  excerpt?: string                // ≤240 字符,经 scrub;禁止整文件
}[]
```

约束：不含绝对路径、完整文件或敏感内容；引用只指向冻结 Snapshot（确定性、可重放）；excerpt 上限为契约常量 `EVIDENCE_EXCERPT_MAX_CHARS`。

---

## 6. 任务页与 bundle workspace UI 设计（修订）

- **显式成果类型**：任务页提供封闭选择 `document | code-analysis`（契约常量 `REQUESTED_ARTIFACT_TYPES`），默认 `document`；不做目标文本推断。文案遵守用户面规范（如「文档 / 代码分析」）。
- **模型门禁统一**：code-analysis 与 document 同受模型门禁；无凭证时两者均不可提交，提示前往设置连接模型（无本地替代路径）。
- bundle viewer 同 v0.1：成果区渲染分支，report 只读渲染 + manifest 摘要 + 条目列表；无编辑、无「修改成果」、无 MD/DOCX 导出（保留「打开所在目录」）；无新页面、无新命令、无新状态。

---

## 7. P2A 测试矩阵（更新）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 小型 TS 仓库 + `requestedArtifactType='code-analysis'` | succeeded；bundle 含 report+manifest；manifest 计数与 Snapshot 一致 |
| 2 | 含 `node_modules` / `.git` | 构建期整树跳过；不出现在 Snapshot 与 manifest |
| 3 | 含 `.env`、`id_rsa`、`secrets.v2.json` | 构建期未打开句柄（探针：不可读权限文件不报错）；skippedSensitiveCount 正确 |
| 4 | 超 maxFiles / maxTotalBytes | 部分快照 truncated=true；Job succeeded |
| 5 | 超 maxScanMs | 部分快照 + warning；无僵死 Job |
| 6 | symlink 指向根外 | 构建期跳过 + warning；无围栏逃逸 |
| 7 | 单文件读取失败 | warning 降级；整体成功 |
| 8 | **快照后修改仓库文件再执行** | 产出只反映冻结内容；Adapter 未访问原路径（探针：构建后撤销目录读权限，执行仍成功） |
| 9 | cancel 扫描/执行中 | cancelled；无 Artifact |
| 10 | 崩溃重启恢复 | 既有恢复协议不变 |
| 11 | UI bundle 视图 | report 渲染；编辑/导出/修改成果不出现；打开目录可用 |
| 12 | 无模型凭证 | code-analysis `needs_setup`；提交被门禁拦截；**无本地替代成果** |
| 13 | 文档能力回归 | 无 contextPolicy 的文档任务快照行为与 P1 逐字节一致 |
| 14 | contextPolicy 通用性 | 策略键名无场景专用词（契约测试已锁） |
| 15 | evidence（P2.1 起） | schema 校验通过；无绝对路径;excerpt ≤240 且过 scrub;contentDigest 均存在于 Snapshot |
| 16 | 报告/evidence scrub | 植入伪密钥文本 → `[redacted]` |

---

## 8. P2B 受控修改的后置边界

同 v0.1 五条不变，并追加：

6. P2B 的修改提案生成同样**只消费冻结 Snapshot**；若未来「应用修改」需要写盘，写入器是独立受审模块，其 `filesystem_write` 权限经 `AuthorizationGrant` 显式授予，与分析 Adapter 的 `network/secret_access` 权限互不继承。

---

## 9. 架构反向审查（更新）

**Q1 新能力是否只由 Adapter + bundle viewer 构成？**
是，且比 v0.1 更薄：Adapter 是纯「冻结快照 → 模型 → bundle」变换；仓库摄取属于既有 SnapshotBuilder 的通用策略执行，不是代码能力的私有部件。

**Q2 Work Runtime 是否仍对代码场景零感知？**
是。SnapshotBuilder 只认通用 `ContextIngestionPolicy`（键名经测试锁定无场景词）；JobRunner 传递策略但不解释策略；无任何 `if (code)` 分支。

**Q3 能否未来把本地分析器替换为 Codex/Claude Code 而不改主链？**
能，且路径更干净：替换点仅在 Adapter 实现（同为「消费冻结 Snapshot、产出 bundle」），摄取策略、manifest/evidence schema、viewer 全部复用；外部代理权限仍是 network + secret_access，不新增文件系统暴露。

**Q4 是否把安全权限错误地藏进 Adapter 内而没有正式授权边界？**
v0.1 的隐患（Adapter 自带 filesystem_read）已被本修订消除：Adapter 权限只剩 network + secret_access；文件系统访问收敛到 SnapshotBuilder——其边界即用户在任务页显式选择材料这一授权动作，且受敏感排除与围栏约束。P2B 写权限必须走 AuthorizationGrant。

**Q5 是否出现新的多状态、多 Store 或多入口？**
否。Job 五态不变；Store 集合不变；命令面 16 条不变；`requestedArtifactType` 是既有提交参数的封闭取值，不是新入口；contextPolicy 是注册声明的值对象，不是状态。

---

## 10. P2.1 开工条件核对

- [x] Adapter / manifest / evidence / 策略契约均可编译并有测试锁定
- [x] 权限分工冻结：Builder=文件系统（用户选材授权内）；Adapter=network+secret_access
- [x] 三项 v0.1 待决事项已由 CTO 意见关闭
- [ ] CTO 对 v0.2 复核通过（唯一剩余前置）
