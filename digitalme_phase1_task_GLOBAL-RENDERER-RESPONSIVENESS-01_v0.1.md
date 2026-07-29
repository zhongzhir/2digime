# GLOBAL-RENDERER-RESPONSIVENESS-01：全局交互迟滞审计与修复

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `duplicate_listeners_removed` / `renderer_main_thread_work_reduced` / `automated_performance_tests_passed` / `owner_runtime_acceptance_pending`  
实施分支：`codex/global-renderer-responsiveness-01`  
基线：`6bff2ad`（`codex/task-quality-stabilize-01-fix-artifact-open-ui`）

> **暂停** TASK-QUALITY-STABILIZE-01-FIX-01C（未提交变更已丢弃，未合入）。  
> **不得**标 `performance_regression_fixed` / `owner_runtime_accepted` / `artifact_open_validated`。不得 push。

---

## 一、Owner 现象与根因

Owner 在正式 Electron（`6bff2ad`）中：

- 「打开成果」无即时反馈；
- 普通按钮变慢；
- Windows「文件」菜单延迟 2–3 秒。

结论：**不是单按钮接线问题**，而是 **Electron main 主线程被大体积 JSON Store 的同步读写阻塞**，OS 菜单与 IPC 同时受影响。

### 实测证据

Owner 真机 `deliverable-packages.json` ≈ **2.1 MB**。  
修复前每次 `loadStore` 同步 `readFileSync` + `JSON.parse`；每次 `persist` 还做 `JSON.stringify(store, null, 2)`（pretty-print）+ `writeFileSync`；`mutateStore` 还会**二次**同步读盘。  
后台增强 / baseline 推送触发 renderer 全量 `refreshActGenerationPanel` → 再次 IPC → 再次 `loadStore`，形成主线程卡顿环。

Node 侧修复后（同一 Owner Store）：

| 指标 | 结果 |
| --- | --- |
| Owner store bytes | ~2,130,589 |
| cold `loadStore` | ~9 ms（解析一次） |
| warm P95 | ~0.35 ms（内存缓存命中） |

### 次要因素

- `wireActBehalfUi` / `wireActTaskListUi` / `bindEvents` **原先无幂等守卫**（当前启动路径只调用一次，但仍是回归雷区；tab / document overflow / generation-items 可重复绑定）。
- 增强 settled 推送会触发**即时**全面板重建（已节流）。
- 打开任务成功文案「已打开草稿任务。」长期残留，被误认为打开成果结果（已清除）。

**未**采用 FIX-01C 的 document capture listener（会加重全局 click 复杂度）。

---

## 二、修复内容

### Main（主因）

1. `deliverable-package-store` / `task-store` / `deliverable-plan-store`：`loadStore` **mtime+size 内存缓存**；写入后更新缓存。
2. 持久化改为 **紧凑 JSON**（去掉 `null, 2` pretty-print），降低 stringify/写盘耗时与文件体积。
3. `mutateStore` 复用缓存 raw，避免二次同步读 2MB。

### Renderer

1. `bindEvents` / `wireActBehalfUi` / `wireActTaskListUi` **幂等**（dataset 守卫）；generation-items / tabs / overflow document listener 只装一次。
2. baseline / enhancement IPC 推送 → `scheduleThrottledGenerationPanelRefresh`（250–400ms 合并）。
3. 成果打开：点击后**立即**按钮「正在打开…」+ 卡片旁局部反馈；成功/失败不写底部远处 progress；打开路径不触发全任务/全面板 render。
4. 删除「已打开草稿任务。」/「已恢复任务意图与确认快照。」成功粘滞文案。
5. 轻量 `window.__dmPerf` 计数器（不持久化）。

### 架构限制

- 新增永久字段 = **0**
- 新增 Store = **0**
- 新增全局状态机 = **0**
- 未新增 document capture listener

---

## 三、自动化结果

```text
npm run test:global-renderer-responsiveness-01   # 11 passed
npm run test:task-quality-stabilize-01-fix-01   # 13 passed
npm run test:task-quality-stabilize-01           # 12 passed
npm run test:dvl2-02-package                     # 17 passed
npm run test:dvl2-03-one-click                   # 6 passed
npm run test:artifact-open-acceptance            # firstOpen/reopen passed
npm run test:artifact-open-ui                    # 42 passed
```

---

## 四、Owner 验收（两步）

**第一步（先做）**：不测成果打开。验证「文件」菜单是否即时、关闭是否即时、普通按钮是否恢复、切换任务是否顺畅、生成/增强期间是否仍可操作。

**第二步**：响应恢复后再点「打开成果」。

---

## 五、FIX-01C 暂停声明

分支 `codex/task-quality-stabilize-01-fix-artifact-open-capture` 上未提交的 FIX-01C 改动（`app.js` / `deliverable-planner.js` / 单测）已在切换本任务时 **discard**，未合入。本任务明确不增加页面级 capture listener。
