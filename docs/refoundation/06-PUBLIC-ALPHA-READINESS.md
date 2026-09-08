# 06 — Public Alpha Readiness

**状态：** `audit_complete / not_released / not_pushed`  
**日期：** 2026-09-08  
**任务：** `DIGITALME-PUBLIC-ALPHA-READINESS-01`  
**性质：** 发布前只读审计 + Release Candidate 规划。不是宪法，不是 Current Plan。  
**Candidate：** `bac5de0198f567224aa1aeaf62a15872e9c9a4cb`（`build/tujimi-ui-minimal-integration-01`）

本轮未改产品代码、未打包、未 push、未 release。

---

## 0. Gate 0 — 仓库

| 项 | 值 |
|---|---|
| worktree | `D:\Projects\dm-2digime-refoundation-03-dialogue-doing` |
| branch | `build/tujimi-ui-minimal-integration-01` |
| HEAD / Candidate | `bac5de0198f567224aa1aeaf62a15872e9c9a4cb` |
| tracked | 干净（`git status --short --untracked-files=no` 空） |
| `git diff --check HEAD` | 无 whitespace 报错 |
| remote | `origin https://github.com/zhongzhir/2digime.git` |
| `scripts/_*` | 仅未跟踪本地目录，本轮未动 |

`git fetch origin` 本机多次超时；divergence 用本地已有 `origin/main` 重新计算。fetch 失败后 SHA 与计数未变。

---

## 1. 三个「主线」是否相同

**否。三者目前不同。**

| 角色 | 当前 SHA | 说明 |
|---|---|---|
| Development Authority | `bac5de0198f567224aa1aeaf62a15872e9c9a4cb` | 本仓库唯一产品 Candidate |
| Public GitHub `origin/main` | `a7230372f11b1004e9394e250c78c7cbd4ff2dc5` | `merge: reconcile public main history` |
| Release Candidate 包 | **不存在** | 本轮未执行 `npm run build:packaged` |

03 MAIN RULE「`origin/main` ≠ development authority」**本次重新验证成立**，不是沿用历史印象。

merge-base：`eef1eb4fe6c52e72224ba26d0706fa46e6db110c`  
`origin/main...HEAD`：`24`（main 独有） / `37`（Authority 独有）。

---

## 2. Gate A — GitHub 历史与主线换代

### origin/main 独有（24）

旧产品线，**不得合入 Authority 工作树**：Work dispatch / turns-tasks-jobs、coding confirmation UI、knowledge-worker trial 文档、`README.zh-CN.md`、search/agent semantic 路径等。

独有触及的产品代码包括：`electron/renderer/task-workspace.js`、`src/work-runtime/*`（planner / job-runner / work-converse 等）、旧 `app.js` 做事路径。合入会把 **Work Runtime 用户主路径**带回公开主线。

**必须保留的是 Git 历史，不是当前树。** `README.zh-CN.md`、knowledge-worker 试验文档、旧审计报告应留在 `a723037` 可达的历史上，不要当今天的产品面恢复。

### Authority 独有（37）

新产品主线：Digital Self 单一权威、Talk 统一入口、停用默认 Work Runtime、zero-start coding acquire、Subject Network 分布式个人选择、Public Alpha UI P0。这是应对外公开的树。

### 旧产品重新进入公开主线的风险

**高，如果有人直接 `git merge origin/main`。** 该 merge 会把上述 Work / Task / Job 用户路径与旧 README 叙事带进公开树。

### 推荐策略：`NEW_PUBLIC_BASELINE`

| 选项 | 结论 |
|---|---|
| FAST_FORWARD | **不可**。已分叉，main 不是 Authority 祖先。 |
| 普通 MERGE | **禁止。** 会导入旧产品树。 |
| force push / rebase Authority / squash 全历史 | **禁止。** |
| **NEW_PUBLIC_BASELINE** | **采用。** |

**最安全、且不丢 GitHub 历史的执行方式（本任务不执行）：**

1. Tag 当前公开 tip：`archive/public-main-pre-refoundation` → `a723037`。  
2. 在 Authority 上：`git merge -s ours origin/main`（树保持 Authority，main 成为第二父提交）。  
3. 将该 merge commit **fast-forward** 推到 `origin/main`（main 是 merge 的父提交之一，**不需要 force push**）。

这不是把 origin/main 的文件合进来，而是归档旧公开历史后，让新公开 main 的树等于 Authority。

---

## 3. Gate B — 旧代码 / 旧产品面

只问：会不会影响安装、运行、理解、安全或后续维护。不因「看见旧代码」建议全删。

| 项 | 分类 | 说明 |
|---|---|---|
| `#nav-work` / `#nav-collab` / `#panel-work` | HIDDEN_BUT_HARMLESS | `hidden` + CSS `display:none !important`；正式 `setNav` 走 Talk / 数字之我 / 设置 |
| growth cockpit / `#growth-block` | HIDDEN_BUT_HARMLESS | `#growth-block { display: none !important }`；数字之我页走新投影 |
| 旧 Work Runtime | HIDDEN_BUT_HARMLESS | `isWorkRuntimeAttached()` 正式默认 false；仅 `work.*` / `artifact.*` 显式 `ensureLegacyWorkRuntime()` |
| stub / demo | HIDDEN_BUT_HARMLESS | `DIGITALME_V2_TALK_STUB` / `DIGITAL_SELF_STUB` / `UX_ACCEPTANCE`；正式 `realProduct` 关闭 |
| Digital Self schema / 双 authority | 无 ACTIVE 双权威 | 唯一 `self.json` |
| fixture 特判 | DEAD_CODE / 测试 | 不进入正式 Electron |
| 旧 provider prerequisite（Node/Codex 作为用户前置） | 对**最终用户运行**非前置；对**打包机**仍要 Node | 见 Gate C/D |
| 根 README 旧主路径 | **PUBLIC_RELEASE_BLOCKER** | 见 Gate G：会误导公开用户 |
| `docs/windows-preview/README.md` / `trial/试用说明.txt` | ACTIVE（较准） | 三入口；打进 ZIP 的说明可用 |

**不要**本轮删除 renderer 旧 DOM 或 work-runtime 源码。它们不是公开用户主路径。

---

## 4. Gate C — Windows Zero-start

目标路径：下载 → 解压 → 双击 `兔机米.exe` → 设置里连接 AI → Talk → 数字之我 → 真实做事。

**不得要求用户安装：** Node / npm / Python / Git / Codex / OpenCode / Cursor / MCP / Docker / 开发者终端。

代码事实：

- 运行 packaged ZIP：解压 + 双击即可（`trial/试用说明.txt`）。  
- Coding acquire：GitHub `anomalyco/opencode` 的 `opencode-windows-x64.zip`；目录 `userData/runtimes/coding/opencode-windows-cli`；解压用系统 PowerShell `Expand-Archive`。  
- 包本身不依赖 Owner 本机 PATH 上的 Codex。  
- 模型连通后才注册 `acquiredCodingCapability`（`electron/main.cjs`）。  
- Codex adapter **仍默认注册**；本机若能解析到 Codex，模型仍可能走 `cap_external_executor_codex`。

本轮 Trial 3：剥离 PATH 后 **仍出现** `cap_external_executor_codex`，同时 `cap_acquired_coding_runtime` 也出现且 acquire 目录已创建。说明：PATH 不是 Codex 探测的唯一来源；零安装路径存在，但 **本机不是干净机证明**。

```text
WINDOWS_ZERO_START_READY = PARTIAL
```

阻塞「YES」的不是缺 Node 运行时依赖，而是：**尚未在陌生 Windows 机、强制无 USER_EXISTING 的条件下跑通完整做事交付。**

---

## 5. Gate D — Windows 安装包

| 项 | 状态 |
|---|---|
| electron-builder | `electron-builder.yml`：win **zip / x64 only** |
| 命令 | `npm run build:packaged` → `scripts/build-packaged.cjs` |
| artifact | `${productName}-${version}-win-x64.zip` → `release-staging/`（gitignore） |
| signing | `signAndEditExecutable: false`；未签名 |
| GitHub Actions | **仓库内无** `.github` workflow |
| auto-update | **无** electron-updater |
| 试用说明 | `trial/试用说明.txt` 打进包；禁止出现 MCP/Codex/OpenCode 等内部词 |
| 敏感扫描 | 打包脚本拒绝 `sk-` / 私钥 / evidence 路径 |

**现在能否从 `bac5de0` 产生陌生 Windows 可运行包？**  
**命令存在，本轮未实际构建、未干净机安装验证。** 开发机（有 Node）上的准确命令：

```bash
npm install
npm run build:packaged
```

产出：`release-staging/v2-<timestamp>-bac5de01/` 下的 `兔机米-0.1.0-win-x64.zip`。  
最终用户：解压，双击 `兔机米.exe`。系统可能提示未签名，需「仍要运行」。

最小阻塞（相对「已经有可下载 Release」）：本轮没有打出包；没有 CI；没有签名。这些是发布序列上的步骤，不是运行时代码缺陷。

---

## 6. Gate E — macOS

```text
MAC_PUBLIC_ALPHA_NOT_READY
```

- builder **有** mac zip target，**仅 x64**，无 arm64。  
- `identity: null`：无签名、无公证。  
- 无 GitHub Actions mac runner。  
- **无本轮真实安装验证。**

不得在 README 宣称支持 macOS。Public Alpha **可以 Windows-only**。`docs/windows-preview/README.md` 已写明 mac 包不是公开试用安装通过。根 README 也只写了 Windows Preview ZIP，但未明确「仅 Windows」。

---

## 7. Gate F — Secrets / Privacy / Evidence

当前 tracked 树：

- 无 tracked `.env`（仅 `relay-service/.env.relay.example`，无密钥）。  
- 无真实 `sk-` 长密钥；测试里只有假值（`sk-abcdefghijklmnopqrstuvwxyz`、`sk-test-PLAINTEXT-…`）。  
- `BEGIN PRIVATE KEY` 仅测试 fixture。  
- 无 Owner 绝对路径写入 tracked 源码。  
- `build/evidence/`、`release-staging/`、`scripts/_mvp-p14-real-capability-evidence/` 已 gitignore。  
- 本机凭证文件存在且 **未跟踪**。

Git 历史：对 `.env` / `.runtime-model-credential.json` / `secrets.v1.json` / `secrets.v2.json` 的 `git log` 为空。未见曾提交这些密钥文件。

```text
PUBLIC_SECRET_GATE = PASS
```

未做全历史 blob 穷尽扫描。若后续发现历史真实密钥，即使当前已删，必须改判 BLOCKED 并轮换密钥。本轮扫描未发现该证据。

公开仓库仍不得纳入：`build/evidence/**`、`scripts/_*/**`、`dist/`、`release-staging/`、凭证 JSON、Owner userData。

---

## 8. Gate G — README / 项目定位

**根 `README.md` 不能代表今天的产品。** 对陌生人是错误主路径。

仍在说的过时内容：

- experimental preview / 协作作为核心体验；  
- Talk「可转为任务」；独立「做事 (Do)」面；  
- Work Runtime 管道（task → job → artifact）；  
- 协作核心与 Subject Core 架构图。

与 00「属于我 · 能做事 · 连接世界」及 Talk 统一入口冲突。`trial/试用说明.txt` 与 `docs/windows-preview/README.md` 更接近三入口，但仍是 Preview 话术。

本任务 **只给修改方案，不改文件。**

建议根 README 结构（短，非架构论文）：

1. **第一屏：** 2digime（兔机米）是属于用户的数字之我。告诉它目标，它会自己寻找和组织合适的 AI 能力完成任务；并在对话、做事、选择和连接世界的过程中成长。  
2. **属于我：** Digital Self；local-first；可解释来源；可纠正；可带走。  
3. **能做事：** AI First；对话即入口；zero-start 获取成熟 Agent（不自研 Coding Agent）；用户不必先装 Node/Codex。  
4. **连接世界：** Digital Subject Network；选择算法在用户自己的数字主体；Relay 是服务商不是推荐权威。  
5. **现在能试：** **仅 Windows x64 ZIP**；解压双击；设置里连接自己的模型密钥；未签名。明确 **不支持 macOS Public Alpha**。  
6. **不写：** Work/Task/Job、协作中心、转为任务、市场 95 分位已达成、需要开发者工具才能运行。

公开试用说明以 `trial/试用说明.txt` 为准同步改一版短中文。

---

## 9. Gate H — Public Trial Truth

正式 Electron + 真模型。无 fixture。证据 gitignored：`build/evidence/public-alpha-readiness-01/`、`build/evidence/subject-network-feed-01/`。

### Trial 1 — Talk

**通过。** 普通聊天（下雨天适合做什么）。模型正常回复，无 Job/taskId/adapter/OpenCode 泄漏。`modelReady=true`。

### Trial 2 — Digital Self（「你最近了解我什么？」）

**「没有长期记忆 / 没有档案」本轮未复现。**

流程：先写入 lasting 事实（软件开发者、清晨写代码）→ 再问。  
`self.json` 实际路径：隔离 `userData/subjects/default/digital-self/self.json`。  
已写入两条 `current` + `confirmed`。回答引用这两条，并说除此之外了解有限——与文件一致，不是否认记忆。  
数字之我页：同一两条，「你亲口说的 · 已确认」。

上一轮 Public Alpha UI Trial A 曾出现「没有长期记忆档案」类话术：当时「关注公开试用」不一定被标 lasting，`formatSelfContext` 在空理解时会注入「当前还没有已写入的数字之我认识」，模型可能改写成「没有档案」。根因是空上下文 + 模型措辞，**不是**「若问记忆就回答有」的硬编码。本轮有 lasting 写入后未复现。频率：本轮 1/1 未否认；上一轮空/弱 lasting 时出现过。**不列为 P0。禁止加硬编码。**

### Trial 3 — Zero-start Doing

隔离项目：`帮我修改这个程序并检查是否可用。` 强制尝试去掉 USER_EXISTING（剥离 PATH）。

结果：

- **未假成功。** 真实列出目录/读文件，跑了 `index.js` 得到 `hello`，然后因目标不具体而请用户确认方向。结果卡 0。  
- PATH 剥离 **未能** 阻止 `cap_external_executor_codex`（仍出现）。  
- 同时出现 `cap_acquired_coding_runtime`，且 `userData/runtimes/coding/opencode-windows-cli` 已存在。  
- 用户可见文案提到 Node 全路径（因 PATH 无 `node`），略偏内部，未点名 Codex/OpenCode。

**裁决：** 做事诚实；零安装「无现成 Agent」未在本机证伪 Codex。干净机验证仍必须放在发布序列。一句含糊的「修改这个程序」导致先问再改，属产品判断，**不是 P0 假成功**。

### Trial 4 — Network Personal Selection

复用 accepted 路径 `subject-network-feed-01.e2e.test.ts`（真模型 `deepseek-v4-flash`）。

- 同池 32 条，`samePool=true`，`poolHash=a52f2cb6…`。  
- Self A 与 Self B 的 shown 集合不同（`aOnly` / `bOnly` 非空）。  
- 测试 **pass 1 / fail 0**。无 Feed UI。

---

## 10. 分级

### P0 — 发布阻塞（本轮确认）

1. **公开 README 严重过时**（独立做事 / 转为任务 / 协作核心 / Work Runtime 管道）。发布前必须改文档。  
2. **公开 `main` 仍是旧产品树。** 禁止直接 merge origin/main；必须按 Gate A 的 `NEW_PUBLIC_BASELINE`。  
3. **尚未从本 Candidate 打出并在干净 Windows 机验证的 ZIP。** 命令有，包没有。发布前必须做。  
4. **Zero-start 做事尚未在「无 USER_EXISTING」干净机上闭环交付。** 本机 Trial 3 仍打到 Codex。若对外宣称「不用先装 Coding Agent」，必须先有干净机证据。

不是代码级「装不上 / 密钥泄漏 / Digital Self 主链失效 / 假成功」。那些本轮未成立。

### P1 — Public Alpha 后

- 会话列表；Talk 内网络结果；成果轻预览；两套 CSS 合层。  
- Network UI / Feed；协作中心；Computer Use。  
- 未签名；无自动更新；无 GitHub Actions。  
- macOS。  
- Codex 探测不只看 PATH；含糊做事指令会先澄清。  
- 空 Digital Self 时模型可能说「没有档案」（措辞，非主链失效）。

禁止把 P1 升成发布前大完善。

---

## 11. GitHub / Release 推荐执行顺序（本任务不执行）

```text
1. Authority Candidate（当前 bac5de0；审计提交后前进）
2. 只修 P0：重写公开 README / 试用说明（Windows-only；对齐 00）
3. 开发机：npm run build:packaged
4. 陌生 Windows 机：解压 → 连接 AI → Talk → 数字之我 → 无现成 Codex 的做事
5. 公开文档与包内 试用说明.txt 一致
6. tag archive/public-main-pre-refoundation = a723037
7. 在 Authority：git merge -s ours origin/main
8. fast-forward push 到 origin/main
9. tag 建议：v0.1.0-public-alpha
10. GitHub Release 名称建议：兔机米 Public Alpha（Windows x64）
11. 上传 win-x64 ZIP；Release 正文写未签名、仅 Windows、自备模型密钥
```

**不要删的历史 branch：** `checkpoint/2digime-refoundation-02`、`build/2digime-refoundation-03-dialogue-doing`、冻结 DIRTY worktree 对应 branch、`origin/main` 被 archive tag 钉住的旧 tip。公开仓库不需要为 Alpha 删除它们。

**不要进入公开跟踪：** `build/evidence/**`、`scripts/_*/**`、`dist/`、`release-staging/`、凭证、Owner 本机路径、runtime 二进制缓存。

---

## 12. 总裁决

```text
PUBLIC_ALPHA_READY_AFTER_P0_FIXES
```

产品主链（Talk / Digital Self / 诚实做事 / 分布式选择）在 Candidate 上成立。挡住「现在就公开 Release」的是：README 换代、公开 main 换代方法、Windows 包 + 干净机、以及宣称 zero-start 所需的无 Codex 验证。

---

## 13. 本轮未做

未改产品代码。未 push。未 release。未实际执行 main 替换。未打包装。
