# MVP-REPO-SIZE-AUDIT-AND-CLEANUP-01 报告

**日期**：2026-07-31  
**分支**：`codex/mvp-release-gate-01`  
**HEAD（清理前后未改产品提交）**：`597225ef56d26dd2ad49e7a2dab3f236f26fcc9f`  
**Push**：`not_pushed`

## 完成状态

`completed` / `repository_size_explained` / `obsolete_builds_removed` / `single_active_candidate_retained` / `user_data_preserved` / `tests_passed` / `not_pushed`

## 四个核心数字（清理后）

| 项 | 体积 | 说明 |
|---|---:|---|
| Git 跟踪源码与文档 | **9.35 MB**（570 文件） | `git ls-files` 工作树合计；远低于 100 MB 目标 |
| 开发依赖 | **~777 MB** | 主路径 `digitalme-app/node_modules` ≈ 701 MB；另有 VS Code 扩展 `src/editor-extension/node_modules` ≈ 40 MB（独立包，非重复副本） |
| 构建与历史候选 | **当前 ≈ 466 MB；历史完整副本 = 0** | 仅保留 `20260731-173649-597225e`（1× win-unpacked + 1× zip + manifest） |
| 测试证据及其他 | **证据 ≈ 2.7 MB + 归档 zip ≈ 4.5 MB；用户资料 ≈ 84 MB；`.git` ≈ 22 MB** | 正式跟踪证据保留；散落未跟踪证据已归档 |

## 清理前总量

| Metric | Value |
|---|---|
| 总体积 | **6.273 GB**（6,735,825,711 bytes） |
| 文件数 | 20,658 |
| 文件夹数 | 3,325 |
| Git tracked | 9.35 MB / 570 files |
| Git untracked | 6,414 MB / 20,088 files |

依据：`repo-size-before.json` / `repo-size-before.md`

### 清理前分类

| Category | GB | MB | Files |
|---|---:|---:|---:|
| historical_build | 4.618 | 4728.98 | 375 |
| dev_deps | 1.108 | 1134.18 | 18444 |
| current_build | 0.420 | 429.94 | 27 |
| user_data | 0.082 | 83.66 | 400 |
| git_metadata | 0.022 | 22.27 | 396 |
| test_evidence | 0.013 | 13.15 | 356 |
| source_docs | 0.010 | 10.05 | 613 |
| unknown | 0.001 | 0.87 | 15 |
| temp | 0.001 | 0.70 | 32 |

### 清理前 Top 原因（可解释）

体积几乎全部来自 **9 个历史 staging 构建 + 1 个 superseded `dist-alpha-build` + `dist-alpha`**（合计约 5.0+ GB），而非「神秘 Electron」。`node_modules` 内 Electron / app-builder-bin 是开发依赖常态。

## 清理后总量

| Metric | Value |
|---|---|
| 总体积 | **1.298 GB**（1,393,290,189 bytes） |
| 文件数 | 19,374 |
| 文件夹数 | 3,077 |
| Git tracked | 9.35 MB / 570 files |
| Git untracked | 1,319 MB / 18,804 files |

依据：`repo-size-after.json` / `repo-size-after.md`

### 对比表

| 项 | 清理前 | 清理后 | 减少 |
|---|---:|---:|---:|
| 总体积 | 6.273 GB | 1.298 GB | **4.975 GB** |
| 文件数 | 20,658 | 19,374 | 1,284 |
| 文件夹数 | 3,325 | 3,077 | 248 |
| 源码（Git tracked） | 9.35 MB | 9.35 MB | 0（未删跟踪源码） |
| node_modules（分类含打包内嵌） | 1134 MB | 777 MB | 357 MB（主要来自删除旧 win-unpacked 内嵌依赖） |
| 构建产物（历史+当前） | ~5159 MB | ~435 MB 当前 + 0 历史完整副本 | ~4.7 GB |
| 测试证据 | 13.15 MB | 2.71 MB（+4.5 MB 归档） | 散落副本已归档 |
| 其他（用户资料/未知/临时） | ~85 MB | ~84 MB | 基本未动 |

**目标核对**：活跃目录 **1.298 GB ≤ 2.5 GB**；Git 跟踪 **9.35 MB ≤ 100 MB**；历史构建完整副本 **0**；当前 portable **仅 1 份**。

## 清理后 Top 30 目录

| # | MB | Path |
|---:|---:|---|
| 1 | 1219.35 | digitalme-app |
| 2 | 700.87 | digitalme-app\node_modules |
| 3 | 465.68 | digitalme-app\dist-alpha-build-staging |
| 4 | 465.68 | …\20260731-173649-597225e |
| 5 | 335.42 | …\win-unpacked |
| 6 | 265.78 | digitalme-app\node_modules\electron |
| 7 | 264.82 | …\electron\dist |
| 8 | 206.80 | digitalme-app\node_modules\app-builder-bin |
| 9 | 109.14 | …\win-unpacked\resources |
| 10 | 101.15 | …\app-builder-bin\linux |
| 11 | 72.76 | source-materials |
| 12 | 72.31 | source-materials\articles |
| 13 | 68.37 | …\app-builder-bin\win |
| 14 | 43.63 | digitalme-app\src |
| 15 | 40.26 | digitalme-app\src\editor-extension |
| 16 | 40.16 | …\editor-extension\node_modules |
| 17–30 | ≤39 MB | electron locales / napi-rs canvas / pdfjs-dist / app-builder 平台二进制 等 |

剩余若仍关心「为何约 1.3 GB」：**701 MB 开发依赖 + 466 MB 当前唯一 portable 候选 + 73 MB Owner 源材料**，三项可解释，不是笼统 Electron。

## 清理前 Top 目录 / 文件摘要

完整清单见 `repo-size-before.md`（Top 100 目录、Top 200 文件）。前几大目录均为：

- `dist-alpha-build-staging/*`（多个 ~465–913 MB 候选）
- `dist-alpha-build`（~496 MB，已 SUPERSEDED）
- `digitalme-app\node_modules`

## Git 审计

| 产物 | 内容 |
|---|---|
| `git-tracked-size.json` | `git ls-files` 统计：571 路径 / **9.35 MB** |
| `git-untracked-size.json` | `git status --short` + `git clean -ndX` / `git clean -nd` **预览 only** |

**未执行**：`git clean -fd` / `git clean -fdx`。

### `.gitignore` 变更（单独说明）

根 `.gitignore` 与 `digitalme-app/.gitignore` 增补：

- staging / `dist-alpha-build` / `win-unpacked`（本已覆盖，复核保留）
- `*.zip` / `Digital-Me-Closed-Alpha-*.zip` / `digitalme-*.bundle`
- 本地 evidence 树：`scripts/_mvp-*-evidence/`、`_access-min-evidence/`、`_evidence-archive-*`
- 未把正式根目录报告、必要 manifest、测试源码、`package-lock.json` 加入 ignore

已跟踪的正式 evidence（如 `_access-min-evidence/LATEST`、`_mvp-release-gate-01c/d/e-evidence`）**仍由 Git 跟踪**；gitignore 仅阻止新的本地 dump 再入库。

## 删除清单（摘要）

机器可读：`historical-build-manifest.json`、`cleanup-deleted-items.json`

### 历史候选（完整副本删除；hash/状态已入 manifest）

| buildId | 约 MB | 动作 |
|---|---:|---|
| 20260730-143200-b0b21a8 | 0 | delete |
| 20260730-143248-b0b21a8 | 913 | delete |
| 20260730-143426-b0b21a8 | 466 | delete |
| 20260730-143543-b0b21a8 | 466 | delete |
| 20260730-143923-605be75 | 466 | delete（rejected） |
| 20260731-101441-3d651f0 | 466 | delete（rejected） |
| 20260731-115351-db97364 | 466 | delete（rejected） |
| 20260731-165449-e22abb6 | 801 | delete（含重复解压目录） |
| 20260731-172256-2890048 | 466 | delete（被 597225e 替代；仅留 manifest/hash） |
| dist-alpha-build（legacy） | 496 | delete |
| dist-alpha（legacy） | 73 | delete |

### 其他删除

- 根目录历史 `digitalme-*.zip` / `*.bundle` 交接包
- 已归档后删除的未跟踪 evidence 散落树（access-min 时间戳目录、do-workflow、01c 未跟踪 dump、fix-03/04）
- `.codex-qa`、`outputs`、`dm-account-b`
- 根目录已 ignore 的 patch / suite / pan-/r1-/p1-07 状态文本、`invite.json` / `cred-export.json` / `update-*.json`

**误删恢复**：曾短暂删除已跟踪的 `PAN-01S.1-…md` 与已跟踪 evidence；已用 `git checkout --` **完整恢复**。`digitalme_version.txt` 亦已恢复。

## 保留清单

| 项 | 路径 / 说明 |
|---|---|
| 当前唯一基线候选 | `digitalme-app/dist-alpha-build-staging/20260731-173649-597225e/` |
| win-unpacked | 同上 `/win-unpacked/`（含 `Digital Me.exe`） |
| zip | `Digital-Me-Closed-Alpha-597225e.zip`（sha256 见 build-manifest） |
| build manifest | `digitalme-app/scripts/_mvp-release-gate-01e-evidence/build-manifest.json` |
| 工程基线报告 | `MVP_DO_WORKFLOW_REBUILD_01_REPORT_20260731.md` 等根报告 **未删** |
| HEAD / 提交 | `597225e` 及后续报告提交保留；无 reset/rebase |
| node_modules | `digitalme-app/node_modules` |
| editor-extension deps | `src/editor-extension/node_modules`（独立扩展包） |
| 用户 Package | `digital-me-package/`、`.digitalme-pkgstore/` |
| 源材料 | `source-materials/` |
| 正式跟踪证据 | `_access-min-evidence/LATEST`、`_mvp-release-gate-01c/d/e-evidence` 等 |
| 证据归档 | `digitalme-app/scripts/_evidence-archive-20260731/*.zip` |
| 历史清单 | `historical-build-manifest.json` |

## 用户数据保护说明

- **未删除** `digital-me-package/`、`.digitalme-pkgstore/`、`source-materials/`、`运营/`、`参考/`。
- **未读取/输出** API Key 或密钥文件内容；密钥类路径保持既有 ignore。
- `digitalme-app/project/` 仍为本地未跟踪工程数据，本轮未删。

## 当前唯一基线候选

| 字段 | 值 |
|---|---|
| buildId | `20260731-173649-597225e` |
| commit | `597225e` |
| staging | `digitalme-app/dist-alpha-build-staging/20260731-173649-597225e/` |
| zip | `Digital-Me-Closed-Alpha-597225e.zip` |
| zipSha256 | `84B78E86F8158A92ABBAACCD0D51FFCC3FDA7DC7DBB002EE84A2C46A410FF50C` |
| 活跃构建上限 | 1 win-unpacked + 1 zip + 1 manifest |

## 测试结果

| 命令 | 结果 |
|---|---|
| `git status --short` | 仅 ignore/审计报告/既有未跟踪项；无源码缺失 |
| `git fsck --no-progress` | 仅既有 dangling blob/tree；无损坏 |
| `npm run test:mvp-release-gate-01e-fix-05` | **12 passed, 0 failed** |
| `npm run test:mvp-do-workflow-rebuild-01` | **8 passed, 0 failed** |

## 依赖与实际产品体积（解释）

| 层 | 约体积 | 含义 |
|---|---:|---|
| 产品源码+规格（Git） | 9 MB | 可版本管理的真实工程内容 |
| 开发依赖 | 701–777 MB | 可 `npm ci` 重建；Electron/app-builder 占大头 |
| 当前 Closed Alpha portable | 466 MB | Owner 真机验收所需唯一候选 |
| 用户真实资料 | ~84 MB | Package + 源材料 + pkgstore；受保护 |

## Commit / Push

- 建议提交：`chore(repo): audit and clean obsolete build artifacts`
- 本提交仅含：审计产物、清单、报告、`.gitignore`、审计脚本
- **不 push**

## 产物索引

- `repo-size-before.json` / `repo-size-before.md`
- `repo-size-after.json` / `repo-size-after.md`
- `git-tracked-size.json` / `git-untracked-size.json`
- `historical-build-manifest.json`
- `cleanup-deleted-items.json`
- `scripts/repo-size-audit.ps1`
- 本报告
