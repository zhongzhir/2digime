# MVP-RELEASE-GATE-01B：发布基线锁定、历史路径清理与唯一正式入口

| 字段 | 值 |
|------|-----|
| 任务代号 | `MVP-RELEASE-GATE-01B` |
| 文档版本 | v0.1 |
| 日期 | 2026-07-30 |
| 起始分支 | `codex/artifact-access-min-01` |
| 起始 HEAD | `feecee564ebba2c3b54d2024afeb08ef373830dd` |
| 实施分支 | `codex/mvp-release-gate-01` |
| 状态 | `implemented` / `classic_release_surface_locked` / `dead_renderer_paths_removed` / `retired_artifact_open_dual_path_removed` / `renderer_next_and_advanced_paths_frozen` / `formal_classic_runtime_validated` / `ready_for_mvp_release_gate_01c` / `not_pushed` |
| Push | **禁止** |

---

## 1. 目标

从审计基线建立唯一 MVP 发布基线：

* 锁定 **classic renderer** 为唯一正式产品面；
* 冻结 renderer-next / R2 / advanced_shadow；
* 删除明确无用的遗留做事场景 DOM、VL1 旧面板、成果访问 IPC 双轨与历史防御；
* **不**实施 01C（首启/导入）、01D（生成 heal）、01E（成果访问用户入口重建 / 四导航）。

## 2. 唯一正式产品面

```text
src/renderer/index.html
src/renderer/app.js
src/renderer/styles.css
```

默认启动链：

```text
npm start / electron .
→ src/main.js
→ createWindow()
→ rendererEntryRuntime.applyInitialEntry()
→ legacy/classic
→ src/renderer/index.html
```

`MVP_PRODUCT_SURFACE = "legacy"`（`renderer-entry-controller.js`）。

## 3. 冻结（retained_as_frozen_infrastructure / not_mvp_product_surface）

| 模块 | 冻结方式 |
|------|----------|
| `src/renderer-next/**` | 源码保留；普通启动不可达；仅 harness 可进 |
| R1 / R2 / R3 | 不继续开发；非 MVP 产品面 |
| `r2:*` IPC | 保留基础设施；正式用户不进入 |
| `advanced_shadow` | 默认关闭；需显式 deps 或 `DIGITALME_QUALITY_PIPELINE_MODE`+`DIGITALME_ALLOW_ADVANCED_PIPELINE=1` |
| semantic / grounded repair | 不作为生产交付门禁；不向 UI 暴露 |

生产生成模式唯一：`stable_delivery`。

## 4. 删除范围（摘要）

* `#do-write` / `#do-research` / `#do-code` 及对应 binder / 死分支
* VL1：`#act-result-gen-panel` / `#act-research-panel` / `#act-learn-panel` / `#act-legacy-direct-run`
* `#bootstrap-guide` / `#panorama-experience-panel`
* 能力页重复「我的成果」列表
* preload / IPC：`actBehalfOpenArtifact` / `actBehalfRevealArtifact` / `actBehalf:openArtifact` / `actBehalf:revealArtifact`
* renderer open 历史防御与 `artifactOpenHandlerCalls`
* retired：`electron-artifact-open-ui-acceptance.cjs`、`electron-owner-artifact-open-dom-dump.cjs`

## 5. 成果访问临时状态

```text
artifact_access_user_entry_rebuild_deferred_to_01E
```

当前临时兜底：

```text
原生 File 菜单 → deliverable-artifact-open 安全核心
```

**不得**标 `artifact_access_complete`。本轮不恢复成果卡按钮。

## 6. 明确不涉及

* 01C：全新安装、首次启动、创建/导入 Package
* 01D：generation interrupt heal、packages.bak、知识收敛
* 01E：成果访问用户入口重建、四导航 UX

## 7. 复杂度约束

```text
新增永久字段：0
新增 Store：0
新增成果访问 IPC：0
新增 renderer：0
新增用户面：0
```

## 8. 验收状态（完成后更新）

目标状态标签：

```text
implemented /
classic_release_surface_locked /
dead_renderer_paths_removed /
retired_artifact_open_dual_path_removed /
renderer_next_and_advanced_paths_frozen /
formal_classic_runtime_validated /
ready_for_mvp_release_gate_01c /
not_pushed
```

不得标记：`mvp_ready` / `closed_alpha_ready` / `artifact_access_complete` / `owner_runtime_accepted`
