# P1-00 任务包：工程与 Package 基线冻结

状态：accepted（Owner 已确认范围；基线提交 `151d798`；Codex 已复核）
阶段：第一阶段 / WP0  
规格依据：`digitalme_phase1_subject_upgrade_plan_v0.1.md` §3 WP0、§7  
审计依据：`digitalme_architecture_audit_20260716.md` F-04、F-05、F-08、F-12、F-13

---

## 1. 目标

在不改变任何产品行为的前提下，建立后续安全改造可依赖的代码与主体资产基线：代码可追踪、Package 可校验、关键状态可盘点、发生错误可恢复。

## 2. 本任务代码 Owner

执行前填写其一：

- [ ] Codex
- [x] Cursor

同一时间只能有一个实现者修改本任务范围。

## 3. 允许范围

- 工作区根目录的 Git 与忽略规则；
- 新建只读诊断/校验脚本；
- 新建 Package schema/状态盘点的测试 fixture 目录；
- 新建本地、不提交的 Package 快照目录或快照说明；
- 更新本任务状态与 `digitalme_log.md`。

## 4. 禁止范围

- 不修改 `digital-me-package` 现有主体内容；
- 不修改 App 产品逻辑、UI、配置和依赖版本；
- 不删除 `_raw`、source materials、历史备份或用户数据；
- 不把 API Key、token、WPS 用户数据或本机绝对隐私路径提交进 Git；
- 不执行自动格式化或大范围文件换行重写；
- 不在未验证路径时移动或重命名目录。

## 5. 实施内容

### 5.1 Git 边界

1. 再次确认工作区根目录及子目录均无现有 `.git`；
2. 若确认无仓库，在工作区根建立 Git；
3. 完善 `.gitignore`，至少排除：
   - `node_modules/`；
   - Electron userData、运行日志、临时导出；
   - secret/config 本地文件；
   - Package 快照与可能包含私密原文的诊断输出；
   - WPS/Office 临时文件；
4. 首次提交前生成“将被纳入版本控制的文件清单”，由 Owner 确认是否包含不应提交的私密素材；
5. 只有 Owner 明确确认后才执行首次提交。

### 5.2 Package 基线清单

新增只读脚本，输出：

- Package 文件树；
- 每个文件的相对路径、大小、SHA-256；
- JSON/JSONL 可解析状态；
- source index 数量、hash 覆盖、悬空 `sourceRefs`、无法解析位置；
- 事实/声明/推断/状态字段的现有分布；
- manifest 版本与 updatedAt；
- trust/signature 是否真实可用或占位。

输出必须默认脱敏：不打印正文、API Key、token、完整本机绝对路径。

### 5.3 Package 快照

1. 在工作区之外或 `.gitignore` 明确排除的位置创建只读快照；
2. 快照包含完整 `digital-me-package` 与基线清单；
3. 快照目录名包含 UTC 时间和 Package version；
4. 生成恢复说明，但本任务不执行恢复覆盖；
5. 对快照根清单再次计算 SHA-256，确认复制完整。

### 5.4 能力状态表

新增当前能力状态表，至少包含：Builder、Retrieval、Feedback、Life Graph、Writing、Research、MCP extensions、External CLI、Audit、Package export/import、Secret storage、External collaboration。

每项只允许一个状态：`planned / specified / implemented / statically_verified / runtime_verified / released`，并附证据文件或测试。不得仅凭文档声明标记 verified/released。

## 6. 预期新增产物

具体文件名可由实现者按仓库约定调整，但须保持职责清晰：

- Package 基线只读校验脚本；
- Package 基线报告（脱敏）；
- 能力状态表；
- `.gitignore` 或根级忽略规则；
- 本任务完成记录。

## 7. 自动验证

至少完成：

1. 全部 App JavaScript 语法检查；
2. 全部 Package JSON/JSONL 解析检查；
3. 基线脚本连续运行两次，未改数据时主体文件 hash 完全一致；
4. 快照与源 Package 文件数量、大小和 hash 一致；
5. `git status` 不包含 `node_modules`、secret、本地快照和临时文件；
6. 运行前后 Package 文件 hash 一致，证明任务没有修改主体内容。

## 8. Owner 人工验收

实现者交付以下结果给 Owner：

1. 拟纳入 Git 的顶层目录与敏感文件说明；
2. Package 快照绝对位置；
3. 脱敏基线摘要：文件数、JSON/JSONL 状态、来源缺口、签名状态；
4. 能力状态表；
5. 未执行的动作，尤其是“是否尚未首次提交”。

Owner 只需确认：

- Git 清单中没有不希望进入版本历史的私密原文；
- 快照位置可访问且不在准备提交范围；
- 同意后续以该快照作为迁移和回滚基线。

## 9. 回滚

- Git 初始化尚未提交时，可在 Owner 同意后移除新建 Git 元数据；
- 新增脚本和报告可按明确文件清单删除；
- Package 不应发生变化；若 hash 发生变化，任务立即失败，以快照对比定位，不自动覆盖恢复。

## 10. 完成证据模板

实现者完成后填写：

- 修改文件：
  - 新增：`.gitignore`、`digitalme_version.txt`（`0.1-alpha`）、`digitalme_capability_status_v0.1.md`、`digitalme_p1_00_git_candidates.md`
  - 新增脚本：`scripts/p1-00-package-baseline.mjs`、`scripts/p1-00-create-snapshot.mjs`、`scripts/p1-00-verify-all.mjs`、`scripts/p1-00-git-candidate-list.mjs`、`scripts/fixtures/p1-00/*`
  - 新增报告（脱敏）：`build/reports/p1-00-package-baseline.json`、`.summary.md`、`p1-00-verify-all.json`、`p1-00-snapshot-pointer.json`、`p1-00-git-candidates.*`
  - 更新：本任务包状态、`digitalme_log.md`
  - **未修改**：`digital-me-package/**` 主体内容；`digitalme-app` 产品逻辑/UI/依赖
- 自动测试：`node scripts/p1-00-verify-all.mjs` → 全部 6 项 `ok: true`（见 `build/reports/p1-00-verify-all.json`）
- Package 前后 hash：逐文件 SHA-256 **完全一致**（56 文件 / 2,077,665 字节；清单 SHA-256 `3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a`）
- 快照位置：`C:\Users\46554\DigitalMe-baselines\digital-me-package-v0.1-2026-07-16T02-39-48-124Z`（工作区外，不在 Git 跟踪范围）
- Git 是否初始化：是；初始化前曾移除无效空 `.git` 云盘重解析点占位（非有效仓库）
- 是否已提交：**是**，本地基线提交 `151d798`（85 个文件）；未设置 remote、未推送
- 未验证事项：未做远程备份；未关闭 MCP/CLI（属后续安全任务，且本任务禁止改 App 行为）
- 建议下一任务：`P1-01 SecretStore 与敏感配置迁移`。
