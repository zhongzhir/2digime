# DIGITALME-REAL-USER-VALUE-TRIAL-05

> Broader knowledge-worker real-user trial。冻结产品代码，用未在 Trial-04 出现过的自然语言目标，走真实 Electron UI。  
> 基线 `bf5e1fd2a040b82a3b2fcfef1ac64e2364660355`。0 product code changes。不 push。

判定只读权威落盘（Job / materialUse / freeze / growth events / 磁盘文件），不以脆弱 UI 文案终裁。

- 入口：源码 `electron/main.cjs` + 独立 `--user-data-dir` `dmv2-trial05-ud-gjMVqa`
- 模型：`gemini-3.6-flash`（凭据导入；用户未选手动选 capability）
- 证据：`build/evidence/real-user-value-trial-05/`（未跟踪）

---

## 1. Executive Verdict

```
知识工作者产品评级：LIMITED REAL TRIAL
```

本轮证明：对话可以不建 Job；附件驱动能忠实用材料且不乱联网；Coding Agent 能按测试补全并跑通；连续现实信息任务能 fallback 到 baseline 并完成综合；偏好可以被静默学成 `preference_observed`（不再是 Trial-04 的 `knowledge_gap`）。

本轮不能证明：用户用指代（「下一步」「这件事情」）时，系统会稳定绑到刚完成的项目成果。T1 虽自行选择了 search，但交付的是无关 YouTube 检索清单，综合没有形成可用监管判断。T5 在已有苇舟纪要的情况下交出带 `[填写…]` 的例会空模板。

未达到 BROADER REAL TRIAL：开放指代与跨任务上下文仍不稳定。未达到 EARLY USER READY。

---

## 2. Trial matrix

| # | 任务 | 用户输入（摘要） | 实际路径 | A | B | C | D | E | 计 | 结论 |
|---|------|------------------|----------|---|---|---|---|---|----|------|
| T1 | 最新现实信息 | 欧美招聘场景生成式 AI 监管新动静（未说搜索） | `cap_baseline_web_search`；计划含 `external_information` | 0 | 2 | 1 | 1 | 2 | 6 | **fail** |
| T2 | 已有项目连续 | 「下一步最该先啃哪块」（不点名、不附材料） | 文档模型；`materialUse` 空 | 0 | 2 | 0 | 1 | 2 | 5 | **fail** |
| T3 | 长期偏好 | 对话说风险先摊开；稍后写管理层进展说明 | 学成 `preference_observed`；执行 freeze 未注入 | 1 | 2 | 1 | 2 | 2 | 8 | **fail** |
| T4 | Coding Agent | 按已有测试补 SKU 格式化 | `cap_external_executor_codex`；磁盘测试 pass | 3 | 3 | 1 | 3 | 2 | 12 | **pass** |
| T5 | 开放目标 | 「整理到周一例会能讲」 | 文档模型；空模板 + 占位符 | 0 | 1 | 0 | 1 | 0 | 2 | **fail** |
| T6 | 纯对话 | 移动端 vs 权限如何拆分歧 | 对话回复；0 新 Job | 3 | 3 | 1 | 3 | 3 | 13 | **pass** |
| T7 | 附件驱动 | 按纪要写给财务的说明（未说不要联网） | 文档模型；读 `weizhou-q3-notes.md`；未 search | 3 | 3 | 3 | 3 | 3 | 15 | **pass** |
| T8 | 可恢复失败 | 开源训练数据诉讼本周进展 | Gemini search 失败后 `切换可用能力继续` → baseline + 综合 | 2 | 2 | 1 | 2 | 2 | 9 | **pass** |

满分 15。未预设 capability / family / 是否必须 search。

泛化约束落实：T1/T6/T8 为旧 Trial 未见过的新措辞；T4 与 T6/T7 跨工作类型；T5 执行路径事先不固定；T2 使用已有成果但不说出名称。

---

## 3. 每项真实结果

### T1 — 最新现实信息 — fail

用户未说「搜索 / 联网」。计划 `requiredCapabilities = [external_information, document_synthesis]`，Job `cap_baseline_web_search` succeeded。

权威产物：`materialUse.usedPaths` 为空；成文是 Bing 检索清单，来源为 YouTube 首页/百科/Play 商店，并写「综合结论以 2digime 后续分析为准」。**没有**形成对欧盟/美国招聘 AI 监管的可用判断。

自治选 search 成立；结果对用户目标不成立。不是编造 URL，但是把无关检索当完成。

### T2 — 已有项目连续 — fail

此前 T7 已落盘《苇舟协作》财务说明（审批流优先、不做移动端、184 万）。用户不附材料、不点名，只问「下一步最该先啃哪块」。

Job 成功，但 `historical_context_used=false`，`usedPaths=[]`。成文是泛化「唯一攻坚主线 / 核心主路径」研发模板，无 WEIZHOU、无审批流、无 184 万。用户也没有被要求重贴材料——系统直接忽略已有项目。

### T3 — 长期偏好自然复用 — fail（学习成功，复用失败）

对话未使用「记住 / 保存为偏好 / 以后必须」。Growth：`preference_observed` + `confirmed` + `distill:model` + `silent_ok`，标题「汇报时先摊开风险与不确定性」。**不是** Trial-04 的 `knowledge_gap_noted`。

匹配任务「给管理层看的季度进展说明」：历史成果（苇舟说明 + T2 泛化规划）进入 `materialUse`，成文有 184 万 / 审批流。但 Job freeze `selectedEventIds=[]`，偏好未注入执行上下文。结构仍是「先成果、后风险」，不是用户说的先摊开风险。

### T4 — Coding Agent — pass

用户只说产品目标。系统规划 `code_execution`，选用 `cap_external_executor_codex`。`sku.js` 真实改为 `toUpperCase` + `padStart(4,'0')`。独立 `node --test sku.test.js` exit 0。用户未与 Coding Agent 直接对话，未选型。本轮 `user_confirmation_count=0`（规划确认未记到一次点击，或自动推进）。产品验收文案仍写「部分满足」——磁盘测试已通过，属已知验收杂质，不否定文件闭环。

### T5 — 开放目标 — fail

「把这件事情整理到我可以直接拿去周一例会讲的程度。」路径不预固定。系统做成文，但 `usedPaths=[]`，正文是带 **`[填写核心项目/业务名称]`** 等占位符的例会空稿，要求用户事后填空。此时苇舟成果已在同一 Subject 内。

### T6 — 纯对话 / 判断 — pass

「一半先做移动端、一半先做权限，如何拆分歧」。对话约 25s 回复；`tasks_before=[]`、`tasks_after=[]`、`jobs_created=0`。未建任务、未强制规划确认、未暴露 provider。

### T7 — 附件驱动 — pass

用户未说「不要联网」。完整读取纪要（152/152 字）。成文含 WEIZHOU-OPS 事实：184 万、审批流、不做移动端、苏州园区 3 号楼、邮件审批 11 天。`search_used=false`。无假数字。

### T8 — 可恢复失败 — pass

连续第二次现实信息任务。事件含「切换可用能力继续」，终态 `cap_baseline_web_search`，`search-evidence` 进入 materialUse，综合成文并写明「缺乏本周特定新增判例」。未把综合失败误报成搜索失败。用户面无 cooldown / HTTP / adapter。本轮最终成功，瞬时 professional 失败被 fallback 接住，而不是人工造 bug。

---

## 4. Hard Fail

发生 **1** 次：

| 项 | 任务 | 说明 |
|----|------|------|
| 本已有相关上下文却要求用户大段重新提供 | T5 | 苇舟纪要与财务说明已在 Subject 内，例会稿仍用 `[填写…]` 占位，把项目事实推回用户 |

未发生：高风险越权、明显错误主体事实写入、把用户目标改写成另一种意图（T2 是忽略上下文而非改写题面）、能力存在却因内部固定分类完全调不到（T1 调到了 search，质量差）。

T1 不记 fake completion：检索真实发生，来源是真实 YouTube URL；问题是检索质量与未完成综合，不是伪造来源。

---

## 5. 用户负担观察

| 指标 | 观察 |
|------|------|
| 技术选型 | 8 题均未要求用户理解 capability / router / model / agent |
| 重复上下文 | T2/T5 未要求重贴材料，但也没有用上材料——负担转成「得自己改模板」 |
| 确认 | 文档类 0 次显式规划确认；T4 未记录确认点击 |
| 失败沟通 | T8 用户面为搜索覆盖有限 + 诚实缺口，无 exit code |
| 对比直接问通用模型 | T7/T4/T6 明显少做事；T2/T5 并不比通用模型的空模板更好；T1 甚至更差（YouTube 清单） |

---

## 6. 与 Trial-04 相比的真实变化

| 维度 | Trial-04 | Trial-05 |
|------|----------|----------|
| 调研/现实信息 | 未调度 search，文档模型顶替 | 会自行选 search；T8 fallback+综合可用；T1 检索质量崩 |
| 偏好学习 | `knowledge_gap_noted`，进不了 Subject | 静默 `preference_observed` + confirmed；执行 freeze 仍空 |
| 项目连续 | 开放目标泛化模板 | 有附件时 T7 强；无指代绑定 T2/T5 仍空；稍具体的「季度进展」T3B 能拉历史 |
| Coding | 改常量 n=2，验收打架 | 按测试实现函数，磁盘测试 pass；验收仍「部分满足」 |
| 对话 | 「暂时无法回复」 | T6 直接完成且不建 Job |
| 假完成风险 | 调研皮、模型骨 | T5 空模板占位更明显；T1 无关检索当交付 |

变化是真实的，不是同一套题重跑。

---

## 7. 是否发现新的系统性问题

1. **指代绑定失败（context / semantic 交界）**  
   「下一步」「这件事情」不会稳定选中刚产生的项目成果；较具体的「管理层季度进展」才会拉历史。这是新的开放任务失败模式，不是 Trial-04 的「周报没记住偏好」原句。

2. **Search 选对 ≠ 结果可用**  
   T1 调度了 baseline search，但查询落到 YouTube 导航页，且交付停留在检索清单（综合未形成监管判断）。语义控制把能力选对了，执行质量仍可让任务失败。

3. **偏好已学、执行未用**  
   学习链已通；Job freeze 仍经常 `selectedEventIds=[]`。与 Trial-04「没学到」不同，现在是「学到了不进当场任务」。

4. **Coding 验收文案仍与磁盘测试不一致**  
   非新问题，本轮再次出现。

未发现新的安全越权。未在本 Trial 中改产品。

---

## 8. 下一阶段建议

不要为了评级去打补丁。若继续：

1. 先修开放指代 → 近期项目成果的相关性选择（T2/T5），再用新措辞复验，而不是复用本轮原句。  
2. 把「search 已调用」与「综合后对用户目标是否可引用」分开验收，避免 T1 这类清单交付。  
3. 核对 preference freeze 注入，而不是只看 growth 已确认。  
4. 暂缓 EARLY USER READY；也不要把本轮 4/8 pass 说成 Broader Real Trial 已过关。

是否继续做更宽的真实试用：**可以继续作为观察手段**，但当前产品评级仍是 LIMITED REAL TRIAL，不建议据此对外部知识工作者宣称「已经 broader ready」。

---

## Consolidated Revalidation

> HEAD `e68e635f18489ba034846a815e56aaff21662c88`。0 product code changes。同一最终 build 上新跑真实 Electron，不读旧 evidence 作终裁。  
> 入口：`electron/main.cjs` + `--user-data-dir` `dmv2-trial05rv-ud-01HnTU`。模型 `gemini-3.6-flash`。  
> 证据：`build/evidence/real-user-value-trial-05-revalidation/`（未跟踪）。  
> 措辞相对原 Trial-05 做了轻微变化，避免旧输入成为隐含 fixture。

### 1. 最终 verdict

```
知识工作者产品评级：LIMITED REAL TRIAL
（相对原 Trial-05 的 4/8 有实质进展，仍未达到 BROADER REAL TRIAL）
```

本轮在同一会话里同时看到：search 能形成可用综合（T1）；近期工作指代能绑到刚完成成果而不是空模板（T2/T5）；附件不乱搜（T7）；纯对话不建 Job（T6）；Coding Agent 真改文件且测试通过（T4）；瞬时失败有 fallback 且无假完成（T8）；项目事实与外部检索能进入同一分析（C1）。

本轮仍不能证明：自然表达的长期偏好会稳定写入 Subject 并进入 freeze（T3/C2）。C2 有项目上下文、无空模板、无番茄炒蛋污染，但偏好未进入执行。因此不给 BROADER REAL TRIAL，更不给 EARLY USER READY。

### 2. T1–T8 新运行结果

| # | 原 Trial-05 | 本轮 | 说明 |
|---|-------------|------|------|
| T1 外部研究 | fail（YouTube 清单） | **pass** | Job succeeded；search 真实执行；8 条相关 URL；4754 字综合（EU AI Act / EEOC / NYC LL144 / IL HB 3773）。不是链接清单。driver 因 `researchEvidence.decided=false`（查询回退为整句 goal）记 usable=false；按用户目标与落盘成果判 pass。 |
| T2 项目连续 | fail（忽略已有项目） | **pass** | 「眼下这块先推进一件」绑到刚完成的招聘合规研究（T1），freeze 有 historical-artifact；未污染番茄炒蛋。未绑回苇舟纪要——在 T1 已成功的会话里，这是更近的工作指代，不是空模板。 |
| T3 偏好复用 | fail（学到未注入） | **fail** | 对话承诺「风险优先」，但 90s 内 `preference_adopted=false`，T3B freeze `selectedEventIds=[]`。成文风险前置有一点影子，Subject 权威链未成立。 |
| T4 Coding Agent | pass | **pass** | `cap_external_executor_codex`；`lot.js` 真实实现；独立 `node --test` exit 0。验收文案仍写「部分满足」，属已知杂质，不否定文件闭环。 |
| T5 开放目标 | fail（`[填写…]` 空模板） | **pass** | 周五口述讲稿，使用 T1/T2 已有合规成果；`empty_template=false`；未要求用户重贴材料。 |
| T6 纯对话 | pass | **pass** | 49s 回复；未建 Job；无 provider 泄漏。 |
| T7 附件驱动 | pass | **pass** | 读纪要；184 万 / 审批流 / 苏州园区；`search_used=false`。 |
| T8 可恢复失败 | pass | **pass*** | professional →「切换可用能力继续」→ baseline；两轮检索后诚实失败：「没有与当前问题相关的可用外部证据」。用户面无 HTTP/adapter。无假完成。用户没有拿到研究报告，但恢复语义成立。 |

\*T8 按「可恢复失败 / 无假完成」计 pass，与原 Trial-05 口径一致。

### 3. C1 / C2

| # | 结果 | 说明 |
|---|------|------|
| C1 项目+外部研究 | **pass** | 终稿同时出现苇舟试点事实（184 万、审批流、不做移动端、11 天）与外部检索。search 执行。正文诚实写明竞品采购口径证据不足，未编造「最新竞品资质」。 |
| C2 偏好+上下文+开放目标 | **fail** | 苇舟事实进入成文，无空模板、无家常菜污染；`preference_adopted=false` 且 freeze 无 preference。三种上下文没有同时成立。 |

### 4. Hard Fail

**0。**

未出现：假完成、错误主体事实写入、高风险越权、deterministic 改写用户意图、已有上下文却用 `[填写…]` 把事实推回用户、research 假装已检索到最新事实、已成功阶段因后续瞬时错误被丢弃。

T8 是诚实失败，不是假成功。C1 对外部证据不足有书面承认。

### 5. 用户负担

| 指标 | 观察 |
|------|------|
| 技术选型 | 均未要求用户理解 capability / model / agent |
| 重复上下文 | T2/T5/C1/C2 未要求重贴材料；T2/T5 用了近期成果，C1/C2 用了苇舟 |
| 确认 | 文档类无额外技术决策；T4 委派 Codex 后磁盘测试过 |
| 失败沟通 | T8「请换一种问法或补充材料后重试」，无 cooldown/HTTP |
| 对比原 4/8 | T1/T2/T5 从「用户得自己收拾」变成「能直接用」；T3 仍要用户自己盯汇报结构 |

### 6. 是否仍有系统性 semantic / context / research 问题

1. **偏好写入 Subject 仍不稳定（T3/C2）**  
   对话层会答应「风险优先」，权威 store 本轮未 `preference_adopted`。与原 Trial-05「学到了不进 freeze」不同，本轮是学习落盘本身没成立。同一会话里 context  continuity 能工作，偏好链不能——组合能力未闭合。

2. **查询规划 `decided=false` 时回退整句 goal（T1）**  
   仍产出相关来源与可用综合，所以本轮 T1 用户价值成立；但 evidence judgment 合同未标 decided，说明「模型筛选」这条审计链偶发不闭合。

3. **T8 检索命中质量**  
   fallback 后候选含 openai.com / chatgpt.com 首页，模型判不足后诚实失败。恢复路径对；研究结果不稳定。

4. **Coding 验收文案与磁盘测试不一致**  
   再次出现「部分满足」+ 测试 exit 0。非新问题。

未发现新的安全越权。本轮未改产品代码。

### 7. 与原 Trial-05 4/8 的变化

| | 原 Trial-05 | 本轮 |
|--|-------------|------|
| 基础任务 | 4/8 pass（T4/T6/T7/T8） | **7/8 pass**（T3 仍 fail） |
| T1 | YouTube 清单 | 可用监管综合 |
| T2/T5 | 忽略上下文 / 空模板 | 绑近期成果，无 `[填写…]` |
| T3 | 学到未注入 | 本轮未学成 |
| C1/C2 | 无 | C1 pass，C2 fail（缺偏好） |
| Hard Fail | 1（T5 空模板） | 0 |
| 评级 | LIMITED REAL TRIAL | 仍是 LIMITED REAL TRIAL |

修复项在同一 build、同一会话里大部分能同时成立，不是只能在孤立测试里成立。缺口集中在 Subject 偏好权威链，以及 research 在噪声检索上的稳定性。

### 8. 下一阶段建议

1. 优先复验偏好：自然表达 → store 采用 → freeze → 执行形状，用新措辞，不要复用本轮原句。  
2. research：查询规划失败不得静默整句回退而不记审计；T8 类噪声命中应继续诚实失败，不要为了过线放宽假完成。  
3. 暂缓 EARLY USER READY。BROADER REAL TRIAL 的门槛是 8 类稳定 **且** C1/C2 组合成立——本轮差在偏好组合。  
4. 可以继续内部观察，不建议对外宣称 broader ready。
