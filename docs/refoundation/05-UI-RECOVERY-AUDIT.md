# 05 — UI Recovery Audit（Public Alpha 产品面）

**状态：** `P0_IMPLEMENTED / PUBLIC_ALPHA_SURFACE_ACCEPTED / not_a_constitution / not_current_plan`
**日期：** 2026-09-08
**任务：** `DIGITALME-UI-RECOVERY-AUDIT-01`（审计）→ `DIGITALME-UI-PUBLIC-ALPHA-SURFACE-01`（P0 已落地）
**Authority：** `build/tujimi-ui-minimal-integration-01`（实现提交后的最新 HEAD）
**性质：** 审计 + P0 实施记录。不是宪法，不是 Current Plan。
**产品结构权威：** 今天的 00 / 03，不是旧 Figma。

本文回答：此前 Figma UI/UX 升级里，哪些设计资产仍适合今天的 2digime；哪些因架构重构失效；Public Alpha 最小产品面是什么。不是重新设计一版 UI。

---

## 1. 资产盘点

仓库内现有文档没有现行 UI audit。`docs/trials/` 与 `digitalme-v2/docs/design/` 不在当前树。故新建本文，不另建第五份宪法。

### FOUND

| 资产 | 位置 | 说明 |
|---|---|---|
| 暖色纸感 token | `electron/renderer/styles.css` 文首 | 标注 `EXPERIENCE-REDESIGN-01B-B5`：`--bg #f3efe6`、`--ink #1c2430`、`--panel #fffdf8`、`--accent #0f6a5a`、圆角/间距/字体层级 |
| Public trial 视觉层 | `electron/renderer/public-trial.css` | 2026-09-04 三页试用：共享顶栏、阅读宽度、44px 控件、卡片分组 |
| 当前 Electron 三入口壳 | `electron/renderer/index.html` | 「与兔机米 / 数字之我 / 设置」；默认 Talk |
| Talk 主链 UI | `electron/renderer/talk.js` | 空状态、附件 chips、`talk-result-card`（打开 / 在文件夹中显示）、`正在处理…` |
| Digital Self 投影页 | `electron/renderer/digital-self.js` | 分组理解、来源与确认、纠正/删除；明确不展示 Event / Store / confidence |
| Phase 2 产品面测试意图 | `src/intelligence/tests/product-surface-04*.ts` | 附件 = 这次交流的上下文，不是新任务；结果卡标题是文件名；`#nav-work` / `#nav-collab` 不可见 |
| 历史 FigJam（01A） | git `2047d0e` | `https://www.figma.com/board/MzhFrPO0Wctlk3qSCcEAEx` |
| 历史 Figma 审计板（09-04） | git `ef39a27` | `https://www.figma.com/design/uvAnPLjmU62XIy7GhlK7jP` |
| 历史规格 | git `2047d0e` | `digitalme-v2/docs/design/digitalme_v2_experience_redesign_01a_v0.1_20260805.md`（当前树不存在） |
| 历史试用报告 | git `ef39a27` | `docs/trials/2DIGIME-PUBLIC-TRIAL-UI-POLISH-01.md`（当前树不存在） |

Owner 曾接受（2026-09-04，`ef39a27`）：品牌「兔机米」；去掉空对话「兔」装饰；三页暖色视觉。当时说明：该 Figma **是设计说明和历史截图板，不是可编辑组件原型，也不是去装饰后的事实源**。事实源是当时的 Electron 屏。

### PARTIAL

| 资产 | 缺口 |
|---|---|
| Figma 原文件 | URL 可从 **git 历史**恢复；**当前工作树零命中** `figma.com` / `node-id=` / `fileKey`。本环境拉取该 URL 超时，无 Figma MCP，**不能逐帧清点画板**。禁止凭记忆重画。 |
| 视觉双层 | `styles.css`（01B-B5 纸感）与 `public-trial.css`（略偏冷绿、更大字号）并存，未合成单一设计系统。 |
| 空状态「兔」字 | 09-04 已接受删除；当前 `index.html` 再次出现 `#chat-empty .empty-emblem`。 |
| 截图 | `docs/screenshots/` 是占位说明。本地未跟踪 `scripts/_tujimi-ui-minimal-integration/` 有现屏，不入库、不作权威。 |

### NOT FOUND

| 缺什么 | 影响 |
|---|---|
| 当前树内 Figma / FigJam 引用 | 打开仓库无法直接跳到设计文件 |
| 任何 `node-id` | 无法按帧恢复组件 |
| Code Connect / `.figma.ts` | 历史报告已写明没有产品组件库 |
| 仓库内设计导出 PNG/JPG | 无设计稿可当视觉源 |
| 当前树内 01A 规格 md | 只能 `git show` 历史提交 |

**结论：** 设计**意图与视觉语言可恢复**（CSS + 历史文档 + 当前壳）。Figma **源文件不能从当前仓库当可编辑原型打开**。缺的是：当前树引用、node id、组件库、导出图。不要假装能打开原稿重画。

---

## 2. 今天的产品结构（不以旧 Figma 反写）

一级入口最多三个：

```text
与 2digime     主入口。聊天 → 表达目标 → 判断 → 回答 / 获能力 / 调 Agent / 用网络 → 结果
数字之我       现在怎样理解我 / 最近学到什么 / 来源 / 可纠正 / 如何成长。不是 Profile 编辑器
设置           真设置。Provider / Runtime / MCP / Agent / Relay / Capability registry 不是普通用户主体验
```

禁止恢复独立「做事中心」。禁止把 Network 做成协作中心或 Facebook/TikTok Feed。第一版不必有一级「网络」Tab。`NetworkItem` 已落地 ≠ 立刻做信息流 App。

四层体验检查（不是介绍长页）：

1. **第一分钟：** 很好聊。  
2. **第一个任务：** 只要告诉它目标，它真能替我做。  
3. **用几次以后：** 它开始了解我，这些认识是我的。  
4. **网络开始以后：** 它能主动替我从外部世界找到真正适合我的东西。

---

## 3. 用三核心审计旧设计

### A. 属于我 — Digital Self

01A 把数字之我写成「你理解得对不对」的核对页，并配套成长驾驶舱。09-04 三页试用把它收成「当前理解 + 告诉/导入/纠正」。

今天仍正确的意图：主体感、来源、可纠正。  
已失效：完成度条、学习流水账、把成长做成第二套驾驶舱、内部数据结构。

当前代码：`digital-self.js` 投影分组 + 来源与确认 + 纠正，方向对；同一 `panel-subject` 仍挂着 hidden 的 `growth-block` / cockpit（已经了解 / 还可以了解 / 完整情况 / 其他完善方式）。主路径若露出 cockpit，就会重新变成档案柜。

### B. 能做事 — AI Capability

01A **默认着陆在「做事」**，对话可「转为任务」，材料进做事工作台。这与今天「对话是统一入口、做事是行为/结果」冲突。

旧稿里应重新判断、原则上不再作为普通入口的：

- 任务类型选择  
- 工具 / Agent 选择  
- 复杂工作流工作台  
- 独立「做事」导航  
- 「转为任务」  

理想：告诉 2digime 想做什么 → 必要确认 → 结果。能力获取基本静默。

当前 Talk **已经能做事**（Zero-start Coding 等已接受）。缺口在体验：输入区偏小、doing 只有「正在处理…」、结果卡次要动作像系统文件菜单。

### C. 连接世界 — Subject Network

01A 把「协作」设为四主栏之一，并在做事页内嵌协作长文。这是旧第三核心误读。

今天：协作是网络的一种应用，不是一级 Tab。网络选择结果应能自然出现在「与 2digime」（例如「今天有什么真正值得我关注？」），而不是传统 Feed。

**本轮明确：**

```text
NO Facebook-style feed
NO TikTok-style recommendation surface
NO collaboration center
NO 现在选型 Today / For me / 通知中心
```

可研究、不实施：Talk 中的 network result；2digime 主动告诉我；可展开的信息集合。

---

## 4. 当前 Electron 逐屏对照

| 页面/区域 | 当前作用 | 真实能力是否存在 | UX 问题 | 旧设计是否可继承 |
|---|---|---|---|---|
| 主导航 | 与兔机米 / 数字之我 / 设置 | 是 | `#nav-work` / `#nav-collab` 仍在 DOM（hidden） | KEEP 三入口；RETIRE 四栏 |
| Welcome | 连接模型或跳过 | 是（密钥本机） | 标题「建立你的数字之我」像问卷；可跳过但话术偏设置 | ADAPT：连上就聊 |
| Talk 空状态 | 「从你此刻的想法开始」 | 是 | 已接受删除的「兔」字回归；`#first-value` 仍在 DOM（hidden） | KEEP 文案；RETIRE 装饰字 |
| Talk 输入 | `textarea#chat-input` rows=3 | 是 | 复杂目标写不下；composer 视觉保留但高度不够 | ADAPT 尺寸；KEEP 纸感输入 |
| 文件/文件夹 | `＋` 菜单 → chips | 是；路径只进该次 talk | 控件弱；用户不应感到「参考资料」 | KEEP 能力；ADAPT 语义为「这次一起看的东西」 |
| doing | 「正在处理…」 | talk 主链存在 | 无「我在替你做」的掌控感；也不应暴露 tool 名 | ADAPT 轻量反馈 |
| result | 文件名 + 打开 + 在文件夹中显示 | `openPath` / `revealPath` 存在 | 「在文件夹中显示」像系统菜单；缺对话内预览 | ADAPT：打开为主，文件夹为次 |
| Digital Self | 理解分组 + 纠正 | 是（Talk 可写入） | 与 Talk「告诉」双入口；growth cockpit 重复、偏内部 | KEEP 投影；RETIRE cockpit |
| Settings | 模型 + Gemini 搜索 | 是 | 中继 / 代码执行 / 专业能力对普通用户仍可见（details） | ADAPT：默认只留连接 |
| `#panel-work` | 旧做事中心 | 正式默认不挂旧 Work Runtime | 不得恢复 | RETIRE |
| `#panel-collab` | 旧协作中心 | 协作应用可在 Talk 发生 | 不得恢复一级入口 | RETIRE |
| Network | 无产品 UI | `NetworkItem` + 本地选择已 ACCEPTED | 不要做成 Feed 页 | MISSING：应进 Talk，不进新 Tab |
| 帮助 | 顶栏次级 | 文案存在 | 易变成长介绍 | ADAPT 极短 |

用户已指出、本轮核对成立的问题：文字偏多/重复（设置可选块 + Digital Self 双套）；技术信息暴露（高级连接、中继、执行器）；复杂任务输入过小；附件语义弱；结果打开不自然；「我」和掌控弱于系统流程。

---

## 5. 旧设计四类（元素只进一类）

### KEEP

- 暖色纸感色彩、主行动色 `#0f6a5a`、卡片、细边框、低阴影  
- 对话流布局：空状态大标题 + 底栏输入 + 独立滚动  
- 共享顶栏 + 一处高亮目的地（09-04）  
- 结果用**文件名**而不是内部 ID  
- Digital Self：当前理解、来源、纠正/删除  
- 设置：密钥本机、Base URL / Model ID 默认收起  
- 品牌「兔机米」；空状态无「兔」装饰（按 09-04 已接受事实）  
- 附件作为**该次交流上下文**（产品面测试已写死）

### ADAPT

- 信息架构：四主栏 / 默认做事 → 三入口 / 默认 Talk  
- Talk 输入高度与附件可见性  
- 结果卡：打开是主路径；文件夹显示降为次要  
- doing 文案：让人感到它在做事，不列 Agent/工具  
- Digital Self 文案：成长感来自「最近学到 / 来自哪里」，不是 cockpit 计数  
- 设置：中继、执行器、专业能力留在真正高级，且不对新用户展开  
- 两套 CSS token 合成一层视觉，不新发明皮肤  
- Welcome：连接/获得 AI → 进入与 2digime，不做主体建设长页

### RETIRE

- 一级「做事」「协作」  
- 做事三栏工作台（任务列表 / 大目标框 / 成果编辑器）作为普通表面  
- 「转为任务」  
- 任务类型 / 工具 / Agent 选择器  
- 协作中心、关注/订阅、Feed Tab  
- 成长驾驶舱、完整情况、其他完善方式作为主 UI  
- 默认暴露 Provider 控制台、Relay 协议、Capability registry  
- 01A「材料纳入摘要」作为用户必须理解的步骤（能力可静默）

### MISSING

- 聊天即做事：第一个真实任务的结果自然留在同一条对话里（能力有，体验未完成）  
- 「这些认识是我的」：来源可信、可纠正，但页上仍像列表档案  
- 网络结果出现在 Talk（后端薄片有，产品面没有，且本轮**不**用独立 Feed 填这个洞）  
- 用户感到掌控：必要确认、可取消、结果就是那份文件——不是流程仪表盘

---

## 6. 视觉资产：结构变了 ≠ 皮肤作废

应最大程度复用：

| 元素 | 处置 |
|---|---|
| 色彩 / 字体层级 / spacing / card | KEEP（01B-B5 + 09-04 控件尺寸） |
| 输入框 / conversation layout / navigation | KEEP 语言，ADAPT 主入口与输入高度 |
| icon / empty state | KEEP 低装饰；RETIRE 已删除的「兔」字 |
| result 展示 | ADAPT 卡片，不恢复做事页大编辑器 |
| loading / doing | ADAPT 轻反馈，不恢复分析过程长面板 |

禁止本轮新做一套 Figma 组件库。历史 Figma 板不是 Code Connect 源。

---

## 7. Public Alpha 最小表面

### 三个一级入口

1. **与 2digime** — 唯一工作台。聊、交代目标、看结果、将来看见网络替我选出的东西，都在这里。  
2. **数字之我** — 只解释与控制「它现在怎样理解我」。  
3. **设置** — 连接 AI；可选联网搜索。其余折叠。

### 首次使用

```text
安装
→ 连接 / 获得 AI
→ 进入与 2digime
→ 开始聊天
```

不要先完成复杂 onboarding、七模块档案、协作配对、Feed 订阅。

### Talk 如何承载做事

用户只说话（可附文件/文件夹作为**这次的上下文**）。2digime 判断后自己回答或调用已授权能力。必要确认后再改用户的东西。结果以对话中的文件/成果出现，**打开**即可用。不出现任务类型、Agent 名、工作流步骤作为主 UI。

### 数字之我如何调整

保留：现在怎样理解我、来源、纠正、删除。  
拿掉主路径：growth cockpit、完整情况、其他完善方式、与 Talk 重复的长说明。  
「告诉兔机米」可以留一处短入口，但成长的主发生地仍是 Talk。

### Subject Network 如何进入 UX

现在：**不进入独立页面。**  
以后：作为 Talk 的自然能力与主动告知。不把刚完成的 `NetworkItem` 做成信息流 App。

### Feed 是否独立页面

**否。** Public Alpha 不做 Feed 页。

---

## 8. Figma 裁决

**RECOVER_AND_ADAPT**

不是 RECOVER：当前树没有可打开的 Figma 原型；09-04 文件自己写明不是组件库；01A FigJam 的 IA（做事默认、四主栏、协作一级）已被今天的三核心推翻。

不是 REDESIGN：Owner 已接受暖色三页视觉与品牌；01B-B5 token 仍在生产 CSS 里；丢掉它们等于无根据地重做皮肤。

依据：恢复已落地视觉语言与三入口壳；按今天「与 2digime / 数字之我 / 设置」重映射信息架构；退休做事/协作中心与技术控制台主体验。

---

## 9. 最小实施清单

下一实现任务应只做下列项。禁止展开成几十条 UI backlog。

### P0（Public Alpha 前，7 项）— 2026-09-08 已完成

1. **锁三入口。** DONE。默认「与兔机米」。`#nav-work` / `#nav-collab` 对普通用户不可见。
2. **Talk 输入可用。** DONE。默认轻量，随内容增高至 `min(42vh, 360px)`；附件为「这次一起看的文件/文件夹」。
3. **结果在对话里。** DONE。结果卡含「这次完成的结果」+ 文件名；「打开」为主动作。
4. **doing 有主体感。** DONE。「正在替你做」/「正在查看结果」，可取消；不暴露 Agent / 工具 / 协议。
5. **数字之我去驾驶舱。** DONE。主页为当前理解 / 最近了解 / 来源 / 纠正；growth cockpit 退出普通路径。
6. **设置变设置。** DONE。默认 AI 连接 + 可选联网搜索；中继、执行器、专业能力收入默认收起的「高级」。
7. **首次即聊 + 已接受视觉。** DONE。AI 已连接则进入 Talk；`public-trial.css` 暖色纸感与 01B-B5 对齐；「兔」装饰已删。

**裁决：** `PUBLIC_ALPHA_SURFACE_ACCEPTED`（三条真实 UI Trial A/B/C 通过。未做 Feed / 协作 UI。两套 CSS 完整合并仍属 P1。）

### P1（开放试用后）

- 会话列表（现有 aside 可再评估，不作新一级）  
- Talk 内呈现网络选择结果 / 主动告知（仍无 Feed Tab）  
- 成果轻预览（仍不恢复做事大编辑器）  
- 两套 CSS token 收成一层  

P1 不做：Computer Use 产品面、协作中心、RSS/信息流 App、新 Figma 体系。

---

## 10. 本轮明确不做

改 React/Electron UI；调 Figma；新建 Feed；恢复 collaboration 页；Computer Use；改 Digital Self 数据规则；改 network runtime；接 RSS；push；release。
