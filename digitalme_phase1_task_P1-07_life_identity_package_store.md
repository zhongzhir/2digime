# P1-07 任务包：Life / identity 写入路径迁移到 PackageStore

状态：statically_verified（Owner 验收第二轮已落地；等待 Codex 复核与 Owner 运行验收；**不得**标记 accepted）
阶段：第一阶段 / WP1（PackageStore 接入扩展）
前置任务：P1-00～P1-06（P1-05 可为 statically_verified；P1-06 须 accepted）
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP1
审计依据：`digitalme_architecture_audit_20260716.md` F-04、F-05、F-06
任务包建立：2026-07-17
实现分支：`codex/p1-07-life-identity-package-store`
实现提交：`813e509` → `b4dc2e2` → `dcfd936` → `c24f60e` → **`5ab55dc`**（当前基准）

---

## 1. 目标

将 **Life / identity 材料确认写回** 统一接入 PackageStore，形成与 P1-06 Builder 观念写入同构的可信路径：

```text
材料提交（identity）
→ 提取 / 审阅勾选
→ 预览变更（Package 字节不变）
→ Owner 明确确认
→ PackageStore commit
→ 新 revision
→ 可撤销 / 可恢复
```

验收后仍不得宣称「全部 Life 写入」或「Policies / MCP / 协作」已迁入 PackageStore。

## 2. 本任务代码 Owner

执行前填写其一：

- [ ] Codex
- [x] Cursor

同一时间只能有一个实现者修改本任务范围。

## 3. 范围（必须迁移）

1. `life.writeLifeBack`（`src/life.js`）及其内部直接写 Package 的调用链；
2. `builder:write` 的 **identity** 分支（`src/main.js`：当前直接调用 `life.writeLifeBack`）；
3. 与上述路径绑定的产品面确认写回（renderer / preload：`writeDistill` + `materialKind: "identity"`）。

统一改为：

```text
preview → 明确确认 → PackageStore commit
```

业务层不得再对上述切片使用 `writeFile` / `appendFile` / `rename` / `unlink` 或通用路径写入函数完成 identity / Life 写回；必须经 PackageStore change set。

## 4. 明确不包含

本任务**不**包含：

- Policies 写路径；
- MCP；
- ToolBroker；
- 外部协作；
- Life **读取**路径重构（`getLifeGraph` / `getCognition` / `summarizeLifeForPrompt` 等）；
- `package:load` 的其他 scaffold 行为（含 `life.ensureLifeScaffold`、`policies.ensureBoundariesScaffold`）；
- 认知页零散编辑 IPC（`life:updateInference` / `life:updatePerson` / `life:updateMindHook` / `life:upsertEvent` / `life:upsertPerson` / `life:deleteEvent` / `life:markMindHooks*` 等）——须登记为后续任务，本任务不得顺带宣称已全部迁完；
- `life:applyMindHooks` 中已迁入的 **persona** PackageStore 路径（属 P1-06，本任务不得回退）；
- 离线 distill / consolidate / clean-corruption 工具；
- `digital-me-package/**` 基线内容修改。

## 5. 数据类别映射表

PackageStore `dataKinds` 沿用 schema v0.2 枚举。本任务写入切片须保留并正确标注下列四类（可并存于同一 change set）：

| identity / Life 字段（`writeLifeBack` 输入） | 典型落盘路径 | 默认 `dataKind` | 说明 |
|---|---|---|---|
| `events`（履历事件） | `life/events.jsonl`；并可能更新 `life/roles.json` 等 facet | `fact` | 可核对的经历时间线；不得标为 `inference` 冒充硬事实 |
| `facts`（短句事实） | `identity-facts.md` | `fact` | 明确事实条目 |
| 由事件同步的 `identityClaims` | `identity.json` | `owner_assertion` | 经 Owner 确认勾选后写入的本人侧声明；不得在未确认时自动升级 |
| `outcomes`（成就 / 结果） | `life/outcomes.json` | `fact` | 可陈述结果；若仅模型猜测须降为 `inference` 并在预览标明 |
| `domains`（议题 / 专长信号） | `life/domains.json` | `inference` | 信号级，默认非硬事实 |
| `org_touchpoints` | `life/org_touchpoints.json` | `current_state` | 组织触点现状切片 |
| `alter_candidates` / people | `life/people.json` | `inference` | 候选关系人，默认待证实 |
| `capability_signals` | `life/capability_signals.json` | `inference` | 能力边界线索 |
| `mind_hooks` | `life/mind_hooks.json` | `inference` | 观念线索；蒸馏到 persona 仍走 P1-06 |
| `inferences` | `life/inferences.jsonl` | `inference` | 围绕本人的待证实推断 |
| 来源登记 | `sources/source-index.json` | （随本次写入的 kinds 一并记录） | 必须带 `sourceRefs` / 来源元数据 |

强制规则：

- 模型提取结果默认不得标为 `fact` 或 `owner_assertion`，除非产品面已有明确「确认为事实 / 本人声明」的勾选语义，并在 change set 元数据中可审计；
- 同一 change set 可含多种 `dataKinds`，预览必须按类别展示；
- 禁止把 `inference` 静默写成 `fact` / `owner_assertion`。

## 6. 现有直接写路径清单（静态盘点）

### 6.1 本任务必须关闭的主路径

| 入口 | 当前位置 | 现状 | P1-07 目标 |
|---|---|---|---|
| `builder:write` + `materialKind: "identity"` | `src/main.js` | 直接 `life.writeLifeBack` | preview + confirmed commit |
| `life.writeLifeBack` | `src/life.js` | 多文件 `writeFileSync` / `appendFileSync` | 改为生成 ops / change set；直接写阻断或仅经 PackageStore apply |
| renderer `writeDistill`（identity） | `src/renderer/app.js` → preload | 确认后一次 invoke 直接写 | 对齐 P1-06：先 preview，再带 `changeSetId` + `confirmed` 提交 |

`writeLifeBack` 当前会触达（非穷尽实现细节，实现时须对照代码复核）：

- `life/events.jsonl`
- `life/inferences.jsonl`
- `life/roles.json` / `relations.json` / `outcomes.json` / `interests.json`
- `life/domains.json` / `org_touchpoints.json` / `people.json` / `capability_signals.json` / `mind_hooks.json`
- `identity.json`（claims 同步）
- `identity-facts.md`
- `sources/source-index.json`
- `ensureLifeScaffold` 可能新建空 scaffold 文件（本任务不改 `package:load` 的 scaffold 策略，但 **确认写回** 不得依赖「先随便写盘再 commit」）

### 6.2 遗留 / 未接线但仍属直接写（须登记，本任务可不迁）

| 入口 | 位置 | 说明 |
|---|---|---|
| `materials.writeIdentityBack` / `writeIdentityClaims` / `appendIdentityFacts` | `src/materials.js` | 当前未见主进程调用；实现期应加测试防止回流，或一并改为仅经 PackageStore |
| `life:updateInference` 等认知编辑 | `src/main.js` + `src/life.js` | 产品面仍可直接改 Life 文件；**后续任务** |
| `package:load` → `ensureLifeScaffold` | `src/main.js` | 读取时 scaffold；本任务不改 |

### 6.3 已迁入（本任务不得破坏）

| 入口 | 说明 |
|---|---|
| Builder persona / `builder:previewWrite` + `commitPersonaWrite` | P1-06 |
| `life:applyMindHooks` → persona PackageStore | P1-06 |
| Feedback 确认写回 | P1-02 |

## 7. 数据契约（每次写入必须保留）

- `dataKinds`（至少覆盖第 5 节映射；可多值）
- `actor`（建议 `owner:life` 或 `owner:identity`；与 Builder 的 `owner:builder` 区分）
- `reason`
- `sourceRefs`（含材料来源标识 / 路径）
- 本次变更涉及的 Package 相对路径
- before revision / before hash（change set）
- `changeSetId`
- commit 后 `revision`
- `rollbackVersion`

候选 change set 带 `expiresAt`（建议默认 15 分钟，与 P1-06 对齐）；过期拒绝提交。

## 8. 产品行为

1. **预览**：Package 字节不变；显示将修改路径、各类 `dataKind`、来源与影响范围；允许放弃。
2. **确认**：必须由主进程在 `confirmed === true` 且未过期的 `changeSetId` 上 commit；renderer 不得直接提交任意路径或原始 identity payload 作为写计划。
3. **成功**：显示新 revision 与可恢复版本；失败不得显示成功。
4. **拒绝写入**：未确认、过期、revision/hash 冲突、恢复异常 → **不得写入**；旧版本字节与 revision 保持不变。
5. **重启**：revision 与内容一致；设置页资料版本入口可恢复。

## 9. 建议模块边界（实现时裁剪，本任务包不落代码）

- 新建例如 `src/life/package-write.js`（或等价）：`previewLifeIdentityWrite` / `commitLifeIdentityWrite` / payload→ops；
- `src/life.js`：`writeLifeBack` 阻断直接写，或仅保留只读/编排辅助；
- `src/main.js`：`builder:previewWrite` 支持 identity；`builder:write` identity 仅接受 changeSet；
- preload / renderer：identity 路径对齐 preview → confirm → commit，并展示版本与类别。

不得借本任务修改 SecretStore、ToolBroker、Policies、MCP 业务实现；PackageStore 仅允许为接入本切片所需的最小接线（若需扩展 ops 类型须在实现任务中单独说明并经 Codex 复核）。

## 10. 测试矩阵

自动化建议：`npm run test:p1-07`（hermetic 临时 fixture；不读真实 `digital-me-package/**`），并纳入 `test:p1-phase1`。

| # | 用例 | 期望 |
|---|---|---|
| 1 | preview 不改变 Package 字节 | 指纹 / 内容摘要不变 |
| 2 | 未确认不能写入 | 无 changeSet / `confirmed≠true` 拒绝 |
| 3 | 取消确认不写入 | UI/IPC 取消后字节与 revision 不变 |
| 4 | 确认后只提交预览过的路径 | 不得扩大写范围 |
| 5 | 写入产生新 revision | revision 递增；内容符合 ops |
| 6 | `dataKinds` / actor / reason / sourceRefs 正确 | 与映射表及输入一致 |
| 7 | 过期 changeSet 拒绝 | 不写盘 |
| 8 | revision / hash 冲突拒绝 | 不写盘 |
| 9 | commit / 恢复失败注入 | **旧版本不变** |
| 10 | 重启后 revision 与内容一致 | 重开 store 可读 |
| 11 | rollback 产生新 revision 并恢复内容 | 历史不篡改 |
| 12 | `writeLifeBack` / identity 直写已阻断 | 静态 + 行为断言 |
| 13 | P1-01～P1-06 hermetic 回归 | `test:p1-phase1` 相关子集通过 |
| 14 | 真实包基线 | **不**纳入本任务自动化；用 `npm run test:p1-baseline-real`（本机漂移可失败） |

## 11. Owner 沙盒验收步骤（仅临时测试资料）

前置：使用设置页「高级 / 测试工具」→「创建临时测试资料」（二次确认）；**不得**改动常规 `digital-me-package/**`。

1. 创建临时测试资料并确认横幅「当前正在使用临时测试资料」；
2. 提交一份 identity / 履历类测试材料；
3. 进入提取与审阅，勾选含事实、推断等不同类别的条目；
4. 打开预览：确认 Package 字节未变；可见路径、`dataKind`、来源；
5. 取消一次确认：确认未写入、无新 revision；
6. 再次预览并确认写入：显示新 revision；
7. 核对写入内容类别未把推断标成事实；
8. 完全退出并重启应用：revision 与内容一致；
9. 在设置「资料版本」执行恢复到上一版本：产生新 revision，内容回退正确；
10. 「恢复常规资料目录」并确认临时内容未自动合并回常规资料。

验收记录须写明：临时目录路径、revision 前后值、是否触碰真实 Package（应为否）。

## 12. 风险与回滚方案

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| identity 多文件事务不完整 | 半写 Life / identity | 仅 PackageStore staging + 切换；失败注入测旧版本不变 | 代码回退到 P1-06 行为；临时资料可弃 |
| 数据类别标错 | 推断被当成事实 | 映射表 + 预览展示 + 测试断言 | 修复映射后新 revision；不静默改历史 |
| 与 P1-06 persona 路径互相干扰 | 错误 commit 或 IPC 串味 | identity / persona 分支隔离；changeSet 白名单 | 按切片回退 IPC |
| 认知页直写仍在 | Owner 误以为 Life 已全部可信 | 能力表如实标记；任务包写明不包含 | 另开任务，不在本任务「补做」 |
| 误写真实 Package | 主体资产损坏 | 沙盒仅用临时测试资料；自动化 hermetic | 真实包不自动覆盖；从 Owner 备份恢复 |
| scaffold 与确认写回纠缠 | 读取时改盘被误认为写入成功 | 不改 `package:load` scaffold；写回路径独立 | 保持现状 scaffold |

实现失败时：

1. 不合并到主集成分支；
2. 不修改 `digital-me-package/**`；
3. 文档状态保持 `planned` 或退回 `specified`，不得标 `accepted`；
4. 在 `digitalme_log.md` 记录失败原因与未验证项。

## 13. 禁止事项

- 不顺带迁移 Policies / MCP / ToolBroker / 外部协作 / 认知页零散编辑；
- 不改动 `digital-me-package/**` 基线；
- 不把模型推断默认标为 `fact` 或 `owner_assertion`；
- 不在未确认、过期、冲突、恢复异常时写入；
- 不把本任务包状态标为 `statically_verified` 或 `accepted`（实现与验收前）；
- 不以 UI 文案冒充已完成 PackageStore 迁移。

## 14. 验证命令（实现阶段；本任务包建立时不执行业务实现）

```powershell
cd digitalme-app
npm run test:p1-07
npm run test:p1-phase1
# 可选：本机真实 Package 相对 P1-00（资料漂移可失败，不纳入 phase1）
npm run test:p1-baseline-real
node --check src/life.js
node --check src/main.js
node --check src/preload.js
node --check src/renderer/app.js
git diff --check
git status --short --branch
```

## 15. 完成定义（DoD）

- [x] 范围内直写路径已关闭，统一 preview → 确认 → PackageStore commit
- [x] 测试矩阵自动化通过（hermetic；`npm run test:p1-07` 38/38；`test:p1-07-owner-runtime` 8/8；`test:p1-phase1` 通过）
- [ ] Owner 沙盒验收通过（仅临时测试资料）
- [ ] Codex 架构 / 安全 / 回归复核通过（第一、二轮发现问题已修复；待再复核）
- [x] 能力状态表与日志已更新；**仍明确** Policies / 认知页直写 / MCP / 协作未迁
- [x] 真实 `digital-me-package/**` 未被本任务改动

### Codex 第一轮复核修复摘要（保持 statically_verified）

1. **分类**：由最终 ops 生成 `dataKinds` / `pathDataKinds`（可数组）/ `fieldKinds`；与 `affectedPaths` 精确对应；source-index 登记全部类别。
2. **字段确认**：`factConfirmedFields` 白名单（`events`/`facts`/`outcomes`）；删除 `confirmAsFact`；智能构建空列表。
3. **fail-closed 读取**：损坏 JSON/JSONL → `package_content_invalid`；优先 `append_jsonl`；禁止空结构覆盖。
4. **禁止 source-only**：无实质 op → `empty_write`；sourceRef 补充可构成实质变更。
5. **严格 change set 绑定**：actor / meta / materialKind / expiresAt / pathKinds / dataKinds 一致性。
6. **归档编排**：`runIdentityCommitAndArchive`；失败不归档、成功归档真实内容、archive 失败仅 warning。

### Codex 第二轮复核修复摘要（保持 statically_verified）

1. **结构 fail-closed**：facet/slice/`source-index`/`identity.json`/`events|inferences.jsonl` 校验字段类型；禁止 `items=[]` 静默修复。
2. **来源边界**：IPC 不接受 `sourceMeta`；主进程生成 `src_life_` + UUID；测试仅 `injectSourceMeta`。
3. **归档日志脱敏**：仅固定码 `archive_failed`，不记录 message/路径。

### Owner 验收修复摘要（保持 statically_verified）

1. **审阅可发现**：「审阅后写入」在主操作区；`#builder-review` 位于待处理材料之后、自我评测之前；`renderReview` 自动切构建 lane、滚动并聚焦。
2. **状态与 commit 绑定**：`awaiting_review` / `written` 仅随真实 Package commit；取消/放弃/预览失败不标 written。
3. **智能构建**：`committed===true` 才计数与展示「本批已写入」；取消显示「已取消，资料未写入」。
4. **审阅队列**：按 kind 顺序；commit 成功才 written；放弃恢复 suggested。
5. **版本区**：无 commit →「尚无可恢复版本」；commit 后刷新 revision/可恢复版本。
6. **Electron 测试**：`npm run test:p1-07-owner-runtime` 8/8。

---

### Owner 验收第二轮修复摘要（保持 statically_verified）

1. **多组审阅不跳页**：第一组 commit 后加载下一组时留在构建 lane；`#builder-review` 保持可见、滚动聚焦；进度「等待你审阅，尚未写入」；全部完成时不自动跳认知页。
2. **确认取消恢复 suggested**：`cancelCurrentReviewWithoutWrite()` 统一处理 identity/persona 确认取消与「放弃」；清理队列与 pending 状态；文案「已取消，资料未写入。可重新进入审阅。」
3. **智能构建不隐式 applyMindHooks**：本轮无成功 PackageStore commit 时不调用；取消后 revision 不变。
4. **revision fail-closed**：`isValidPackageRevision`；非法 revision 不标 written，固定错误文案，不泄漏路径或正文。
5. **Electron 测试**：`test:p1-07-owner-runtime` 13/13（A identity 取消、B persona 取消、C 多组推进、D hooks 下取消、E 非法 revision）。

---

**当前状态说明**：Owner 验收第二轮修复已落地（`statically_verified`，基准 `5ab55dc`）。等待 Codex 再复核与 Owner 运行验收；通过前不得标 `accepted`。

---

## 12. 完成状态与交接（2026-07-17 收工）

### 当前基准

- 分支：`codex/p1-07-life-identity-package-store`
- 提交：`5ab55dc` — fix(ui): close P1-07 review cancellation and queue transitions
- 状态：`statically_verified`（不 push、不标 accepted）
- 本地交接：`digitalme-source-5ab55dc.zip`、`p1-07-5ab55dc-stat.txt`、`p1-07-5ab55dc-status.txt`

### 自动化证据

| 命令 | 结果 |
|---|---|
| `npm run test:p1-07` | 39/39 |
| `npm run test:p1-07-owner-runtime` | 13/13 |
| `npm run test:p1-phase1` | 通过 |
| `npm run test:p1-06` | 14/14 |
| `npm run test:owner-runtime` | 5/5 |

### Owner 运行验收检查项（续作）

1. 多类别审阅：第一组写入后第二组仍在构建页可见，可继续审阅
2. identity / persona 确认弹窗点「取消」：恢复 `suggested`，可再次「审阅后写入」
3. 智能构建全部取消：revision 不变，不出现「已写入」横幅
4. 有 pending 观念线索时智能构建取消：`applyMindHooks` 不得被隐式调用
5. 版本区：仅真实 commit 后 revision 与可恢复版本变化

**禁止**：恢复或覆盖本机真实 Package 作为默认测试步骤。

### 明确不在本任务续作范围

P1-08、Policies 迁移、MCP/ToolBroker 扩展、认知页零散编辑、Life 读取重构、`package:load` scaffold。
