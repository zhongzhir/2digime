# 任务包 VL1-FIX：把生成 prompt 从「限制」改写为「校准」

版本：v0.2.0
日期：2026-07-25（文档收口同步：2026-07-26）
状态：`accepted` / **Owner 真机验收通过；第一纵向闭环正式收口**
实现提交：`928aa1a fix(vl1): calibrate-not-limit generation prompts`
文档收口提交：`e8b6572 docs(status): record 第一段正式收口 / VL1-FIX 928aa1a accepted`
所属执行计划：[`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)（v0.1.11；第一纵向闭环 **`accepted` / `completed`**）
所属规格：[`digitalme_first_vertical_loop_spec_v0.1.md`](digitalme_first_vertical_loop_spec_v0.1.md)（v0.1.1，含 §3.4）

> **正式结论（2026-07-25 / 文档入库 2026-07-26）**：本任务已 `accepted`。不再存在「等待 Owner 真机验证」或「待提交固化」的待办。第一纵向闭环第一段「代表你做一项研究与表达任务」主线正式收口。

---

## 0. 文档地位与问题来源

### 0.1 触线发现

2026-07-25 Owner 在真机使用第一纵向闭环时发现：研究类任务（"评估 AI 主权协作的当前主流产品图景"）在 autoGenerate 路径下生成的成果末段出现了"由于本人信息中未提供任何具体产品名称或市场数据...需要用户自行补充"。

### 0.2 触线的设计根因

`digitalme-app/src/act-behalf/result-generation.js` 三个 prompt 把"AI 使用本人信息"实现成了**限制 AI**，而非**校准 AI**：

- 第 397 行（研究）："你是 Digital Me 的研究与表达助手。**必须遵守已注入的 Skill 方法与证据边界**"
- 第 410 行（研究）："每条 inference **至少引用一个有效 claimId 或 resultRef**；不确定时写 uncertainty=high"
- 第 412-414 行（研究，无外搜时）："本次**无可用外部来源**：**结论必须受限**并标明不确定"
- 第 467-470 行（邮件）："语气、措辞与格式必须符合已确认本人条目体现的表达风格；**不得越过其中声明的边界**"
- 第 583-587 行（视频音频）："叙事口吻、表达风格与创意偏好必须符合已确认本人条目体现的特点；**不得越过其中声明的边界**"

### 0.3 触线违反的已冻结原则

- **决策 #70**（PAN-00R）：「**禁止因主体资料不足降低输出质量**」
- **决策 §3 第 25 条**：「**不得因主体资料不足而降低通用 AI 本可达到的输出质量**」
- **§4.4**：「没有相关信息时宁可不做个性化，不得强行引用，更不得因主体资料不足而**降低通用 AI 本可达到的输出质量**」

### 0.4 校准 vs 限制（必须区分）

| 限制（当前实现） | 校准（本任务目标实现） |
|---|---|
| AI 必须按已注入信息生成 | AI 正常发挥 |
| 缺原料就限制输出 | 缺原料时用通用知识补，**并显式区分来源类别** |
| 缺原料就让用户补料 | 缺原料时**不**让用户补料；只在 Owner 显式要求写入主体资料时回写 |
| 不区分"AI 通用能力"与"蒸馏信息"边界 | 区分：本人事实 / 外部事实 / 通用推理 / 价值观·风格·安全边界 |

### 0.5 已确认原则（Owner 2026-07-25 精确表述）

> 不是让蒸馏后的数字之我限制住 AI，而是在 AI 正常发挥时，让数字之我**校准** AI。只要不违背数字之我的**价值观、风格、安全**的 AI 输出成果，就是可以接受的。

此原则将写入规格 §3.4（新增章节）与决策 log #102。

---

## 1. 目标（一句话）

把 `result-generation.js` 三个 prompt 从"按注入信息生成"重写为"AI 正常发挥 + 数字之我提供方向/价值观/风格/安全边界"。

## 2. 范围

### 2.1 必改文件

| 文件 | 改动 |
|---|---|
| `digitalme-app/src/act-behalf/result-generation.js` | 重写 `buildResearchGenerationMessages` / `buildEmailGenerationMessages` / `buildVideoAudioGenerationMessages` 三个函数的 system prompt |
| `digitalme-app/scripts/test-vl1-prompt-calibration.cjs` | **新增**自动化测试文件 |
| `digitalme-app/package.json` | 新增 `test:vl1-prompt-calibration` 脚本 |
| `digitalme-app/src/act-behalf/result-generation.js` | 在三个 prompt 构造处加**新测试钩子**（导出原 system prompt 字符串供测试断言） |

### 2.2 必改文档

| 文件 | 改动 |
|---|---|
| `digitalme_first_vertical_loop_spec_v0.1.md` | 新增 §3.4「校准 vs 限制原则」章节；升 v0.1.1 |
| `digitalme_first_vertical_loop_sprint_plan_v0.1.md` | 升 v0.1.11；§5 任务表加本 fix；§6 下一项改回本 fix；§8 修订记录加 v0.1.11 条 |
| `digitalme_context.md` | 新增决策 #102「校准 vs 限制原则」（含 §3 第 26 条） |
| `digitalme_log.md` | 新增 2026-07-25 条目「VL1-FIX · 校准 vs 限制 prompt 修复」 |

### 2.3 明确不做的范围

- 不改 `distill-me` 装配（已在 `2f1b7bd` 收口）
- 不改外搜路径（`research:discoverSources` / `searchWeb`）
- 不动 R3 / R2.5 / PAN-02（保持 `paused` / `planned` / `blocked`）
- 不修改 `55ae01f`（`partially_reused_as_first_vertical_loop_scaffold`）
- 不修改 `digitalme-app/src/doing-context.js`（`2f1b7bd` 收口）
- 不改 `subject-context-assembly.js`（`c3f7eb2` 粒度修复）
- 不改前端 UI（`index.html` / `app.js` / `preload.js`）——本任务**仅触及 prompt 文本**
- 不开新分支——在当前 `master` 直接合入（与 c3f7eb2 同样的合入方式）

---

## 3. 实施步骤

### 3.1 改 `result-generation.js`

**约束**：
- 三个 prompt 重写，**但产物 JSON 字段必须不变**（`subjectSummary` / `externalFindings` / `inferences` / `finalDraft` / `email.to` / `email.subject` / `email.body` / `email.attachments` / `email.needsConfirmation` / `videoAudio.scenes` / `videoAudio.creativeDirection` / `videoAudio.productionTips` / `videoAudio.needsConfirmation`）
- 重写后，**模型仍按这套 JSON 结构输出**；不引入新字段
- 不改 IPC handler / 不改存盘逻辑

#### 3.1.1 研究 prompt 重写（行 396-414 段）

**替换 system prompt 为**：

```
你是数字之我背后支撑的 AI。数字之我提供：
- 方向：本人已声明的研究与判断方向
- 真实性：本人已确认的事实与观点（注入见下方"已确认本人条目"）
- 风格：本人已声明的表达偏好
- 价值观：本人已声明的立场与禁忌
- 安全：本人已声明的禁区（医疗确定性建议、法律确定性建议、对外承诺等）
- 边界：本人已声明的禁止用途

你的工作方式：
1. 优先调用 AI 通用能力回答；这是你的能力上限，不得被本人信息不足而压缩
2. 已确认本人条目、外部来源是真实性增强；不引用也能正常生成
3. 输出必须显式区分三类来源：
   - 本人事实：来自已确认本人条目，标注 claimId
   - 外部事实：来自外部来源，标注 resultRef
   - 通用推理：基于通用知识，**不挂 claimId 也不挂 resultRef**，在 inference 上 uncertainty ≥ medium
4. 禁止伪造：不得伪造本人事实（不得编造 claimId）、不得伪造外部来源（不得编造 URL 或 resultRef）、不得把通用推理伪装成本人/外部事实
5. 缺原料时：
   - **不要限制输出、不要让用户补料**
   - 用通用知识答
   - 显式标注该结论来自通用推理（非本人/外部）
6. 越线即拒：涉及本人已声明的价值观、风格、安全、边界禁区 → 拒绝生成 / 改写后再生成

【Skill 方法提示】${systemHint}
【Skill 步骤顺序】${steps}

输出仍是单个 JSON 对象（字段不变）。
规则：
1. 引用 claimId / resultRef 时必须使用下方给定的；不得发明新的 ID 或 URL
2. externalFindings 不得改写 URL / provider
3. 通用推理（inference）可无 claimId / resultRef 引用；此时 uncertainty ≥ medium
4. 禁止把通用推理伪装成本人事实（挂到不相关 claimId）；禁止把外部摘要伪装成已证实事实
5. 禁止把通用推理写成 Owner 已有观点
${continueWithoutExternalSources ? "6. 本次无外部来源：仍可用通用知识生成；通用推理须显式标注" : "6. 有外部来源时，外部事实可优先于通用推理，但通用推理不强制依赖外搜"}
```

#### 3.1.2 邮件 prompt 重写（行 453-470 段）

**替换 system prompt 为**：

```
你是数字之我背后支撑的 AI 起草助手。数字之我提供：
- 收件人语气与关系风格
- 本人已确认的事实/观点（注入见下方）
- 本人已声明的禁区与边界

你的工作方式：
1. 邮件正文用 AI 通用能力起草；这是你的能力上限
2. 关键事实（收件人、时间、金额、承诺、姓名、机构）若无依据：
   - 不得虚构
   - 写入 needsConfirmation 让用户确认
3. 语气、措辞、格式参考已确认本人条目（如有）；没有时不强求风格
4. 禁止伪造：不得编造本人事实、不得越过已声明边界
5. 本任务只是起草；不会自动发送，发送前用户必须再次确认
```

#### 3.1.3 视频音频 prompt 重写（行 568-587 段）

**替换 system prompt 为**：

```
你是数字之我背后支撑的 AI 创意助理。数字之我提供：
- 本人已确认的事实/观点（注入见下方）
- 已声明的创意偏好与禁区
- 已声明的表达风格

你的工作方式：
1. 脚本与分镜用 AI 通用能力生成；这是你的能力上限
2. 人名、机构、数据、承诺等关键事实若无依据：
   - 不得虚构
   - 写入 needsConfirmation
3. 创意方向与表达风格参考已确认本人条目（如有）；没有时不强求风格
4. 分镜脚本必须结构化：每个场景包含画面、旁白、时长
5. 禁止伪造：不得编造本人事实、不得越过已声明边界
```

#### 3.1.4 新增测试钩子（不改业务，仅导出 system 字符串）

在 `result-generation.js` 末尾 `module.exports` 块**新增**：

```javascript
// 校准 vs 限制原则（VL1-FIX）：仅供 test-vl1-prompt-calibration 断言用
PROMPT_TEMPLATES: {
  research: {
    systemTemplate: "你是数字之我背后支撑的 AI。数字之我提供：...（完整原文，不带 skill/steps 动态部分）",
    hasCalibrateLanguage: true,
    hasLimitLanguage: false,
  },
  email: { ... },
  videoAudio: { ... },
},
```

具体 system 字符串是 3.1.1-3.1.3 重写后的**完整原文**（不带 `${systemHint}` / `${steps}` 等占位符的实际值；测试要校验占位符结构与措辞是否对齐校准原则）。

### 3.2 新增测试文件 `test-vl1-prompt-calibration.cjs`

**11 条必过用例**（参考 c3f7eb2 的 11 条粒度测试结构）：

| # | 用例 | 期望 |
|---|------|------|
| 1 | 研究 prompt 不含"必须遵守已注入的 Skill 方法与证据边界" | 通过 |
| 2 | 研究 prompt 不含"结论必须受限" | 通过 |
| 3 | 研究 prompt 不含"每条 inference 至少引用一个有效 claimId 或 resultRef" | 通过 |
| 4 | 研究 prompt 含"AI 通用能力"+"能力上限"明示 | 通过 |
| 5 | 研究 prompt 显式列出"价值观、风格、安全、边界"四类校准维度 | 通过 |
| 6 | 研究 prompt 含"禁止伪造"+"禁止编造 claimId / URL" | 通过 |
| 7 | 研究 prompt 在 `continueWithoutExternalSources` 模式下含"通用知识答"+"不限制输出" | 通过 |
| 8 | 邮件 prompt 不含"必须符合已确认本人条目体现的表达风格" | 通过 |
| 9 | 视频音频 prompt 不含"叙事口吻、表达风格与创意偏好必须符合已确认本人条目体现的特点" | 通过 |
| 10 | 三个 prompt 产物 JSON 字段定义保持不变（regression guard） | 通过 |
| 11 | 三个 prompt 都导出 `PROMPT_TEMPLATES` 供断言 | 通过 |

### 3.3 文档同步

#### 3.3.1 规格 v0.1.0 → v0.1.1

`digitalme_first_vertical_loop_spec_v0.1.md`：

- 版本：v0.1.0 → v0.1.1
- 状态：`spec_frozen` 保持
- 在 §3 Subject Context 之后**新增 §3.4**：

> ### 3.4 校准 vs 限制原则（VL1-FIX 冻结）
>
> 数字之我不限制 AI 通用能力上限。数字之我通过以下五类校准维度介入 AI 生成：
>
> 1. **方向**：本人已声明的研究与判断方向
> 2. **真实性**：本人已确认的事实与观点（注入见 Subject Context）
> 3. **风格**：本人已声明的表达偏好
> 4. **价值观**：本人已声明的立场与禁忌
> 5. **安全**：本人已声明的禁区（医疗确定性建议、法律确定性建议、对外承诺等）
> 6. **边界**：本人已声明的禁止用途
>
> AI 通用能力**完整保留**。三类来源显式区分：
> - 本人事实（claimId 引用）
> - 外部事实（resultRef 引用）
> - 通用推理（无引用，uncertainty ≥ medium）
>
> 缺原料时：不得限制 AI 输出，不得让用户补料。用通用知识答，显式标注来源。

#### 3.3.2 sprint plan v0.1.10 → v0.1.11

`digitalme_first_vertical_loop_sprint_plan_v0.1.md`：

- 版本：v0.1.10 → v0.1.11
- §5 任务表**新增条目**：

| # | 任务 | 状态 |
|---|------|------|
| **10** | **VL1-FIX：把生成 prompt 从「限制」改写为「校准」** | `planned` / `not_started` |

- §6 下一项改为「VL1-FIX 实现（待 Owner 授权）」
- §8 修订记录加：

| v0.1.11 | 2026-07-25 | Owner 真机发现"用户需要补料"触线；修复任务包 VL1-FIX 起草；规格 §3.4 校准原则；下一项 = VL1-FIX 实现；第一段未收口 |

#### 3.3.3 context.md 决策 #102

`digitalme_context.md`：

- 在决策 #101 之后**新增 #102**：

> 102. **校准 vs 限制原则（2026-07-25，VL1-FIX 起草）**：Owner 真机发现研究路径在 autoGenerate 模式下生成"由于本人信息中未提供...需要用户自行补充"，触线。明确原则：数字之我不限制 AI 通用能力上限；数字之我通过方向/真实性/风格/价值观/安全/边界六类校准维度介入。AI 缺原料时用通用知识答，**不得限制输出，不得让用户补料**。三类来源显式区分（本人事实 / 外部事实 / 通用推理）。任务包 `digitalme_phase1_task_VL1-FIX_calibrate_not_limit_prompts_v0.1.md` 起草；规格 §3.4 补。修复未实现。

- §3 已确认决策**新增第 26 条**：

> 26. **校准 vs 限制原则（2026-07-25，VL1-FIX 起草）**：明确数字之我不是限制 AI，而是校准 AI。AI 缺原料时不得限制输出、不得让用户补料；用通用知识答并显式区分来源类别（本人事实 / 外部事实 / 通用推理）。五类校准维度：方向、真实性、风格、价值观、安全、边界。配套规格 §3.4 与决策 #102。修复任务包待实现。

#### 3.3.4 log.md 新增条目 — history / 起草时清单

`digitalme_log.md`：在 2026-07-24 之后**新增**（起草时口径；后续已由实现 / 真机验收 / `accepted` 条目 supersede）：

> ## 2026-07-25（VL1-FIX 起草 · 校准 vs 限制）
>
> ### 本次目标
>
> 1. 起草 VL1-FIX 修复任务包，处理"用户需要补料"触线；
> 2. 把"校准 vs 限制"原则写进规格与决策 log；
> 3. 推进第一段收口前的最后修复。
>
> ### 本次完成
>
> 1. 新增 `digitalme_phase1_task_VL1-FIX_calibrate_not_limit_prompts_v0.1.md`（v0.1.0 / `planned` / `not_started`）；三个 prompt 重写方案、11 条测试用例、文档同步清单；
> 2. 规格 v0.1.1（待升）新增 §3.4 校准原则；sprint plan v0.1.11（待升）新增任务 #10；context.md 决策 #102 起草；本文档新增条目；
> 3. 触线定位：result-generation.js 行 397、410、412-414（研究）、467-470（邮件）、583-587（视频音频）。
>
> ### 待办事项 — superseded
>
> 1. ~~Owner 授权实现后，Cursor/Codex 实施 VL1-FIX~~ → **已完成**（`928aa1a`）
> 2. ~~实施后跑 `test:vl1-prompt-calibration`（11/11）+ 现有回归~~ → **已完成**
> 3. ~~Owner 真机重跑研究类任务确认无"用户需要补料"~~ → **已通过**（`e8b6572` 收口）
>
> ### 重要信息 — superseded
>
> 1. ~~**VL1-FIX 未实现前，第一纵向闭环不能标 accepted**~~ → **已 superseded**：VL1-FIX 与第一纵向闭环均已 `accepted` / `completed`。

---

## 4. 验收标准

### 4.0 Owner 真机验收结论（`accepted`，2026-07-25）

Owner 真机验收**通过**。实现提交 `928aa1a`；文档收口提交 `e8b6572`。验收事实：

1. 成果不再出现「由于本人信息中未提供…需要用户补充」类限制性措辞；
2. AI 可继续使用通用知识和通用能力；
3. 本人事实与通用知识应区分（真机输出中本人事实与通用知识已显式区分）；
4. Digital Me 提供方向、真实性、风格、价值观、安全和边界校准；
5. 不得因个人蒸馏资料不足而降低大模型原有能力。

**不再存在「等待 Owner 真机验证」待办。** 第一纵向闭环正式收口为 `accepted` / `completed`。

### 4.1 自动化（必跑）— history / 实施时验收记录

- `npm run test:vl1-prompt-calibration` → **11/11**
- `npm run test:vl1-block1` → 18/18（无回归）
- `npm run test:vl1-block2` → 全过（无回归）
- `npm run test:vl1-block3` → 全过（无回归）
- `npm run test:vl1-block4` → 10/10（无回归）
- `npm run test:vl1-claim-granularity` → 11/11（无回归）
- `npm run test:act-behalf` → 4/4（无回归）
- `git diff --check` → 本任务修改的文件无 trailing whitespace

### 4.2 真机（Owner 跑）— superseded：已由 §4.0 正式结论取代

> **history**：以下为实施前验收步骤清单；真机验收已于 2026-07-25 完成并通过，见 §4.0。

- 用 `npm start` 拉起 Electron
- 新建任务（**新 taskId**，不是历史任务）
- 任务目标：「评估 AI 主权协作的当前主流产品图景」（或同义改写）
- 走 autoGenerate 路径
- 判定：成果末段**不再**出现"由于本人信息中未提供...需要用户自行补充"；模型用通用知识答并显式标注"通用推理"或"通用知识"。

### 4.3 边界保护（必须守住）

- 守门一：模型不得伪造本人事实（不得编造 claimId）
- 守门二：模型不得伪造外部来源（不得编造 URL 或 resultRef）
- 守门三：模型越过已声明价值观 / 风格 / 安全 / 边界禁区 → 拒绝生成 / 改写
- 守门四：`externalFindings` 不得改写 URL / provider（保留现有约束）

### 4.4 文档同步 — history / 实施时清单

- 规格 v0.1.1：含 §3.4 校准原则
- sprint plan v0.1.11：含任务 #10 + 修订记录
- context.md：含决策 #102 + §3 第 26 条（后续由 #103 正式收口）
- log.md：含 2026-07-25 VL1-FIX 起草 / 实现 / 真机验收条目
- 本任务包 v0.2.0：状态 `accepted`；实现 `928aa1a`；文档收口 `e8b6572`

---

## 5. 风险与回滚

### 5.1 风险

| 风险 | 缓释 |
|---|---|
| 模型从"严格按 claim"变成"过度自由发挥"，越线 | 守门一/二/三/四强制 + 11 条测试断言包含"禁止伪造" + `inference` uncertainty 强制 ≥ medium 当无引用时 |
| 用户在 "已确认本人条目" 为空时仍期望"高度个性化" | §3.4 与决策 #102 明确"无相关信息时不做个性化"已对齐；新 prompt 显式不强制风格 |
| 规格 v0.1.1 引入新原则后，与 v0.1.0 §3 已有规则冲突 | §3.4 显式说"§3 之前规则以校准为前提重读"；v0.1.1 修订记录里说明 |
| 修复与 `2f1b7bd` doing-context 装配冲突 | 验证：在 confirmedContext 为空时，prompt 仍能用通用知识答（不卡死） |
| 测试钩子 `PROMPT_TEMPLATES` 被外部误用 | 仅作测试导出；不在 IPC handler 里引用；JSDoc 标注「internal test-only」 |

### 5.2 回滚

- 本任务**单 commit 范围**：源码 + 测试 + 4 文档（实现提交 `928aa1a`）
- 如发现新原则破坏既有体验，revert 该 commit 即可（git log --oneline 找 VL1-FIX commit）
- 回滚后第一段回到 v0.1.10 状态（已知有触线）；Owner 可重新授权修复

---

## 6. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-25 | 起草；触线定位、修复方案、测试清单、文档同步清单、验收标准 |
| v0.1.0 → implemented | 2026-07-25 | **history**：实现提交 `928aa1a`；状态曾为 `implemented_pending_owner_verify` |
| v0.2.0 | 2026-07-26 | **`accepted`**：Owner 真机验收通过；文档收口 `e8b6572`；第一纵向闭环正式收口；取消「待真机验证」待办；BASELINE-CLEAN-01 入库 |
