# 任务包 DVL2-03：Owner 真机验收收口

| 项 | 值 |
|----|-----|
| 任务代号 | `DVL2-03` |
| 文档状态 | `owner_runtime_accepted` / `accepted_as_implemented` / `implemented` |
| 版本 | v0.1.0 |
| 验收日期 | 2026-07-27 |
| 基线分支 | `codex/dvl2-03-real-deliverable-generation` |
| 基线 HEAD | `1bef898742d88d4d45ce3e08fbd9cd819ae0cc3c` |
| 上位 | DVL2-00 v0.1.1 / DVL2-01 `accepted_as_implemented` / DVL2-02 `accepted_as_implemented` |
| 核心实现 | `7047113`（真实生成）、`1fcdfb0`（一键生成 UX）、`f64c38c`（接受后学习） |

> **正式边界**：DVL2-03 已实现并经 Owner 真机验收通过。验收范围为"从已确认计划→准备成果包→生成真实文件→版本/ArtifactRef/contentHash→接受/否定/重新生成→重启恢复→接受后学习回流"的完整用户主路径。**不等于**：全模态成果均已完善、完整执行引擎已完成、外部协作已完成、身份与协作已完成。冲突时：架构原则文 > DVL2-00 > DVL2-01 > DVL2-02 > 本文。

---

## 1. 实际实现范围

### 1.1 已实现能力

1. 从 `activeConfirmedVersionId` 绑定的确认计划启动真实成果生成；
2. 草稿、取消、失效计划不得进入生成；材料 stale 拦截到位；
3. 四类成果生成器：`document`、`presentation`、`webpage`、`image`；
4. 真实文件落盘到 `<userData>/deliverable-artifacts/...`，原子 temp+rename；
5. `DeliverableVersion`：版本号递增、`contentHash`（sha256）、`ArtifactRef`、`provenance`；
6. 重新生成创建新版本，旧版本标 `superseded`，不静默覆盖；
7. 用户面"接受此版本" / "不采用此版本" / "重新生成"动作；
8. 接受后触发自动学习（`deliverable-auto-learn.js`）；否定不触发正向学习；
9. 学习包含 evidence 核验、conflict detect、sensitive guard；
10. `confirmPlanAndGenerate` 一次点击：确认（如需）→ 准备 Package → 生成；
11. 正确传入 `packageDir`，Subject Context Engine 实际参与装配；
12. 材料 stale、claim posture、provenance 在一键路径不被绕过；
13. CRT 失败时以 `emptyReason` 明确降级，不伪造主体上下文；
14. 重启后从 store 恢复 Package、Version、接受状态，不重复生成；
15. Electron 两阶段验收通过（Phase A 生成 4 项 + Phase B 重启恢复/重新生成）。

### 1.2 支持的成果类型

| 类型 | 文件格式 | 可打开性 | 已知限制 |
|------|----------|----------|----------|
| `document` | `.md` + `.html` | 系统默认打开 | 不支持 `.docx`（未接 docx 引擎） |
| `presentation` | `.html`（含幻灯片结构） | 浏览器打开 | 不支持 `.pptx` |
| `webpage` | `.html` | 浏览器打开 | 单页；无服务端 |
| `image` | `.png`（mock 模式下） | 系统打开 | 真实图片依赖外部能力；不可用时准确失败 `image_capability_unavailable` |

### 1.3 明确不支持（不伪造）

- DOCX / PPTX / PDF / 视频 / 音频真实引擎；
- 多成果并行调度与复杂依赖；
- 对外发布或分享；
- 多主体协作成果。

---

## 2. 验收场景

| 场景 | 结果 | 证据 |
|------|------|------|
| A 文档真实生成 | 通过 | Electron Phase A：4 项 Deliverable 真实落盘；`.codex-qa/dvl2-03-generation-acceptance/two-phase-summary.json` |
| B 重启恢复 | 通过 | Electron Phase B：重启后 Package/Version 恢复一致；无重复生成 |
| C 接受成果 | 通过 | `test:dvl2-04-auto-learn` 6/6；accept 触发 learn job；版本 reviewStatus → accepted |
| D 否定成果 | 通过 | 否定后 reviewStatus → rejected；不触发正向学习；重启后否定状态保持 |
| E 重新生成 | 通过 | Phase B 验证新 versionId 创建（`dver_ms2vvixx_8a14b9bf`）；旧版本保留 `superseded` |
| F 失败不造假 | 通过 | `test:dvl2-03-generation` case "model failure does not create version"；失败时 store 标 `failed` |
| G 图片能力 | 通过（降级） | mock 模式真实落盘；不可用时返回 `image_capability_unavailable`，不创建伪图片 |
| H CRT 上下文 | 通过 | `test:crt-mvp-01.1` 验证 `packageDir` 贯通；SCE 实际被调用；empty 时明确 `emptyReason` |

---

## 3. 自动化测试汇总

| 命令 | 通过 | 失败 |
|------|-----:|-----:|
| `test:dvl2-03-generation` | 6 | 0 |
| `test:dvl2-03-one-click` | 6 | 0 |
| `test:dvl2-03-generation-acceptance` | 3（两阶段 + 总结） | 0 |
| `test:dvl2-04-auto-learn` | 6 | 0 |
| `test:dvl2-05-context-authority` | 10 | 0 |
| `test:crt-mvp-continuity` | 11 | 0 |
| `test:crt-mvp-01.1-package-dir` | 3 | 0 |
| `test:crt-mvp-02` | 20 | 0 |
| `test:crt-mvp-02.1` | 18 | 0 |
| `test:crt-mvp-02.2` | 18 | 0 |
| `test:act-behalf` | 4 | 0 |
| `test:dvl2-02-package` | 17 | 0 |

合计：**122 passed, 0 failed**。

---

## 4. 版本与 Provenance

每个生成的 `DeliverableVersion` 包含完整 provenance：
- `planVersion`：绑定 `sourcePlanVersionId`
- `subjectContextSnapshotId`：CRT assemblyId
- `contextClass`：情境分类
- `claimPostures`：`["confirmed","attributed","inferred","hypothetical"]`
- `sourceRefs`：task_goal + plan_version + reference_material
- `attachmentRefs`：带 evidenceKind / ownership
- `subjectRefs`：CRT 装配的 subject 资产引用
- `contentHash`：sha256
- `artifactRefs`：带 mimeType / byteSize / relativePath

---

## 5. 已知边界

1. 图片在无外部能力时仅能 mock 或准确失败；
2. DOCX / PPTX 引擎未实现；
3. 取消正在生成中的成果无专用 cancel IPC（状态枚举有 `cancelled`/`interrupted`，但产品面无主动取消按钮）；
4. `authorizationRefs` 为空数组（身份协作最小接线尚未到位）；
5. 本轮验收使用 `DIGITALME_ACT_BEHALF_FAKE=1`（模拟模型）；Owner 真机使用真实模型时体验一致但内容质量依赖模型能力。

---

## 6. Owner 验收结论

**DVL2-03 通过 Owner 真机验收**。

闭环已成立：确认计划 → 准备成果包 → 真实文件生成 → 版本/ArtifactRef/hash → 接受/否定/重新生成 → 重启恢复 → 接受后学习回流。

---

## 7. 后续任务不得倒灌回 DVL2-03 的事项

1. DOCX / PPTX / 真实图片引擎属于新任务；
2. 多成果并行调度属于新任务；
3. 身份协作语义（`authorizationRefs` 实质化）属于 `IDCOLLAB-MIN-01`；
4. 对外发布 / 分享属于第三闭环；
5. 重写 CRT 为完整 Cognitive Runtime 属于未来任务；
6. UI 重构至 renderer-next 属于 R3。

---

**文档结束**
