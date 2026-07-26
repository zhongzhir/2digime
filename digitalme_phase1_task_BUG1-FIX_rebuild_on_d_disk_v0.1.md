# 任务包 BUG1-FIX：从头在 D 盘 e8b6572 基础上重做 BUG1 修复

版本：v0.1.0
日期：2026-07-25
状态：`accepted` / **P0+P1 技术修已在 D 盘合入；#4/#6 仍等 Owner 决策**
所属基线：`e8b6572` 起；实现 commits 见 log 2026-07-25 BUG1-FIX 条目
云盘 working copy 的 5 个 M 改动（之前在 ChatGPT 那边修过的 BUG1 产物）：**Owner 已决定弃用，本任务不依赖**。备份在 D 盘 `.codex-qa/cloud-bug1-fixes-2026-07-24/` 仅作参考。

---

## 0. 文档地位与背景

- 2026-07-25 Owner 决定工作目录为 D 盘；云盘 working copy 弃用。
- 之前 ChatGPT 那边 codex 修过 BUG1（详见 Owner ChatGPT 工作记录 7-24）：P0 布局 / 折叠 / 成果 / P1 入口 / 设置 / 多模型 / 蒸馏我。但**这些修复在云盘 working copy 的 5 个 M 改动里**，未 commit 到 D 盘。
- 当前 D 盘 `e8b6572` 基线已包含 R0 / R1 / R2 / distill-me 装配 / VL1-FIX。
- BUG1.docx 列了 10 条问题。本任务包**从头在 D 盘 e8b6572 基础上重做 BUG1 修复**。

---

## 1. 目标（一句话）

把 BUG1.docx 列的 10 条问题按"技术修 / 产品决策"两类分流：技术修的 6 条**直接实现并验收**；产品决策的 4 条**等 Owner 给方向后**再实现。

---

## 2. 范围

### 2.1 BUG1 10 条分流

| # | 类别 | 描述 | 处置 |
|---|------|------|------|
| 1 | 技术修 | 右下角版本信息遮挡输入框 | **本任务实现** |
| 2 | 技术修 | 对话·「送到工作台」点击后效果问题 | **本任务实现**（D 盘已不显示"送到工作台"文案，需真机核） |
| 3 | 技术修 | 对话·展开/收起按钮点了文本框不变 | **本任务实现** |
| 4 | **产品决策** | 做事流程到复制就结束，要 95 分位产出物 | **等 Owner 给方向**（流程定义、合格标准） |
| 5 | 技术修 | 「我」要分：认知我 / 蒸馏我 / 身份与协作 三块分开 | **本任务实现**（D 盘已有三 tab 970-972，需真机核） |
| 6 | **产品决策** | 构建原理深入研究，要一套构建框架 | **等 Owner 给方向**（7 模块具体内容） |
| 7 | 技术修 | 身份与协作单独界面 | **本任务实现** |
| 8 | 技术修 | 能力模块信息量过多，要简化 | **本任务实现** |
| 9 | 技术修 | 设置模块内容混乱，要清理 | **本任务实现**（D 盘行 1236 / 1245 仍有"高级/测试工具"） |
| 10 | 技术修 | 模型选择一次只能一个，要多选兼容 | **本任务实现**（D 盘 model-routing.js 有 fallbacks 结构，需 UI 改造） |

**本任务先做 8 条技术修**（#1、#2、#3、#5、#7、#8、#9、#10）。**4 / 6 等 Owner 给方向后另起任务包。**

### 2.2 必改文件

| 文件 | 改动 |
|---|---|
| `digitalme-app/src/renderer/index.html` | "我"页结构、能力页收敛、设置页清理、模型路由 UI、版本信息位置 |
| `digitalme-app/src/renderer/app.js` | 导航逻辑、版本信息渲染、模型路由保存逻辑、能力页 / 设置页 / 身份与协作交互 |
| `digitalme-app/src/renderer/styles.css` | 布局修复（版本信息不遮挡）、折叠 CSS 状态、身份与协作独立视觉、能力页 / 设置页视觉收敛 |
| `digitalme-app/src/main.js` | 模型路由 IPC（多 provider / 多 model / 备用） |
| `digitalme-app/src/preload.js` | 新 API surface（如需要） |
| `digitalme-app/scripts/test-bug1-fix-*.cjs` | 新增验收脚本（按修复项） |
| `digitalme-app/package.json` | 新增 test 脚本 |
| `digitalme_context.md` | 决策 #104（如适用） |
| `digitalme_log.md` | 新增 BUG1-FIX 条目 |

### 2.3 明确不做的范围

- 不修改 `digitalme-app/src/act-behalf/*`（第一纵向闭环已收口）
- 不修改 R0 / R1 / R2 已 accepted 部分
- 不动 `digitalme-app/src/doing-context.js`（`2f1b7bd` 收口）
- 不动 `digitalme-app/src/act-behalf/result-generation.js`（VL1-FIX 收口）
- **不依赖云盘 working copy**（Owner 已决定弃用）
- **不实现 BUG1 #4（95 分位产出）和 #6（构建框架）**——等 Owner 给方向
- **不开新分支**——按之前 VL1-FIX 模式，**直接合入当前分支** `codex/dm-core-01a-act-behalf`

---

## 3. 实施步骤

### 3.1 实施顺序（P0 优先，P1 跟进）

**P0（必做，先做）**：
- **BUG1-P0-1** = 桌面端布局（#1）= 版本信息位置 + 桌面窗口约束
- **BUG1-P0-2** = 展开/收起（#3）= 长回复折叠高度 + 按钮文案 + aria-expanded 同步
- **BUG1-P0-3** = 成果闭环（#2、#4 部分）= 任务成果可保存到本机 + 页面显示名称/类型/保存状态（**不含** 95 分位产出定义）

**P1（跟进）**：
- **BUG1-P1-1** = 「我」分三块（#5）= D 盘已有三 tab，真机验证 + 视觉增强
- **BUG1-P1-2** = 身份与协作独立界面（#7）= 独立侧栏入口 + 独立页面
- **BUG1-P1-3** = 能力页收敛（#8）= 普通用户默认只看到 4 类：能做什么 / 公共能力 / 我的技能 / 我的成果；MCP / 命令 / 日志等放高级
- **BUG1-P1-4** = 设置清理（#9）= 高级/测试工具、本地命令、主体编排、系统日志收进"高级/开发者"
- **BUG1-P1-5** = 多模型路由（#10）= 多 provider / 多 model / 备用顺序 / 按任务分工；密钥只在 main 层

### 3.2 每个 sub-task 实施要求

每个 sub-task 必须：
1. 真实 Electron 视觉/功能验收（不是单元测试掩盖）
2. 使用临时 userData / 临时 packageDir
3. 不修改真实 digital-me-package
4. 一个 commit（按 P0 / P1 分批可一次提交一个或一组）
5. 提交后跑对应回归（test:owner-runtime / test:visual-acceptance / test:doing-context-acceptance / test:r1-spike / test:pan-01s-owner-runtime）

### 3.3 必跑回归

- `npm run test:owner-runtime` — 必须 5/5 通过
- `npm run test:visual-acceptance` — 窗口尺寸 7 组合必须全 PASS
- `npm run test:doing-context-acceptance` — 6/6 不得回归
- `npm run test:r1-spike` — 不得回归
- `npm run test:pan-01s-owner-runtime` — 9/9 不得回归
- `npm run test:vl1-block*` — 不得回归
- `git diff --check` — 本任务文件无 trailing whitespace

### 3.4 不容许的捷径

- 不通过隐藏版本信息、删除提示或放宽断言掩盖失败
- 不通过删除检查、降低超时掩盖失败
- 不修改已通过 Case 的断言
- 不直接改 DOM 绕过真实 UI
- 不直接调 IPC 绕过真实入口
- 不调用 `assembleDoingContext` 绕过真实装配

---

## 4. 验收标准

### 4.1 P0 验收（必过）

- **BUG1-P0-1**：
  - 7 个窗口/缩放组合（1280×720 / 1920×1080 / 100% / 125% / 150% / 最大化）下：
    - 输入框始终可见、可点击
    - 版本信息、诊断提示、Toast 不遮挡输入区
    - 主内容无核心横向溢出
  - 保存截图与机器可读记录到 `.codex-qa/bug1-fix/p0-1-window-acceptance/`

- **BUG1-P0-2**：
  - 创建或载入一条足够长的回复
  - 点击"展开"：高度真实增加 + 全文可见 + 按钮文案变"收起" + `aria-expanded=true`
  - 点击"收起"：高度恢复 + 按钮文案变"展开" + `aria-expanded=false`
  - 重启 Electron 后重新打开会话：再次展开/收起状态同步
  - 保存截图到 `.codex-qa/bug1-fix/p0-2-fold/`

- **BUG1-P0-3**：
  - 自动任务的成果可保存到本机任务库
  - 页面显示：成果名称 + 类型 + 保存状态
  - "保存成果 / 采用为成果" 按钮可用
  - "做事 > 任务列表" 可重新打开继续修改
  - 保存成功后的路径可访问
  - 失败时显示重试和继续编辑入口
  - **不**把"复制文本"作为完成状态

### 4.2 P1 验收（必过）

- **BUG1-P1-1**：三 tab（认知我 / 蒸馏我 / 身份与协作）切换正常；互不混淆
- **BUG1-P1-2**："身份与协作"独立侧栏入口 + 独立页面，不作为"我"内 tab
- **BUG1-P1-3**：能力页普通模式只 4 类：能做什么 / 公共能力 / 我的技能 / 我的成果；高级模式含 MCP / 命令 / 日志；能力为空时显示明确下一步
- **BUG1-P1-4**：设置页普通模式只 4 类：模型与默认 / 数据与隐私 / 外观与界面 / 通知偏好；高级/开发者含本地命令 / 主体编排 / 系统日志
- **BUG1-P1-5**：多 provider / 多 model 配置；按任务分工（对话 / 成果 / 质检）；备用模型顺序；模型不可用时可理解的错误和切换入口；密钥只在 main 层；UI 文案用"按任务分工 / 备用模型"不用"同时调用多个模型"

### 4.3 文档同步

- `digitalme_context.md`：决策 #104（BUG1-FIX 收口）
- `digitalme_log.md`：2026-07-25 BUG1-FIX 实施条目
- 在 commit 前不向 master / remote push（Owner 已确认无远端）

---

## 5. 风险与回滚

### 5.1 风险

| 风险 | 缓释 |
|---|---|
| 修改 renderer / styles 与 R0 / R1 / R2 已 accepted 部分冲突 | 每个 P0 sub-task 跑 R1 / PAN-01S 回归；不通过即回滚 |
| 云盘 working copy 的修复方案与本任务方案不同 | 备份在 `.codex-qa/cloud-bug1-fixes-2026-07-24/`；Owner 已决定弃用云盘，**不参考** |
| 8 条技术修范围太大，单次 PR 难 review | 按 P0 / P1 分批，每批 1-3 个 sub-task |
| Owner 已决定工作目录为 D 盘 | 本任务全部操作在 D 盘 e8b6572 基线 |

### 5.2 回滚

- 本任务 P0 / P1 **每批一个 commit 范围**：源码 + 测试 + 文档
- 如发现新原则破坏既有体验，revert 该 commit 即可
- 回滚后 D 盘回到 e8b6572 状态（已知有 BUG1 未修）；Owner 可重新授权

---

## 6. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-25 | 起草；10 条分流（8 技术修 + 2 等决策）；基于 D 盘 e8b6572 重做；不依赖云盘；P0 优先 P1 跟进 |
| v0.2.0 | 2026-07-26 | Owner spotcheck 完，标 `accepted`；8 条技术修（#1/#2/#3/#5/#7/#8/#9/#10）committed；`a5f77a7` docs commit 已入库；任务包本身入库 |
