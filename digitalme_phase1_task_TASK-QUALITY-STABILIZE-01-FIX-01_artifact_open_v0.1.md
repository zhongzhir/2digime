# TASK-QUALITY-STABILIZE-01-FIX-01：成果打开链路修复

版本：v0.1.0  
日期：2026-07-29  
状态：`implemented` / `automated_tests_passed` / `artifact_open_restored` / `owner_runtime_acceptance_pending`  
实施分支：`codex/task-quality-stabilize-01-fix-artifact-open`  
基线：`48af0b4`（`codex/task-quality-stabilize-01`）

> **不得**标 `owner_runtime_accepted` / `accepted_as_implemented`。不得 push。

---

## 1. 真机核验（Owner userData）

Package：`delivery_ms5k9963_57dea4cf` · Task：`abt_ms5k8vpk_fd0a2b` · completion=`partial`

| 成果 | versionId | artifactId (canonical md) | exists | size | 原 UI 主打开目标 |
|---|---|---|---|---|---|
| PRD - Digital Me 项目知识功能 | dver_ms5kbhjc_79d46814 | aref_ms5kbhjs_767bad99 | 是 | 12986 | HTML（优先） |
| 用户故事地图 | dver_ms5kcy2z_4cbd6688 | aref_ms5kcy3a_d17e82c9 | 是 | 13591 | HTML |
| 信息架构图 | — | — | 否（failed） | — | 无打开按钮 |
| 功能和数据字典 | dver_ms5kby05_c4b27b48 | aref_ms5kby0e_c757a8be | 是 | 10101 | HTML |
| 验收测试用例列表 | — | — | 否（failed） | — | 无打开按钮 |

路径均在 `…\Roaming\digitalme-app\deliverable-artifacts\…`，绝对路径、文件非目录、无中文路径段。

---

## 2. 根因

1. **文件已真实落盘**，Store / ArtifactRef / contentHash 完整。  
2. UI `pickPrimaryArtifact` 对 document **优先 HTML**，按钮打开 HTML；系统应用可能在 Electron 背后打开或无可见反馈。  
3. 旧 `openArtifact` 仅用 `artifactRefId` → `relativePath` → `shell.openPath`，**缺少 exists 校验、归属校验、失败反馈不明显**；renderer 异常无 try/catch → 用户感知为「无反应」。  
4. 失败提示写在页面底部 `act-progress`，生成区无即时错误。

---

## 3. 修复

- 新增 `deliverable-artifact-open.js`：权威解析（task/deliverable/version/artifact 归属 + 允许目录 + exists + 扩展名）→ `shell.openPath`。  
- renderer 只传稳定 ID；拒绝 path 注入。  
- 文档主打开改为 **md → docx → html**，并优先 `version.artifactRef`。  
- 按钮「正在打开…」防重复；失败一句普通语言 + 详情 code。  
- 新增永久顶层字段：**0**；新 store：**0**。

---

## 4. 测试

- `test:task-quality-stabilize-01-fix-01` 12 passed  
- `test:stable-artifact-open-electron` open + reopen ok  
- stabilize-01 / DVL2-03 / one-click / TASK-UX / IDCOLLAB / Learn 回归通过  

---

## 5. Owner 再验

```powershell
Set-Location "D:\Projects\Digital Me\digitalme-app"
npm start
```

打开已有「PRD - Digital Me 项目知识功能」→ 单击「打开成果」应出现系统默认应用；重启后再开仍成功；未完成项无打开按钮。
