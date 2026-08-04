# Digital Me V2 — 主体产品语义与 MVP 合同

- 文档编号：`DIGITALME-V2-SUBJECT-PRODUCT-SEMANTICS-AND-MVP-CONTRACT`
- 版本：v0.1.1（2026-08-04）
- 基线：`v2/foundation`（SUBJECT-MVP-01 + 产品入口修正）
- 状态：`accepted_as_engineered_candidate`（工程验收候选；待 Owner 主路径验收）
- 范围：审计 + 规格 + **产品入口修正**（不改底层架构对象）
- 上位：`docs/v2/digitalme_v2_domain_model.md`、`digitalme_subject_architecture_and_rd_principles_v0.1.md`

---

## 0. 合同结论

```text
B. minimal_compatible_extension_required
```

现有 **SubjectPackage + GrowthEvent 追加流 + 可重建派生视图 + Task/Job/ContextSnapshot** 足以承载「构建 → 使用 → 纠正 → 成长 → 再使用」的骨架，**无需主体合同重设计**，也**不得**为七类内容各建平行 Store。

但当前实现距离主体 MVP 产品语义仍有最小缺口：注入可追溯性未落地、非「经验」类主体内容未进入任务注入、确认动作过度泛化为 `experience_confirmed`、否定/替换/缺口缺乏表达、材料→候选构建入口缺失。

---

## 1. 当前对象与链路事实（a63b177）

### 1.1 对象职责（已实现）

| 对象 | 权威职责 | 持久位置 |
|------|----------|----------|
| SubjectPackage | 包身份壳 + 分区布局 | `manifest.json`（无 rootDir）+ `growth/` + `materials/` + `derived/` + `runtime/` |
| GrowthEvent | 主体知识唯一进入方式；追加不可变 | `growth/events.ndjson` |
| ContextSnapshot | Job 材料不可变快照 | `runtime/snapshots/` |
| SubjectService | 单实例挂载 active 包；派生重建 | 内存 + 包内文件 |
| JobRunner | 构建 Snapshot → 选主体上下文 → Adapter | 运行时 |
| ArtifactWorkspace | 用户编辑 → `feedback_recorded` candidate | Artifact 版本 + GrowthEvent |

### 1.2 数据链逐步审计

| 步骤 | 当前入口 | 当前对象 | 持久化 | 状态语义 | 缺失 | 可复用 | 最小调整？ |
|------|----------|----------|--------|----------|------|--------|-----------|
| 创建数字之我 | IPC `subject.createPackage` | SubjectPackage | manifest + 空 events + materials/derived | active 挂载 | 无自我说明入口；无生命周期态 | 创建/打开/迁移已稳 | 否（流程层补入口即可） |
| 用户材料进入 | Task `contextRefs`；包内 `materials/` 仅目录 | SnapshotItem / 文件 | Task 材料进 Snapshot；`materials/` **无产品写入 API** | 任务材料 ≠ 主体资料 | 自我说明/项目资料入库并产候选 | Snapshot 摄取、敏感跳过 | **是**：材料入库 + 候选提炼入口 |
| 候选主体信息形成 | Artifact 编辑 → `recordFeedbackCandidate`；测试用 `appendOwnerEvent` | GrowthEvent `feedback_recorded` candidate | events.ndjson | candidate 不注入 | 从自我说明/资料形成身份/方向/原则/边界候选 | diff-evidence、tags、evidence 锚点 | **是**：候选来源扩展（仍写 GrowthEvent） |
| 用户确认 | `subject.confirmExperience` | 追加 `experience_confirmed`（`confirms` 指回） | events.ndjson | 确认=追加，不改历史 | 一律变成 experience；无拒绝/修改语义 | confirm 追加模式 | **是**：确认保留语义类型 |
| confirmed 落入权威链 | PackageGrowthLog.append | GrowthEvent confirmed | events.ndjson | 权威=事件流 | 身份仍主要在 manifest.displayName | deriveAllViews | 小：身份澄清走事件 |
| 创建 Task | `submitTask` | Task | runtime/tasks | 纯意图 | — | 已正确 | 否 |
| Snapshot 固化主体切片 | ContextSnapshotBuilder | ContextSnapshot | runtime/snapshots | **材料**冻结 | **`subjectContextRef` 从未写入**；无法从 Snapshot 证明注入了哪些主体信息 | 字段已预留 | **是：写入冻结引用** |
| Adapter 消费 | `adapter.execute({ subjectContext })` | ConfirmedExperienceView | 运行态传入 | 仅 confirmed 经验条目 | goals/preferences/boundaries/assets **不注入**（边界仅过滤） | prompt「已确认经验」块 | **是：选择集扩展** |
| Artifact 体现主体差异 | Fake/OpenAI/code-analysis | Artifact | runtime/artifacts | 依赖模型是否遵守 | 无强制「已应用主体」可核对门（文档能力弱） | code-analysis APPLIED_EXPERIENCE 痕迹可借鉴 | 验收层约束即可 |
| 用户修改 | `artifact.saveEdit` | ArtifactVersion user | artifact + content | head 移动 | — | 已实现 | 否 |
| GrowthEvent candidate | `feedback_recorded` | GrowthEvent | events.ndjson | candidate | 非编辑类纠正（口头否定）无入口 | evidence 锚点 | 小：owner 纠正事件 |
| 再确认 | confirmExperience | experience_confirmed | events.ndjson | — | 同上过泛 | — | 同确认语义调整 |
| 第二次任务复用 | selectConfirmedExperiences | 派生 confirmed | 运行时选中子集 | 关键词/标签匹配；排除边界标签 | 选择理由不落盘；无关任务靠 score>0 防污染（弱） | selector + boundaries | Snapshot 固化选中集；可选加强选择策略 |

**关键事实**：全仓库无 `subjectContextRef =` 赋值。主体注入发生在 Job 运行期，**未**冻结进 Snapshot → 审计链在「材料」层完整、在「主体切片」层断裂。

---

## 2. 七类主体内容映射

不得为每类新增永久字段/Store。映射原则：**manifest 仅轻量身份壳；权威内容进 GrowthEvent；任务可见内容经派生 + 选择后注入，并由 Snapshot 引用冻结。**

### 2.1 我是谁（identity）

| 项 | 结论 |
|----|------|
| 现有承载 | `SubjectPackage.identity.displayName`（+ 可选 description）；**无**专用身份事件 |
| 权威来源 | 今日：manifest；目标：显示名可留 manifest，澄清说明进 GrowthEvent |
| 需确认 | **C**：身份澄清必须确认后进权威链 |
| 运行时选择/注入 | 今日几乎不注入（仅 displayName 用于协作模拟） |
| 证明被使用 | 今日无法从 Snapshot 证明 |
| 纠正 | 无追加式「替换身份」语义；改 manifest 会成第二写法 |
| 污染 | 低（未注入） |
| 重启恢复 | openPackage 读 manifest |

**最小调整**：新增/使用事件类型表达身份澄清（见 §3）；manifest 仅保留创建时显示名种子，不以手改 manifest 作为成长路径。

### 2.2 我正在走向哪里（direction / goal）

| 项 | 结论 |
|----|------|
| 现有承载 | `goal_updated` → GoalsView |
| 权威来源 | confirmed `goal_updated` 事件 |
| 需确认 | **C**（长期方向） |
| 运行时 | **派生有、注入无** |
| 证明使用 | 无 |
| 纠正 | 可再追加新 `goal_updated`；缺「取代旧目标」链接 |
| 污染 | 若全量注入则高；需选择 |
| 重启 | 事件重放 |

### 2.3 我如何判断（decision principle）

| 项 | 结论 |
|----|------|
| 现有承载 | 可勉强用 `preference_observed` / `experience_confirmed` + tags；**无原则专用类型** |
| 权威来源 | 应走 GrowthEvent |
| 需确认 | **C** |
| 运行时 | 未单独建模/注入 |
| 证明/纠正/污染/恢复 | 同经验路径缺口 |

### 2.4 我能做什么（capability evidence）

| 项 | 结论 |
|----|------|
| 现有承载 | `asset_added` → AssetsView；CapabilityRegistration 是系统能力非主体能力叙事 |
| 权威来源 | confirmed `asset_added` / 带 evidence 的经验 |
| 需确认 | **B/C** 视风险；高风险宣称入 C |
| 运行时 | 未注入 |
| 说明 | 不与系统 Adapter 白名单混为一谈 |

### 2.5 我不愿做什么（boundary）

| 项 | 结论 |
|----|------|
| 现有承载 | `boundary_updated` → excludedTags；selector 过滤 |
| 权威来源 | confirmed boundary 事件 |
| 需确认 | **C** |
| 运行时 | **仅作过滤，不作为正面注入文本** |
| 证明 | 未选中条目无记录 |
| 纠正 | 可追加；缺撤销边界的显式事件 |
| 污染 | 设计上用于防污染 |

### 2.6 我从实践中学到了什么（confirmed experience）

| 项 | 结论 |
|----|------|
| 现有承载 | `feedback_recorded` → confirm → `experience_confirmed` → ConfirmedExperienceView → selector → Adapter |
| 权威来源 | GrowthEvent |
| 需确认 | **C**（实践经验进权威前） |
| 运行时 | **唯一真正注入的主体内容** |
| 证明 | 依赖 Adapter 自觉；Snapshot 无主体切片 |
| 纠正 | 再编辑再确认；无「否定该经验」 |
| 污染 | selector score>0 + 边界标签 |
| 重启 | 事件 + 派生 |

### 2.7 系统还需要了解什么（knowledge gap）

| 项 | 结论 |
|----|------|
| 现有承载 | **无**；prompt 仅要求模型「写出缺口」但不落主体 |
| 权威来源 | 应候选事件，默认不注入任务上下文 |
| 需确认 | **A/B**：可展示为待了解，不进 confirmed 注入集 |
| 运行时 | 不注入（避免幻觉权威） |

---

## 3. GrowthEvent 语义审计

### 3.1 现有类型覆盖度

| 产品语义 | 现有类型 | 是否足够 |
|----------|----------|----------|
| identity clarification | 无专用；manifest 旁路 | **不足** |
| direction / goal | `goal_updated` | 类型够；确认/取代链弱 |
| decision principle | 无专用 | **不足**（勿全部塞进 experience） |
| capability evidence | `asset_added` / 经验+evidence | 基本够 |
| boundary | `boundary_updated` | 类型够；撤销弱 |
| confirmed experience | `feedback_recorded` + `experience_confirmed` | 实践闭环够 |
| user correction | 仅再编辑/再确认 | **不足**（否定、替换） |
| knowledge gap | 无 | **不足** |

### 3.2 关键判断（对应任务 §四）

1. **可否仅靠 type + payload，不增平行 Store？**  
   **可以。** 七类内容用封闭 type + `payload.tags` / 可选 `payload.relation`（见下）表达即可。

2. **candidate / confirmed 是否清楚？**  
   **字段清楚**（`confidence`）。但候选列表派生**只收录** `feedback_recorded` candidate；其他类型 candidate 不会进入待确认队列。确认 API 名称与实现均偏向「经验」。

3. **否定、替换、过期、冲突？**  
   **当前不能干净表达。** 只有追加；`confirms` 仅表示确认候选。缺少：  
   - 拒绝候选（可派生为「已关闭」而不进 confirmed）  
   - 取代（`supersedes` 指回旧 confirmed id）  
   - 过期/冲突标记  

4. **是否需要最小新事件类型？**  
   **需要，但极少：**  
   - `identity_clarified`（身份澄清）  
   - `principle_stated`（重大判断原则）  
   - `knowledge_gap_noted`（待了解；默认不注入）  
   - `subject_corrected`（用户否定/替换已确认项；payload 指回 `targetEventId`，`tags` 含 `action:reject|replace`）  
   现有 `preference_observed` / `goal_updated` / `boundary_updated` / `asset_added` / `feedback_recorded` / `experience_confirmed` **保留**。

5. **派生视图可否完全从事件流重建？**  
   **可以**（`deriveAllViews` + wipeDerivedCache 测试已覆盖）。扩展类型后同步扩展派生即可，**不得**把派生当权威。

6. **`experience_confirmed` 是否过度泛化？**  
   **是。** `confirmCandidate()` 无视原 candidate.type，一律输出 `experience_confirmed`。导致偏好/目标/边界候选若走同一确认 API，会被错误记为「经验」。

7. **基础信息与实践经验是否需要不同确认语义？**  
   **需要。**  
   - 实践经验：candidate=`feedback_recorded` → confirmed=`experience_confirmed`（保持）  
   - 基础信息（身份/方向/原则/边界）：candidate=对应 type + confidence=candidate → confirmed=**同 type** + confidence=confirmed（`confirms` 指回）  
   用户文案统一为「确认」；内部不得把一切叫作经验。

### 3.3 payload 最小兼容扩展（不改 Store）

在现有 `title/detail/tags/evidence` 上可选增加（向后兼容）：

```text
payload.relation?: {
  supersedes?: string       // 取代的旧 confirmed eventId
  targetEventId?: string    // 纠正/拒绝目标
  materialRef?: string      // materials/ 内相对路径或 Snapshot item digest
}
```

未识别字段忽略；旧事件仍可读。

---

## 4. SubjectPackage 语义审计

### 4.1 应保持的结构

```text
轻量 manifest
+ materials/
+ immutable GrowthEvent log
+ rebuildable derived views
+ runtime/（tasks/jobs/snapshots/artifacts）
```

**结论：保持。** 这与领域模型 §2.1 一致，适合主体 MVP。

### 4.2 扩展候选项裁决

| 候选项 | 现有能否承载 | 权威？ | 可派生？ | 仅运行态？ | 第二事实源风险 | 裁决 |
|--------|--------------|--------|----------|------------|----------------|------|
| subject lifecycle state | open/create 即用；无「草稿主体」 | 若落盘则权威 | 可由「是否存在 C 类 confirmed」派生 readiness | 优先运行态/派生 | 高（若另存 status） | **派生 `subjectReadiness`，不进 manifest** |
| schemaVersion adjustment | 已有 =1 | 是 | 否 | 否 | 低 | **仅在不兼容时 +1；本 MVP 尽量保持 1** |
| material/source references | materials/ 空转 | 文件+可选 asset/gap 事件 | 索引可派生 | 否 | 中（若另建 materials DB） | **文件落 materials/ + 事件引用路径** |
| active subject selection | SubjectService 单 active | 运行态 | 否 | **是** | 低 | **保持运行态，不进包** |
| derived subject summary | 无 | 否 | **是** | 缓存 | 低（可 wipe） | **派生摘要，供 UI 一句话** |
| candidate review queue | candidates.json 派生 | 否 | **是** | 否 | 低 | **扩展派生队列（多类型 candidate）** |

### 4.3 身份壳纪律

- `identity.displayName`：创建时必填种子，可迁移打开展示。  
- **禁止**把长期身份叙事、原则、边界写进 manifest 作为成长主路径。  
- description 若保留，只作非权威缓存或废弃；权威身份澄清走 `identity_clarified`。

---

## 5. ContextSnapshot 语义审计

### 5.1 今日能证明什么

| 问题 | 今日 |
|------|------|
| 用了哪些主体信息 | **不能**（运行期传入 Adapter，未冻结） |
| 为何选择 | **不能** |
| 哪些未注入 | **不能** |
| 来自哪些 confirmed events / materials | 材料：items + digest；主体 events：**不能** |

`subjectContextRef?: string` **已预留且从未赋值** → 优先复用，**禁止**新建「主体使用日志 Store」。

### 5.2 最小增强（复用 subjectContextRef）

在 Job 选定 `subjectContext` 之后、Adapter 调用之前（或与 Snapshot 构建同事务点）：

1. 将下列 JSON 写入 ContentStore（或 snapshot 旁内容引用）：  
   - `selectedEventIds: string[]`  
   - `entries`（实际注入的 title/detail/tags 截断后副本）  
   - `selectionReason`: 封闭枚举摘要，如 `keyword_match` / `goal_tag` / `boundary_exclude` / `identity_core` / `manual_none`  
   - `excludedEventIds`（因边界或分数未选，可限长）  
   - `subjectContextDigest`（对 selected 规范化序列的 hash）  
2. 把存储 ref 写入 **`ContextSnapshot.subjectContextRef`**。  
3. Adapter 仍接收内存中的 `subjectContext`；审计以 Snapshot 为准。

**不**把完整 GrowthEvent 日志复制进 Snapshot。

---

## 6. 最小主体构建流程（产品语义，非线框）

```text
创建数字之我（显示名）
→ 提供一段自我说明（自然语言）
→ 添加项目或资料（入 materials/ 或本次任务材料）
→ 系统形成主体候选（GrowthEvent candidates）
→ 仅展示需要确认的关键内容（C 类；A/B 不打断）
→ 用户确认或修改（修改=编辑候选文案后确认，或拒绝）
→ 主体可用于任务（readiness 派生为 usable）
```

用户面禁止出现：GrowthEvent、Snapshot、candidate、confirmed、eventId 等内部词。  
用词建议：「待确认的要点」「已了解的内容」「还不清楚的问题」。

---

## 7. 风险分级与确认规则

| 级 | 含义 | 示例 | 权威链 | 任务注入 |
|----|------|------|--------|----------|
| **A** | 可直接派生，不要求确认 | 资料文件名列表、语言分布、待了解问题草稿 | 不进 confirmed；或仅 gap candidate | **不注入**为权威指令 |
| **B** | 可暂时使用，允许后续纠正 | 弱风格偏好、低风险措辞习惯 | 可 confirmed 或「临时采用」标记（若做，必须仍是事件） | 可注入但优先级低于 C |
| **C** | 必须确认后才能进权威链 | **身份、长期方向、重大判断原则、明确边界、高风险偏好、明显冲突内容** | 仅 confirmed | 可注入 |

**C 类默认**：未确认 = 不注入。  
**冲突**：同时存在互斥 C 类 confirmed 时，新确认必须带 `supersedes` 或先 `subject_corrected`；否则派生标记冲突且**拒绝自动注入冲突集**（保守）。

禁止：复杂表单、逐字段配置、一次性补全全部主体信息。

---

## 8. 最小兼容调整

| 调整 | 原因 | 权威/派生/运行态 | 是否破坏兼容 | 测试证明 |
|------|------|------------------|--------------|----------|
| 写入并读取 `ContextSnapshot.subjectContextRef`（冻结选中主体切片） | 证明本次实际使用的主体信息 | 运行态产物挂在已有 Snapshot 字段 | 否（可选字段） | 构建 Job 后 Snapshot 含 ref；内容含 selectedEventIds |
| 确认 API：按 candidate.type 生成对应 confirmed（实践仍 → `experience_confirmed`） | 停止把一切确认为经验 | 权威事件语义修正 | 旧数据仍可读；新确认更准确 | 确认 goal/boundary 候选后派生进 goals/boundaries 而非仅 confirmed experience |
| 候选队列派生扩展：含 identity/goal/principle/boundary candidates | 构建期可确认 C 类 | 派生 | 否 | wipe derived 后队列仍从事件重建 |
| 最小新类型：`identity_clarified` / `principle_stated` / `knowledge_gap_noted` / `subject_corrected` | 七类语义不可全塞进经验 | 权威=事件 | 否（联合类型扩展） | 派生与选择单测 |
| 注入集扩展：除经验外，纳入已确认身份/方向/原则摘要 + 边界（过滤+短声明） | 「使用数字之我」必须可见非经验主体 | 运行态选择；权威仍事件 | 否 | Task1 Artifact 含可观察主体痕迹；Task3 无污染 |
| selector 输出附带 `selectionReason` 并写入冻结切片 | 可审计「为何选」 | 运行态/快照 | 否 | Snapshot 冻结 JSON 含 reason |
| `payload.relation` 可选字段 | 取代/纠正/材料引用 | 权威事件载荷 | 否 | corrected 后旧条目不注入 |
| materials 入库命令（复制到 `materials/` + 可选 `asset_added`/`knowledge_gap` 候选） | 构建链路入口 | 文件权威 + 事件 | 否 | 包内可见文件且事件可指路径 |
| 派生 `subjectReadiness` | 无需 manifest 生命周期字段 | **派生** | 否 | 无 C 确认时不可「当作已建好」夸张宣称 |

**明确不做（本切片）**：新 Store；manifest 堆七类字段；UI 内部术语；完整冲突解决引擎；多主体切换产品化。

---

## 9. 主体 MVP 验收场景（双任务 + 无关任务）

### 场景设定（示例）

- 主体自我说明含：本地优先、正式语气写周报、不讨论未公开融资。  
- C 类确认：身份要点、长期方向「本地优先」、边界「不写融资」。  

### Task 1（相关）

- 目标：撰写产品周报。  
- **期望**：Artifact 明显体现正式语气 / 本地优先等已确认主体信息。  
- **证明**：对应 Job 的 Snapshot.`subjectContextRef` 含相关 `selectedEventIds`；正文可观察差异（相对无主体基线）。

### 用户纠正

- 用户修改 Artifact（例如改成更短句、去掉某套话）。  
- 系统产生 candidate（不注入）。  
- 用户确认 → 新 `experience_confirmed`（带 evidence）。  
- **期望**：candidate 确认前二次提交不得把它当 confirmed 注入。

### Task 2（相似）

- 再写一篇产品周报。  
- **期望**：确认后的成长产生可观察差异（相对 Task1 或相对未确认对照）。  
- Snapshot 可追溯到新 eventId。

### Task 3（无关）

- 目标：例如「整理购物清单」或明显无关任务。  
- **期望**：不注入周报经验/正式语气等无关主体切片；无实质污染。

### 同时验证

| 项 | 断言 |
|----|------|
| ContextSnapshot 可追溯 | `subjectContextRef` 可解出 selectedEventIds 与 digest |
| 重启恢复 | 进程重启 / openPackage 后 derived 与注入行为一致 |
| candidate 门禁 | 未确认不得出现在 Adapter subjectContext |
| derived 可重建 | 删除 `derived/` 后 rebuild 与事件一致 |
| 无第二主体事实源 | 无平行 profile/memory Store；手改 derived 不生效 |

---

## 10. 明确不做事项

- 不为七类内容各建 Store 或七套表单。  
- 不把 GrowthEvent/Snapshot 术语暴露给用户。  
- 不在本步骤实现 UI 或提交代码。  
- 不宣称 apply/commit 工程闭环与主体 MVP 绑定。  
- 不把 CapabilityRegistration / Coding Agent 当作「我能做什么」的主体叙事权威。  
- 不启动主体编码，直至本规格 `owner` 确认结论 B 与最小调整表。

---

## 11. 可直接执行的下一实现切片

建议任务名：`DIGITALME-V2-SUBJECT-MVP-01`（需另开授权）

**顺序（单切片内可再拆 PR，但语义一体）：**

1. **Snapshot 主体切片冻结**：实现 `subjectContextRef` 写入/读取（无新 Store）。  
2. **确认语义修正**：`confirmCandidate` / `confirmExperience` 按类型确认；候选队列含 C 类非经验候选。  
3. **最小事件类型 + relation 字段** + 派生扩展（含 readiness / gap）。  
4. **注入选择扩展**：身份/方向/原则摘要 + 经验；边界过滤；理由写入冻结切片。  
5. **材料入库最小命令**（无复杂 UI 也可先 IPC/脚本）。  
6. **自动化验收**：§9 三任务 + 重启 + wipe derived；禁止内部术语泄漏测试。

**入口纪律（已修正）**：见 §12。默认主路径「一句话即可开始 → 使用中逐步成长」；无新确认点除非对应 C 类新决策。

---

## 12. 产品入口修正（SUBJECT-MVP-01 补丁）

底层仍保持 **SubjectPackage + GrowthEvent + ContextSnapshot**，不新增平行 Store。产品验收以「一句话即可开始，使用中逐步成长」为准。

### 12.1 最低门槛

```text
一句话 → 创建 SubjectPackage → 保存来源 → 生成少量候选 → 立即进入对话或做事
```

- `createPackage.initialSelfDescription` 可选；最短允许一句话。
- `subjectReadiness` **仅为派生提示**；`readinessBlocksTasks` 恒为 `false`，不得阻断 Task 创建与执行。

### 12.2 扩大候选来源

服务合同 `subject.captureInput` 的 `sourceKind` 必须允许：

```text
initial_self_description | imported_material | conversation | task_requirement
artifact_edit | artifact_acceptance | artifact_rejection | repeated_correction | explicit_boundary
```

不得把候选来源限定为专门主体表单或仅材料导入。本切片可用显式测试调用模拟提炼，不要求完整自动蒸馏管线。

### 12.3 低打扰确认

仅在 C 类触发建议确认：重大身份、长期方向、重大判断原则、明确边界、高风险偏好、冲突或低置信信息。  
低风险可保持未确认语义，不得冒充已确认权威；不新建 provisional Store。

### 12.4 使用即构建与可感知成长

主体构建不是一次性 onboarding，而是对话、做事、成果修改与采用过程中的持续行为。验收必须覆盖：

1. 只有一句自我说明也能完成 Task 并生成 Artifact；  
2. 第一次任务中用户明确说明偏好 → 修改并确认 → 第二次相似任务无需再说明且可观察差异；  
3. 未确认内容不进入长期权威注入；已确认在相关任务复用；无关任务不污染。

### 12.5 用户面用语（后续 UI 统一）

| 使用 | 禁止 |
|------|------|
| 现在的我 | GrowthEvent / candidate / confirmed / ContextSnapshot |
| 最近学到 | 主体合同 |
| 还不确定 | 填写完整档案 / 完善全部字段 |
| 让数字之我更了解你 | |

### 12.6 本修正明确不做

复杂 onboarding、七类表单、主体完成度门禁、平行 Profile/Memory/Goal Store、频繁确认弹窗、完整自动蒸馏管线。

---

## 附录 A — 第二事实源风险清单

| 风险点 | 判定 |
|--------|------|
| `derived/*.json` | 非权威，可重建 — **可接受** |
| `manifest.identity` vs 身份事件 | **今日有漂移风险** — 用事件承载澄清并纪律化 manifest |
| NdjsonEventLog（基础设施）vs PackageGrowthLog | 生产主体路径仅后者 — **可接受** |
| Task contextRefs vs materials/ | 用途不同；需产品说清，避免双写叙事 — **流程约束** |
| digitalme-app knowledge-claims / profiles | **非 v2 主体层**；隔离，不接入 |

**静态结论**：未发现已实现的第二主体持久 Store；主要风险是 **manifest 身份旁路** 与 **未冻结的运行期注入**（审计空洞，而非双写 Store）。

---

## 附录 B — 与 a63b177 代码锚点

| 主题 | 路径 |
|------|------|
| 包布局 | `src/subject-core/subject-package.ts` |
| 事件 | `src/subject-core/growth-event.ts` |
| 派生 | `src/subject-core/derive-all.ts` / `derived-views.ts` |
| 选择 | `src/subject-core/experience-selector.ts` |
| 服务 | `src/subject-core/subject-service.ts` |
| 注入 | `src/runtime/digitalme-runtime.ts` + `src/work-runtime/job-runner.ts` |
| 编辑回流 | `src/artifact-workspace/workspace.ts` `recordFeedbackCandidate` |
| Snapshot 字段 | `src/work-runtime/context-snapshot.ts`（`subjectContextRef` 未写） |
| 成长测试 | `src/subject-core/tests/subject-growth.test.ts` |
