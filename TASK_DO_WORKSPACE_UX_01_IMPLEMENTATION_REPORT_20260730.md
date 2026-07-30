# TASK-DO-WORKSPACE-UX-01 实施报告

- **日期**：2026-07-30
- **任务**：`TASK-DO-WORKSPACE-UX-01`
- **Push**：否

---

## 1. Git 基线

| 项 | 值 |
|----|-----|
| 起始分支 | `codex/mvp-release-gate-01` |
| 起始 HEAD | `a9afad3ad240ef7d7f0c242ba482d1e49d23cf96` |
| 最终 HEAD | 以分支 tip 为准（见 commits） |
| Push | **未 push** |

### 调用链核对（实施前）

**创建链**：Hub → `#btn-do-new-task` → `#act-request` / materials →（旧）`planGenerate` → `confirmPlanAndGenerate`。  
**成果链**：Generation → DeliverableVersion → ArtifactRef 落盘；UI 原仅元数据；File 菜单 `openPrimaryForSelection`。  
**修改链**：有 regenerate，无用户修订自然语言字段。

「开始做」一次点击后后台顺序：`planGenerate`（含建 Task）→ `confirmPlanAndGenerate`（confirm + prepare + generate）。

---

## 2. 用户主路径

```text
做事 → 新建任务
→ 描述你希望完成的工作（大编辑器，自动增高）
→ 任务材料（添加文件 / 添加文件夹）
→ 开始做
→ 正在完成这项工作……
→ 页面展示成果正文
→ 继续修改 → 发送修改 → 新版本
→ 采用结果 / 打开本地文件
```

标题：从任务要求前部自动生成；创建后可在「任务名称」改名。

---

## 3. 删除或默认隐藏的用户面

| 项 | 处理 |
|----|------|
| 首屏任务标题必填 | 删除为默认；改名为折叠行 |
| 本次角色 / 期望成果 / 更多意图 | 默认 UI 删除（hidden 兼容字段） |
| 形成预计交付 / 保存草稿 / 生成成果（主路径） | 默认隐藏；逻辑保留 |
| 预计交付 / 任务理解 / 交付项 | 默认 `hidden` |
| 任务列表大段 requestPreview / 已确认上下文 | 压缩为 标题 + 状态 + 时间 |
| 成果卡重复打开双轨 | 不恢复；页内单一打开 |

---

## 4. 底层对象复用

| 页面状态 | 来源 |
|----------|------|
| 输入 | Task.goal / referenceMaterials |
| 执行 | Plan + GenerationAttempt（不展示 ID） |
| 成果 | Deliverable.currentVersionId → ArtifactRef |
| 修改 | generateOneDeliverable(+ revisionGuidance 瞬时入参) |
| 采用 | reviewDeliverableVersion(accepted) → 学习链 |
| 打开 | 同一 `resolveOpenableArtifact` |

---

## 5. 页面成果

- 读取：`actBehalf:getArtifactContent` → `readArtifactContent`（仅 store ID）
- 权威：ArtifactRef.relativePath 落盘文件
- 无第二成果 Store；不把正文写入 Task
- 重启：打开任务 → `refreshActGenerationPanel` → `presentActWorkspaceResult`

---

## 6. 继续修改

- 要求：`#act-revision-request`（UI）
- 传入：`revisionGuidance`（IPC 瞬时，非永久字段）
- 生成：新 DeliverableVersion；旧版本保留
- 采用作用于当前 `workspacePrimary.versionId`

---

## 7. 本地文件

- 页面：`actBehalf:openLocalArtifact` → `openArtifactSecure`
- File 菜单：仍 `openPrimaryForSelection` → 同一 `resolveOpenableArtifact`
- 未恢复 `actBehalfOpenArtifact` / reveal 双 API / path 注入

---

## 8. 任务材料

- UI：「任务材料」；底层仍 `referenceMaterials`
- 文件：抽取正文；文件夹：有界列表 + 少量文本摘录进生成上下文
- 不进入主体资产；仅 Task 材料

---

## 9. Electron 证据

目录：`digitalme-app/scripts/_task-do-workspace-ux-01-evidence/`  
代表跑次含：`01-task-input`、`02-long-requirement`、`03-after-start`、`04-in-page-result`、`summary.json`。

---

## 10. 复杂度报告

```text
新增 DOM：#act-workspace-* / #btn-act-start-do / 结果与修改区
删除 DOM：默认可见的角色/期望/计划主路径（保留隐藏兼容钩子）
新增 listener：开始做 / 停止 / 发送修改 / 采用 / 打开本地 / 请求自动增高
删除 listener：无（旧 open 双轨未恢复）
新增 IPC：actBehalf:getArtifactContent、actBehalf:openLocalArtifact（=2）
删除 IPC：0
新增永久字段：0
停止写入字段：0
新增 Store：0
删除 Store：0
代码行净变化：约 +1.5k / −0.3k（含测试）
是否产生第二成果事实源：否
是否恢复旧 open 双轨：否
```

---

## 11. 未处理事项

| 归入 | 事项 |
|------|------|
| 01D | generation interrupt 可靠 heal、`.bak`、数据安全 |
| 01E | 学习内容事件化修复、四导航最终 UX、成果访问完整产品化 |
| 后续 | 富文本直接编辑、完整版本对比、品牌视觉系统 |

---

## 12. 状态建议

```text
implemented /
task_workspace_main_path_rebuilt /
task_requirements_promoted /
task_materials_first_class /
single_start_action_validated /
in_page_deliverable_presented /
revision_loop_validated /
single_artifact_resolver_validated /
restart_workspace_recovery_validated /
formal_classic_runtime_validated /
ready_for_mvp_release_gate_01d /
not_pushed
```
