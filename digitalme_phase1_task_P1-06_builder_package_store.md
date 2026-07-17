# P1-06 任务包：Builder 写入路径迁移到 PackageStore

状态：statically_verified（自动测试通过；交 Codex 复核；不标记 accepted；等待 Owner 沙盒验收）
阶段：第一阶段 / WP1（PackageStore 接入扩展）
前置任务：P1-00～P1-05（P1-05 可为 statically_verified）
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP1
审计依据：`digitalme_architecture_audit_20260716.md` F-04、F-05、F-06
实现分支：`codex/p1-06-builder-package-store`

---

## 1. 目标

将 Builder 对 Digital Me Package 的**观念/人格类写入**统一接入 PackageStore，形成：

```text
材料提交
→ 提取/蒸馏
→ 预览变更（Package 字节不变）
→ Owner 明确确认
→ PackageStore commit
→ 新 revision
→ 可撤销/可恢复
```

Builder 不得把模型输出直接视为已确认主体事实；写入数据类别为 `inference`，并保留 `sourceRefs`。

## 2. 范围（必须迁移）

- `builder.writeBack`（直接写已阻断）
- `builder:write`（persona 分支）
- `writeDistill` / `previewDistillWrite`（preload）
- Builder 自动写入路径（智能构建：预览后须确认）
- Builder 审阅后确认写入路径
- `life:applyMindHooks` 中调用的 Builder 观念写回（经 preview + commit）

业务层不得再对 Package 使用 `writeFile` / `appendFile` / `rename` / `unlink` 或通用路径写入函数完成 Builder 观念写入；必须经 PackageStore change set。

## 3. 明确不迁移（后续边界）

本任务**不**迁移：

- Life 全部写路径（含 `builder:write` 的 identity / `life.writeLifeBack`）；
- Policies 写路径；
- `package:load` scaffold；
- 离线 `distill-batch`、`consolidate*`、`clean-corruption`；
- MCP；
- 外部协作；
- `digital-me-package/**` 基线内容。

上述路径须继续如实标记为待迁移，不得在本任务顺带“一并做完”。

## 4. 数据契约

每次 Builder 观念写入必须保留：

- `dataKind`（`inference`）
- `actor`（`owner:builder`）
- `reason`
- `sourceRefs`（含材料来源标识/路径）
- 本次变更涉及的 Package 相对路径
- before revision / before hash（change set）
- `changeSetId`
- commit 后 `revision`
- `rollbackVersion`

候选 change set 带 `expiresAt`（默认 15 分钟）；过期拒绝提交。

## 5. 产品行为

1. **预览**：Package 字节不变；显示将修改路径、数据类别、来源与影响；允许放弃。
2. **确认**：必须由主进程在 `confirmed === true` 且未过期的 `changeSetId` 上 commit；renderer 不得直接提交任意路径或原始 ops。
3. **成功**：显示新 revision 与可恢复版本；失败不得显示成功。
4. **重启**：revision 与内容一致；可通过设置中的资料版本入口恢复。

## 6. 模块边界

- `src/builder/package-write.js`：`previewPersonaWrite` / `commitPersonaWrite` / `aggToOps`
- `src/builder.js`：`writeBack` 阻断直接写
- `src/main.js`：`builder:previewWrite`、`builder:write`（persona 仅 changeSet）
- preload/renderer：预览 → 确认 → 提交；展示版本与范围

## 7. 自动验证

`npm run test:p1-06`（`scripts/test-p1-06-builder-package-store.cjs`）覆盖：

1. preview 不改变 Package 字节  
2. 未确认不能写入  
3. 确认后只提交预览过的路径  
4. 写入产生新 revision  
5. sourceRefs / dataKind / actor / reason 正确  
6. 过期 changeSet 拒绝  
7. revision/hash 冲突拒绝  
8. commit 失败时旧版本保持不变  
9. 重启后 revision 与内容一致  
10. rollback 产生新 revision 并恢复内容  
11. Builder 不再直接写 Package  
12. P1-01～P1-05 全量回归  
13. Package 基线逐文件 SHA-256 不变  

## 8. Owner 沙盒验收（仅临时演示资料）

1. 创建临时演示资料；  
2. 提交一份测试材料；  
3. 启动 Builder；  
4. 确认预览阶段 Package 未变化；  
5. 确认写入后显示新 revision；  
6. 重启应用确认版本一致；  
7. 执行撤销/恢复；  
8. 确认恢复产生新 revision；  
9. 验证来源、数据类别和修改范围可见。  

## 9. 禁止事项

- 不顺带迁移 Life / Policies / MCP / 外部协作；  
- 不改动 `digital-me-package/**` 基线；  
- 不把模型蒸馏结果标为 `owner_assertion` 或 `fact`；  
- 不标记 `accepted` / `runtime_verified`，直至 Codex 复核与 Owner 沙盒通过。  

## 10. 验证命令

```powershell
cd digitalme-app
npm run test:p1-06
npm run test:p1-phase1
node --check src/builder.js
node --check src/main.js
node --check src/preload.js
node --check src/renderer/app.js
git diff --check
git status --short --branch
```
