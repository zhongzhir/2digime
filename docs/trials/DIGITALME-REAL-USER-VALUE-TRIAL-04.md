# DIGITALME-REAL-USER-VALUE-TRIAL-04

> 第四轮真实用户价值试用 — 判断知识工作者版 2digime 是否达到 **READY FOR BROADER TRIAL**。
> 不是判断：consumer ready / MVP / production ready / P95。
> 基线 `build/subject-learning-availability-01` @ `eef1eb4`；分支 `trial/user-value-trial-04`。
> 第一轮 **0 product code changes**。所有验证走真实 Electron UI（converse → 规划 → 确认 → 执行 → review → result），未直接 `submitTask` 代替用户路径，未用 fake model。

---

## 一、Candidate / Env

- Windows Candidate：`npm run build:packaged` @ `eef1eb4fe6c52e72224ba26d0706fa46e6db110c`
  - `buildId`: `v2-20260827T010320Z-eef1eb4f`
  - ZIP：`release-staging/v2-20260827T010320Z-eef1eb4f/DigitalMeV2-0.1.0-win-x64.zip`
  - 运行：`win-unpacked/DigitalMeV2.exe` + 独立 `--user-data-dir`
- 真实环境（本机已有，未手工指定 executor / adapter / port）：
  - 模型：`gemini-3.6-flash`（openai-compatible，经设置/凭据导入；**无独立 distill model**）
  - 自动发现：`cap_model_openai_compatible`、`cap_gemini_web_search`（available）、`cap_baseline_web_search`（available）、`cap_external_executor_codex`（AtomCode，preferred / ready）、`cap_external_executor_model_api`、`cap_code_repo_analysis`
- 路径：真实窗口「做事 / 对话」→ `work.converse` / `conversation.reply` → 规划确认 → 执行 → 验收成果。
- 额外（不替代真实验证）：`research-runtime-reliability-02` + `search-failure-closure-01` **12/12 通过**（empty / timeout / 队列隔离 / cooldown / 双失败诚实失败）。

`consumer_zero_config_ready` 观察：试用说明与欢迎/设置仍要求用户自备模型密钥。本轮凭据导入只为知识工作者路径，不改变该结论。

---

## 二、T1–T5

| # | 任务 | 真实入口 | 实际能力 | 结果 |
|---|------|----------|----------|------|
| T1 | 材料 → 成果 | 做事：添加文件 `product-notes.md` → 发送目标 | `cap_model_openai_compatible` | **可用**。完整读取材料（234/234 字），成文含「了解我 / 替我做事 / 协作」、最小披露、80% 采用率。28.5s。 |
| T2 | 当前现实研究 | 做事：只输入调研目标 | `cap_model_openai_compatible`（**未走 search**） | **成文可用、调研不合格**。`intentKind=create_document`，未调用 `cap_gemini_web_search` / baseline。正文诚实声明未提供外部链接、禁止编造 URL；无真实联网证据。96.6s（含规划）。 |
| T3 | Coding | 做事：添加项目文件夹 → 发送目标 → 确认规划 | `cap_external_executor_codex`（AtomCode，未指定 path） | **文件闭环成立，验收有杂质**。`index.js` 真实改为 `export const n = 2;`；独立 `node --test` pass。产品独立验收把 `npm test --if-present` 记为 `exit null / execution_failed`，结论「部分满足」。用户确认规划 1 次。约 3.3min 执行。 |
| T4 | Continuity | 对话表达周报偏好 → 新任务「和上次一样写一份周报。」 | 对话 capture + 文档模型 | **成文有、连续性不成立**。对话回复失败（「暂时无法回复」）；capture 记为 `ok_learned`，但事件类型是 `knowledge_gap_noted`（临时 gap），**被 SubjectContextPackage 排除**（`selectedEventIds=[]`）。周报是通用框架，**不是结论先行**。confirmedExperienceCount = 0。 |
| T5 | Open Goal | 做事：只说「帮我把这个项目下一阶段推进方案整理出来。」 | `cap_model_openai_compatible` | **有方案、未贴本项目**。2digime 自行规划/执行/组织；未点名 Agent/provider。正文是泛化软件项目模板，未使用 Digital Me / 本仓库事实。40s。 |

### T2 研究字段

| 字段 | 值 |
|------|----|
| professional_attempt_outcome | **not_attempted**（converse 判成 `create_document`，未选 professional search） |
| fallback_occurred | false |
| actual_capability | `cap_model_openai_compatible` |
| closure | baseline 文档模型，不是 search closure |
| time_to_result | 96.6s |
| final_result_usable | 作为「可阅读摘要」是；作为「有联网证据的调研」否 |

因本轮真实 professional search **未被调度**，empty/timeout 的 **UI 受控失败未再跑**（不能替代未发生的真实 professional 路径）。机制额外验证见上：reliability-02 **12/12**。

### T3 Coding 闭环

- 用户只表达功能目标；未指定 executor / CLI / adapter / port。
- 自动发现并选用 AtomCode（`cap_external_executor_codex`）。
- 真实改文件 + 执行器自报测试通过；2digime 独立 verification 将同一轮 `npm test --if-present` 判失败（`exitCode: null`）。
- 采用前界面「不建议采用 / 部分满足」——用户若只看验收会被误导，但磁盘结果是对的。

---

## 三、用户负担

| 指标 | T1 | T2 | T3 | T4 | T5 |
|------|----|----|----|----|----|
| initial_user_input | 1 句 + 添加文件 | 1 句 | 1 句 + 添加文件夹 | 对话 1 句 + 做事 1 句 | 1 句 |
| additional_user_input | 0 | 0 | 0 | 0（未再重复偏好） | 0 |
| user_confirmation_count | 0（低风险文档自动推进，内部「确认」） | 0（同上） | 1（确认规划并开始开发） | 0 | 0 |
| technical_decisions_requested | 0 | 0 | 0 | 0 | 0 |
| capability_setup_actions | 0（本轮会话内；首次仍需模型密钥） | 0 | 0 | 0 | 0 |
| goal_reentry_count | 0 | 0 | 0 | 0 | 0 |
| recovery_user_intervention | 0 | 0 | 0 | 对话失败需「重试回复」（本轮未点成） | 0 |
| time_to_result | 28.5s | 96.6s | ~3.3min 执行 / 走查等待更长 | 99s | 40s |
| major_manual_rework | 否 | **是**（无来源，不能当调研用） | 否（文件已对；验收文案需人工判断） | **是**（需改成结论先行并补事实） | **是**（泛化模板） |

**相比直接使用 generic model，用户少做了什么？**

- T1：少了自己贴材料进提示词、自己分节；产品自动 freeze 材料并成文。
- T3：少了选择/配置 AtomCode、自己开终端改文件跑测试；仍需点一次规划确认。
- T2/T4/T5：规划与成文自动化了，但**没有**比「直接问 Gemini」多出联网证据、记住偏好、贴合本项目——这三题 generic model 也能写出同类模板。

本轮还观察到：完成第一题后「发送给 Digital Me」可能保持 `disabled`（需改走底部「发送」或重启）。持续使用有摩擦。

---

## 四、三个核心价值

### SUBJECT VALUE — **本轮无真实增益证据**

- 对话偏好「周报结论先行」经 capture → Growth 权威链：**进入了 events**（`captureKey:conversation:turn_…`，`distill:contract_fallback`，`ok_learned`）。
- 但被收成 **`knowledge_gap_noted` + `category:temporary_context`**，不是 confirmed preference。
- 后续周报 snapshot：`selectedEventIds: []`，该事件在 `excludedEventIds` 中。
- `subject.getOverview`：`confirmedExperienceCount = 0`，`userVisibleFacts = []`。
- 因此：**不能证明「因为知道用户/偏好而改善结果」**。这是 SUBJECT，不是走查脚本问题。

### CONTROL VALUE — **部分成立**

- 成立：T1 材料纳入、T3 AtomCode 自动发现与执行、T1/T5 规划与结果组织、用户无技术选型。
- 不成立/削弱：T2 未把调研目标选到 professional/baseline search；T3 独立验收与执行器报告打架；对话失败时用户只看到「请稍后重试」。
- fallback：本轮 UI **没有**发生 professional → baseline；机制层 empty/timeout fallback 单测通过，不能记成产品面已验证。

### CONTINUITY VALUE — **不成立**

- 第二次只说「和上次一样写一份周报。」输入更少，这点成立。
- 结果未更贴合：无结论先行、无主体注入证据、周报自称「未提供具体业务记录」。
- 对话回复失败，偏好未成为有效主体信息。

---

## 五、假完成 / 技术泄漏

- T2：**未假造 URL**（明确写了禁止编造链接，只引用 DORA / OWASP 等框架名）。但用文档模型完成「调研」外观，**容易被当成已经联网检索**。归因 **CAPABILITY CONTROL / RESULT REVIEW**。
- T3：执行器摘要写「测试全部通过」，独立验收写 `execution_failed`。不是假成功交付文件，但是**验收信号自相矛盾**。归因 **RESULT REVIEW / RELIABILITY**。
- T4：没有假装已经记住偏好。
- 用户面未见 adapter / HTTP / quota / Gemini 等技术泄漏。

---

## 六、Gate 逐条

1. ≥4/5 真实任务形成**真正可用**结果 → **未过**。严格可用：T1、T3（文件层）。T2/T4/T5 需明显返工或未满足题面。
2. Research failure 不再系统性中断 → **未在真实 professional 路径上验证**。本题根本没调度 search；任务未失败但用模型作文顶替。机制单测通过 ≠ 产品面研究闭环。
3. Coding 真实闭环 → **基本过**（自动发现 AtomCode、真实改文件、有 review）。验收误报是 P1，不否定改文件事实。
4. Subject Value 有真实证据 → **未过**（见第四节）。
5. Continuity Value 有真实证据 → **未过**。
6. Control Value 成立 → **部分**（T3 强，T2 选错能力）。
7. 无系统性假完成 → **通过（有保留）**：无伪造链接；T2 的「调研皮、模型骨」需在审查层标清。
8. 无阻碍知识工作者持续使用的 P0/P1 → **未过**（见下）。
9. 普通技术故障无需用户处理 → **未过**（对话「暂时无法回复」要重试；首题后发送按钮可能卡死）。

---

## 七、剩余 P0/P1

P1（阻止 Broader Trial）：

1. **SUBJECT / CONTINUITY**：无独立 distill 时，明确工作偏好被 contract fallback 收成临时 `knowledge_gap_noted`，进不了 SubjectContextPackage。→ 归因 SUBJECT。
2. **CAPABILITY CONTROL**：带「调研 / 来源」的目标被 converse 判成 `create_document`，professional search 即使 available 也不出场。→ 归因 CAPABILITY CONTROL。
3. **PRODUCT UX**：任务完成后「发送给 Digital Me」可保持 disabled，第二题主按钮不可用。→ 归因 PRODUCT UX。
4. **RELIABILITY**：对话回复可失败（「暂时无法回复」），capture 仍可能跑但分类错误；更早一轮还出现过确认句「模型连接不可用」。→ 归因 RELIABILITY。
5. **RESULT REVIEW**：Coding 独立验收 `npm test --if-present` `exitCode: null` 与执行器/磁盘测试结果不一致，阻碍「能否采用」判断。→ 归因 RESULT REVIEW。

无新的 P0 安全/假完成。无 product 热修（本轮冻结）。

---

## 八、Consumer 单列

```
consumer_zero_config_ready = NO
```

仍需用户自备模型 credential。不阻塞知识工作者 Gate 的判定过程，但知识工作者 Gate 本轮也未过。

---

## 九、最终结论

```
知识工作者产品评级：LIMITED REAL TRIAL
consumer_zero_config_ready: NO
是否进入 broader real-user trial：否
```

**不升级为 READY FOR BROADER TRIAL。**  
T1 证明材料→成文在真实 UI 上成立；T3 证明 AtomCode 可自动到达并改仓库。T2 没有真实联网证据，T4 没有可复用主体偏好，持续使用仍有发送按钮与对话失败摩擦。

不要据此自动开启新的内部功能开发任务清单；下一阶段若再试，应仍以真实 UI 复验上述 P1，而不是扩协议或加 Agent。

---

## 交付

- 报告：`docs/trials/DIGITALME-REAL-USER-VALUE-TRIAL-04.md`
- 走查证据（不入库）：`build/evidence/real-user-value-trial-04/`（截图、t1–t5.json、独立 userData 下的 jobs/snapshots/growth events）
- 提交：`docs(trial): validate broader knowledge-worker trial`（未 push）
- 0 product code changes
- 保留：trial-01 / trial-02 / trial-03
