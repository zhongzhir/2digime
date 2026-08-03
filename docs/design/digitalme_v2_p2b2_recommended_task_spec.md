# Digital Me V2 — P2B.2 推荐真实任务规格

- 文档编号：DIGITALME-V2-P2B2-RECOMMENDED-TASK-SPEC
- 日期：2026-08-03
- 状态：`draft_for_implementation_authorization`（**未授权实现前不得开工改生产代码**）
- 任务名建议：`DIGITALME-V2-P2B2-QUALITY-GRADE-UI-01`
- 候选来源：`digitalme_v2_p2b_real_task_candidates.md` 候选 A

---

## 1. 一句话目标

在隔离工作区修复代码分析成果的**质量档用户可见区分**，使 Owner 能区分「可用 / 需关注 / 仅结构扫描」，并产出可审查 Change Proposal；**不 apply、不 push、不改用户原仓以外的交付物**。

---

## 2. 推荐组合（路线 + 任务）

| 项 | 决定 |
|----|------|
| 近期主 Agent 路线 | **Codex CLI**（探测通过时） |
| 备用 | **Cursor Agent** → Claude Code |
| Digital Me 自研范围 | 计划、工作区、Grant L1、独立验证、提案物；**不**自研 coder |
| 首个真实任务 | **质量档 UI 三态区分**（本规格） |
| 预计实施耗时 | **2–3 h**（含隔离执行 + 独立验证 + 提案；不含 Owner 验收闲置） |

---

## 3. 用户目标（写入 Engineering Plan）

修复：当 `manifest.quality.grade` 为 `needs_attention` 与 `degraded_scan_only` 时，主界面横幅与状态文案必须可区分；`usable` 不显示降级横幅。

---

## 4. 修改范围（允许）

| 文件 | 变更意图 |
|------|----------|
| `digitalme-v2/electron/renderer/app.js` | 按 grade 分支 className 与中性文案；状态条同步 |
| `digitalme-v2/electron/renderer/styles.css` | `.bundle-quality.needs-attention` / `.degraded-scan`（或等价）视觉区分 |
| 测试（可选 1 文件） | 对渲染分支或 fixture summary 的断言 |

**禁止**：改 Job 五态；改 `ADAPTER_TYPES`；改质量门后端枚举含义；portable/ZIP 重建；apply 到「原仓」以外的额外重构。

---

## 5. 验收标准（独立验证）

Digital Me 在隔离工作区重跑，不采信 Agent 自报：

1. **静态/单测**：存在针对三态文案或 class 映射的断言（或最小 DOM/纯函数抽取后的单测）。  
2. **UI 静态检查**：源码中 `degraded_scan_only` 与 `needs_attention` 不得再共用同一展示字符串分支（禁止恒等三元）。  
3. **回归**：`usable` 路径仍隐藏降级条。  
4. **原仓**：实现阶段若以 `digitalme-v2` 为材料，Change Proposal **不自动 apply**；Owner 审查前工作树策略按 P2B.2 授权包另定（本规格默认 **提案-only**）。  
5. 用户面文案：中性、无 `grade`/`degraded_scan_only` 等协议名直接展示。

### 建议用户面文案（实现可微调，须过自检）

| grade | 横幅意向 |
|-------|----------|
| `degraded_scan_only` | 「本次仅完成结构扫描，未完成深度分析」 |
| `needs_attention` | 「结果需要关注，请谨慎采信」 |
| `usable` | 无横幅 |

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 文案泄漏内部字段 | 评审对照产品文案规范 |
| 只改 class 不改读屏/状态条 | 验收清单含状态条文案 |
| Agent 顺手大改样式 | Plan 写死范围；diff 审查 |

---

## 7. Owner 决策点

**0**（无新确认步；纯缺陷修复表达）。

---

## 8. 权限

仅 **L1**（隔离工作区写入 + 受限命令）。禁止 repository_apply / git_push / deployment。

---

## 9. 停止条件（P2B.2 本切片）

遇到以下任一情况 **停止并回报**，不得自行扩 scope：

1. 发现必须改 Work Runtime / 新增 Store / 新 Job 状态才能完成展示  
2. 需要改模型提示词或质量门后端算法才能「看起来更好」  
3. 需要构建 Owner ZIP / portable  
4. 需要 apply 到原仓或 push  
5. 默认 Agent 与全部备用均探测失败（硬失败，禁止伪实现）  
6. 单切片超过约 **4 h** 仍无完备 Change Proposal  

---

## 10. 是否建议立即启动实现

| 条件 | 建议 |
|------|------|
| Owner / CTO 接受本规格 + 选择策略 | **可以立即启动** `DIGITALME-V2-P2B2-QUALITY-GRADE-UI-01` |
| 仅接受路线文档、未批实现 | 不改生产代码，等待授权包 |

**本文件本身不构成实现授权**；冻结后方可开实施会话。

---

## 11. 交付物（实施阶段）

- Engineering Plan bundle  
- Change Proposal（summary / patch / changed-files / manifest / risks）  
- Verification bundle（含 `agent_claimed` vs `digitalme_verified`）  
- 明确 `owner_accepted=false` 直至 Owner 审查  

不 push；不部署；不构建 Owner 候选（除非另批）。
