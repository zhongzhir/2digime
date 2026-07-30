# MVP-RELEASE-GATE-01D 实施报告

- **日期**：2026-07-30
- **任务**：`MVP-RELEASE-GATE-01D`
- **性质**：`execution_reliability` / `generation_interrupt_recovery` / `store_backup_and_recovery` / `artifact_store_reconciliation` / `knowledge_resolution_unification` / `stable_delivery_production_hardening` / `implementation`
- **Push**：否

---

## 1. Git 基线

| 项 | 值 |
|----|-----|
| 起始分支 | `codex/mvp-release-gate-01` |
| 起始 HEAD | `d9f43f6b288d27602cec38310c68ecc3d0684f66` |
| 最终分支 | `codex/mvp-release-gate-01` |
| 功能/测试收口 tip | `8c85f3ee5a161b1e2b48c91a51932da753dbe0be`（专项测试 + 证据 + 任务包 + 初版报告） |
| 报告校正 tip（当前 HEAD） | `3924b0586d709bb611980a83daec428ff0413c8d`（仅修正报告中的 HEAD 表述；无功能代码变更） |
| Push | **未 push** |
| 工作区 | 既有未跟踪审计/设计稿保留；本轮实现与证据已提交 |

**HEAD 关系（校正）**：`8c85f3e` 是 01D 功能与验收证据收口；`3924b05` 是其后的文档校正提交，且为 `8c85f3e` 的直接后代。二者无分叉。以 **分支 tip `3924b05`** 为进入 01E 的真实基线；评价 01D 能力时以 **`8c85f3e`** 为功能收口。

Commits：

1. `f3a94df` — `fix(runtime): heal interrupted generation and learning jobs`
2. `9d20951` — `feat(storage): add recoverable JSON store persistence`
3. `f4960b3` — `fix(artifacts): reconcile artifact files with authoritative store`
4. `c800fbe` — `refactor(context): unify chat and task knowledge resolution`
5. `8c85f3e` — `test(mvp): validate release gate execution reliability`
6. `3924b05` — `docs(mvp): record final HEAD for MVP-RELEASE-GATE-01D report`

---

## 2. Generation Heal

| 项 | 说明 |
|----|------|
| 写入点 | `deliverable-generation.js`：`registerGenerationAttempt` 在模型调用前将 Attempt/`generationStatus` 标为 `generating` |
| 成功点 | 文件 `commitVersionFiles` 后 `mutateStore` → Attempt `succeeded`、Deliverable `ready` |
| 失败点 | 既有 catch 路径写 `failed` |
| 启动扫描 | **新增** `runtime-interrupt-heal.healInterruptedGeneration`（`main.js` `app.whenReady` 暖启动后） |
| 权威 | Store 内 Attempt + Deliverable；磁盘文件不能自动成为权威成果 |
| UI busy | `generationStatus === "generating"` / workspace `running` |
| 卡住根因 | 强制退出后无启动扫描 → 永久 `generating` |

恢复规则：

- **A** 已有完整 Version + Artifact 且文件存在 → `succeeded` / `ready`，不重复生成  
- **B/C** 无完整 Store 版本 → `failed` + `errorCode: generation_interrupted`；用户面：「上次工作被中断，任务和材料已经保留。」  
- 孤儿目录交由 artifact reconcile 隔离，不自动晋升  
- 幂等：无残留 active Attempt 时不写 Store  

---

## 3. Learning Heal

| 项 | 说明 |
|----|------|
| running | `runLearnJob` 开头 `upsertJob(status=running)` |
| 完成 | `committed` / `skipped`（非枚举名 `completed`） |
| 资产识别 | `commit.changeSetId` 或 audit `committed`/`skipped_empty` |
| 未完成 | → `failed` + `learning_interrupted`；允许重试 |
| 僵尸修复 | `createQueuedJob` **不再**复用残留 `running`；failed/running 可重置为 `queued` |
| 去重 | 已 `committed` 的 version 仍 `reused`，不重复写入 |

---

## 4. Store 备份

共享实现：`digitalme-app/src/json-store-persistence.js`

写入顺序：serialize → tmp → 当前复制为 `.bak` → rename tmp→主文件  

读取顺序：主文件校验 → 失败则 `.bak` → 恢复主文件 → 记录 `store_recovered_from_bak` → 双损坏抛错（**不**返回空 Store）

覆盖 Store：

- `act-behalf-tasks.json`
- `deliverable-plans.json`
- `deliverable-packages.json`
- `authorizations.json`
- `deliverable-learn-jobs.json`

`.bak` 与主文件同处 userData 边界；不进仓库/公共临时目录/云端。

---

## 5. Artifact Reconciliation

| 项 | 说明 |
|----|------|
| 模块 | `artifact-reconciliation.js` |
| 写入顺序（现状） | staging → 正式目录 rename → Store 提交 Version/ArtifactRef（中断可留孤儿目录） |
| 孤儿 | 有界扫描 `deliverable-artifacts/{pkg}/{del}/{ver}`；Store 无引用 → `_orphaned/<stamp>/` |
| 缺文件 | resolver `file_missing`；文案「这个成果的本地文件暂时不可用。你可以重新生成。」；打开本地按钮禁用 |
| 一致性 | `getArtifactContent` / `openLocalArtifact` / File 菜单仍走 `resolveOpenableArtifact` |

---

## 6. stable_delivery

| 项 | 说明 |
|----|------|
| 正式模式 | `stable_delivery`（`quality-pipeline-mode.js`） |
| advanced | 仅显式 `deps.qualityPipelineMode === "advanced_shadow"`（测试/harness） |
| env | `DIGITALME_QUALITY_PIPELINE_MODE` / `DIGITALME_ALLOW_ADVANCED_PIPELINE` **均忽略** |
| 生产旁路 | 不删除 advanced 源码模块，但生产路径不可达；`maxRepair=0` 下 repair 仍不可达 |

---

## 7. 知识调用统一

| 项 | 说明 |
|----|------|
| doing | 既有 `resolveKnowledgeContext` + SCE |
| chat | `chat:send` / R2 lifecycle 已用 Resolver；**删除** `buildSystemPrompt` 全量 `longTermMemory` dump |
| supersession / rejected | Resolver `pickActiveClaims` 过滤 |
| 项目作用域 | 既有 project detection / claims retrieval |
| 正式旁路 | DVL2 计划任务仍拒绝 legacy `actBehalf:autoGenerate` 作为生成入口 |

---

## 8. Electron 验收

证据目录示例：`digitalme-app/scripts/_mvp-release-gate-01d-evidence/<stamp>/`

| 场景 | 结果 |
|------|------|
| A 生成中断重启 | Attempt → `failed`/`generation_interrupted`；Deliverable 非 `generating` |
| B 孤儿文件 | 正式树移入 `_orphaned`；不进成果 UI |
| C Store 主文件损坏 | 启动日志 recovered from `.bak`；任务/成果数据可读 |
| D Learning 中断 | job → `failed`；可重新 queued |
| E 知识一致性 | 单元：无 memory dump；Resolver 过滤 superseded（与 LEARN-LOOP-FIX-02 回归一致） |

专项：`npm run test:mvp-release-gate-01d` → 16 passed  
Electron：`npm run test:mvp-release-gate-01d-electron` → PASS  

回归抽样：`test-task-quality-stabilize-01`、`test-task-do-workspace-ux-01`、`test-learn-loop-fix-02` 通过。

---

## 9. 复杂度报告

```text
新增永久字段：0
新增 Store：0
删除 Store：0
新增 IPC：0
删除 IPC：0
新增 listener / handler：0（启动暖加载 + heal 挂在既有 whenReady）
删除 listener / handler：0
新增共享持久化工具：json-store-persistence.js
删除重复持久化实现：tasks/plans/packages/authorizations/learn 内联 rename 逻辑收敛
新增备份文件：各核心 Store 旁路 .bak（userData）
停止使用的知识旁路：chat buildSystemPrompt 全量 longTermMemory dump；env 开 advanced
代码行净变化：约 +共享模块与 heal/reconcile；核心 Store 内联持久化行减少（diff 约 +336 / −327 于既有改动文件，另含新文件）
是否新增第二事实源：否
```

---

## 10. 未处理事项

- **MVP-RELEASE-GATE-01E**：正式分发/安装器与更广回归闸门  
- 正式 Windows 安装器  
- Alpha 后质量增强（advanced 内容质量）  
- 完整诊断导出产品化  
- Generation 写入顺序完全「Store 先于正式目录」原子提交（本轮以对账+隔离覆盖中断）

---

## 11. 状态建议

```text
implemented /
generation_interrupt_recovery_validated /
learning_interrupt_recovery_validated /
recoverable_store_persistence_added /
artifact_store_reconciliation_validated /
stable_delivery_production_locked /
chat_and_task_knowledge_resolution_unified /
formal_restart_and_failure_recovery_validated /
ready_for_mvp_release_gate_01e /
not_pushed
```

**不得**标记：`mvp_ready` / `closed_alpha_ready` / `owner_runtime_accepted` / `full_learning_quality_validated` / `formal_windows_installer_validated`
