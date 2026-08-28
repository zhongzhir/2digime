# DIGITALME-BROADER-REAL-USER-OBSERVATION-01

> 阶段：Knowledge Worker = **BROADER REAL TRIAL**  
> 开始真实知识工作者观察。停止围绕 Trial-05 / 固定 Gate 优化。  
> **不预设测试题。不制造任务填文档。不给 EARLY USER READY 预定时间。**

---

## Baseline（冻结）

| 项 | SHA / 位置 |
|----|------------|
| 产品基线 | `82c9d8f53144d501832ab967b249c875c9ff1cec` |
| Gate 文档 | `2be00638dc618e26179f65bf43f2030b035d0212` |
| Gate | `docs/trials/DIGITALME-KNOWLEDGE-WORKER-BROADER-TRIAL-GATE-03.md` |
| Gate evidence（本地，不入库） | `build/evidence/knowledge-worker-broader-trial-gate-03/` |
| 评级 | BROADER REAL TRIAL |
| 最高不得给 | EARLY USER READY |
| product code | **冻结。初始 changes = 0** |
| push | **no** |

Gate-03 结果（同一最终 build）：T1–T8 = 8/8，C1/C2 = 2/2，Hard Fail = 0。

本阶段问题先记录。单次普通失败积累样本。不看到失败就立即 patch。

---

## 原则

用户只做真实工作。2digime 自己决定路径。

不要预设用户应该：搜索、写文档、编程、使用 Subject、使用项目上下文、调什么 Agent。

真实失败后首先问：**最强模型 / Agent 本来能不能完成？**  
若能，优先查：是否没调用 AI、上下文是否没给到、capability 是否没接上、execution 是否失败、deterministic control 是否覆盖模型。

不要首先：加关键词、加 enum、加流程、加固定状态、加用户确认。

继续坚持：

- AI owns capability and semantics.
- 2digime owns subject, orchestration and necessary boundaries.

---

## 观察对象（优先类型，不要求一次凑齐）

- 创业者 / 项目负责人
- 投资 / 研究人员
- 内容 / 写作者
- 产品 / 运营人员
- 有代码需求的知识工作者

重点是真人 + 真工作，而不是大量同质任务。

第一阶段建议至少：多名真实用户、多日使用、每人多个自然任务、至少部分连续任务、至少部分跨项目 / 跨场景。不按「10 道题」结束。

---

## 何时可中断观察进入修复

仅当出现：

- fake completion
- 数据 / 主体错误
- 高风险越权
- 系统性无法开工
- 系统性任务错绑
- 某类高频真实任务持续失败

其余失败先记样本。

---

## 每个真实任务只记这些

用户不承担测试员工作。内部详细 evidence 留本地。

1. 用户原始目标  
2. 是否完成  
3. 最终产物 / 结果  
4. 是否自动使用历史上下文  
5. 是否调用外部能力 / Agent  
6. 用户是否需要额外介入  
7. 是否出现错误或恢复  
8. 用户主观评价  
9. 是否愿意再次把类似任务交给 2digime  

---

## 重点指标（不要只统计技术 pass rate）

| ID | 指标 | 观察什么 |
|----|------|----------|
| A | Real Goal Completion | 真实工作是否完成 |
| B | Repeat Usage | 用户是否愿意继续用 |
| C | Context Value | 历史 / 成果 / 偏好是否减少重复输入并提高结果 |
| D | AI Autonomy | 用户是否只表达目标即可 |
| E | User Burden | 用户是否被迫处理内部机制 |
| F | Recovery | 失败后是否自然恢复 |
| G | Differentiated Value | 相对直接用 ChatGPT / Claude / Gemini / Cursor，是否因「属于这个人、持续了解这个人、组织不同 AI 能力」产生明确额外价值 |

G 非常重要。

---

## 问题分级

| 级 | 含义 | 本阶段处理 |
|----|------|------------|
| P0 | 安全、主体真值、fake completion、任务串线、数据风险 | 可中断观察修复 |
| P1 | 高频真实任务不能完成；上下文连续性系统性失败；Agent/能力系统性无法使用 | 可中断观察修复 |
| P2 | 结果质量波动、偶发恢复、明显 UX 摩擦 | 记 backlog，不打断观察 |
| P3 | 文案、展示、审计杂质 | 记 backlog，不打断观察 |

### 已知 backlog（Gate 带入，不打断观察）

| 级 | 项 |
|----|----|
| P3 | T4 成果摘要「部分满足验收要求」vs 磁盘测试 exit 0（verifier / UX） |
| P3 | `researchEvidence.decided` observability（本轮 Gate 已为 true，仍作观察项） |
| P3 | 任务完成后 UI 仍可能显示「尚未决定」（awaiting adopt 文案） |

---

## 追加模板（有真实任务再填，不要为填文档制造任务）

```
### OBS-NNN — YYYY-MM-DD

- User / persona（匿名）：
- Real task（用户原话 / 原目标）：
- Outcome（是否完成；产物摘要）：
- Context used（历史 / 成果 / 偏好，自动与否）：
- External capability / Agent：
- User burden（额外介入？内部机制？）：
- Recovery（若失败，如何恢复）：
- Value signal（A–G，尤其 G；是否愿再交类似任务）：
- Failure class（P0–P3 / none）：
- Follow-up：
```

---

## Observation log

*尚无真实观察样本。不在此编造任务。*

---

## 工作树约定

- 观察期间 **不改产品代码**，除非命中上方中断条件。  
- Gate evidence 继续本地保留，不默认提交。  
- 本文件只追加真实样本与分级问题。  
- 不 push，除非另行明确要求。
