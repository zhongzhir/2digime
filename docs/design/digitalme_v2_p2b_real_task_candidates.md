# Digital Me V2 — P2B 真实任务候选（非夹具）

- 文档编号：DIGITALME-V2-P2B-REAL-TASK-CANDIDATES
- 日期：2026-08-03
- 状态：`owner_review`
- 约束：候选来自 `digitalme-v2` 真实代码；非文案夹具；不修改原仓（筛选阶段）

---

## 0. 筛选门

候选必须同时满足：真实问题、约 1–5 文件、可独立验证、无迁移/部署/push/不可逆操作、能体现目标理解与方案判断、非纯文案替换、可在隔离工作区完成。

已排除：P2B.1 mini-ui「开始→开始处理」；纯 CRLF 规范化（已接线）。

---

## 1. 候选 A — 代码分析质量档 UI 未区分三态

### 用户价值

Owner 在 P2A 反馈后已有 `usable | needs_attention | degraded_scan_only` 写入 manifest，但界面把「深度不足」与「仅结构扫描」都显示成同一套「需要处理」，无法按质量门做采信决策。

### 根因

`electron/renderer/app.js` 在 `quality.grade !== usable` 时 className/文案分支写成恒等；`.bundle-quality.usable` 等样式未按三态挂载；状态条同样不区分。

### 修改范围（预计）

1. `digitalme-v2/electron/renderer/app.js`  
2. `digitalme-v2/electron/renderer/styles.css`  
3. （可选）`digitalme-v2/src/capability/adapters/tests/p2a-owner-feedback-fix.test.ts` 或小型 renderer 探针

### 验收标准

- `degraded_scan_only`：明确「仅结构扫描」类中性文案 + 可区分 CSS class  
- `needs_attention`：警示「需关注 / 不建议直接采信」，**文案与 class 不同于** degraded  
- `usable`：不显示降级横幅；状态为正常只读结果  
- 不新增 Job 状态；不改质量门后端枚举语义  

### 风险

低（纯展示）。文案须过用户面中性检查，禁止泄漏 `grade` 协议名到默认 UI。

### 预计耗时

实现 + 独立验证：**1.5–2.5 h**

### 适合作为首个真实任务？

**适合（推荐）**：直接承接 P2A Owner 反馈残余；非文案替换而是**质量判定表达**；范围小；验证清晰；能体现 Digital Me 对「可采信 vs 仅扫描」的方案判断。

---

## 2. 候选 B — Bundle 成果「复制」拷到空编辑器

### 用户价值

代码分析结果主区可见报告，但点「复制」得到空内容或文档编辑器残留，Owner 无法把结论带走。

### 根因

Bundle 视图隐藏 `artifactEditor` 并把正文写入 `#bundle-report` / `content.text`；复制按钮仍 `clipboard.writeText(els.artifactEditor.value)`（`app.js` ~792–794）。

### 修改范围（预计）

1. `digitalme-v2/electron/renderer/app.js`  
2. （可选）极小测试或手动验收记录  

### 验收标准

- 当前为 code-analysis bundle 时，复制内容等于主报告正文（`content.text` 或 bundle report）  
- 文档 `text` 成果路径行为不变  
- 不新增确认步  

### 风险

低。需注意切换 artifact 类型时剪贴板源正确。

### 预计耗时

**0.5–1 h**

### 适合作为首个真实任务？

**可作热修，但次优作 P2B.2 样板**：真实 bug、极易验证，但「方案判断」含量弱，更像接线缺陷；对证明软件工程闭环的 CTO 价值低于候选 A。

---

## 3. 候选 C — 文档成果 `revealInFolder` 未物化可读文件

### 用户价值

文档任务点「打开所在目录」后目录几乎为空；正文只在 ContentStore digest 路径，Owner 看不到可打开的成果文件。

### 根因

`workspace.ts` `revealInFolder` 仅对 bundle 的 report/manifest/evidence 物化；`kind==='text'` 无对称导出；仍返回打开成功。

### 修改范围（预计）

1. `digitalme-v2/src/artifact-workspace/workspace.ts`  
2. `digitalme-v2/electron/main.cjs`（若需选中具体文件）  
3. 既有 p2a 类测试扩展  

### 验收标准

- document artifact reveal 后 `storageDir` 存在可读 `.md`（导出视图，**非**第二事实源）  
- code-analysis 三文件行为不回归  
- ContentStore 仍为权威正文  

### 风险

中低：须避免把导出文件写成第二权威；命名需稳定。

### 预计耗时

**2–3 h**

### 适合作为首个真实任务？

**适合作为紧随其后的真实任务**：用户价值高，但触及存储/导出边界，略重于 A；且偏「文档」路径，对「软件工程 Agent 闭环」示范性弱于 A（A 仍在分析质量门语境，与 P2B 判定纪律同构）。

---

## 4. 未入选但可进 backlog

| 项 | 原因 |
|----|------|
| Coding Agent `claimedSuccess` 启发式过松 | 真实问题，但偏基础设施收紧；宜在真实任务后单独小修 |
| engineering bundle reveal 按 role 泛化 | 契约落地，略超「最小真实 UI bug」；可进 P2B.2+ |
| OpenCode 适配 | 路线上不入默认池 |

---

## 5. 单一推荐（指向规格）

**首个真实任务 = 候选 A（质量档 UI 三态区分）**。  
详见 `digitalme_v2_p2b2_recommended_task_spec.md`。
