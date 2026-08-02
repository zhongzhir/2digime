# MVP-OWNER-INSTALL-BLOCKER-01 · 报告

- **状态**：`root_cause_fixed` / `owner_like_repro_validated` / `new_portable_rebuild_required` / `not_pushed`
- **日期**：2026-08-02
- **基线**：`144d0d78222f92ebba9086939249ac6c5e1a23c5`
- **旧候选**：`20260802-184853-144d0d7` → `rejected_owner_acceptance_failed`

## 真实根因

1. **主因**：`normalizeReferenceMaterials` 截断正文后仍把**截断前**的 `charCount` /（或旧）`contentHash` 写入材料元数据。`planningMaterialsDigest` 含 `charCount`，导致：
   - 规划时 digest = D1
   - 「开始做」后再次 persist 同材料 → digest 变为 D2
   - `materialsStale=true`
   - `confirmPlanAndGenerate` **只看粘滞 flag**，即使之后 digests 已重新对齐仍拒绝生成
2. **表现**：用户面被吞成「暂时无法开始这项工作…」；任务卡把 `draft` 也标成「进行中」
3. **次因**：文件夹材料原先只摘录 md/txt/json/csv，Owner 的 23 文件文件夹几乎无正文摘录（不单独阻断启动，但削弱材料）

Owner 现场任务 `abt_msbp6c0d_c1811f`：`materialsStale=true` 且 `plannedDigest === currentDigest`（粘滞假阳性）。已本地 heal（保留 `.owner-blocker-preheal.bak`）。

## 修复内容

- `deliverable-context.js`：截断后 `charCount`/`contentHash` 一律对应当前持久化正文（digest 幂等）
- `deliverable-confirm-and-generate.js` / `deliverable-generation.js`：digests 一致时清除粘滞 stale，不再误拦
- `main.js`：文件夹摘录支持 docx/pdf/pptx；单文件失败跳过
- `app.js`：draft/无 package 显示「待开始/待重新开始」；`plan_materials_stale` 可行动提示

## 验证

- Owner 同款 pptx + 23 文件文件夹 + 1000 字通稿：生成 / 打开 / 采用 / 恢复通过
- 专项 + 01C/01D/质量回归：通过

## Store / IPC / 知识源增量

**0 / 0 / 0**
