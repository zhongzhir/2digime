# Digital Me V2 — Artifact 采用与不采用

- **文档编号**：`DIGITALME-V2-ARTIFACT-ACCEPTANCE-AND-REJECTION-01`
- **版本**：v0.1（2026-08-04）
- **基线**：`v2/foundation` @ `11d32df`
- **状态**：`implemented_pending_commit`
- **不做**：Collaboration、信誉评分、整篇吸收、多级评分、新 Store、产品壳重排

---

## 1. 用户语义

| 动作 | 用户看到 | 含义 |
|------|----------|------|
| 未决定 | 尚未决定是否采用；可采用 / 不采用 | 可继续编辑、导出 |
| 采用 | 已采用 | 本次成果与做法可用于相关后续任务；非永久认可全部事实/风格 |
| 不采用 | 未采用 | 本次成果未被采用；非永久禁止；可不填原因 |
| 编辑后 | 回到未决定 | 旧采用状态不自动延续到新版本 |

可选填写一句说明；不强迫。失败时显示简短错误并允许重试，不得伪装成功。

---

## 2. 领域映射

| 用户动作 | 命令 | GrowthEvent |
|----------|------|-------------|
| 采用 | `subject.captureInput` + `sourceKind: artifact_acceptance` | `feedback_recorded` → 自动确认 → `experience_confirmed` |
| 不采用 | 同上 + `artifact_rejection` | 同上，标签 `decision:reject`（不进正向注入） |

锚定：`taskId` · `artifactId` · `artifactVersionId`（`payload.evidence.toVersionId`）· 时间 · 可选说明 · `requestedArtifactType`。

**不新建**：Acceptance / Feedback / Claims Store；第二套成果状态机；UI 长期布尔权威。

采用状态由已落盘事件 + 当前 `headVersionId` 派生，经 `artifact.getContent.ownerDecision` 投影。

---

## 3. 版本规则

1. 采用/不采用必须指向当时 head 版本。  
2. 同版本同决策重复点击：幂等，不新写事件。  
3. `artifact.saveEdit` / 修订成功后 head 变化 → 派生为未决定。  
4. 再次采用必须写入新版本的 evidence。

---

## 4. 复用与隔离

- 采用经验进入 confirmed 成长链；相关 goal / `document` 标签可被 ContextSnapshot 选中。  
- 不采用事件保留为负面记录；**不**作为正向「沿用经验」注入。  
- 无关任务（关键词不匹配）不选中该采用经验。  
- 重启后由事件重放恢复采用状态。

---

## 5. CommandBus

仍为 20 条。采用/不采用复用 `subject.captureInput`，扩展可选 `artifactVersionId` / `requestedArtifactType`，不新增命令。

---

## 6. 验收证据

```text
npm run accept:artifact-feedback
```

覆盖：可采用/不采用、不强制原因、同版本幂等、编辑重置、新版本再采用、失败不伪装、重启恢复、相关复用、无关隔离、对话不建 Task、无内部术语。

配套：`src/subject-core/tests/artifact-decision.test.ts`、Electron 脚本。

---

## 7. 已知后置项

- 不采用作为「同类任务负面证据」的更细注入策略（本轮仅排除正向注入）  
- 复杂自动总结 / 多级质量评分  
- Collaboration MVP（下一块）  
- Artifact 采用经验的用户面「使用了什么」克制展示增强  
