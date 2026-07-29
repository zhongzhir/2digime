# ARTIFACT-ACCESS-MIN-01：删除失控成果打开前端，建立最小原生访问

版本：v0.1.0  
日期：2026-07-29  
状态：`implementation_in_progress` / `owner_retest_forbidden`  
实施分支：`codex/artifact-access-min-01`  
基线：`1fad412`（`codex/artifact-open-reset-01`）

> 不是 FIX-01E。回退 FIX-01A～D 与 RESET-01 的成果打开 **renderer** 链路；**保留** GLOBAL-RENDERER-RESPONSIVENESS-01 与 main 安全打开。  
> 开发者未完成 `npm start` → 文件菜单实测前：**禁止 Owner 复验**。

---

## 一、保留 / 撤销

**保留（A）**：Store 内存缓存、紧凑 JSON、listener 幂等、面板刷新节流、`openArtifactSecure` / ArtifactRef 校验。

**撤销（B）**：root capture / 直接绑定 / `executeUiCommand("artifact.open")` / 诊断 UI / 卡片「打开成果」与 reveal/copy 打开动作 / formal harness 可用性标签。

---

## 二、止血入口

成果卡**不再渲染**「打开成果」。

顶部 **文件** 菜单（main）：

- 打开当前成果  
- 打开成果所在文件夹  

启用条件：当前选中任务/package 经 Store 解析到可打开 ArtifactRef。  
renderer 仅 `actBehalfSetSelection({ taskId, packageId })`（无路径）。菜单点击不经 renderer click listener。

本轮**不做**成果卡右键第二体系（现有 context-menu 仅编辑框）。

禁止再次给 legacy 成果卡加打开按钮，直至统一命令总线 / React 迁移等前置条件满足。

---

## 三、状态

当前：`implementation_in_progress` / `owner_retest_forbidden`

开发实测通过后：

`implemented` / `legacy_artifact_open_ui_removed` / `native_artifact_access_added` / `developer_runtime_accepted` / `ready_for_owner_spotcheck`
