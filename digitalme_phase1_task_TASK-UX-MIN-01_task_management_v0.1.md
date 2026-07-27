# Digital Me Phase 1 Task — TASK-UX-MIN-01

**任务编号**：TASK-UX-MIN-01
**标题**：做事任务管理最小闭环
**版本**：v0.1.1
**状态**：`task_management_minimal_loop_validated` / `owner_runtime_accepted` / `accepted_as_implemented`
**质量状态**：`functional_minimum_accepted` / `visual_and_interaction_quality_deferred`
**Owner 真机验收**：2026-07-27
**分支**：`codex/task-ux-min-01-task-management`
**基线**：`989a185`（DVL2-03-FIX-01 文档收口）
**实现提交**：`e6ab2eb` + `87b2e19` + `9b9e051`

---

## 1. 范围

改名、归档、已归档列表、恢复、删除、搜索、固定高度列表与分批加载（每批 20 条）。**不得**扩展为复杂项目管理系统。

## 2. 数据语义

- **权威存储**：`<userData>/act-behalf-tasks.json`（`task-store.js`）
- **归档**：可逆；`lifecycleStatus=archived` + `archivedAt`；不删 plan/package/artifact 文件
- **删除**：软删除；`lifecycleStatus=soft_deleted` + `deletedAt`；落盘成果文件保留
- **生成中保护**：归档/删除前检查 active package 生成状态

## 3. Owner 真机验收结论（2026-07-27）

**已通过**：

- 列表内部滚动；20 条以上继续加载
- 搜索标题和目标；当前/已归档搜索隔离
- 改名持久化；归档；恢复；重启后状态保持
- 删除二次确认；生成中**删除**保护
- 当前任务归档/删除后的安全回退

**未完成 Owner 真机补验（非阻断回归项）**：

- 删除后成果文件保留
- 生成中不能**归档**

上述两项不影响本轮 `accepted_as_implemented`。

## 4. UI/UX 债务

Owner 判断：功能最小闭环已接受；美观度与交互质量不足；**不继续局部补丁**。后续整体升级见 **UI-UX-FOUNDATION-UPGRADE**（`digitalme_context.md` §3.3）。

**不得**标：`design_completed` / `ux_completed` / `visual_accepted`

## 5. 测试

```bash
npm run test:task-ux-min-01
```

回归：`test:act-behalf`、`test:idcollab-min-01`、`test:dvl2-03-one-click` 全绿。

## 6. 状态

```text
task_management_minimal_loop_validated /
owner_runtime_accepted /
accepted_as_implemented /
functional_minimum_accepted /
visual_and_interaction_quality_deferred
```
