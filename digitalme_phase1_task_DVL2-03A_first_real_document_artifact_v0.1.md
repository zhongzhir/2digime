# 任务包 DVL2-03A：首个真实文档成果垂直切片

版本：v0.1.0-draft  
日期：2026-07-26  
状态：`spec_and_authorization_drafting` / `codex_review_pending`  
实施：`not_started`  
implementation_authorized：`false`

上位基线：

| 基线 | 引用 |
|------|------|
| DVL2-00 | `digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md`（v0.1.1 冻结合同） |
| DVL2-01 | `accepted_as_implemented` |
| DVL2-02 | `accepted_as_implemented` / `implemented` |
| DVL2-02 实现 | `20c883298ba9f2e5e707015c4fd6c9dd109ad601` |
| DVL2-02 证据 | `866f2b2e3400da81d1afc1a54b6477f679766cc6` |
| DVL2-02 Owner runtime | `ceb6c8364c5fefcbab16da5e1aaa05477a5ff5e7` |

> **压缩流程**：本文同时承担规格草案与实施授权草案。**不再**单独建立 implementation authorization 文档。后续由 Codex **一次集中评审**，Owner **一次同时**完成 `owner_accepted` + `frozen_for_implementation` + `implementation_authorized`。在此之前：**不得编码**、**不得创建实现分支**、**不得 push**。  
> 冲突时：架构原则文 > DVL2-00 > DVL2-01 > DVL2-02 已实现语义 > 本文。

---

## 0. 本轮目标与非目标

### 0.1 产品目标（冻结意图）

用户从已准备的 `DeliverablePackage` 中，对一个 **document** 型 `Deliverable` 启动真实生成；系统调用现有可用模型能力，生成真实 **Markdown** 与 **HTML** 文件；用户可在本地打开成果；应用重启后仍能恢复并打开同一版本；并可接受或否定该具体版本。

完整用户闭环：

```
confirmed plan
→ prepared package
→ document Deliverable
→ 开始生成
→ 真实模型输出
→ 写入真实 Markdown
→ 写入真实 HTML
→ DeliverableGenerationAttempt
→ DeliverableVersion
→ ArtifactRef + contentHash
→ 用户打开成果
→ 重启恢复
→ 接受或否定该具体版本
```

**本轮结束必须存在用户可以实际打开的真实成果文件。**

### 0.2 明确非目标

- DOCX / PPTX / PDF / 图片 / 多页网站；
- 多成果并行生成、复杂依赖调度、自动发布、对外分享；
- 通用渲染平台 / 大型文档框架；
- 修改 DVL2-00 / DVL2-02 冻结合同语义；
- 改造 `src/package-store/**`；
- 把 VL1 `result-generation.js` 旧链路接到 confirmed plan 冒充本切片；
- 在获 Owner 一次授权前编码或创建实现分支。

---

## 1. 首批成果类型（唯一垂直切片）

| 项 | 冻结 |
|----|------|
| `kind` | 仅 `document` |
| 内容权威 | **Markdown**（`.md`） |
| 可打开呈现 | 由同一内容生成的 **HTML**（`.html`） |
| 计划 format 字段 | 可保留计划中的 `docx`/`md` 等标注；本切片实际写出为 `md` + `html`（符合 DVL2-00「docx 或 md」中的 md 路径） |

不支持类型：明确显示「该成果类型尚未接入真实生成」；**不创建假文件**。

---

## 2. 真实成果判定（十二项同时满足）

只有同时满足以下条件才可称「真实成果」：

1. 调用了现有正式模型适配路径（见 §5）；
2. 模型返回非空、有意义的成果内容；
3. 内容写入隔离的本地成果目录（见 §4）；
4. Markdown 文件真实存在；
5. HTML 文件真实存在；
6. 文件可由用户打开（经安全解析后的绝对路径 + `shell.openPath`）；
7. 计算真实 `contentHash`（`sha256:…`）；
8. 创建真实 `DeliverableVersion`；
9. 创建真实 `ArtifactRef`；
10. `currentVersionId` 指向真实版本；
11. 重启后仍能恢复并打开；
12. UI 不使用假路径、假预览或内存占位冒充文件。

---

## 3. 正式输入合同

**唯一正式生成入参：`packageId`**（承接 DVL2-02 §18）。

可选附加（不得替代 packageId）：

- `deliverableId`：本切片默认选取 package 内第一个 `kind=document` 且 `planDisposition=included` 的项；若显式传入必须属于该 package。

禁止：

- 只传 `taskId` 后自行挑「最新计划」；
- 从 current draft 生成；
- renderer 构造权威 prompt / 传入模型密钥；
- 把 `activePackageId` 当作唯一调用合同（仅可用于 UI 默认导航）。

main 必须自行：

1. 读取 package / deliverables / executionSnapshot；
2. 校验 package 与 snapshot 完整；
3. 校验目标 Deliverable 为 document + included；
4. 检查模型可用性；
5. 创建 attempt → 调用模型 → 原子写盘 → Version/ArtifactRef → 更新指针。

---

## 4. 文件存储方案（推荐终稿）

审计结论：DVL2-02 Store 为 `<userData>/deliverable-packages.json`（元数据）；真实文件应与元数据分离，避免 JSON 膨胀与迁移困难。

**推荐根目录：**

```
<userData>/deliverable-artifacts/
  <packageId>/
    <deliverableId>/
      <versionId>/
        artifact.md
        artifact.html
        manifest.json
```

相对路径（写入领域对象，**禁止绝对路径**）：

```
deliverable-artifacts/<packageId>/<deliverableId>/<versionId>/artifact.md
deliverable-artifacts/<packageId>/<deliverableId>/<versionId>/artifact.html
```

`manifest.json` 至少包含：

| 字段 | 说明 |
|------|------|
| `schemaVersion` | 1 |
| `packageId` / `deliverableId` / `versionId` / `attemptId` | 身份 |
| `createdAt` | ISO 时间 |
| `markdownRelativePath` / `htmlRelativePath` | 相对 userData |
| `contentHash` | 权威内容哈希（见下） |
| `modelProvenanceSummary` | 无密钥：providerId / model / taskType / fallbackUsed |
| `sourcePlanVersionId` | 来自 snapshot |
| `sourceSnapshotDigest` | `executionSnapshot.sourcePlanDigest` |

**contentHash 规则（建议冻结）：**

- 权威 hash = Markdown 原文的 `sha256:`；
- HTML 另记 `htmlContentHash`（manifest 与 HTML ArtifactRef）；
- Version 级展示 hash 以 Markdown 权威 hash 为准。

运行时：`path.join(userData, relativePath)`；必须拒绝 `..` 路径穿越。

Staging：先写 `<versionId>.staging/`，成功后原子 rename 为 `<versionId>/`。

---

## 5. 模型 adapter 只读审计结果

| # | 问题 | 结论 |
|---|------|------|
| 1 | 现有入口 | `main.js`：`callModel` → `invokeModelRoute`（`src/model-routing.js`）→ `callModelRaw`（OpenAI-compatible `/chat/completions`）；任务类型含 `artifact` |
| 2 | 非流式完整文本 | **支持**：`callModel` 返回完整 `content` 字符串 |
| 3 | 取消 | **流式** `callModelStream` / `callModelStreamRaw` 已支持 `AbortSignal`；**非流式** `callModelRaw` **当前未接 signal**。DVL2-03A 允许有界补齐：给 `callModelRaw` 增加 abort，或本切片走可取消的 stream 并在结束后取全文 |
| 4 | 错误记录 | `normalizeModelError` + `recordModelRoutingAttempt`；友好文案「当前模型不可用…」；本切片 UI 在未配置时改用「尚未配置可用生成模型」 |
| 5 | 密钥 | 密钥在 secretStore；routing 审计只记 provider/model/errorCode；**禁止**把 apiKey 写入日志 / attempt / Version provenance |
| 6 | 输入构建 | main 侧根据 snapshot + Deliverable 构造 messages；renderer 不得权威拼装 |
| 7 | 输入输出上限 | 任务包要求实现有界截断（建议：system+user 合计字符上限、输出最小非空与最大长度）；超限 fail-closed |
| 8 | 测试 mock | 复用 `provider.type === "fake"` 路由，或注入 `callModel` 依赖；自动测试 **不得**消耗真实额度 |
| 9 | Owner 真机 | 使用 Owner 已配置的真实模型（`artifact` 路由）；不在仓库提交密钥 |
| 10 | 无模型配置 | `MODEL_NOT_CONFIGURED` / `PROVIDER_NOT_CONFIGURED` → 准确提示「尚未配置可用生成模型」；**禁止**伪生成 |

**复用裁定**：优先复用 `invokeModelRoute` + `callModel`；不新建第二套付费调用栈。允许在 `main.js` 做最小 abort 补齐。

---

## 6. 内容生成输入

必须来自：

- `package.executionSnapshot`（不可变）；
- 当前 `Deliverable`（title / purpose / kind / format / order / dependencies）；
- 用户确认的目标、受众、用途（snapshot.inputSummary / understanding）；
- 依赖成果摘要（本阶段无则空数组）；
- 可用上下文的有界摘要（若有 subject snapshot id，只引用 ID + 短摘要，不倾倒全文）。

禁止：

- 从 current draft 生成；
- 临时选择「最新计划」；
- 把完整无界附件原文直接拼入请求；
- 读取与当前任务无关的用户数据；
- renderer 构造权威 prompt。

---

## 7. 核心对象（与 DVL2-00 对齐）

### 7.1 DeliverableGenerationAttempt（本切片新增运行记录）

DVL2-00 以 `generationStatus` 为主状态机；Attempt 为可审计运行记录（DVL2-02 已预留至 DVL2-03）。

至少包括：

| 字段 | 说明 |
|------|------|
| `id` | `dgatt_…` |
| `packageId` / `deliverableId` | 归属 |
| `status` | 见下 |
| `startedAt` / `finishedAt` | 时间 |
| `modelAdapter` | 如 `openai-compatible@invokeModelRoute`（无密钥） |
| `inputDigest` | 输入稳定摘要 |
| `errorCode` / `errorSummary` | 失败时白话 |
| `producedVersionId` | 成功时非空 |
| `outcome` | `created_new_version` / `failed` / `cancelled` / `interrupted` 等 |

Attempt `status` 至少覆盖：`queued` · `generating` · `succeeded` · `failed` · `interrupted` · `cancelled`

与 Deliverable `generationStatus` 投影一致：attempt 进行中 → Deliverable `queued`/`generating`；成功落盘 → `generated`（可再入 `validating`→`ready`；本切片可将最小质量门槛合并为写出成功后进入 `ready`，但不得跳过「文件+ArtifactRef 有效」条件）。

### 7.2 DeliverableVersion（对齐 DVL2-00 §4.3.4）

至少包括（字段名以 DVL2-00 为准）：

| 字段 | 本切片要求 |
|------|------------|
| `id` | `dver_…` |
| `deliverableId` | 归属 |
| `version` | 递增整数 |
| `generationStatus` / `reviewStatus` | 版本自身状态 |
| `artifactRef` | **Markdown** 权威引用（DVL2-00 单数字段） |
| `previewRef` | **HTML** 呈现引用（可迁移；非唯一身份） |
| `contentAvailable` | 文件存在且 hash 匹配时 true |
| `generator` | `executionMode` / `modelRoute`（无密钥）/ `fallbackUsed` |
| `provenance` | 至少含 planVersion、modelRoute、actor、generatedAt；subject 快照字段可空但键保留 |
| `quality` | 本切片最小：`verdict: pass` 或 `pass_with_warnings`（写出成功） |
| `supersedesVersionId` / `supersededByVersionId` | 版本链 |
| `createdAt` / `updatedAt` | 时间 |

附加（不冲突）：`generationAttemptId`、`contentHash`（Markdown 权威）。

**说明**：Owner 草案中的 `artifactRefs[]` 映射为 DVL2-00 的 `artifactRef`（md）+ `previewRef`（html）；若实现需要数组便于枚举，可增加 **派生只读** `artifactRefs`，但权威仍以 DVL2-00 字段为准。

### 7.3 ArtifactRef（对齐 DVL2-00 §4.6）

| 字段 | 冻结名 |
|------|--------|
| `storageKind` | `local_deliverable_relative` |
| `relativePath` | 相对 userData |
| `externalUri` | null |
| `contentHash` | `sha256:…` |
| `mimeType` | `text/markdown` / `text/html` |
| `byteSize` | 字节数 |
| `absolutePathCache` | 可选；不得作唯一身份 |

禁止自创与 DVL2-00 冲突的 `mediaType`/`sizeBytes` 作为权威字段名（可作为别名只读投影，但不入持久化权威）。

### 7.4 审阅绑定

- `accepted` / `rejected` **绑定具体 `DeliverableVersion.id`**；
- 新版本不继承旧版本 `accepted`；
- `currentVersionId` ≠ `accepted`。

---

## 8. 写入顺序与失败边界

推荐顺序：

1. 创建 generation attempt（`queued`→`generating`）；
2. 调用模型；
3. 验证输出非空且满足最小结构（至少含标题或正文段落）；
4. 写入 staging 目录；
5. 写 Markdown；
6. 由 Markdown 生成 HTML（本地小型转义/模板，**不新增大型依赖**）；
7. 计算 hash 与 size；
8. 写 manifest；
9. 原子 rename 到正式 version 目录；
10. 创建 `DeliverableVersion` + ArtifactRef（md）+ previewRef（html）；
11. 更新 `currentVersionId` 与 Deliverable 状态投影；
12. attempt → `succeeded`。

任何失败：

- 不得创建成功 Version；
- 不得让 `currentVersionId` 指向不完整版本；
- staging 可清理或隔离；
- attempt 记 `failed` / `interrupted` / `cancelled`；
- 已有旧版本保持可用；
- **不覆盖**旧版本目录。

---

## 9. 最小 UI

成果包准备完成后，对支持的 document Deliverable：

- 主按钮：**生成文档成果**

生成中：准确状态；可取消时显示取消；不显示假百分比。

成功后：标题、版本号、生成时间；**打开 Markdown**；**打开 HTML**；**接受此版本**；**否定此版本**；**重新生成**。

失败后：白话错误；**重试生成**；旧版本仍可打开。

不支持类型：「该成果类型尚未接入真实生成」。

文案禁止：协议名、内部字段名、假预览冒充文件。

---

## 10. 实现范围（获授权后）

### 10.1 推荐实现分支

- 分支名：`codex/dvl2-03a-first-real-document-artifact`
- 起点：DVL2-02 Owner runtime 收口提交 `ceb6c8364c5fefcbab16da5e1aaa05477a5ff5e7`（或当时已含本草案的文档 tip；实现前以 Owner 授权指令为准）

### 10.2 允许新增（建议）

```
digitalme-app/src/act-behalf/deliverable-generation-*.js
digitalme-app/src/act-behalf/deliverable-artifact-fs.js
digitalme-app/src/act-behalf/deliverable-html-from-markdown.js
digitalme-app/scripts/test-dvl2-03a-*.cjs
digitalme-app/scripts/run-dvl2-03a-*-acceptance.cjs
digitalme-app/scripts/electron-dvl2-03a-*-acceptance.cjs
digitalme-app/scripts/dvl2-03a-*-acceptance-harness.cjs
```

### 10.3 允许有界修改

- `deliverable-package-store.js` / schema：增加 versions / generationAttempts 持久化集合（或并列 store 文件，二选一在实现授权时确认；**推荐**扩展同一 `deliverable-packages.json` 顶层，保持 CAS）
- `main.js` / `preload.js`：IPC + 可选 `callModelRaw` abort
- `renderer/app.js` / `deliverable-planner.js` / `index.html` / `styles.css`：生成/打开/审阅 UI
- `package.json`：**仅**增加测试脚本

### 10.4 禁止范围

- `src/package-store/**`
- `package-lock.json`（除非 Owner 另批且论证必须）
- `renderer-next/**`、`entry/**`、`sessions.js`（无必要不改）
- 新增大型文档/渲染依赖
- DOCX/PPT/图片生成器
- 修改 DVL2-00 / DVL2-01 / DVL2-02 冻结合同正文语义

### 10.5 依赖原则

- **默认不新增依赖**；
- HTML 转义与极简 Markdown→HTML 用本地小型实现；
- 不引入大型文档框架。

---

## 11. 自动测试矩阵（mock adapter）

至少覆盖：

1. 仅 document 可生成；
2. `packageId` 为正式输入；
3. package / snapshot / Deliverable 校验；
4. 无模型能力准确失败；
5. mock 模型成功返回；
6. Markdown 文件真实写出；
7. HTML 文件真实写出；
8. hash 与文件内容一致；
9. ArtifactRef 路径为相对路径；
10. DeliverableVersion 真实创建；
11. `currentVersionId` 更新；
12. attempt succeeded；
13. 模型失败不创建 Version；
14. 写盘失败不创建成功 Version；
15. 重试创建新 attempt；
16. 重试创建新 Version；
17. 旧版本不覆盖；
18. 重启恢复；
19. 打开文件使用安全解析后的路径；
20. 路径穿越被拒绝；
21. 不支持类型不生成假文件；
22. 接受绑定具体 version；
23. 否定绑定具体 version；
24. 新版本不继承旧版本 accepted；
25. 无真实密钥进入日志。

命令建议：`npm run test:dvl2-03a-document`、`npm run test:dvl2-03a-document-acceptance`。

---

## 12. Electron 两阶段自动验收（两独立进程）

**Phase A**（隔离 userData + mock）：确认计划 → 准备 package → 生成 document → 验证真实 md/html → 验证 Version/ArtifactRef/currentVersionId → 写机器可读结果 → 退出。

**Phase B**（同一 userData，新进程）：恢复 → 打开 HTML 并校验内容 → 接受具体版本 → 再生成新版本 → 旧版本仍在 → 新版本不继承 accepted → summary → 退出。

---

## 13. Owner 真机验收

Owner 必须能够：

1. 打开已准备成果包；
2. 点击「生成文档成果」；
3. 等待真实模型生成；
4. 打开真实 Markdown；
5. 打开真实 HTML；
6. 在文件系统确认文件存在；
7. 完全退出并重启；
8. 再次打开同一成果；
9. 接受该版本；
10. 重新生成；
11. 看到新版本；
12. 旧版本仍可打开；
13. 确认内容与计划目标、受众和用途基本一致。

**核心标准**：系统是否真的交付了一个可用成果——不是按钮是否存在。

---

## 14. 停止条件

出现以下情况必须停止并报告 Blocker：

- 现有模型 adapter 无法安全复用；
- 必须修改 DVL2-00 冻结合同；
- 必须修改 DVL2-02 已冻结语义；
- 无法保证文件原子写；
- 无法保证失败时不创建成功 Version；
- 无法安全打开本地文件；
- 必须引入大型依赖；
- 必须同时支持多格式；
- 必须进入发布/分享；
- 真实模型调用可能泄露密钥；
- 自动测试必须消耗真实额度。

---

## 15. 流程与状态门禁

1. 本轮起草一页式任务包（本文）；
2. Codex 一次集中评审；
3. Owner 一次同时：`owner_accepted` + `frozen_for_implementation` + `implementation_authorized`；
4. Cursor 实现与自动测试；
5. Owner 真机验收；
6. 一次收口。

**本轮必须保持：**

```
status: spec_and_authorization_drafting / codex_review_pending
implementation: not_started
implementation_authorized: false
```

---

## 16. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0-draft | 2026-07-26 | 初稿：压缩规格+授权；document→md+html 垂直切片；待 Codex 集中评审 |
